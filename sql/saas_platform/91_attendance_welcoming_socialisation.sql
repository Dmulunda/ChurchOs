-- Widens can_record_attendance() to also include every approved
-- Welcoming & Socialisation member, not just that department's
-- admin/secretary -- deliberately wider than the bar Ushers itself
-- has to record attendance, by request. This function backs the
-- attendance_records select/insert/delete policies as-is, so this
-- also gives every Welcoming & Socialisation member read access to
-- the full attendance roster (not just their own check-in), same as
-- it already does for Ushers' admin/secretary.

begin;

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
    );
$$;

commit;

select pg_notify('pgrst', 'reload schema');
