-- Small groups / cell groups (feature 4 of the improvement roadmap).
--
-- Home groups with a leader (and optional co-leader), a meeting day,
-- time and place, members, and a weekly meeting log: who attended, how
-- many guests, and a short report the pastoral team reads.
--
-- Who can do what (RLS):
--   * Pastoral team (super_admin, pastor_admin, church_secretary) --
--     everything: create/edit/archive groups, assign leaders, manage
--     members, read every report.
--   * A group's leader/co-leader -- manage that group's members and log
--     its meetings.
--   * Members -- see the list of groups, their own group's members and
--     meeting history.

begin;

-- public.is_pastoral_team() already exists (super_admin, pastor_admin,
-- church_secretary, or can_manage_pastoral_cases) and is reused as-is.

create table if not exists public.small_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  description text,
  leader_id uuid references public.profiles(id) on delete set null,
  co_leader_id uuid references public.profiles(id) on delete set null,
  meeting_day smallint check (meeting_day between 0 and 6), -- 0 = Sunday
  meeting_time time,
  location text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists small_groups_tenant_idx on public.small_groups (tenant_id);

create table if not exists public.small_group_members (
  group_id uuid not null references public.small_groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists small_group_members_user_idx on public.small_group_members (user_id);

create table if not exists public.small_group_meetings (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.small_groups(id) on delete cascade,
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  meeting_date date not null,
  attendee_ids uuid[] not null default '{}',
  guest_count integer not null default 0 check (guest_count between 0 and 500),
  report text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (group_id, meeting_date)
);

create or replace function public.is_small_group_leader(p_group_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (select 1 from public.small_groups g
                 where g.id = p_group_id and g.tenant_id = public.current_tenant_id()
                   and auth.uid() in (g.leader_id, g.co_leader_id));
$$;
grant execute on function public.is_small_group_leader(uuid) to authenticated;

create or replace function public.is_small_group_member(p_group_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (select 1 from public.small_group_members m where m.group_id = p_group_id and m.user_id = auth.uid());
$$;
grant execute on function public.is_small_group_member(uuid) to authenticated;

alter table public.small_groups enable row level security;
alter table public.small_group_members enable row level security;
alter table public.small_group_meetings enable row level security;

drop policy if exists "church reads small groups" on public.small_groups;
create policy "church reads small groups" on public.small_groups
  for select to authenticated using (tenant_id = public.current_tenant_id());
drop policy if exists "pastoral team manages small groups" on public.small_groups;
create policy "pastoral team manages small groups" on public.small_groups
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_pastoral_team())
  with check (tenant_id = public.current_tenant_id() and public.is_pastoral_team());
drop policy if exists "leaders edit their group details" on public.small_groups;
create policy "leaders edit their group details" on public.small_groups
  for update to authenticated
  using (tenant_id = public.current_tenant_id() and auth.uid() in (leader_id, co_leader_id))
  with check (tenant_id = public.current_tenant_id());

drop policy if exists "group people read members" on public.small_group_members;
create policy "group people read members" on public.small_group_members
  for select to authenticated using (
    tenant_id = public.current_tenant_id()
    and (public.is_pastoral_team() or public.is_small_group_leader(group_id) or public.is_small_group_member(group_id)));
drop policy if exists "leaders and pastoral team manage members" on public.small_group_members;
create policy "leaders and pastoral team manage members" on public.small_group_members
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and (public.is_pastoral_team() or public.is_small_group_leader(group_id)))
  with check (tenant_id = public.current_tenant_id() and (public.is_pastoral_team() or public.is_small_group_leader(group_id)));

drop policy if exists "group people read meetings" on public.small_group_meetings;
create policy "group people read meetings" on public.small_group_meetings
  for select to authenticated using (
    tenant_id = public.current_tenant_id()
    and (public.is_pastoral_team() or public.is_small_group_leader(group_id) or public.is_small_group_member(group_id)));
drop policy if exists "leaders and pastoral team log meetings" on public.small_group_meetings;
create policy "leaders and pastoral team log meetings" on public.small_group_meetings
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and (public.is_pastoral_team() or public.is_small_group_leader(group_id)))
  with check (tenant_id = public.current_tenant_id() and (public.is_pastoral_team() or public.is_small_group_leader(group_id)));

commit;

select pg_notify('pgrst', 'reload schema');
