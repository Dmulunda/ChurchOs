-- Every new church now gets the FULL standard department set from day
-- one (all 14 keys in js/departments.js's DEPARTMENT_KEYS -- the same
-- list the pre-auth signup checkbox form has always offered), not just
-- the four with bespoke boards. All use kind='lightweight' except Choir
-- (kind='choir', its own separate top-level tab set entirely -- see
-- js/app.js's `isChoir`); the others with special scheduling boards
-- (Preaching, Media & Tech, Ecodem/Sunday School) route by `key` in
-- deptScheduling.js regardless of kind, same as every generic department.
--
-- `name` here is just the DB fallback string -- the actual displayed
-- label always comes from department.<key> in js/i18n.js. 'ecodem' was
-- just renamed there to "Sunday School" / "École du dimanche" (was
-- "Ecodem" in both languages).

begin;

create or replace function public.create_tenant_for_signup(p_name text, p_slug text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'Church name is required' using errcode = '22023';
  end if;
  if p_slug !~ '^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])$' then
    raise exception 'That URL name isn''t valid -- use lowercase letters, numbers, and hyphens only' using errcode = '22023';
  end if;

  insert into public.tenants (name, slug, status, trial_ends_at)
  values (trim(p_name), p_slug, 'trial', now() + interval '30 days')
  returning id into v_id;

  -- Explicit tenant_id -- the caller is anon (no session, so
  -- current_tenant_id()'s default would resolve to NULL) at this point
  -- in the signup flow, before auth.signUp() has even run yet.
  insert into public.departments (key, name, kind, tenant_id) values
    ('choir', 'Choir', 'choir', v_id),
    ('social', 'Social', 'lightweight', v_id),
    ('intercession', 'Intercession', 'lightweight', v_id),
    ('media_tech', 'Media & Tech', 'lightweight', v_id),
    ('interpreting', 'Interpreting', 'lightweight', v_id),
    ('cleaning', 'Cleaning', 'lightweight', v_id),
    ('preaching', 'Preaching & Moderation', 'lightweight', v_id),
    ('ushers', 'Ushers', 'lightweight', v_id),
    ('security', 'Security', 'lightweight', v_id),
    ('ecodem', 'Sunday School', 'lightweight', v_id),
    ('evangelism', 'Evangelism', 'lightweight', v_id),
    ('welcoming_socialisation', 'Welcoming and Socialisation', 'lightweight', v_id),
    ('grand_jeunes_couples', 'Youth and Couple', 'lightweight', v_id),
    ('finance', 'Finance', 'lightweight', v_id);

  return v_id;
exception
  when unique_violation then
    raise exception 'That URL name is already taken -- try another' using errcode = '23505';
end;
$$;

revoke execute on function public.create_tenant_for_signup(text, text) from public;
grant execute on function public.create_tenant_for_signup(text, text) to anon, authenticated;

commit;

select pg_notify('pgrst', 'reload schema');
