-- Member Exit Tracking (Feature 3 of 3, part 2): wires the two
-- existing "a person is leaving" entry points into
-- record_member_exit() (sql/saas_platform/134) instead of writing
-- profiles.removed_at/removed_by directly, so every exit -- self-
-- service or admin-initiated -- ends up in member_exits.
--
-- leave_church() (self-service, sql/saas_platform/108) and
-- remove_user_from_church() (admin, sql/saas_platform/06) both now
-- look up the caller's/target's `members` row and delegate to
-- record_member_exit() when one exists -- that single function does
-- the member_exits insert, flips members.status, and (same as
-- before) clears department_memberships + sets profiles.removed_at/
-- removed_by/global_role. When no members row is linked (shouldn't
-- happen after the one-time backfill in 128, but defensive), both
-- fall back to the old direct-profile-removal behavior so nobody is
-- ever stuck unable to leave/be removed just because their members
-- row is missing.
--
-- reinstate_user() additionally flips a 'Left' members row back to
-- 'Member' -- the member_exits row itself is left untouched as
-- history, per the plan (exit files survive a reversal).
--
-- The Member Directory's own "Mark as left" action (js/components/
-- memberExitModal.js) calls record_member_exit() directly rather
-- than through remove_user_from_church(): members can have a null
-- profile_id (self-registered, never logged in), so there is no
-- profiles.id to pass remove_user_from_church(), and that RPC is
-- super-admin-only while the Directory is pastoral-team-gated.
-- record_member_exit()'s own authorization already covers pastoral
-- team, so this is not a privilege escalation.
begin;

-- Old fixed-arity signatures must go first: a bare `leave_church()` /
-- `remove_user_from_church(uuid)` call would otherwise be ambiguous
-- between the old function and the new one (every new param has a
-- default, so it's also a zero/one-arg-callable candidate).
drop function if exists public.leave_church();
drop function if exists public.remove_user_from_church(uuid);

create or replace function public.leave_church(
  p_main_reason public.exit_reason default 'unknown',
  p_other_reasons public.exit_reason[] default '{}',
  p_reason_title text default null,
  p_notes text default null,
  p_how_we_know public.exit_how_we_know default null,
  p_joined_other_church text default null,
  p_open_to_follow_up boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_member_id uuid;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and removed_at is null) then
    return;
  end if;

  select id into v_member_id from public.members where profile_id = auth.uid();

  if v_member_id is not null then
    perform public.record_member_exit(v_member_id, p_main_reason, p_other_reasons, p_reason_title, p_notes, p_how_we_know, p_joined_other_church, p_open_to_follow_up);
  else
    delete from public.department_memberships where user_id = auth.uid();

    update public.profiles
    set removed_at = now(), removed_by = auth.uid(), removed_reason = 'Left voluntarily', global_role = null
    where id = auth.uid() and removed_at is null;
  end if;
end;
$$;

revoke all on function public.leave_church(public.exit_reason, public.exit_reason[], text, text, public.exit_how_we_know, text, boolean) from public;
grant execute on function public.leave_church(public.exit_reason, public.exit_reason[], text, text, public.exit_how_we_know, text, boolean) to authenticated;

create or replace function public.remove_user_from_church(
  target_user_id uuid,
  p_main_reason public.exit_reason default 'unknown',
  p_other_reasons public.exit_reason[] default '{}',
  p_reason_title text default null,
  p_notes text default null,
  p_how_we_know public.exit_how_we_know default null,
  p_joined_other_church text default null,
  p_open_to_follow_up boolean default false
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_member_id uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Only a Super Admin can remove a user from the church';
  end if;
  if (select tenant_id from public.profiles where id = target_user_id) is distinct from public.current_tenant_id() then
    raise exception 'User not found';
  end if;

  select id into v_member_id from public.members where profile_id = target_user_id;

  if v_member_id is not null then
    perform public.record_member_exit(v_member_id, p_main_reason, p_other_reasons, p_reason_title, p_notes, p_how_we_know, p_joined_other_church, p_open_to_follow_up);
  else
    delete from public.department_memberships where user_id = target_user_id;

    update public.profiles
    set removed_at = now(), removed_by = auth.uid(), global_role = null
    where id = target_user_id;
  end if;
end;
$function$;

revoke all on function public.remove_user_from_church(uuid, public.exit_reason, public.exit_reason[], text, text, public.exit_how_we_know, text, boolean) from public;
grant execute on function public.remove_user_from_church(uuid, public.exit_reason, public.exit_reason[], text, text, public.exit_how_we_know, text, boolean) to authenticated;

create or replace function public.reinstate_user(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_super_admin() then
    raise exception 'Only a Super Admin can reinstate a user';
  end if;
  if (select tenant_id from public.profiles where id = target_user_id) is distinct from public.current_tenant_id() then
    raise exception 'User not found';
  end if;

  if exists (select 1 from public.profiles where id = target_user_id and permanently_deleted_at is not null) then
    raise exception 'This user was permanently deleted after the 60-day grace period and can no longer be reinstated';
  end if;

  update public.profiles
  set removed_at = null, removed_by = null
  where id = target_user_id;

  update public.members set status = 'Member' where profile_id = target_user_id and status = 'Left';
end;
$function$;

select pg_notify('pgrst', 'reload schema');

commit;
