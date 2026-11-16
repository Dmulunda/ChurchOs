// Online payment for priced events (sql/saas_platform/168).
//
// Money goes to the CHURCH's own Stripe account -- the same Stripe Connect
// account set up for online giving (giving_settings, sql 144). No card data
// touches this app (Stripe hosted Checkout). No login needed: the public
// event page calls it right after registering.
//
// POST { action: 'availability', registration_id | tenant_slug } -> { available }
// POST { action: 'checkout', registration_id, returnUrl } -> { url }
//   amount = event price x party size, in the event's church currency (CAD
//   unless giving_settings says otherwise). Already-paid, waived, cancelled
//   or free registrations are refused.
// Paid status is set by online-giving-webhook (metadata.event_registration_id)
// via mark_event_registration_paid(), never here.
//
// Deploy: `supabase functions deploy event-payment --no-verify-jwt`.
// Secrets: STRIPE_SECRET_KEY (existing). Return URLs must be on an origin
// listed in GIVING_RETURN_ORIGINS (same list as online giving).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@17?target=deno';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

function safeReturnUrl(raw: string) {
  const allowed = (Deno.env.get('GIVING_RETURN_ORIGINS') || 'https://www.churchonpoint.com')
    .split(',').map((s) => s.trim()).filter(Boolean);
  try {
    const url = new URL(raw);
    return allowed.includes(url.origin) ? url : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const body = await req.json().catch(() => ({}));
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');

    const settingsFor = async (tenantId: string) => {
      const { data } = await admin.from('giving_settings').select('*').eq('tenant_id', tenantId).maybeSingle();
      return data && data.stripe_charges_enabled && data.stripe_account_id ? data : null;
    };

    if (body.action === 'availability') {
      if (!stripeSecretKey) return json({ available: false });
      let tenantId: string | null = null;
      if (body.registration_id) {
        const { data: reg } = await admin.from('event_registrations').select('tenant_id').eq('id', String(body.registration_id)).maybeSingle();
        tenantId = reg?.tenant_id ?? null;
      } else {
        const { data: tenant } = await admin.from('tenants').select('id, deleted_at').eq('slug', String(body.tenant_slug || '')).maybeSingle();
        tenantId = tenant && !tenant.deleted_at ? tenant.id : null;
      }
      if (!tenantId) return json({ available: false });
      return json({ available: !!(await settingsFor(tenantId)) });
    }

    if (body.action === 'checkout') {
      if (!stripeSecretKey) return json({ error: 'payments_not_configured' }, 503);
      const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });
      const returnUrl = safeReturnUrl(String(body.returnUrl || ''));
      if (!returnUrl) return json({ error: 'returnUrl is not an allowed address' }, 400);

      const { data: reg } = await admin.from('event_registrations')
        .select('id, tenant_id, full_name, email, status, payment_status, party_size, event:events ( id, title, price_cents, status, tenants ( name ) )')
        .eq('id', String(body.registration_id || '')).maybeSingle();
      if (!reg) return json({ error: 'registration_not_found' }, 404);
      if (reg.status === 'cancelled' || reg.event?.status !== 'active') return json({ error: 'event_not_active' }, 409);
      if (reg.payment_status !== 'pending' || !reg.event?.price_cents) return json({ error: 'nothing_to_pay' }, 409);

      const settings = await settingsFor(reg.tenant_id);
      if (!settings) return json({ error: 'payments_not_available' }, 409);
      const currency = String(settings.default_currency || 'CAD').toLowerCase();
      const quantity = Math.max(1, reg.party_size || 1);

      const success = new URL(returnUrl.toString());
      success.searchParams.set('payment', 'thanks');
      const cancel = new URL(returnUrl.toString());
      cancel.searchParams.set('payment', 'cancelled');

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [{
          quantity,
          price_data: {
            currency,
            unit_amount: reg.event.price_cents,
            product_data: { name: `${reg.event.title} — ${reg.event.tenants?.name ?? ''}`.slice(0, 250) },
          },
        }],
        customer_email: reg.email || undefined,
        success_url: success.toString(),
        cancel_url: cancel.toString(),
        metadata: { event_registration_id: reg.id, tenant_id: reg.tenant_id },
        payment_intent_data: { metadata: { event_registration_id: reg.id, tenant_id: reg.tenant_id } },
      }, { stripeAccount: settings.stripe_account_id });

      await admin.from('event_registrations').update({ stripe_session_id: session.id }).eq('id', reg.id);
      return json({ url: session.url });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (err) {
    console.error('event-payment error:', err);
    return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, 500);
  }
});
