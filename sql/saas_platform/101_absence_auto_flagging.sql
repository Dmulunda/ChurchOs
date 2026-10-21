-- Part F of the Pastoral Dashboard follow-ups: automatically flag any
-- member who has attended Sunday service before but has zero
-- attendance in the 3 most recent actual Sunday dates. Confirmed with
-- the user as fully automatic (a scheduled job, no admin action
-- needed to trigger it) rather than a manual review queue.
--
-- A member's own most recent sunday_service attendance date being
-- more than 2 weeks before "last Sunday" is exactly equivalent to
-- "no attendance among the 3 most recent Sundays" (v_last_sunday,
-- v_last_sunday-7, v_last_sunday-14 are themselves the earliest of
-- those three) while also naturally requiring they attended at least
-- once before that -- a brand-new member with zero history never
-- matches, since they'd have no row to aggregate at all.
--
-- Reuses member_cases (sql/saas_platform/01's schema) rather than a
-- new table, per the pastoral-dashboard research: free-text note +
-- status + department routing already matches the need. Left
-- unassigned (assigned_department_id null, created_by null, same as
-- any other unrouted case) so it's visible by default only to the
-- pastoral team / Church Admin (member_cases' own SELECT policy,
-- sql/saas_platform/96) -- staff can route it to a department like
-- any other case. Runs across every tenant in one pass since
-- attendance_records/member_cases both already carry tenant_id and
-- this function is SECURITY DEFINER (bypasses RLS); dedupe is a
-- distinctive note prefix + "not already open" so a still-absent
-- member doesn't get a fresh case every week this runs.
create or replace function public.flag_members_absent_3_sundays()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_last_sunday date := current_date - (extract(dow from current_date)::int);
begin
  insert into public.member_cases (subject_user_id, note, tenant_id)
  select
    m.member_id,
    'Absent 3+ consecutive Sundays (last seen ' || m.last_seen::text || ')',
    m.tenant_id
  from (
    select member_id, tenant_id, max(service_date) as last_seen
    from public.attendance_records
    where service_type = 'sunday_service' and member_id is not null
    group by member_id, tenant_id
  ) m
  where m.last_seen < v_last_sunday - 14
    and not exists (
      select 1 from public.member_cases mc
      where mc.subject_user_id = m.member_id
        and mc.status <> 'resolved'
        and mc.note like 'Absent 3+ consecutive Sundays%'
    );
end;
$$;

do $$ begin perform cron.unschedule('flag-absent-members'); exception when others then null; end $$;
select cron.schedule('flag-absent-members', '0 6 * * 1', 'select public.flag_members_absent_3_sundays();');
