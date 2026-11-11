-- Site Admin asks for two things:
--   1. A place to see how many churches have connected and from
--      which country -- tenants has no location field at all, so a
--      plain `country` column (filled in manually by the Site Admin
--      for now, per their own call) is the simplest fit.
--   2. A place to add comments per church, kept as a running dated
--      log rather than the single admin_note idiom used elsewhere
--      (app_suggestions/support_requests/website_inquiries) -- the
--      Site Admin explicitly wants history, not one overwritable
--      field, so this is a new table, not a reused column.
--
-- tenant_notes deliberately has NO tenant_isolation restrictive
-- policy -- same reasoning as site_admin_access_log (sql/115): it's
-- cross-tenant Site Admin data, and a tenant_isolation policy scoped
-- to current_tenant_id() would block the Site Admin from reading
-- notes on any church that isn't their own tenant.

begin;

alter table public.tenants add column if not exists country text;

create table if not exists public.tenant_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);

alter table public.tenant_notes enable row level security;

drop policy if exists "site admins manage tenant notes" on public.tenant_notes;
create policy "site admins manage tenant notes" on public.tenant_notes
  for all to authenticated using (public.is_site_admin()) with check (public.is_site_admin());

create index if not exists tenant_notes_tenant_id_idx on public.tenant_notes (tenant_id, created_at desc);

create or replace function public.update_tenant_country(p_tenant_id uuid, p_country text)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_site_admin() then
    raise exception 'Only a Site Admin can update a church''s country';
  end if;

  update public.tenants set country = nullif(trim(p_country), ''), updated_at = now()
  where id = p_tenant_id;
end;
$$;

revoke all on function public.update_tenant_country(uuid, text) from public;
grant execute on function public.update_tenant_country(uuid, text) to authenticated;

create or replace function public.add_tenant_note(p_tenant_id uuid, p_body text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if not public.is_site_admin() then
    raise exception 'Only a Site Admin can add a note';
  end if;
  if coalesce(trim(p_body), '') = '' then
    raise exception 'Note cannot be empty';
  end if;

  insert into public.tenant_notes (tenant_id, author_id, body)
  values (p_tenant_id, auth.uid(), trim(p_body))
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.add_tenant_note(uuid, text) from public;
grant execute on function public.add_tenant_note(uuid, text) to authenticated;

create or replace function public.list_tenant_notes(p_tenant_id uuid)
returns table(id uuid, body text, author_name text, created_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_site_admin() then
    raise exception 'Only a Site Admin can view notes';
  end if;

  return query
  select n.id, n.body, p.full_name, n.created_at
  from public.tenant_notes n
  left join public.profiles p on p.id = n.author_id
  where n.tenant_id = p_tenant_id
  order by n.created_at desc;
end;
$$;

revoke all on function public.list_tenant_notes(uuid) from public;
grant execute on function public.list_tenant_notes(uuid) to authenticated;

-- Add country to the Churches tab's existing list RPC (sql/115).
-- Return type is changing (one extra column), so the function must
-- be dropped first, same as 115 did over its own predecessor.
DROP FUNCTION IF EXISTS public.list_all_tenants_for_site_admin();
CREATE OR REPLACE FUNCTION public.list_all_tenants_for_site_admin()
 RETURNS TABLE(
   id uuid, name text, slug text, status text, plan_id uuid, created_at timestamptz,
   deleted_at timestamptz, canceled_reason text, member_count bigint, department_count bigint,
   last_active_at timestamptz, storage_bytes bigint, owner_name text, owner_email text,
   country text
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
    owner_email.email,
    t.country
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

commit;

select pg_notify('pgrst', 'reload schema');
