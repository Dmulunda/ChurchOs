-- Automatic reminders (feature 1 of the improvement roadmap).
--
-- A daily pg_cron job (send_due_reminders, 13:00 UTC = 8 AM Toronto)
-- reminds:
--   * people serving in 2 days -- department shifts
--     (department_shift_assignments, approved) and choir services
--     (service_rsvps, approved);
--   * both sides of a confirmed pastor meeting happening tomorrow
--     (the member who booked it, if they have an account, and the
--     pastor);
--   * members registered (with an account) for an event tomorrow.
--
-- Delivery reuses the existing notifications pipeline: every reminder is
-- a notifications row (in-app), notify_email_on_notification() emails it
-- (reminders default to email ON unless the person turned it off in
-- notification settings, unlike other types which default OFF), and the
-- same trigger now also asks send-push to deliver a Web Push for
-- reminder types. reminder_log makes the job idempotent: re-running it
-- the same day (or a manual run) never sends the same reminder twice.
--
-- Bilingual text: the in-app list localizes the "Reminder" label by type
-- client-side; title/body here carry both languages where the wording
-- isn't just names and dates, because the email goes out as-is.

alter type public.notification_type add value if not exists 'serve_reminder';
alter type public.notification_type add value if not exists 'meeting_reminder';
alter type public.notification_type add value if not exists 'event_reminder';

begin;

create table if not exists public.reminder_log (
  kind text not null check (kind in ('shift', 'choir', 'meeting', 'event')),
  ref_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (kind, ref_id, user_id)
);
-- Server-only bookkeeping: RLS on with no policies, so no client can
-- read or write it; the security definer job below is the only writer.
alter table public.reminder_log enable row level security;

create or replace function public.send_due_reminders()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer := 0;
  v_n integer;
