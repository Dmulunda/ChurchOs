// Private iCal feed of a church's calendar (sql/saas_platform/150_church_calendar.sql).
// GET .../functions/v1/calendar-feed?token=<calendar_feed_tokens.token>
// Subscribe to that URL in Google Calendar ("From URL"), Outlook ("Subscribe
// from web") or Apple Calendar. Only church-visible items, 30 days back to
// 180 days ahead. Anyone with the link can read it, so the pastoral team can
// replace the token from the Calendar page to revoke old links.
//
// Deploy: `supabase functions deploy calendar-feed --no-verify-jwt`.
// No secrets beyond SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY (automatic).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

function esc(text) {
  return String(text ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}
function stamp(d) {
  return new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
function dateOnly(d) {
  return new Date(d).toISOString().slice(0, 10).replace(/-/g, '');
}
// RFC 5545: lines over 75 octets are folded with CRLF + space.
function fold(line) {
  const out = [];
  let rest = line;
  while (rest.length > 74) { out.push(rest.slice(0, 74)); rest = ` ${rest.slice(74)}`; }
  out.push(rest);
  return out.join('\r\n');
}

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get('token') || '';
  if (!/^[0-9a-f-]{36}$/i.test(token)) return new Response('Not found', { status: 404 });

  const admin = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
  const { data: feed } = await admin.from('calendar_feed_tokens').select('tenant_id, tenants ( name )').eq('token', token).maybeSingle();
  if (!feed) return new Response('Not found', { status: 404 });

  const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const to = new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10);
  const { data: items, error } = await admin.rpc('get_church_calendar', { p_from: from, p_to: to, p_tenant: feed.tenant_id });
  if (error) return new Response('Calendar unavailable', { status: 500 });

  const now = stamp(new Date());
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ChurchOnPoint//Church Calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(feed.tenants?.name || 'Church')}`,
  ];
  for (const it of items ?? []) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${it.kind}-${it.ref_id}-${dateOnly(it.starts_at)}@churchonpoint.com`);
    lines.push(`DTSTAMP:${now}`);
    if (it.all_day) {
      lines.push(`DTSTART;VALUE=DATE:${dateOnly(it.starts_at)}`);
      lines.push(`DTEND;VALUE=DATE:${dateOnly(new Date(new Date(it.starts_at).getTime() + 86400000))}`);
    } else {
      lines.push(`DTSTART:${stamp(it.starts_at)}`);
      lines.push(`DTEND:${stamp(it.ends_at)}`);
    }
    lines.push(fold(`SUMMARY:${esc(it.title)}`));
    if (it.location) lines.push(fold(`LOCATION:${esc(it.location)}`));
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return new Response(lines.join('\r\n') + '\r\n', {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'public, max-age=900' },
  });
});
