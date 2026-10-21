// Admin review for a self-serve signup that name-matched a Silent
// user but couldn't be corroborated by email/phone (see
// upgrade-silent-user/index.ts) -- approve links the claimed email to
// the existing Silent profile (same row, same id, history intact);
// reject creates an ordinary brand-new account instead and leaves the
// Silent record untouched for whoever else might claim it later.
// Either way nobody's password is ever handled mid-review -- the
// person gets a password-setup email once a decision is made.
//
// Deploy: `supabase functions deploy review-silent-user-claim`.
// Needs: RESEND_API_KEY, BOOKING_EMAIL_FROM (already configured on
// this project for send-notification-email/send-booking-email).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const PASSWORD_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
function generatePassword(length = 20) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i++) out += PASSWORD_CHARS[bytes[i] % PASSWORD_CHARS.length];
  return out;
}

async function sendSetPasswordEmail(toEmail, actionLink) {
  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) return { error: 'RESEND_API_KEY is not configured on this function' };
  const fromAddress = Deno.env.get('BOOKING_EMAIL_FROM') || 'onboarding@resend.dev';
  const resendResp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: fromAddress,
      to: [toEmail],
      subject: 'Set your password',
      html: `
        <p>Your account is ready.</p>
        <p><a href="${escapeHtml(actionLink)}">Click here to set your password and sign in</a>.</p>
      `,
    }),
  });
  if (!resendResp.ok) return { error: `Resend error: ${await resendResp.text()}` };
  return {};
}

async function callerCanManageUsers(admin, callerId) {
  const { data: profile } = await admin.from('profiles').select('global_role, tenant_id').eq('id', callerId).single();
  if (!profile) return { ok: false };
  if (['super_admin', 'pastor_admin', 'church_secretary'].includes(profile.global_role)) {
    return { ok: true, tenantId: profile.tenant_id };
  }
  const { data: churchAdminRow } = await admin.from('church_admins').select('user_id').eq('user_id', callerId).eq('tenant_id', profile.tenant_id).maybeSingle();
  if (churchAdminRow) return { ok: true, tenantId: profile.tenant_id };
  const { data: deptRow } = await admin
    .from('department_memberships')
    .select('user_id')
    .eq('user_id', callerId)
    .eq('status', 'approved')
    .in('role', ['admin', 'secretary'])
    .limit(1)
    .maybeSingle();
  return { ok: !!deptRow, tenantId: profile.tenant_id };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    if (!jwt) return json({ error: 'Missing authorization' }, 401);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    );

    const { data: { user: caller }, error: callerError } = await admin.auth.getUser(jwt);
    if (callerError || !caller) return json({ error: 'Invalid session' }, 401);

    const { claim_id, decision } = await req.json();
    if (!claim_id || !['approve', 'reject'].includes(decision)) {
      return json({ error: 'claim_id and a decision of approve/reject are required' }, 400);
    }

    const { data: claim, error: claimError } = await admin
      .from('silent_user_claims')
      .select('id, silent_profile_id, claimed_full_name, claimed_email, claimed_phone, status, tenant_id')
      .eq('id', claim_id)
      .single();
    if (claimError || !claim) return json({ error: 'Claim not found' }, 404);
    if (claim.status !== 'pending') return json({ error: 'This claim was already reviewed' }, 400);

    const { ok, tenantId } = await callerCanManageUsers(admin, caller.id);
    if (!ok || tenantId !== claim.tenant_id) return json({ error: 'You are not allowed to do this' }, 403);

    let targetEmail = claim.claimed_email;

    if (decision === 'approve') {
      const { error: updateAuthError } = await admin.auth.admin.updateUserById(claim.silent_profile_id, {
        email: claim.claimed_email,
        email_confirm: true,
      });
      if (updateAuthError) return json({ error: updateAuthError.message }, 400);
      const { error: updateProfileError } = await admin
        .from('profiles')
        .update({ is_silent: false, phone: claim.claimed_phone || null })
        .eq('id', claim.silent_profile_id);
      if (updateProfileError) return json({ error: updateProfileError.message }, 400);
    } else {
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email: claim.claimed_email,
        password: generatePassword(),
        email_confirm: true,
        user_metadata: { full_name: claim.claimed_full_name, tenant_id: claim.tenant_id },
      });
      if (createError) return json({ error: createError.message }, 400);
      if (claim.claimed_phone) {
        await admin.from('profiles').update({ phone: claim.claimed_phone }).eq('id', created.user.id);
      }
      targetEmail = claim.claimed_email;
    }

    const { error: claimUpdateError } = await admin
      .from('silent_user_claims')
      .update({ status: decision === 'approve' ? 'approved' : 'rejected', reviewed_by: caller.id, reviewed_at: new Date().toISOString() })
      .eq('id', claim_id);
    if (claimUpdateError) return json({ error: claimUpdateError.message }, 400);

    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email: targetEmail,
    });
    if (linkError) return json({ status: decision, email_warning: linkError.message });

    const emailResult = await sendSetPasswordEmail(targetEmail, linkData.properties?.action_link);
    if (emailResult.error) return json({ status: decision, email_warning: emailResult.error });

    return json({ status: decision });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, 500);
  }
});
