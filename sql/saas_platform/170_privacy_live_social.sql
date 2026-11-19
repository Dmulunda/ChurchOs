-- 170: features brought over from Main (Main sql 157-160, 162, 164, 166-168),
-- adapted for many churches. Each church's settings live on its own
-- tenants row instead of Main's single church_branding row.
--
-- 1) Member privacy (Main 157): guests (no approved department, no global
--    role, not marked member) only see their own profile; private fields
--    are read through get_profiles_private() / get_card_pastor_signature().
--    Small groups (often a home address) are readable by members only.
create or replace function public.is_church_member()
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
           select 1 from public.profiles p
           where p.id = auth.uid() and p.removed_at is null
             and (p.global_role is not null or p.user_status = 'member'))
      or exists (
           select 1 from public.department_memberships m
           where m.user_id = auth.uid() and m.status = 'approved')
      or public.is_church_admin();
$$;
revoke all on function public.is_church_member() from public;
grant execute on function public.is_church_member() to authenticated;
revoke execute on function public.is_church_member() from anon;

drop policy if exists "profiles are readable by authenticated users" on public.profiles;
drop policy if exists "members read profiles, guests read only themselves" on public.profiles;
create policy "members read profiles, guests read only themselves"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_church_member()));

create or replace function public.get_profiles_private(p_ids uuid[])
returns table (id uuid, address text, birth_country text, birth_city text, legal_name text, signature_data text)
language sql stable security definer set search_path = public, pg_temp
as $$
  select p.id, p.address, p.birth_country, p.birth_city, p.legal_name, p.signature_data
  from public.profiles p
  where p.id = any (p_ids)
    and p.tenant_id = public.current_tenant_id()
    and (
      p.id = auth.uid()
      or public.is_pastoral_team()
      or public.is_church_admin()
      or exists (select 1 from public.profiles me where me.id = auth.uid() and me.global_role is not null)
      or exists (select 1 from public.department_memberships m
                 where m.user_id = p.id and m.status = 'approved' and public.can_manage_department(m.department_id))
    );
$$;
revoke all on function public.get_profiles_private(uuid[]) from public;
grant execute on function public.get_profiles_private(uuid[]) to authenticated;
revoke execute on function public.get_profiles_private(uuid[]) from anon;

create or replace function public.get_card_pastor_signature()
returns text
language sql stable security definer set search_path = public, pg_temp
as $$
  select p.signature_data from public.profiles p
  where public.is_church_member() and p.tenant_id = public.current_tenant_id()
    and p.member_title = 'pastor_principal' and p.removed_at is null
  limit 1;
$$;
revoke all on function public.get_card_pastor_signature() from public;
grant execute on function public.get_card_pastor_signature() to authenticated;
revoke execute on function public.get_card_pastor_signature() from anon;

drop policy if exists "church reads small groups" on public.small_groups;
drop policy if exists "members read small groups" on public.small_groups;
create policy "members read small groups" on public.small_groups for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.is_church_member()));

-- 2) Social links, live channel schedule (Main 159, 162, 164) on tenants.
--    Each church fills its own; nothing is preset.
alter table public.tenants
  add column if not exists website_url text,
  add column if not exists facebook_url text,
  add column if not exists youtube_url text,
  add column if not exists instagram_url text,
  add column if not exists tiktok_url text,
  add column if not exists whatsapp_url text,
  add column if not exists live_schedule jsonb not null default '[]'::jsonb,
  add column if not exists live_timezone text not null default 'America/Toronto';
alter table public.tenants drop constraint if exists tenants_social_https;
alter table public.tenants add constraint tenants_social_https check (
      (website_url   is null or website_url   ~ '^https://[^\s]+$')
  and (facebook_url  is null or facebook_url  ~ '^https://[^\s]+$')
  and (youtube_url   is null or youtube_url   ~ '^https://[^\s]+$')
  and (instagram_url is null or instagram_url ~ '^https://[^\s]+$')
  and (tiktok_url    is null or tiktok_url    ~ '^https://[^\s]+$')
  and (whatsapp_url  is null or whatsapp_url  ~ '^https://[^\s]+$'));
alter table public.tenants drop constraint if exists tenants_live_schedule_array;
alter table public.tenants add constraint tenants_live_schedule_array
  check (jsonb_typeof(live_schedule) = 'array' and jsonb_array_length(live_schedule) <= 14);

-- 3) Cache for the live-status function (Main 160), one row per church,
--    written only by the edge function with the service role.
create table if not exists public.live_status_cache (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  source_url text,
  channel_id text,
  payload jsonb not null default '{}'::jsonb,
  checked_at timestamptz not null default 'epoch'
);
alter table public.live_status_cache enable row level security;
revoke all on public.live_status_cache from anon, authenticated;

