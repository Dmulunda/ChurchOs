// Pastoral Dashboard — a full page (not a popup, same conversion
// js/siteAdminPage.js/js/pastorMeetingsPage.js already went through)
// consolidating five sections that were previously scattered across
// Tools-menu modals and department dashboards: Prayer Requests,
// Urgent Prayer Cases, Member Cases, Guest Cases, Attendance Check-In.
// Each tab mounts that section's own render function directly (the
// render/modal splits added alongside this file) — same markup, same
// queries, same event handlers as the pre-existing modals, just
// mountable here too.
//
// Tab visibility here is a client-side convenience on top of the real
// server-side RLS enforcement (same defense-in-depth every other page
// in this app already uses) — it mirrors each section's own access
// rule as closely as this client can, but doesn't yet account for
// Church Admin (that flag isn't loaded anywhere client-side yet) --
// a Church Admin with no department-admin role of their own would
// still have the RLS access to a tab but might not see it listed
// here; not a regression, just a known gap to close if that becomes
// a real complaint.
import { t } from './i18n.js';
import { getEffectiveSupabase } from './departments.js';
import { getGlobalRole, getMyDepartments, hasGlobalReach } from './departments.js';
import { renderPrayerRequestQueue } from './components/prayerRequests.js';
import { renderUrgentPrayerCases } from './components/urgentPrayerCases.js';
import { renderMemberCases } from './components/memberCaseManager.js';
import { renderGuestOnboardingHub } from './components/guestOnboardingHub.js';
import { renderAttendanceManager } from './components/attendanceManager.js';
import { renderQuickAttendance } from './components/quickAttendance.js';
import { renderPastorMeetingsTab } from './pastorMeetingsPage.js';
import { renderSilentUserClaims } from './components/silentUserClaims.js';

const PASTORAL_ROLES = ['super_admin', 'pastor_admin', 'church_secretary'];

function isPastoralTeamClient() {
  return hasGlobalReach() && PASTORAL_ROLES.includes(getGlobalRole());
}
function isAnyDeptAdminClient() {
  return getMyDepartments().some((d) => d.role === 'admin');
}
function isIntercessionLeadClient() {
  return getMyDepartments().some((d) => d.key === 'intercession' && (d.role === 'admin' || d.role === 'secretary'));
}
// Mirrors can_record_attendance() (sql/saas_platform/91/96) as closely
// as this client can, same formula app.js's own canRecordAttendance
// uses.
function canSeeAttendanceClient() {
  return PASTORAL_ROLES.includes(getGlobalRole())
    || getMyDepartments().some((d) => d.key === 'ushers' && (d.role === 'admin' || d.role === 'secretary'))
    || getMyDepartments().some((d) => d.key === 'welcoming_socialisation')
    || isAnyDeptAdminClient();
}

