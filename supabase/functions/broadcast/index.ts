// Communication hub sender (sql/saas_platform/146_communication_hub.sql).
//
// Actions (JWT required):
//   'capabilities' -> which channels are set up on the server
//                     ({ in_app, push, email, sms, whatsapp }), so the
//                     composer can grey out the ones that aren't.
//   'send'         -> { audience: 'church' | 'departments', department_ids?,
//                       title, body, channels: [...] }
//
// Permission is re-checked here, never trusted from the client:
//   church-wide  -> super_admin / pastor_admin / church_secretary, or
//                   profiles.can_post_global_announcements
//   departments  -> the caller is an approved admin or secretary of EVERY
//                   chosen department (or has church-wide reach).
// Recipients are re-derived server-side, always scoped to the caller's
// own church (this client uses the service role, which bypasses RLS).
//
// Deploy: `supabase functions deploy broadcast`.
// Secrets (existing): RESEND_API_KEY, BOOKING_EMAIL_FROM, VAPID_PUBLIC_KEY,
// VAPID_PRIVATE_KEY. Optional, COST MONEY per message -- leave unset until
// you decide: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_SMS_FROM
// (an SMS-capable Twilio number, E.164) and/or TWILIO_WHATSAPP_FROM
// (a WhatsApp-enabled Twilio sender, E.164). DEFAULT_PHONE_COUNTRY_CODE
// (default '1', for 10-digit North American numbers).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const GLOBAL_REACH_ROLES = ['super_admin', 'pastor_admin', 'church_secretary'];
const ALL_CHANNELS = ['in_app', 'push', 'email', 'sms', 'whatsapp'];
const MAX_RECIPIENTS = 2000;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

function escapeHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function capabilities() {
  const twilioBase = !!(Deno.env.get('TWILIO_ACCOUNT_SID') && Deno.env.get('TWILIO_AUTH_TOKEN'));
  return {
    in_app: true,
    push: !!(Deno.env.get('VAPID_PUBLIC_KEY') && Deno.env.get('VAPID_PRIVATE_KEY')),
    email: !!Deno.env.get('RESEND_API_KEY'),
    sms: twilioBase && !!Deno.env.get('TWILIO_SMS_FROM'),
    whatsapp: twilioBase && !!Deno.env.get('TWILIO_WHATSAPP_FROM'),
  };
}

// Free-text phone -> E.164, or null when it can't be read safely.
// "613-700-5827" -> +16137005827 ; "+243 81 234 5678" -> +243812345678 ;
// "00243..." -> +243...
function toE164(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  let digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.startsWith('00')) { digits = digits.slice(2); return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null; }
  const cc = Deno.env.get('DEFAULT_PHONE_COUNTRY_CODE') || '1';
  if (cc === '1' && digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length === 10) return `+${cc}${digits}`;
  return null;
}

async function sendPush(admin, userIds, title, body) {
  const { data: subs } = await admin.from('push_subscriptions').select('id, endpoint, p256dh, auth').in('user_id', userIds);
  webpush.setVapidDetails('mailto:admin@eglisevpd.com', Deno.env.get('VAPID_PUBLIC_KEY'), Deno.env.get('VAPID_PRIVATE_KEY'));
  const payload = JSON.stringify({ title, body, url: './' });
  let sent = 0; let failed = 0; const stale = [];
  for (const sub of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
      sent++;
    } catch (err) {
      failed++;
      if (err?.statusCode === 404 || err?.statusCode === 410) stale.push(sub.id);
    }
  }
  if (stale.length) await admin.from('push_subscriptions').delete().in('id', stale);
  return { sent, failed };
}

async function sendEmails(admin, userIds, title, body, churchName) {
  const fromAddress = Deno.env.get('BOOKING_EMAIL_FROM') || 'onboarding@resend.dev';
  const emails = [];
  for (const id of userIds) {
    const { data } = await admin.auth.admin.getUserById(id);
    const email = data?.user?.email;
    if (email && !email.endsWith('@noemail.internal')) emails.push(email);
  }
  const html = `<p><strong>${escapeHtml(title)}</strong></p><p style="white-space:pre-line">${escapeHtml(body)}</p>`
    + `<p style="color:#888;font-size:12px;">${escapeHtml(churchName || '')}</p>`;
  let sent = 0; let failed = 0;
  // Resend batch endpoint: up to 100 messages per call, one per recipient
  // (nobody sees anyone else's address).
  for (let i = 0; i < emails.length; i += 100) {
    const chunk = emails.slice(i, i + 100);
    const resp = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(chunk.map((to) => ({ from: fromAddress, to: [to], subject: title, html }))),
    });
    if (resp.ok) sent += chunk.length; else failed += chunk.length;
  }
  return { sent, failed, no_email: userIds.length - emails.length };
}

