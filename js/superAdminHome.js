// Super Admin Home tab entry point: where a global-role holder
// (Super Admin, Super Viewer, Pastor Admin, Church Secretary) lands
// first — a stat strip, a widget grid answering "what needs my
// attention today" (events, pending requests, birthdays, prayer,
// attendance, announcements), and every pending membership request
// across every department below it (the actual fix for "Super Admin
// can't approve" — the RLS already allowed it, there was just no
// cross-department view to find them in). The flat "System tools" link
// list that used to live here moved to its own Tools tab
// (js/toolsPage.js) — every modal it opens is still created and torn
// down right here, exactly as before, and exposed via the openX()
// exports below so Tools' buttons (and the header's own "New Member"
// button, via openGuestOnboardingHub) can reach them without
// duplicating the create/teardown logic in a second file.
import { getEffectiveSupabase, getGlobalRole } from './departments.js';
import { hasFeature } from './entitlements.js';
import { openPlansModal } from './app.js';
import { createUserManagerModal } from './components/userManager.js';
import { createSilentDirectoryModal } from './components/silentDirectory.js';
import { renderAllDepartmentApprovals } from './components/allDepartmentApprovals.js';
import { createGuestOnboardingModal } from './components/guestOnboardingHub.js';
import { createMemberCaseModal } from './components/memberCaseManager.js';
import { createMenuCustomizerModal } from './components/menuCustomizer.js';
import { createMessageModerationModal } from './components/messageModeration.js';
import { createLoginActivityModal } from './components/loginActivity.js';
import { createDepartmentModal } from './components/createDepartmentModal.js';
import { createBibleImportModal } from './components/bibleImportTool.js';
import { createPeopleImportModal } from './components/peopleImportModal.js';
import { createPastorMeetingQueueModal } from './components/pastorMeetingRequests.js';
import { createPrayerRequestQueueModal } from './components/prayerRequests.js';
import { renderUpcomingChurchEvents } from './components/upcomingChurchEvents.js';
import { renderBirthdaysWidget, renderPrayerRequestsWidget, renderPendingRequestsWidget, renderAttendanceWidget, renderAnnouncementsWidget } from './components/homeWidgets.js';
import { createAttendanceManagerModal } from './components/attendanceManager.js';
import { t, departmentLabel, getLang } from './i18n.js';

const PASTORAL_TEAM_ROLES = ['super_admin', 'pastor_admin', 'church_secretary'];
// Matches dateHeader.js's own mapping -- not exported from there, and
// this is the only other place that needs it.
const LOCALE_BY_LANG = { en: 'en-US', fr: 'fr-FR' };

let currentDirectoryModal = null;
let currentSilentDirectoryModal = null;
let currentReportsModal = null;
let currentGuestHubModal = null;
let currentMemberCaseModal = null;
let currentMenuCustomizerModal = null;
let currentMessageModerationModal = null;
let currentLoginActivityModal = null;
let currentCreateDepartmentModal = null;
let currentBibleImportModal = null;
let currentPeopleImportModal = null;
let currentPastorMeetingQueueModal = null;
let currentPrayerRequestQueueModal = null;
let currentAttendanceModal = null;

