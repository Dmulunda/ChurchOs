-- Urgent Prayer Cases: distinct from the existing Prayer Requests
-- (self-service, Intercession-queue) -- created BY the Pastor or any
-- admin ON BEHALF OF someone needing urgent prayer, either picking a
-- real member or typing a name freely. The one genuinely new piece
-- this needs, confirmed by research: a per-case custom "who else can
-- see this" access list -- nothing else in this app has that (every
-- other visibility rule is role/department-based), so it's a plain
-- many-to-many table with its own narrow RLS, not reused from
-- anywhere.

begin;

create table if not exists public.urgent_prayer_cases (
  id uuid primary key default gen_random_uuid(),
  person_name text not null,
  person_member_id uuid references public.profiles(id) on delete set null,
  need_description text,
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict
);

alter table public.urgent_prayer_cases alter column tenant_id set default public.current_tenant_id();

create table if not exists public.urgent_prayer_case_viewers (
  case_id uuid not null references public.urgent_prayer_cases(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  added_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (case_id, user_id)
);

create index if not exists urgent_prayer_cases_tenant_id_idx on public.urgent_prayer_cases (tenant_id);
create index if not exists urgent_prayer_case_viewers_case_id_idx on public.urgent_prayer_case_viewers (case_id);

alter table public.urgent_prayer_cases enable row level security;
alter table public.urgent_prayer_case_viewers enable row level security;

drop policy if exists "tenant_isolation" on public.urgent_prayer_cases;
create policy "tenant_isolation" on public.urgent_prayer_cases as restrictive for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- Create: the Pastor, Church Admin, Super Admin, or an admin of any
-- department (same "any admin, tenant-wide" reading confirmed for
-- Part 3's widenings).
drop policy if exists "urgent prayer cases are created by admins" on public.urgent_prayer_cases;
create policy "urgent prayer cases are created by admins" on public.urgent_prayer_cases
  for insert to authenticated with check (
    created_by = auth.uid()
    and (
      public.is_super_admin()
      or public.is_pastor_admin()
      or public.is_church_admin()
      or exists (
        select 1 from public.department_memberships dm
        where dm.user_id = auth.uid() and dm.status = 'approved' and dm.role = 'admin'
      )
    )
  );

-- Visibility: Super Admin, Pastor, Church Admin, Intercession's own
-- admin/secretary (blanket, mirroring Prayer Requests' own
-- Intercession-scoping), the creator, or anyone the creator
-- explicitly granted via urgent_prayer_case_viewers.
drop policy if exists "urgent prayer cases are readable by the authorized" on public.urgent_prayer_cases;
create policy "urgent prayer cases are readable by the authorized" on public.urgent_prayer_cases
  for select to authenticated using (
    public.is_super_admin()
    or public.is_pastor_admin()
    or public.is_church_admin()
    or public.can_manage_department((select id from public.departments where key = 'intercession'))
    or created_by = auth.uid()
    or exists (
      select 1 from public.urgent_prayer_case_viewers v
      where v.case_id = id and v.user_id = auth.uid()
    )
  );

-- Deliberately narrower than SELECT: a granted viewer can SEE the
-- case (matches "the creator can choose who else can see it" -- see,
-- not edit) but only the creator or an oversight role can change it.
drop policy if exists "urgent prayer cases are updated by the authorized" on public.urgent_prayer_cases;
create policy "urgent prayer cases are updated by the authorized" on public.urgent_prayer_cases
  for update to authenticated
  using (
    public.is_super_admin()
    or public.is_pastor_admin()
    or public.is_church_admin()
    or public.can_manage_department((select id from public.departments where key = 'intercession'))
    or created_by = auth.uid()
  )
  with check (tenant_id = public.current_tenant_id());

drop policy if exists "urgent prayer cases are deleted by the creator or oversight" on public.urgent_prayer_cases;
create policy "urgent prayer cases are deleted by the creator or oversight" on public.urgent_prayer_cases
  for delete to authenticated using (
    public.is_super_admin()
    or public.is_pastor_admin()
    or public.is_church_admin()
    or created_by = auth.uid()
  );

-- Viewer list: only the case's own creator manages who's on it.
-- Reading your OWN membership on the list is always allowed (so a
-- granted viewer can confirm their own access); seeing the FULL
-- roster is a creator/oversight thing, same audience as the case
-- itself.
drop policy if exists "urgent prayer case viewers are managed by the creator" on public.urgent_prayer_case_viewers;
create policy "urgent prayer case viewers are managed by the creator" on public.urgent_prayer_case_viewers
  for all to authenticated using (
    user_id = auth.uid()
    or exists (
      select 1 from public.urgent_prayer_cases upc
      where upc.id = case_id and (
        upc.created_by = auth.uid()
        or public.is_super_admin()
        or public.is_pastor_admin()
        or public.is_church_admin()
      )
    )
  )
  with check (
    exists (
      select 1 from public.urgent_prayer_cases upc
      where upc.id = case_id and (
        upc.created_by = auth.uid()
        or public.is_super_admin()
        or public.is_pastor_admin()
        or public.is_church_admin()
      )
    )
  );

commit;

select pg_notify('pgrst', 'reload schema');