export async function renderPastoralDashboardTab() {
  const supabase = getEffectiveSupabase();
  const container = document.querySelector('#pastoral-dashboard-content');

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    container.innerHTML = `<p class="text-slate-500">${t('scheduling.pleaseSignIn')}</p>`;
    return;
  }
  const currentUserId = user.id;

  const tabs = [
    { key: 'prayer-requests', label: t('pastoralDashboard.tabPrayerRequests'), visible: isPastoralTeamClient() || isIntercessionLeadClient() },
    { key: 'urgent-prayer', label: t('urgentPrayer.title'), visible: isPastoralTeamClient() || isAnyDeptAdminClient() },
    { key: 'member-cases', label: t('memberCase.title'), visible: isPastoralTeamClient() || isAnyDeptAdminClient() },
    { key: 'guest-cases', label: t('guestHub.title'), visible: isPastoralTeamClient() || isAnyDeptAdminClient() },
    { key: 'silent-claims', label: t('silentClaims.tabTitle'), visible: isPastoralTeamClient() || isAnyDeptAdminClient() },
    { key: 'attendance', label: t('attendance.title'), visible: canSeeAttendanceClient() },
    // Every signed-in user can already reach this standalone (it's
    // not gated on the pastoral/department-admin roles the other
    // tabs are), so it's always offered here too.
    { key: 'pastor-meetings', label: t('pastorBooking.navLabel'), visible: true },
  ].filter((tab) => tab.visible);

  if (tabs.length === 0) {
    container.innerHTML = `<p class="text-slate-500">${t('pastoralDashboard.noAccess')}</p>`;
    return;
  }

  container.innerHTML = `
    <div class="flex gap-2 mb-4 border-b border-slate-200 flex-wrap">
      ${tabs.map((tab, i) => `
        <button type="button" data-tab="${tab.key}" class="px-3 py-2 text-sm font-medium border-b-2 ${i === 0 ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}">${tab.label}</button>
      `).join('')}
    </div>
    ${tabs.map((tab, i) => `<div data-panel="${tab.key}" class="${i === 0 ? '' : 'hidden'}"></div>`).join('')}
  `;

  const tabBtns = container.querySelectorAll('[data-tab]');
  const panels = {};
  tabs.forEach((tab) => { panels[tab.key] = container.querySelector(`[data-panel="${tab.key}"]`); });
  const loaded = {};

  tabBtns.forEach((btn) => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

  function switchTab(tab) {
    tabBtns.forEach((btn) => {
      const active = btn.dataset.tab === tab;
      btn.classList.toggle('border-indigo-600', active);
      btn.classList.toggle('text-indigo-600', active);
      btn.classList.toggle('border-transparent', !active);
      btn.classList.toggle('text-slate-500', !active);
    });
    Object.entries(panels).forEach(([key, el]) => el.classList.toggle('hidden', key !== tab));
    if (loaded[tab]) return;
    loaded[tab] = true;
    if (tab === 'prayer-requests') renderPrayerRequestQueue(panels[tab], { supabase });
    if (tab === 'urgent-prayer') renderUrgentPrayerCases(panels[tab], { supabase, currentUserId });
    if (tab === 'member-cases') renderMemberCases(panels[tab], { supabase, currentUserId, scope: { type: 'pastoral' } });
    if (tab === 'guest-cases') renderGuestOnboardingHub(panels[tab], { supabase, currentUserId, scope: { type: 'pastoral' } });
    if (tab === 'silent-claims') renderSilentUserClaims(panels[tab], { supabase });
    if (tab === 'attendance') renderAttendanceSection(panels[tab]);
    if (tab === 'pastor-meetings') renderPastorMeetingsTab(panels[tab]);
  }

  // Quick Attendance (tap-to-check-in, full roster) and the existing
  // search/guest-intake flow both write the same attendance_records
  // table -- this is just two different ways to get there, not two
  // separate permission models.
  function renderAttendanceSection(panelEl) {
    panelEl.innerHTML = `
      <div class="flex gap-2 mb-3">
        <button type="button" data-attendance-mode="quick" class="px-3 py-1.5 rounded-lg text-sm font-medium"></button>
        <button type="button" data-attendance-mode="search" class="px-3 py-1.5 rounded-lg text-sm font-medium"></button>
      </div>
      <div data-el="quick-panel"></div>
      <div data-el="search-panel" class="hidden"></div>
    `;
    const quickBtn = panelEl.querySelector('[data-attendance-mode="quick"]');
    const searchBtn = panelEl.querySelector('[data-attendance-mode="search"]');
    quickBtn.textContent = t('quickAttendance.tabTitle');
    searchBtn.textContent = t('quickAttendance.searchTabTitle');
    const quickPanel = panelEl.querySelector('[data-el="quick-panel"]');
    const searchPanel = panelEl.querySelector('[data-el="search-panel"]');
    const subLoaded = {};

    function setSubMode(subMode) {
      [quickBtn, searchBtn].forEach((btn) => {
        const active = btn.dataset.attendanceMode === subMode;
        btn.classList.toggle('bg-indigo-600', active);
        btn.classList.toggle('text-white', active);
        btn.classList.toggle('bg-slate-100', !active);
        btn.classList.toggle('text-slate-600', !active);
      });
      quickPanel.classList.toggle('hidden', subMode !== 'quick');
      searchPanel.classList.toggle('hidden', subMode !== 'search');
      if (subLoaded[subMode]) return;
      subLoaded[subMode] = true;
      if (subMode === 'quick') renderQuickAttendance(quickPanel, { supabase, currentUserId });
      else renderAttendanceManager(searchPanel, { supabase, currentUserId });
    }

    quickBtn.addEventListener('click', () => setSubMode('quick'));
    searchBtn.addEventListener('click', () => setSubMode('search'));
    setSubMode('quick');
  }

  switchTab(tabs[0].key);
}
