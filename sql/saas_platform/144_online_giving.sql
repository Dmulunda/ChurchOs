-- Online giving (feature 2 of the improvement roadmap).
--
-- Members and visitors give by card through Stripe Checkout, on the
-- CHURCH's own Stripe account (Stripe Connect, Standard accounts): the
-- money goes straight to the church, never through ChurchOnPoint. A
-- church connects its account once from Offerings -> Online giving.
-- Interac e-Transfer and mobile money (M-Pesa, Orange Money, Airtel
-- Money...) are shown as instructions on the giving page and recorded by
-- Finance as usual -- no provider integration (and no cost) yet.
--
-- A paid gift becomes a normal offerings row (payment_method 'online'),
-- so it shows in Offerings, the monthly PDF report, and -- when the
-- giver was signed in -- their year-end tax receipt (offering_tax_sync
-- mirrors member-linked offerings into donation_entries, sql/57).
--
-- Nothing is charged and nothing is live until (1) this file is
-- applied, (2) the online-giving + online-giving-webhook edge functions
-- are deployed with their secrets, and (3) a church connects Stripe and
-- switches giving on.

begin;

alter table public.offerings drop constraint if exists offerings_payment_method_check;
alter table public.offerings add constraint offerings_payment_method_check
  check (payment_method in ('cash', 'transfer', 'check', 'other', 'online'));

create table if not exists public.giving_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  enabled boolean not null default false,
  stripe_account_id text,
  stripe_charges_enabled boolean not null default false,
  default_currency text not null default 'CAD' check (default_currency in ('CAD', 'USD', 'EUR')),
  interac_email text,
  mobile_money_instructions text,
  thank_you_message text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
alter table public.giving_settings enable row level security;

drop policy if exists "members read their church giving settings" on public.giving_settings;
create policy "members read their church giving settings" on public.giving_settings
  for select to authenticated using (tenant_id = public.current_tenant_id());
-- No insert/update policy: the church-editable fields go through
-- update_giving_settings() below, and the Stripe fields are written only
-- by the online-giving edge function (service role).

create or replace function public.update_giving_settings(
  p_enabled boolean,
  p_default_currency text,
  p_interac_email text,
  p_mobile_money_instructions text,
  p_thank_you_message text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := public.current_tenant_id();
begin
  if v_tenant is null or not (public.is_super_admin() or public.can_delete_offerings()) then
    raise exception 'Only a Super Admin or a Finance admin can change online giving';
  end if;
  insert into public.giving_settings (tenant_id, enabled, default_currency, interac_email, mobile_money_instructions, thank_you_message, updated_at, updated_by)
  values (v_tenant, coalesce(p_enabled, false), coalesce(p_default_currency, 'CAD'),
          nullif(trim(p_interac_email), ''), nullif(trim(p_mobile_money_instructions), ''), nullif(trim(p_thank_you_message), ''),
          now(), auth.uid())
  on conflict (tenant_id) do update set
    enabled = excluded.enabled,
    default_currency = excluded.default_currency,
    interac_email = excluded.interac_email,
    mobile_money_instructions = excluded.mobile_money_instructions,
    thank_you_message = excluded.thank_you_message,
    updated_at = now(),
    updated_by = auth.uid();
end;
$$;
revoke all on function public.update_giving_settings(boolean, text, text, text, text) from public, anon;
grant execute on function public.update_giving_settings(boolean, text, text, text, text) to authenticated;

-- What the public giving page (give.html?church=<slug>) may know. Never
-- exposes the Stripe account id.
create or replace function public.get_public_giving_info(p_tenant_slug text)
returns table (
  tenant_name text, logo_url text, enabled boolean, card_enabled boolean,
  default_currency text, interac_email text, mobile_money_instructions text, thank_you_message text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select t.name, t.logo_url,
         coalesce(g.enabled, false),
         coalesce(g.enabled and g.stripe_charges_enabled and g.stripe_account_id is not null, false),
         coalesce(g.default_currency, 'CAD'),
         case when g.enabled then g.interac_email end,
         case when g.enabled then g.mobile_money_instructions end,
         g.thank_you_message
  from public.tenants t
  left join public.giving_settings g on g.tenant_id = t.id
  where t.slug = p_tenant_slug and t.deleted_at is null;
$$;
grant execute on function public.get_public_giving_info(text) to anon, authenticated;

create table if not exists public.online_gifts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  donor_name text not null check (length(trim(donor_name)) between 1 and 200),
  donor_email text,
  amount_cents integer not null check (amount_cents between 100 and 5000000),
  currency text not null check (currency in ('CAD', 'USD', 'EUR')),
  offering_type text not null check (offering_type in ('tithe', 'general', 'sacrifice', 'construction', 'other')),
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'refunded')),
  stripe_session_id text unique,
  stripe_payment_intent_id text,
  offering_id uuid references public.offerings(id) on delete set null,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists online_gifts_tenant_created_idx on public.online_gifts (tenant_id, created_at desc);
alter table public.online_gifts enable row level security;

drop policy if exists "finance reads online gifts" on public.online_gifts;
create policy "finance reads online gifts" on public.online_gifts
  for select to authenticated using (tenant_id = public.current_tenant_id() and public.can_record_offerings());
drop policy if exists "givers read their own gifts" on public.online_gifts;
create policy "givers read their own gifts" on public.online_gifts
  for select to authenticated using (user_id = auth.uid());
-- Rows are created and updated only by the edge functions (service role).

-- Called only by online-giving-webhook (service role) when Stripe
-- confirms payment. Idempotent: a repeated webhook for the same session
-- returns the existing offering instead of recording the gift twice.
create or replace function public.record_online_gift_paid(p_session_id text, p_payment_intent_id text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_gift public.online_gifts;
  v_recorder uuid;
  v_offering uuid;
begin
  select * into v_gift from public.online_gifts where stripe_session_id = p_session_id for update;
  if not found then return null; end if;
  if v_gift.status = 'paid' then return v_gift.offering_id; end if;

  -- offerings.recorded_by is required: the giver when signed in,
  -- otherwise the church's primary admin (any Super Admin as fallback).
  v_recorder := v_gift.user_id;
  if v_recorder is null then
    select p.id into v_recorder from public.profiles p
    where p.tenant_id = v_gift.tenant_id and p.removed_at is null
      and (p.is_primary_admin or p.global_role = 'super_admin')
    order by p.is_primary_admin desc nulls last, p.created_at
    limit 1;
  end if;
  if v_recorder is null then raise exception 'No admin found to record online gift %', v_gift.id; end if;

  insert into public.offerings (tenant_id, donor_name, offering_date, amount_cents, offering_type,
                                recorded_by, payment_method, member_id, currency)
  values (v_gift.tenant_id, v_gift.donor_name, (now() at time zone 'America/Toronto')::date, v_gift.amount_cents,
          v_gift.offering_type, v_recorder, 'online', v_gift.user_id, v_gift.currency)
  returning id into v_offering;

  update public.online_gifts
  set status = 'paid', paid_at = now(), stripe_payment_intent_id = p_payment_intent_id, offering_id = v_offering
  where id = v_gift.id;

  return v_offering;
end;
$$;
revoke all on function public.record_online_gift_paid(text, text) from public, anon, authenticated;

commit;

select pg_notify('pgrst', 'reload schema');
