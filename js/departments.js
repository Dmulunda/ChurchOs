// Loads the signed-in user's department memberships (or every
// department, if they hold a global role) once per session, and tracks
// which department is currently "active" — the one the sidebar nav and
// tab content render for. Mirrors i18n.js's localStorage pattern.
import { supabase } from './supabaseClient.js';

const ACTIVE_DEPT_STORAGE_KEY = 'choir-hub-active-department';

// Sentinel stored in place of a real department key when a global-role
// holder is on their Super Admin Home console rather than any specific
// department — see isHomeActive()/goHome() below. Exported so app.js's
// department switcher can offer "Home" as a real, selectable option.
export const HOME_KEY = '__home__';

// Static catalog of department keys, matching the seed data in
// sql/014_departments_rbac.sql (plus the additions in
// sql/027_finance_departments_and_reports.sql). Hardcoded (rather than
// queried) because the sign-up form needs to list departments before
// the applicant has a session — the `departments` table's RLS only
// allows authenticated reads, and there's no reason for this
// rarely-changing catalog to need a network round trip anyway.
export const DEPARTMENT_KEYS = [
  'choir', 'social', 'intercession', 'media_tech', 'interpreting',
  'cleaning', 'preaching', 'ushers', 'security', 'ecodem', 'evangelism',
  'welcoming_socialisation', 'grand_jeunes_couples', 'finance',
];

// Mirrors sql/saas_platform/86_pricing_v2.sql's is_core_department_key()
// exactly -- the departments a Basic-plan SAAS tenant can use (the original
// 7, plus church_program/welcoming_socialisation added in 116_core_
// departments_basic_fix.sql). Main has no plans at all, so this constant is
// simply unused there (loadMyDepartments()'s allowedDepartmentKeys param
// defaults to undefined/no filter, same as every call site that doesn't
// pass it).
export const CORE_DEPARTMENT_KEYS = [
  'media_tech', 'preaching', 'finance', 'ushers', 'ecodem', 'choir', 'cleaning',
  'church_program', 'welcoming_socialisation',
];

let myDepartments = null; // [{ id, key, name, kind, meeting_link, role }] — synthesized: role is the global role string for a global-role holder, else their real department_role
let literalDepartments = null; // the same shape, but always from their real department_memberships rows, ignoring any global role — what "Standard User Mode" below shows
let globalRole = null;
let actingAsStandardUser = false;

// allowedDepartmentKeys: optional. When passed (SAAS only, a
// Basic-plan tenant), a GLOBAL-role holder's synthesized "every
// department" view (below) is filtered down to just those keys --
// matches sql/86_pricing_v2.sql's backend block on actually JOINING a
// non-core department as a regular member, so a Super Admin on Basic
// doesn't see departments nobody else on their plan can use either.
// Real existing memberships (literalDepartments) are never filtered
// here -- only this synthesized view, consistent with the "block new
// growth, never retroactively hide/remove existing data" rule the
// backend side follows too.
export async function loadMyDepartments(userId, { allowedDepartmentKeys } = {}) {
  const [{ data: profile }, { data: memberships }] = await Promise.all([
    supabase.from('profiles').select('global_role').eq('id', userId).single(),
    supabase
      .from('department_memberships')
      .select('role, departments ( id, key, name, kind, meeting_link, icon )')
      .eq('user_id', userId)
      .eq('status', 'approved'),
  ]);

  globalRole = profile?.global_role || null;
  literalDepartments = (memberships || [])
    .filter((m) => m.departments)
    .map((m) => ({ ...m.departments, role: m.role }))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (globalRole) {
    const { data: allDepartments } = await supabase.from('departments').select('id, key, name, kind, meeting_link, icon').order('name');
    const visible = allowedDepartmentKeys ? (allDepartments || []).filter((d) => allowedDepartmentKeys.includes(d.key)) : allDepartments;
    myDepartments = (visible || []).map((d) => ({ ...d, role: globalRole }));
  } else {
    myDepartments = literalDepartments;
  }

  return myDepartments;
}

