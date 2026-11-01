-- Adds 'church_program' and 'welcoming_socialisation' to the Basic-plan
-- core department list.
--
-- This is also a live-bug fix, not just a pricing-tier tweak:
-- auto_add_church_program_membership() (01_schema.sql /
-- 38_fix_is_admin_cross_tenant_departments.sql) auto-inserts an *approved*
-- church_program membership every time ANY department membership is
-- approved, for every tenant. That nested insert re-enters this same table's
-- BEFORE trigger chain, including enforce_department_tier_and_admin_limits_
-- trigger (86_pricing_v2.sql), which raises an exception for any non-core
-- department on a tenant without 'all_departments' -- and nothing catches
-- it. Since 'church_program' was never in is_core_department_key()'s list,
-- approving ANY department membership at all has been failing outright for
-- every Basic-tier tenant. Adding it here fixes that as a side effect of
-- the pricing-tier change the user actually asked for.

begin;

create or replace function public.is_core_department_key(p_key text)
returns boolean
language sql immutable
as $$
  select p_key = any (array[
    'media_tech', 'preaching', 'finance', 'ushers', 'ecodem', 'choir', 'cleaning',
    'church_program', 'welcoming_socialisation'
  ]);
$$;

commit;

select pg_notify('pgrst', 'reload schema');
