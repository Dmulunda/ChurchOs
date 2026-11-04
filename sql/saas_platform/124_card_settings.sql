-- Lets a tenant's Super Admin set a Member ID Card (js/components/
-- memberIdCard.js) body color and choose which optional fields show
-- (e.g. hide birth date), via the new "Member Card" section of
-- Customize Menu (menuCustomizer.js) -- same shape/RLS pattern as
-- app_theme, just for the card instead of the whole app.
create table if not exists public.card_settings (
  tenant_id uuid primary key default public.current_tenant_id() references public.tenants(id) on delete cascade,
  card_color text not null default '#0B1F3A',
  show_sex boolean not null default true,
  show_birth_date boolean not null default true,
  show_function boolean not null default true,
  show_parish boolean not null default true,
  show_address boolean not null default true,
  show_birth_info boolean not null default true,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists card_settings_tenant_id_idx on public.card_settings (tenant_id);

alter table public.card_settings enable row level security;

create trigger force_updated_at before insert or update on public.card_settings
  for each row execute function public.force_server_timestamp_updated_at();

create policy "card settings is managed by super admin" on public.card_settings for all
  to authenticated using (public.is_super_admin()) with check (public.is_super_admin());
create policy "card settings is readable by everyone" on public.card_settings for select
  to authenticated using (true);
create policy "tenant_isolation" on public.card_settings as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
