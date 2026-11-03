// Stripe Checkout + Billing Portal session creation for a tenant's own
// plan (sql/saas_platform/15_stripe_billing.sql). Uses Stripe's hosted
// pages for both -- no Stripe.js/publishable key anywhere client-side,
// just a redirect out and a redirect back, which fits this app's
// no-build-step vanilla-JS shape. Actually applying a completed
// checkout/cancellation to tenants.status/plan_id happens in
// stripe-webhook, not here -- this function only ever hands back a URL.
//
// Also owns promo codes (sql/saas_platform/75_promo_codes.sql) --
// percentage-discount codes built entirely on Stripe's own Coupon +
// Promotion Code objects (durations/global usage limits/expiry/
// new-customer restriction are all enforced natively by Stripe, per
// the feature's own technical note: connect to Stripe rather than
// reimplement it). The local promo_codes/promo_code_redemptions
// tables exist only for what Stripe has no concept of: which plans a
// code is restricted to (plans.plan_group), and a genuine per-CHURCH
// "already used this code" check (Stripe's own redemption limits are
// global across every customer, not per-customer).
//
// Actions, dispatched by `action` in the request body:
//   Tenant billing (JWT required, caller must be that tenant's own
//   Super Admin):
//     'create_checkout_session' — { plan_key, returnUrl, promo_code? }.
//       404s for any plan still missing a real stripe_price_id. A
//       tenant still inside its own 30-day trial gets the card saved
//       now via Stripe but isn't charged until that same
//       trial_ends_at date (subscription_data.trial_end below).
//     'create_portal_session' — only once the tenant has a
//       stripe_customer_id (i.e. has checked out at least once).
//     'validate_promo_code' — { code }. Checks everything NOT specific
//       to a particular plan (exists/active/date window/usage limit/
//       already-used-by-this-church/new-customers-only) so the
//       checkout UI can show a live discounted price before the
//       admin even picks a plan; the plan-specific check happens for
//       real inside create_checkout_session once a plan IS chosen.
//   Platform (JWT required, caller must be a Site Admin --
//   public.platform_admins, unrelated to any one tenant):
//     'create_promo_code', 'list_promo_codes', 'update_promo_code_status',
//     'update_promo_code' (plan groups/one-use-per-church/new-customers-
//     only/starts-ends dates only -- see updatePromoCode()'s own comment
//     for why the rest of a code can't be edited), 'delete_promo_code'
//     (soft delete -- see sql/saas_platform/123).
//   Cron (no JWT -- shared-secret header, see sql/saas_platform/75):
//     'send_discount_ending_email' — { redemption_id }.
//
// Deploy: `supabase functions deploy stripe-billing`. Needs secrets —
// Dashboard -> Edge Functions -> stripe-billing -> Secrets:
//   STRIPE_SECRET_KEY, CRON_SECRET, RESEND_API_KEY
// (CRON_SECRET/RESEND_API_KEY are only used by send_discount_ending_email;
// CRON_SECRET is the SAME shared value already used by the offering-
// reports function's cron calls, not a new secret of its own.)
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are provided automatically.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@17?target=deno';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// Everything NOT specific to a particular plan -- shared between
// validate_promo_code (no plan chosen yet) and create_checkout_session
// (which additionally checks the plan-restriction below, since only
// it knows which plan was picked). Returns { promo } on success or
// { reason } naming exactly why not, matching the error copy the
// feature spec calls for (translated client-side, not here, so this
// function stays locale-agnostic).
async function loadActivePromoCode(admin, rawCode) {
  const code = (rawCode || '').trim().toUpperCase();
  if (!code) return { reason: 'not_found' };
  const { data: promo } = await admin.from('promo_codes').select('*').eq('code', code).maybeSingle();
  if (!promo || promo.status !== 'active') return { reason: 'not_found' };
  const now = new Date();
  if (new Date(promo.starts_at) > now) return { reason: 'not_found' }; // not live yet -- indistinguishable from "doesn't exist" to the church
  if (promo.ends_at && new Date(promo.ends_at) < now) return { reason: 'expired' };
  if (promo.usage_limit) {
    const { count } = await admin.from('promo_code_redemptions').select('id', { count: 'exact', head: true }).eq('promo_code_id', promo.id);
    if ((count || 0) >= promo.usage_limit) return { reason: 'usage_limit' };
  }
  return { promo };
}