async function sendTwilio(phones, text, channel) {
  const sid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const token = Deno.env.get('TWILIO_AUTH_TOKEN');
  const from = channel === 'whatsapp' ? `whatsapp:${Deno.env.get('TWILIO_WHATSAPP_FROM')}` : Deno.env.get('TWILIO_SMS_FROM');
  let sent = 0; let failed = 0;
  for (const phone of phones) {
    const to = channel === 'whatsapp' ? `whatsapp:${phone}` : phone;
    const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${btoa(`${sid}:${token}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ From: from, To: to, Body: text }).toString(),
    });
    if (resp.ok) sent++; else failed++;
  }
  return { sent, failed };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    if (!jwt) return json({ error: 'Missing authorization' }, 401);
    const admin = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
    const { data: { user: caller } } = await admin.auth.getUser(jwt);
    if (!caller) return json({ error: 'Invalid session' }, 401);
    const { data: me } = await admin.from('profiles')
      .select('id, tenant_id, global_role, can_post_global_announcements, removed_at, tenants ( name )')
      .eq('id', caller.id).single();
    if (!me || me.removed_at) return json({ error: 'Profile not found' }, 404);
    const tenantId = me.tenant_id;
    const hasChurchReach = GLOBAL_REACH_ROLES.includes(me.global_role) || !!me.can_post_global_announcements;

    const req2 = await req.json();
    const caps = capabilities();
    if (req2.action === 'capabilities') {
      const { data: leads } = await admin.from('department_memberships')
        .select('department_id').eq('user_id', caller.id).eq('status', 'approved').in('role', ['admin', 'secretary']).eq('tenant_id', tenantId);
      return json({ channels: caps, church_wide: hasChurchReach, department_ids: (leads ?? []).map((l) => l.department_id) });
    }
    if (req2.action !== 'send') return json({ error: 'Unknown action' }, 400);

    const title = String(req2.title || '').trim().slice(0, 150);
    const body = String(req2.body || '').trim().slice(0, 2000);
    const channels = [...new Set((req2.channels || []).filter((c) => ALL_CHANNELS.includes(c)))];
    if (!title || !body) return json({ error: 'title_and_body_required' }, 400);
    if (channels.length === 0) return json({ error: 'pick_a_channel' }, 400);
    const unavailable = channels.filter((c) => !caps[c]);
    if (unavailable.length) return json({ error: 'channel_not_set_up', channels: unavailable }, 400);

    let recipientIds = [];
    let departmentIds = [];
    if (req2.audience === 'church') {
      if (!hasChurchReach) return json({ error: 'not_allowed_church_wide' }, 403);
      const { data } = await admin.from('profiles').select('id').eq('tenant_id', tenantId).is('removed_at', null);
      recipientIds = (data ?? []).map((p) => p.id);
    } else if (req2.audience === 'departments') {
      departmentIds = [...new Set(req2.department_ids || [])];
      if (departmentIds.length === 0) return json({ error: 'pick_a_department' }, 400);
      const { data: depts } = await admin.from('departments').select('id').in('id', departmentIds).eq('tenant_id', tenantId);
      if ((depts ?? []).length !== departmentIds.length) return json({ error: 'not_allowed_department' }, 403);
      if (!hasChurchReach) {
        const { data: leads } = await admin.from('department_memberships').select('department_id')
          .eq('user_id', caller.id).eq('status', 'approved').in('role', ['admin', 'secretary']).in('department_id', departmentIds);
        const allowed = new Set((leads ?? []).map((l) => l.department_id));
        if (departmentIds.some((id) => !allowed.has(id))) return json({ error: 'not_allowed_department' }, 403);
      }
      const { data: members } = await admin.from('department_memberships').select('user_id')
        .in('department_id', departmentIds).eq('status', 'approved').eq('tenant_id', tenantId);
      recipientIds = [...new Set((members ?? []).map((m) => m.user_id))];
      if (recipientIds.length) {
        const { data: active } = await admin.from('profiles').select('id').in('id', recipientIds).is('removed_at', null);
        recipientIds = (active ?? []).map((p) => p.id);
      }
    } else {
      return json({ error: 'invalid_audience' }, 400);
    }
    if (recipientIds.length > MAX_RECIPIENTS) return json({ error: 'too_many_recipients' }, 400);

    const results = {};
    if (channels.includes('in_app')) {
      const rows = recipientIds.map((id) => ({ recipient_id: id, type: 'broadcast', title, body, source_user_id: caller.id, tenant_id: tenantId }));
      let sent = 0;
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await admin.from('notifications').insert(rows.slice(i, i + 500));
        if (!error) sent += Math.min(500, rows.length - i);
      }
      results.in_app = { sent, failed: rows.length - sent };
    }
    if (channels.includes('push')) results.push = await sendPush(admin, recipientIds, title, body);
    if (channels.includes('email')) results.email = await sendEmails(admin, recipientIds, title, body, me.tenants?.name);
    if (channels.includes('sms') || channels.includes('whatsapp')) {
      const { data: phonesData } = await admin.from('profiles').select('phone').in('id', recipientIds);
      const phones = [...new Set((phonesData ?? []).map((p) => toE164(p.phone)).filter(Boolean))];
      const text = `${title}\n${body}`.slice(0, 1500);
      if (channels.includes('sms')) results.sms = { ...(await sendTwilio(phones, text, 'sms')), no_phone: recipientIds.length - phones.length };
      if (channels.includes('whatsapp')) results.whatsapp = { ...(await sendTwilio(phones, text, 'whatsapp')), no_phone: recipientIds.length - phones.length };
    }

    await admin.from('broadcasts').insert({
      tenant_id: tenantId, created_by: caller.id, audience: req2.audience, department_ids: departmentIds,
      title, body, channels, recipient_count: recipientIds.length, results,
    });
    return json({ recipients: recipientIds.length, results });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, 500);
  }
});
