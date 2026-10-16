-- Everyone in Finance can still ENTER offerings (insert policy
-- unchanged, can_record_offerings() -- any approved Finance member).
-- Reading is now time-limited for non-admins: a plain Finance member
-- only sees today's entries; once the day is over they no longer see
-- those rows. Finance admins/secretaries and the three global
-- oversight roles (already exactly what can_delete_offerings()
-- checks -- reused as-is, not reinvented) keep full history: past
-- offerings, totals, reports.

begin;

drop policy if exists "finance team can read offerings" on public.offerings;
create policy "finance team can read offerings" on public.offerings
  for select to authenticated using (
    public.can_delete_offerings()
    or (public.can_record_offerings() and offering_date = current_date)
  );

commit;

select pg_notify('pgrst', 'reload schema');