// Per-tenant checks -- needs which church is asking, so it's a
// separate step from loadActivePromoCode above.
async function checkTenantEligibility(admin, promo, tenant) {
  if (promo.one_use_per_church) {
    const { count } = await admin.from('promo_code_redemptions').select('id', { count: 'exact', head: true }).eq('promo_code_id', promo.id).eq('tenant_id', tenant.id);
    if ((count || 0) > 0) return { reason: 'already_used' };
  }
  // Stripe's own restrictions.first_time_transaction (set on the
  // Promotion Code at creation time) enforces this for real at actual
  // checkout -- this is just a friendlier up-front check using the
  // same signal (never completed a real Stripe subscription before)
  // so the UI can say so immediately instead of only failing at
  // Stripe's end.
  if (promo.new_customers_only && tenant.stripe_subscription_id) return { reason: 'new_customers_only' };
  return {};
}

async function callerIsSiteAdmin(admin, callerId) {
  const { data } = await admin.from('platform_admins').select('user_id').eq('user_id', callerId).maybeSingle();
  return !!data;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    );

    const body = await req.json();
    const { action } = body;

    // ---- Cron-only action: shared-secret auth, no signed-in user ----
    if (action === 'send_discount_ending_email') {
      const cronSecret = Deno.env.get('CRON_SECRET');
      if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
        return json({ error: 'Unauthorized' }, 401);
      }
      return await sendDiscountEndingEmail(admin, body.redemption_id);
    }

    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    if (!jwt) return json({ error: 'Missing authorization' }, 401);

    const { data: { user: caller }, error: callerError } = await admin.auth.getUser(jwt);
    if (callerError || !caller) return json({ error: 'Invalid session' }, 401);

    // ---- Platform actions: Site Admin only, unrelated to any tenant ----
    if (action === 'create_promo_code' || action === 'list_promo_codes' || action === 'update_promo_code_status'
      || action === 'list_promo_code_redemptions' || action === 'update_promo_code' || action === 'delete_promo_code') {
      if (!(await callerIsSiteAdmin(admin, caller.id))) return json({ error: 'Only a Site Admin can manage promo codes' }, 403);

      const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
      if (!stripeSecretKey) return json({ error: 'Stripe is not configured on this function (STRIPE_SECRET_KEY)' }, 500);
      const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });

      if (action === 'create_promo_code') return await createPromoCode(admin, stripe, caller.id, body);
      if (action === 'list_promo_codes') return await listPromoCodes(admin);
      if (action === 'list_promo_code_redemptions') return await listPromoCodeRedemptions(admin, body.promo_code_id);
      if (action === 'update_promo_code') return await updatePromoCode(admin, body);
      if (action === 'delete_promo_code') return await deletePromoCode(admin, stripe, body);
      return await updatePromoCodeStatus(admin, stripe, body);
    }

    // ---- Tenant billing actions: caller must be THAT tenant's own Super Admin ----
    const { data: callerProfile } = await admin
      .from('profiles')
      .select('tenant_id, global_role')
      .eq('id', caller.id)
      .single();
    if (!callerProfile || callerProfile.global_role !== 'super_admin') {
      return json({ error: 'Only a Super Admin can manage billing' }, 403);
    }

    const { data: tenant } = await admin
      .from('tenants')
      .select('id, name, stripe_customer_id, stripe_subscription_id, status, trial_ends_at')
      .eq('id', callerProfile.tenant_id)
      .single();
    if (!tenant) return json({ error: 'Tenant not found' }, 404);

    if (action === 'validate_promo_code') {
      const { promo, reason } = await loadActivePromoCode(admin, body.code);
      if (!promo) return json({ valid: false, reason });
      const tenantCheck = await checkTenantEligibility(admin, promo, tenant);
      if (tenantCheck.reason) return json({ valid: false, reason: tenantCheck.reason });
      return json({
        valid: true,
        discountPercent: promo.discount_percent,
        appliesToPlanGroups: promo.applies_to_plan_groups,
        duration: promo.duration,
        durationInMonths: promo.duration_in_months,
      });
    }

    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeSecretKey) return json({ error: 'Stripe is not configured on this function (STRIPE_SECRET_KEY)' }, 500);
    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });

    const { plan_key, returnUrl: clientReturnUrl, promo_code } = body;

    // clientReturnUrl (plansModal.js's redirectTo()) is the app's own
    // window.location.origin+pathname -- authoritative, since a
    // cross-origin fetch's Origin/Referer headers are reduced to
    // origin-only by the browser's default referrer policy, which this
    // function has no way to recover a GitHub-Pages subpath from (e.g.
    // https://dmulunda.github.io/ChurchOs/app.html -> headers only ever
    // show https://dmulunda.github.io). The header-based guess below is
    // just a defensive fallback for an older cached client bundle.
    function buildReturnUrl(checkoutParam = null) {
      if (clientReturnUrl) {
        try {
          const url = new URL(clientReturnUrl);
          url.search = checkoutParam ? `?checkout=${checkoutParam}` : '';
          url.hash = '';
          return url.toString();
        } catch { /* fall through */ }
      }
      const origin = req.headers.get('origin') || new URL(req.url).origin;
      return checkoutParam ? `${origin}/?checkout=${checkoutParam}` : `${origin}/`;
    }

    if (action === 'create_checkout_session') {
      if (!plan_key) return json({ error: 'plan_key is required' }, 400);

      const { data: plan } = await admin
        .from('plans')
        .select('id, stripe_price_id, plan_group, price_cents')
        .eq('key', plan_key)
        .single();
      if (!plan || !plan.stripe_price_id) return json({ error: 'This plan is not available for checkout' }, 404);

      // Re-validated here from scratch even if the client already
      // called validate_promo_code -- that earlier check never saw
      // which plan would be picked, and nothing client-side is trusted
      // for something that changes real money charged.
      let appliedPromo = null;
      let discountedPriceCents = null;
      if (promo_code) {
        const { promo, reason } = await loadActivePromoCode(admin, promo_code);
        if (!promo) return json({ error: 'Invalid promo code', reason }, 400);
        const tenantCheck = await checkTenantEligibility(admin, promo, tenant);
        if (tenantCheck.reason) return json({ error: 'Invalid promo code', reason: tenantCheck.reason }, 400);
        if (promo.applies_to_plan_groups && !promo.applies_to_plan_groups.includes(plan.plan_group)) {
          return json({ error: 'Invalid promo code', reason: 'plan_not_allowed' }, 400);
        }
        appliedPromo = promo;
        discountedPriceCents = Math.round(plan.price_cents * (1 - promo.discount_percent / 100));
      }

      let stripeCustomerId = tenant.stripe_customer_id;
      if (!stripeCustomerId) {
        const customer = await stripe.customers.create({
          name: tenant.name,
          metadata: { tenant_id: tenant.id },
        });
        stripeCustomerId = customer.id;
        await admin.rpc('set_tenant_stripe_customer', { p_tenant_id: tenant.id, p_stripe_customer_id: stripeCustomerId });
      }

      // A tenant still within its own 30-day trial gets the card saved
      // now but isn't actually charged until that SAME original date --
      // trial_end (an exact timestamp) rather than trial_period_days,
      // specifically so this doesn't restart the clock for someone who
      // waits until day 20 of their trial to finally check out. Not
      // applied at all once the trial's over (e.g. re-subscribing after
      // a cancellation) -- immediate billing, same as today. Stripe
      // itself additionally requires trial_end to be at least 2 days
      // out ("The trial_end date has to be at least 2 days in the
      // future") -- a trial ending sooner than that (checking out in
      // its final 48 hours) falls through to immediate billing instead
      // of passing a trial_end Stripe would just reject outright.
      const trialEndsAt = tenant.status === 'trial' && tenant.trial_ends_at ? new Date(tenant.trial_ends_at) : null;
      const MIN_STRIPE_TRIAL_END_MS = 2 * 24 * 60 * 60 * 1000;
      const subscriptionData = trialEndsAt && trialEndsAt.getTime() > Date.now() + MIN_STRIPE_TRIAL_END_MS
        ? { trial_end: Math.floor(trialEndsAt.getTime() / 1000) }
        : undefined;

      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: stripeCustomerId,
        // Stripe Tax: Checkout collects/saves the customer's billing
        // address (customer_update.address is required by Stripe's API
        // whenever automatic_tax is enabled for an existing Customer
        // object, since ours is created above with no address yet) and
        // calculates the right tax for their jurisdiction live.
        automatic_tax: { enabled: true },
        customer_update: { address: 'auto', name: 'auto' },
        line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
        ...(subscriptionData ? { subscription_data: subscriptionData } : {}),
        ...(appliedPromo ? { discounts: [{ promotion_code: appliedPromo.stripe_promotion_code_id }] } : {}),
        // Read back by stripe-webhook on checkout.session.completed to
        // record the redemption -- only once payment actually goes
        // through, never for an abandoned checkout, and without having
        // to parse Stripe's own discounts/line-item breakdown shape.
        ...(appliedPromo ? {
          metadata: {
            promo_code_id: appliedPromo.id,
            tenant_id: tenant.id,
            discount_percent: String(appliedPromo.discount_percent),
            duration: appliedPromo.duration,
            duration_in_months: appliedPromo.duration_in_months != null ? String(appliedPromo.duration_in_months) : '',
            original_price_cents: String(plan.price_cents),
            discounted_price_cents: String(discountedPriceCents),
          },
        } : {}),
        success_url: buildReturnUrl('success'),
        cancel_url: buildReturnUrl('cancel'),
      });

      return json({ url: session.url });
    }

    if (action === 'create_portal_session') {
      if (!tenant.stripe_customer_id) return json({ error: 'No billing account yet -- upgrade to a paid plan first' }, 404);

      const session = await stripe.billingPortal.sessions.create({
        customer: tenant.stripe_customer_id,
        return_url: buildReturnUrl(),
      });

      return json({ url: session.url });
    }

    return json({ error: 'Unrecognized action' }, 400);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, 500);
  }
});

