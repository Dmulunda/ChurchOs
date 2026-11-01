-- Site Admin per-tenant feature overrides -- lets a Site Admin force a
-- specific feature on or off for one church regardless of its plan tier
-- (e.g. grant Projection to a Basic-tier church as a one-off, or revoke a
-- feature from a Premium church). Generic across the whole feature catalog
-- rather than hardcoded to one key -- every existing has_feature() call site
-- (9 RLS policies/triggers across vpd_academy, all_departments,
-- create_departments, flyers, projection) gets this for free.
--
-- An override row always wins over the plan/trial-based default:
--   granted = true  -> feature forced ON, even off-plan
--   granted = false -> feature forced OFF, even if the plan includes it
--   no row          -> unchanged plan/trial logic (today's behavior)

begin;

create table if not exists public.tenant_feature_overrides (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  feature_key text not null references public.features(key) on delete cascade,
  granted boolean not null,
  set_by uuid references public.profiles(id) on delete set null,
  set_at timestamptz not null default now(),
  primary key (tenant_id, feature_key)
);

alter table public.tenant_feature_overrides enable row level security;

-- Readable by the tenant itself (so a future "why do I have this" UI could
-- show it) and by Site Admins (for the Churches-tab Features UI). Writable
-- only through the SECURITY DEFINER RPCs below, which re-check is_site_admin()
-- themselves -- no direct INSERT/UPDATE/DELETE policy granted.
create policy "tenant_feature_overrides readable by own tenant or site admin" on public.tenant_feature_overrides
  for select to authenticated
  using (tenant_id = public.current_tenant_id() or public.is_site_admin());

create or replace function public.has_feature(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select granted from public.tenant_feature_overrides
     where tenant_id = public.current_tenant_id() and feature_key = p_key),
    (select status from public.tenants where id = public.current_tenant_id()) = 'trial'
    or exists (
      select 1
      from public.tenants t
      join public.plan_features pf on pf.plan_id = t.plan_id
      join public.features f on f.id = pf.feature_id and f.key = p_key
      where t.id = public.current_tenant_id()
    )
  );
$$;

create or replace function public.get_my_features()
returns setof text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select key from (
    select key from public.features
    where (select status from public.tenants where id = public.current_tenant_id()) = 'trial'
    union
    select f.key
    from public.tenants t
    join public.plan_features pf on pf.plan_id = t.plan_id
    join public.features f on f.id = pf.feature_id
    where t.id = public.current_tenant_id()
  ) base
  where key not in (
    select feature_key from public.tenant_feature_overrides
    where tenant_id = public.current_tenant_id() and granted = false
  )
  union
  select feature_key from public.tenant_feature_overrides
  where tenant_id = public.current_tenant_id() and granted = true;
$$;

-- Site Admin RPCs -- mirrors cancel_tenant_subscription/soft_delete_tenant's
-- shape (plain SECURITY DEFINER RPC writing directly to a tenant-scoped
-- table, no edge function needed since no auth.admin.* call is involved).
-- No site_admin_access_log row: the override row itself, surfaced in the
-- Churches-tab UI, is the visible audit trail, same reasoning as those two.
create or replace function public.list_tenant_feature_overrides_for_site_admin(p_tenant_id uuid)
returns table(feature_key text, feature_name text, granted boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_site_admin() then
    raise exception 'Only a Site Admin can view feature overrides';
  end if;
  return query
    select f.key, f.name, tfo.granted
    from public.features f
    left join public.tenant_feature_overrides tfo
      on tfo.tenant_id = p_tenant_id and tfo.feature_key = f.key
    order by f.name;
end;
$$;

create or replace function public.set_tenant_feature_override_for_site_admin(p_tenant_id uuid, p_feature_key text, p_granted boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_site_admin() then
    raise exception 'Only a Site Admin can set a feature override';
  end if;
  insert into public.tenant_feature_overrides (tenant_id, feature_key, granted, set_by, set_at)
  values (p_tenant_id, p_feature_key, p_granted, auth.uid(), now())
  on conflict (tenant_id, feature_key) do update
    set granted = excluded.granted, set_by = excluded.set_by, set_at = excluded.set_at;
end;
$$;

create or replace function public.clear_tenant_feature_override_for_site_admin(p_tenant_id uuid, p_feature_key text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_site_admin() then
    raise exception 'Only a Site Admin can clear a feature override';
  end if;
  delete from public.tenant_feature_overrides
  where tenant_id = p_tenant_id and feature_key = p_feature_key;
end;
$$;

revoke execute on function public.list_tenant_feature_overrides_for_site_admin(uuid) from public;
grant execute on function public.list_tenant_feature_overrides_for_site_admin(uuid) to authenticated;
revoke execute on function public.set_tenant_feature_override_for_site_admin(uuid, text, boolean) from public;
grant execute on function public.set_tenant_feature_override_for_site_admin(uuid, text, boolean) to authenticated;
revoke execute on function public.clear_tenant_feature_override_for_site_admin(uuid, text) from public;
grant execute on function public.clear_tenant_feature_override_for_site_admin(uuid, text) to authenticated;

commit;

select pg_notify('pgrst', 'reload schema');
