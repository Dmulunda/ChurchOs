-- Silent Users Part 6: retire Guest Donors (sql/saas_platform/65),
-- now fully superseded by Silent Users -- a guest donor was always
-- "a real person who gives but has no account," which is exactly what
-- a Silent user already is, except Silent users also work for
-- attendance and cases, not just offerings. Run only after the
-- one-time data migration (converts every existing guest_donors row
-- into a Silent profile and repoints offerings/donation_entries/
-- tax_receipts at its member_id) has been verified -- confirmed done,
-- zero remaining guest_donor_id references anywhere, before this ran.

begin;

alter table public.offerings drop column guest_donor_id;
alter table public.donation_entries drop column guest_donor_id;
alter table public.tax_receipts drop column guest_donor_id;
drop table public.guest_donors;

create or replace function public.sync_offering_to_donation_entry()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.member_id is not null then
    insert into public.donation_entries (tenant_id, member_id, raw_name, donation_date, amount, currency, created_by, source_offering_id)
    values (new.tenant_id, new.member_id, new.donor_name, new.offering_date, new.amount_cents / 100.0, new.currency, new.recorded_by, new.id)
    on conflict (source_offering_id) where source_offering_id is not null do update
      set member_id = excluded.member_id, raw_name = excluded.raw_name,
          donation_date = excluded.donation_date, amount = excluded.amount, currency = excluded.currency;
  else
    delete from public.donation_entries where source_offering_id = new.id;
  end if;
  return new;
end;
$$;

-- A Silent member's own email can be a placeholder
-- (silent-<uuid>@noemail.internal, from create-silent-user) rather
-- than one that can actually receive a receipt -- the old guest_donor
-- path required a real email before issuing one; a Silent member
-- needs the same guard, on top of (not in place of) legal_name, which
-- a live member's eligibility has always rested on alone.
--
-- drop first: the RETURN TABLE shape is changing (drops
-- skipped_guests), and create or replace can't change an existing
-- function's return type.
drop function public.finalize_tax_receipt_year(integer);

create function public.finalize_tax_receipt_year(p_fiscal_year integer)
returns table(issued_count integer, skipped_members jsonb)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  caller_tenant uuid;
  v_settings public.tax_receipt_settings;
  v_issued int;
  v_skipped jsonb;
  v_next_seq int;
begin
  if not public.can_manage_finance() then
    raise exception 'Only Finance can finalize tax receipts';
  end if;
  caller_tenant := public.current_tenant_id();

  select * into v_settings from public.tax_receipt_settings where tenant_id = caller_tenant;
  if v_settings is null or v_settings.legal_name is null then
    raise exception 'Tax receipt settings have not been configured yet';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name)), '[]'::jsonb)
    into v_skipped
  from (
    select de.member_id, de.currency, sum(de.amount) as total
    from public.donation_entries de
    where de.tenant_id = caller_tenant and de.fiscal_year = p_fiscal_year and de.member_id is not null
    group by de.member_id, de.currency
    having sum(de.amount) > 0
  ) totals
  join public.profiles p on p.id = totals.member_id
  where (
    p.legal_name is null
    or (p.is_silent and not exists (
      select 1 from auth.users u where u.id = p.id and u.email not like '%@noemail.internal'
    ))
  )
    and not exists (
      select 1 from public.tax_receipts tr
      where tr.tenant_id = caller_tenant and tr.member_id = totals.member_id
        and tr.fiscal_year = p_fiscal_year and tr.currency = totals.currency
    );

  select coalesce(max(split_part(receipt_number, '-', 2)::int), 0)
    into v_next_seq
  from public.tax_receipts
  where tenant_id = caller_tenant and fiscal_year = p_fiscal_year;

  with totals as (
    select de.member_id, de.currency, sum(de.amount) as total_amount
    from public.donation_entries de
    where de.tenant_id = caller_tenant and de.fiscal_year = p_fiscal_year and de.member_id is not null
    group by de.member_id, de.currency
    having sum(de.amount) > 0
  ),
  eligible as (
    select t.member_id, t.currency, t.total_amount, p.legal_name,
      row_number() over (order by t.member_id, t.currency) as rn
    from totals t
    join public.profiles p on p.id = t.member_id
    where p.legal_name is not null
      and (
        not p.is_silent
        or exists (select 1 from auth.users u where u.id = p.id and u.email not like '%@noemail.internal')
      )
      and not exists (
        select 1 from public.tax_receipts tr
        where tr.tenant_id = caller_tenant and tr.member_id = t.member_id
          and tr.fiscal_year = p_fiscal_year and tr.currency = t.currency
      )
  )
  insert into public.tax_receipts (
    tenant_id, member_id, fiscal_year, receipt_number, legal_name_snapshot, total_amount, currency, tenant_info_snapshot, issued_by
  )
  select
    caller_tenant,
    e.member_id,
    p_fiscal_year,
    p_fiscal_year::text || '-' || lpad((v_next_seq + e.rn)::text, 4, '0'),
    e.legal_name,
    e.total_amount,
    e.currency,
    to_jsonb(v_settings),
    auth.uid()
  from eligible e;

  get diagnostics v_issued = row_count;

  insert into public.tax_receipt_years (tenant_id, fiscal_year, status, finalized_by, finalized_at)
  values (caller_tenant, p_fiscal_year, 'finalized', auth.uid(), now())
  on conflict (tenant_id, fiscal_year) do update
    set status = 'finalized', finalized_by = excluded.finalized_by, finalized_at = excluded.finalized_at;

  return query select v_issued, v_skipped;
end;
$$;

commit;

select pg_notify('pgrst', 'reload schema');
