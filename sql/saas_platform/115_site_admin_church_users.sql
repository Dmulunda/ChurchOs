-- Site Admin support tooling: who runs each church, and a per-church
-- user list for support (find a member, reset their password) without
-- requiring View-As (which only works inside your own tenant) or a
-- new real tenant-switch mechanism. Neither `tenants` nor
-- `church_admins` stores an email directly -- it's always resolved via
-- profiles -> profile_emails, and there is no RLS path today that lets
-- a Site Admin read another tenant's profiles/profile_emails (both
-- have a restrictive tenant_isolation policy with no is_site_admin()
-- branch) -- so this follows the exact same pattern every other
-- cross-tenant Site Admin feature already uses: a narrow, purpose-
-- built SECURITY DEFINER RPC, not a widened table policy (which would
-- let a Site Admin query profiles/profile_emails column-by-column
-- directly from the client -- a much bigger surface).

begin;

-- "Owner" = that tenant's own earliest-created Super Admin (the
-- founding signup admin in practice). is_primary_admin was considered
-- and rejected -- its unique index isn't tenant-scoped (one flag for
-- the whole platform, a legacy single-tenant artifact), so it can't
-- mean "this church's owner".
DROP FUNCTION IF EXISTS public.list_all_tenants_for_site_admin();
CREATE OR REPLACE FUNCTION public.list_all_tenants_for_site_admin()
 RETURNS TABLE(
   id uuid, name text, slug text, status text, plan_id uuid, created_at timestamptz,
   deleted_at timestamptz, canceled_reason text, member_count bigint, department_count bigint,
   last_active_at timestamptz, storage_bytes bigint, owner_name text, owner_email text
 )
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
begin
  if not public.is_site_admin() then
    raise exception 'Only a Site Admin can view the churches list';
  end if;

  return query
  with storage_by_tenant as (
    select o.tenant_id, sum(o.bytes) as bytes from (
      select (split_part(so.name, '/', 1))::uuid as tenant_id, (so.metadata->>'size')::bigint as bytes
      from storage.objects so
      where so.bucket_id in ('tenant-logos', 'help-docs')
        and split_part(so.name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

      union all
      select p.tenant_id, (so.metadata->>'size')::bigint
      from storage.objects so
      join public.profiles p on p.id::text = split_part(so.name, '/', 1)
      where so.bucket_id = 'member-photos'

      union all
      select d.tenant_id, (so.metadata->>'size')::bigint
      from storage.objects so
      join public.departments d on d.id::text = split_part(so.name, '/', 1)
      where so.bucket_id in ('uniform-photos', 'budget-receipts')

      union all
      select l.tenant_id, (so.metadata->>'size')::bigint
      from storage.objects so
      join public.lessons l on l.id::text = split_part(so.name, '/', 1)
      where so.bucket_id in ('course-videos', 'course-pdfs')

      union all
      select cp.tenant_id, (so.metadata->>'size')::bigint
      from storage.objects so
      join public.church_programs cp on cp.flyer_storage_path = so.name
      where so.bucket_id = 'church-program-flyers'

      union all
      select s.tenant_id, (so.metadata->>'size')::bigint
      from storage.objects so
      join public.songs s on (
        position(so.name in coalesce(s.audio_lead_track, '')) > 0
        or position(so.name in coalesce(s.audio_soprano_track, '')) > 0
        or position(so.name in coalesce(s.audio_alto_track, '')) > 0
        or position(so.name in coalesce(s.audio_tenor_track, '')) > 0
        or position(so.name in coalesce(s.video_track, '')) > 0
      )
      where so.bucket_id = 'song-tracks'
    ) o
    group by o.tenant_id
  )
  select
    t.id, t.name, t.slug, t.status, t.plan_id, t.created_at, t.deleted_at, t.canceled_reason,
    (select count(*) from public.profiles p where p.tenant_id = t.id and p.removed_at is null),
    (select count(*) from public.departments d where d.tenant_id = t.id),
    (select max(u.last_sign_in_at) from auth.users u
       join public.profiles p on p.id = u.id where p.tenant_id = t.id),
    coalesce(sbt.bytes, 0)::bigint,
    owner.full_name,
    owner_email.email
  from public.tenants t
  left join storage_by_tenant sbt on sbt.tenant_id = t.id
  left join lateral (
    select p.id, p.full_name
    from public.profiles p
    where p.tenant_id = t.id and p.global_role = 'super_admin' and p.removed_at is null
    order by p.created_at asc
    limit 1
  ) owner on true
  left join public.profile_emails owner_email on owner_email.id = owner.id
  order by t.created_at desc;
end;
$$;

revoke all on function public.list_all_tenants_for_site_admin() from public;
grant execute on function public.list_all_tenants_for_site_admin() to authenticated;

-- Per-church user list for support -- name/email/phone, access level,
-- Silent/removed state, department memberships, last login. Excludes
-- permanently-deleted rows (nothing left worth showing); keeps soft-
-- removed ones (still visible, flagged, since a support conversation
-- might be about exactly why someone got removed).
CREATE OR REPLACE FUNCTION public.list_tenant_users_for_site_admin(p_tenant_id uuid)
 RETURNS TABLE(
   id uuid, full_name text, email text, phone text, global_role text,
   is_silent boolean, removed_at timestamptz, created_at timestamptz,
   last_sign_in_at timestamptz, departments text
 )
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
begin
  if not public.is_site_admin() then
    raise exception 'Only a Site Admin can view a church''s users';
  end if;

  return query
  select
    p.id, p.full_name, pe.email, p.phone, p.global_role::text,
    p.is_silent, p.removed_at, p.created_at,
    u.last_sign_in_at,
    (
      select string_agg(d.name || ' (' || dm.role || ')', ', ' order by d.name)
      from public.department_memberships dm
      join public.departments d on d.id = dm.department_id
      where dm.user_id = p.id and dm.status = 'approved'
    )
  from public.profiles p
  left join public.profile_emails pe on pe.id = p.id
  left join auth.users u on u.id = p.id
  where p.tenant_id = p_tenant_id and p.permanently_deleted_at is null
  order by p.full_name;
end;
$$;

revoke all on function public.list_tenant_users_for_site_admin(uuid) from public;
grant execute on function public.list_tenant_users_for_site_admin(uuid) to authenticated;

-- Audit trail for the one genuinely sensitive action this unlocks:
-- resetting a password for a member of a church the Site Admin isn't
-- actually part of. Written by the new site-admin-reset-password Edge
-- Function (service-role insert, no RLS needed on the write side);
-- readable here by any Site Admin for accountability.
create table public.site_admin_access_log (
  id uuid primary key default gen_random_uuid(),
  site_admin_id uuid references public.profiles(id) on delete set null,
  tenant_id uuid references public.tenants(id) on delete set null,
  target_user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  created_at timestamptz not null default now()
);

alter table public.site_admin_access_log enable row level security;

create policy "site admins can read the access log" on public.site_admin_access_log
  for select to authenticated using (public.is_site_admin());

select pg_notify('pgrst', 'reload schema');

commit;
