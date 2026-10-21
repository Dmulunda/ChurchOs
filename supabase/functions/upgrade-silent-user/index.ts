// Upgrades a Silent user to a real, logged-in-able account by
// changing the *same* row's auth credentials -- profiles.id never
// changes, so attendance_records/offerings/member_cases rows already
// pointing at it stay valid with zero data migration. Two callers:
//
// - Admin mode (a real session JWT is present): the admin creating
//   the account IS the confirmation -- no further corroboration
//   needed, called from userCreatorModal.js's match-confirm step.
// - Self-serve mode (no JWT -- someone signing themselves up): a
//   self-asserted "yes that's me" isn't enough on its own (a stranger
//   could type a similar name and inherit someone else's history), so
//   this only upgrades instantly if the submitted email or phone also
//   matches what's actually on file for that Silent record --
//   verified here, server-side, never trusting a client-sent flag.
//   Otherwise it queues a silent_user_claims row for the pastoral team
//   to review and touches no auth user at all.
//
// Deploy: `supabase functions deploy upgrade-silent-user`.
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
    const admin = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    );

    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    const body = await req.json();
    const { silent_profile_id, email, password, phone } = body;
    if (!silent_profile_id || !email || !password) {
      return json({ error: 'silent_profile_id, email and password are required' }, 400);
    }

    const { data: silentProfile, error: silentError } = await admin
      .from('profiles')
      .select('id, full_name, phone, tenant_id, is_silent')
      .eq('id', silent_profile_id)
      .single();
    if (silentError || !silentProfile || !silentProfile.is_silent) {
      return json({ error: 'Silent user not found' }, 404);
    }

    let isAdminCaller = false;
    if (jwt) {
      const { data: { user: caller } } = await admin.auth.getUser(jwt);
      if (caller) {
        const { ok, tenantId } = await callerCanManageUsers(admin, caller.id);
        if (!ok || tenantId !== silentProfile.tenant_id) return json({ error: 'You are not allowed to do this' }, 403);
        isAdminCaller = true;
      }
    }

    async function doUpgrade() {
      const { error: updateAuthError } = await admin.auth.admin.updateUserById(silent_profile_id, { email, password, email_confirm: true });
      if (updateAuthError) return json({ error: updateAuthError.message }, 400);
      const { error: updateProfileError } = await admin
        .from('profiles')
        .update({ is_silent: false, phone: (phone && phone.trim()) || silentProfile.phone })
        .eq('id', silent_profile_id);
      if (updateProfileError) return json({ error: updateProfileError.message }, 400);
      return json({ status: 'upgraded', profile_id: silent_profile_id });
    }

    if (isAdminCaller) return await doUpgrade();

    // Self-serve: the client's own match-confirm step isn't trusted on
    // its own -- re-run the same name-similarity check server-side
    // against the claimed name, and require email or phone to also
    // corroborate before upgrading in place.
    const { claimed_full_name } = body;
    if (!claimed_full_name) return json({ error: 'claimed_full_name is required' }, 400);

    const { data: matchRows } = await admin.rpc('find_silent_user_match', {
      p_full_name: claimed_full_name,
      p_tenant_id: silentProfile.tenant_id,
    });
    const nameMatches = Array.isArray(matchRows) && matchRows.some((r) => r.id === silent_profile_id);
    if (!nameMatches) return json({ error: 'That record no longer matches' }, 400);

    const { data: authUser } = await admin.auth.admin.getUserById(silent_profile_id);
    const storedEmail = authUser?.user?.email || '';
    const storedIsPlaceholder = storedEmail.endsWith('@noemail.internal');
    const emailCorroborates = !storedIsPlaceholder && storedEmail.toLowerCase() === String(email).toLowerCase();
    const phoneCorroborates = !!silentProfile.phone && !!phone && silentProfile.phone.trim() === String(phone).trim();

    if (emailCorroborates || phoneCorroborates) {
      return await doUpgrade();
    }

    const { error: claimError } = await admin.from('silent_user_claims').insert({
      silent_profile_id,
      claimed_full_name,
      claimed_email: email,
      claimed_phone: phone || null,
      tenant_id: silentProfile.tenant_id,
    });
    if (claimError) return json({ error: claimError.message }, 400);

    return json({ status: 'pending_review' });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, 500);
  }
});
