-- Fixes "Guest Cases disappeared": the "Delete" button in
-- guestOnboardingHub.js called a real, unconditional DELETE (the
-- policy below, dropped here), with guest_follow_up_transfers'
-- ON DELETE CASCADE wiping the routing history with it -- no trash,
-- no undo, one click next to the status dropdown. Converts it to the
-- same soft-delete/restore shape offerings already uses
-- (removed_at/removed_by/removed_reason, filtered client-side --
-- .is('removed_at', null) for the live list, .not(...) for a
-- "Recently Removed" section -- RLS itself doesn't filter by it,
-- same as offerings).
--
-- No new RLS needed for the soft-delete/restore itself: the existing
-- "guest follow-ups are updated by those holding the case" policy
-- already covers the pastoral team updating any column on a row they
-- can see, these three included. Only the DELETE policy needs to go.
-- Already-deleted cases from before this migration cannot be
-- recovered -- there was never a trash to recover them from.

begin;

alter table public.guest_follow_ups
  add column if not exists removed_at timestamptz,
  add column if not exists removed_by uuid references public.profiles(id) on delete set null,
  add column if not exists removed_reason text;

drop policy if exists "guest follow-ups are deleted by the pastoral team" on public.guest_follow_ups;

commit;

select pg_notify('pgrst', 'reload schema');
