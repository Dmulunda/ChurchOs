-- New "Church Admin" role -- modeled directly on Site Admin
-- (sql/saas_platform/49_site_admin_and_open_suggestions.sql: a
-- dedicated grant table + is_x()/list_x()/grant_x_by_email()/
-- revoke_x() functions, same shape) but scoped to ONE church instead
-- of being cross-tenant. Grantable only by that church's own Super
-- Admin -- the natural tenant-level authority, parallel to however
-- Site Admin itself gets granted at the platform level. Used by
-- Part 3's access-control widenings (Prayer Requests, Member Cases)
-- and Part 5's Urgent Prayer Cases.

begin;

create table if not exists public.church_admins (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  granted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.church_admins enable row level security;

create or replace function public.is_church_admin()
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.church_admins
    where user_id = auth.uid() and tenant_id = public.current_tenant_id()
  );
$$;

drop policy if exists "tenant_isolation" on public.church_admins;
create policy "tenant_isolation" on public.church_admins as restrictive for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop policy if exists "super admin can read church admins" on public.church_admins;
create policy "super admin can read church admins" on public.church_admins
  for select to authenticated using (public.is_super_admin());

create or replace function public.list_church_admins()
returns table(user_id uuid, full_name text, granted_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only the Super Admin can view the Church Admin list';
  end if;
  return query
    select ca.user_id, p.full_name, ca.created_at
    from public.church_admins ca
    join public.profiles p on p.id = ca.user_id
    where ca.tenant_id = public.current_tenant_id()
    order by ca.created_at;
end;
$$;

create or replace function public.grant_church_admin_by_email(p_email text)
returns table(granted_user_id uuid, full_name text)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_tenant_id uuid := public.current_tenant_id();
begin
  if not public.is_super_admin() then
    raise exception 'Only the Super Admin can grant Church Admin access';
  end if;

  select pe.id into v_user_id from public.profile_emails pe
  join public.profiles p on p.id = pe.id
  where lower(pe.email) = lower(trim(p_email)) and p.tenant_id = v_tenant_id
  limit 1;

  if v_user_id is null then
    raise exception 'No member of this church found with that email';
  end if;

  insert into public.church_admins (user_id, tenant_id, granted_by) values (v_user_id, v_tenant_id, auth.uid())
  on conflict (user_id) do nothing;

  return query select p.id, p.full_name from public.profiles p where p.id = v_user_id;
end;
$$;

create or replace function public.revoke_church_admin(p_user_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only the Super Admin can revoke Church Admin access';
  end if;
  delete from public.church_admins where user_id = p_user_id and tenant_id = public.current_tenant_id();
end;
$$;

grant execute on function public.is_church_admin() to authenticated;
revoke all on function public.list_church_admins() from public;
revoke all on function public.grant_church_admin_by_email(text) from public;
revoke all on function public.revoke_church_admin(uuid) from public;
grant execute on function public.list_church_admins() to authenticated;
grant execute on function public.grant_church_admin_by_email(text) to authenticated;
grant execute on function public.revoke_church_admin(uuid) to authenticated;

commit;

select pg_notify('pgrst', 'reload schema');
