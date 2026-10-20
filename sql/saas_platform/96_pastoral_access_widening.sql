-- Access-control alignment for the pastoral dashboard's five
-- sections. Every change here is ADDITIVE -- widens who can see
-- something, never narrows an existing grantee (confirmed with the
-- user: Prayer Requests keeps its current pastoral-team audience,
-- church_secretary included, Church Admin is added on top).

begin;

-- Prayer Requests: add Church Admin.
drop policy if exists "prayer requests are readable by requester or handlers" on public.prayer_requests;
create policy "prayer requests are readable by requester or handlers" on public.prayer_requests
  for select to authenticated using (
    user_id = auth.uid()
    or is_pastoral_team()
    or is_church_admin()
    or can_manage_department((select id from departments where key = 'intercession'))
  );

drop policy if exists "prayer requests are updated by handlers" on public.prayer_requests;
create policy "prayer requests are updated by handlers" on public.prayer_requests
  for update to authenticated
  using (
    is_pastoral_team()
    or is_church_admin()
    or can_manage_department((select id from departments where key = 'intercession'))
  )
  with check (
    is_pastoral_team()
    or is_church_admin()
    or can_manage_department((select id from departments where key = 'intercession'))
  );

-- Member Cases: the creator keeps visibility of their own case even
-- after it's handed off to another department (today's policy only
-- grants that by coincidence, if the creator also happens to admin
-- the currently-assigned department); add Church Admin too.
-- Department-level assignment itself is kept as-is (confirmed with
-- the user), not narrowed to a single named admin.
drop policy if exists "member cases are readable by those holding the case" on public.member_cases;
create policy "member cases are readable by those holding the case" on public.member_cases
  for select to authenticated using (
    is_pastoral_team()
    or is_church_admin()
    or created_by = auth.uid()
    or (assigned_department_id is not null and can_write_department(assigned_department_id))
  );

-- Guest Cases: widen from "pastoral team OR admin of the currently-
-- assigned department" to "pastoral team OR Church Admin OR admin of
-- ANY department" -- confirmed with the user as "all admins,
-- tenant-wide," not the narrower pastoral-team-only reading.
drop policy if exists "guest follow-ups are readable by those holding the case" on public.guest_follow_ups;
create policy "guest follow-ups are readable by those holding the case" on public.guest_follow_ups
  for select to authenticated using (
    is_pastoral_team()
    or is_church_admin()
    or (assigned_department_id is not null and can_write_department(assigned_department_id))
    or exists (
      select 1 from public.department_memberships dm
      where dm.user_id = auth.uid() and dm.status = 'approved' and dm.role = 'admin'
    )
  );

-- Attendance Check-In: add "any department admin, tenant-wide" on top
-- of the existing oversight roles + Ushers admin/secretary + (prior
-- migration) all Welcoming & Socialisation members -- additive to
-- that widening, not a replacement.
create or replace function public.can_record_attendance()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    public.is_super_admin()
    or public.is_pastor_admin()
    or public.is_church_secretary()
    or public.is_church_admin()
    or exists (
      select 1 from public.department_memberships dm
      join public.departments d on d.id = dm.department_id
      where dm.user_id = auth.uid() and dm.status = 'approved'
        and dm.role in ('admin', 'secretary') and d.key = 'ushers'
    )
    or exists (
      select 1 from public.department_memberships dm
      join public.departments d on d.id = dm.department_id
      where dm.user_id = auth.uid() and dm.status = 'approved'
        and d.key = 'welcoming_socialisation'
    )
    or exists (
      select 1 from public.department_memberships dm
      where dm.user_id = auth.uid() and dm.status = 'approved' and dm.role = 'admin'
    );
$$;

commit;

select pg_notify('pgrst', 'reload schema');
