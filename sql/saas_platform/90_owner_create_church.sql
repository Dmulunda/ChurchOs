-- Owner-created churches: the owner-create-church edge function does
-- the actual account creation (service role, auth.admin.createUser())
-- since that's not reachable from a plain client RPC. This migration
-- is just the two small SQL-side pieces that go with it: the forced-
-- password-change flag the new admin starts with, and a self-service
-- RPC to clear it once they've actually changed it (js/app.js's
-- full-screen gate calls this on success).

begin;

alter table public.profiles add column if not exists must_change_password boolean not null default false;

create or replace function public.clear_must_change_password()
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update public.profiles set must_change_password = false where id = auth.uid();
end;
$$;

revoke all on function public.clear_must_change_password() from public;
grant execute on function public.clear_must_change_password() to authenticated;

-- The edge function calls this with its service-role client (no end-
-- user JWT) -- explicit so it never depends on whatever default
-- grants this project happens to already have for service_role.
grant execute on function public.create_tenant_for_signup(text, text) to service_role;

commit;

select pg_notify('pgrst', 'reload schema');
