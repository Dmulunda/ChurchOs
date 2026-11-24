// website-inquiry-email: emails AliviaTech when someone sends the
// contact form on churchonpoint.com (any subject: demo, general,
// support). Called by the website_inquiries insert trigger
// (sql/saas_platform/175) with just { inquiry_id }.
//
// Safe to expose: it reads the inquiry itself with the service role,
// and sends at most once per inquiry (notified_at), so calling it again
// with the same id does nothing.
//
// Recipients: INQUIRY_NOTIFY_TO (comma-separated) if set, otherwise
// info@aliviatech.ca (while Resend has no verified domain, it falls
// back to the Resend account owner's address). Sender: BOOKING_EMAIL_FROM (the same verified
// sender the other emails use). Reply-To is the visitor, so answering
// the email answers them.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const TOPICS: Record<string, string> = {
  demo: 'Demo request / Demande de démo',
  general: 'General inquiry / Question générale',
  support: 'Support',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

function esc(s: unknown) {
  return String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const { inquiry_id } = await req.json().catch(() => ({}));
  if (typeof inquiry_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(inquiry_id)) return json({ error: 'inquiry_id required' }, 400);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: inq } = await admin.from('website_inquiries')
    .select('id, topic, name, email, phone, church_name, message, created_at, notified_at')
    .eq('id', inquiry_id).maybeSingle();
  if (!inq) return json({ error: 'not found' }, 404);
  if (inq.notified_at) return json({ ok: true, already: true });

  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) return json({ error: 'RESEND_API_KEY is not configured' }, 500);
  const from = Deno.env.get('BOOKING_EMAIL_FROM') || 'onboarding@resend.dev';
  const to = (Deno.env.get('INQUIRY_NOTIFY_TO') || 'info@aliviatech.ca').split(',').map((s) => s.trim()).filter(Boolean);

  const topic = TOPICS[inq.topic] || inq.topic;
  const when = new Date(inq.created_at).toLocaleString('fr-CA', { timeZone: 'America/Toronto', dateStyle: 'long', timeStyle: 'short' });
  const row = (label: string, value: unknown) => value ? `<tr><td style="padding:6px 12px 6px 0;color:#5B6475;white-space:nowrap;vertical-align:top">${label}</td><td style="padding:6px 0;color:#1B2433">${esc(value)}</td></tr>` : '';
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto">
      <div style="background:#0B1F3A;color:#fff;padding:18px 22px;border-radius:14px 14px 0 0">
        <div style="font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#E0B654;font-weight:700">ChurchOnPoint — ${esc(topic)}</div>
        <div style="font-size:20px;font-weight:700;margin-top:4px">${esc(inq.name)}${inq.church_name ? ` · ${esc(inq.church_name)}` : ''}</div>
      </div>
      <div style="border:1px solid #E6E1D6;border-top:0;border-radius:0 0 14px 14px;padding:18px 22px;background:#fff">
        <table style="border-collapse:collapse;font-size:14px">
          ${row('Sujet / Subject', topic)}
          ${row('Nom / Name', inq.name)}
          ${row('Courriel / Email', inq.email)}
          ${row('Téléphone / Phone', inq.phone)}
          ${row('Église / Church', inq.church_name)}
          ${row('Reçu / Received', when)}
        </table>
        ${inq.message ? `<div style="margin-top:14px;padding:14px;background:#F6F4EF;border-radius:10px;font-size:14px;color:#1B2433;white-space:pre-wrap">${esc(inq.message)}</div>` : ''}
        <p style="margin-top:16px;font-size:13px;color:#5B6475">Répondez à ce courriel pour écrire directement à ${esc(inq.name)}. Aussi dans Site Admin → Website Inquiries.<br>Reply to this email to answer ${esc(inq.name)} directly. Also in Site Admin → Website Inquiries.</p>
      </div>
    </div>`;

  const send = (recipients: string[]) => fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: recipients,
      reply_to: inq.email,
      subject: `ChurchOnPoint — ${topic} — ${inq.name}${inq.church_name ? ` (${inq.church_name})` : ''}`,
      html,
    }),
  });
  let resp = await send(to);
  if (!resp.ok) {
    let text = await resp.text();
    // Until a sending domain is verified at resend.com/domains, Resend
    // only delivers to the account owner's own address and names it in
    // the error. Send there instead, so the notification still arrives.
    const owner = text.match(/own email address \(([^)\s]+@[^)\s]+)\)/);
    if (resp.status === 403 && owner) {
      resp = await send([owner[1]]);
      if (!resp.ok) text = await resp.text();
    }
    if (!resp.ok) {
      console.error('Resend failed', resp.status, text);
      return json({ error: `Email send failed: ${text}` }, 502);
    }
  }
  await admin.from('website_inquiries').update({ notified_at: new Date().toISOString() }).eq('id', inq.id);
  return json({ ok: true });
});