// ---- Platform: promo code management (Site Admin only) ----

function toUnixSeconds(isoString) {
  return isoString ? Math.floor(new Date(isoString).getTime() / 1000) : undefined;
}

async function createPromoCode(admin, stripe, callerId, body) {
  const {
    code, discountPercent, appliesToPlanGroups, duration, durationInMonths,
    startsAt, endsAt, usageLimit, oneUsePerChurch, newCustomersOnly,
  } = body;

  const normalizedCode = (code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{3,30}$/.test(normalizedCode)) {
    return json({ error: 'Code must be 3-30 letters and numbers only' }, 400);
  }
  const percent = Number(discountPercent);
  if (!Number.isInteger(percent) || percent < 1 || percent > 100) {
    return json({ error: 'Discount must be a whole number from 1 to 100' }, 400);
  }
  if (!['once', 'repeating', 'forever'].includes(duration)) {
    return json({ error: 'Invalid duration' }, 400);
  }
  if (duration === 'repeating' && !(Number(durationInMonths) > 0)) {
    return json({ error: 'Number of months is required for a repeating discount' }, 400);
  }

  // Stripe owns the real discount definition (percent/duration) and
  // the real redemption limit/expiry -- both native Coupon/Promotion
  // Code fields, per the feature's own technical note. The Promotion
  // Code (not the Coupon) is the customer-facing object actually
  // redeemed at Checkout, so the usage limit/expiry/new-customer
  // restriction all live there.
  const coupon = await stripe.coupons.create({
    name: normalizedCode,
    percent_off: percent,
    duration,
    ...(duration === 'repeating' ? { duration_in_months: Number(durationInMonths) } : {}),
  });

  const promotionCode = await stripe.promotionCodes.create({
    coupon: coupon.id,
    code: normalizedCode,
    active: true,
    ...(usageLimit ? { max_redemptions: Number(usageLimit) } : {}),
    ...(endsAt ? { expires_at: toUnixSeconds(endsAt) } : {}),
    ...(newCustomersOnly ? { restrictions: { first_time_transaction: true } } : {}),
  });

  const { data: row, error } = await admin.from('promo_codes').insert({
    code: normalizedCode,
    discount_percent: percent,
    applies_to_plan_groups: Array.isArray(appliesToPlanGroups) && appliesToPlanGroups.length > 0 ? appliesToPlanGroups : null,
    duration,
    duration_in_months: duration === 'repeating' ? Number(durationInMonths) : null,
    starts_at: startsAt || new Date().toISOString(),
    ends_at: endsAt || null,
    usage_limit: usageLimit ? Number(usageLimit) : null,
    one_use_per_church: oneUsePerChurch !== false,
    new_customers_only: !!newCustomersOnly,
    stripe_coupon_id: coupon.id,
    stripe_promotion_code_id: promotionCode.id,
    created_by: callerId,
  }).select().single();

  if (error) return json({ error: error.message }, 500);
  return json({ promoCode: row });
}

