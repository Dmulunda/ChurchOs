-- Church calendar and room booking (feature 5 of the improvement roadmap).
--
-- One calendar that merges what already exists -- events, department
-- schedules (department_shifts), choir services (service_plans) and small
-- group meetings (weekly, from small_groups, sql/148) -- with new
-- calendar_items: meetings, rehearsals, room bookings. Rooms can't be
-- double-booked (trigger below). A private iCal link lets anyone on the
-- pastoral team subscribe in Google Calendar / Outlook / Apple Calendar
-- (calendar-feed edge function).
--
-- Visibility: 'church' items are for everyone; 'leaders' items only for
-- the pastoral team and department admins/secretaries.

begin;

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  capacity integer check (capacity is null or capacity > 0),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create table if not exists public.calendar_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 150),
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  room_id uuid references public.rooms(id) on delete set null,
  department_id uuid references public.departments(id) on delete set null,
  visibility text not null default 'church' check (visibility in ('church', 'leaders')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at and ends_at - starts_at <= interval '14 days')
);
create index if not exists calendar_items_tenant_start_idx on public.calendar_items (tenant_id, starts_at);
create index if not exists calendar_items_room_idx on public.calendar_items (room_id, starts_at) where room_id is not null;

create table if not exists public.calendar_feed_tokens (
  tenant_id uuid primary key default public.current_tenant_id() references public.tenants(id) on delete cascade,
  token uuid not null default gen_random_uuid() unique,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Leaders = pastoral team or any department admin/secretary.
create or replace function public.is_church_leader()
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select public.is_pastoral_team() or exists (
    select 1 from public.department_memberships dm
    where dm.user_id = auth.uid() and dm.status = 'approved' and dm.role in ('admin', 'secretary')
      and dm.tenant_id = public.current_tenant_id());
$$;
grant execute on function public.is_church_leader() to authenticated;

-- A room can't hold two bookings at the same time.
create or replace function public.prevent_room_double_booking()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_conflict text;
begin
  if new.room_id is null then return new; end if;
  select c.title into v_conflict from public.calendar_items c
  where c.room_id = new.room_id and c.id <> new.id
    and c.starts_at < new.ends_at and c.ends_at > new.starts_at
  limit 1;
  if v_conflict is not null then
    raise exception 'ROOM_BOOKED: %', v_conflict using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists calendar_items_room_check on public.calendar_items;
create trigger calendar_items_room_check before insert or update of room_id, starts_at, ends_at on public.calendar_items
for each row execute function public.prevent_room_double_booking();

alter table public.rooms enable row level security;
alter table public.calendar_items enable row level security;
alter table public.calendar_feed_tokens enable row level security;

drop policy if exists "church reads rooms" on public.rooms;
create policy "church reads rooms" on public.rooms for select to authenticated using (tenant_id = public.current_tenant_id());
drop policy if exists "pastoral team manages rooms" on public.rooms;
create policy "pastoral team manages rooms" on public.rooms for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_pastoral_team())
  with check (tenant_id = public.current_tenant_id() and public.is_pastoral_team());

drop policy if exists "read calendar items" on public.calendar_items;
create policy "read calendar items" on public.calendar_items for select to authenticated
  using (tenant_id = public.current_tenant_id() and (visibility = 'church' or public.is_church_leader()));
drop policy if exists "leaders add calendar items" on public.calendar_items;
create policy "leaders add calendar items" on public.calendar_items for insert to authenticated
  with check (tenant_id = public.current_tenant_id() and public.is_church_leader() and created_by = auth.uid());
drop policy if exists "creator or pastoral team edits calendar items" on public.calendar_items;
create policy "creator or pastoral team edits calendar items" on public.calendar_items for update to authenticated
  using (tenant_id = public.current_tenant_id() and (created_by = auth.uid() or public.is_pastoral_team()))
  with check (tenant_id = public.current_tenant_id());
drop policy if exists "creator or pastoral team deletes calendar items" on public.calendar_items;
create policy "creator or pastoral team deletes calendar items" on public.calendar_items for delete to authenticated
  using (tenant_id = public.current_tenant_id() and (created_by = auth.uid() or public.is_pastoral_team()));

drop policy if exists "pastoral team manages feed token" on public.calendar_feed_tokens;
create policy "pastoral team manages feed token" on public.calendar_feed_tokens for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_pastoral_team())
  with check (tenant_id = public.current_tenant_id() and public.is_pastoral_team());

-- Everything on the calendar between two dates, for one church. Called
-- by the app (p_tenant null -> the caller's church, leaders-only items
-- only for leaders) and by calendar-feed (service role, explicit tenant,
-- church-visible items only).
create or replace function public.get_church_calendar(p_from date, p_to date, p_tenant uuid default null)
returns table (kind text, ref_id uuid, title text, starts_at timestamptz, ends_at timestamptz, all_day boolean,
               location text, department_id uuid, visibility text, created_by uuid)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_leader boolean;
begin
  if p_tenant is not null then
    if auth.role() <> 'service_role' then raise exception 'not allowed'; end if;
    v_tenant := p_tenant; v_leader := false;
  else
    v_tenant := public.current_tenant_id(); v_leader := public.is_church_leader();
  end if;
  if v_tenant is null or p_to < p_from or p_to - p_from > 400 then return; end if;

  return query
  select 'item'::text, c.id, c.title, c.starts_at, c.ends_at, false, r.name, c.department_id, c.visibility, c.created_by
  from public.calendar_items c left join public.rooms r on r.id = c.room_id
  where c.tenant_id = v_tenant and c.starts_at < (p_to + 1)::timestamptz and c.ends_at >= p_from::timestamptz
    and (c.visibility = 'church' or v_leader)
  union all
  select 'event', e.id, e.title, e.start_at, coalesce(e.end_at, e.start_at + interval '2 hours'), false, e.location, e.organizing_department_id, 'church', e.created_by
  from public.events e
  where e.tenant_id = v_tenant and e.status = 'active' and e.start_at::date between p_from and p_to
  union all
  select distinct on (ds.department_id, ds.date, ds.title) 'shift', ds.id, d.name || ' — ' || coalesce(nullif(ds.title, ''), 'Service'),
         ds.date::timestamptz, ds.date::timestamptz, true, null::text, ds.department_id, 'church', ds.created_by
  from public.department_shifts ds join public.departments d on d.id = ds.department_id
  where ds.tenant_id = v_tenant and ds.date between p_from and p_to
  union all
  select 'choir', sp.id, 'Choir / Chorale — ' || coalesce(nullif(sp.title, ''), 'Service'), sp.date::timestamptz, sp.date::timestamptz, true, null, null, 'church', null
  from public.service_plans sp
  where sp.tenant_id = v_tenant and sp.date between p_from and p_to
  union all
  select 'group', g.id, g.name,
         ((gs.d + coalesce(g.meeting_time, time '19:00')) at time zone 'America/Toronto'),
         ((gs.d + coalesce(g.meeting_time, time '19:00') + interval '90 minutes') at time zone 'America/Toronto'),
         false, g.location, null, 'church', null
  from public.small_groups g
  cross join lateral generate_series(p_from, p_to, interval '1 day') as gs(d)
  where g.tenant_id = v_tenant and g.archived_at is null and g.meeting_day is not null
    and extract(dow from gs.d) = g.meeting_day;
end;
$$;
grant execute on function public.get_church_calendar(date, date, uuid) to authenticated, service_role;

commit;

select pg_notify('pgrst', 'reload schema');
