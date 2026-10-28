-- Real bug, not new scope: the "Note (optional)" field on the guest
-- check-in form (attendance_records.note) was never copied anywhere
-- -- notify_guest_attendance() builds the guest_follow_ups row from
-- every OTHER guest_* field on the attendance row, but not this one.
-- Whatever a staff member typed there at check-in time was captured,
-- then silently discarded -- invisible in the Guest Onboarding Hub,
-- invisible in the Silent Directory, invisible everywhere. Re-declares
-- notify_guest_attendance() in full (same body as sql/112, this is
-- now the third time -- the one from sql/112 adding the Silent-
-- profile auto-provisioning call) with one line added: the check-in
-- note now lands in guest_follow_ups.notes (the Hub's existing
-- "General Note" field), so it survives and is actually visible.
create or replace function public.notify_guest_attendance()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_lead_id uuid;
  v_welcoming_dept_id uuid;
  v_secret text;
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
      age_range, prayer_request, wants_pastor_meeting, home_church, notes,
      assigned_department_id, source, created_by
    )
    values (
      new.tenant_id, new.guest_name, new.guest_phone, new.guest_email, new.guest_city,
      new.guest_referral_source, new.guest_referred_by_name,
      new.guest_age_range, new.guest_prayer_request,
      new.guest_wants_pastor_meeting, new.guest_home_church, new.note,
      v_welcoming_dept_id, 'attendance_checkin', new.recorded_by
    )
    returning id into v_lead_id;

    if v_welcoming_dept_id is not null then
      insert into public.guest_follow_up_transfers (tenant_id, guest_follow_up_id, from_department_id, to_department_id, note, transferred_by)
      values (new.tenant_id, v_lead_id, null, v_welcoming_dept_id, 'Initial intake', new.recorded_by);
    end if;

    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'offering_cron_secret';
    if v_secret is not null then
      perform net.http_post(
        url := 'https://towlqbxvhftzjfrtepsy.supabase.co/functions/v1/provision-guest-silent-profile',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
        body := jsonb_build_object('guest_follow_up_id', v_lead_id)
      );
    end if;
  end if;
  return new;
end;
$function$;

select pg_notify('pgrst', 'reload schema');