async function listPromoCodes(admin) {
  const { data: codes, error } = await admin.from('promo_codes').select('*').is('deleted_at', null).order('created_at', { ascending: false });
  if (error) return json({ error: error.message }, 500);

  const { data: redemptions } = await admin.from('promo_code_redemptions').select('promo_code_id, original_price_cents, discounted_price_cents');
  const statsByCode = new Map();
  (redemptions || []).forEach((r) => {
    const stats = statsByCode.get(r.promo_code_id) || { count: 0, totalDiscountCents: 0 };
    stats.count += 1;
    stats.totalDiscountCents += (r.original_price_cents - r.discounted_price_cents);
    statsByCode.set(r.promo_code_id, stats);
  });

  const withStats = (codes || []).map((c) => ({
    ...c,
    redemptionCount: statsByCode.get(c.id)?.count || 0,
    totalDiscountCents: statsByCode.get(c.id)?.totalDiscountCents || 0,
    usesLeft: c.usage_limit != null ? Math.max(0, c.usage_limit - (statsByCode.get(c.id)?.count || 0)) : null,
  }));

  return json({ promoCodes: withStats });
}

async function listPromoCodeRedemptions(admin, promoCodeId) {
  if (!promoCodeId) return json({ error: 'promo_code_id is required' }, 400);
  const { data, error } = await admin
    .from('promo_code_redemptions')
    .select('id, tenant_id, redeemed_at, original_price_cents, discounted_price_cents, tenants ( name )')
    .eq('promo_code_id', promoCodeId)
    .order('redeemed_at', { ascending: false });
  if (error) return json({ error: error.message }, 500);
  return json({ redemptions: data || [] });
}

