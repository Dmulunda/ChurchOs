// Emails an OUTSIDE (guest) booker their pastor-meeting confirmation
// and access details right after submit_pastor_meeting_booking()
// succeeds. Members already see their booking in-app (js/
// pastorMeetingsPage.js's "My Requests" tab) so they're skipped here
// entirely -- this is guest-only, matching the original "no email
// infrastructure" gap noted for the outsider flow.
//
// Callable anonymously (guests have no session, same as the booking
// RPC itself) with just { booking_id } -- everything actually sent
// (recipient, date/time, pastor name, access link) is re-derived
// server-side from that row via the service-role client, never
// trusted from the client, so this can't be used to send arbitrary
// text to an arbitrary address. confirmation_email_sent_at makes the
// call idempotent -- replaying the same booking_id is a no-op after
// the first successful send, so this can't be used to spam the same
// guest repeatedly either. tenant_id/church name/timezone are all
// re-derived from the booking row itself, so one function serves every
// tenant on this platform with one shared RESEND_API_KEY/sender.
//
// The visible "From" address is one shared platform sender (Resend
// requires DNS-level domain verification per sending address, not
// realistic to ask of every tenant) -- but Reply-To is set to that
// tenant's OWN contact email (tenants.email, set via
// tenantLogoModal.js's "Change Info" panel) when one is configured, so
// a guest's reply goes straight to the actual church, not the
// platform. The footer line also mentions that tenant's phone/email
// when set.
//
// Deploy: `supabase functions deploy send-booking-email`. Needs
// RESEND_API_KEY (from resend.com) set manually -- Dashboard -> Edge
// Functions -> send-booking-email -> Secrets. BOOKING_EMAIL_FROM is
// optional -- falls back to Resend's test sender (onboarding@resend.dev)
// if unset, which works immediately but should be swapped for a
// verified domain before relying on this for real guests.
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are provided automatically.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function formatDate(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function formatTime(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const bookingId = body?.booking_id;
  if (!bookingId) return json({ error: 'booking_id is required' }, 400);

  const admin = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));

  const { data: booking, error: fetchError } = await admin
    .from('pastor_meeting_requests')
    .select('id, tenant_id, guest_email, contact_name, meeting_type, meeting_date, meeting_start_time, meeting_end_time, meeting_room, meeting_link, status, confirmation_email_sent_at, pastor:profiles!pastor_id(full_name)')
    .eq('id', bookingId)
    .maybeSingle();

  if (fetchError) return json({ error: fetchError.message }, 500);
  if (!booking) return json({ error: 'Booking not found' }, 404);
  if (!booking.guest_email) return json({ skipped: 'not a guest booking' });
  if (booking.confirmation_email_sent_at) return json({ skipped: 'already sent' });
  if (booking.status !== 'confirmed') return json({ skipped: 'booking is not confirmed' });

  const [{ data: settings }, { data: tenant }] = await Promise.all([
    admin.from('pastor_meeting_settings').select('church_timezone, booking_note_en').eq('tenant_id', booking.tenant_id).maybeSingle(),
    admin.from('tenants').select('name, address, email, phone').eq('id', booking.tenant_id).maybeSingle(),
  ]);
  const churchTimezone = settings?.church_timezone || 'America/Toronto';
  const bookingNote = settings?.booking_note_en || null;
  const churchName = tenant?.name || 'the church';
  const churchEmail = tenant?.email || null;
  const churchPhone = tenant?.phone || null;
  const officeAddress = tenant?.address || null;

  const isOnline = booking.meeting_type === 'online';
  let accessLine;
  if (isOnline) {
    const link = booking.meeting_link || (booking.meeting_room ? `https://meet.jit.si/${encodeURIComponent(booking.meeting_room)}` : null);
    accessLine = link
      ? `This is an online meeting. Join using this link at your scheduled time: <a href="${escapeHtml(link)}">${escapeHtml(link)}</a>`
      : 'This is an online meeting. Access details will be sent separately.';
  } else {
    accessLine = 'This meeting will be in person at our office.';
  }

  const dateLine = `${formatDate(booking.meeting_date)} at ${formatTime(booking.meeting_start_time)}–${formatTime(booking.meeting_end_time)} (${churchTimezone})`;
  const pastorName = booking.pastor?.full_name || 'your pastor';
  const contactBits = [churchPhone, churchEmail].filter(Boolean).map(escapeHtml).join(' or ');
  const contactLine = contactBits
    ? `If you need to cancel or have questions, please contact us at ${contactBits}.`
    : 'If you need to cancel or have questions, please contact the church office.';

  const html = `
    <h2>${escapeHtml(churchName)}</h2>
    <p>Hi ${escapeHtml(booking.contact_name || '')},</p>
    <p>Your meeting with ${escapeHtml(pastorName)} is confirmed.</p>
    <p><strong>${escapeHtml(dateLine)}</strong></p>
    <p>${accessLine}</p>
    ${!isOnline && officeAddress ? `<p>Address: ${escapeHtml(officeAddress)}</p>` : ''}
    <p>${contactLine}</p>
    ${bookingNote ? `<p>${escapeHtml(bookingNote)}</p>` : ''}
  `;

  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) {
    return json({ error: 'RESEND_API_KEY is not configured on this function' }, 500);
  }
  const fromAddress = Deno.env.get('BOOKING_EMAIL_FROM') || 'onboarding@resend.dev';

  const resendResp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: fromAddress,
      to: [booking.guest_email],
      ...(churchEmail ? { reply_to: churchEmail } : {}),
      subject: `${churchName}: Your meeting with ${pastorName} is confirmed`,
      html,
    }),
  });

  if (!resendResp.ok) {
    const errText = await resendResp.text();
    return json({ success: false, error: errText }, 502);
  }

  await admin.from('pastor_meeting_requests').update({ confirmation_email_sent_at: new Date().toISOString() }).eq('id', bookingId);

  return json({ success: true });
});
