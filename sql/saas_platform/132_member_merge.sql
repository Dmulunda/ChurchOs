-- Member Database (Feature 2 of 3, part 3b): resolves a "possible
-- duplicate" flagged by submit_member_registration()'s 50-69 scoring
-- band (sql/saas_platform/129) -- the Directory's Merge button calls
-- this; Keep-as-new is simple enough (clear possible_duplicate_of)
-- that it's just a direct client-side update, no RPC needed for it.
--
-- Same "only overwrite non-empty incoming values" semantics as the
-- >=70 auto-update branch in submit_member_registration() -- the
-- duplicate's data fills gaps in the target, it never clobbers
-- already-filled target fields (an admin confirming "same person"
-- isn't also asserting "the newer submission is more correct").
-- member_history is written automatically by the UPDATE below (same
-- log_member_changes() trigger, sql/saas_platform/131) -- the
-- duplicate row's own history is lost when it's deleted (cascades via
-- member_history.member_id), which is fine: it's moot once merged.
create or replace function public.merge_duplicate_member(p_duplicate_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_dup public.members%rowtype;
  v_target public.members%rowtype;
begin
  if not (is_pastoral_team() or is_church_admin()) then
    raise exception 'You do not have access to manage the member directory';
  end if;

  select * into v_dup from public.members where id = p_duplicate_id and tenant_id = current_tenant_id();
  if v_dup.id is null then
    raise exception 'Member not found';
  end if;
  if v_dup.possible_duplicate_of is null then
    raise exception 'This member is not flagged as a possible duplicate';
  end if;

  select * into v_target from public.members where id = v_dup.possible_duplicate_of;
  if v_target.id is null then
    raise exception 'The original member this was matched against no longer exists';
  end if;

  update public.members set
    full_name = coalesce(nullif(v_target.full_name, ''), v_dup.full_name),
    gender = coalesce(v_target.gender, v_dup.gender),
    marital_status = coalesce(v_target.marital_status, v_dup.marital_status),
    address_street = coalesce(v_target.address_street, v_dup.address_street),
    address_city = coalesce(v_target.address_city, v_dup.address_city),
    address_province = coalesce(v_target.address_province, v_dup.address_province),
    address_postal = coalesce(v_target.address_postal, v_dup.address_postal),
    age_group = coalesce(v_target.age_group, v_dup.age_group),
    career = coalesce(v_target.career, v_dup.career),
    phone = coalesce(v_target.phone, v_dup.phone),
    email = coalesce(v_target.email, v_dup.email),
    skills = case when array_length(v_target.skills, 1) > 0 then v_target.skills else v_dup.skills end,
    skills_other = coalesce(v_target.skills_other, v_dup.skills_other),
    profile_id = coalesce(v_target.profile_id, v_dup.profile_id),
    last_updated_at = now()
  where id = v_target.id;

  delete from public.members where id = p_duplicate_id;
end;
$$;

revoke all on function public.merge_duplicate_member(uuid) from public;
grant execute on function public.merge_duplicate_member(uuid) to authenticated;

select pg_notify('pgrst', 'reload schema');
