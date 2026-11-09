-- Member Database (Feature 2 of 3, part 1): members + member_history --
-- a single row per person with the richer fields the directory needs
-- (gender, marital status, structured address, age group, career,
-- skills, consent) that don't belong on `profiles` itself (an auth-
-- linked account record, not everyone has one -- see profile_id
-- below). member_history keeps every prior value of every field, so
-- an update never loses information (self-registration matching in
-- sql/saas_platform/129 relies on this).
--
-- age_group reuses the exact same bucket set guest_follow_ups/
-- attendance_records already use (under_18/18_29/30_40/40_50/50_plus)
-- -- one consistent age scheme app-wide rather than a second one.
--
-- profile_id is nullable: a member can exist here with no linked
-- login (e.g. someone who filled the public registration form but
-- never created an account) -- sql/saas_platform/130's sync triggers
-- only fire the profiles-side half when it's set.
begin;

create table public.members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict default public.current_tenant_id(),
  profile_id uuid unique references public.profiles(id) on delete set null,
  full_name text not null,
  gender text check (gender in ('M', 'F')),
  marital_status text check (marital_status in ('single', 'married', 'widowed', 'divorced', 'separated')),
  address_street text,
  address_city text,
  address_province text,
  address_postal text,
  age_group text check (age_group in ('under_18', '18_29', '30_40', '40_50', '50_plus')),
  career text,
  phone text,
  email text,
  skills text[] not null default '{}',
  skills_other text,
  status text not null default 'Newcomer' check (status in ('Newcomer', 'Member', 'Left')),
  possible_duplicate_of uuid references public.members(id) on delete set null,
  consent_given_at timestamptz,
  registered_at timestamptz not null default now(),
  last_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.member_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict default public.current_tenant_id(),
  member_id uuid not null references public.members(id) on delete cascade,
  field text not null,
  old_value text,
  new_value text,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index members_tenant_status_idx on public.members (tenant_id, status);
create index members_tenant_email_idx on public.members (tenant_id, lower(email));
create index members_tenant_phone_idx on public.members (tenant_id, phone);
create index members_full_name_trgm_idx on public.members using gin (full_name gin_trgm_ops);
create index member_history_member_id_idx on public.member_history (member_id);
create index member_history_tenant_id_idx on public.member_history (tenant_id);

create trigger force_updated_at before insert or update on public.members
  for each row execute function public.force_server_timestamp_updated_at();
create trigger force_updated_at before insert or update on public.member_history
  for each row execute function public.force_server_timestamp_updated_at();

alter table public.members enable row level security;
alter table public.member_history enable row level security;

-- Admin-only (Member Directory + its own history) -- no public policy
-- of any kind (the self-registration RPC in 129 is security definer
-- and writes as its own owner, bypassing RLS entirely, same as every
-- other public write RPC in this app).
create policy "members are managed by pastoral team or church admin" on public.members
  for all to authenticated
  using (is_pastoral_team() or is_church_admin())
  with check (is_pastoral_team() or is_church_admin());
create policy "tenant_isolation" on public.members as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

create policy "member history is managed by pastoral team or church admin" on public.member_history
  for all to authenticated
  using (is_pastoral_team() or is_church_admin())
  with check (is_pastoral_team() or is_church_admin());
create policy "tenant_isolation" on public.member_history as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

-- One-time migration: a members row for every existing, non-removed
-- profile, linked via profile_id. Pre-existing people are not
-- "Newcomer" by default -- status is derived from removed_at (Left)
-- or defaults to Member (the one-time migration has no reliable
-- "just joined" signal to call anyone a Newcomer retroactively).
-- address/career/marital_status/skills are left blank: profiles.
-- address is one free-text field (can't be split into structured
-- columns) and media_tech_skills is a different skill set entirely,
-- not auto-copied into the general `skills` field here.
insert into public.members (
  tenant_id, profile_id, full_name, gender, phone, email, status, registered_at
)
select
  p.tenant_id,
  p.id,
  p.full_name,
  p.sex,
  p.phone,
  lower(pe.email),
  case when p.removed_at is not null then 'Left' else 'Member' end,
  coalesce(p.joined_at, p.created_at)
from public.profiles p
left join public.profile_emails pe on pe.id = p.id
where p.permanently_deleted_at is null;

commit;

select pg_notify('pgrst', 'reload schema');
