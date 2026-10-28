-- Two gaps found using the Silent Directory shipped in 112/113:
--
-- 1. No way to tell how long someone's actually been part of the
--    church -- profiles.created_at is when the *profile row* was
--    created (e.g. whenever they were bulk-imported or added as
--    Silent), not their real join date. Adds profiles.joined_at,
--    backfilled from created_at for existing rows, defaulting to
--    today for new ones -- editable afterward (userEditModal.js) to
--    correct it for older/imported members.
--
-- 2. A Silent profile with no linked guest_follow_ups row (created
--    via "Add User -> No login yet" or bulk import -- most Silent
--    users, in practice) had nowhere to attach a note and no way to
--    edit its own fields (address, phone, etc.) from the Silent
--    Directory at all. Adds a general-purpose profile_notes table
--    (any profile, not tied to a guest case) and the Silent
--    Directory now reuses userEditModal.js (the exact same "Edit"
--    modal the User Directory already has) instead of only offering
--    a User Status dropdown.

begin;

alter table public.profiles add column if not exists joined_at date;
update public.profiles set joined_at = created_at::date where joined_at is null;
alter table public.profiles alter column joined_at set default current_date;
alter table public.profiles alter column joined_at set not null;

create table public.profile_notes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  author_id uuid references public.profiles(id),
  note text not null,
  created_at timestamptz not null default now(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id)
);

create index profile_notes_profile_id_idx on public.profile_notes (profile_id);
create index profile_notes_tenant_id_idx on public.profile_notes (tenant_id);

alter table public.profile_notes enable row level security;

-- Same reach as who can already edit this profile's other fields
-- (userEditModal.js's own update -- "department admins can update
-- their members' profiles" on public.profiles) plus the pastoral
-- team, since a Silent person often has no department membership at
-- all yet for that rule to key off of.
create policy "profile notes are readable by admins" on public.profile_notes
  for select to authenticated using (
    public.is_super_admin()
    or public.is_pastoral_team()
    or exists (
      select 1 from public.department_memberships dm
      where dm.user_id = profile_notes.profile_id and public.can_write_department(dm.department_id)
    )
  );

create policy "tenant_isolation" on public.profile_notes as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

-- No direct insert policy -- inserted only via this security-definer
-- RPC so the permission check and author_id can't be spoofed.
create or replace function public.add_profile_note(p_profile_id uuid, p_note text)
 returns public.profile_notes
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_row public.profile_notes;
begin
  if (select tenant_id from public.profiles where id = p_profile_id) is distinct from public.current_tenant_id() then
    raise exception 'User not found';
  end if;
  if coalesce(trim(p_note), '') = '' then
    raise exception 'Note cannot be empty';
  end if;

  if not (
    public.is_super_admin()
    or public.is_pastoral_team()
    or exists (
      select 1 from public.department_memberships dm
      where dm.user_id = p_profile_id and public.can_write_department(dm.department_id)
    )
  ) then
    raise exception 'You are not allowed to do this';
  end if;

  insert into public.profile_notes (profile_id, author_id, note)
  values (p_profile_id, auth.uid(), trim(p_note))
  returning * into v_row;

  return v_row;
end;
$function$;

grant execute on function public.add_profile_note(uuid, text) to authenticated;

select pg_notify('pgrst', 'reload schema');

commit;
