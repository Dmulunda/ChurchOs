-- 174 (applied): the redesign's navy/gold look becomes the default theme.
-- Churches that still had the old untouched default (indigo/slate) were
-- moved to the new one; churches that picked their own colours keep them.
alter table public.app_theme alter column primary_color set default '#0B1F3A';
alter table public.app_theme alter column text_color set default '#1B2433';
alter table public.app_theme alter column background_color set default '#F6F4EF';
alter table public.app_theme alter column font_family set default 'inter';
update public.app_theme set primary_color = '#0B1F3A', text_color = '#1B2433', background_color = '#F6F4EF', font_family = 'inter'
where lower(primary_color) = '#4f46e5' and lower(text_color) = '#1e293b' and lower(background_color) = '#f1f5f9' and font_family = 'default';
