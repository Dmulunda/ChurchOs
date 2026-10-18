// Dashboard tab entry point for every non-Choir department (both
// "lightweight" ones and the bespoke-scheduling ones — Preaching,
// Media & Tech, Ecodem — which share this same Dashboard, just with a
// different board on their Scheduling tab): a header toolbar (meeting
// controls, roster, department-specific actions), a small stat strip,
// then a grid of the smaller widgets (Today/This Week/Pending
// Approvals) with the bigger feature sections (Headcount, Announcements)
// full-width below them — same visual language as Home (js/superAdminHome.js)
// and its Tools tab, applied here so every department's page follows
// the same card/grid/empty-state conventions instead of a plain stack.
// Reads which department is active from departments.js rather than
// taking a param, since it's invoked from app.js's generic lazyTabs table.
import { getEffectiveSupabase, getActiveDepartment, canPostAnnouncements, isGlobalAnnouncer, getMyDepartments, getGlobalRole } from './departments.js';
import { renderDepartmentApprovals } from './components/departmentApprovals.js';
import { renderAnnouncements } from './components/departmentAnnouncements.js';
import { createUserManagerModal } from './components/userManager.js';
import { createGuestCheckinQrModal } from './components/guestCheckinQrModal.js';
import { renderGuestAttendanceDashboard } from './components/guestAttendanceDashboard.js';
import { renderNextUpcomingWidget } from './components/nextUpcomingWidget.js';
import { renderMyPreachingWidget } from './components/myPreachingWidget.js';
import { renderChurchProgramBoard } from './components/churchProgramBoard.js';
import { createPrayerRequestQueueModal } from './components/prayerRequests.js';
import { ensureAgreementsSigned } from './components/agreementSigningModal.js';
import { renderMeetingControls } from './components/videoMeeting.js';
import { t, departmentLabel, departmentIcon, getLang } from './i18n.js';

export const HEADCOUNT_DEPARTMENT_KEYS = ['ushers', 'welcoming_socialisation', 'ecodem'];
// Matched by displayed label, not the raw departments.name column —
// these are admin-created departments (the Create Department tool
// generates the key from the name, so it's not guaranteed stable/
// predictable) and their label may since have been renamed via
// Customize Menu, which overrides departmentLabel() but doesn't touch
// the underlying name column. A meeting doesn't make sense for
// either: one's a read-only calendar, the other a community info
// board.
const NO_MEETING_DEPARTMENT_NAMES = ['VPD Community', 'Church Calendar'];
const LOCALE_BY_LANG = { en: 'en-US', fr: 'fr-FR' };

