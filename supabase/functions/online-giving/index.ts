// Online giving (sql/saas_platform/144_online_giving.sql).
//
// Money goes to the CHURCH's own Stripe account (Stripe Connect,
// Standard accounts, direct charges) -- ChurchOnPoint never holds it and
// takes no fee. Card payments use Stripe's hosted Checkout page: no card
// data ever touches this app.
//
// Actions, dispatched by `action` in the request body:
//   Church admin (JWT required, caller must be a Super Admin or a Finance
//   admin of their own church -- is_super_admin()/can_delete_offerings()):
//     'connect_link'   -- creates the church's Stripe account the first
//                         time, then returns a Stripe onboarding link.
//                         { returnUrl }
//     'refresh_status' -- re-reads the account from Stripe and stores
//                         whether it can take payments yet.
//   Anyone (no login needed; a signed-in member's JWT is optional and,
//   when present, links the gift to them so it counts on their tax
//   receipt):
//     'create_checkout' -- { tenant_slug, amount_cents, currency,
//                            offering_type, donor_name, donor_email?,
//                            returnUrl } -> { url } of Stripe Checkout.
//
// Paid gifts are recorded by online-giving-webhook, never here.
//
// Deploy: `supabase functions deploy online-giving --no-verify-jwt`
// (the giving page is public). Secrets: STRIPE_SECRET_KEY (the existing
// platform key; Stripe Connect must be enabled on that Stripe account).
// Optional: GIVING_RETURN_ORIGINS, a comma-separated list of origins
// allowed as return URLs (default https://www.churchonpoint.com).
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY are provided
// automatically.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@17?target=deno';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const OFFERING_TYPES = ['tithe', 'general', 'sacrifice', 'construction', 'other'];
const CURRENCIES = ['CAD', 'USD', 'EUR'];
const TYPE_LABELS = {
  tithe: 'Tithe / Dîme',
  general: 'Offering / Offrande',
  sacrifice: 'Sacrifice',
  construction: 'Construction',
  other: 'Gift / Don',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// Only send people back to our own site -- never to an arbitrary URL a
// caller supplies (open-redirect protection). An address on another origin
// (for example a local copy of the app at http://localhost) is rebuilt on
// the first allowed origin with the same path and query, so it still works.
function safeReturnUrl(raw) {
  const allowed = (Deno.env.get('GIVING_RETURN_ORIGINS') || 'https://www.churchonpoint.com')
    .split(',').map((s) => s.trim()).filter(Boolean);
  try {
    const url = new URL(raw);
    if (allowed.includes(url.origin)) return url;
    return new URL(url.pathname + url.search, allowed[0]);
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeSecretKey) return json({ error: 'Online giving is not configured yet (STRIPE_SECRET_KEY)' }, 503);
    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });

    const admin = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
    const body = await req.json();
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');

    // Resolve the signed-in user, if any. The anon key is also sent as a
    // Bearer token by supabase-js on public pages, so "no user" is normal.
    let caller = null;
    let callerProfile = null;
    if (jwt) {
      const { data } = await admin.auth.getUser(jwt);
      if (data?.user) {
        caller = data.user;
        const { data: p } = await admin.from('profiles').select('id, tenant_id, full_name, removed_at').eq('id', caller.id).maybeSingle();
        callerProfile = p && !p.removed_at ? p : null;
      }
    }

    if (body.action === 'connect_link' || body.action === 'refresh_status') {
      if (!caller || !callerProfile) return json({ error: 'Sign in required' }, 401);
      // Permission checks run as the caller (their own JWT), so they use
      // exactly the same rules as the database's own RLS helpers.
      const asCaller = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_ANON_KEY'), {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
      });
      const [{ data: isSuper }, { data: isFinanceAdmin }] = await Promise.all([
        asCaller.rpc('is_super_admin'),
        asCaller.rpc('can_delete_offerings'),
      ]);
      if (!isSuper && !isFinanceAdmin) return json({ error: 'Only a Super Admin or a Finance admin can set up online giving' }, 403);

      const tenantId = callerProfile.tenant_id;
      const { data: tenant } = await admin.from('tenants').select('id, name, email').eq('id', tenantId).single();
      let { data: settings } = await admin.from('giving_settings').select('*').eq('tenant_id', tenantId).maybeSingle();
      if (!settings) {
        const { data: created, error } = await admin.from('giving_settings').insert({ tenant_id: tenantId }).select('*').single();
        if (error) throw error;
        settings = created;
      }

      if (body.action === 'connect_link') {
        const returnUrl = safeReturnUrl(body.returnUrl);
        if (!returnUrl) return json({ error: 'returnUrl is not an allowed address' }, 400);
        let accountId = settings.stripe_account_id;
        if (!accountId) {
          const account = await stripe.accounts.create({
            type: 'standard',
            email: tenant.email || caller.email || undefined,
            business_profile: { name: tenant.name },
            metadata: { tenant_id: tenantId },
          });
          accountId = account.id;
          await admin.from('giving_settings').update({ stripe_account_id: accountId, updated_at: new Date().toISOString() }).eq('tenant_id', tenantId);
        }
        returnUrl.searchParams.set('giving', 'connected');
        const link = await stripe.accountLinks.create({
          account: accountId,
          type: 'account_onboarding',
          refresh_url: returnUrl.toString(),
          return_url: returnUrl.toString(),
        });
        return json({ url: link.url });
      }

      // refresh_status
      if (!settings.stripe_account_id) return json({ connected: false, charges_enabled: false });
      const account = await stripe.accounts.retrieve(settings.stripe_account_id);
      await admin.from('giving_settings')
        .update({ stripe_charges_enabled: !!account.charges_enabled, updated_at: new Date().toISOString() })
        .eq('tenant_id', tenantId);
      return json({ connected: true, charges_enabled: !!account.charges_enabled, details_submitted: !!account.details_submitted });
    }

    if (body.action === 'create_checkout') {
      const amountCents = Math.round(Number(body.amount_cents));
      const currency = String(body.currency || '').toUpperCase();
      const offeringType = String(body.offering_type || '');
      const donorName = String(body.donor_name || '').trim().slice(0, 200);
      const donorEmail = String(body.donor_email || '').trim().slice(0, 200) || null;
      if (!Number.isFinite(amountCents) || amountCents < 100 || amountCents > 5000000) return json({ error: 'invalid_amount' }, 400);
      if (!CURRENCIES.includes(currency)) return json({ error: 'invalid_currency' }, 400);
      if (!OFFERING_TYPES.includes(offeringType)) return json({ error: 'invalid_type' }, 400);
      if (!donorName && !callerProfile) return json({ error: 'name_required' }, 400);
      const returnUrl = safeReturnUrl(body.returnUrl);
      if (!returnUrl) return json({ error: 'returnUrl is not an allowed address' }, 400);

      const { data: tenant } = await admin.from('tenants').select('id, name, slug, deleted_at').eq('slug', String(body.tenant_slug || '')).maybeSingle();
      if (!tenant || tenant.deleted_at) return json({ error: 'church_not_found' }, 404);
      const { data: settings } = await admin.from('giving_settings').select('*').eq('tenant_id', tenant.id).maybeSingle();
      if (!settings?.enabled || !settings.stripe_charges_enabled || !settings.stripe_account_id) return json({ error: 'giving_not_available' }, 409);

      // A signed-in member giving to their OWN church is linked to the
      // gift (tax receipt). Signed in to another church: treated as a guest.
      const linkedUserId = callerProfile && callerProfile.tenant_id === tenant.id ? callerProfile.id : null;
      const finalName = linkedUserId ? (callerProfile.full_name || donorName) : donorName;
      const finalEmail = donorEmail || (linkedUserId ? caller.email : null);

      const { data: gift, error: giftError } = await admin.from('online_gifts').insert({
        tenant_id: tenant.id,
        user_id: linkedUserId,
        donor_name: finalName,
        donor_email: finalEmail,
        amount_cents: amountCents,
        currency,
        offering_type: offeringType,
      }).select('id').single();
      if (giftError) throw giftError;

      const success = new URL(returnUrl.toString());
      success.searchParams.set('gift', 'thanks');
      const cancel = new URL(returnUrl.toString());
      cancel.searchParams.set('gift', 'cancelled');

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [{
          quantity: 1,
          price_data: {
            currency: currency.toLowerCase(),
            unit_amount: amountCents,
            product_data: { name: `${TYPE_LABELS[offeringType]} — ${tenant.name}` },
          },
        }],
        customer_email: finalEmail || undefined,
        submit_type: 'donate',
        success_url: success.toString(),
        cancel_url: cancel.toString(),
        metadata: { gift_id: gift.id, tenant_id: tenant.id },
        payment_intent_data: { metadata: { gift_id: gift.id, tenant_id: tenant.id } },
      }, { stripeAccount: settings.stripe_account_id });

      await admin.from('online_gifts').update({ stripe_session_id: session.id }).eq('id', gift.id);
      return json({ url: session.url });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, 500);
  }
});
