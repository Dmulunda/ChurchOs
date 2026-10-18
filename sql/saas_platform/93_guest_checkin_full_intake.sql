-- Expands submit_guest_checkin() (sql/92) to collect the same full
-- guest-intake detail the staff-side form already does
-- (js/components/attendanceManager.js) -- city, referral source, who
-- referred them, age range, prayer request, pastor-meeting request,
-- home church -- instead of just name/phone/email, so the person
-- self-checking in on their own phone can supply this directly rather
-- than a staff member asking for it later. All new fields stay
-- optional, same as the staff form itself; attendance_records already
-- has every one of these columns (sql/041), nothing new to add there.
--
-- Changing the parameter list means this is a genuinely new function
-- signature, not a like-for-like replace -- drop the old 5-arg
-- version explicitly first so it doesn't linger as an orphaned,
-- still-anon-callable overload.

begin;

drop function if exists public.submit_guest_checkin(text, text, text, text, text);

create or replace function public.submit_guest_checkin(
  p_tenant_slug text,
  p_guest_name text,
  p_service_type text,
  p_guest_phone text default null,
  p_guest_email text default null,
  p_guest_city text default null,
  p_guest_referral_source text default null,
  p_guest_referred_by_name text default null,
  p_guest_age_range text default null,
  p_guest_prayer_request text default null,
  p_guest_wants_pastor_meeting boolean default false,
  p_guest_home_church text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_tenant_id uuid;
  v_record_id uuid;
begin
  if auth.uid() is not null then
    v_tenant_id := public.current_tenant_id();
  else
    select id into v_tenant_id from public.tenants where slug = p_tenant_slug;
    if v_tenant_id is null then
      raise exception 'Church not found';
    end if;
  end if;

  if coalesce(trim(p_guest_name), '') = '' then
    raise exception 'Name is required';
  end if;
  if p_service_type not in ('sunday_service', 'midweek_service', 'special_service') then
    raise exception 'Invalid service type';
  end if;

  insert into public.attendance_records (
    tenant_id, service_date, service_type, guest_name, guest_phone, guest_email,
    guest_city, guest_referral_source, guest_referred_by_name, guest_age_range,
    guest_prayer_request, guest_wants_pastor_meeting, guest_home_church
  )
  values (
    v_tenant_id, current_date, p_service_type::service_type, trim(p_guest_name),
    nullif(trim(p_guest_phone), ''), nullif(trim(p_guest_email), ''),
    nullif(trim(p_guest_city), ''), nullif(trim(p_guest_referral_source), ''),
    nullif(trim(p_guest_referred_by_name), ''), nullif(trim(p_guest_age_range), ''),
    nullif(trim(p_guest_prayer_request), ''), coalesce(p_guest_wants_pastor_meeting, false),
    nullif(trim(p_guest_home_church), '')
  )
  returning id into v_record_id;

  return jsonb_build_object('id', v_record_id);
end;
$$;

revoke all on function public.submit_guest_checkin(text, text, text, text, text, text, text, text, text, text, boolean, text) from public;
grant execute on function public.submit_guest_checkin(text, text, text, text, text, text, text, text, text, text, boolean, text) to anon, authenticated;

commit;

select pg_notify('pgrst', 'reload schema');