export function getMyDepartments() {
  if (isViewingAs()) return viewAsDepartments || [];
  if (globalRole && actingAsStandardUser) return literalDepartments || [];
  if (isPreviewingAsMember() && previewDepartmentId) {
    return (myDepartments || []).map((d) => (d.id === previewDepartmentId ? { ...d, role: 'member' } : d));
  }
  return myDepartments || [];
}

export function getGlobalRole() {
  return globalRole;
}

export function isSuperRole() {
  return globalRole === 'super_admin' || globalRole === 'super_viewer';
}

// Whether this session currently has cross-department reach — a global
// role holder, unless they've switched into Standard User Mode (or are
// mid-View-As, which has its own independent identity entirely).
export function hasGlobalReach() {
  return !!globalRole && !actingAsStandardUser && !isViewingAs();
}

// Mirrors can_manage_finance() (sql) exactly -- Finance department
// admin/secretary, or one of the three global roles that get
// church-wide financial oversight (Pastor, Church Secretary, Super
// Admin). Deciding what's shown here tracks what RLS actually allows
// the caller to touch, not a separate ad hoc UI-only role list.
const FINANCE_OVERSIGHT_ROLES = ['super_admin', 'pastor_admin', 'church_secretary'];
export function hasFinanceOversight() {
  if (hasGlobalReach() && FINANCE_OVERSIGHT_ROLES.includes(globalRole)) return true;
  return getMyDepartments().some((d) => d.key === 'finance' && (d.role === 'admin' || d.role === 'secretary'));
}

// Mirrors can_record_offerings() (sql/066) -- any approved Finance
// membership at all (admin/secretary/member), not just oversight-level
// like hasFinanceOversight() above. Widens who can even see the
// Offerings page/nav entry to the whole Finance team, not just its
// leads -- recording day-to-day entries shouldn't require being an
// admin or secretary.
export function canRecordOfferings() {
  if (hasFinanceOversight()) return true;
  return getMyDepartments().some((d) => d.key === 'finance');
}

// Mirrors can_delete_offerings() (sql/066) -- deliberately narrower
// than hasFinanceOversight(): Finance department ADMIN specifically
// (or one of the three global oversight roles), not a Finance
// secretary or plain member. Removing a financial record is a
// different bar than recording one.
export function canDeleteOfferings() {
  if (hasGlobalReach() && FINANCE_OVERSIGHT_ROLES.includes(globalRole)) return true;
  return getMyDepartments().some((d) => d.key === 'finance' && d.role === 'admin');
}

// Whether this session should see the Budget nav item at all -- either
// full cross-department oversight above, or leadership (admin/secretary)
// of at least one ordinary department, entitling them to that
// department's own Fund Request / Budget Report. Everyone else gets no
// trace of the feature -- the nav button is never constructed for them.
export function hasAnyDeptLeadership() {
  return hasFinanceOversight() || getMyDepartments().some((d) => d.role === 'admin' || d.role === 'secretary');
}

// Mirrors can_approve_finance() (sql) exactly -- identical to
// hasFinanceOversight() above MINUS a Finance department secretary: a
// Finance secretary still sees everything (hasFinanceOversight() stays
// true for them), but can't act on it. Drives whether Approve/Reject
// and the review-note field show up in the inbox UI.
export function canApproveFinance() {
  if (hasGlobalReach() && FINANCE_OVERSIGHT_ROLES.includes(globalRole)) return true;
  return getMyDepartments().some((d) => d.key === 'finance' && d.role === 'admin');
}