begin
  -- 1) Department shifts, 2 days ahead.
  with due as (
    select dsa.id as ref_id, dsa.user_id, dsa.tenant_id, d.name as dept_name, ds.title, ds.date
    from public.department_shift_assignments dsa
    join public.department_shifts ds on ds.id = dsa.shift_id
    join public.departments d on d.id = ds.department_id
    join public.profiles p on p.id = dsa.user_id and p.removed_at is null
    where dsa.status = 'approved' and ds.date = current_date + 2
  ), logged as (
    insert into public.reminder_log (kind, ref_id, user_id, tenant_id)
    select 'shift', ref_id, user_id, tenant_id from due
    on conflict do nothing
    returning ref_id, user_id
  )
  insert into public.notifications (recipient_id, type, title, body, source_user_id, tenant_id)
  select due.user_id, 'serve_reminder', '⏰ ' || due.dept_name || ' — ' || coalesce(nullif(due.title, ''), 'Service'),
         'You serve on ' || to_char(due.date, 'FMDay, FMMonth FMDD') || ' / Vous servez le ' || to_char(due.date, 'DD/MM/YYYY'),
         null, due.tenant_id
  from due join logged on logged.ref_id = due.ref_id and logged.user_id = due.user_id;
  get diagnostics v_n = row_count; v_count := v_count + v_n;

  -- 2) Choir services, 2 days ahead.
  with due as (
    select r.id as ref_id, r.singer_id as user_id, r.tenant_id, sp.title, sp.date
    from public.service_rsvps r
    join public.service_plans sp on sp.id = r.service_plan_id
    join public.profiles p on p.id = r.singer_id and p.removed_at is null
    where r.status = 'approved' and sp.date = current_date + 2
  ), logged as (
    insert into public.reminder_log (kind, ref_id, user_id, tenant_id)
    select 'choir', ref_id, user_id, tenant_id from due
    on conflict do nothing
    returning ref_id, user_id
  )
  insert into public.notifications (recipient_id, type, title, body, source_user_id, tenant_id)
  select due.user_id, 'serve_reminder', '⏰ Choir / Chorale — ' || coalesce(nullif(due.title, ''), 'Service'),
         'You sing on ' || to_char(due.date, 'FMDay, FMMonth FMDD') || ' / Vous chantez le ' || to_char(due.date, 'DD/MM/YYYY'),
         null, due.tenant_id
  from due join logged on logged.ref_id = due.ref_id and logged.user_id = due.user_id;
  get diagnostics v_n = row_count; v_count := v_count + v_n;

  -- 3) Confirmed pastor meetings tomorrow: the member (if they have an
  --    account) and the pastor.
  with meetings as (
    select m.id, m.tenant_id, m.meeting_date, m.meeting_start_time, m.meeting_type, m.meeting_link,
           m.user_id, m.pastor_id,
           coalesce(member.full_name, m.contact_name, 'a member') as member_name,
           coalesce(pastor.full_name, 'the pastor') as pastor_name
    from public.pastor_meeting_requests m
    left join public.profiles member on member.id = m.user_id
    left join public.profiles pastor on pastor.id = m.pastor_id
    where m.status = 'confirmed' and m.meeting_date = current_date + 1
  ), due as (
    select id as ref_id, user_id, tenant_id, meeting_date, meeting_start_time, meeting_type, meeting_link, pastor_name as other_name from meetings where user_id is not null
    union all
    select id, pastor_id, tenant_id, meeting_date, meeting_start_time, meeting_type, meeting_link, member_name from meetings where pastor_id is not null
  ), logged as (
    insert into public.reminder_log (kind, ref_id, user_id, tenant_id)
    select 'meeting', ref_id, user_id, tenant_id from due
    on conflict do nothing
    returning ref_id, user_id
  )
  insert into public.notifications (recipient_id, type, title, body, source_user_id, tenant_id)
  select due.user_id, 'meeting_reminder',
         '⏰ Meeting with ' || due.other_name || ' / Rencontre avec ' || due.other_name,
         'Tomorrow / Demain ' || coalesce(to_char(due.meeting_start_time, 'HH24:MI'), '')
           || case when due.meeting_type = 'online' and due.meeting_link is not null then ' — ' || due.meeting_link else '' end,
         null, due.tenant_id
  from due join logged on logged.ref_id = due.ref_id and logged.user_id = due.user_id;
  get diagnostics v_n = row_count; v_count := v_count + v_n;

  -- 4) Events tomorrow, for registered members with an account.
  with due as (
    select er.id as ref_id, er.user_id, er.tenant_id, e.title, e.start_at, e.location
    from public.event_registrations er
    join public.events e on e.id = er.event_id
    where er.user_id is not null and er.status = 'confirmed'
      and e.status = 'active' and (e.start_at at time zone 'America/Toronto')::date = current_date + 1
  ), logged as (
    insert into public.reminder_log (kind, ref_id, user_id, tenant_id)
    select 'event', ref_id, user_id, tenant_id from due
    on conflict do nothing
    returning ref_id, user_id
  )
  insert into public.notifications (recipient_id, type, title, body, source_user_id, tenant_id)
  select due.user_id, 'event_reminder', '⏰ ' || due.title,
         'Tomorrow / Demain ' || to_char(due.start_at at time zone 'America/Toronto', 'HH24:MI')
           || coalesce(' — ' || nullif(due.location, ''), ''),
         null, due.tenant_id
  from due join logged on logged.ref_id = due.ref_id and logged.user_id = due.user_id;
  get diagnostics v_n = row_count; v_count := v_count + v_n;

  return v_count;
end;
$$;
revoke all on function public.send_due_reminders() from public, anon, authenticated;

-- Email + push for notifications. Same as sql/saas_platform/78, plus:
--   * reminder types default to email ON when the person has no saved
--     preference (every other type still defaults OFF, unchanged);
--   * reminder types also get a Web Push via send-push's cron path,
--     unless the person turned the type off in-app.
create or replace function public.notify_email_on_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pref_email boolean;
  v_pref_in_app boolean;
  v_is_reminder boolean := new.type in ('serve_reminder', 'meeting_reminder', 'event_reminder');
  v_secret text;
begin
  select np.email, np.in_app into v_pref_email, v_pref_in_app
  from public.notification_preferences np
  where np.user_id = new.recipient_id and np.notification_type = new.type;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'offering_cron_secret';
  if v_secret is null then return new; end if;

  if coalesce(v_pref_email, v_is_reminder) then
    perform net.http_post(
      url := 'https://towlqbxvhftzjfrtepsy.supabase.co/functions/v1/send-notification-email',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
      body := jsonb_build_object('notification_id', new.id)
    );
  end if;

  if v_is_reminder and coalesce(v_pref_in_app, true) then
    perform net.http_post(
      url := 'https://towlqbxvhftzjfrtepsy.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
      body := jsonb_build_object('kind', 'notification', 'notification_id', new.id)
    );
  end if;
  return new;
end;
$$;

do $$ begin perform cron.unschedule('send-due-reminders'); exception when others then null; end $$;
select cron.schedule('send-due-reminders', '0 13 * * *', 'select public.send_due_reminders();');

commit;

select pg_notify('pgrst', 'reload schema');
