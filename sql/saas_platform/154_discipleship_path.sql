-- Discipleship path (feature 7 of the improvement roadmap).
--
-- Each church defines its growth steps (first visit, salvation, membership
-- class, baptism, small group, serving, leadership training...). The
-- pastoral team ticks the steps each person in the member database has
-- completed, with the date. Pastors see how many people are at each step
-- and who has stalled; every member sees their own journey.
--
-- Who can do what (RLS):
--   * Pastoral team (is_pastoral_team(), already existing) -- edit the
--     steps, record/undo progress for anyone.
--   * Everyone in the church -- read the list of steps.
--   * A member -- reads only their own progress, through
--     get_my_discipleship() (members rows are pastoral-only).

begin;

create table if not exists public.discipleship_steps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  position smallint not null default 0,
  title_en text not null check (length(trim(title_en)) between 1 and 120),
  title_fr text check (title_fr is null or length(trim(title_fr)) <= 120),
  description text,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists discipleship_steps_tenant_idx on public.discipleship_steps (tenant_id, position);

create table if not exists public.discipleship_progress (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  step_id uuid not null references public.discipleship_steps(id) on delete cascade,
  completed_on date not null default current_date,
  note text,
  recorded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (member_id, step_id)
);
create index if not exists discipleship_progress_step_idx on public.discipleship_progress (step_id);
create index if not exists discipleship_progress_tenant_idx on public.discipleship_progress (tenant_id);

alter table public.discipleship_steps enable row level security;
alter table public.discipleship_progress enable row level security;

drop policy if exists "church reads discipleship steps" on public.discipleship_steps;
create policy "church reads discipleship steps" on public.discipleship_steps
  for select to authenticated using (tenant_id = public.current_tenant_id());
drop policy if exists "pastoral team manages discipleship steps" on public.discipleship_steps;
create policy "pastoral team manages discipleship steps" on public.discipleship_steps
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_pastoral_team())
  with check (tenant_id = public.current_tenant_id() and public.is_pastoral_team());

drop policy if exists "pastoral team manages discipleship progress" on public.discipleship_progress;
create policy "pastoral team manages discipleship progress" on public.discipleship_progress
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_pastoral_team())
  with check (tenant_id = public.current_tenant_id() and public.is_pastoral_team());

-- A member's own journey: every active step, with the date they completed
-- it (null = not yet). Matched through members.profile_id.
create or replace function public.get_my_discipleship()
returns table (step_id uuid, title_en text, title_fr text, description text, step_position smallint, completed_on date)
language sql stable security definer set search_path = public, pg_temp
as $$
  select s.id, s.title_en, s.title_fr, s.description, s.position,
         (select min(p.completed_on) from public.discipleship_progress p
            join public.members m on m.id = p.member_id
           where p.step_id = s.id and m.profile_id = auth.uid())
  from public.discipleship_steps s
  where s.tenant_id = public.current_tenant_id() and s.archived_at is null
  order by s.position, s.created_at;
$$;
revoke all on function public.get_my_discipleship() from public, anon;
grant execute on function public.get_my_discipleship() to authenticated;

-- Starter steps for every church that has none yet (editable afterwards).
insert into public.discipleship_steps (tenant_id, position, title_en, title_fr)
select t.id, v.pos, v.en, v.fr
from public.tenants t
cross join (values
  (1, 'First visit', 'Première visite'),
  (2, 'Gave their life to Christ', 'A donné sa vie à Christ'),
  (3, 'Membership class', 'Classe des nouveaux membres'),
  (4, 'Baptism', 'Baptême'),
  (5, 'Joined a small group', 'A rejoint un petit groupe'),
  (6, 'Serving in a department', 'Sert dans un département'),
  (7, 'Leadership training', 'Formation de leaders')
) as v(pos, en, fr)
where not exists (select 1 from public.discipleship_steps s where s.tenant_id = t.id);

commit;

select pg_notify('pgrst', 'reload schema');