// Every open*() below follows the same shape: if Home hasn't rendered
// yet in this session (e.g. the user opened Tools directly, or the
// header's "New Member" button fires before any tab has loaded), the
// modal doesn't exist yet — render Home first so it does, then open it.
export async function openGuestOnboardingHub() {
  if (!currentGuestHubModal) await renderSuperAdminHomeTab();
  currentGuestHubModal?.open();
}
export async function openDirectory() {
  if (!currentDirectoryModal) await renderSuperAdminHomeTab();
  currentDirectoryModal?.open();
}
export async function openSilentDirectory() {
  if (!currentSilentDirectoryModal) await renderSuperAdminHomeTab();
  currentSilentDirectoryModal?.open();
}
export async function openMemberCases() {
  if (!currentMemberCaseModal) await renderSuperAdminHomeTab();
  currentMemberCaseModal?.open();
}
export async function openPrayerRequests() {
  if (!currentPrayerRequestQueueModal) await renderSuperAdminHomeTab();
  currentPrayerRequestQueueModal?.open();
}
export async function openPastorMeetings() {
  if (!currentPastorMeetingQueueModal) await renderSuperAdminHomeTab();
  currentPastorMeetingQueueModal?.open();
}
export async function openReports() {
  if (!currentReportsModal) await renderSuperAdminHomeTab();
  currentReportsModal?.open();
}
export async function openLoginActivity() {
  if (!currentLoginActivityModal) await renderSuperAdminHomeTab();
  currentLoginActivityModal?.open();
}
export async function openCreateDepartment() {
  if (!hasFeature('create_departments')) { openPlansModal(); return; }
  if (!currentCreateDepartmentModal) await renderSuperAdminHomeTab();
  currentCreateDepartmentModal?.open();
}
export async function openMenuCustomizer() {
  if (!hasFeature('customize_departments')) { openPlansModal(); return; }
  if (!currentMenuCustomizerModal) await renderSuperAdminHomeTab();
  currentMenuCustomizerModal?.open();
}
export async function openMessageModeration() {
  if (!currentMessageModerationModal) await renderSuperAdminHomeTab();
  currentMessageModerationModal?.open();
}
export async function openBibleImport() {
  if (!currentBibleImportModal) await renderSuperAdminHomeTab();
  currentBibleImportModal?.open();
}
export async function openPeopleImport() {
  if (!currentPeopleImportModal) await renderSuperAdminHomeTab();
  currentPeopleImportModal?.open();
}
export async function openAttendanceManager() {
  if (!currentAttendanceModal) await renderSuperAdminHomeTab();
  currentAttendanceModal?.open();
}

