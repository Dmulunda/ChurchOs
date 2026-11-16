// Event registration emails. Two actions:
//   'send_confirmation' — { registration_id }. Cron-style shared-
//     secret auth (no JWT -- called from the register_for_event() DB
//     function via net.http_post, not a signed-in user), same
//     CRON_SECRET-equivalent vault secret already used for promo-code
//     and notification emails, not a new one of its own.
//   'send_update' — { event_id, subject, message }. JWT-authenticated
//     -- caller must be that event's organizing department's own
//     admin (or a Super Admin). Emails every confirmed/waitlisted
//     registrant individually (never a shared "to" list -- registrant
//     emails are never exposed to each other).
//
// QR ticket: generated here as a data-URL PNG (the `qrcode` package
// works the same in Deno as the CDN build already used client-side
// for member ID cards, js/components/memberIdCard.js) and embedded
// directly in the confirmation email -- no separate image hosting
// needed. Encodes the registration's own qr_token (plain text) --
// read by the check-in scanner (sql/saas_platform/168, eventsPage.js).
//
// Deploy: `supabase functions deploy event-emails --no-verify-jwt`
// (send_confirmation has no JWT at all; send_update checks the JWT
// itself, inside the function, same as stripe-billing's own actions).
// Needs: RESEND_API_KEY, CRON_SECRET (both already configured on this
// project). SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are automatic.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import QRCode from 'https://esm.sh/qrcode@1.5.3';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

async function sendResendEmail({ to, subject, html }) {
  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) return { ok: false, error: 'RESEND_API_KEY is not configured on this function' };
  const fromAddress = Deno.env.get('BOOKING_EMAIL_FROM') || 'onboarding@resend.dev';
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: fromAddress, to: [to], subject, html }),
  });
  if (!resp.ok) return { ok: false, error: await resp.text() };
  return { ok: true };
}

