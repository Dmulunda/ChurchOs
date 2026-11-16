-- AI writing helper (feature 12 of the improvement roadmap).
--
-- Extends the existing AI assistant (which only answers "how do I use the
-- app") with writing help for leaders: translate FR <-> EN, polish an
-- announcement, turn rough meeting notes into minutes, summarise a sermon.
-- The work happens in the 'ai-writer' edge function (same ANTHROPIC_API_KEY
-- as ai-assistant). This file only adds the usage log the function uses for
-- its daily limit and for the owner to see consumption.

begin;

-- Same definition as in 150/160, repeated so this file stands alone.
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

create table if not exists public.ai_usage_log (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  task text not null,
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_log_user_day_idx on public.ai_usage_log (user_id, created_at desc);
create index if not exists ai_usage_log_tenant_idx on public.ai_usage_log (tenant_id, created_at desc);

alter table public.ai_usage_log enable row level security;
-- Written only by the edge function (service role). Super admins can read
-- their church's usage.
drop policy if exists "super admins read ai usage" on public.ai_usage_log;
create policy "super admins read ai usage" on public.ai_usage_log
  for select to authenticated using (tenant_id = public.current_tenant_id() and public.is_super_admin());

commit;
