// Creates a Silent user: a real profiles row backed by a real but
// inert auth.users row (a placeholder email if none given, a random
// password nobody is ever told) -- so every existing table that
// already references profiles.id (attendance_records.member_id,
// offerings.member_id, member_cases.subject_user_id, ...) just works,
// with no parallel "no-account person" table to retrofit everywhere.
// Must run server-side -- auth.admin.createUser() requires the
// service-role key, same reason admin-reset-password/index.ts can't
// live in the static app.
//
// Deploy: `supabase functions deploy create-silent-user`.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// Same permission shape userCreatorModal.js's own department-assignment
// step already enforces client-side/via RLS for "Add User" -- any
// department admin/secretary, not just the elevated global roles
// admin-reset-password requires. This function only creates the
// account; the caller's own normal (RLS-protected) client still does
// the actual department_memberships inserts afterward, same as today.
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

    const { ok, tenantId } = await callerCanManageUsers(admin, caller.id);
    if (!ok) return json({ error: 'You are not allowed to add people' }, 403);

    const { full_name, email, phone } = await req.json();
    if (!full_name || !full_name.trim()) return json({ error: 'full_name is required' }, 400);

    const placeholderEmail = `silent-${crypto.randomUUID()}@noemail.internal`;
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: (email && email.trim()) || placeholderEmail,
      password: generatePassword(),
      email_confirm: true,
      user_metadata: { full_name: full_name.trim(), tenant_id: tenantId },
    });

    const alreadyRegistered = !createError && created?.user && Array.isArray(created.user.identities) && created.user.identities.length === 0;
    if (createError || alreadyRegistered) {
      return json({ error: alreadyRegistered ? 'That email is already registered' : createError.message }, 400);
    }

    const newProfileId = created.user.id;
    const { error: updateError } = await admin
      .from('profiles')
      .update({ is_silent: true, phone: (phone && phone.trim()) || null })
      .eq('id', newProfileId);
    if (updateError) return json({ error: updateError.message }, 400);

    return json({ profile_id: newProfileId });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, 500);
  }
});