async function updatePromoCodeStatus(admin, stripe, body) {
  const { promo_code_id, status } = body;
  if (!['active', 'paused'].includes(status)) return json({ error: 'Invalid status' }, 400);

  const { data: promo } = await admin.from('promo_codes').select('stripe_promotion_code_id').eq('id', promo_code_id).maybeSingle();
  if (!promo) return json({ error: 'Promo code not found' }, 404);

  await stripe.promotionCodes.update(promo.stripe_promotion_code_id, { active: status === 'active' });
  const { error } = await admin.from('promo_codes').update({ status, updated_at: new Date().toISOString() }).eq('id', promo_code_id);
  if (error) return json({ error: error.message }, 500);
  return json({ success: true });
}

// Only fields Stripe has no immutable Coupon/Promotion Code equivalent
// for -- code, discount_percent, duration/duration_in_months, and
// usage_limit (Stripe's max_redemptions) can't be changed on an
// existing Coupon/Promotion Code via the API at all, so those stay
// fixed for this code's lifetime (delete + create a new one instead).
// applies_to_plan_groups/one_use_per_church are purely local concepts
// Stripe doesn't model; starts_at/ends_at are this app's own gate in
// loadActivePromoCode/checkTenantEligibility above, checked before
// Stripe is ever reached -- none of these five need a Stripe call.
async function updatePromoCode(admin, body) {
  const { promo_code_id, appliesToPlanGroups, oneUsePerChurch, newCustomersOnly, startsAt, endsAt } = body;
  if (!promo_code_id) return json({ error: 'promo_code_id is required' }, 400);

  const { error } = await admin.from('promo_codes').update({
    applies_to_plan_groups: Array.isArray(appliesToPlanGroups) && appliesToPlanGroups.length > 0 ? appliesToPlanGroups : null,
    one_use_per_church: oneUsePerChurch !== false,
    new_customers_only: !!newCustomersOnly,
    starts_at: startsAt || new Date().toISOString(),
    ends_at: endsAt || null,
    updated_at: new Date().toISOString(),
  }).eq('id', promo_code_id);
  if (error) return json({ error: error.message }, 500);
  return json({ success: true });
}

