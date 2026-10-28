-- Silent Directory: a dedicated view of every Silent (is_silent=true)
-- person, paired with the existing User Directory, plus a shared
-- "User Status" category (New Guest / Visitor for Other Church / Out
-- of City / Member / Lost Member) used on both that new directory and
-- the existing Guest Onboarding Hub (guest_follow_ups). This is a
-- DIFFERENT concept from guest_follow_ups.status (guest_follow_up_
-- status: new_guest/contacted/assigned_to_department), which tracks
-- routing progress, not visitor category -- the two happen to share
-- one label ("New Guest") but are intentionally kept as separate
-- columns.
--
-- Picking "Member" on either screen is what the app now treats as
-- "this person has graduated from being a guest lead" -- see
-- graduated_at below -- and what unlocks the (separately added)
-- Promote-to-Active action on a Silent Directory row.

begin;

create type public.directory_user_status as enum (
  'new_guest', 'visitor_other_church', 'out_of_city', 'member', 'lost_member'
);

alter table public.profiles
  add column if not exists user_status public.directory_user_status not null default 'new_guest';
alter table public.guest_follow_ups
  add column if not exists user_status public.directory_user_status not null default 'new_guest';

-- Existing Silent profiles predate this column and are already-known
-- people (created via "Add User -> No login yet" or bulk import), not
-- fresh walk-in guests -- default them to Member rather than leaving
-- them stuck at New Guest.
update public.profiles set user_status = 'member' where is_silent;

-- Graduation marker: set when a guest_follow_ups row's user_status
-- moves to 'member'. The row is kept (not deleted) for history, but
-- drops out of the Hub's active list -- same soft-filter idea as the
-- existing removed_at/follow_up_completed_at columns on this table.
alter table public.guest_follow_ups
  add column if not exists graduated_at timestamptz,
  add column if not exists graduated_by uuid references public.profiles(id);

-- Guest Notes: a real multi-entry, timestamped/attributed notes log --
-- today guest_follow_ups only has two flat, last-write-wins text
-- fields (notes, follow_up_note). Same append-only shape as the
-- existing guest_follow_up_transfers table.
create table public.guest_follow_up_notes (
  id uuid primary key default gen_random_uuid(),
  guest_follow_up_id uuid not null references public.guest_follow_ups(id) on delete cascade,
  author_id uuid references public.profiles(id),
  note text not null,
  created_at timestamptz not null default now(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id)
);

create index guest_follow_up_notes_lead_idx on public.guest_follow_up_notes (guest_follow_up_id);
create index guest_follow_up_notes_tenant_id_idx on public.guest_follow_up_notes (tenant_id);

alter table public.guest_follow_up_notes enable row level security;

create policy "guest follow-up notes are readable by those holding the case" on public.guest_follow_up_notes
  for select to authenticated using (
    exists (
      select 1 from public.guest_follow_ups g
      where g.id = guest_follow_up_notes.guest_follow_up_id
        and (public.is_pastoral_team() or (g.assigned_department_id is not null and public.can_write_department(g.assigned_department_id)))
    )
  );

create policy "tenant_isolation" on public.guest_follow_up_notes as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

-- No direct insert policy -- same shape as guest_follow_up_transfers,
-- inserted only via this security-definer RPC so the permission check
-- (and author_id/tenant_id) can't be spoofed by the client.
create or replace function public.add_guest_follow_up_note(p_guest_follow_up_id uuid, p_note text)
 returns public.guest_follow_up_notes
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_current_department_id uuid;
  v_row public.guest_follow_up_notes;
begin
  if (select tenant_id from public.guest_follow_ups where id = p_guest_follow_up_id) is distinct from public.current_tenant_id() then
    raise exception 'Case not found';
  end if;
  if coalesce(trim(p_note), '') = '' then
    raise exception 'Note cannot be empty';
  end if;

  select assigned_department_id into v_current_department_id
  from public.guest_follow_ups where id = p_guest_follow_up_id;

  if not (
    public.is_pastoral_team()
    or (v_current_department_id is not null and public.can_write_department(v_current_department_id))
  ) then
    raise exception 'You do not currently hold this case';
  end if;

  insert into public.guest_follow_up_notes (guest_follow_up_id, author_id, note)
  values (p_guest_follow_up_id, auth.uid(), trim(p_note))
  returning * into v_row;

  return v_row;
end;
$function$;

grant execute on function public.add_guest_follow_up_note(uuid, text) to authenticated;

-- Auto-provision a linked Silent profile the moment a guest lead is
-- created, instead of only on a manual (and today, one-way/unlinked)
-- "Create Account" click. notify_guest_attendance() runs in pure SQL
-- and can't call the Admin API itself (creating a real auth.users row
-- needs the service-role Admin API) -- reuses the same net.http_post-
-- to-an-Edge-Function pattern already proven by
-- notification_email_trigger (sql/saas_platform/78), including the
-- same shared CRON_SECRET (vault secret name: offering_cron_secret)
-- already configured for several other trigger->function calls, not
-- a new secret to provision.
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

commit;
