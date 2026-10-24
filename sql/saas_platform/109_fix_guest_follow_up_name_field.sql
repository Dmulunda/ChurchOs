-- Bug fix: notify_guest_follow_up_needed() (sql/saas_platform/97) was
-- written against the wrong column name -- guest_follow_ups has
-- full_name, never guest_name (that column only exists on
-- attendance_records; notify_guest_attendance() copies
-- attendance_records.guest_name INTO guest_follow_ups.full_name when it
-- inserts the row). Every insert into guest_follow_ups fired this AFTER
-- INSERT trigger, which immediately raised "record 'new' has no field
-- 'guest_name'" -- breaking guest check-in (attendance_records insert
-- cascades into this insert via notify_guest_attendance), the public
-- self-checkin RPC, and any other guest_follow_ups insert path.

begin;

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
  if new.full_name is null then
    return new;
  end if;

  v_title := new.full_name || ' needs a follow-up';

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

commit;
