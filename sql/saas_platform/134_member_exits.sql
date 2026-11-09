-- Member Exit Tracking (Feature 3 of 3, part 1): a fixed reason
-- taxonomy + member_exits, and record_member_exit() as the single
-- insert path into it.
--
-- Access tier (decided during planning): the whole table, notes
-- included, is pastors-only (is_pastoral_team()) -- RLS is row-level,
-- not column-level, so "notes private to pastors" collapses to the
-- whole table being pastors-only rather than a redacting view. This
-- is narrower than the Member Directory itself (is_pastoral_team() OR
-- is_church_admin()), which is fine: church admins already can't open
-- the Directory tool client-side today (js/toolsPage.js gates it on
-- isPastoralTeam), so there's no UI that would need exit access they
-- don't have.
--
-- record_member_exit() absorbs the profiles-side cleanup that used to
-- live separately in leave_church() and remove_user_from_church()
-- (sql/saas_platform/108_leave_church.sql, sql/saas_platform/
-- 06_rpc_tenant_fixes.sql) -- both become thin wrappers that look up
-- the caller's/target's members row and delegate here, so there is
-- exactly one place that writes an exit record. Its own authorization
-- check (pastoral team, OR super admin, OR the member themselves)
-- covers both the admin "Mark as left" path and the self-service
-- "Leave this church" path without either wrapper needing to bypass
-- it.
begin;

create type public.exit_reason as enum (
  'needs_not_met', 'changes_disliked', 'leadership_pastor', 'doctrine_political',
  'moved_away', 'conflict_with_members', 'felt_out_of_place', 'family_life_change',
  'other', 'unknown'
);

create type public.exit_how_we_know as enum (
  'exit_conversation', 'message', 'told_by_someone', 'assumed'
);

create table public.member_exits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict default public.current_tenant_id(),
  member_id uuid not null references public.members(id) on delete cascade,
  date_left date not null default current_date,
  main_reason public.exit_reason not null,
  other_reasons public.exit_reason[] not null default '{}',
  reason_title text check (length(reason_title) <= 80),
  notes text,
  how_we_know public.exit_how_we_know,
  joined_other_church text check (joined_other_church in ('yes', 'no', 'unknown')),
  open_to_follow_up boolean not null default false,
  recorded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index member_exits_tenant_id_idx on public.member_exits (tenant_id);
create index member_exits_member_id_idx on public.member_exits (member_id);
create index member_exits_date_left_idx on public.member_exits (tenant_id, date_left);

create trigger force_updated_at before insert or update on public.member_exits
  for each row execute function public.force_server_timestamp_updated_at();

alter table public.member_exits enable row level security;

create policy "member exits are pastors-only" on public.member_exits
  for all to authenticated
  using (is_pastoral_team())
  with check (is_pastoral_team());
create policy "tenant_isolation" on public.member_exits as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

create or replace function public.record_member_exit(
  p_member_id uuid,
  p_main_reason public.exit_reason,
  p_other_reasons public.exit_reason[] default '{}',
  p_reason_title text default null,
  p_notes text default null,
  p_how_we_know public.exit_how_we_know default null,
  p_joined_other_church text default null,
  p_open_to_follow_up boolean default false
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_member public.members%rowtype;
  v_exit_id uuid;
begin
  select * into v_member from public.members
  where id = p_member_id and tenant_id = public.current_tenant_id();

  if v_member.id is null then
    raise exception 'Member not found';
  end if;

  if not (
    public.is_pastoral_team()
    or public.is_super_admin()
    or (auth.uid() is not null and auth.uid() = v_member.profile_id)
  ) then
    raise exception 'Not authorized to record this exit';
  end if;

  if p_reason_title is not null and length(p_reason_title) > 80 then
    raise exception 'Reason title must be 80 characters or less';
  end if;

  insert into public.member_exits (
    tenant_id, member_id, main_reason, other_reasons, reason_title,
    notes, how_we_know, joined_other_church, open_to_follow_up, recorded_by
  )
  values (
    v_member.tenant_id, p_member_id, p_main_reason, coalesce(p_other_reasons, '{}'), p_reason_title,
    p_notes, p_how_we_know, p_joined_other_church, coalesce(p_open_to_follow_up, false), auth.uid()
  )
  returning id into v_exit_id;

  update public.members set status = 'Left' where id = p_member_id;

  if v_member.profile_id is not null then
    delete from public.department_memberships where user_id = v_member.profile_id;

    update public.profiles
    set removed_at = now(), removed_by = auth.uid(), removed_reason = coalesce(p_reason_title, p_main_reason::text), global_role = null
    where id = v_member.profile_id and removed_at is null;
  end if;

  return v_exit_id;
end;
$$;

revoke all on function public.record_member_exit(uuid, public.exit_reason, public.exit_reason[], text, text, public.exit_how_we_know, text, boolean) from public;
grant execute on function public.record_member_exit(uuid, public.exit_reason, public.exit_reason[], text, text, public.exit_how_we_know, text, boolean) to authenticated;

select pg_notify('pgrst', 'reload schema');

commit;