function formatEventWhen(startAt) {
  return new Date(startAt).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const body = await req.json();
    const { action } = body;

    const admin = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));

    if (action === 'send_confirmation') {
      const cronSecret = Deno.env.get('CRON_SECRET');
      if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) return json({ error: 'Unauthorized' }, 401);

      const { registration_id } = body;
      if (!registration_id) return json({ error: 'registration_id is required' }, 400);

      const { data: registration } = await admin
        .from('event_registrations')
        .select('id, tenant_id, event_id, full_name, email, status, payment_status, qr_token, event:events ( title, start_at, location, online_link, price_cents, tenants ( name, slug ) )')
        .eq('id', registration_id)
        .maybeSingle();
      if (!registration) return json({ skipped: 'registration not found' });

      const qrDataUrl = await QRCode.toDataURL(registration.qr_token, { width: 240, margin: 1 });
      const isWaitlisted = registration.status === 'waitlisted';
      const whereLine = registration.event.online_link
        ? `<p><strong>Online:</strong> <a href="${escapeAttr(registration.event.online_link)}">${escapeHtml(registration.event.online_link)}</a></p>`
        : registration.event.location ? `<p><strong>Location:</strong> ${escapeHtml(registration.event.location)}</p>` : '';
      // Online payment (sql/saas_platform/168, event-payment function) is
      // offered only when the church's Stripe account can take payments;
      // otherwise say plainly that the organizers will follow up.
      let priceLine = '';
      if (registration.event.price_cents) {
        const price = `$${(registration.event.price_cents / 100).toFixed(2)}`;
        const { data: giving } = await admin.from('giving_settings').select('stripe_charges_enabled, stripe_account_id').eq('tenant_id', registration.tenant_id).maybeSingle();
        const canPayOnline = !!(giving?.stripe_charges_enabled && giving?.stripe_account_id && Deno.env.get('STRIPE_SECRET_KEY'));
        const origin = (Deno.env.get('GIVING_RETURN_ORIGINS') || 'https://www.churchonpoint.com').split(',')[0].trim();
        if (canPayOnline && registration.payment_status === 'pending' && !isWaitlisted) {
          const payUrl = new URL('/event.html', origin);
          payUrl.searchParams.set('event', registration.event_id);
          if (registration.event.tenants?.slug) payUrl.searchParams.set('church', registration.event.tenants.slug);
          payUrl.searchParams.set('pay', registration.id);
          priceLine = `<p><strong>Price:</strong> ${price} — <a href="${escapeAttr(payUrl.toString())}">Pay online / Payer en ligne</a></p>`;
        } else {
          priceLine = `<p><strong>Price:</strong> ${price} — the organizing department will follow up about how to pay.</p>`;
        }
      }

      const result = await sendResendEmail({
        to: registration.email,
        subject: isWaitlisted ? `You're on the waitlist: ${registration.event.title}` : `You're registered: ${registration.event.title}`,
        html: `
          <p>Hi ${escapeHtml(registration.full_name)},</p>
          <p>${isWaitlisted
            ? `You're on the waitlist for <strong>${escapeHtml(registration.event.title)}</strong>. We'll email you if a place opens up.`
            : `You're registered for <strong>${escapeHtml(registration.event.title)}</strong>.`}</p>
          <p><strong>When:</strong> ${formatEventWhen(registration.event.start_at)}</p>
          ${whereLine}
          ${priceLine}
          ${!isWaitlisted ? `<p>Show this QR code at check-in:</p><img src="${qrDataUrl}" alt="Ticket QR code" width="240" height="240" />` : ''}
          <p style="color:#888;font-size:12px;">${registration.event.tenants?.name ? `${escapeHtml(registration.event.tenants.name)} — ` : ''}ChurchOnPoint</p>
        `,
      });
      if (!result.ok) return json({ error: `Resend error: ${result.error}` }, 502);

      await admin.from('event_registrations').update({ confirmation_emailed_at: new Date().toISOString() }).eq('id', registration_id);
      return json({ success: true });
    }

    if (action === 'send_update') {
      const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
      if (!jwt) return json({ error: 'Missing authorization' }, 401);
      const { data: { user: caller }, error: callerError } = await admin.auth.getUser(jwt);
      if (callerError || !caller) return json({ error: 'Invalid session' }, 401);

      const { event_id, subject, message } = body;
      if (!event_id || !subject || !message) return json({ error: 'event_id, subject and message are required' }, 400);

      const { data: event } = await admin.from('events').select('id, title, organizing_department_id').eq('id', event_id).maybeSingle();
      if (!event) return json({ error: 'Event not found' }, 404);

      const { data: callerProfile } = await admin.from('profiles').select('global_role').eq('id', caller.id).single();
      const { data: membership } = await admin
        .from('department_memberships')
        .select('role')
        .eq('user_id', caller.id)
        .eq('department_id', event.organizing_department_id)
        .eq('status', 'approved')
        .maybeSingle();
      const isAuthorized = callerProfile?.global_role === 'super_admin' || membership?.role === 'admin';
      if (!isAuthorized) return json({ error: 'Only this event\'s organizing department admin can message registrants' }, 403);

      const { data: registrants } = await admin
        .from('event_registrations')
        .select('full_name, email')
        .eq('event_id', event_id)
        .in('status', ['confirmed', 'waitlisted']);

      let sent = 0;
      for (const r of registrants || []) {
        const result = await sendResendEmail({
          to: r.email,
          subject,
          html: `<p>Hi ${escapeHtml(r.full_name)},</p><p>${escapeHtml(message).replace(/\n/g, '<br>')}</p><p style="color:#888;font-size:12px;">Re: ${escapeHtml(event.title)}</p>`,
        });
        if (result.ok) sent += 1;
      }
      return json({ success: true, sent, total: (registrants || []).length });
    }

    return json({ error: 'Unrecognized action' }, 400);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, 500);
  }
});

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(str) {
  return escapeHtml(str).replaceAll('"', '&quot;');
}