export async function renderSuperAdminHomeTab() {
  const supabase = getEffectiveSupabase();
  const container = document.querySelector('#super-home-content');
  container.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    container.innerHTML = `<p class="text-slate-500">${t('scheduling.pleaseSignIn')}</p>`;
    return;
  }

  const isPastoralTeam = PASTORAL_TEAM_ROLES.includes(getGlobalRole());
  const canSeeMeetings = ['super_admin', 'church_secretary'].includes(getGlobalRole());
  const isSuperAdmin = getGlobalRole() === 'super_admin';

  const displayName = document.querySelector('[data-nav-group="current-user-name"]')?.textContent?.trim() || '';
  const todayFormatted = new Date().toLocaleDateString(LOCALE_BY_LANG[getLang()] || 'en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  container.innerHTML = `
    <div class="flex items-baseline justify-between flex-wrap gap-1 mb-1">
      <h2 class="text-lg sm:text-xl font-bold text-slate-900">${t('superHome.welcomeBack', { name: escapeHtml(displayName) })}</h2>
      <span class="text-xs sm:text-sm text-slate-400">${escapeHtml(todayFormatted)}</span>
    </div>

    <div class="mt-4" data-el="metrics"></div>

    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
      <div data-el="w-events"></div>
      <div data-el="w-pending"></div>
      <div data-el="w-birthdays"></div>
      <div data-el="w-prayer"></div>
      <div data-el="w-attendance" class="md:col-span-2"></div>
      <div data-el="w-announcements"></div>
    </div>

    <div id="super-home-pending" class="bg-black text-white rounded-xl p-4 sm:p-6 mt-6">
      <h2 class="text-lg font-semibold mb-4">${t('superHome.pendingTitle')}</h2>
      <div data-el="pending"></div>
    </div>
  `;

  renderMetrics(container.querySelector('[data-el="metrics"]'), supabase, isPastoralTeam);
  renderAllDepartmentApprovals(container.querySelector('[data-el="pending"]'), { supabase, adminUserId: user.id });

  // This tab re-renders on things unrelated to a real page navigation —
  // View-As entry/exit, language changes, department-switcher use that
  // lands back on Home — so the previous modal instances (and their
  // effective-client/scope, which may now be stale) are torn down
  // before fresh ones are built, instead of accumulating hidden orphans.
  currentReportsModal?.root.remove();
  currentDirectoryModal?.root.remove();
  currentSilentDirectoryModal?.root.remove();
  currentGuestHubModal?.root.remove();
  currentMemberCaseModal?.root.remove();
  currentMenuCustomizerModal?.root.remove();
  currentMessageModerationModal?.root.remove();
  currentLoginActivityModal?.root.remove();
  currentCreateDepartmentModal?.root.remove();
  currentBibleImportModal?.root.remove();
  currentPeopleImportModal?.root.remove();
  currentPastorMeetingQueueModal?.root.remove();
  currentPrayerRequestQueueModal?.root.remove();
  currentAttendanceModal?.root.remove();

  // Modals are still created here unconditionally-per-role (not gated
  // on a button existing in this tab's own DOM anymore, since the
  // buttons that open most of these now live on the Tools tab) — every
  // openX() export above depends on the corresponding current*Modal
  // existing once this function has run.
  currentReportsModal = createDepartmentReportsModal({ supabase });
  currentDirectoryModal = createUserManagerModal({
    supabase,
    scope: { type: 'global' },
    currentUserId: user.id,
    title: t('directory.title'),
  });
  currentSilentDirectoryModal = createSilentDirectoryModal({
    supabase,
    currentUserId: user.id,
    title: t('silentDirectory.title'),
  });

  if (isPastoralTeam) {
    currentGuestHubModal = createGuestOnboardingModal({ supabase, currentUserId: user.id });
    currentMemberCaseModal = createMemberCaseModal({ supabase, currentUserId: user.id, scope: { type: 'pastoral' } });
    currentPrayerRequestQueueModal = createPrayerRequestQueueModal({ supabase });
    currentAttendanceModal = createAttendanceManagerModal({ supabase, currentUserId: user.id });
  }

  if (canSeeMeetings) {
    currentPastorMeetingQueueModal = createPastorMeetingQueueModal({ supabase });
  }

  if (isSuperAdmin) {
    currentLoginActivityModal = createLoginActivityModal({ supabase });
    currentCreateDepartmentModal = createDepartmentModal({
      supabase,
      currentUserId: user.id,
      onCreated: () => renderMetrics(container.querySelector('[data-el="metrics"]'), supabase, isPastoralTeam),
    });
    currentMenuCustomizerModal = createMenuCustomizerModal({ supabase, currentUserId: user.id });
    currentMessageModerationModal = createMessageModerationModal({ supabase });
    currentBibleImportModal = createBibleImportModal({ supabase });
    currentPeopleImportModal = createPeopleImportModal({ supabase, currentUserId: user.id });
  }

  renderUpcomingChurchEvents(container.querySelector('[data-el="w-events"]'), { supabase });
  renderPendingRequestsWidget(container.querySelector('[data-el="w-pending"]'), {
    supabase,
    onScrollToPending: () => document.querySelector('#super-home-pending')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
  });
  renderBirthdaysWidget(container.querySelector('[data-el="w-birthdays"]'), {
    supabase,
    onOpenDirectory: () => currentDirectoryModal?.open(),
  });
  renderPrayerRequestsWidget(container.querySelector('[data-el="w-prayer"]'), {
    supabase,
    onOpenQueue: isPastoralTeam ? () => currentPrayerRequestQueueModal?.open() : null,
  });
  renderAttendanceWidget(container.querySelector('[data-el="w-attendance"]'), {
    supabase,
    onOpenAttendance: isPastoralTeam ? () => currentAttendanceModal?.open() : null,
  });
  renderAnnouncementsWidget(container.querySelector('[data-el="w-announcements"]'), { supabase });
}

async function renderMetrics(container, supabase, isPastoralTeam) {
  container.innerHTML = `<div class="grid grid-cols-2 sm:grid-cols-4 gap-4">${[1, 2, 3, 4].map(() => metricCardHtml(null, '—', '')).join('')}</div>`;

  const [
    { count: userCount },
    { count: departmentCount },
    { count: openCaseCount },
    { count: pendingMemberships },
    { count: pendingMeetings },
    { count: pendingBudgets },
  ] = await Promise.all([
    supabase.from('profiles').select('id', { count: 'exact', head: true }).is('removed_at', null),
    supabase.from('departments').select('id', { count: 'exact', head: true }),
    supabase.from('member_cases').select('id', { count: 'exact', head: true }).in('status', ['open', 'in_progress']),
    supabase.from('department_memberships').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('pastor_meeting_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('budget_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
  ]);
  const pendingCount = (pendingMemberships || 0) + (pendingMeetings || 0) + (pendingBudgets || 0);

  container.innerHTML = `
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
      ${metricCardHtml('directory', userCount ?? '—', t('superHome.metricUsers'))}
      ${metricCardHtml(null, departmentCount ?? '—', t('superHome.metricDepartments'))}
      ${metricCardHtml(isPastoralTeam ? 'cases' : null, openCaseCount ?? '—', t('superHome.metricOpenCases'), openCaseCount > 0)}
      ${metricCardHtml('pending', pendingCount ?? '—', t('superHome.metricPending'), pendingCount > 0)}
    </div>
  `;

  container.querySelectorAll('[data-action]').forEach((card) => {
    card.addEventListener('click', () => {
      if (card.dataset.action === 'directory') currentDirectoryModal?.open();
      else if (card.dataset.action === 'cases') currentMemberCaseModal?.open();
      else if (card.dataset.action === 'pending') document.querySelector('#super-home-pending')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

function metricCardHtml(action, value, label, highlight = false) {
  const clickable = !!action;
  const tag = clickable ? 'button' : 'div';
  const typeAttr = clickable ? 'type="button"' : '';
  const actionAttr = clickable ? `data-action="${action}"` : '';
  const clickableClasses = clickable ? 'hover:border-indigo-200 hover:-translate-y-0.5 cursor-pointer' : '';
  return `
    <${tag} ${typeAttr} ${actionAttr}
        class="bg-white border border-slate-100 rounded-xl p-3.5 sm:p-4 text-left w-full transition-all ${highlight ? 'ring-2 ring-amber-400' : ''} ${clickableClasses}">
      <div class="text-[22px] font-extrabold text-slate-900 tabular-nums tracking-tight leading-none">${value}</div>
      <div class="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mt-1.5">${label}</div>
    </${tag}>
  `;
}

function createDepartmentReportsModal({ supabase }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${t('superHome.reportsTitle')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <div data-el="body"></div>
    </div>
  `;
  document.body.appendChild(root);

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });

  function open() {
    root.classList.remove('hidden');
    root.classList.add('flex');
    renderDepartmentReports(root.querySelector('[data-el="body"]'), supabase);
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  return { open, root };
}

