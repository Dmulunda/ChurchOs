-- Silent Users, Part 1: schema foundation. A Silent user is a real
-- profiles row backed by a real but inert auth.users row (placeholder
-- email + random password nobody is told, created server-side via
-- the Admin API in a new Edge Function) -- NOT a decoupling of
-- profiles.id from auth.users.id, which would require rewriting every
-- RLS policy/helper function in this schema that authorizes off
-- auth.uid() = profiles.id directly. "Upgrading" a Silent user later
-- is just changing that same row's email/password -- zero data
-- migration, since attendance_records.member_id/offerings.member_id/
-- member_cases.subject_user_id etc. never stop pointing at the same id.

begin;

alter table public.profiles add column if not exists is_silent boolean not null default false;

create extension if not exists pg_trgm;

-- Excludes Silent users from the plan member-limit count (confirmed
-- with the user) -- a Silent record isn't using a seat the way a live
-- account is. Same shape as before, just scoped to is_silent = false.
create or replace function public.member_count_for_tenant_scope(p_tenant_id uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::int
  from public.profiles p
  where p.removed_at is null
    and p.is_silent = false
    and p.tenant_id in (
      select t2.id from public.tenants t2
      where t2.denomination_id = (select denomination_id from public.tenants where id = p_tenant_id)
      union
      select p_tenant_id
    );
$$;

-- Pre-auth-callable (anon): both the admin "Add User" flow and the
-- self-serve signup screen need this before a session exists. Returns
-- at most one row (never a list) to keep what a pre-auth visitor can
-- learn about existing people to a minimum.
create or replace function public.find_silent_user_match(p_full_name text, p_tenant_id uuid default null)
returns table (id uuid, full_name text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select p.id, p.full_name
  from public.profiles p
  where p.is_silent
    and p.removed_at is null
    and (p_tenant_id is null or p.tenant_id = p_tenant_id)
    and similarity(p.full_name, p_full_name) >= 0.5
  order by similarity(p.full_name, p_full_name) desc
  limit 1;
$$;

grant execute on function public.find_silent_user_match(text, uuid) to anon, authenticated;

-- Admin-review queue for a self-serve signup that name-matched a
-- Silent user but didn't corroborate with a matching email/phone
-- (upgrade-silent-user Edge Function inserts here, via its
-- service-role client -- RLS below only ever needs to allow the
-- pastoral team to read/decide, never a client-side insert).
create table if not exists public.silent_user_claims (
  id uuid primary key default gen_random_uuid(),
  silent_profile_id uuid not null references public.profiles(id) on delete cascade,
  claimed_full_name text not null,
  claimed_email text,
  claimed_phone text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id)
);

alter table public.silent_user_claims enable row level security;

create policy "silent user claims are readable by the pastoral team" on public.silent_user_claims
  for select to authenticated using (
    public.is_pastoral_team() or public.is_church_admin()
  );

create policy "silent user claims are updated by the pastoral team" on public.silent_user_claims
  for update to authenticated using (
    public.is_pastoral_team() or public.is_church_admin()
  ) with check (
    public.is_pastoral_team() or public.is_church_admin()
  );

create policy "tenant_isolation" on public."silent_user_claims" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

commit;

select pg_notify('pgrst', 'reload schema');
