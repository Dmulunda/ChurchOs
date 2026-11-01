-- Church-to-church referral bonus: a church shares its own referral code,
-- a new church signs up through it, and once that new church's first real
-- payment goes through, the referring church earns a one-time 50%-off
-- credit on its own next bill (applied by supabase/functions/stripe-webhook
-- separately -- this migration only adds the code/tracking/RPC layer).

begin;

alter table public.tenants add column if not exists referral_code text unique;

-- Mirrors generate_member_code()'s own style (01_schema.sql) -- an 8-char
-- uppercase hex-ish slug off a fresh uuid+timestamp hash -- with a "CH-"
-- prefix so a shared link/code reads clearly as a church code, e.g. CH-8F92A.
create or replace function public.generate_referral_code()
returns text
language sql
as $$
  select 'CH-' || upper(substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 5));
$$;

update public.tenants set referral_code = public.generate_referral_code() where referral_code is null;

create or replace function public.create_tenant_for_signup(p_name text, p_slug text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'Church name is required' using errcode = '22023';
  end if;
  if p_slug !~ '^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])$' then
    raise exception 'That URL name isn''t valid -- use lowercase letters, numbers, and hyphens only' using errcode = '22023';
  end if;

  insert into public.tenants (name, slug, status, trial_ends_at, referral_code)
  values (trim(p_name), p_slug, 'trial', now() + interval '30 days', public.generate_referral_code())
  returning id into v_id;

  -- Explicit tenant_id -- the caller is anon (no session, so
  -- current_tenant_id()'s default would resolve to NULL) at this point
  -- in the signup flow, before auth.signUp() has even run yet.
  insert into public.departments (key, name, kind, tenant_id) values
    ('choir', 'Choir', 'choir', v_id),
    ('social', 'Social', 'lightweight', v_id),
    ('intercession', 'Intercession', 'lightweight', v_id),
    ('media_tech', 'Media & Tech', 'lightweight', v_id),
    ('interpreting', 'Interpreting', 'lightweight', v_id),
    ('cleaning', 'Cleaning', 'lightweight', v_id),
    ('preaching', 'Preaching & Moderation', 'lightweight', v_id),
    ('ushers', 'Ushers', 'lightweight', v_id),
    ('security', 'Security', 'lightweight', v_id),
    ('ecodem', 'Sunday School', 'lightweight', v_id),
    ('evangelism', 'Evangelism', 'lightweight', v_id),
    ('welcoming_socialisation', 'Welcoming and Socialisation', 'lightweight', v_id),
    ('grand_jeunes_couples', 'Youth and Couple', 'lightweight', v_id),
    ('finance', 'Finance', 'lightweight', v_id);

  insert into public.projection_themes (tenant_id, category, name, text_color, background_type, background_value, is_default) values
    (v_id, 'songs', 'Classic', '#ffffff', 'color', '#000000', true),
    (v_id, 'songs', 'Warm', '#fde68a', 'gradient', 'linear-gradient(135deg,#1e1b4b,#78350f)', false),
    (v_id, 'songs', 'Clean', '#0f172a', 'color', '#f8fafc', false),
    (v_id, 'bible', 'Classic', '#ffffff', 'color', '#000000', true),
    (v_id, 'bible', 'Warm', '#fde68a', 'gradient', 'linear-gradient(135deg,#1e1b4b,#78350f)', false),
    (v_id, 'bible', 'Clean', '#0f172a', 'color', '#f8fafc', false),
    (v_id, 'media', 'Classic', '#ffffff', 'color', '#000000', true),
    (v_id, 'media', 'Warm', '#fde68a', 'gradient', 'linear-gradient(135deg,#1e1b4b,#78350f)', false),
    (v_id, 'media', 'Clean', '#0f172a', 'color', '#f8fafc', false);

  return v_id;
exception
  when unique_violation then
    raise exception 'That URL name is already taken -- try another' using errcode = '23505';
end;
$$;

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_tenant_id uuid not null references public.tenants(id) on delete cascade,
  referred_tenant_id uuid not null unique references public.tenants(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'qualified', 'applied')),
  bonus_percentage numeric not null default 50,
  created_at timestamptz not null default now(),
  qualified_at timestamptz,
  applied_at timestamptz,
  constraint referrals_no_self_referral check (referrer_tenant_id <> referred_tenant_id)
);

alter table public.referrals enable row level security;

create policy "referrals readable by either tenant" on public.referrals
  for select to authenticated
  using (referrer_tenant_id = public.current_tenant_id() or referred_tenant_id = public.current_tenant_id());

-- Called by a brand-new tenant's own just-created session, right after
-- signup, with whatever ?ref= code the signup link carried. Best-effort by
-- design on the caller's side (authScreen.js wraps this in try/catch, same
-- as the existing claim_tenant_admin() call there) -- a bad or missing code
-- must never block signup, so this raises only on genuine misuse
-- (self-referral), and silently no-ops on an unknown code or an
-- already-referred tenant rather than erroring.
create or replace function public.record_referral(p_referral_code text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_referrer_tenant_id uuid;
  v_my_tenant_id uuid;
begin
  v_my_tenant_id := public.current_tenant_id();
  if v_my_tenant_id is null or p_referral_code is null then
    return;
  end if;

  select id into v_referrer_tenant_id from public.tenants where referral_code = trim(p_referral_code);
  if v_referrer_tenant_id is null or v_referrer_tenant_id = v_my_tenant_id then
    return;
  end if;

  insert into public.referrals (referrer_tenant_id, referred_tenant_id, status)
  values (v_referrer_tenant_id, v_my_tenant_id, 'pending')
  on conflict (referred_tenant_id) do nothing;
end;
$$;

create or replace function public.list_my_referrals()
returns table(referred_church_name text, status text, bonus_percentage numeric, created_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select t.name, r.status, r.bonus_percentage, r.created_at
  from public.referrals r
  join public.tenants t on t.id = r.referred_tenant_id
  where r.referrer_tenant_id = public.current_tenant_id()
  order by r.created_at desc;
$$;

revoke execute on function public.record_referral(text) from public;
grant execute on function public.record_referral(text) to authenticated;
revoke execute on function public.list_my_referrals() from public;
grant execute on function public.list_my_referrals() to authenticated;

commit;

select pg_notify('pgrst', 'reload schema');
