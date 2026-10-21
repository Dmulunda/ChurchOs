-- Fixes "infinite recursion detected in policy for relation
-- urgent_prayer_cases": urgent_prayer_cases' SELECT policy (sql/98)
-- inline-queried urgent_prayer_case_viewers, and
-- urgent_prayer_case_viewers' policy inline-queried
-- urgent_prayer_cases right back -- an inline EXISTS subquery inside
-- a policy runs under the CALLING role's own RLS context (not a
-- separate security boundary), so each query re-evaluated the other
-- table's policy, which re-evaluated the first table's policy, ad
-- infinitum.
--
-- Fix: wrap both cross-table checks in their own STABLE SECURITY
-- DEFINER function -- exactly the pattern every other cross-table
-- permission check in this schema already uses
-- (can_write_department()/is_pastoral_team()/etc.) specifically to
-- avoid this. A security-definer function's internal queries run as
-- the function's owner, which bypasses RLS entirely, breaking the
-- cycle.

begin;

create or replace function public.is_urgent_prayer_case_viewer(p_case_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.urgent_prayer_case_viewers
    where case_id = p_case_id and user_id = auth.uid()
  );
$$;

create or replace function public.can_manage_urgent_prayer_case(p_case_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.urgent_prayer_cases upc
    where upc.id = p_case_id and (
      upc.created_by = auth.uid()
      or public.is_super_admin()
      or public.is_pastor_admin()
      or public.is_church_admin()
    )
  );
$$;

grant execute on function public.is_urgent_prayer_case_viewer(uuid) to authenticated;
grant execute on function public.can_manage_urgent_prayer_case(uuid) to authenticated;

drop policy if exists "urgent prayer cases are readable by the authorized" on public.urgent_prayer_cases;
create policy "urgent prayer cases are readable by the authorized" on public.urgent_prayer_cases
  for select to authenticated using (
    public.is_super_admin()
    or public.is_pastor_admin()
    or public.is_church_admin()
    or public.can_manage_department((select id from public.departments where key = 'intercession'))
    or created_by = auth.uid()
    or public.is_urgent_prayer_case_viewer(id)
  );

drop policy if exists "urgent prayer case viewers are managed by the creator" on public.urgent_prayer_case_viewers;
create policy "urgent prayer case viewers are managed by the creator" on public.urgent_prayer_case_viewers
  for all to authenticated using (
    user_id = auth.uid()
    or public.can_manage_urgent_prayer_case(case_id)
  )
  with check (
    public.can_manage_urgent_prayer_case(case_id)
  );

commit;

select pg_notify('pgrst', 'reload schema');