export async function renderDeptDashboardTab() {
  const supabase = getEffectiveSupabase();
  const container = document.querySelector('#dept-dashboard-content');
  const active = getActiveDepartment();
  if (!active) return;

  container.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;

  const { data: { user } } = await supabase.auth.getUser();
  await ensureAgreementsSigned({ supabase, userId: user.id, departmentId: active.id });

  const canAdminister = active.role === 'admin' || active.role === 'super_admin';
  // Broader than canAdminister — a department secretary manages
  // day-to-day things (prayer requests, headcounts) without needing
  // full admin rights.
  const canManageDept = canAdminister || active.role === 'secretary';
  const showMeeting = !NO_MEETING_DEPARTMENT_NAMES.includes(departmentLabel(active.key)) && !NO_MEETING_DEPARTMENT_NAMES.includes(active.name);
  const todayFormatted = new Date().toLocaleDateString(LOCALE_BY_LANG[getLang()] || 'en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  container.innerHTML = `
    <div class="flex items-start justify-between flex-wrap gap-3 mb-4">
      <div class="flex items-center gap-2.5">
        <div class="w-9 h-9 rounded-lg flex items-center justify-center text-base shrink-0 bg-indigo-50">${departmentIcon(active.key)}</div>
        <div>
          <h1 class="text-lg sm:text-xl font-bold text-slate-900 leading-tight">${escapeHtml(departmentLabel(active.key))}</h1>
          <div class="text-xs text-slate-400">${escapeHtml(todayFormatted)}</div>
        </div>
      </div>
      <div class="flex items-center gap-2 flex-wrap" data-el="header-actions"></div>
    </div>

    <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4 max-w-xl" data-el="stats"></div>

    <div data-el="my-preaching"></div>

    <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4" data-el="widget-grid"></div>

    <div data-el="full-width" class="space-y-4"></div>
  `;

  const headerActionsEl = container.querySelector('[data-el="header-actions"]');
  const statsEl = container.querySelector('[data-el="stats"]');
  const widgetGridEl = container.querySelector('[data-el="widget-grid"]');
  const fullWidthEl = container.querySelector('[data-el="full-width"]');

  renderStats(statsEl, supabase, active.id);

  if (showMeeting) {
    renderMeetingControls(headerActionsEl, {
      supabase,
      active,
      canAdminister,
      getDisplayName: async () => (await supabase.from('profiles').select('full_name').eq('id', user.id).single()).data?.full_name || '',
      onLinkChanged: () => renderDeptDashboardTab(),
      wrapperClass: 'flex items-center gap-2',
    });
  }

  if (canAdminister) {
    const usersBtn = document.createElement('button');
    usersBtn.type = 'button';
    usersBtn.className = 'px-3 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:border-indigo-200 hover:text-indigo-600 whitespace-nowrap';
    usersBtn.textContent = `👥 ${t('dashboard.manageRoster')}`;
    headerActionsEl.appendChild(usersBtn);
    usersBtn.addEventListener('click', () => {
      createUserManagerModal({
        supabase,
        scope: { type: 'department', departmentId: active.id, departmentKey: active.key },
        currentUserId: user.id,
        title: t('nav.members'),
      }).open();
    });
  }

  // Fund Request (submit + Finance's own review) and the per-department
  // budget board, Reimbursements inbox, and "My Budget" all moved to the
  // centralized Budget page (js/budgetPage.js) -- reachable only by a
  // department admin/secretary or Pastor, with no nav trace at all for
  // anyone else.

  // Guest self-check-in QR -- every approved Welcoming & Socialisation
  // member sees this, not just canAdminister (unlike "Manage Roster"
  // above), since the whole point is that any of them can show/share
  // it at the door.
  if (active.key === 'welcoming_socialisation') {
    const qrBtn = document.createElement('button');
    qrBtn.type = 'button';
    qrBtn.className = 'px-3 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:border-indigo-200 hover:text-indigo-600 whitespace-nowrap';
    qrBtn.textContent = `📱 ${t('guestCheckinQr.showButton')}`;
    headerActionsEl.appendChild(qrBtn);
    const qrModal = createGuestCheckinQrModal();
    qrBtn.addEventListener('click', () => qrModal.open());
  }

  if (active.key === 'intercession' && canManageDept) {
    const prayerRequestsBtn = document.createElement('button');
    prayerRequestsBtn.type = 'button';
    prayerRequestsBtn.className = 'px-3 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:border-indigo-200 hover:text-indigo-600 whitespace-nowrap';
    prayerRequestsBtn.textContent = `🙏 ${t('prayerRequest.queueTitle')}`;
    headerActionsEl.appendChild(prayerRequestsBtn);
    const prayerQueueModal = createPrayerRequestQueueModal({ supabase });
    prayerRequestsBtn.addEventListener('click', () => prayerQueueModal.open());
  }

  // Preaching's own dashboard already lists the whole week including
  // their entry (below); everyone else's dashboard gets this instead,
  // since a preacher or moderator scheduled ad hoc often isn't a
  // Preaching member.
  if (active.key !== 'preaching') {
    renderMyPreachingWidget(container.querySelector('[data-el="my-preaching"]'), { supabase, userId: user.id });
  }

  if (active.key === 'church_program') {
    const churchProgramEl = document.createElement('div');
    fullWidthEl.appendChild(churchProgramEl);
    // Church Bookings (sql/050) are keyed to whichever department the
    // booker administers, not just Church Program's own admins -- so
    // this is every department where THIS person holds 'admin' (a
    // super_admin/global-role holder's synthesized rows all carry
    // that role string, so their whole department list qualifies).
    const myBookableDepartments = getMyDepartments()
      .filter((d) => d.role === 'admin' || d.role === 'super_admin')
      .map((d) => ({ id: d.id, name: d.name }));
    renderChurchProgramBoard(churchProgramEl, {
      supabase, canAdminister, currentUserId: user.id,
      isSuperAdmin: getGlobalRole() === 'super_admin',
      myBookableDepartments,
    });
  } else if (active.key !== 'finance') {
    // Today + This Week render as two cards directly into whatever
    // container they're given -- passing the grid itself means both
    // land as grid cells alongside Pending Approvals below, no extra
    // wrapper needed.
    renderNextUpcomingWidget(widgetGridEl, { supabase, departmentId: active.id, departmentKey: active.key });
  }

  if (canAdminister) {
    const approvalsCard = document.createElement('div');
    approvalsCard.className = 'bg-white rounded-xl border border-slate-100 p-4';
    approvalsCard.innerHTML = `<h2 class="text-[12.5px] font-bold text-slate-900 mb-2.5">⏳ ${t('approvals.title')}</h2><div data-el="list"></div>`;
    widgetGridEl.appendChild(approvalsCard);
    renderDepartmentApprovals(approvalsCard.querySelector('[data-el="list"]'), {
      supabase,
      departmentId: active.id,
      adminUserId: user.id,
    });
  }

  if (active.key === 'welcoming_socialisation') {
    const guestDashboardEl = document.createElement('div');
    fullWidthEl.appendChild(guestDashboardEl);
    renderGuestAttendanceDashboard(guestDashboardEl, { supabase });
  }

  const announcementsCard = document.createElement('div');
  announcementsCard.className = 'bg-white rounded-xl border border-slate-100 p-4';
  fullWidthEl.appendChild(announcementsCard);
  renderAnnouncements(announcementsCard, {
    supabase,
    departmentId: active.id,
    canPost: canPostAnnouncements(active.role),
    isGlobalPoster: isGlobalAnnouncer(active.role),
    canManage: active.role === 'admin' || active.role === 'super_admin',
    currentUserId: user.id,
  });
}

async function renderStats(container, supabase, departmentId) {
  container.innerHTML = [1, 2].map(() => statTileHtml('—', '')).join('');

  const [{ count: memberCount }, { count: pendingCount }] = await Promise.all([
    supabase.from('department_memberships').select('id', { count: 'exact', head: true }).eq('department_id', departmentId).eq('status', 'approved'),
    supabase.from('department_memberships').select('id', { count: 'exact', head: true }).eq('department_id', departmentId).eq('status', 'pending'),
  ]);

  container.innerHTML = [
    statTileHtml(memberCount ?? '—', t('dashboard.statMembers')),
    statTileHtml(pendingCount ?? '—', t('dashboard.statPending')),
  ].join('');
}

function statTileHtml(value, label) {
  return `
    <div class="bg-white border border-slate-100 rounded-xl p-3">
      <div class="text-lg font-extrabold text-slate-900 tabular-nums leading-none">${value}</div>
      <div class="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mt-1">${label}</div>
    </div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