// ---- Role Switcher: Super Admin Mode vs Standard User Mode ----
// A global-role holder's own account may also carry real, literal
// department_memberships (e.g. the original Choir admin who was later
// promoted to Super Admin) — this lets them preview their own ordinary
// access instead of the global override, without impersonating anyone
// else. Purely a client-side display preference: the database still
// enforces their real global role regardless of this toggle, so unlike
// View-As/Preview-as-Member there's no need to block writes here — if
// they have no literal memberships at all, Standard User Mode simply
// (and correctly) shows them as having no department access.
export function isActingAsStandardUser() {
  return actingAsStandardUser;
}

export function setActingAsStandardUser(value) {
  actingAsStandardUser = value;
  if (!value) goHome();
}

// ---- Super Admin Home ----
// A global-role holder with no explicit department choice yet (fresh
// login, or having explicitly navigated back) lands on their Home
// console instead of whichever department happens to sort first.
export function isHomeActive() {
  if (!hasGlobalReach()) return false;
  const storedKey = localStorage.getItem(ACTIVE_DEPT_STORAGE_KEY);
  return !storedKey || storedKey === HOME_KEY;
}

export function goHome() {
  localStorage.setItem(ACTIVE_DEPT_STORAGE_KEY, HOME_KEY);
}

// A department's synthesized `.role` (see loadMyDepartments/startViewAs
// above) is either a department_role ('admin'/'secretary'/'member') or,
// for a global-role holder, the literal global_role string — these two
// helpers classify that value for the announcements feature, mirroring
// can_post_department_announcement()/can_approve_department_membership()
// in sql/021 and sql/023 so the UI predicts the same outcome the RLS
// policies will actually enforce.
export function canPostAnnouncements(role) {
  return ['admin', 'secretary', 'super_admin', 'pastor_admin', 'church_secretary'].includes(role);
}

export function isGlobalAnnouncer(role) {
  return ['super_admin', 'pastor_admin', 'church_secretary'].includes(role);
}

// ---- Super Admin "View-As" mode ----
// True impersonation (actually holding the target's session) would need
// a service-role backend we don't have, and would be indistinguishable
// from really being logged in as them. Instead: simulate the target's
// department memberships/roles (so the switcher, nav, and admin-gated
// UI reflect *their* world, not the super admin's), and — for the
// "write operations are completely disabled" requirement — swap in a
// wrapped Supabase client that blocks every mutating call at the
// network layer. That's a stronger guarantee than trying to hide every
// write button across the app; even a control that's still visible
// simply can't succeed while this is active.
let viewAsTarget = null; // { id, full_name } | null
let viewAsDepartments = null;

export function isViewingAs() {
  return viewAsTarget !== null;
}

export function getViewAsTarget() {
  return viewAsTarget;
}

