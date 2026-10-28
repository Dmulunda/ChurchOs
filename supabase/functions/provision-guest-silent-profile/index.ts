// Auto-links a brand-new guest_follow_ups row to a real Silent
// profile the moment it's created, instead of leaving it profile-less
// until someone manually clicks "Create Account" (today's behavior,
// which also never links back). Called from a Postgres trigger
// (notify_guest_attendance(), sql/saas_platform/112) via net.http_post
// -- no Supabase session JWT, so auth is the same shared CRON_SECRET
// already used by send-notification-email/offering-reports/stripe-
// billing's own trigger/cron-initiated calls, not a new secret.
//
// Dedup is deliberately conservative: unlike the self-serve signup
// flow (authScreen.js), there's no human "yes that's me" confirmation
// step here, so this only reuses an existing Silent profile on an
// EXACT phone or email match -- never on name similarity alone, which
// could silently merge two different people's history with no one
// reviewing it.
//
// Deploy: `supabase functions deploy provision-guest-silent-profile --no-verify-jwt`
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-cron-secret',
};

const PASSWORD_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

function generatePassword(length = 20) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i++) out += PASSWORD_CHARS[bytes[i] % PASSWORD_CHARS.length];
  return out;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const cronSecret = Deno.env.get('CRON_SECRET');
  if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
    return json({ error: 'Unauthorized' }, 401);
  }

  try {
    const { guest_follow_up_id } = await req.json();
    if (!guest_follow_up_id) return json({ error: 'guest_follow_up_id is required' }, 400);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    );

    const { data: lead, error: leadError } = await admin
      .from('guest_follow_ups')
      .select('id, user_id, full_name, phone, email, tenant_id')
      .eq('id', guest_follow_up_id)
      .single();
    if (leadError || !lead) return json({ error: 'Guest lead not found' }, 404);
    if (lead.user_id) return json({ status: 'already_linked', profile_id: lead.user_id });

    // Exact-match dedup against existing Silent profiles in this
    // tenant only -- repeat visits from the same unregistered guest
    // (e.g. checking in again next week) should reuse one profile,
    // not spawn a new one every time.
    let matchedProfileId = null;
    if (lead.phone && lead.phone.trim()) {
      const { data: phoneMatch } = await admin
        .from('profiles')
        .select('id')
        .eq('tenant_id', lead.tenant_id)
        .eq('is_silent', true)
        .eq('phone', lead.phone.trim())
        .limit(1)
        .maybeSingle();
      if (phoneMatch) matchedProfileId = phoneMatch.id;
    }
    if (!matchedProfileId && lead.email && lead.email.trim()) {
      const { data: emailRow } = await admin
        .from('profile_emails')
        .select('id')
        .eq('tenant_id', lead.tenant_id)
        .ilike('email', lead.email.trim())
        .limit(1)
        .maybeSingle();
      if (emailRow) {
        const { data: profileRow } = await admin.from('profiles').select('id').eq('id', emailRow.id).eq('is_silent', true).maybeSingle();
        if (profileRow) matchedProfileId = profileRow.id;
      }
    }

    if (matchedProfileId) {
      // guest_follow_ups.user_id is unique -- a profile can only ever
      // be the "owner" of one lead row. A repeat visit that matches an
      // existing Silent profile already linked to an earlier lead
      // leaves this new lead unlinked rather than erroring; the person
      // is still tracked under their original case.
      const { data: alreadyOwns } = await admin.from('guest_follow_ups').select('id').eq('user_id', matchedProfileId).maybeSingle();
      if (alreadyOwns) return json({ status: 'already_tracked_elsewhere', profile_id: matchedProfileId });

      const { error: linkError } = await admin.from('guest_follow_ups').update({ user_id: matchedProfileId }).eq('id', guest_follow_up_id);
      if (linkError) return json({ error: linkError.message }, 400);
      return json({ status: 'linked_existing', profile_id: matchedProfileId });
    }

    // No match -- create a new Silent profile, same shape as
    // create-silent-user/index.ts (inlined here rather than an extra
    // HTTP hop, since this function is already service-role).
    const placeholderEmail = `silent-${crypto.randomUUID()}@noemail.internal`;
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: (lead.email && lead.email.trim()) || placeholderEmail,
      password: generatePassword(),
      email_confirm: true,
      user_metadata: { full_name: lead.full_name, tenant_id: lead.tenant_id },
    });
    if (createError || !created?.user) return json({ error: createError?.message || 'Could not create profile' }, 400);

    const newProfileId = created.user.id;
    const { error: updateError } = await admin
      .from('profiles')
      .update({ is_silent: true, phone: (lead.phone && lead.phone.trim()) || null })
      .eq('id', newProfileId);
    if (updateError) return json({ error: updateError.message }, 400);

    const { error: linkError } = await admin.from('guest_follow_ups').update({ user_id: newProfileId }).eq('id', guest_follow_up_id);
    if (linkError) return json({ error: linkError.message }, 400);

    return json({ status: 'created', profile_id: newProfileId });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, 500);
  }
});
