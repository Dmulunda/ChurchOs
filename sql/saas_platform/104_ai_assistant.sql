-- In-App AI Assistant, Part 1: schema foundation. Replaces the old
-- PDF-upload Help system (js/components/helpModal.js, retired in a
-- later migration) with a chat assistant that answers "how do I use
-- this" questions. Role-awareness and data privacy are enforced
-- structurally, not by prompting: the assistant is only ever given
-- (a) pre-filtered how-to-use-the-app prose and (b) the conversation
-- itself -- it has no database query tool, so it cannot leak case
-- contents, and admin-only knowledge rows are excluded from its
-- context before the request is even built, so it cannot describe
-- features a member's role doesn't have.

begin;

create table if not exists public.assistant_knowledge_base (
  id uuid primary key default gen_random_uuid(),
  topic text not null,
  content_en text not null,
  content_fr text not null,
  -- Coarse tiers matching this app's real role vocabulary, not a
  -- precise per-feature ACL -- good enough to satisfy "don't explain
  -- admin tools to a plain member" without needing to hand-model
  -- every one of this schema's many granular permission flags.
  audience text not null default 'everyone' check (audience in ('everyone', 'department_admin', 'pastoral', 'finance', 'super_admin')),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id)
);

alter table public.assistant_knowledge_base enable row level security;

create policy "assistant knowledge is readable by any signed-in user" on public.assistant_knowledge_base
  for select to authenticated using (true);

create policy "assistant knowledge is writable by super admins" on public.assistant_knowledge_base
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

create policy "tenant_isolation" on public."assistant_knowledge_base" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

-- One continuous thread per user (not multiple named conversations --
-- this is a lightweight how-do-I helper, not a general chat tool).
create table if not exists public.assistant_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id),
  unique (user_id, tenant_id)
);

alter table public.assistant_conversations enable row level security;

create policy "assistant conversations are private to their owner" on public.assistant_conversations
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "tenant_isolation" on public."assistant_conversations" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

create table if not exists public.assistant_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.assistant_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

alter table public.assistant_messages enable row level security;

create policy "assistant messages are private to the conversation owner" on public.assistant_messages
  for select to authenticated using (
    exists (select 1 from public.assistant_conversations c where c.id = conversation_id and c.user_id = auth.uid())
  );

create index if not exists assistant_messages_conversation_idx on public.assistant_messages (conversation_id, created_at);

-- Reuses the existing permission helpers this whole schema already
-- relies on rather than re-implementing role logic elsewhere --
-- called via a client scoped to the CALLER's own JWT (so auth.uid()
-- resolves correctly inside them), before the Edge Function switches
-- to its service-role client for everything else.
create or replace function public.get_my_assistant_audience_tiers()
returns text[]
language sql
stable security definer
set search_path to 'public'
as $$
  select array_remove(array[
    'everyone',
    case when public.is_pastoral_team() or public.is_church_admin()
      or exists (select 1 from public.department_memberships where user_id = auth.uid() and status = 'approved' and role = 'admin')
      then 'pastoral' end,
    case when exists (select 1 from public.department_memberships where user_id = auth.uid() and status = 'approved' and role in ('admin', 'secretary'))
      then 'department_admin' end,
    case when public.can_manage_finance() then 'finance' end,
    case when public.is_super_admin() then 'super_admin' end
  ], null);
$$;

grant execute on function public.get_my_assistant_audience_tiers() to authenticated;

commit;

select pg_notify('pgrst', 'reload schema');