// Soft delete -- see sql/saas_platform/123_promo_code_soft_delete.sql's
// header for why this isn't a real row delete. Deactivating the
// Promotion Code in Stripe (same call as Pause) is what actually
// stops it from being redeemable ever again; deleted_at just hides it
// from the admin's active list from here on.
async function deletePromoCode(admin, stripe, body) {
  const { promo_code_id } = body;
  if (!promo_code_id) return json({ error: 'promo_code_id is required' }, 400);

  const { data: promo } = await admin.from('promo_codes').select('stripe_promotion_code_id').eq('id', promo_code_id).maybeSingle();
  if (!promo) return json({ error: 'Promo code not found' }, 404);

  await stripe.promotionCodes.update(promo.stripe_promotion_code_id, { active: false });
  const { error } = await admin.from('promo_codes').update({ status: 'paused', deleted_at: new Date().toISOString() }).eq('id', promo_code_id);
  if (error) return json({ error: error.message }, 500);
  return json({ success: true });
}

// ---- Cron: discount-ending-soon reminder email ----

async function sendDiscountEndingEmail(admin, redemptionId) {
  if (!redemptionId) return json({ error: 'redemption_id is required' }, 400);

  const { data: redemption } = await admin
    .from('promo_code_redemptions')
    .select('id, tenant_id, discount_percent, redeemed_at, duration_in_months, promo_codes ( code ), tenants ( name, email )')
    .eq('id', redemptionId)
    .maybeSingle();
  if (!redemption) return json({ error: 'Redemption not found' }, 404);

  const toEmail = redemption.tenants?.email;
  if (!toEmail) return json({ skipped: 'tenant has no contact email on file' });

  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) return json({ error: 'RESEND_API_KEY is not configured on this function' }, 500);
  const fromAddress = Deno.env.get('BOOKING_EMAIL_FROM') || 'onboarding@resend.dev';

  const endsOn = new Date(redemption.redeemed_at);
  endsOn.setMonth(endsOn.getMonth() + redemption.duration_in_months);

  const resendResp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: fromAddress,
      to: [toEmail],
      subject: `Your ${redemption.discount_percent}% discount ends soon`,
      html: `<p>Hi ${escapeHtml(redemption.tenants?.name || '')},</p>
        <p>Your ${redemption.discount_percent}% discount from promo code <strong>${escapeHtml(redemption.promo_codes?.code || '')}</strong> ends on ${endsOn.toLocaleDateString()}. After that date, your subscription will return to its normal price automatically.</p>`,
    }),
  });

  if (!resendResp.ok) {
    const errText = await resendResp.text();
    return json({ error: `Resend error: ${errText}` }, 502);
  }

  await admin.from('promo_code_redemptions').update({ reminder_emailed_at: new Date().toISOString() }).eq('id', redemptionId);
  return json({ success: true });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
