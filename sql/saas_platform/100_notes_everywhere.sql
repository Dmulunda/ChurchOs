-- Part B of the Pastoral Dashboard follow-ups: lets admins add/edit a
-- note on a record after it already exists, not just at creation.
-- Member Cases' note, Guest Cases' notes, and Urgent Prayer Cases'
-- need_description already exist and are already UPDATE-able via
-- their existing policies (confirmed via direct schema read) -- no
-- SQL change needed for those three. Prayer Requests and Attendance
-- each need a new column; Attendance also needs a brand-new UPDATE
-- policy, since it only ever had INSERT/DELETE before now.

begin;

alter table public.prayer_requests add column if not exists admin_note text;
alter table public.attendance_records add column if not exists note text;

drop policy if exists "attendance is updated by ushers/admins" on public.attendance_records;
create policy "attendance is updated by ushers/admins" on public."attendance_records"
  for update to authenticated
  using (can_record_attendance())
  with check (can_record_attendance());

commit;

select pg_notify('pgrst', 'reload schema');
