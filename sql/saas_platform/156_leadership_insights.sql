-- Leadership insights (feature 8 of the improvement roadmap).
--
-- One read-only function that gathers the church's health numbers for the
-- last N weeks so pastors see trends on one page instead of opening six
-- tools: Sunday headcount (Ushers), children (Sunday School), people checked
-- in, new guests, volunteers who served, giving, plus period totals (new
-- members, people who left, open prayer requests, guests waiting for
-- follow-up, small-group attendance).
--
-- Access: pastoral team (is_pastoral_team()). Giving figures are included
-- only for people who already see every offering (can_delete_offerings()),
-- so the page never shows more than the Offerings tool would.
-- Nothing is stored; no new tables.

begin;

create or replace function public.get_leadership_insights(p_weeks integer default 12)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_weeks integer := least(greatest(coalesce(p_weeks, 12), 4), 52);
  v_from date := (date_trunc('week', current_date)::date - (v_weeks - 1) * 7);
  v_giving boolean := public.can_delete_offerings();
  v_ushers uuid;
  v_ecodem uuid;
  v_weekly jsonb;
  v_totals jsonb;
  v_sg bigint;
begin
  if v_tenant is null or not public.is_pastoral_team() then
    raise exception 'NOT_ALLOWED';
  end if;

  select id into v_ushers from public.departments where tenant_id = v_tenant and key = 'ushers' limit 1;
  select id into v_ecodem from public.departments where tenant_id = v_tenant and key = 'ecodem' limit 1;

  select jsonb_agg(jsonb_build_object(
           'week', w.wk,
           'headcount', (select max(h.total_count) from public.department_headcounts h
                          where h.department_id = v_ushers and h.date >= w.wk and h.date < w.wk + 7),
           'children', (select max(h.total_count) from public.department_headcounts h
                          where h.department_id = v_ecodem and h.date >= w.wk and h.date < w.wk + 7),
           'checked_in', (select count(distinct coalesce(a.member_id::text, lower(a.guest_name)))
                            from public.attendance_records a
                           where a.tenant_id = v_tenant and a.service_date >= w.wk and a.service_date < w.wk + 7),
           'new_guests', (select count(*) from public.guest_follow_ups g
                           where g.tenant_id = v_tenant and g.removed_at is null
                             and g.created_at >= w.wk and g.created_at < w.wk + 7),
           'volunteers', (select count(distinct sa.user_id)
                            from public.department_shift_assignments sa
                            join public.department_shifts s on s.id = sa.shift_id
                           where s.tenant_id = v_tenant and s.date >= w.wk and s.date < w.wk + 7
                             and coalesce(sa.status, '') not in ('declined', 'cancelled')),
           'giving_cents', case when v_giving then
                             (select coalesce(sum(o.amount_cents), 0) from public.offerings o
                               where o.tenant_id = v_tenant and o.removed_at is null
                                 and o.offering_date >= w.wk and o.offering_date < w.wk + 7)
                           end
         ) order by w.wk)
    into v_weekly
    from (select generate_series(v_from, date_trunc('week', current_date)::date, interval '7 days')::date as wk) w;

  -- Small groups (sql 148) may not be applied yet: query it dynamically.
  if to_regclass('public.small_group_meetings') is not null then
    execute 'select coalesce(sum(coalesce(array_length(attendee_ids, 1), 0) + guest_count), 0)
               from public.small_group_meetings where tenant_id = $1 and meeting_date >= $2'
      into v_sg using v_tenant, v_from;
  end if;

  v_totals := jsonb_build_object(
    'small_group_attendance', v_sg,
    'new_members', (select count(*) from public.members m
                     where m.tenant_id = v_tenant and coalesce(m.registered_at, m.created_at) >= v_from),
    'members_total', (select count(*) from public.members m where m.tenant_id = v_tenant),
    'members_left', (select count(*) from public.member_exits e
                      where e.tenant_id = v_tenant and e.date_left >= v_from),
    'guests_waiting', (select count(*) from public.guest_follow_ups g
                        where g.tenant_id = v_tenant and g.removed_at is null
                          and g.follow_up_completed_at is null and g.status = 'new_guest'),
    'prayer_open', (select count(*) from public.prayer_requests p
                     where p.tenant_id = v_tenant and p.handled_at is null),
    'giving_visible', v_giving,
    'from', v_from,
    'weeks', v_weeks
  );

  return jsonb_build_object('weekly', coalesce(v_weekly, '[]'::jsonb), 'totals', v_totals);
end;
$$;

revoke all on function public.get_leadership_insights(integer) from public, anon;
grant execute on function public.get_leadership_insights(integer) to authenticated;

commit;

select pg_notify('pgrst', 'reload schema');
