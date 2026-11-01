-- Projection themes: named text/background presets for the three
-- kinds of thing Projection ever puts on screen (Songs, Bible, Media),
-- picked per tenant by Media & Tech rather than hardcoded white-on-
-- black. Cloud-stored (not local-folder-only, unlike images/video) --
-- themes are tiny JSON, so keeping them in Supabase means every
-- computer this tenant's operators use sees the same theme choices,
-- with no per-laptop setup needed.
--
-- background_type/background_value: 'color' -> a hex color string;
-- 'gradient' -> a ready-to-use CSS gradient string (e.g.
-- "linear-gradient(135deg,#1e293b,#312e81)"); 'image' is accepted by
-- the schema for a future custom-image theme but has no authoring UI
-- yet (would need its own upload story -- out of scope here, same as
-- every other local-only media in this app).
create table if not exists public.projection_themes (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  category text not null,
  name text not null,
  text_color text not null default '#ffffff',
  font_family text,
  background_type text not null default 'color',
  background_value text not null default '#000000',
  is_default boolean not null default false,
  created_by uuid,
  created_at timestamp with time zone default now() not null
);

alter table public.projection_themes add constraint projection_themes_pkey primary key (id);
alter table public.projection_themes add constraint projection_themes_category_check check (category = any (array['songs', 'bible', 'media']));
alter table public.projection_themes add constraint projection_themes_background_type_check check (background_type = any (array['color', 'gradient', 'image']));
alter table public.projection_themes add constraint projection_themes_tenant_id_fkey foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public.projection_themes add constraint projection_themes_created_by_fkey foreign key (created_by) references public.profiles(id);

create index projection_themes_tenant_category_idx on public.projection_themes using btree (tenant_id, category);
-- At most one default per tenant+category -- the modal's "Set as
-- default" always goes through set_default_projection_theme() below,
-- which clears the old default first, so this is a backstop against
-- any other write path leaving two defaults behind.
create unique index projection_themes_default_per_category on public.projection_themes using btree (tenant_id, category) where (is_default);

alter table public.projection_themes enable row level security;

create policy "tenant_isolation" on public.projection_themes as restrictive for all
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create policy "projection_themes_select" on public.projection_themes for select to authenticated
  using (is_super_admin() or can_read_department((select departments.id from departments where departments.key = 'media_tech'::text)));

create policy "projection_themes_write" on public.projection_themes for all to authenticated
  using (is_super_admin() or can_read_department((select departments.id from departments where departments.key = 'media_tech'::text)))
  with check (is_super_admin() or can_read_department((select departments.id from departments where departments.key = 'media_tech'::text)));

-- Atomically swaps which theme is the default for its own
-- tenant+category (clears the old default first, in the SAME
-- statement set as setting the new one, so the partial unique index
-- above is never briefly violated and never briefly empty either).
create or replace function public.set_default_projection_theme(p_theme_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_category text;
begin
  select tenant_id, category into v_tenant_id, v_category
  from projection_themes
  where id = p_theme_id;

  if v_tenant_id is null then
    raise exception 'Theme not found';
  end if;

  if v_tenant_id <> current_tenant_id() then
    raise exception 'Theme belongs to a different tenant';
  end if;

  if not (is_super_admin() or can_read_department((select id from departments where key = 'media_tech'))) then
    raise exception 'Not authorized to manage projection themes';
  end if;

  update projection_themes set is_default = false
  where tenant_id = v_tenant_id and category = v_category and is_default;

  update projection_themes set is_default = true
  where id = p_theme_id;
end;
$$;

grant execute on function public.set_default_projection_theme(uuid) to authenticated;

-- Seed 2-3 built-in presets per category per existing tenant, one
-- default each -- an operator who never touches theming at all still
-- gets something better than hardcoded white-on-black. created_by is
-- left null (system-seeded, not any particular person's work).
insert into public.projection_themes (tenant_id, category, name, text_color, background_type, background_value, is_default)
select t.id, preset.category, preset.name, preset.text_color, preset.background_type, preset.background_value, preset.is_default
from public.tenants t
cross join (values
  ('songs', 'Classic', '#ffffff', 'color', '#000000', true),
  ('songs', 'Warm', '#fde68a', 'gradient', 'linear-gradient(135deg,#1e1b4b,#78350f)', false),
  ('songs', 'Clean', '#0f172a', 'color', '#f8fafc', false),
  ('bible', 'Classic', '#ffffff', 'color', '#000000', true),
  ('bible', 'Warm', '#fde68a', 'gradient', 'linear-gradient(135deg,#1e1b4b,#78350f)', false),
  ('bible', 'Clean', '#0f172a', 'color', '#f8fafc', false),
  ('media', 'Classic', '#ffffff', 'color', '#000000', true),
  ('media', 'Warm', '#fde68a', 'gradient', 'linear-gradient(135deg,#1e1b4b,#78350f)', false),
  ('media', 'Clean', '#0f172a', 'color', '#f8fafc', false)
) as preset(category, name, text_color, background_type, background_value, is_default)
where not exists (
  select 1 from public.projection_themes existing
  where existing.tenant_id = t.id and existing.category = preset.category and existing.name = preset.name
);

-- From now on, every NEW tenant gets the same presets at signup time,
-- not just the ones that existed when this migration ran -- adds the
-- insert to the end of the existing signup function rather than a
-- separate "on tenant created" trigger, since this is the one place
-- that already owns "what a brand-new tenant starts with".
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

  insert into public.tenants (name, slug, status, trial_ends_at)
  values (trim(p_name), p_slug, 'trial', now() + interval '30 days')
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

revoke execute on function public.create_tenant_for_signup(text, text) from public;
grant execute on function public.create_tenant_for_signup(text, text) to anon, authenticated;
