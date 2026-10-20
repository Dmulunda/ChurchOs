-- Guest follow-up reminders: when a new guest_follow_ups row is
-- created (whether via the attendance check-in trigger or the
-- pastoral team manually assigning an unassigned signed-up member),
-- notify an admin to call/check in with them, reusing the existing
-- notifications infrastructure (same insert-per-recipient shape
-- notify_site_admins() already uses, sql/saas_platform/49) rather
-- than building a new table. "Mark complete + note" is tracked with
-- new columns independent of the existing status enum (routing
-- state) -- a case can be mid-routing and still need/have a completed
-- follow-up call, conflating the two would be a modeling mistake.
--
-- ALTER TYPE ... ADD VALUE can't be used in the same transaction that
-- then uses the new value (confirmed precedent: sql/saas_platform/61
-- wraps it in its own do $$ ... exception when others then null $$
-- block, no surrounding begin/commit) -- same shape followed here.

alter table public.guest_follow_ups
  add column if not exists follow_up_completed_at timestamptz,
  add column if not exists follow_up_completed_by uuid references public.profiles(id) on delete set null,
  add column if not exists follow_up_note text;

do $$ begin
  alter type public.notification_type add value if not exists 'guest_follow_up_reminder';
exception when others then null; end $$;

CREATE OR REPLACE FUNCTION public.notify_guest_follow_up_needed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_title text;
  v_recipient_count int;
begin
  if new.guest_name is null then
    return new;
  end if;

  v_title := new.guest_name || ' needs a follow-up';

  -- Targeted first: the assigned department's own admins (e.g.
  -- Welcoming & Socialisation, from the attendance auto-routing) --
  -- not every admin tenant-wide even though they can all *see* the
  -- case (sql/96).
  if new.assigned_department_id is not null then
    insert into public.notifications (recipient_id, type, title, body, source_user_id, tenant_id)
    select dm.user_id, 'guest_follow_up_reminder'::notification_type, v_title,
           'A guest was checked in and routed to your department -- reach out and mark the follow-up complete when done.',
           new.created_by, new.tenant_id
    from public.department_memberships dm
    where dm.department_id = new.assigned_department_id
      and dm.role = 'admin' and dm.status = 'approved'
      and dm.user_id is distinct from new.created_by;
    get diagnostics v_recipient_count = row_count;
  else
    v_recipient_count := 0;
  end if;

  -- Fallback: no department assigned yet, or that department
  -- currently has no admin -- pastoral team + Church Admins.
  if v_recipient_count = 0 then
    insert into public.notifications (recipient_id, type, title, body, source_user_id, tenant_id)
    select p.id, 'guest_follow_up_reminder'::notification_type, v_title,
           'A new guest was checked in -- reach out and mark the follow-up complete when done.',
           new.created_by, new.tenant_id
    from public.profiles p
    where p.tenant_id = new.tenant_id
      and p.id is distinct from new.created_by
      and (
        p.global_role in ('super_admin', 'pastor_admin', 'church_secretary')
        or exists (select 1 from public.church_admins ca where ca.user_id = p.id and ca.tenant_id = new.tenant_id)
      );
  end if;

  return new;
end;
$function$;

drop trigger if exists guest_follow_up_reminder on public.guest_follow_ups;
create trigger guest_follow_up_reminder after insert on public.guest_follow_ups
  for each row execute function public.notify_guest_follow_up_needed();
