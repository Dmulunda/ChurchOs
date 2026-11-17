// Stripe Connect webhook for online giving
// (sql/saas_platform/144_online_giving.sql). Events come from the
// churches' own connected Stripe accounts (event.account).
//
//   checkout.session.completed (paid) / checkout.session.async_payment_succeeded
//       -> record_online_gift_paid(): marks the gift paid and creates the
//          offerings row (payment method "online"). Idempotent.
//   checkout.session.expired / checkout.session.async_payment_failed
//       -> marks the gift failed (nothing was charged).
//   account.updated
//       -> stores whether the church's account can take payments yet.
//   Sessions created by event-payment (metadata.event_registration_id,
//   sql 168) -> mark_event_registration_paid(). Idempotent too.
//
// Deploy: `supabase functions deploy online-giving-webhook --no-verify-jwt`.
// In Stripe: Developers -> Webhooks -> Add endpoint -> "Events on
// connected accounts", URL .../functions/v1/online-giving-webhook, with
// the five events above. Secrets: STRIPE_SECRET_KEY (existing) and
// STRIPE_CONNECT_WEBHOOK_SECRET (the new endpoint's signing secret).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@17?target=deno';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
  const webhookSecret = Deno.env.get('STRIPE_CONNECT_WEBHOOK_SECRET');
  if (!stripeSecretKey || !webhookSecret) {
    return new Response(`Online giving webhook is not configured (${!stripeSecretKey ? 'STRIPE_SECRET_KEY ' : ''}${!webhookSecret ? 'STRIPE_CONNECT_WEBHOOK_SECRET' : ''})`, { status: 500 });
  }
  const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });

  const signature = req.headers.get('stripe-signature');
  const rawBody = await req.text();
  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret);
  } catch (err) {
    return new Response(`Invalid signature: ${err instanceof Error ? err.message : 'unknown'}`, { status: 400 });
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));

  try {
    const obj = event.data.object;
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        if (obj.payment_status !== 'paid') break; // e.g. a bank debit still processing
        // Event registration paid online (event-payment function, sql 168).
        if (obj.metadata?.event_registration_id) {
          const { error } = await admin.rpc('mark_event_registration_paid', {
            p_session_id: obj.id,
            p_amount_cents: typeof obj.amount_total === 'number' ? obj.amount_total : null,
          });
          if (error) throw error;
          break;
        }
        // Only sessions this app created (they carry our gift_id) are recorded.
        if (!obj.metadata?.gift_id) break;
        const { error } = await admin.rpc('record_online_gift_paid', {
          p_session_id: obj.id,
          p_payment_intent_id: typeof obj.payment_intent === 'string' ? obj.payment_intent : obj.payment_intent?.id ?? null,
        });
        if (error) throw error;
        break;
      }
      case 'checkout.session.expired':
      case 'checkout.session.async_payment_failed': {
        await admin.from('online_gifts').update({ status: 'failed' }).eq('stripe_session_id', obj.id).eq('status', 'pending');
        break;
      }
      case 'account.updated': {
        await admin.from('giving_settings')
          .update({ stripe_charges_enabled: !!obj.charges_enabled, updated_at: new Date().toISOString() })
          .eq('stripe_account_id', obj.id);
        break;
      }
      default:
        break;
    }
    return new Response(JSON.stringify({ received: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    // A 500 makes Stripe retry later, which is what we want for a
    // temporary database problem; record_online_gift_paid() is idempotent.
    return new Response(`Webhook handler failed: ${err instanceof Error ? err.message : 'unknown'}`, { status: 500 });
  }
});
