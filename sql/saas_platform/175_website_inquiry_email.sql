-- 175 (applied): email AliviaTech for every website inquiry (demo,
-- general, support). The insert trigger calls the
-- website-inquiry-email edge function with the new row's id; the
-- function sends once per inquiry (notified_at) via Resend.
alter table public.website_inquiries add column if not exists notified_at timestamptz;

create or replace function public.notify_website_inquiry()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  perform net.http_post(
    url := 'https://towlqbxvhftzjfrtepsy.supabase.co/functions/v1/website-inquiry-email',
    body := jsonb_build_object('inquiry_id', new.id),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      -- public anon key (same one the website uses)
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRvd2xxYnh2aGZ0empmcnRlcHN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkwNzY2NjIsImV4cCI6MjEwNDY1MjY2Mn0.k3tlKMNNlpd-TGcd5hnyDfSzNcdmy8QLKiRYKkOEa-c'
    )
  );
  return new;
exception when others then
  -- Never block saving the inquiry because the email could not be queued.
  return new;
end;
$$;

drop trigger if exists website_inquiry_email on public.website_inquiries;
create trigger website_inquiry_email
  after insert on public.website_inquiries
  for each row execute function public.notify_website_inquiry();
