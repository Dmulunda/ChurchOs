// Loads the signed-in user's tenant (church) once per session, and
// exposes it for display purposes — trial banners, feature gating, etc.
// Mirrors departments.js's module-level-cache pattern.
//
// This module does NOT filter or scope any query — real tenant isolation
// is enforced entirely by RESTRICTIVE RLS policies (see sql/saas_platform/).
// A bug here can make the UI show the wrong thing; it cannot leak another
// tenant's data, because the database never returns it in the first place.
import { supabase } from './supabaseClient.js';

const TENANT_COLUMNS = 'id, name, slug, status, trial_ends_at, plan_id, stripe_customer_id, address, logo_url, denomination_id, canceled_reason, plan:plans ( name, price_cents, billing_interval )';

let myTenant = null; // { id, name, slug, status, trial_ends_at, plan_id, stripe_customer_id, address, logo_url, denomination_id, plan } | null
let myHomeTenantId = null; // profiles.tenant_id, always the caller's own tenant -- never the one they're acting as
let myActingTenantId = null; // profiles.acting_as_tenant_id, or null when not acting as an extension

export async function loadMyTenant(userId) {
  const { data: profile } = await supabase
    .from('profiles')
    // logo_url was missing here despite every consumer (app.js's header
    // logo, memberIdCard.js, certificate.js, disciplinaryLetters.js) all
    // reading it off getTenant() -- the upload itself worked fine
    // (tenantLogoModal.js writes tenants.logo_url correctly), it just
    // never made it into this cached object for anything else to read.
    //
    // Two explicit FK hints are required here: profiles now has TWO
    // foreign keys into tenants (tenant_id, and acting_as_tenant_id for
    // Church Extensions -- see 34_church_extensions.sql), so the bare
    // `tenants ( ... )` embed PostgREST used before that migration is
    // now ambiguous and errors.
    //
    // The home_tenant embed is only reliably readable while NOT acting
    // as an extension -- tenants' own RLS policy is `id =
    // current_tenant_id()`, and current_tenant_id() resolves to the
    // ACTING tenant whenever one is set, so home_tenant comes back null
    // in that case (fine: acting_tenant covers branding then). Whether
    // we're acting at all is therefore determined below from the two
    // plain scalar columns on profiles itself, never from these embeds.
    .select(`
      tenant_id, acting_as_tenant_id,
      home_tenant:tenants!profiles_tenant_id_fkey ( ${TENANT_COLUMNS} ),
      acting_tenant:tenants!profiles_acting_as_tenant_id_fkey ( ${TENANT_COLUMNS} )
    `)
    .eq('id', userId)
    .single();

  myHomeTenantId = profile?.tenant_id || null;
  myActingTenantId = profile?.acting_as_tenant_id || null;
  // Branding/org-name display only -- real data access is always scoped
  // server-side by current_tenant_id(), which independently re-verifies
  // denomination_admins membership on every call (see
  // 34_church_extensions.sql). If that membership were ever revoked
  // while acting_as_tenant_id is still set, this could briefly show the
  // wrong name; it can never show the wrong data.
  myTenant = profile?.acting_tenant || profile?.home_tenant || null;
  return myTenant;
}

export function getTenant() {
  return myTenant;
}

export function isActingAsExtension() {
  return !!myActingTenantId && myActingTenantId !== myHomeTenantId;
}

export function getTenantId() {
  return myTenant?.id || null;
}

export function getTenantStatus() {
  return myTenant?.status || null;
}

// Whole days left, rounded up — "expires in 5 minutes" still reads as
// "1 day left" rather than "0 days left" (which would sound already-over).
// null when not on a trial (no trial_ends_at) or already past it.
export function getTrialDaysLeft() {
  if (getTenantStatus() !== 'trial' || !myTenant?.trial_ends_at) return null;
  const ms = new Date(myTenant.trial_ends_at).getTime() - Date.now();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

// Set once a card is attached during the trial (stripe-billing's
// create_checkout_session, trial_end aligned to this same
// trial_ends_at) -- the trial banner uses this to tell them exactly
// when and how much, instead of just nudging them to pick a plan.
// null whenever there's nothing billed yet to report (no plan, or not
// on a trial at all).
export function getPendingTrialCharge() {
  if (getTenantStatus() !== 'trial' || !myTenant?.plan) return null;
  return { name: myTenant.plan.name, priceCents: myTenant.plan.price_cents, billingInterval: myTenant.plan.billing_interval };
}
