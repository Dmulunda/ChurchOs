-- Communication hub (feature 3 of the improvement roadmap).
--
-- One composer (Tools -> Communication hub) sends a message to the whole
-- church or to chosen departments, on any mix of channels:
--   * in-app  -- a 'broadcast' row in notifications (bell icon)
--   * push    -- Web Push to subscribed phones/computers (existing VAPID setup)
--   * email   -- through the existing Resend setup
--   * SMS / WhatsApp -- through Twilio, ONLY once the Twilio secrets are
--                set on the broadcast edge function (they cost money per
--                message); until then the composer shows them as "not set up".
-- The broadcast edge function does the sending and re-checks permission
-- server-side: church-wide needs a pastoral-team role (super_admin,
-- pastor_admin, church_secretary) or can_post_global_announcements;
-- a department needs being that department's admin or secretary.
-- broadcasts keeps a history with per-channel counts.

alter type public.notification_type add value if not exists 'broadcast';

begin;

create table if not exists public.broadcasts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  audience text not null check (audience in ('church', 'departments')),
  department_ids uuid[] not null default '{}',
  title text not null check (length(trim(title)) between 1 and 150),
  body text not null check (length(trim(body)) between 1 and 2000),
  channels text[] not null check (channels <@ array['in_app', 'push', 'email', 'sms', 'whatsapp']::text[] and cardinality(channels) > 0),
  recipient_count integer not null default 0,
  results jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists broadcasts_tenant_created_idx on public.broadcasts (tenant_id, created_at desc);
alter table public.broadcasts enable row level security;

-- History: the sender sees their own; the pastoral team sees all of
-- their church's. Rows are written only by the broadcast edge function.
drop policy if exists "senders and pastoral team read broadcasts" on public.broadcasts;
create policy "senders and pastoral team read broadcasts" on public.broadcasts
  for select to authenticated using (
    tenant_id = public.current_tenant_id()
    and (created_by = auth.uid() or public.is_super_admin() or public.is_pastor_admin() or public.is_church_secretary())
  );

commit;

select pg_notify('pgrst', 'reload schema');
