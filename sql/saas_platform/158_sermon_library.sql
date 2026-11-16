-- Sermon & media library (feature 9 of the improvement roadmap).
--
-- Every sermon in one searchable place: title, preacher, date, series,
-- Bible passage, language, a short summary, a video link (YouTube,
-- Facebook...), and optional audio and notes (PDF) files kept in a private
-- storage bucket. Members browse and listen; the pastoral team and the
-- Media / Preaching departments add and edit.
--
-- Storage: bucket 'sermon-files' (private, 200 MB per file, audio + PDF).
-- Files live under <tenant_id>/..., readable only by that church's signed-in
-- people (the app uses short-lived signed links).

begin;

create or replace function public.can_manage_sermons()
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select public.is_pastoral_team()
      or exists (select 1 from public.departments d
                  where d.tenant_id = public.current_tenant_id()
                    and d.key in ('media_tech', 'preaching', 'photographie_videographie_ebe_media')
                    and public.can_write_department(d.id));
$$;
grant execute on function public.can_manage_sermons() to authenticated;

create table if not exists public.sermons (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 200),
  preacher text check (preacher is null or length(preacher) <= 120),
  preached_on date not null default current_date,
  series text check (series is null or length(series) <= 120),
  scripture text check (scripture is null or length(scripture) <= 200),
  language text not null default 'fr' check (language in ('fr', 'en', 'both', 'other')),
  summary text,
  video_url text check (video_url is null or video_url ~* '^https://'),
  audio_path text,
  notes_path text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists sermons_tenant_date_idx on public.sermons (tenant_id, preached_on desc);

alter table public.sermons enable row level security;
drop policy if exists "church reads sermons" on public.sermons;
create policy "church reads sermons" on public.sermons
  for select to authenticated using (tenant_id = public.current_tenant_id());
drop policy if exists "sermon managers write sermons" on public.sermons;
create policy "sermon managers write sermons" on public.sermons
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.can_manage_sermons())
  with check (tenant_id = public.current_tenant_id() and public.can_manage_sermons());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sermon-files', 'sermon-files', false, 209715200,
        array['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/wav', 'audio/ogg', 'application/pdf'])
on conflict (id) do nothing;

drop policy if exists "church reads sermon files" on storage.objects;
create policy "church reads sermon files" on storage.objects
  for select to authenticated
  using (bucket_id = 'sermon-files' and (storage.foldername(name))[1] = public.current_tenant_id()::text);
drop policy if exists "sermon managers write sermon files" on storage.objects;
create policy "sermon managers write sermon files" on storage.objects
  for all to authenticated
  using (bucket_id = 'sermon-files' and (storage.foldername(name))[1] = public.current_tenant_id()::text and public.can_manage_sermons())
  with check (bucket_id = 'sermon-files' and (storage.foldername(name))[1] = public.current_tenant_id()::text and public.can_manage_sermons());

commit;

select pg_notify('pgrst', 'reload schema');