async function renderDepartmentReports(container, supabase) {
  container.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

  const [{ data: departments, error: deptError }, { data: memberships, error: memError }] = await Promise.all([
    supabase.from('departments').select('id, key, name').order('name'),
    supabase.from('department_memberships').select('department_id, role, status, member:profiles!user_id ( full_name )'),
  ]);

  if (deptError || memError) {
    container.innerHTML = `<p class="text-sm text-rose-600">${t('superHome.reportsLoadFailed', { message: (deptError || memError).message })}</p>`;
    return;
  }

  const byDept = new Map();
  (departments || []).forEach((d) => byDept.set(d.id, { ...d, approved: 0, pending: 0, admins: [] }));
  (memberships || []).forEach((m) => {
    const entry = byDept.get(m.department_id);
    if (!entry) return;
    if (m.status === 'approved') {
      entry.approved += 1;
      if ((m.role === 'admin' || m.role === 'secretary') && m.member) entry.admins.push(m.member.full_name);
    } else if (m.status === 'pending') {
      entry.pending += 1;
    }
  });

  container.innerHTML = `
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
          <tr>
            <th class="text-left px-4 py-2">${t('superHome.reportsDepartment')}</th>
            <th class="text-left px-4 py-2">${t('superHome.reportsMembers')}</th>
            <th class="text-left px-4 py-2">${t('superHome.reportsPending')}</th>
            <th class="text-left px-4 py-2">${t('superHome.reportsAdmins')}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${Array.from(byDept.values()).map((d) => `
            <tr>
              <td class="px-4 py-2.5 font-medium text-slate-800 whitespace-nowrap">${departmentLabel(d.key)}</td>
              <td class="px-4 py-2.5">${d.approved}</td>
              <td class="px-4 py-2.5 ${d.pending > 0 ? 'text-amber-600 font-medium' : ''}">${d.pending}</td>
              <td class="px-4 py-2.5 text-slate-600">${d.admins.length > 0 ? escapeHtml(d.admins.join(', ')) : '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
