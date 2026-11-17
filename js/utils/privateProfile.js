// Address, birth place, legal name and signature are not readable from
// the profiles table directly (sql/157). Authorized people (the person
// themselves, the pastoral team, church admins, global-role holders and
// the admins/secretaries of the person's departments) get them through
// the get_profiles_private() function. Everyone else simply gets nothing.
export const PRIVATE_PROFILE_FIELDS = ['address', 'birth_country', 'birth_city', 'legal_name', 'signature_data'];

// Fetch private fields for the given profile ids: Map(id -> fields).
export async function fetchPrivateProfiles(supabase, ids) {
  const out = new Map();
  const unique = [...new Set((ids || []).filter(Boolean))];
  for (let i = 0; i < unique.length; i += 500) {
    const { data, error } = await supabase.rpc('get_profiles_private', { p_ids: unique.slice(i, i + 500) });
    if (error) { console.warn('get_profiles_private failed:', error.message); break; }
    (data || []).forEach((r) => out.set(r.id, r));
  }
  return out;
}

// Copy the private fields onto each row (rows keyed by `idKey`).
export async function mergePrivateFields(supabase, rows, idKey = 'id') {
  if (!rows || !rows.length) return rows;
  const byId = await fetchPrivateProfiles(supabase, rows.map((r) => r[idKey]));
  rows.forEach((r) => {
    const p = byId.get(r[idKey]);
    PRIVATE_PROFILE_FIELDS.forEach((f) => { if (!(f in r) || r[f] == null) r[f] = p ? p[f] ?? null : null; });
  });
  return rows;
}
