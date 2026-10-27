-- Choir scheduling, merged into one step like Media & Tech's board
-- (js/components/mediaTechBoard.js): previously an admin had to run two
-- separate tools -- the Auto-Planner (fills service_plan_singers, no
-- status, no notification) and a separate titled Service Request (posts
-- service_rsvps to EVERY approved choir member, not just whoever the
-- Auto-Planner actually placed). js/components/choirBoard.js replaces
-- both with one form, same as Media & Tech: assign people per voice
-- part, save, done.
--
-- service_plan_singers is intentionally NOT dropped or restructured --
-- it also feeds six other files' worth of shared scheduling-conflict and
-- absence-blocking logic plus the dashboard "today's schedule" widget
-- and the purge job. The new unified form keeps writing it exactly the
-- way autoPlanner.js already did (delete-all/reinsert per plan), so none
-- of that infrastructure needs to change. service_rsvps becomes the
-- richer "assignment + response" record the new form and the shared
-- My Assignments panel (js/components/myAssignmentsPanel.js) operate on
-- -- it just gains a voice_part column so one row can carry both.

begin;

-- Pre-existing bug, found while testing claim_replacement() below:
-- send_replacement_request()/claim_replacement()/refuse_replacement()
-- (sql/saas_platform/06_rpc_tenant_fixes.sql, 01_schema.sql,
-- 38_fix_is_admin_cross_tenant_departments.sql) have always inserted
-- notifications with type 'replacement_request'/'replacement_response',
-- but neither value was ever added to the notification_type enum in any
-- migration -- every one of those notification inserts has been failing
-- (and rolling back the whole RPC call with it) since the feature shipped.
alter type public.notification_type add value if not exists 'replacement_request';
alter type public.notification_type add value if not exists 'replacement_response';

alter table public.service_rsvps
  add column if not exists voice_part voice_part,
  add column if not exists created_by uuid references public.profiles(id) on delete set null;

-- One-time backfill from the existing roster table into the newly
-- enriched service_rsvps, so every already-scheduled singer shows up
-- correctly in the new unified view and My Assignments without being
-- spuriously re-prompted.
do $$
begin
  -- Rows that already have a matching service_rsvps row (were both
  -- placed on the roster AND separately invited) -- just fill in the
  -- voice part they were actually placed in.
  update public.service_rsvps r
  set voice_part = sps.voice_part
  from public.service_plan_singers sps
  where r.service_plan_id = sps.service_plan_id
    and r.singer_id = sps.singer_id
    and r.voice_part is null;

  -- Rows placed on the roster but never separately invited (the old
  -- two-tool gap this migration exists to close) -- these were already
  -- final placements under the old design (service_plan_singers has no
  -- status column at all), so backfill as already-approved rather than
  -- asking everyone to reconfirm something they were already told.
  insert into public.service_rsvps (service_plan_id, singer_id, voice_part, status, tenant_id)
  select sps.service_plan_id, sps.singer_id, sps.voice_part, 'approved', sps.tenant_id
  from public.service_plan_singers sps
  where not exists (
    select 1 from public.service_rsvps r
    where r.service_plan_id = sps.service_plan_id and r.singer_id = sps.singer_id
  );
end $$;

-- claim_replacement() already swaps the covering singer into
-- service_plan_singers (sql/saas_platform/06_rpc_tenant_fixes.sql) --
-- that part is unchanged. It now also keeps service_rsvps in sync (the
-- table the new unified admin view and My Assignments actually read),
-- since otherwise a replaced singer would still show as scheduled and
-- the new covering singer wouldn't show as scheduled at all.
create or replace function public.claim_replacement(request_id uuid)
 returns replacement_requests
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  req public.replacement_requests;
  caller_voice_parts public.voice_part[];
  v_full_name text;
begin
  select voice_parts into caller_voice_parts from public.profiles where id = auth.uid();

  select * into req from public.replacement_requests where id = request_id for update;

  if req.id is null or req.tenant_id is distinct from public.current_tenant_id() then
    raise exception 'Request not found';
  end if;

  if req.status <> 'open' then
    raise exception 'This request has already been resolved';
  end if;

  if req.requested_by = auth.uid() then
    raise exception 'You cannot claim your own request';
  end if;

  if req.target_singer_id is not null and req.target_singer_id <> auth.uid() then
    raise exception 'This request is targeted at a specific member';
  end if;

  if caller_voice_parts is null or not (req.voice_part = any (caller_voice_parts)) then
    raise exception 'You do not cover this voice part';
  end if;

  update public.replacement_requests
    set status = 'claimed', claimed_by = auth.uid(), resolved_at = now()
    where id = request_id
    returning * into req;

  update public.service_plan_singers
    set singer_id = auth.uid()
    where service_plan_id = req.service_plan_id
      and singer_id = req.requested_by
      and voice_part = req.voice_part;

  update public.service_rsvps
    set status = 'declined', reason = 'Covered by a replacement', responded_at = now()
    where service_plan_id = req.service_plan_id
      and singer_id = req.requested_by
      and voice_part = req.voice_part;

  insert into public.service_rsvps (service_plan_id, singer_id, voice_part, status, responded_at, created_by, tenant_id)
  values (req.service_plan_id, auth.uid(), req.voice_part, 'approved', now(), auth.uid(), req.tenant_id)
  on conflict (service_plan_id, singer_id)
  do update set voice_part = excluded.voice_part, status = 'approved', responded_at = now();

  select full_name into v_full_name from public.profiles where id = auth.uid();
  insert into public.notifications (recipient_id, type, title, body, source_user_id, tenant_id)
  values (
    req.requested_by,
    'replacement_response',
    v_full_name || ' accepted your replacement request',
    v_full_name || ' will cover for you.',
    auth.uid(),
    req.tenant_id
  );

  return req;
end;
$function$;

select pg_notify('pgrst', 'reload schema');

commit;
