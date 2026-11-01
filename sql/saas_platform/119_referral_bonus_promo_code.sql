-- Points the referral bonus (118_referral_program.sql) at a real promo
-- code created the normal way (Site Admin -> Promo Codes ->
-- stripe-billing's create_promo_code action, 75_promo_codes.sql), instead
-- of stripe-webhook self-provisioning its own one-off Stripe Coupon with
-- a hardcoded id. One promo code can be flagged as THE referral bonus;
-- the webhook then just reads its stripe_coupon_id and applies it to the
-- referrer's subscription -- the coupon, its duration, and its discount
-- percent are all managed from the same screen every other promo code is.
alter table public.promo_codes
  add column if not exists is_referral_bonus boolean not null default false;

-- At most one row can be flagged at a time -- a partial unique index
-- (only rows where the flag is true are indexed) rather than a check
-- constraint, since uniqueness across rows can't be expressed as a
-- per-row check.
create unique index if not exists promo_codes_referral_bonus_singleton
  on public.promo_codes (is_referral_bonus) where is_referral_bonus;

-- Plain SECURITY DEFINER RPC writing directly to a tenant-independent
-- platform table, gated on is_site_admin() -- same pattern as
-- cancel_tenant_subscription/soft_delete_tenant, not the edge-function +
-- site_admin_access_log pattern, since this needs no auth.admin.* call
-- and the row itself (is_referral_bonus = true) is the audit trail.
-- Flipping it to a different row atomically un-flags the old one, so the
-- caller never needs to clear anything first.
create or replace function public.set_referral_bonus_promo_code(p_promo_code_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_site_admin() then
    raise exception 'Only Site Admins can set the referral bonus promo code';
  end if;

  if not exists (select 1 from public.promo_codes where id = p_promo_code_id) then
    raise exception 'Promo code not found';
  end if;

  update public.promo_codes set is_referral_bonus = false where is_referral_bonus;
  update public.promo_codes set is_referral_bonus = true, updated_at = now() where id = p_promo_code_id;
end;
$$;

revoke all on function public.set_referral_bonus_promo_code(uuid) from public;
grant execute on function public.set_referral_bonus_promo_code(uuid) to authenticated;
