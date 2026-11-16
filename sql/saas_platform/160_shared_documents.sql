-- Shared documents & meeting minutes (feature 10 of the improvement roadmap).
--
-- One place for the church's documents: files (PDF, Word, Excel, images...),
-- links (e.g. a Google Drive folder) and meeting minutes written in the app
-- (date, who was there, notes, decisions, action items). Each item belongs
-- to the whole church or to one department, and is visible to:
--   'everyone'   -- everybody in the church
--   'department' -- members of that department
--   'leaders'    -- the pastoral team and department admins/secretaries
-- The pastoral team sees and manages everything. A department's admins
-- (can_write_department) manage that department's items. Leaders can add
-- church-wide items too.
--
-- Storage: private bucket 'church-documents' (50 MB per file), files under
-- <tenant_id>/<document_id>/..., readable only through the document's own
-- visibility (checked against the row).

begin;

-- Same definition as in 150_church_calendar.sql, repeated so this file does
-- not depend on 150 being applied first.
create or replace function public.is_church_leader()
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select public.is_pastoral_team() or exists (
    select 1 from public.department_memberships dm
    where dm.user_id = auth.uid() and dm.status = 'approved' and dm.role in ('admin', 'secretary')
      and dm.tenant_id = public.current_tenant_id());
$$;
grant execute on function public.is_church_leader() to authenticated;

create table if not exists public.church_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('file', 'link', 'minutes')),
  title text not null check (length(trim(title)) between 1 and 200),
  description text,
  department_id uuid references public.departments(id) on delete cascade,
  visibility text not null default 'everyone' check (visibility in ('everyone', 'department', 'leaders')),
  folder text check (folder is null or length(folder) <= 80),
  file_path text,
  file_name text,
  url text check (url is null or url ~* '^https://'),
  meeting_date date,
  attendees text,
  body text,
  decisions text,
  action_items text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check (visibility <> 'department' or department_id is not null)
);
create index if not exists church_documents_tenant_idx on public.church_documents (tenant_id, created_at desc);
create index if not exists church_documents_dept_idx on public.church_documents (department_id);

create or replace function public.can_read_church_document(p_doc public.church_documents)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select p_doc.tenant_id = public.current_tenant_id() and (
       public.is_pastoral_team()
    or p_doc.created_by = auth.uid()
    or p_doc.visibility = 'everyone'
    or (p_doc.visibility = 'department' and public.can_read_department(p_doc.department_id))
    or (p_doc.visibility = 'leaders' and public.is_church_leader()));
$$;

create or replace function public.can_manage_church_document(p_department_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select public.is_pastoral_team()
      or (p_department_id is not null and public.can_write_department(p_department_id))
      or (p_department_id is null and public.is_church_leader());
$$;
grant execute on function public.can_manage_church_document(uuid) to authenticated;

alter table public.church_documents enable row level security;
drop policy if exists "read documents by visibility" on public.church_documents;
create policy "read documents by visibility" on public.church_documents
  for select to authenticated using (public.can_read_church_document(church_documents));
drop policy if exists "managers write documents" on public.church_documents;
create policy "managers write documents" on public.church_documents
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.can_manage_church_document(department_id))
  with check (tenant_id = public.current_tenant_id() and public.can_manage_church_document(department_id));

create or replace function public.touch_church_document()
returns trigger language plpgsql set search_path = public, pg_temp
as $$ begin new.updated_at := now(); return new; end; $$;
drop trigger if exists church_documents_touch on public.church_documents;
create trigger church_documents_touch before update on public.church_documents
  for each row execute function public.touch_church_document();

insert into storage.buckets (id, name, public, file_size_limit)
values ('church-documents', 'church-documents', false, 52428800)
on conflict (id) do nothing;

-- Files: <tenant_id>/<document_id>/<name>. Access follows the document row.
create or replace function public.church_document_file_access(p_name text, p_write boolean)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select (storage.foldername(p_name))[1] = public.current_tenant_id()::text
     and exists (select 1 from public.church_documents d
                  where d.id::text = (storage.foldername(p_name))[2]
                    and d.tenant_id = public.current_tenant_id()
                    and case when p_write then public.can_manage_church_document(d.department_id)
                             else public.can_read_church_document(d) end);
$$;
grant execute on function public.church_document_file_access(text, boolean) to authenticated;

drop policy if exists "read church document files" on storage.objects;
create policy "read church document files" on storage.objects
  for select to authenticated
  using (bucket_id = 'church-documents' and public.church_document_file_access(name, false));
drop policy if exists "write church document files" on storage.objects;
create policy "write church document files" on storage.objects
  for all to authenticated
  using (bucket_id = 'church-documents' and public.church_document_file_access(name, true))
  with check (bucket_id = 'church-documents' and public.church_document_file_access(name, true));

commit;

select pg_notify('pgrst', 'reload schema');
