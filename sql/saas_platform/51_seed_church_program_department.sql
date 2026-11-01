-- Church Program (church_programs/church_program_dates, and now Church
-- Calendar on top of it) was built assuming every tenant has a
-- 'church_program' department row -- auto_add_church_program_membership()
-- looks one up by key+tenant_id and silently no-ops if it doesn't
-- exist. But create_tenant_for_signup() (sql/012) never actually
-- seeded one: its department list is exactly DEPARTMENT_KEYS (14
-- entries), which never included 'church_program'. So no tenant --
-- not even this demo one -- has ever had it, and the whole feature has
-- been unreachable (no tab to click) since it was built. Not something
-- today's Church Calendar work broke; it just surfaced the gap.

begin;

-- 1. Going forward: every new signup also gets church_program.
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
    ('finance', 'Finance', 'lightweight', v_id),
    ('church_program', 'Church Program', 'lightweight', v_id);

  return v_id;
exception
  when unique_violation then
    raise exception 'That URL name is already taken -- try another' using errcode = '23505';
end;
$$;

-- 2. Backfill: give every existing tenant a church_program department
-- if it's missing one.
insert into public.departments (key, name, kind, tenant_id)
select 'church_program', 'Church Program', 'lightweight', t.id
from public.tenants t
where not exists (
  select 1 from public.departments d where d.tenant_id = t.id and d.key = 'church_program'
);

-- 3. Backfill: retroactively join every existing profile into their
-- own tenant's church_program department -- auto_add_church_program_
-- membership() only fires on new department_memberships writes, so
-- nobody already-signed-up ever got added.
insert into public.department_memberships (user_id, department_id, role, status, requested_at, approved_at, tenant_id)
select p.id, d.id, 'member', 'approved', now(), now(), p.tenant_id
from public.profiles p
join public.departments d on d.tenant_id = p.tenant_id and d.key = 'church_program'
where not exists (
  select 1 from public.department_memberships dm where dm.user_id = p.id and dm.department_id = d.id
);

commit;

select pg_notify('pgrst', 'reload schema');
