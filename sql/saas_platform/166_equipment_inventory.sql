-- Equipment & inventory for every department (feature 14 of the roadmap).
--
-- Until now only Media & Tech had an Equipment tab (sql/saas_platform/84).
-- This opens it to every department (each manages its own items) and adds
-- what a church inventory needs: quantity, serial number, purchase date and
-- value, warranty end, next maintenance date, loans to people without an
-- account (borrower_name), and a maintenance log. The pastoral team sees and
-- manages every department's items from one Inventory page.
--
-- Existing rows and the Media & Tech tab keep working unchanged.

begin;

alter table public.equipment_items
  add column if not exists quantity integer not null default 1 check (quantity between 0 and 100000),
  add column if not exists serial_number text check (serial_number is null or length(serial_number) <= 120),
  add column if not exists purchased_on date,
  add column if not exists value_cents bigint check (value_cents is null or value_cents >= 0),
  add column if not exists warranty_until date,
  add column if not exists next_maintenance_on date,
  add column if not exists borrower_name text check (borrower_name is null or length(borrower_name) <= 160);

-- Media-tech-only policies -> per-department (+ pastoral team). The
-- restrictive tenant_isolation policy stays as it is.
drop policy if exists "media tech admins manage equipment" on public.equipment_items;
drop policy if exists "media tech members read equipment" on public.equipment_items;
drop policy if exists "department members read equipment" on public.equipment_items;
create policy "department members read equipment" on public.equipment_items
  for select to authenticated
  using (public.can_read_department(department_id) or public.is_pastoral_team());
drop policy if exists "department admins manage equipment" on public.equipment_items;
create policy "department admins manage equipment" on public.equipment_items
  for all to authenticated
  using (public.can_write_department(department_id) or public.is_pastoral_team())
  with check (public.can_write_department(department_id) or public.is_pastoral_team());

create table if not exists public.equipment_maintenance (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  item_id uuid not null references public.equipment_items(id) on delete cascade,
  done_on date not null default current_date,
  kind text not null default 'check' check (kind in ('check', 'repair', 'cleaning', 'replacement', 'other')),
  cost_cents bigint check (cost_cents is null or cost_cents >= 0),
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists equipment_maintenance_item_idx on public.equipment_maintenance (item_id, done_on desc);

alter table public.equipment_maintenance enable row level security;
drop policy if exists "read maintenance with the item" on public.equipment_maintenance;
create policy "read maintenance with the item" on public.equipment_maintenance
  for select to authenticated
  using (tenant_id = public.current_tenant_id()
         and exists (select 1 from public.equipment_items i where i.id = item_id
                       and (public.can_read_department(i.department_id) or public.is_pastoral_team())));
drop policy if exists "manage maintenance with the item" on public.equipment_maintenance;
create policy "manage maintenance with the item" on public.equipment_maintenance
  for all to authenticated
  using (tenant_id = public.current_tenant_id()
         and exists (select 1 from public.equipment_items i where i.id = item_id
                       and (public.can_write_department(i.department_id) or public.is_pastoral_team())))
  with check (tenant_id = public.current_tenant_id()
         and exists (select 1 from public.equipment_items i where i.id = item_id
                       and (public.can_write_department(i.department_id) or public.is_pastoral_team())));

commit;

select pg_notify('pgrst', 'reload schema');
