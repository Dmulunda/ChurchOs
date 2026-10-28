// Moves a full Active account back into the Silent Directory. Revokes
// login (ban, not a scrambled password or wiped email -- reversible,
// and keeps their real credentials intact in case they're ever
// promoted back) while leaving profiles.id and every table that
// already references it (attendance_records, offerings, member_cases,
// ...) completely untouched.
//
// Same admin-permission shape as upgrade-silent-user/index.ts's admin
// mode (callerCanManageUsers) -- any dept admin/secretary, church
// admin, or elevated global role, not just Super Admin.
//
// Deploy: `supabase functions deploy downgrade-to-silent`.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
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

    const { ok, tenantId } = await callerCanManageUsers(admin, caller.id);
    if (!ok) return json({ error: 'You are not allowed to do this' }, 403);

    const { profile_id } = await req.json();
    if (!profile_id) return json({ error: 'profile_id is required' }, 400);

    const { data: target, error: targetError } = await admin
      .from('profiles')
      .select('id, is_silent, tenant_id')
      .eq('id', profile_id)
      .single();
    if (targetError || !target) return json({ error: 'User not found' }, 404);
    if (target.tenant_id !== tenantId) return json({ error: 'You are not allowed to do this' }, 403);
    if (target.is_silent) return json({ error: 'That user is already Silent' }, 400);
    if (profile_id === caller.id) return json({ error: 'You cannot move your own account to the Silent Directory' }, 400);

    const { error: banError } = await admin.auth.admin.updateUserById(profile_id, { ban_duration: '876000h' });
    if (banError) return json({ error: banError.message }, 400);

    const { error: updateError } = await admin
      .from('profiles')
      .update({ is_silent: true, user_status: 'member' })
      .eq('id', profile_id);
    if (updateError) return json({ error: updateError.message }, 400);

    return json({ status: 'moved_to_silent', profile_id });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, 500);
  }
});