-- 4) Church calendar (Main 164): shows the church program at the weekly
--    service time (with the address, or "Online" for online-only
--    services); department duty rosters only for departments flagged
--    is_public_calendar; Choir service plans no longer listed.
create or replace function public.get_church_calendar(p_from date, p_to date, p_tenant uuid default null)
returns table(kind text, ref_id uuid, title text, starts_at timestamptz, ends_at timestamptz, all_day boolean, location text, department_id uuid, visibility text, created_by uuid)
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_tenant uuid;
  v_leader boolean;
  v_schedule jsonb;
  v_address text;
  v_tz text;
begin
  if p_tenant is not null then
    if auth.role() <> 'service_role' then raise exception 'not allowed'; end if;
    v_tenant := p_tenant; v_leader := false;
  else
    v_tenant := public.current_tenant_id(); v_leader := public.is_church_leader();
  end if;
  if v_tenant is null or p_to < p_from or p_to - p_from > 400 then return; end if;

  select coalesce(t.live_schedule, '[]'::jsonb), t.address, coalesce(t.live_timezone, 'America/Toronto')
    into v_schedule, v_address, v_tz
  from public.tenants t where t.id = v_tenant;
  v_schedule := coalesce(v_schedule, '[]'::jsonb);

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
  select 'program', pd.id, p.title,
         case when slot.time is not null then ((pd.date + slot.time) at time zone v_tz) else pd.date::timestamptz end,
         case when slot.time is not null then ((pd.date + slot.time + interval '2 hours') at time zone v_tz) else pd.date::timestamptz end,
         slot.time is null,
         case when slot.online_only then 'En ligne / Online' else v_address end,
         null::uuid, 'church', p.created_by
  from public.church_program_dates pd
  join public.church_programs p on p.id = pd.program_id
  left join lateral (
    select (s->>'time')::time as time, coalesce((s->>'online_only')::boolean, false) as online_only
    from jsonb_array_elements(v_schedule) s
    where (s->>'day')::int = extract(dow from pd.date)::int and (s->>'time') ~ '^\d{2}:\d{2}$'
    order by s->>'time' limit 1
  ) slot on true
  where pd.tenant_id = v_tenant and pd.date between p_from and p_to
  union all
  select distinct on (ds.department_id, ds.date, ds.title) 'shift', ds.id, d.name || ' — ' || coalesce(nullif(ds.title, ''), 'Service'),
         ds.date::timestamptz, ds.date::timestamptz, true, null::text, ds.department_id, 'church', ds.created_by
  from public.department_shifts ds join public.departments d on d.id = ds.department_id
  where ds.tenant_id = v_tenant and ds.date between p_from and p_to and d.is_public_calendar
  union all
  select 'group', g.id, g.name,
         ((gs.d + coalesce(g.meeting_time, time '19:00')) at time zone v_tz),
         ((gs.d + coalesce(g.meeting_time, time '19:00') + interval '90 minutes') at time zone v_tz),
         false, g.location, null, 'church', null
  from public.small_groups g
  cross join lateral generate_series(p_from, p_to, interval '1 day') as gs(d)
  where g.tenant_id = v_tenant and g.archived_at is null and g.meeting_day is not null
    and extract(dow from gs.d) = g.meeting_day;
end;
$function$;

-- 5) Sermon clip inside a livestream (Main 166).
alter table public.sermons
  add column if not exists video_start_seconds integer,
  add column if not exists video_end_seconds integer;
alter table public.sermons drop constraint if exists sermons_video_clip_check;
alter table public.sermons add constraint sermons_video_clip_check check (
  (video_start_seconds is null or video_start_seconds >= 0)
  and (video_end_seconds is null or video_end_seconds > 0)
  and (video_start_seconds is null or video_end_seconds is null or video_end_seconds > video_start_seconds));

-- 6) Media & Tech members read and edit the song library (Main 167).
create or replace function public.is_media_tech_member()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_super_admin() or exists (
    select 1 from public.department_memberships m
    join public.departments d on d.id = m.department_id
    where m.user_id = auth.uid() and d.key = 'media_tech' and m.status = 'approved'
      and d.tenant_id = public.current_tenant_id());
$$;
revoke all on function public.is_media_tech_member() from public, anon;
grant execute on function public.is_media_tech_member() to authenticated;
drop policy if exists "media team reads songs" on public.songs;
create policy "media team reads songs" on public.songs for select using (public.is_media_tech_member());
drop policy if exists "media team adds songs" on public.songs;
create policy "media team adds songs" on public.songs for insert with check (public.is_media_tech_member());
drop policy if exists "media team edits songs" on public.songs;
create policy "media team edits songs" on public.songs for update using (public.is_media_tech_member()) with check (public.is_media_tech_member());

-- 7) Supplies for every department (Main 168).
drop policy if exists "cleaning admins manage supplies" on public.department_supplies;
drop policy if exists "cleaning members read supplies" on public.department_supplies;
drop policy if exists "department admins manage supplies" on public.department_supplies;
drop policy if exists "department members read supplies" on public.department_supplies;
create policy "department admins manage supplies" on public.department_supplies for all
  using (public.can_write_department(department_id)) with check (public.can_write_department(department_id));
create policy "department members read supplies" on public.department_supplies for select
  using (public.can_read_department(department_id));
