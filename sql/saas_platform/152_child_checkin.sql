-- Children's check-in with pick-up security codes (feature 6 of the
-- improvement roadmap), built on the existing Sunday School (ecodem)
-- children list (sql/saas_platform/85: allergies, medical notes, parent
-- name/phone).
--
-- At drop-off a volunteer checks the child in; the app shows a short
-- random code (e.g. "K7P4") that the parent keeps. At pick-up the child is
-- released only when that code is entered -- checkout_child() refuses a
-- wrong code. Allergies/medical notes are shown at check-in.
-- Any approved Sunday School member can check in/out (volunteers);
-- RLS uses the same can_read_department(ecodem) gate as the children list.

begin;

create table if not exists public.child_checkins (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  child_id uuid not null references public.ecodem_children(id) on delete cascade,
  checkin_date date not null default (now() at time zone 'America/Toronto')::date,
  security_code text not null check (security_code ~ '^[A-Z0-9]{4}$'),
  checked_in_at timestamptz not null default now(),
  checked_in_by uuid references public.profiles(id) on delete set null,
  checked_out_at timestamptz,
  checked_out_by uuid references public.profiles(id) on delete set null,
  picked_up_by text,
  unique (child_id, checkin_date)
);
create index if not exists child_checkins_tenant_date_idx on public.child_checkins (tenant_id, checkin_date);
alter table public.child_checkins enable row level security;

drop policy if exists "sunday school reads check-ins" on public.child_checkins;
create policy "sunday school reads check-ins" on public.child_checkins
  for select to authenticated using (
    tenant_id = public.current_tenant_id()
    and (public.is_pastoral_team() or public.can_read_department((select id from public.departments where key = 'ecodem' and tenant_id = public.current_tenant_id()))));
-- Writes go through the two functions below only.

create or replace function public.checkin_child(p_child_id uuid)
returns table (checkin_id uuid, security_code text)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_dept uuid;
  v_code text;
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no 0/O/1/I, easy to read aloud
  v_today date := (now() at time zone 'America/Toronto')::date;
  v_existing public.child_checkins;
  i int;
begin
  select id into v_dept from public.departments where key = 'ecodem' and tenant_id = v_tenant;
  if v_tenant is null or not (public.is_pastoral_team() or public.can_read_department(v_dept)) then
    raise exception 'Only Sunday School volunteers can check children in';
  end if;
  if not exists (select 1 from public.ecodem_children c where c.id = p_child_id and c.tenant_id = v_tenant) then
    raise exception 'Child not found';
  end if;

  select * into v_existing from public.child_checkins where child_id = p_child_id and checkin_date = v_today;
  if found then
    if v_existing.checked_out_at is null then
      return query select v_existing.id, v_existing.security_code; -- already in: same code again
      return;
    end if;
    delete from public.child_checkins where id = v_existing.id; -- came back the same day: new code
  end if;

  loop
    v_code := '';
    for i in 1..4 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.child_checkins x
                          where x.tenant_id = v_tenant and x.checkin_date = v_today and x.security_code = v_code and x.checked_out_at is null);
  end loop;

  return query
  insert into public.child_checkins (tenant_id, child_id, checkin_date, security_code, checked_in_by)
  values (v_tenant, p_child_id, v_today, v_code, auth.uid())
  returning id, child_checkins.security_code;
end;
$$;
revoke all on function public.checkin_child(uuid) from public, anon;
grant execute on function public.checkin_child(uuid) to authenticated;

create or replace function public.checkout_child(p_checkin_id uuid, p_code text, p_picked_up_by text)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_row public.child_checkins;
begin
  if v_tenant is null or not (public.is_pastoral_team()
      or public.can_read_department((select id from public.departments where key = 'ecodem' and tenant_id = v_tenant))) then
    raise exception 'Only Sunday School volunteers can check children out';
  end if;
  select * into v_row from public.child_checkins where id = p_checkin_id and tenant_id = v_tenant for update;
  if not found then raise exception 'Check-in not found'; end if;
  if v_row.checked_out_at is not null then raise exception 'ALREADY_OUT'; end if;
  if upper(trim(coalesce(p_code, ''))) <> v_row.security_code then raise exception 'WRONG_CODE'; end if;
  update public.child_checkins
  set checked_out_at = now(), checked_out_by = auth.uid(), picked_up_by = nullif(trim(p_picked_up_by), '')
  where id = p_checkin_id;
end;
$$;
revoke all on function public.checkout_child(uuid, text, text) from public, anon;
grant execute on function public.checkout_child(uuid, text, text) to authenticated;

commit;

select pg_notify('pgrst', 'reload schema');
