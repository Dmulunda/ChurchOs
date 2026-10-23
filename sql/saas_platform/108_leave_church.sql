-- Self-service "leave this church" -- the counterpart to the admin-only
-- remove_user_from_church() (sql/saas_platform/06_rpc_tenant_fixes.sql):
-- same cleanup, but gated on the caller's own auth.uid() instead of
-- is_super_admin(), for a member who left or no longer wants access.

begin;

alter table public.profiles add column if not exists removed_reason text;

create or replace function public.leave_church()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.department_memberships where user_id = auth.uid();

  update public.profiles
  set removed_at = now(), removed_by = auth.uid(), removed_reason = 'Left voluntarily', global_role = null
  where id = auth.uid() and removed_at is null;
end;
$$;

revoke all on function public.leave_church() from public;
grant execute on function public.leave_church() to authenticated;

select pg_notify('pgrst', 'reload schema');

commit;
