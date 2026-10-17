// Lets a Platform Owner create a brand-new church directly, without
// the normal public signup flow: the owner only ever enters the
// church name, the new admin's email, and a temporary password -- the
// admin fills in everything else themselves on first login, and is
// forced to change that temporary password before they can use the
// app (js/app.js's must-change-password screen, sql/90's
// profiles.must_change_password column). Mirrors import-bible's own
// "elevated action -> edge function, service role, caller-identity
// checked first" shape, just checking platform_owner membership
// instead of global_role.
//
// Uses auth.admin.createUser({email_confirm:true}) rather than the
// client-side scopedClient.auth.signUp() pattern the other admin-
// creates-a-user flows use (userCreatorModal.js/peopleImportModal.js)
// -- those depend on this Supabase project's email-confirmation
// setting being off to get an immediate session back. The admin API
// always works regardless of that setting, which matters here since
// the owner is creating an account for someone else entirely.
//
// Deploy: `supabase functions deploy owner-create-church` (or via the
// Dashboard). SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are automatic.
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

// The owner only enters a church NAME -- create_tenant_for_signup
// (sql/saas_platform/73) also requires a URL-safe slug, so one is
// derived here instead of asking for a second field. Collisions are
// rare (two churches with near-identical names) but handled with a
// short random suffix retry rather than failing the whole request.
function slugify(name) {
  // NFKD splits an accented letter into its base letter plus a
  // separate combining-mark character (always codepoint >= 128) --
  // dropping every codepoint that high strips accents without
  // needing a unicode-range regex escape.
  const unaccented = Array.from((name || '').normalize('NFKD'))
    .filter((ch) => ch.codePointAt(0) < 128)
    .join('');
  let base = unaccented
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/, '');
  if (base.length < 2) base = 'church';
  return base;
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

    const { data: ownerRow } = await admin
      .from('platform_owner')
      .select('user_id')
      .eq('user_id', caller.id)
      .maybeSingle();
    if (!ownerRow) return json({ error: 'Only the platform owner can create a church this way' }, 403);

    const { church_name, admin_email, admin_password } = await req.json();
    if (!church_name?.trim() || !admin_email?.trim() || !admin_password) {
      return json({ error: 'church_name, admin_email and admin_password are all required' }, 400);
    }
    if (admin_password.length < 6) return json({ error: 'Password must be at least 6 characters' }, 400);

    const baseSlug = slugify(church_name);
    let tenantId = null;
    let lastTenantError = null;
    for (let attempt = 0; attempt < 5 && !tenantId; attempt += 1) {
      const slug = attempt === 0 ? baseSlug : `${baseSlug.slice(0, 25).replace(/-+$/, '')}-${Math.random().toString(36).slice(2, 6)}`;
      const { data, error } = await admin.rpc('create_tenant_for_signup', { p_name: church_name.trim(), p_slug: slug });
      if (!error) { tenantId = data; break; }
      lastTenantError = error;
      if (!/already taken/i.test(error.message)) break;
    }
    if (!tenantId) return json({ error: lastTenantError?.message || 'Failed to create the church' }, 400);

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: admin_email.trim(),
      password: admin_password,
      email_confirm: true,
      user_metadata: { tenant_id: tenantId },
    });
    if (createError) return json({ error: createError.message }, 400);

    const newUserId = created.user.id;

    // protect_global_role_trigger (sql/saas_platform/03) only blocks a
    // direct global_role change when auth.uid() is NOT null -- it
    // never is for this service-role client, which carries no end-
    // user JWT, so this goes through unobstructed.
    const { error: roleError } = await admin
      .from('profiles')
      .update({ global_role: 'super_admin', must_change_password: true })
      .eq('id', newUserId);
    if (roleError) return json({ error: roleError.message }, 500);

    return json({ tenant_id: tenantId, user_id: newUserId });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, 500);
  }
});
