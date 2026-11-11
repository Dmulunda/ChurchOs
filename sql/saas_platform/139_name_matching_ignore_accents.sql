-- Accent-insensitive name matching: "Pepite" and "Pepite" (sic -- e.g.
-- "Pépite" vs "Pepite") should be recognized as the same person.
-- pg_trgm's similarity() compares raw bytes, so a single accented
-- character can drag two otherwise-identical names below the match
-- threshold. unaccent() strips diacritics before comparing, in both
-- of this app's name-matching spots: find_silent_user_match() (sql/102,
-- used by Add User/self-signup to catch an existing Silent user) and
-- submit_member_registration()'s fuzzy score (sql/129, Member Database
-- self-registration). Neither function's signature/return type
-- changes, so both are safe to CREATE OR REPLACE in place. Mirrors
-- Main's sql/143_name_matching_ignore_accents.sql.
begin;

create extension if not exists unaccent schema public;

create or replace function public.find_silent_user_match(p_full_name text, p_tenant_id uuid default null)
returns table (id uuid, full_name text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select p.id, p.full_name
  from public.profiles p
  where p.is_silent
    and p.removed_at is null
    and (p_tenant_id is null or p.tenant_id = p_tenant_id)
    and similarity(public.unaccent(p.full_name), public.unaccent(p_full_name)) >= 0.5
  order by similarity(public.unaccent(p.full_name), public.unaccent(p_full_name)) desc
  limit 1;
$$;

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

  select count(*) into v_recent_count
  from public.members
  where tenant_id = v_tenant_id
    and consent_given_at > now() - interval '5 minutes';
  if v_recent_count >= 20 then
    raise exception 'Too many submissions right now -- please try again shortly';
  end if;

  v_email := nullif(lower(trim(p_email)), '');

  if p_profile_id is not null then
    select m.id, m.profile_id, 100 as total into v_match
    from public.members m
    where m.tenant_id = v_tenant_id and m.profile_id = p_profile_id;
  end if;

  if v_match.id is null then
    select m.id, m.profile_id,
      (
        (case when v_email is not null and lower(m.email) = v_email then 30 else 0 end)
        + (case when nullif(regexp_replace(coalesce(m.phone, ''), '\D', '', 'g'), '') is not null
                 and regexp_replace(coalesce(m.phone, ''), '\D', '', 'g') = regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')
            then 30 else 0 end)
        + (similarity(public.unaccent(coalesce(m.full_name, '')), public.unaccent(p_full_name)) * 30)
        + (case when m.gender is not null and m.gender = p_gender then 5 else 0 end)
        + (case when m.age_group is not null and m.age_group = p_age_group then 5 else 0 end)
      ) as total
    into v_match
    from public.members m
    where m.tenant_id = v_tenant_id
    order by total desc
    limit 1;
  end if;

  if v_match.id is not null and v_match.total >= 70 then
    v_member_id := v_match.id;

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

commit;

select pg_notify('pgrst', 'reload schema');