export async function startViewAs(targetUserId, targetFullName) {
  const { data: profile } = await supabase.from('profiles').select('global_role').eq('id', targetUserId).single();
  const targetGlobalRole = profile?.global_role || null;

  if (targetGlobalRole) {
    const { data: allDepartments } = await supabase.from('departments').select('id, key, name, kind, meeting_link, icon').order('name');
    viewAsDepartments = (allDepartments || []).map((d) => ({ ...d, role: targetGlobalRole }));
  } else {
    const { data: memberships } = await supabase
      .from('department_memberships')
      .select('role, departments ( id, key, name, kind, meeting_link, icon )')
      .eq('user_id', targetUserId)
      .eq('status', 'approved');
    viewAsDepartments = (memberships || [])
      .filter((m) => m.departments)
      .map((m) => ({ ...m.departments, role: m.role }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  viewAsTarget = { id: targetUserId, full_name: targetFullName };
  setActiveDepartmentKey(viewAsDepartments[0]?.key || '');
}

export function stopViewAs() {
  viewAsTarget = null;
  viewAsDepartments = null;
  // Land back on Home rather than wherever the simulated target's own
  // first department happened to be (startViewAs() stores their key).
  if (globalRole) goHome();
}

const VIEW_AS_BLOCKED_MESSAGE = 'This action is disabled while viewing as another user.';

// A chainable stand-in for a blocked query: any method call (.eq(),
// .select(), .single(), .match(), ...) returns itself again, and
// awaiting it (its `.then`) always resolves to a blocked-action error —
// so code written for the real query builder works unmodified, it just
// never succeeds.
function createBlockedQuery() {
  const chainable = {
    then(resolve) {
      resolve({ data: null, error: { message: VIEW_AS_BLOCKED_MESSAGE } });
    },
  };
  return new Proxy(chainable, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => chainable;
    },
  });
}

let readOnlyClient = null;

function getReadOnlyClient() {
  if (readOnlyClient) return readOnlyClient;

  readOnlyClient = new Proxy(supabase, {
    get(target, prop) {
      if (prop === 'from') {
        return (table) => {
          const builder = target.from(table);
          return new Proxy(builder, {
            get(builderTarget, builderProp) {
              if (['insert', 'update', 'delete', 'upsert'].includes(builderProp)) {
                return () => createBlockedQuery();
              }
              const value = builderTarget[builderProp];
              return typeof value === 'function' ? value.bind(builderTarget) : value;
            },
          });
        };
      }
      if (prop === 'rpc') {
        return () => createBlockedQuery();
      }
      if (prop === 'storage') {
        return { from: () => ({ upload: () => Promise.resolve({ data: null, error: { message: VIEW_AS_BLOCKED_MESSAGE } }) }) };
      }
      const value = target[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  return readOnlyClient;
}

// ---- Department Admin "Preview as Member" ----
// A lighter counterpart to View-As for a literal (non-global)
// department admin: no target picker, just "show me my own active
// department as a plain member would see it." Reuses the same
// read-only client as View-As for the same reason — write controls
// that are still visible simply can't succeed while this is active.
let previewingAsMember = false;
let previewDepartmentId = null;

export function isPreviewingAsMember() {
  return previewingAsMember;
}

export function startPreviewAsMember() {
  const active = getActiveDepartment();
  if (!active) return;
  previewDepartmentId = active.id;
  previewingAsMember = true;
}

export function stopPreviewAsMember() {
  previewingAsMember = false;
  previewDepartmentId = null;
}

// Every tab-entry file should call this instead of importing `supabase`
// directly, and pass the result down to its child components as usual —
// it's the real client except while viewing-as or previewing-as-member,
// when it's swapped for the write-blocked one.
export function getEffectiveSupabase() {
  return (isViewingAs() || isPreviewingAsMember()) ? getReadOnlyClient() : supabase;
}

export function getActiveDepartment() {
  const departments = getMyDepartments();
  if (departments.length === 0) return null;

  if (isHomeActive()) return null;

  const storedKey = localStorage.getItem(ACTIVE_DEPT_STORAGE_KEY);
  const stored = departments.find((d) => d.key === storedKey);
  if (stored) return stored;

  // No preference saved yet (first-ever visit, or localStorage was
  // cleared) — everyone lands in Church Program (sql/065) first,
  // rather than whatever department happens to sort first
  // alphabetically. Once someone navigates anywhere, that choice is
  // remembered as usual and this fallback no longer applies to them.
  return departments.find((d) => d.key === 'church_program') || departments[0];
}

export function setActiveDepartmentKey(key) {
  localStorage.setItem(ACTIVE_DEPT_STORAGE_KEY, key);
}

// Used right after sign-up (once a session exists) to file pending
// requests for the departments an applicant selected. Always role
// 'member' / status 'pending' — the DB also enforces this (see
// sql/015_membership_insert_fix.sql), self-service can never grant
// admin or auto-approve.
export async function requestDepartmentMemberships(userId, departmentKeys) {
  if (!departmentKeys || departmentKeys.length === 0) return;

  const { data: departments } = await supabase.from('departments').select('id, key').in('key', departmentKeys);
  const rows = (departments || []).map((d) => ({ user_id: userId, department_id: d.id }));
  if (rows.length === 0) return;

  await supabase.from('department_memberships').insert(rows);
}
