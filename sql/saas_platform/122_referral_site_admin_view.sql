-- Site Admin visibility into the church-to-church referral program
-- (sql/saas_platform/118_referral_program.sql): which church referred
-- which, its status (pending/qualified/applied -- "applied" is the only
-- one where the referrer actually got their bonus), and the dates
-- along the way. Same narrow-RPC pattern as every other cross-tenant
-- Site Admin lookup (e.g. list_all_tenants_for_site_admin,
-- sql/saas_platform/115) rather than widening referrals' own RLS
-- policy (which only lets a tenant see rows it's a party to).
create or replace function public.list_referrals_for_site_admin()
returns table(
  id uuid,
  referrer_tenant_id uuid, referrer_name text,
  referred_tenant_id uuid, referred_name text,
  status text, bonus_percentage numeric,
  created_at timestamptz, qualified_at timestamptz, applied_at timestamptz
)
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_site_admin() then
    raise exception 'Only a Site Admin can view referrals';
  end if;

  return query
  select r.id, r.referrer_tenant_id, rt.name, r.referred_tenant_id, rd.name,
         r.status, r.bonus_percentage, r.created_at, r.qualified_at, r.applied_at
  from public.referrals r
  join public.tenants rt on rt.id = r.referrer_tenant_id
  join public.tenants rd on rd.id = r.referred_tenant_id
  order by r.created_at desc;
end;
$$;

revoke all on function public.list_referrals_for_site_admin() from public;
grant execute on function public.list_referrals_for_site_admin() to authenticated;
