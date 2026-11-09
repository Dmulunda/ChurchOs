-- Public prayer request link (js/publicPrayerRequest.js, prayer.html) --
-- extends the EXISTING prayer_requests table/admin queue
-- (js/components/prayerRequests.js) rather than building a parallel
-- system, so the admin queue is automatically one merged list of
-- member-submitted + public-link-submitted requests.
--
-- True anonymity: user_id was already made nullable by
-- 67_anonymous_prayer_requests.sql for the in-app "submit anonymously"
-- checkbox. The public link reuses that same null user_id, and on top
-- of it never stores name/phone/email either when is_anonymous is true
-- -- enforced server-side in the RPC below, never trusting the client
-- flag alone.
begin;

alter table public.prayer_requests
  add column if not exists is_anonymous boolean not null default false,
  add column if not exists name text,
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists wants_contact boolean not null default false,
  add column if not exists is_private boolean not null default false,
  add column if not exists source text not null default 'member',
  add column if not exists assigned_to uuid references public.profiles(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

alter table public.prayer_requests
  add constraint prayer_requests_source_check check (source in ('member', 'public_link'));

create trigger force_updated_at before insert or update on public.prayer_requests
  for each row execute function public.force_server_timestamp_updated_at();

-- Private requests ("Keep my request private, pastors only") narrow to
-- is_pastoral_team() alone -- the Intercession-department-manager
-- branch only applies to non-private rows now.
drop policy if exists "prayer requests are readable by requester or handlers" on public.prayer_requests;
create policy "prayer requests are readable by requester or handlers" on public.prayer_requests
  for select to authenticated
  using (
    user_id = auth.uid()
    or is_pastoral_team()
    or (not is_private and can_manage_department((select id from public.departments where key = 'intercession')))
  );

drop policy if exists "prayer requests are updated by handlers" on public.prayer_requests;
create policy "prayer requests are updated by handlers" on public.prayer_requests
  for update to authenticated
  using (
    is_pastoral_team()
    or (not is_private and can_manage_department((select id from public.departments where key = 'intercession')))
  )
  with check (
    is_pastoral_team()
    or (not is_private and can_manage_department((select id from public.departments where key = 'intercession')))
  );

-- Public, unauthenticated submission -- mirrors submit_guest_checkin()'s
-- exact shape (sql/saas_platform/92_guest_self_checkin.sql): security
-- definer, dual-mode tenant resolution, granted to anon.
--
-- Rate limiting is deliberately coarse and stores no IP/fingerprint at
-- all (the spec explicitly forbids storing IP) -- a simple per-tenant
-- request-count-in-the-last-5-minutes ceiling, cheap and needs no new
-- storage, weak against a determined multi-tenant or slow-drip bot but
-- enough to stop a basic spam script hammering one church's link.
create or replace function public.submit_public_prayer_request(
  p_tenant_slug text,
  p_request_text text,
  p_is_anonymous boolean,
  p_name text default null,
  p_phone text default null,
  p_email text default null,
  p_wants_contact boolean default false,
  p_is_private boolean default false,
  p_honeypot text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_tenant_id uuid;
  v_request_id uuid;
  v_recent_count integer;
begin
  -- Honeypot: a real visitor never fills this hidden field. Pretend
  -- success without writing anything, so a bot never learns it was
  -- rejected.
  if coalesce(trim(p_honeypot), '') <> '' then
    return jsonb_build_object('ok', true);
  end if;

  if auth.uid() is not null then
    v_tenant_id := public.current_tenant_id();
  else
    select id into v_tenant_id from public.tenants where slug = p_tenant_slug;
    if v_tenant_id is null then
      raise exception 'Church not found';
    end if;
  end if;

  if coalesce(trim(p_request_text), '') = '' then
    raise exception 'A prayer request is required';
  end if;
  if length(p_request_text) > 2000 then
    raise exception 'Prayer request is too long';
  end if;

  select count(*) into v_recent_count
  from public.prayer_requests
  where tenant_id = v_tenant_id
    and source = 'public_link'
    and created_at > now() - interval '5 minutes';
  if v_recent_count >= 20 then
    raise exception 'Too many requests right now -- please try again shortly';
  end if;

  insert into public.prayer_requests (
    tenant_id, user_id, request_text, is_anonymous, name, phone, email,
    wants_contact, is_private, source
  )
  values (
    v_tenant_id,
    null, -- never a user_id on the public page, anonymous or not
    trim(p_request_text),
    p_is_anonymous,
    case when p_is_anonymous then null else nullif(trim(p_name), '') end,
    case when p_is_anonymous then null else nullif(trim(p_phone), '') end,
    case when p_is_anonymous then null else nullif(trim(p_email), '') end,
    (not p_is_anonymous) and p_wants_contact,
    p_is_private,
    'public_link'
  )
  returning id into v_request_id;

  return jsonb_build_object('id', v_request_id);
end;
$$;

revoke all on function public.submit_public_prayer_request(text, text, boolean, text, text, text, boolean, boolean, text) from public;
grant execute on function public.submit_public_prayer_request(text, text, boolean, text, text, text, boolean, boolean, text) to anon, authenticated;

commit;

select pg_notify('pgrst', 'reload schema');
