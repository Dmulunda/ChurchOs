// Cross-tenant password reset for the Site Admin's Churches tab --
// deliberately a SEPARATE function from admin-reset-password/index.ts
// rather than a new branch grafted onto it. That function's own
// comment explains why it hard-requires same-tenant: "without this
// check a super_admin could reset the password of any user on the
// platform just by knowing their id" -- a Site Admin's whole point
// here is to do exactly that, on purpose, for support, so it needs its
// own narrower gate (platform_admins membership, not any tenant's
// global_role) and its own audit trail, not a bypass flag threaded
// through the single-tenant function that would weaken its own
// reasoning for every other caller.
//
// Deploy: `supabase functions deploy site-admin-reset-password`.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Unambiguous charset — no 0/O/1/l/I — since this is meant to be read
// aloud or typed by hand when handed to the member.
const PASSWORD_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

function generatePassword(length = 10) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i++) out += PASSWORD_CHARS[bytes[i] % PASSWORD_CHARS.length];
  return out;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
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

    const { data: platformAdminRow } = await admin
      .from('platform_admins')
      .select('user_id')
      .eq('user_id', caller.id)
      .maybeSingle();
    if (!platformAdminRow) return json({ error: 'Only a Site Admin can do this' }, 403);

    const { target_user_id, new_password } = await req.json();
    if (!target_user_id) return json({ error: 'target_user_id is required' }, 400);

    const { data: targetProfile } = await admin
      .from('profiles')
      .select('tenant_id, full_name')
      .eq('id', target_user_id)
      .single();
    if (!targetProfile) return json({ error: 'User not found' }, 404);

    const password = (new_password && new_password.trim()) || generatePassword();
    if (password.length < 6) return json({ error: 'Password must be at least 6 characters' }, 400);

    const { error: updateError } = await admin.auth.admin.updateUserById(target_user_id, { password });
    if (updateError) return json({ error: updateError.message }, 400);

    // Best-effort -- a logging failure shouldn't undo a reset that
    // already succeeded, but it should never go unrecorded silently
    // either, so this isn't wrapped in a try/catch that swallows it.
    await admin.from('site_admin_access_log').insert({
      site_admin_id: caller.id,
      tenant_id: targetProfile.tenant_id,
      target_user_id,
      action: 'reset_password',
    });

    return json({ password });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, 500);
  }
});
