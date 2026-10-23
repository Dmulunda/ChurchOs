-- Site Admin "Churches" tab: unsubscribe (cancel) a church's access with a
-- required reason, distinct from soft_delete_tenant (sql/062's trash/purge
-- flow). Unsubscribing never deletes anything -- it just flips status to
-- 'canceled' (already a valid value in the tenants.status check constraint,
-- unused until now) so the existing per-status login gate in app.js can
-- block that tenant's members with a clear message, the same way
-- 'trial_expired' already does.

begin;

alter table public.tenants add column if not exists canceled_at timestamptz;
alter table public.tenants add column if not exists canceled_by uuid references public.profiles(id) on delete set null;
alter table public.tenants add column if not exists canceled_reason text;

-- Writing `status` goes through protect_tenant_privileged_columns_trigger
-- (sql/saas_platform/09_tenant_logo.sql), same as every other status-setting
-- RPC (15_stripe_billing.sql, 87_trial_lockout.sql) -- the bypass flag below
-- is transaction-local and is how those are allowed through it.
create or replace function public.cancel_tenant_subscription(p_tenant_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_site_admin() then
    raise exception 'Only a Site Admin can unsubscribe a church';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required' using errcode = '22023';
  end if;

  perform set_config('app.bypass_tenant_column_protection', 'on', true);
  update public.tenants
  set status = 'canceled',
      canceled_at = now(),
      canceled_by = auth.uid(),
      canceled_reason = trim(p_reason),
      updated_at = now()
  where id = p_tenant_id and status <> 'canceled';
end;
$$;

create or replace function public.reactivate_tenant_subscription(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_site_admin() then
    raise exception 'Only a Site Admin can reactivate a church';
  end if;

  perform set_config('app.bypass_tenant_column_protection', 'on', true);
  update public.tenants
  set status = 'active',
      canceled_at = null,
      canceled_by = null,
      canceled_reason = null,
      updated_at = now()
  where id = p_tenant_id and status = 'canceled';
end;
$$;

revoke all on function public.cancel_tenant_subscription(uuid, text) from public;
revoke all on function public.reactivate_tenant_subscription(uuid) from public;
grant execute on function public.cancel_tenant_subscription(uuid, text) to authenticated;
grant execute on function public.reactivate_tenant_subscription(uuid) to authenticated;

-- Replaces 062's version to surface canceled_reason to the Churches tab.
DROP FUNCTION IF EXISTS public.list_all_tenants_for_site_admin();
CREATE OR REPLACE FUNCTION public.list_all_tenants_for_site_admin()
 RETURNS TABLE(
   id uuid, name text, slug text, status text, plan_id uuid, created_at timestamptz,
   deleted_at timestamptz, canceled_reason text, member_count bigint, department_count bigint,
   last_active_at timestamptz, storage_bytes bigint
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
    coalesce(sbt.bytes, 0)::bigint
  from public.tenants t
  left join storage_by_tenant sbt on sbt.tenant_id = t.id
  order by t.created_at desc;
end;
$$;

revoke all on function public.list_all_tenants_for_site_admin() from public;
grant execute on function public.list_all_tenants_for_site_admin() to authenticated;

select pg_notify('pgrst', 'reload schema');

commit;
