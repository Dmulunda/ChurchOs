-- 171: "Mon prochain service" on the new Home page (Main 163), for many
-- churches: department names come from the caller's own church and
-- "today" uses the church's time zone.
--
-- One call returns the signed-in person's upcoming serving dates from
-- every scheduling board (department shifts, Choir services, Media &
-- Tech, Sunday school, moderating a service), so Home doesn't need five
-- separate queries with five different shapes. Only the caller's own
-- rows (auth.uid()), never anyone else's.
--
-- confirm_my_service() is the Home page's "Je confirme" button: it only
-- ever sets the caller's OWN pending row to approved, the same change the
-- boards' own Accept buttons make. Declining keeps going through each
-- board's existing flow (it asks for a reason), so it isn't offered here.

create or replace function public.get_my_upcoming_services(p_limit integer default 5)
returns table (kind text, ref_id uuid, service_date date, department_key text, department_name text, title text, status text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with me as (select auth.uid() as uid),
  tz as (select coalesce((select t.live_timezone from tenants t where t.id = public.current_tenant_id()), 'America/Toronto') as z),
  today as (select (now() at time zone (select z from tz))::date as d),
  rows as (
    select 'shift'::text as kind, a.id as ref_id, s.date as service_date, d.key as department_key, d.name as department_name,
           nullif(s.title, '') as title, a.status
    from department_shift_assignments a
    join department_shifts s on s.id = a.shift_id
    join departments d on d.id = s.department_id
    where a.user_id = (select uid from me) and a.status <> 'declined'
    union all
    select 'choir', r.id, p.date, 'choir', coalesce((select name from departments where key = 'choir' and tenant_id = public.current_tenant_id()), 'Choir'),
           nullif(p.title, ''), r.status::text
    from service_rsvps r
    join service_plans p on p.id = r.service_plan_id
    where r.singer_id = (select uid from me) and r.status::text <> 'declined' and p.status::text = 'published'
    union all
    select 'media_tech', m.id, m.date, 'media_tech', coalesce((select name from departments where key = 'media_tech' and tenant_id = public.current_tenant_id()), 'Media & Tech'),
           m.role::text, m.status
    from media_tech_assignments m
    where m.user_id = (select uid from me) and m.status <> 'declined'
    union all
    select 'ecodem', w.id, s.date, 'ecodem', coalesce((select name from departments where key = 'ecodem' and tenant_id = public.current_tenant_id()), 'Sunday school'),
           nullif(s.topic, ''), w.status
    from ecodem_session_workers w
    join ecodem_sessions s on s.id = w.session_id
    where w.user_id = (select uid from me) and w.status <> 'declined'
    union all
    select 'moderator', ps.id, ps.date, 'preaching', coalesce((select name from departments where key = 'preaching' and tenant_id = public.current_tenant_id()), 'Preaching'),
           'moderator', coalesce(ps.moderator_status, 'pending')
    from preaching_schedule ps
    where ps.moderator_id = (select uid from me) and coalesce(ps.moderator_status, 'pending') <> 'declined'
    union all
    select 'preacher', ps.id, ps.date, 'preaching', coalesce((select name from departments where key = 'preaching' and tenant_id = public.current_tenant_id()), 'Preaching'),
           coalesce(nullif(ps.sermon_theme, ''), 'preacher'), 'approved'
    from preaching_schedule ps
    where ps.preacher_id = (select uid from me)
  )
  select kind, ref_id, service_date, department_key, department_name, title, status
  from rows
  where service_date >= (select d from today)
  order by service_date, kind
  limit greatest(1, least(coalesce(p_limit, 5), 20));
$$;

create or replace function public.confirm_my_service(p_kind text, p_ref_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_n integer := 0;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  if p_kind = 'shift' then
    update department_shift_assignments set status = 'approved', responded_at = now()
    where id = p_ref_id and user_id = v_uid and status = 'pending';
  elsif p_kind = 'choir' then
    update service_rsvps set status = 'approved', responded_at = now()
    where id = p_ref_id and singer_id = v_uid and status = 'pending';
  elsif p_kind = 'media_tech' then
    update media_tech_assignments set status = 'approved', responded_at = now()
    where id = p_ref_id and user_id = v_uid and status = 'pending';
  elsif p_kind = 'ecodem' then
    update ecodem_session_workers set status = 'approved', responded_at = now()
    where id = p_ref_id and user_id = v_uid and status = 'pending';
  elsif p_kind = 'moderator' then
    update preaching_schedule set moderator_status = 'approved', moderator_responded_at = now()
    where id = p_ref_id and moderator_id = v_uid and coalesce(moderator_status, 'pending') = 'pending';
  else
    raise exception 'unknown kind %', p_kind;
  end if;

  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

revoke all on function public.get_my_upcoming_services(integer) from public, anon;
revoke all on function public.confirm_my_service(text, uuid) from public, anon;
grant execute on function public.get_my_upcoming_services(integer) to authenticated;
grant execute on function public.confirm_my_service(text, uuid) to authenticated;
