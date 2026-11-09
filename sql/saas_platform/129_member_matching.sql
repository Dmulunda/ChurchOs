-- Member Database (Feature 2 of 3, part 2): self-registration +
-- fuzzy matching. One RPC, called both from the public, unauthenticated
-- register.html (js/publicMemberRegistration.js, p_profile_id null)
-- and from the in-app pre-filled version for a logged-in member
-- (js/components/memberRegistrationModal.js, p_profile_id = their own
-- profiles.id) -- same matching logic either way, the only difference
-- is whether a profile gets linked at the end.
--
-- Scoring mirrors sql/saas_platform/102_silent_users_foundation.sql's
-- find_silent_user_match() in spirit (pg_trgm similarity()), but
-- weighted per-field per the spec: email 30, phone (digits-only) 30,
-- name similarity up to 30, gender 5, age_group 5. >=70 updates the
-- matched row in place (only non-empty incoming values overwrite,
-- every changed field logged to member_history); 50-69 inserts a new
-- row flagged possible_duplicate_of for the Directory's Merge/Keep-
-- as-new action; <50 is a plain new Newcomer.
begin;

create or replace function public.submit_member_registration(
  p_tenant_slug text,
  p_full_name text,
  p_gender text default null,
  p_marital_status text default null,
  p_address_street text default null,
  p_address_city text default null,
  p_address_province text default null,
  p_address_postal text default null,
  p_age_group text default null,
  p_career text default null,
  p_phone text default null,
  p_email text default null,
  p_skills text[] default null,
  p_skills_other text default null,
  p_consent boolean default false,
  p_profile_id uuid default null,
  p_honeypot text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_tenant_id uuid;
  v_email text;
  v_recent_count integer;
  v_match record;
  v_old public.members%rowtype;
  v_member_id uuid;
  v_result_status text;
begin
  if coalesce(trim(p_honeypot), '') <> '' then
    return jsonb_build_object('ok', true);
  end if;

  if auth.uid() is not null then
    v_tenant_id := public.current_tenant_id();
  else
    select id into v_tenant_id from public.tenants where slug = p_tenant_slug;
    if v_tenant_id is null then
      raise exception 'Church not found';
    end if;
  end if;

  if coalesce(trim(p_full_name), '') = '' then
    raise exception 'Full name is required';
  end if;
  if not coalesce(p_consent, false) then
    raise exception 'Consent is required';
  end if;

  -- consent_given_at is only ever set by THIS rpc (a bulk/admin import
  -- or the one-time profile-migration backfill never sets it) -- using
  -- it here, not a bare created_at count, keeps a bulk import from
  -- ever falsely tripping this limit.
  select count(*) into v_recent_count
  from public.members
  where tenant_id = v_tenant_id
    and consent_given_at > now() - interval '5 minutes';
  if v_recent_count >= 20 then
    raise exception 'Too many submissions right now -- please try again shortly';
  end if;

  v_email := nullif(lower(trim(p_email)), '');

  select m.id, m.profile_id,
    (
      (case when v_email is not null and lower(m.email) = v_email then 30 else 0 end)
      + (case when nullif(regexp_replace(coalesce(m.phone, ''), '\D', '', 'g'), '') is not null
               and regexp_replace(coalesce(m.phone, ''), '\D', '', 'g') = regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')
          then 30 else 0 end)
      + (similarity(coalesce(m.full_name, ''), p_full_name) * 30)
      + (case when m.gender is not null and m.gender = p_gender then 5 else 0 end)
      + (case when m.age_group is not null and m.age_group = p_age_group then 5 else 0 end)
    ) as total
  into v_match
  from public.members m
  where m.tenant_id = v_tenant_id
  order by total desc
  limit 1;

  if v_match.id is not null and v_match.total >= 70 then
    v_member_id := v_match.id;
    select * into v_old from public.members where id = v_member_id;

    update public.members set
      full_name = coalesce(nullif(trim(p_full_name), ''), full_name),
      gender = coalesce(p_gender, gender),
      marital_status = coalesce(p_marital_status, marital_status),
      address_street = coalesce(nullif(trim(p_address_street), ''), address_street),
      address_city = coalesce(nullif(trim(p_address_city), ''), address_city),
      address_province = coalesce(nullif(trim(p_address_province), ''), address_province),
      address_postal = coalesce(nullif(trim(p_address_postal), ''), address_postal),
      age_group = coalesce(p_age_group, age_group),
      career = coalesce(nullif(trim(p_career), ''), career),
      phone = coalesce(nullif(trim(p_phone), ''), phone),
      email = coalesce(v_email, email),
      skills = case when p_skills is not null and array_length(p_skills, 1) > 0 then p_skills else skills end,
      skills_other = coalesce(nullif(trim(p_skills_other), ''), skills_other),
      profile_id = coalesce(profile_id, p_profile_id),
      last_updated_at = now()
    where id = v_member_id;

    insert into public.member_history (tenant_id, member_id, field, old_value, new_value, changed_by)
    select v_tenant_id, v_member_id, f.field, f.old_value, f.new_value, p_profile_id
    from (values
      ('full_name', v_old.full_name, nullif(trim(p_full_name), '')),
      ('gender', v_old.gender, p_gender),
      ('marital_status', v_old.marital_status, p_marital_status),
      ('address_street', v_old.address_street, nullif(trim(p_address_street), '')),
      ('address_city', v_old.address_city, nullif(trim(p_address_city), '')),
      ('address_province', v_old.address_province, nullif(trim(p_address_province), '')),
      ('address_postal', v_old.address_postal, nullif(trim(p_address_postal), '')),
      ('age_group', v_old.age_group, p_age_group),
      ('career', v_old.career, nullif(trim(p_career), '')),
      ('phone', v_old.phone, nullif(trim(p_phone), '')),
      ('email', v_old.email, v_email),
      ('skills', v_old.skills::text, case when p_skills is not null and array_length(p_skills, 1) > 0 then p_skills::text else null end),
      ('skills_other', v_old.skills_other, nullif(trim(p_skills_other), ''))
    ) as f(field, old_value, new_value)
    where f.new_value is not null and f.new_value is distinct from f.old_value;

    v_result_status := 'updated';

  elsif v_match.id is not null and v_match.total >= 50 then
    insert into public.members (
      tenant_id, profile_id, full_name, gender, marital_status,
      address_street, address_city, address_province, address_postal,
      age_group, career, phone, email, skills, skills_other,
      status, possible_duplicate_of, consent_given_at
    ) values (
      v_tenant_id, p_profile_id, trim(p_full_name), p_gender, p_marital_status,
      nullif(trim(p_address_street), ''), nullif(trim(p_address_city), ''), nullif(trim(p_address_province), ''), nullif(trim(p_address_postal), ''),
      p_age_group, nullif(trim(p_career), ''), nullif(trim(p_phone), ''), v_email, coalesce(p_skills, '{}'), nullif(trim(p_skills_other), ''),
      'Newcomer', v_match.id, now()
    ) returning id into v_member_id;
    v_result_status := 'possible_duplicate';

  else
    insert into public.members (
      tenant_id, profile_id, full_name, gender, marital_status,
      address_street, address_city, address_province, address_postal,
      age_group, career, phone, email, skills, skills_other,
      status, consent_given_at
    ) values (
      v_tenant_id, p_profile_id, trim(p_full_name), p_gender, p_marital_status,
      nullif(trim(p_address_street), ''), nullif(trim(p_address_city), ''), nullif(trim(p_address_province), ''), nullif(trim(p_address_postal), ''),
      p_age_group, nullif(trim(p_career), ''), nullif(trim(p_phone), ''), v_email, coalesce(p_skills, '{}'), nullif(trim(p_skills_other), ''),
      'Newcomer', now()
    ) returning id into v_member_id;
    v_result_status := 'new';
  end if;

  return jsonb_build_object('id', v_member_id, 'result', v_result_status);
end;
$$;

revoke all on function public.submit_member_registration(text, text, text, text, text, text, text, text, text, text, text, text, text[], text, boolean, uuid, text) from public;
grant execute on function public.submit_member_registration(text, text, text, text, text, text, text, text, text, text, text, text, text[], text, boolean, uuid, text) to anon, authenticated;

commit;

select pg_notify('pgrst', 'reload schema');
