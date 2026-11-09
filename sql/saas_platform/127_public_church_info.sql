-- Lets a public, unauthenticated page (prayer.html so far; register.html
-- will reuse this too) show the church's own name/logo at the top,
-- without opening direct anon read access to the tenants table (which
-- holds far more than name/logo). A small security definer RPC
-- granted to anon, same pattern as the write-side public RPCs
-- (submit_public_prayer_request etc.) just for a read instead.
create or replace function public.get_public_church_info(p_tenant_slug text)
returns jsonb
language sql
security definer
set search_path to 'public', 'pg_temp'
stable
as $$
  select jsonb_build_object('name', name, 'logo_url', logo_url)
  from public.tenants
  where slug = p_tenant_slug;
$$;

revoke all on function public.get_public_church_info(text) from public;
grant execute on function public.get_public_church_info(text) to anon, authenticated;

select pg_notify('pgrst', 'reload schema');
