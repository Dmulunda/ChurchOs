// Which church a public request is for: body.church (the church's slug,
// as in welcome.html?church=<slug>) or, when absent, the signed-in
// caller's own church (current_tenant_id(), which also honours "acting
// as" another church). Returns the public tenant columns, or null.
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const COLUMNS = 'id, name, slug, logo_url, address, email, phone, website_url, facebook_url, youtube_url, instagram_url, tiktok_url, whatsapp_url, live_schedule, live_timezone';

// deno-lint-ignore no-explicit-any
export async function resolveTenant(admin: SupabaseClient, req: Request, body: any): Promise<any | null> {
  const slug = typeof body?.church === 'string' ? body.church.trim().toLowerCase() : '';
  if (slug) {
    if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null;
    const { data } = await admin.from('tenants').select(COLUMNS).eq('slug', slug).is('deleted_at', null).maybeSingle();
    return data || null;
  }
  const authHeader = req.headers.get('Authorization') || '';
  if (!/^Bearer\s+\S+/.test(authHeader)) return null;
  const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: tenantId } = await asUser.rpc('current_tenant_id');
  if (!tenantId) return null;
  const { data } = await admin.from('tenants').select(COLUMNS).eq('id', tenantId).is('deleted_at', null).maybeSingle();
  return data || null;
}
