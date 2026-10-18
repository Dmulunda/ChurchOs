-- Lets a guest visitor check themselves in directly, no account
-- needed -- scanning a Welcoming & Socialisation member's displayed
-- QR code (js/components/guestCheckinQrModal.js) opens
-- guest-checkin.html?d=<today>&church=<slug>
-- (js/publicGuestCheckin.js), which calls this RPC. Mirrors
-- register_for_event()'s exact shape (sql/saas_platform/79_events.sql):
-- security definer, resolves tenant from an authenticated session if
-- there is one, else from the slug the public link carries (there
-- never will be a session here in practice, but matching that
-- function's dual-mode shape costs nothing and keeps the two public-
-- registration RPCs consistent).
--
-- service_date is always current_date, hardcoded server-side --
-- nothing the client sends ever controls it, so a stale/reused QR
-- link can never backdate a record even if someone bypasses the
-- public page's own "this code has expired" client-side check.
--
-- Inserting a guest row here fires the exact same
-- notify_guest_attendance() trigger a staff-entered guest already
-- triggers -- auto-creates a pastoral-care lead, auto-assigned to
-- Welcoming & Socialisation. That trigger DOES need a fix below,
-- though: it inserts into guest_follow_ups/guest_follow_up_transfers
-- without listing tenant_id, relying on those columns' default
-- (current_tenant_id(), which reads auth.uid()) -- fine for a staff
-- member's own authenticated insert, but auth.uid() is null for this
-- RPC's anonymous caller, so that default would resolve to null and
-- fail the not-null constraint. Patched to pass new.tenant_id through
-- explicitly instead, which also happens to fix a latent cross-tenant
-- bug in the trigger's own dedupe check (it matched an existing guest
-- lead by name alone, with no tenant_id filter at all).

begin;

create or replace function public.submit_guest_checkin(
  p_tenant_slug text,
  p_guest_name text,
  p_service_type text,
  p_guest_phone text default null,
  p_guest_email text default null
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

  insert into public.attendance_records (tenant_id, service_date, service_type, guest_name, guest_phone, guest_email)
  values (v_tenant_id, current_date, p_service_type::service_type, trim(p_guest_name), nullif(trim(p_guest_phone), ''), nullif(trim(p_guest_email), ''))
  returning id into v_record_id;

  return jsonb_build_object('id', v_record_id);
end;
$$;

revoke all on function public.submit_guest_checkin(text, text, text, text, text) from public;
grant execute on function public.submit_guest_checkin(text, text, text, text, text) to anon, authenticated;

create or replace function public.notify_guest_attendance()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_lead_id uuid;
  v_welcoming_dept_id uuid;
begin
  if new.guest_name is not null and not exists (
    select 1 from public.guest_follow_ups
    where lower(trim(full_name)) = lower(trim(new.guest_name))
      and status <> 'assigned_to_department'
      and created_at > now() - interval '30 days'
      and tenant_id = new.tenant_id
  ) then
    select id into v_welcoming_dept_id from public.departments where key = 'welcoming_socialisation' and tenant_id = new.tenant_id;

    insert into public.guest_follow_ups (
      tenant_id, full_name, phone, email, city, referral_source, referred_by_name,
      age_range, prayer_request, wants_pastor_meeting, home_church,
      assigned_department_id, source, created_by
    )
    values (
      new.tenant_id, new.guest_name, new.guest_phone, new.guest_email, new.guest_city,
      new.guest_referral_source, new.guest_referred_by_name,
      new.guest_age_range, new.guest_prayer_request,
      new.guest_wants_pastor_meeting, new.guest_home_church,
      v_welcoming_dept_id, 'attendance_checkin', new.recorded_by
    )
    returning id into v_lead_id;

    if v_welcoming_dept_id is not null then
      insert into public.guest_follow_up_transfers (tenant_id, guest_follow_up_id, from_department_id, to_department_id, note, transferred_by)
      values (new.tenant_id, v_lead_id, null, v_welcoming_dept_id, 'Initial intake', new.recorded_by);
    end if;
  end if;
  return new;
end;
$function$;

commit;

select pg_notify('pgrst', 'reload schema');
