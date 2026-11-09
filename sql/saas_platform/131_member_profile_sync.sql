-- Member Database (Feature 2 of 3, part 3a): automatic change
-- history + two-way profile<->member sync.
--
-- log_member_changes(): a single generic AFTER UPDATE trigger on
-- members that records every changed trackable field to
-- member_history. This replaces the manual history insert that used
-- to live inside submit_member_registration() (sql/saas_platform/129)
-- -- centralizing it here means EVERY write path (self-registration,
-- the profile sync below, and any future admin edit from the
-- Directory UI) gets history for free, with no risk of a future
-- write path forgetting to log itself.
--
-- sync_profile_to_member() / sync_member_to_profile(): after update
-- triggers on profiles/members respectively, propagating full_name/
-- phone/gender<->sex both ways when a members row is linked via
-- profile_id. address is deliberately excluded -- profiles.address is
-- a single free-text field, members has four structured columns, so
-- there's nothing meaningful to sync either direction; this is a
-- documented one-way gap, not an oversight.
--
-- Loop safety: both sync triggers only write when the OTHER table's
-- row doesn't already hold the new value -- after one hop the values
-- are equal, so the second trigger's own UPDATE affects zero rows and
-- the chain terminates. No session-flag guard needed; the WHERE
-- clause IS the terminator.
begin;

create or replace function public.log_member_changes()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  insert into public.member_history (tenant_id, member_id, field, old_value, new_value, changed_by)
  select new.tenant_id, new.id, f.field, f.old_value, f.new_value, coalesce(new.profile_id, old.profile_id)
  from (values
    ('full_name', old.full_name, new.full_name),
    ('gender', old.gender, new.gender),
    ('marital_status', old.marital_status, new.marital_status),
    ('address_street', old.address_street, new.address_street),
    ('address_city', old.address_city, new.address_city),
    ('address_province', old.address_province, new.address_province),
    ('address_postal', old.address_postal, new.address_postal),
    ('age_group', old.age_group, new.age_group),
    ('career', old.career, new.career),
    ('phone', old.phone, new.phone),
    ('email', old.email, new.email),
    ('skills', old.skills::text, new.skills::text),
    ('skills_other', old.skills_other, new.skills_other),
    ('status', old.status, new.status)
  ) as f(field, old_value, new_value)
  where f.new_value is distinct from f.old_value;

  return new;
end;
$$;

create trigger log_member_changes after update on public.members
  for each row execute function public.log_member_changes();

create or replace function public.sync_profile_to_member()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  update public.members set
    full_name = new.full_name,
    phone = new.phone,
    gender = new.sex,
    last_updated_at = now()
  where profile_id = new.id
    and (full_name is distinct from new.full_name or phone is distinct from new.phone or gender is distinct from new.sex);

  return new;
end;
$$;

create trigger sync_profile_to_member after update on public.profiles
  for each row execute function public.sync_profile_to_member();

create or replace function public.sync_member_to_profile()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.profile_id is null then
    return new;
  end if;

  update public.profiles set
    full_name = new.full_name,
    phone = new.phone,
    sex = new.gender
  where id = new.profile_id
    and (full_name is distinct from new.full_name or phone is distinct from new.phone or sex is distinct from new.gender);

  return new;
end;
$$;

create trigger sync_member_to_profile after update on public.members
  for each row execute function public.sync_member_to_profile();

commit;

select pg_notify('pgrst', 'reload schema');
