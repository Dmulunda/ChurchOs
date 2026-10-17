-- On Pro and Premium, only a Media & Tech admin (or super admin) can
-- open or control Projection -- other Media members can still see the
-- department (Dashboard/Scheduling), just not this tab. Tightens
-- projection_schedule_items/projection_schedules/projection_themes'
-- select+write and projection_settings' update from
-- can_read_department (any approved member) to can_write_department
-- (admin only). projection_settings_select (using (true)) is left
-- alone -- it's open to every tenant member regardless of department
-- today, likely for an unrelated "what's live right now" read, and
-- changing it risks breaking something never asked about. This is a
-- second, independent layer on top of the has_feature('projection')
-- plan gate (sql/86) -- that one is untouched too.

begin;

drop policy if exists "projection_schedule_items_select" on public.projection_schedule_items;
create policy "projection_schedule_items_select" on public.projection_schedule_items for select to authenticated
  using (is_super_admin() or can_write_department((select id from public.departments where key = 'media_tech')));

drop policy if exists "projection_schedule_items_write" on public.projection_schedule_items;
create policy "projection_schedule_items_write" on public.projection_schedule_items for all to authenticated
  using (is_super_admin() or can_write_department((select id from public.departments where key = 'media_tech')))
  with check (is_super_admin() or can_write_department((select id from public.departments where key = 'media_tech')));

drop policy if exists "projection_schedules_select" on public.projection_schedules;
create policy "projection_schedules_select" on public.projection_schedules for select to authenticated
  using (is_super_admin() or can_write_department((select id from public.departments where key = 'media_tech')));

drop policy if exists "projection_schedules_write" on public.projection_schedules;
create policy "projection_schedules_write" on public.projection_schedules for all to authenticated
  using (is_super_admin() or can_write_department((select id from public.departments where key = 'media_tech')))
  with check (is_super_admin() or can_write_department((select id from public.departments where key = 'media_tech')));

drop policy if exists "projection_settings_update" on public.projection_settings;
create policy "projection_settings_update" on public.projection_settings for update to authenticated
  using (is_super_admin() or can_write_department((select id from public.departments where key = 'media_tech')))
  with check (is_super_admin() or can_write_department((select id from public.departments where key = 'media_tech')));

drop policy if exists "projection_themes_select" on public.projection_themes;
create policy "projection_themes_select" on public.projection_themes for select to authenticated
  using (is_super_admin() or can_write_department((select id from public.departments where key = 'media_tech')));

drop policy if exists "projection_themes_write" on public.projection_themes;
create policy "projection_themes_write" on public.projection_themes for all to authenticated
  using (is_super_admin() or can_write_department((select id from public.departments where key = 'media_tech')))
  with check (is_super_admin() or can_write_department((select id from public.departments where key = 'media_tech')));

commit;

select pg_notify('pgrst', 'reload schema');
