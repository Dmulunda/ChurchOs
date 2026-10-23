// Tab navigation — swaps which panel is visible and highlights the active nav link.
import { supabase } from './supabaseClient.js';
import { initVersionCheck } from './versionCheck.js';
import { renderSchedulingTab } from './scheduling.js';
import { renderSongbookTab } from './songbook.js';
import { renderVoiceExercises } from './components/voiceExercises.js';
import { renderUniformSchedule } from './components/uniformSchedule.js';
import { renderAuthScreen } from './components/authScreen.js';
import { renderPasswordRecovery } from './components/passwordRecovery.js';
import { renderMembersTab } from './members.js';
import { renderDashboardTab } from './dashboard.js';
import { renderDeptDashboardTab, HEADCOUNT_DEPARTMENT_KEYS } from './deptDashboard.js';
import { renderHeadcountTallyTab } from './headcountTallyPage.js';
import { renderDeptProjectionTab, teardownProjectionIfActive } from './deptProjection.js';
import { renderDepartmentSuppliesTab } from './components/departmentSupplies.js';
import { renderEquipmentInventoryTab } from './components/equipmentInventory.js';
import { renderDeptSchedulingTab } from './deptScheduling.js';
import { renderSuperAdminHomeTab, openGuestOnboardingHub, openDirectory } from './superAdminHome.js';
import { createUserManagerModal } from './components/userManager.js';
import { renderToolsTab } from './toolsPage.js';
import { renderTrainingTab } from './training.js';
import { renderServiceProgramTab } from './serviceProgram.js';
import { renderTaxTab } from './taxPage.js';
import { renderEventsTab } from './eventsPage.js';
import { renderFlyersTab } from './flyersPage.js';
import { renderBudgetPageTab } from './budgetPage.js';
import { renderOfferingsPageTab } from './offeringsPage.js';
import { loadSchoolAdminStatus } from './schoolAdmin.js';
import { loadSiteAdminStatus, getIsSiteAdmin } from './siteAdmin.js';
import { loadPlatformOwnerStatus, getIsPlatformOwner } from './platformOwner.js';
import { renderDepartmentApprovals } from './components/departmentApprovals.js';
import { createViewAsPickerModal } from './components/viewAsPicker.js';
import { createReportAbsenceModal } from './components/reportAbsenceModal.js';
import { createJoinDepartmentModal } from './components/joinDepartmentModal.js';
import { createInboxModal } from './components/inboxModal.js';
import { createNotificationsModal } from './components/notificationsModal.js';
import { createRulesModal } from './components/rulesModal.js';
import { createTenantLogoModal } from './components/tenantLogoModal.js';
import { createPlansModal } from './components/plansModal.js';
import { createInviteLinkModal } from './components/inviteLinkModal.js';
import { createChurchAdminManagerModal } from './components/churchAdminManager.js';
import { createMonthlyReportModal } from './components/monthlyReportModal.js';
import { createAttendanceManagerModal } from './components/attendanceManager.js';
import { createAppSuggestionModal } from './components/appSuggestionModal.js';
import { createSupportRequestModal } from './components/supportRequestModal.js';
import { renderSiteAdminTab } from './siteAdminPage.js';
import { renderPastoralDashboardTab } from './pastoralDashboardPage.js';
import { renderOwnerTab } from './ownerPage.js';
import { createGuestOnboardingModal } from './components/guestOnboardingHub.js';
import { createMemberCaseModal } from './components/memberCaseManager.js';
import { renderPastorMeetingsTab } from './pastorMeetingsPage.js';
import { createPrayerRequestModal } from './components/prayerRequests.js';
import { createUrgentPrayerCasesModal } from './components/urgentPrayerCases.js';
import { createChangePasswordModal } from './components/changePasswordModal.js';
import { createMyProfileModal } from './components/myProfileModal.js';
import { createMyLettersModal, createDisciplinaryLettersAdminModal } from './components/disciplinaryLetters.js';
import { createNotificationSettingsModal } from './components/notificationSettingsModal.js';
import { checkSpecialProgramPopup } from './components/specialProgramPopup.js';
import { getLang, setLang, onLangChange, applyStaticTranslations, departmentLabel, departmentIcon, t, loadLabelOverrides, roleLabel } from './i18n.js';
import {
  loadMyDepartments, getMyDepartments, getActiveDepartment, setActiveDepartmentKey,
  getGlobalRole, isViewingAs, getViewAsTarget, startViewAs, stopViewAs, getEffectiveSupabase,
  hasGlobalReach, isActingAsStandardUser, setActingAsStandardUser, isHomeActive, HOME_KEY,
  isPreviewingAsMember, startPreviewAsMember, stopPreviewAsMember, hasAnyDeptLeadership,
  canRecordOfferings, hasFinanceOversight, CORE_DEPARTMENT_KEYS,
} from './departments.js';
import { loadMyTenant, getTenant, getTenantId, getTenantStatus, getTrialDaysLeft, getPendingTrialCharge, isActingAsExtension } from './tenant.js';
import { formatPlanPrice } from './utils/planPresentation.js';
import {
  loadMyDenominationInfo, getMyExtensions, hasMultipleExtensions,
  isGlobalSuperAdminForAnyDenomination, switchActingExtension, getMyDenominationRole,
} from './denominationExtensions.js';
import { loadMyEntitlements, hasFeature } from './entitlements.js';
import { createAssistantModal } from './components/assistantModal.js';
import { registerServiceWorker, setAppBadgeCount } from './pwa.js';
import { getTheme, setTheme, loadAppTheme } from './theme.js';
import { confirmLeaveIfProjecting } from './utils/projectionGuard.js';
import { consumeInteractiveSignIn } from './utils/authIntent.js';

registerServiceWorker();

const tabs = document.querySelectorAll('[data-tab-target]');
const panels = document.querySelectorAll('[data-tab-panel]');
const departmentSwitcherWrapEl = document.querySelector('#department-switcher-wrap');
const departmentSwitcherListEl = document.querySelector('#department-switcher-list');

const deptDashboardNameEl = document.querySelector('[data-el="dept-dashboard-name"]');
const deptSchedulingNameEl = document.querySelector('[data-el="dept-scheduling-name"]');
const comingSoonPanelEl = document.querySelector('#department-coming-soon');
const comingSoonDeptNameEl = comingSoonPanelEl.querySelector('[data-el="dept-name"]');
const comingSoonApprovalsEl = document.querySelector('#department-coming-soon-approvals');
const comingSoonApprovalsListEl = comingSoonApprovalsEl.querySelector('[data-el="approvals-list"]');
const noAccessPanelEl = document.querySelector('#no-department-access');
const inboxBtn = document.querySelector('#inbox-btn');
const helpBtn = document.querySelector('#help-btn');
const tenantLogoImgEl = document.querySelector('#tenant-logo-img');
const tenantLogoPlaceholderEl = document.querySelector('#tenant-logo-placeholder');
const tenantLogoBtnEl = document.querySelector('#tenant-logo-btn');
const extensionSwitcherSelectEl = document.querySelector('#extension-switcher-select');
const actingAsExtensionBannerEl = document.querySelector('#acting-as-extension-banner');
const actingAsExtensionBannerTextEl = actingAsExtensionBannerEl.querySelector('[data-el="text"]');
const actingAsExtensionExitBtn = document.querySelector('#acting-as-extension-exit-btn');

// Sets the header/sidebar org name and logo from the loaded tenant (see
// loadMyTenant() in showApp()). Not data-i18n-driven -- a language switch
// re-runs applyStaticTranslations(), which would otherwise stomp the
// tenant's actual name back to the static "ChurchOnPoint" placeholder
// (app.brand in i18n.js); this is called again from the onLangChange handler below
// specifically to survive that.
function applyTenantBranding() {
  const tenant = getTenant();
  forEachNavGroup('org-name', (el) => { el.textContent = tenant?.name || t('app.brand'); });

  if (tenant?.logo_url) {
    tenantLogoImgEl.src = tenant.logo_url;
    tenantLogoImgEl.classList.remove('hidden');
    tenantLogoPlaceholderEl.classList.add('hidden');
  } else {
    tenantLogoImgEl.classList.add('hidden');
    tenantLogoPlaceholderEl.classList.remove('hidden');
  }
}

// ---- Church Extensions: "Switch Extension" sidebar control + banner ----
// See js/denominationExtensions.js/tenant.js and
// sql/saas_platform/34-36_church_extensions*.sql. Deliberately reload-based
// (not an in-memory refresh like View-As) since acting_as_tenant_id is
// real, persisted DB state re-validated on every server call — a full
// reload just re-runs the app's normal bootstrap against whatever
// current_tenant_id() now resolves to, instead of hand-invalidating
// every cached piece of client state.
function updateExtensionUI() {
  const extensions = getMyExtensions();
  const showSwitcher = hasMultipleExtensions();
  forEachNavGroup('extension-switcher-wrap', (el) => el.classList.toggle('hidden', !showSwitcher));

  if (showSwitcher) {
    extensionSwitcherSelectEl.innerHTML = extensions
      .map((e) => `<option value="${e.tenant_id}" ${e.is_acting_as ? 'selected' : ''}>${escapeHtmlAttr(e.name)}</option>`)
      .join('');
  }

  const acting = isActingAsExtension();
  actingAsExtensionBannerEl.classList.toggle('hidden', !acting);
  actingAsExtensionBannerEl.classList.toggle('flex', acting);
  if (acting) {
    actingAsExtensionBannerTextEl.textContent = t('extensions.actingAsBanner', { name: getTenant()?.name || '' });
  }

  updateRoleBadge();
}

// "Signed in as {name}" role badge -- makes a plain, tenant-only Super
// Admin/Pastor Admin/Church Secretary visually distinct from someone who
// ALSO holds cross-extension reach (Global Super Admin/General Overseer/
// General Secretary) for the current tenant's Central Church. The two
// are shown together (space-separated) when both apply, since a
// denomination_admins role is additional reach layered on top of a
// person's one home role, never a replacement for it.
function updateRoleBadge() {
  const parts = [];
  const homeRole = getGlobalRole();
  if (homeRole) parts.push(roleLabel(homeRole));

  const denomRole = getMyDenominationRole(getTenant()?.denomination_id);
  if (denomRole === 'global_super_admin') parts.push(t('extensions.badgeGlobalSuperAdmin'));
  else if (denomRole === 'general_overseer') parts.push(t('extensions.badgeGeneralOverseer'));
  else if (denomRole === 'general_secretary') parts.push(t('extensions.badgeGeneralSecretary'));

  const text = [...new Set(parts)].join(' · ');
  forEachNavGroup('current-user-role-badge', (el) => {
    el.textContent = text;
    el.classList.toggle('hidden', !text);
  });
}

function escapeHtmlAttr(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML.replaceAll('"', '&quot;');
}

async function refreshAfterExtensionChange() {
  window.location.reload();
}

extensionSwitcherSelectEl.addEventListener('change', async () => {
  const targetTenantId = extensionSwitcherSelectEl.value;
  // Setting acting_as_tenant_id to the caller's own home tenant id
  // behaves identically to clearing it (current_tenant_id() resolves to
  // the same value either way) -- no special-casing needed here.
  const { error } = await switchActingExtension(getEffectiveSupabase(), targetTenantId);
  if (error) {
    window.alert(t('extensions.switchFailed', { message: error.message }));
    updateExtensionUI();
    return;
  }
  await refreshAfterExtensionChange();
});

actingAsExtensionExitBtn.addEventListener('click', async () => {
  const { error } = await switchActingExtension(getEffectiveSupabase(), null);
  if (error) {
    window.alert(t('extensions.switchFailed', { message: error.message }));
    return;
  }
  await refreshAfterExtensionChange();
});

tenantLogoBtnEl.addEventListener('click', () => {
  if ((getGlobalRole() !== 'super_admin' && !isGlobalSuperAdminForAnyDenomination()) || isViewingAs()) return;
  createTenantLogoModal({
    supabase: getEffectiveSupabase(),
    tenantId: getTenantId(),
    userId: currentUserId,
    onSaved: async () => { await loadMyTenant(currentUserId); applyTenantBranding(); },
    onExtensionCreated: refreshAfterExtensionChange,
  }).open();
});

const trialBannerEl = document.querySelector('#trial-banner');
const trialBannerTextEl = trialBannerEl.querySelector('[data-el="trial-banner-text"]');
const TRIAL_BANNER_DISMISS_KEY = 'choir-hub-trial-banner-dismissed-on';

function renderTrialBanner() {
  // Billing/trial status is a super-admin concern only -- other roles
  // have no action to take on it, and Plans & Pricing (reached via this
  // banner's "View Plans" button) is itself super-admin-only.
  if (getGlobalRole() !== 'super_admin') {
    trialBannerEl.classList.add('hidden');
    return;
  }

  const status = getTenantStatus();

  const dismissBtn = trialBannerEl.querySelector('[data-action="dismiss-trial-banner"]');

  if (status === 'trial_expired') {
    // Not dismissible -- unlike the day-to-day countdown nudge, "your
    // trial is over" needs to stay visible until they actually act.
    trialBannerEl.className = 'px-4 py-2 text-sm text-center font-medium bg-rose-100 text-rose-800';
    trialBannerTextEl.textContent = t('trial.expired');
    dismissBtn.classList.add('hidden');
    return;
  }
  dismissBtn.classList.remove('hidden');

  if (status !== 'trial') {
    trialBannerEl.classList.add('hidden');
    return;
  }

  // Dismissal is per calendar day (not "forever") -- a trial ending soon
  // should keep resurfacing, just not on every single click during the
  // same session.
  const today = new Date().toDateString();
  if (localStorage.getItem(TRIAL_BANNER_DISMISS_KEY) === today) {
    trialBannerEl.classList.add('hidden');
    return;
  }

  const daysLeft = getTrialDaysLeft();
  if (daysLeft === null) {
    trialBannerEl.classList.add('hidden');
    return;
  }

  trialBannerEl.className = daysLeft <= 3
    ? 'px-4 py-2 text-sm text-center font-medium bg-amber-100 text-amber-800'
    : 'px-4 py-2 text-sm text-center font-medium bg-indigo-50 text-indigo-800';

  // A card attached during the trial (stripe-billing's trial_end,
  // aligned to this same trial_ends_at) means there's a real charge
  // coming -- say exactly when and how much instead of just nudging
  // them to pick a plan.
  const pendingCharge = getPendingTrialCharge();
  if (pendingCharge) {
    const price = formatPlanPrice(pendingCharge.priceCents, pendingCharge.billingInterval);
    const date = new Date(getTenant().trial_ends_at).toLocaleDateString();
    trialBannerTextEl.textContent = daysLeft === 0
      ? t('trial.lastDayBilled', { price })
      : t('trial.daysLeftBilled', { count: daysLeft, price, date });
  } else {
    trialBannerTextEl.textContent = daysLeft === 0
      ? t('trial.lastDay')
      : daysLeft === 1
        ? t('trial.oneDayLeft')
        : t('trial.daysLeft', { count: daysLeft });
  }
}

trialBannerEl.querySelector('[data-action="dismiss-trial-banner"]').addEventListener('click', () => {
  localStorage.setItem(TRIAL_BANNER_DISMISS_KEY, new Date().toDateString());
  trialBannerEl.classList.add('hidden');
});

// Feature keys gated in the UI, mapped to the tab they guard. The lock
// badge is cosmetic — the actual enforcement is the RESTRICTIVE RLS
// policy on each feature's tables (see sql/saas_platform/08_plans_and_features.sql);
// this only decides what the button looks like and whether clicking it
// opens the tab or an upgrade prompt.
const GATED_TABS = { training: 'vpd_academy', 'dept-projection': 'projection', flyers: 'flyers' };

export function openPlansModal() {
  createPlansModal({
    supabase: getEffectiveSupabase(),
    currentPlanId: getTenant()?.plan_id || null,
    tenantName: getTenant()?.name || '',
    stripeCustomerId: getTenant()?.stripe_customer_id || null,
  }).open();
}

trialBannerEl.querySelector('[data-action="view-plans"]').addEventListener('click', openPlansModal);

// Landing back here after a Stripe Checkout redirect (stripe-billing's
// success_url/cancel_url, js/components/plansModal.js). The actual
// tenants.plan_id/status update happens asynchronously via
// stripe-webhook, which can lag this redirect by a second or two --
// the extra delay before re-loading just gives that a moment to land,
// same tenant.js/entitlements.js loaders showApp() already calls, not
// a full page reload.
async function handleCheckoutReturn(userId) {
  const params = new URLSearchParams(window.location.search);
  const checkout = params.get('checkout');
  if (!checkout) return;

  history.replaceState(null, '', window.location.pathname);
  if (checkout !== 'success') return;

  showToast(t('plans.checkoutSuccess'));
  await new Promise((resolve) => setTimeout(resolve, 2000));
  await loadMyTenant(userId);
  renderTrialBanner();
  await loadMyEntitlements();
  renderEntitlementGates();
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'fixed bottom-4 left-1/2 -translate-x-1/2 z-[200] bg-slate-900 text-white text-sm px-4 py-2.5 rounded-lg shadow-lg';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

export function renderEntitlementGates() {
  for (const [tabName, featureKey] of Object.entries(GATED_TABS)) {
    const locked = !hasFeature(featureKey);
    forEachNavGroup(`${featureKey.replace(/_/g, '-')}-nav`, (el) => {
      el.querySelector('[data-el*="-lock"]')?.classList.toggle('hidden', !locked);
      el.classList.toggle('opacity-60', locked);
    });
  }
  // Projection/Flyers' own nav buttons already use data-nav-group for
  // department-visibility toggling (applyActiveDepartment()), so the
  // name-convention lookup above can't double as their entitlement
  // lock too -- this separate attribute lets a button carry both.
  document.querySelectorAll('[data-entitlement-feature]').forEach((el) => {
    const locked = !hasFeature(el.dataset.entitlementFeature);
    el.querySelector('[data-el*="-lock"]')?.classList.toggle('hidden', !locked);
    el.classList.toggle('opacity-60', locked);
  });
}
const inboxBadgeEl = document.querySelector('#inbox-badge');
const sidebarToolsSelect = document.querySelector('#sidebar-tools-select');
const viewAsBtn = document.querySelector('#view-as-btn');
const viewAsBannerEl = document.querySelector('#view-as-banner');
const viewAsBannerTextEl = viewAsBannerEl.querySelector('[data-el="text"]');
const viewAsExitBtn = document.querySelector('#view-as-exit-btn');
const previewAsMemberBtn = document.querySelector('#preview-as-member-btn');
const signOutBtnDesktop = document.querySelector('#sign-out-btn-desktop');
const accountMenuBtn = document.querySelector('#account-menu-btn');
const accountMenuDialog = document.querySelector('#account-menu-dialog');
const notificationsBtn = document.querySelector('#notifications-btn');
const notificationsBadgeEl = document.querySelector('#notifications-badge');
const headerNewMemberBtn = document.querySelector('#header-new-member-btn');
const quickAccessDialog = document.querySelector('#quick-access-dialog');
const quickAccessListEl = document.querySelector('[data-el="quick-access-list"]');
const loginSplashEl = document.querySelector('#login-splash');

// Tabs whose content is fetched from Supabase on first visit rather than
// baked into the initial page load.
const lazyTabs = {
  dashboard: renderDashboardTab,
  scheduling: renderSchedulingTab,
  songbook: renderSongbookTab,
  'voice-exercises': () => renderVoiceExercises(document.querySelector('#voice-exercises-content')),
  uniform: () => {
    const active = getActiveDepartment();
    if (!active) return;
    renderUniformSchedule(document.querySelector('#uniform-content'), {
      supabase: getEffectiveSupabase(),
      departmentId: active.id,
      canAdminister: active.role === 'admin' || active.role === 'super_admin',
    });
  },
  members: renderMembersTab,
  'dept-dashboard': renderDeptDashboardTab,
  'dept-scheduling': renderDeptSchedulingTab,
  'dept-projection': renderDeptProjectionTab,
  'dept-supplies': renderDepartmentSuppliesTab,
  'dept-equipment': renderEquipmentInventoryTab,
  'headcount-tally': renderHeadcountTallyTab,
  'super-home': renderSuperAdminHomeTab,
  tools: renderToolsTab,
  training: renderTrainingTab,
  'service-program': renderServiceProgramTab,
  tax: renderTaxTab,
  events: renderEventsTab,
  flyers: renderFlyersTab,
  budget: renderBudgetPageTab,
  offerings: renderOfferingsPageTab,
  'pastor-meetings': renderPastorMeetingsTab,
  'site-admin': renderSiteAdminTab,
  'pastoral-dashboard': renderPastoralDashboardTab,
  'owner': renderOwnerTab,
};
let loadedTabs = new Set();
let currentTabName = null;

// Per-tab scroll memory -- the app has no inner scrolling container
// (#app-shell is just min-h-screen; <main> grows with its content), so
// the page itself scrolls and every tab switch used to silently leave
// window.scrollY wherever it was, showing the newly-revealed panel cut
// off partway down instead of from its own top. In-memory map covers
// same-session tab switching instantly; sessionStorage mirror also
// restores it after a reload (pairs with TAB_STORAGE_KEY, which already
// restores which tab a reload lands on -- this restores where on that
// tab too), cleared when the browser tab actually closes since a stale
// scroll offset from days ago isn't worth carrying forever.
const SCROLL_MEMORY_PREFIX = 'choir-hub-scroll-';
const scrollMemory = new Map();

function saveScrollPosition(tabName) {
  if (!tabName) return;
  const y = window.scrollY;
  scrollMemory.set(tabName, y);
  try { sessionStorage.setItem(SCROLL_MEMORY_PREFIX + tabName, String(y)); } catch { /* storage disabled -- in-memory map still covers this session */ }
}

function readScrollPosition(tabName) {
  if (scrollMemory.has(tabName)) return scrollMemory.get(tabName);
  try {
    const raw = sessionStorage.getItem(SCROLL_MEMORY_PREFIX + tabName);
    return raw ? Number(raw) : 0;
  } catch { return 0; }
}

// A freshly-activated tab's content (especially a lazy tab's first
// load) often keeps growing for a few frames as it fetches/renders --
// restoring once immediately would then get silently clamped back to
// whatever the page's shorter height allowed at that instant. Keeps
// re-applying the target scroll position across animation frames until
// the page's height stops changing (or a generous frame cap is hit, so
// a tab that never settles can't loop forever).
function restoreScrollPosition(tabName) {
  const target = readScrollPosition(tabName);
  if (!target) { window.scrollTo(0, 0); return; }
  let attempts = 0;
  let lastHeight = -1;
  const tick = () => {
    window.scrollTo(0, target);
    const height = document.documentElement.scrollHeight;
    attempts += 1;
    if (height !== lastHeight && attempts < 30) {
      lastHeight = height;
      requestAnimationFrame(tick);
    }
  };
  requestAnimationFrame(tick);
}
// Whatever tab was active right before jumping into Site Admin --
// powers that page's own Back button (no top-level tab in this app has
// one otherwise; everything else relies on the global sidebar Home icon).
let siteAdminReturnTab = 'dashboard';
let ownerReturnTab = 'dashboard';
let pastoralDashboardReturnTab = 'dashboard';

// activateTab() only toggles a panel's visibility -- it never unmounts
// or re-renders an already-loaded tab's DOM, so a tab whose data was
// changed from somewhere ELSE (e.g. a Headcount Tally submission
// changing what the Dashboard's headcount history table already
// rendered) stays stale until this is called for it, forcing the next
// visit to actually re-fetch instead of just un-hiding the old DOM.
export function invalidateTabCache(name) {
  loadedTabs.delete(name);
}

// Mirrors departments.js's ACTIVE_DEPT_STORAGE_KEY pattern -- lets a page
// refresh land back on the tab the user was actually viewing instead of
// always resetting to the department's default tab (see showApp() and
// applyActiveDepartment()'s no-active-department branch).
const TAB_STORAGE_KEY = 'choir-hub-last-tab';

// Each department remembers its OWN last-viewed tab separately (e.g.
// Media & Tech -> Projection, Ushers -> Dashboard) -- switching to a
// different department and back restores exactly where you left off
// in it, rather than always landing on that department's default
// Dashboard the way the TAB_KIND_MAP "same kind of page" logic alone
// would. Consulted with priority over that logic in
// applyActiveDepartment() below. Persisted so this survives a reload
// too, same as TAB_STORAGE_KEY.
const DEPARTMENT_LAST_TAB_KEY = 'choir-hub-dept-last-tab';
let departmentLastTab = {};
try { departmentLastTab = JSON.parse(localStorage.getItem(DEPARTMENT_LAST_TAB_KEY)) || {}; } catch { departmentLastTab = {}; }

// Tabs that belong to whichever department is currently active (as
// opposed to global/standalone pages like Site Admin, or Home/Tools) --
// only these get recorded per-department above.
const DEPARTMENT_RELATIVE_TABS = new Set([
  'dashboard', 'scheduling', 'songbook', 'voice-exercises', 'uniform', 'members',
  'dept-dashboard', 'dept-scheduling', 'dept-projection', 'headcount-tally',
  'dept-supplies', 'dept-equipment',
]);

// Exported so other tab modules can navigate the user elsewhere --
// e.g. eventsPage.js's own "Create Flyer" button switching straight
// to the Flyers tab with that event's details pre-filled.
export function activateTab(name) {
  // Only an actual switch should touch scroll memory -- some call sites
  // re-invoke activateTab() with the tab that's already active (e.g.
  // just to refresh nav highlighting), and yanking the user's current
  // scroll position back to an old remembered spot while they're
  // mid-scroll on that same tab would be jarring, not helpful.
  const isSwitchingTab = name !== currentTabName;
  if (isSwitchingTab && currentTabName) saveScrollPosition(currentTabName);

  currentTabName = name;
  localStorage.setItem(TAB_STORAGE_KEY, name);

  const active = getActiveDepartment();
  if (active && DEPARTMENT_RELATIVE_TABS.has(name)) {
    departmentLastTab[active.key] = name;
    localStorage.setItem(DEPARTMENT_LAST_TAB_KEY, JSON.stringify(departmentLastTab));
  }

  panels.forEach((panel) => {
    panel.classList.toggle('hidden', panel.dataset.tabPanel !== name);
  });

  // Queried fresh rather than using the closed-over `tabs` snapshot from
  // script load -- the Budget nav button (see updateBudgetNavVisibility())
  // is inserted dynamically, after that snapshot was taken, specifically
  // so it can be entirely absent for most viewers rather than just
  // CSS-hidden like every other conditional nav item in this file.
  document.querySelectorAll('[data-tab-target]').forEach((tab) => {
    const isActive = tab.dataset.tabTarget === name;
    tab.classList.toggle('bg-indigo-600', isActive);
    tab.classList.toggle('text-white', isActive);
    tab.classList.toggle('text-slate-300', !isActive);
  });

  if (lazyTabs[name] && !loadedTabs.has(name)) {
    loadedTabs.add(name);
    lazyTabs[name]();
  }

  if (isSwitchingTab) restoreScrollPosition(name);
}

document.querySelector('[data-tab-panel="site-admin"] [data-el="site-admin-back"]')
  ?.addEventListener('click', () => activateTab(siteAdminReturnTab || 'dashboard'));
document.querySelector('[data-tab-panel="pastoral-dashboard"] [data-el="pastoral-dashboard-back"]')
  ?.addEventListener('click', () => activateTab(pastoralDashboardReturnTab || 'dashboard'));
document.querySelector('[data-tab-panel="owner"] [data-el="owner-back"]')
  ?.addEventListener('click', () => activateTab(ownerReturnTab || 'dashboard'));

// Choir and every other department name the "same kind" of page
// differently (dashboard/dept-dashboard, scheduling/dept-scheduling) —
// this maps between them so switching departments lands you back on
// the same kind of page you were already on, instead of always
// resetting to Dashboard. Tabs with no equivalent on the other side
// (Songbook, Voice Exercises, Members) fall back to Dashboard.
const TAB_KIND_MAP = {
  dashboard: { choir: 'dashboard', other: 'dept-dashboard' },
  'dept-dashboard': { choir: 'dashboard', other: 'dept-dashboard' },
  scheduling: { choir: 'scheduling', other: 'dept-scheduling' },
  'dept-scheduling': { choir: 'scheduling', other: 'dept-scheduling' },
  uniform: { choir: 'uniform', other: 'uniform' },
};

// Pages that render the same thing no matter which department is
// active (their lazyTabs entry takes no department argument) -- a
// reload (e.g. versionCheck.js's auto-update reload) that lands here
// via applyActiveDepartment() must restore the exact same tab, not
// fall through to resolveLandingTab()/the Home default the way a
// department-relative tab correctly does. Before this existed, being
// on any of these when a reload fired silently bounced you back to
// Home/Dashboard -- confirmed by a Site Admin testing this exact
// scenario on Main (same bug, identical code shape, both fixed here).
const GLOBAL_STANDALONE_TABS = new Set(['training', 'service-program', 'tax', 'pastor-meetings', 'site-admin', 'owner', 'events', 'flyers', 'pastoral-dashboard']);

function resolveLandingTab(previousTabName, active, isChoir) {
  const mapping = TAB_KIND_MAP[previousTabName];
  if (!mapping) return null;
  const target = isChoir ? mapping.choir : mapping.other;
  // Uniform only actually exists for Choir/Ushers, and Scheduling is
  // hidden for Finance and Church Program — landing on either
  // elsewhere would show a page with no way back to it via the nav.
  if (target === 'uniform' && !(isChoir || active.key === 'ushers')) return null;
  if (target === 'dept-scheduling' && (active.key === 'finance' || active.key === 'church_program')) return null;
  return target;
}

// This department's own remembered last tab (see DEPARTMENT_RELATIVE_TABS
// above), re-validated against the department being landed on RIGHT NOW --
// a tab remembered from before a role/kind change (e.g. losing admin,
// or the department no longer being Choir-kind) must never be trusted
// blindly. Takes priority over resolveLandingTab()'s "same kind of
// page" fallback (see call sites below) since it's more specific:
// Media & Tech -> Projection should come straight back as Projection,
// not get treated as "same kind as wherever you just were".
function rememberedDeptTab(active, isChoir) {
  const tab = departmentLastTab[active.key];
  if (!tab) return null;
  const noScheduling = active.key === 'finance' || active.key === 'church_program';
  switch (tab) {
    case 'dashboard': return isChoir ? tab : null;
    case 'dept-dashboard': return !isChoir ? tab : null;
    case 'scheduling': return isChoir && !noScheduling ? tab : null;
    case 'dept-scheduling': return !isChoir && !noScheduling ? tab : null;
    case 'songbook':
    case 'voice-exercises':
    case 'members': return isChoir ? tab : null;
    case 'uniform': return (isChoir || active.key === 'ushers') ? tab : null;
    case 'dept-projection': return active.key === 'media_tech' && (active.role === 'admin' || active.role === 'super_admin') ? tab : null;
    case 'dept-equipment': return active.key === 'media_tech' ? tab : null;
    case 'dept-supplies': return active.key === 'cleaning' ? tab : null;
    case 'headcount-tally': return HEADCOUNT_DEPARTMENT_KEYS.includes(active.key) ? tab : null;
    default: return null;
  }
}

// Applies a visibility/state rule to every element sharing a given
// data-nav-group value. Most groups now live on a single sidebar
// element (mobile drawer and permanent desktop column are the same
// <aside>), but a few (role-switcher-*, view-as-wrap, current-user-*)
// also have a counterpart inside #account-menu-dialog — this keeps
// both in sync from one call instead of a line per surface.
function forEachNavGroup(name, fn) {
  document.querySelectorAll(`[data-nav-group="${name}"]`).forEach(fn);
}

// The Budget nav button (Finance/Budget module) deliberately isn't
// built-then-CSS-hidden like every other conditional nav item above --
// the spec calls for zero trace for anyone who isn't a department
// admin/secretary or Pastor, so it's only ever constructed and inserted
// into the DOM for hasAnyDeptLeadership() (departments.js), and removed
// again if that ever becomes false mid-session (Standard User Mode,
// View-As). Re-run on every applyActiveDepartment(), same as the
// 'global' nav group right above this call, since department
// leadership can change identity (not just visibility) across those
// mode switches.
const unconditionalNavGroupEl = document.querySelector('#unconditional-nav-group');
let budgetNavBtn = null;
function updateBudgetNavVisibility() {
  if (hasAnyDeptLeadership()) {
    if (!budgetNavBtn) {
      budgetNavBtn = document.createElement('button');
      budgetNavBtn.dataset.tabTarget = 'budget';
      budgetNavBtn.setAttribute('data-i18n', 'nav.budget');
      budgetNavBtn.className = 'w-full text-left px-3 py-2 rounded-lg font-medium transition-colors hover:bg-slate-800';
      budgetNavBtn.textContent = t('nav.budget');
      budgetNavBtn.addEventListener('click', () => {
        activateTab('budget');
        closeSidebar();
      });
      unconditionalNavGroupEl.appendChild(budgetNavBtn);
    }
  } else if (budgetNavBtn) {
    budgetNavBtn.remove();
    budgetNavBtn = null;
  }
}

// Same construct-only-if-visible treatment as Budget above, but gated
// on canRecordOfferings() -- any approved Finance team member
// (admin/secretary/member), not just oversight-level like
// hasFinanceOversight(). Recording day-to-day offerings shouldn't
// require being a Finance admin/secretary; deleting one still does
// (see offeringsBoard.js's own canDeleteOfferings() check).
let offeringsNavBtn = null;
function updateOfferingsNavVisibility() {
  if (canRecordOfferings()) {
    if (!offeringsNavBtn) {
      offeringsNavBtn = document.createElement('button');
      offeringsNavBtn.dataset.tabTarget = 'offerings';
      offeringsNavBtn.setAttribute('data-i18n', 'nav.offerings');
      offeringsNavBtn.className = 'w-full text-left px-3 py-2 rounded-lg font-medium transition-colors hover:bg-slate-800';
      offeringsNavBtn.textContent = t('nav.offerings');
      offeringsNavBtn.addEventListener('click', () => {
        activateTab('offerings');
        closeSidebar();
      });
      unconditionalNavGroupEl.appendChild(offeringsNavBtn);
    }
  } else if (offeringsNavBtn) {
    offeringsNavBtn.remove();
    offeringsNavBtn = null;
  }
}

// ---- Department switcher ----
// Only Choir has real screens today — other departments show a
// placeholder until their own phase ships. The switcher itself only
// ever lists departments the signed-in user actually has approved
// access to (or every department, for a super admin/viewer).
function populateDepartmentSwitcher() {
  const departments = getMyDepartments();
  departmentSwitcherWrapEl.classList.toggle('hidden', departments.length === 0);

  const active = getActiveDepartment();
  const activeKey = active ? active.key : null;

  departmentSwitcherListEl.innerHTML = departments.map((d) => `
    <button type="button" data-dept-key="${d.key}"
        class="w-full text-left px-2 py-1.5 rounded-lg text-[12.8px] font-medium transition-colors flex items-center gap-2.5 ${
          d.key === activeKey ? 'bg-[#2a2d3d] text-white' : 'text-slate-300 hover:bg-[#1e2130] hover:text-white'
        }">
      <span class="w-[18px] text-center shrink-0">${departmentIcon(d.key)}</span>
      <span class="truncate">${departmentLabel(d.key)}</span>
    </button>
  `).join('');
}

departmentSwitcherListEl.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-dept-key]');
  if (btn) handleDepartmentSwitch(btn.dataset.deptKey);
});

function applyActiveDepartment() {
  const active = getActiveDepartment();
  // Captured before any activateTab() call below overwrites it — this
  // is genuinely "the tab we were on a moment ago," used to land back
  // on the same kind of page after a department switch.
  const previousTabName = currentTabName;

  // Unconditional, independent of which tab we're landing on — the
  // projection panel's own teardown (deptDashboard.js) only runs when
  // the dept-dashboard tab itself re-renders, which doesn't happen if
  // you're leaving Media & Tech from its Scheduling tab (TAB_KIND_MAP
  // lands you on the new department's Scheduling tab instead). Without
  // this, the "leave anyway?" guard could stay armed and fire on a
  // later switch away from a completely unrelated department.
  if (active?.key !== 'media_tech') teardownProjectionIfActive();

  // hasGlobalReach() (not the active department's role) drives this,
  // since active is intentionally null while on the Home console —
  // Home itself lives inside this same nav group.
  forEachNavGroup('global', (el) => el.classList.toggle('hidden', !hasGlobalReach()));
  updateBudgetNavVisibility();
  updateOfferingsNavVisibility();
  updateSidebarToolsSelect();

  if (!active) {
    if (isHomeActive()) {
      noAccessPanelEl.classList.add('hidden');
      forEachNavGroup('choir', (el) => el.classList.add('hidden'));
      forEachNavGroup('lightweight', (el) => el.classList.add('hidden'));
      forEachNavGroup('members-nav', (el) => el.classList.add('hidden'));
      comingSoonPanelEl.classList.add('hidden');
      loadedTabs.delete('super-home');
      loadedTabs.delete('tools');
      // Home and Tools are the only two tabs valid with no active
      // department (GLOBAL_ONLY_TARGETS) -- any other stored value here
      // is stale (e.g. a department-scoped tab from before switching to
      // Home) and correctly falls back to the default.
      activateTab(GLOBAL_STANDALONE_TABS.has(previousTabName) ? previousTabName : (previousTabName === 'tools' ? 'tools' : 'super-home'));
      return;
    }

    noAccessPanelEl.classList.remove('hidden');
    forEachNavGroup('choir', (el) => el.classList.add('hidden'));
    forEachNavGroup('lightweight', (el) => el.classList.add('hidden'));
    panels.forEach((panel) => panel.classList.add('hidden'));
    comingSoonPanelEl.classList.add('hidden');
    return;
  }

  noAccessPanelEl.classList.add('hidden');

  const isChoir = active.key === 'choir';
  // Every non-Choir department shares the same Dashboard/Scheduling nav
  // shape — "lightweight" departments (generic shift board) and
  // "custom" ones (Preaching, Media & Tech, Ecodem — each with its own
  // bespoke board component, picked by deptScheduling.js) alike, so
  // every department gets Scheduling except Finance and Church Program
  // (sql/065 — its content is all on Dashboard, there's no shift/duty
  // concept to schedule), which explicitly hide just that one tab below.
  const isDeptDashboardKind = active.kind === 'lightweight' || active.kind === 'custom';
  const hasNoScheduling = active.key === 'finance' || active.key === 'church_program';
  forEachNavGroup('choir', (el) => el.classList.toggle('hidden', !isChoir));
  forEachNavGroup('lightweight', (el) => el.classList.toggle('hidden', !isDeptDashboardKind));
  forEachNavGroup('members-nav', (el) => el.classList.toggle('hidden', !isChoir || !(active.role === 'admin' || active.role === 'super_admin')));
  forEachNavGroup('dept-scheduling-nav', (el) => el.classList.toggle('hidden', isDeptDashboardKind && hasNoScheduling));
  // Uniform: Choir always has its own button in choir-nav-group: this
  // one (in the shared lightweight nav) is only for Ushers.
  forEachNavGroup('uniform-nav', (el) => el.classList.toggle('hidden', !(isDeptDashboardKind && active.key === 'ushers')));
  // Projection: its own page, Media & Tech only -- and (sql/88) only
  // its admin/super admin can even open it; other Media members still
  // see the rest of the department, just not this tab.
  forEachNavGroup('dept-projection-nav', (el) => el.classList.toggle('hidden', !(isDeptDashboardKind && active.key === 'media_tech' && (active.role === 'admin' || active.role === 'super_admin'))));
  // Equipment inventory: Media & Tech only.
  forEachNavGroup('dept-equipment-nav', (el) => el.classList.toggle('hidden', !(isDeptDashboardKind && active.key === 'media_tech')));
  // Supplies: Cleaning only.
  forEachNavGroup('dept-supplies-nav', (el) => el.classList.toggle('hidden', !(isDeptDashboardKind && active.key === 'cleaning')));
  // Headcount Tally: Ushers/Welcoming & Socialisation/Ecodem, every
  // approved member (not just admin/secretary) -- counting people at
  // the door isn't an admin-only task.
  forEachNavGroup('headcount-tally-nav', (el) => el.classList.toggle('hidden', !(isDeptDashboardKind && HEADCOUNT_DEPARTMENT_KEYS.includes(active.key))));

  if (isChoir) {
    comingSoonPanelEl.classList.add('hidden');
    loadedTabs.delete('uniform');
    activateTab(GLOBAL_STANDALONE_TABS.has(previousTabName) ? previousTabName : (rememberedDeptTab(active, true) || resolveLandingTab(previousTabName, active, true) || 'dashboard'));
  } else if (isDeptDashboardKind) {
    comingSoonPanelEl.classList.add('hidden');
    deptDashboardNameEl.textContent = departmentLabel(active.key);
    deptSchedulingNameEl.textContent = departmentLabel(active.key);
    loadedTabs.delete('uniform');
    // A different department may have been active last time these tab
    // names were used, so force a fresh render rather than trusting the
    // lazy-load cache.
    loadedTabs.delete('dept-dashboard');
    loadedTabs.delete('dept-scheduling');
    loadedTabs.delete('dept-projection');
    loadedTabs.delete('dept-equipment');
    loadedTabs.delete('dept-supplies');
    loadedTabs.delete('headcount-tally');
    activateTab(GLOBAL_STANDALONE_TABS.has(previousTabName) ? previousTabName : (rememberedDeptTab(active, false) || resolveLandingTab(previousTabName, active, false) || 'dept-dashboard'));
  } else {
    // Unreachable today — every department kind ('choir', 'lightweight',
    // 'custom') is handled above; kept as a fallback in case a future
    // department kind ships without dedicated tooling yet.
    currentTabName = null;
    panels.forEach((panel) => panel.classList.add('hidden'));
    comingSoonDeptNameEl.textContent = departmentLabel(active.key);
    comingSoonPanelEl.classList.remove('hidden');

    const canAdminister = active.role === 'admin' || active.role === 'super_admin';
    comingSoonApprovalsEl.classList.toggle('hidden', !canAdminister);
    if (canAdminister) {
      renderDepartmentApprovals(comingSoonApprovalsListEl, {
        supabase,
        departmentId: active.id,
        adminUserId: currentUserId,
      });
    }
  }
}

// Was shared by both a mobile and desktop <select>; the sidebar is a
// single shared element between mobile drawer and desktop column, so
// now there's just one list. No value to revert on cancel the way a
// <select> needed -- nothing visually changes until this actually
// commits, so a cancelled switch just returns without touching state.
export async function handleDepartmentSwitch(nextKey) {
  const active = getActiveDepartment();
  const previousKey = active ? active.key : (isHomeActive() ? HOME_KEY : '');

  if (nextKey !== previousKey && !(await confirmLeaveIfProjecting())) return;

  setActiveDepartmentKey(nextKey);
  applyActiveDepartment();
  populateDepartmentSwitcher();
  updatePreviewAsMemberUI();
  closeSidebar();
}

// ---- Role Switcher: Super Admin Mode vs Standard User Mode ----
function updateRoleSwitcherUI() {
  forEachNavGroup('role-switcher-wrap', (el) => el.classList.toggle('hidden', !getGlobalRole() || isViewingAs()));

  const standard = isActingAsStandardUser();
  forEachNavGroup('role-switcher-admin-btn', (el) => {
    el.classList.toggle('bg-indigo-600', !standard);
    el.classList.toggle('text-white', !standard);
    el.classList.toggle('text-slate-400', standard);
  });
  forEachNavGroup('role-switcher-standard-btn', (el) => {
    el.classList.toggle('bg-indigo-600', standard);
    el.classList.toggle('text-white', standard);
    el.classList.toggle('text-slate-400', !standard);
  });
}

function refreshAfterRoleModeChange() {
  loadedTabs = new Set();
  populateDepartmentSwitcher();
  applyActiveDepartment();
  updateRoleSwitcherUI();
  updateViewAsUI();
  updatePreviewAsMemberUI();
  updateMemberActionsUI();
  refreshInboxBadge();
  refreshNotificationsBadge();
  closeSidebar();
}

forEachNavGroup('role-switcher-admin-btn', (el) => el.addEventListener('click', () => {
  setActingAsStandardUser(false);
  refreshAfterRoleModeChange();
}));

forEachNavGroup('role-switcher-standard-btn', (el) => el.addEventListener('click', () => {
  setActingAsStandardUser(true);
  refreshAfterRoleModeChange();
}));

// ---- Shared banner for View-As / Preview-as-Member ----
// The two are mutually exclusive in practice — View-As is Super-Admin-
// only and only available in Super Admin Mode; Preview-as-Member only
// applies to a literal department admin role, which only surfaces in
// Standard User Mode for a global-role holder (or all the time for a
// regular admin, who never sees View-As at all) — so one banner element
// serving both, keyed off whichever is actually active, is enough.
function updateIdentityBanner() {
  const viewAsTarget = getViewAsTarget();
  const previewing = isPreviewingAsMember();
  const showBanner = !!viewAsTarget || previewing;

  viewAsBannerEl.classList.toggle('hidden', !showBanner);
  viewAsBannerEl.classList.toggle('flex', showBanner);

  if (viewAsTarget) {
    viewAsBannerTextEl.textContent = t('viewAs.banner', { name: viewAsTarget.full_name });
  } else if (previewing) {
    viewAsBannerTextEl.textContent = t('previewAsMember.banner');
  }
}

// ---- Super Admin "View As" mode ----
// getGlobalRole() always reflects the real signed-in user, even while
// isViewingAs() is true, so the entry point itself never disappears
// because of the simulated role — only because view-as is already
// active, or Standard User Mode has stepped out of Super Admin reach.
function updateViewAsUI() {
  const canViewAs = getGlobalRole() === 'super_admin' && !isActingAsStandardUser();
  forEachNavGroup('view-as-wrap', (el) => el.classList.toggle('hidden', !canViewAs || isViewingAs()));
  updateIdentityBanner();
}

function refreshAfterViewAsChange() {
  // The effective Supabase client and the active department both change
  // underneath every tab, so cached tab content can't be trusted — force
  // every tab to re-fetch on next visit, same as a real user switch.
  loadedTabs = new Set();
  populateDepartmentSwitcher();
  applyActiveDepartment();
  updateViewAsUI();
  updatePreviewAsMemberUI();
  updateMemberActionsUI();
  refreshInboxBadge();
  refreshNotificationsBadge();
  closeSidebar();
}

function openViewAsPicker() {
  const modal = createViewAsPickerModal({
    supabase,
    currentUserId,
    onSelect: async (targetUserId, targetFullName) => {
      await startViewAs(targetUserId, targetFullName);
      refreshAfterViewAsChange();
    },
  });
  modal.open();
}

viewAsBtn.addEventListener('click', openViewAsPicker);

viewAsExitBtn.addEventListener('click', () => {
  if (isViewingAs()) stopViewAs();
  if (isPreviewingAsMember()) stopPreviewAsMember();
  refreshAfterViewAsChange();
});

// ---- Department Admin "Preview as Member" ----
// Only offered for a literal department_role of 'admin' — Department
// Secretary is deliberately excluded (announcements-only, no admin
// powers to preview away from), and a global role uses View-As instead.
function updatePreviewAsMemberUI() {
  const active = getActiveDepartment();
  const canPreview = !isPreviewingAsMember() && !isViewingAs() && active?.role === 'admin';
  forEachNavGroup('preview-as-member-wrap', (el) => el.classList.toggle('hidden', !canPreview));
  updateIdentityBanner();
}

function activatePreviewAsMember() {
  startPreviewAsMember();
  refreshAfterViewAsChange();
}

previewAsMemberBtn.addEventListener('click', activatePreviewAsMember);

// ---- Desktop account menu (avatar) ----
// Profile/Change Password/View As/Role mode/Sign out, all in one clear
// centered dialog (same pattern as every other modal in this app, not
// a small anchored dropdown) — reuses runSidebarTool()/
// openViewAsPicker() rather than duplicating what those already do;
// Role Switcher's rows are wired for free by the existing
// forEachNavGroup('role-switcher-admin-btn'/'-standard-btn', ...) calls
// elsewhere, since they share those same data-nav-group values.
function openAccountMenu() {
  accountMenuDialog.classList.remove('hidden');
  accountMenuDialog.classList.add('flex');
}

function closeAccountMenu() {
  accountMenuDialog.classList.add('hidden');
  accountMenuDialog.classList.remove('flex');
}

accountMenuBtn.addEventListener('click', openAccountMenu);
accountMenuDialog.querySelector('[data-action="close-account-menu"]').addEventListener('click', closeAccountMenu);
accountMenuDialog.addEventListener('click', (e) => { if (e.target === accountMenuDialog) closeAccountMenu(); });

accountMenuDialog.addEventListener('click', (e) => {
  const actionBtn = e.target.closest('[data-account-action]');
  if (actionBtn?.dataset.accountAction === 'my-profile') runSidebarTool('my-profile');
  else if (actionBtn?.dataset.accountAction === 'change-password') runSidebarTool('change-password');
  else if (actionBtn?.dataset.accountAction === 'view-as') openViewAsPicker();
  if (actionBtn) closeAccountMenu();
});

notificationsBtn.addEventListener('click', () => {
  const notificationsUserId = getViewAsTarget()?.id || currentUserId;
  const modal = createNotificationsModal({ supabase: getEffectiveSupabase(), currentUserId: notificationsUserId, onRead: refreshNotificationsBadge });
  modal.open();
  closeSidebar();
});

// ---- Quick Access dialog (mobile bottom bar's 3-line icon) ----
// Ported from Main for the same "phone look" -- everything that isn't
// Home/Tools/a department's own nav lives here. Training/Service
// Program/Tax are unconditional (same as their sidebar nav entries);
// Budget/Offerings only appear for department leadership/finance
// oversight (mirrors updateBudgetNavVisibility()/
// updateOfferingsNavVisibility()'s "zero trace" rule -- built fresh
// each time this opens rather than once at load, same reason);
// everything else here only appears while the relevant department is
// active, mirroring each one's own sidebar nav-group gate exactly
// (applyActiveDepartment() above): Dashboard/Scheduling for any
// department, Songbook/Voice Exercises/Uniform for Choir (Uniform for
// Ushers too), Projection for Media & Tech, Headcount Tally for
// Ushers/Welcoming & Socialisation/Ecodem.
const QUICK_ACCESS_ITEMS_CLASS = 'w-full text-left px-3 py-2.5 rounded-lg font-medium text-slate-700 hover:bg-slate-100 flex items-center gap-2.5';
function buildQuickAccessItems() {
  const active = getActiveDepartment();
  const isChoir = active?.key === 'choir';
  const items = [
    { icon: '📖', label: t('nav.serviceProgram'), tab: 'service-program' },
    { icon: '🧾', label: t('nav.tax'), tab: 'tax' },
    { icon: '🎟️', label: t('nav.events'), tab: 'events' },
  ];
  if (canSeePastoralDashboardClient()) items.push({ icon: '🧑‍🤝‍🧑', label: t('sidebar.pastoralDashboard'), tab: 'pastoral-dashboard' });
  // Plan-gated -- a dead-end tile for a feature the tenant's plan
  // doesn't include would be worse than just not offering the shortcut.
  if (hasFeature('vpd_academy')) items.push({ icon: '🎓', label: t('nav.training'), tab: 'training' });
  if (hasFeature('flyers')) items.push({ icon: '🖼️', label: t('nav.flyers'), tab: 'flyers' });
  if (hasAnyDeptLeadership()) items.push({ icon: '💰', label: t('nav.budget'), tab: 'budget' });
  if (canRecordOfferings()) items.push({ icon: '🙏', label: t('nav.offerings'), tab: 'offerings' });
  if (active) {
    items.push({ icon: '📊', label: t('nav.dashboard'), tab: isChoir ? 'dashboard' : 'dept-dashboard' });
    if (!(active.key === 'finance' || active.key === 'church_program')) {
      items.push({ icon: '📅', label: t('nav.scheduling'), tab: isChoir ? 'scheduling' : 'dept-scheduling' });
    }
    if (isChoir) items.push({ icon: '🎵', label: t('nav.songbook'), tab: 'songbook' });
    if (isChoir) items.push({ icon: '🎤', label: t('nav.voiceExercises'), tab: 'voice-exercises' });
    if (isChoir || active.key === 'ushers') items.push({ icon: '🎽', label: t('nav.uniform'), tab: 'uniform' });
    if (active.key === 'media_tech' && hasFeature('projection') && (active.role === 'admin' || active.role === 'super_admin')) items.push({ icon: '🎥', label: t('nav.projection'), tab: 'dept-projection' });
    if (active.key === 'media_tech') items.push({ icon: '🎦', label: t('nav.equipment'), tab: 'dept-equipment' });
    if (active.key === 'cleaning') items.push({ icon: '🧹', label: t('nav.supplies'), tab: 'dept-supplies' });
    if (HEADCOUNT_DEPARTMENT_KEYS.includes(active.key)) items.push({ icon: '🔢', label: t('nav.headcountTally'), tab: 'headcount-tally' });
  }
  return items;
}

function openQuickAccess() {
  quickAccessListEl.innerHTML = buildQuickAccessItems().map((item) => `
    <button type="button" data-quick-access-tab="${item.tab}" class="${QUICK_ACCESS_ITEMS_CLASS}">
      <span class="text-lg">${item.icon}</span> <span>${item.label}</span>
    </button>
  `).join('');
  quickAccessDialog.classList.remove('hidden');
  quickAccessDialog.classList.add('flex');
}

function closeQuickAccess() {
  quickAccessDialog.classList.add('hidden');
  quickAccessDialog.classList.remove('flex');
}

quickAccessDialog.querySelector('[data-action="close-quick-access"]').addEventListener('click', closeQuickAccess);
quickAccessDialog.addEventListener('click', (e) => {
  if (e.target === quickAccessDialog) { closeQuickAccess(); return; }
  const tabBtn = e.target.closest('[data-quick-access-tab]');
  if (tabBtn) {
    activateTab(tabBtn.dataset.quickAccessTab);
    closeQuickAccess();
  }
});

headerNewMemberBtn.addEventListener('click', () => {
  activateTab('super-home');
  openGuestOnboardingHub();
});

// ---- Report Absence / Inbox ----
// Available to anyone with at least one department, independent of
// which one is currently active. Report Absence is hidden during
// View-As (its RPC call would just be blocked by the read-only
// wrapper — hiding it is clearer than showing a control that can't
// succeed); the Inbox (now in the top bar, not this sidebar group)
// stays visible so a Super Admin previewing another user's view sees
// what that user would see — resolved via getViewAsTarget() rather
// than the real currentUserId in both places below, same as every
// other identity-sensitive spot in this file.
const USHER_ATTENDANCE_ROLES = ['super_admin', 'pastor_admin', 'church_secretary'];
// Same set superAdminHome.js gates its Guest Onboarding button on.
const PASTORAL_TEAM_ROLES = ['super_admin', 'pastor_admin', 'church_secretary'];

// Mirrors pastoralDashboardPage.js's own per-tab visibility checks,
// collapsed into "does at least one tab show" -- shared by the sidebar
// Tools entry and the Quick Access tile so both stay in sync. Doesn't
// yet check Church Admin client-side (same documented gap as
// updateSidebarToolsSelect()'s canRecordAttendance above).
function canSeePastoralDashboardClient() {
  return USHER_ATTENDANCE_ROLES.includes(getGlobalRole())
    || getMyDepartments().some((d) => d.role === 'admin')
    || getMyDepartments().some((d) => d.key === 'intercession' && (d.role === 'admin' || d.role === 'secretary'));
}

function updateMemberActionsUI() {
  const hasAccess = getMyDepartments().length > 0;
  inboxBtn.classList.toggle('hidden', !hasAccess);
  // Unlike Messages, Notifications never needed department access — it
  // only ever depended on not being mid-View-As (matches the option's
  // old condition in updateSidebarToolsSelect()).
  notificationsBtn.classList.toggle('hidden', isViewingAs());

  const canOpenGuestHub = PASTORAL_TEAM_ROLES.includes(getGlobalRole());
  headerNewMemberBtn.classList.toggle('hidden', !canOpenGuestHub);
  headerNewMemberBtn.classList.toggle('flex', canOpenGuestHub);
}

// ---- Sidebar tools dropdown ----
// Everything from Church Rules through Monthly Report lives in one
// select instead of a stack of separate buttons — rebuilt from scratch
// on every call since each option has its own visibility rule (some
// need department access, some an elevated role, some an active
// department), and there's no cheap way to diff that into individual
// per-option toggles worth the complexity. Picking an option runs its
// action immediately (see runSidebarTool()) and the select snaps back
// to the placeholder — a one-shot action menu, not a persisted choice.
function updateSidebarToolsSelect() {
  const hasAccess = getMyDepartments().length > 0;
  const active = getActiveDepartment();

  // Mirrors can_record_attendance() (sql/037, widened by
  // sql/saas_platform/91 then 96) — a global role from the pastoral
  // team, an approved admin/secretary in Ushers specifically, ANY
  // approved Welcoming & Socialisation member, or an admin of ANY
  // department (sql/96's "all admins, tenant-wide" widening). Doesn't
  // yet check Church Admin client-side (that flag isn't loaded here) —
  // a Church Admin with no department-admin role of their own would
  // still have the RLS access but miss this sidebar shortcut until
  // Part 6 loads that flag; not a regression, just not caught up yet.
  const canRecordAttendance = USHER_ATTENDANCE_ROLES.includes(getGlobalRole())
    || getMyDepartments().some((d) => d.key === 'ushers' && (d.role === 'admin' || d.role === 'secretary'))
    || getMyDepartments().some((d) => d.key === 'welcoming_socialisation')
    || getMyDepartments().some((d) => d.role === 'admin');

  const options = [{ value: 'church-rules', label: t('sidebar.churchRules') }];
  if (getGlobalRole() === 'super_admin' && !isViewingAs()) options.push({ value: 'plans', label: t('plans.title') });
  if ((getGlobalRole() === 'super_admin' || isGlobalSuperAdminForAnyDenomination()) && !isViewingAs()) options.push({ value: 'church-logo', label: t('sidebar.churchLogo') });
  if (getGlobalRole() === 'super_admin' && !isViewingAs()) options.push({ value: 'invite-link', label: t('invite.title') });
  if (getGlobalRole() === 'super_admin' && !isViewingAs()) options.push({ value: 'manage-church-admins', label: t('sidebar.manageChurchAdmins') });
  if (!isViewingAs()) options.push({ value: 'change-password', label: t('sidebar.changePassword') });
  if (!isViewingAs()) options.push({ value: 'my-profile', label: t('sidebar.myProfile') });
  if (!isViewingAs()) options.push({ value: 'my-letters', label: t('sidebar.myLetters') });
  if (getGlobalRole() === 'pastor_admin' || getGlobalRole() === 'super_admin') {
    options.push({ value: 'disciplinary-letters', label: t('sidebar.disciplinaryLetters') });
  }
  options.push({ value: 'join-department', label: t('sidebar.joinDepartment') });
  options.push({ value: 'pastor-meeting', label: t('sidebar.pastorMeeting') });
  options.push({ value: 'prayer-request', label: t('sidebar.prayerRequest') });
  // Mirrors urgent_prayer_cases' own insert policy (sql/saas_platform/98)
  // as closely as this client can -- same Church-Admin gap noted
  // elsewhere, not loaded client-side yet.
  if (getGlobalRole() === 'super_admin' || getGlobalRole() === 'pastor_admin' || getMyDepartments().some((d) => d.role === 'admin')) {
    options.push({ value: 'urgent-prayer-cases', label: t('sidebar.urgentPrayerCases') });
  }
  if (canRecordAttendance) options.push({ value: 'attendance', label: t('sidebar.attendance') });
  // Everyone can suggest an improvement or contact support — no role
  // gate (sql/049 widened this on purpose; it used to be elevated
  // roles only). Site Admin is the opposite: a platform-wide role
  // that isn't tied to any department/tenant role at all.
  options.push({ value: 'app-suggestion', label: t('sidebar.appSuggestion') });
  options.push({ value: 'support-request', label: t('sidebar.supportRequest') });
  if (getIsSiteAdmin()) options.push({ value: 'site-admin', label: t('sidebar.siteAdmin') });
  if (getIsPlatformOwner()) options.push({ value: 'owner', label: t('sidebar.owner') });
  if (canSeePastoralDashboardClient()) {
    options.push({ value: 'pastoral-dashboard', label: t('sidebar.pastoralDashboard') });
  }
  if (hasAccess) {
    if (!isViewingAs()) options.push({ value: 'report-absence', label: t('sidebar.reportAbsence') });
    if (active) {
      options.push({ value: 'department-rules', label: t('sidebar.departmentRules') });
      options.push({ value: 'monthly-report', label: t('sidebar.monthlyReport') });
      // Whoever currently holds a guest's/member's case can see it —
      // see sql/042 and sql/043's RLS — so any department admin gets
      // these, not just the pastoral team's oversight hubs.
      if (active.role === 'admin' || active.role === 'super_admin') {
        options.push({ value: 'guest-cases', label: t('sidebar.guestCases') });
        options.push({ value: 'member-cases', label: t('sidebar.memberCases') });
      }
    }
  }

  const buildOptionsHtml = (opts) => `<option value="">${t('sidebar.more')}</option>`
    + opts.map((o) => `<option value="${o.value}">${escapeHtmlText(o.label)}</option>`).join('');
  sidebarToolsSelect.innerHTML = buildOptionsHtml(options);
}

function escapeHtmlText(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// First letter of up to the first two words — "Jane Doe" -> "JD",
// "Jane" -> "J", an email address (no space) -> its first letter.
function getInitials(name) {
  if (!name) return '?';
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('');
  return initials.toUpperCase() || '?';
}

function handleToolsSelectChange(selectEl) {
  const value = selectEl.value;
  selectEl.value = '';
  if (value) runSidebarTool(value);
}

sidebarToolsSelect.addEventListener('change', () => handleToolsSelectChange(sidebarToolsSelect));

function runSidebarTool(value) {
  const active = getActiveDepartment();
  const effectiveSupabase = getEffectiveSupabase();

  if (value === 'change-password') {
    createChangePasswordModal({ supabase: effectiveSupabase }).open();
  } else if (value === 'my-profile') {
    createMyProfileModal({ supabase: effectiveSupabase, userId: currentUserId }).open();
  } else if (value === 'my-letters') {
    createMyLettersModal({ supabase: effectiveSupabase, currentUserId }).open();
  } else if (value === 'disciplinary-letters') {
    createDisciplinaryLettersAdminModal({ supabase: effectiveSupabase, currentUserId }).open();
  } else if (value === 'notifications') {
    createNotificationSettingsModal({ supabase: effectiveSupabase, currentUserId }).open();
  } else if (value === 'church-rules') {
    createRulesModal({
      supabase: effectiveSupabase,
      scope: { type: 'church', canAdminister: hasGlobalReach() && getGlobalRole() === 'super_admin' },
      currentUserId,
      title: t('rules.churchTitle'),
    }).open();
  } else if (value === 'plans') {
    openPlansModal();
  } else if (value === 'invite-link') {
    createInviteLinkModal({ supabase: effectiveSupabase, tenantId: getTenantId(), tenantSlug: getTenant()?.slug }).open();
  } else if (value === 'manage-church-admins') {
    createChurchAdminManagerModal({ supabase: effectiveSupabase }).open();
  } else if (value === 'church-logo') {
    createTenantLogoModal({
      supabase: effectiveSupabase,
      tenantId: getTenantId(),
      userId: currentUserId,
      onSaved: async () => { await loadMyTenant(currentUserId); applyTenantBranding(); },
      onExtensionCreated: refreshAfterExtensionChange,
    }).open();
  } else if (value === 'attendance') {
    createAttendanceManagerModal({ supabase: effectiveSupabase, currentUserId }).open();
  } else if (value === 'app-suggestion') {
    createAppSuggestionModal({ supabase: effectiveSupabase, currentUserId }).open();
  } else if (value === 'support-request') {
    createSupportRequestModal({ supabase: effectiveSupabase, currentUserId }).open();
  } else if (value === 'site-admin') {
    siteAdminReturnTab = currentTabName;
    activateTab('site-admin');
  } else if (value === 'pastoral-dashboard') {
    pastoralDashboardReturnTab = currentTabName;
    activateTab('pastoral-dashboard');
  } else if (value === 'owner') {
    ownerReturnTab = currentTabName;
    activateTab('owner');
  } else if (value === 'report-absence') {
    createReportAbsenceModal({ supabase: effectiveSupabase }).open();
  } else if (value === 'join-department') {
    createJoinDepartmentModal({ supabase: effectiveSupabase, currentUserId }).open();
  } else if (value === 'pastor-meeting') {
    // Replaces the old note-only popup entirely -- opens the real
    // scheduling page (js/pastorMeetingsPage.js) instead.
    activateTab('pastor-meetings');
  } else if (value === 'prayer-request') {
    createPrayerRequestModal({ supabase: effectiveSupabase, currentUserId }).open();
  } else if (value === 'urgent-prayer-cases') {
    createUrgentPrayerCasesModal({ supabase: effectiveSupabase, currentUserId }).open();
  } else if (value === 'department-rules' && active) {
    createRulesModal({
      supabase: effectiveSupabase,
      scope: { type: 'department', departmentId: active.id, departmentKey: active.key, canAdminister: active.role === 'admin' || active.role === 'super_admin' },
      currentUserId,
      title: t('rules.departmentTitle', { department: departmentLabel(active.key) }),
    }).open();
  } else if (value === 'monthly-report' && active) {
    createMonthlyReportModal({
      supabase: effectiveSupabase,
      departmentId: active.id,
      departmentKey: active.key,
      canEdit: active.role === 'admin' || active.role === 'super_admin',
      currentUserId,
      title: t('monthlyReport.titleFor', { department: departmentLabel(active.key) }),
    }).open();
  } else if (value === 'guest-cases' && active) {
    createGuestOnboardingModal({
      supabase: effectiveSupabase,
      currentUserId,
      scope: { type: 'department', departmentId: active.id },
    }).open();
  } else if (value === 'member-cases' && active) {
    createMemberCaseModal({
      supabase: effectiveSupabase,
      currentUserId,
      scope: { type: 'department', departmentId: active.id },
    }).open();
  }

  closeSidebar();
}

// Messages' own badge -- unread direct_messages only now (department
// announcements have no read/unread concept, so they're never part of
// this count). Notifications' own badge is the separate
// refreshNotificationsBadge() below -- each icon counts only what it
// actually shows, instead of one shared combined number.
async function refreshInboxBadge() {
  const inboxUserId = getViewAsTarget()?.id || currentUserId;
  if (!inboxUserId) {
    inboxBadgeEl.classList.add('hidden');
    refreshAppBadgeTotal();
    return;
  }

  const { count } = await getEffectiveSupabase()
    .from('direct_messages').select('id', { count: 'exact', head: true }).eq('recipient_id', inboxUserId).is('read_at', null);

  inboxBadgeEl.textContent = count > 9 ? '9+' : String(count || 0);
  inboxBadgeEl.classList.toggle('hidden', !count);
  refreshAppBadgeTotal();
}

// Excludes any type the person has muted from in-app display
// (notification_preferences.in_app = false) -- a type they've turned
// off shouldn't still nag them via the unread count either.
async function refreshNotificationsBadge() {
  const userId = getViewAsTarget()?.id || currentUserId;
  if (!userId) {
    notificationsBadgeEl.classList.add('hidden');
    refreshAppBadgeTotal();
    return;
  }

  const effectiveSupabase = getEffectiveSupabase();
  const { data: muted } = await effectiveSupabase
    .from('notification_preferences').select('notification_type').eq('user_id', userId).eq('in_app', false);
  const mutedTypes = (muted || []).map((m) => m.notification_type);

  let query = effectiveSupabase.from('notifications').select('id', { count: 'exact', head: true }).eq('recipient_id', userId).is('read_at', null);
  if (mutedTypes.length > 0) query = query.not('type', 'in', `(${mutedTypes.join(',')})`);
  const { count } = await query;

  notificationsBadgeEl.textContent = count > 9 ? '9+' : String(count || 0);
  notificationsBadgeEl.classList.toggle('hidden', !count);
  refreshAppBadgeTotal();
}

// The OS-level PWA badge (navigator.setAppBadge) stays a single
// combined total across both icons -- there's no second app-icon
// badge to split it onto the way the in-app header has two.
async function refreshAppBadgeTotal() {
  const inboxCount = inboxBadgeEl.classList.contains('hidden') ? 0 : Number(inboxBadgeEl.textContent.replace('+', '')) || 0;
  const notificationsCount = notificationsBadgeEl.classList.contains('hidden') ? 0 : Number(notificationsBadgeEl.textContent.replace('+', '')) || 0;
  setAppBadgeCount(inboxCount + notificationsCount);
}

inboxBtn.addEventListener('click', () => {
  const inboxUserId = getViewAsTarget()?.id || currentUserId;
  const modal = createInboxModal({ supabase: getEffectiveSupabase(), currentUserId: inboxUserId, onRead: refreshInboxBadge });
  modal.open();
  closeSidebar();
});

helpBtn.addEventListener('click', () => {
  const modal = createAssistantModal({ supabase: getEffectiveSupabase(), currentUserId });
  modal.open();
  closeSidebar();
});

// ---- Language switcher (top bar) ----
document.documentElement.lang = getLang();
applyStaticTranslations();

const topbarLangSelect = document.querySelector('#topbar-lang-select');

function updateLangSelect() {
  topbarLangSelect.value = getLang();
}

topbarLangSelect.addEventListener('change', () => setLang(topbarLangSelect.value));
updateLangSelect();

// ---- Night mode (top bar) ----
const topbarThemeToggle = document.querySelector('#topbar-theme-toggle');
const topbarThemeIconSun = document.querySelector('#topbar-theme-icon-sun');
const topbarThemeIconMoon = document.querySelector('#topbar-theme-icon-moon');

function updateThemeIcon() {
  const isDark = getTheme() === 'dark';
  topbarThemeIconSun.classList.toggle('hidden', isDark);
  topbarThemeIconMoon.classList.toggle('hidden', !isDark);
}

topbarThemeToggle.addEventListener('click', () => {
  setTheme(getTheme() === 'dark' ? 'light' : 'dark');
  updateThemeIcon();
});
updateThemeIcon();

onLangChange(() => {
  document.documentElement.lang = getLang();
  applyStaticTranslations();
  applyTenantBranding();
  updateExtensionUI();
  updateLangSelect();
  renderAuthScreen(authScreenEl, { supabase });
  if (!passwordRecoveryEl.classList.contains('hidden')) {
    renderPasswordRecovery(passwordRecoveryEl, { supabase, onDone: () => supabase.auth.signOut() });
  }
  // The switcher's option labels and any "coming soon" department name
  // are built from t()/departmentLabel() at render time, not data-i18n.
  if (getMyDepartments().length > 0) {
    populateDepartmentSwitcher();
    applyActiveDepartment();
  } else {
    // applyActiveDepartment() (called above when there's at least one
    // department) already refreshes this — this covers the zero-
    // department case, where Church Rules is still on offer.
    updateSidebarToolsSelect();
  }
  updateRoleSwitcherUI();
  updateViewAsUI();
  updatePreviewAsMemberUI();
  // Dynamic tab content is generated with hardcoded strings, not
  // data-i18n attributes, so the visible tab needs a full re-render.
  if (currentTabName && lazyTabs[currentTabName]) lazyTabs[currentTabName]();
});

// Home and Tools both represent "no department active" now that the
// department switcher is a plain list rather than a <select> that used
// to fold a "Home" option into the same control (and, via its change
// handler, the same setActiveDepartmentKey(HOME_KEY) call). Clearing
// it here only re-renders the list's own highlighting
// (populateDepartmentSwitcher()) -- NOT the heavier
// applyActiveDepartment(), which has its own "no active department"
// branch that forces the tab back to super-home and would hijack a
// click on Tools into landing on Home instead.
const GLOBAL_ONLY_TARGETS = ['super-home', 'tools'];

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const gateFeature = GATED_TABS[tab.dataset.tabTarget];
    if (gateFeature && !hasFeature(gateFeature)) {
      if (getGlobalRole() === 'super_admin') {
        openPlansModal();
      } else {
        window.alert(t('plans.askYourAdmin'));
      }
      closeSidebar();
      return;
    }
    if (GLOBAL_ONLY_TARGETS.includes(tab.dataset.tabTarget) && !isHomeActive()) {
      setActiveDepartmentKey(HOME_KEY);
      populateDepartmentSwitcher();
    }
    activateTab(tab.dataset.tabTarget);
    closeSidebar();
  });
});

// ---- Mobile sidebar drawer ----
const sidebar = document.querySelector('#sidebar');
const sidebarBackdrop = document.querySelector('#sidebar-backdrop');
const menuOpenBtn = document.querySelector('#menu-open-btn');
const menuCloseBtn = document.querySelector('#menu-close-btn');

function openSidebar() {
  sidebar.classList.remove('-translate-x-full');
  sidebarBackdrop.classList.remove('hidden');
}

function closeSidebar() {
  sidebar.classList.add('-translate-x-full');
  sidebarBackdrop.classList.add('hidden');
}

menuOpenBtn.addEventListener('click', openSidebar);
menuCloseBtn.addEventListener('click', closeSidebar);
sidebarBackdrop.addEventListener('click', closeSidebar);

// ---- Mobile bottom tab bar ----
// Home/Members reuse real data-tab-target buttons (see the `tabs`
// click handler above), so they already share styling/gating/
// click-handling with the sidebar's own versions. Only Cases/
// Notifications/More need their own wiring here, proxying to the
// exact same actions their sidebar/Tools equivalents already use.
// Directory: a global-reach role (Super Admin/Pastor Admin/Church
// Secretary/etc.) gets the real cross-department Directory (same one
// Tools' own Directory tile opens); everyone else gets the roster for
// whichever department they're currently viewing -- same modal
// deptDashboard.js's own "Manage Roster" button opens, just triggered
// from here too instead of requiring a trip to that tab first.
document.querySelector('[data-mobile-nav="directory"]')?.addEventListener('click', () => {
  if (hasGlobalReach()) {
    openDirectory();
    return;
  }
  const active = getActiveDepartment();
  if (!active) return;
  createUserManagerModal({
    supabase: getEffectiveSupabase(),
    scope: { type: 'department', departmentId: active.id, departmentKey: active.key },
    currentUserId,
    title: t('nav.members'),
  }).open();
});

// Schedule: jumps straight to whichever scheduling tab is correct for
// the active department (Choir's own vs. the shared dept-scheduling
// tab), reusing resolveLandingTab()'s existing Finance/Church Program
// exclusion (those two have no scheduling at all) rather than
// duplicating that check here.
document.querySelector('[data-mobile-nav="schedule"]')?.addEventListener('click', () => {
  const active = getActiveDepartment();
  if (!active) return;
  const isChoir = active.key === 'choir';
  activateTab(resolveLandingTab('scheduling', active, isChoir) || (isChoir ? 'dashboard' : 'dept-dashboard'));
  closeSidebar();
});

document.querySelector('[data-mobile-nav="quick-access"]')?.addEventListener('click', openQuickAccess);

// Settings: the Tools tab, for everyone -- not just global-reach roles
// (unlike the sidebar's own Tools nav entry, which stays admin-only).
document.querySelector('[data-mobile-nav="settings"]')?.addEventListener('click', () => {
  if (!isHomeActive()) {
    setActiveDepartmentKey(HOME_KEY);
    populateDepartmentSwitcher();
  }
  activateTab('tools');
  closeSidebar();
});

// ---- Auth gating ----
const authScreenEl = document.querySelector('#auth-screen');
const appShellEl = document.querySelector('#app-shell');
const passwordRecoveryEl = document.querySelector('#password-recovery-screen');
const trialEndedEl = document.querySelector('#trial-ended-screen');
const forcePasswordEl = document.querySelector('#force-password-screen');
const signOutBtn = document.querySelector('#sign-out-btn');

renderAuthScreen(authScreenEl, { supabase });

let currentUserId = null;
// True from the moment a PASSWORD_RECOVERY event arrives until the member
// either sets a new password or signs out. Guards against the initial
// getSession() check (which sees the same recovery session as a normal
// login) racing the recovery screen and bouncing them into the app.
let isRecovering = false;

function showPasswordRecovery() {
  isRecovering = true;
  authScreenEl.classList.add('hidden');
  appShellEl.classList.add('hidden');
  passwordRecoveryEl.classList.remove('hidden');
  renderPasswordRecovery(passwordRecoveryEl, {
    supabase,
    onDone: () => { isRecovering = false; supabase.auth.signOut(); },
  });
}

// ---- "Still there?" prompt ----
// A session can legitimately stay signed in indefinitely (that's the
// point of persistSession/autoRefreshToken in supabaseClient.js) — this
// is a periodic check-in, not a security timeout: once a week has
// passed since this *device* first signed in, ask whether to keep
// going here or sign out of every device. Tracked per-device via
// localStorage (mirrors i18n.js's pattern), independent of the actual
// Supabase token lifetime, since auto-refresh keeps renewing the token
// itself and would otherwise make "when did this device first sign in"
// impossible to recover from the session object alone.
const SESSION_STARTED_KEY = 'choir-hub-session-started-at';
const SESSION_CHECK_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function markSessionStart() {
  localStorage.setItem(SESSION_STARTED_KEY, String(Date.now()));
}

function checkSessionAge() {
  if (document.querySelector('#stay-connected-prompt')) return;

  const stored = localStorage.getItem(SESSION_STARTED_KEY);
  if (!stored) {
    // No baseline (e.g. this device signed in before this feature
    // existed) — start counting from today rather than never asking.
    markSessionStart();
    return;
  }
  if (Date.now() - Number(stored) >= SESSION_CHECK_AGE_MS) {
    showStayConnectedPrompt();
  }
}

function showStayConnectedPrompt() {
  const root = document.createElement('div');
  root.id = 'stay-connected-prompt';
  root.className = 'fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
      <h2 class="text-lg font-bold mb-2 text-[#0B1F3A]">${t('session.stayConnectedTitle')}</h2>
      <p class="text-sm text-slate-600 mb-6">${t('session.stayConnectedMessage')}</p>
      <div class="flex flex-col gap-2">
        <button type="button" data-action="stay" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">
          ${t('session.stayConnected')}
        </button>
        <button type="button" data-action="signout-all" class="px-4 py-2 rounded-lg text-rose-600 hover:bg-rose-50 font-medium">
          ${t('session.signOutEverywhere')}
        </button>
      </div>
    </div>
  `;
  // Deliberately no backdrop-click-to-dismiss — this needs an explicit
  // answer rather than being able to tap away from it by accident.
  document.body.appendChild(root);

  root.querySelector('[data-action="stay"]').addEventListener('click', () => {
    markSessionStart();
    root.remove();
  });

  root.querySelector('[data-action="signout-all"]').addEventListener('click', async () => {
    localStorage.removeItem(SESSION_STARTED_KEY);
    root.remove();
    await supabase.auth.signOut({ scope: 'global' });
  });
}

// Deep-link support for a shared link/QR code (?open=<tab>&dept=<key>)
// — the Headcount Tally tool's "Share Link" button encodes one of
// these so scanning it, once signed in, lands straight on the right
// department's tool instead of wherever normal landing logic would
// otherwise choose. Only consulted once per page load (the query
// string is stripped from the URL afterward) so a later refresh in
// the same tab doesn't keep re-applying it over whatever the user has
// since navigated to themselves.
async function applyDeepLinkFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const openTab = params.get('open');
  if (!openTab) return;

  const deptKey = params.get('dept');
  if (deptKey && getMyDepartments().some((d) => d.key === deptKey)) {
    await handleDepartmentSwitch(deptKey);
  }
  if (lazyTabs[openTab]) activateTab(openTab);

  history.replaceState(null, '', window.location.pathname + window.location.hash);
}

async function showApp(session, { isFreshSignIn = false } = {}) {
  if (isRecovering) return;

  passwordRecoveryEl.classList.add('hidden');
  authScreenEl.classList.add('hidden');
  appShellEl.classList.remove('hidden');

  // A different user signed in than last time — clear cached tab content
  // so scheduling/songbook re-fetch under the new identity.
  if (currentUserId !== session.user.id) {
    loadedTabs = new Set();
    currentUserId = session.user.id;
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role, removed_at, tenant_id, must_change_password')
    .eq('id', session.user.id)
    .single();

  // Someone a Super Admin removed from the church entirely (see
  // remove_user_from_church in sql/030) keeps their profiles row and
  // Supabase Auth account (avoids cascade-deleting content they authored),
  // but must be blocked from the app itself — this is the client-side
  // half of that gate.
  if (profile?.removed_at) {
    appShellEl.classList.add('hidden');
    window.alert(t('auth.accountRemoved'));
    await supabase.auth.signOut({ scope: 'global' });
    return;
  }

  // A profile with no tenant_id isn't attached to any church — RLS would
  // make every list in the app render silently empty, which is much
  // harder to debug from a support ticket than a clear message up front.
  // Should only happen for a profile the tenant-migration backfill missed,
  // or a signup flow that failed to set tenant_id.
  if (!profile?.tenant_id) {
    appShellEl.classList.add('hidden');
    window.alert(t('auth.noTenant'));
    await supabase.auth.signOut({ scope: 'global' });
    return;
  }

  // An owner-created admin's temporary password (js/ownerPage.js's
  // Create Church form, supabase/functions/owner-create-church) --
  // blocks everything else, including the trial check below, until
  // it's actually changed. Checked this early (right after the two
  // account-sanity checks above) rather than folded into them since
  // it isn't a sign-out condition — just a one-time detour.
  if (profile?.must_change_password) {
    await showForcePasswordChange();
    return;
  }
  forcePasswordEl.classList.add('hidden');
  forcePasswordEl.classList.remove('flex');

  const displayName = profile?.full_name || session.user.email;
  forEachNavGroup('current-user-name', (el) => { el.textContent = displayName; });
  forEachNavGroup('current-user-initials', (el) => { el.textContent = getInitials(displayName); });

  // Loaded before anything that renders a nav/department label, so
  // renames from menuCustomizer.js are in effect on first paint, not
  // just after a re-render.
  await loadLabelOverrides();
  await loadMyTenant(session.user.id);
  await loadMyDenominationInfo(session.user.id);
  renderTrialBanner();
  applyTenantBranding();
  updateExtensionUI();
  await loadMyEntitlements();
  renderEntitlementGates();
  await handleCheckoutReturn(session.user.id);

  // Checked AFTER handleCheckoutReturn() on purpose -- that call
  // re-fetches tenant status when returning from a successful Stripe
  // Checkout (the webhook that actually flips status away from
  // 'trial_expired' can lag the redirect by a second or two), so
  // checking before it would risk trapping someone who just paid on
  // this exact screen.
  if (getTenantStatus() === 'trial_expired') {
    await showTrialEnded();
    return;
  }
  trialEndedEl.classList.add('hidden');
  trialEndedEl.classList.remove('flex');

  await loadAppTheme();
  const deptOptions = { allowedDepartmentKeys: hasFeature('all_departments') ? null : CORE_DEPARTMENT_KEYS };
  await loadMyDepartments(session.user.id, deptOptions);

  // A brand-new church's founding user normally becomes super_admin via
  // claim_tenant_admin() right after signUp() (authScreen.js) -- but that
  // only runs when signUp() returns a session immediately. With email
  // confirmation enabled, there's no session yet at that point, so the
  // claim never happens and this person logs in later with no global_role
  // and no department memberships, landing on the same "ask an admin"
  // dead end as a genuinely pending member. claim_tenant_admin() is safe
  // to call here too -- see sql/saas_platform/03_signup_rpcs.sql, it only
  // ever succeeds once per tenant, for whoever's still role-less.
  if (!getGlobalRole() && getMyDepartments().length === 0) {
    const { error: claimError } = await supabase.rpc('claim_tenant_admin');
    if (!claimError) await loadMyDepartments(session.user.id, deptOptions);
  }

  await loadSchoolAdminStatus(session.user.id);
  await loadSiteAdminStatus();
  await loadPlatformOwnerStatus();

  // A fresh sign-in (not a page-refresh session restore) always resets
  // a global-role holder to Super Admin Mode and their Home console —
  // "upon login" per the routing requirement, not "on every page load."
  // setActingAsStandardUser(false) also calls goHome() internally.
  if (isFreshSignIn && getGlobalRole()) setActingAsStandardUser(false);

  if (isFreshSignIn) markSessionStart(); else checkSessionAge();

  // Seed from the last tab this browser was actually viewing, but only on
  // a fresh page load (currentTabName still at its module-load default) --
  // a later showApp() call in the same session (e.g. after a token
  // refresh) must never clobber a tab the user has since navigated to.
  // resolveLandingTab()'s existing context guards (TAB_KIND_MAP, the
  // uniform/dept-scheduling exclusions) still apply to this value exactly
  // as they do to an in-session department switch, so a stored tab that's
  // invalid for the department being landed on here is never restored.
  if (currentTabName === null) currentTabName = localStorage.getItem(TAB_STORAGE_KEY);

  populateDepartmentSwitcher();
  applyActiveDepartment();
  await applyDeepLinkFromUrl();
  updateRoleSwitcherUI();
  updateViewAsUI();
  updatePreviewAsMemberUI();
  updateMemberActionsUI();
  refreshInboxBadge();
  refreshNotificationsBadge();
  checkSpecialProgramPopup(supabase);
}

// Shown right after a genuine sign-in (not a page reload restoring an
// existing session) — the real app renders underneath in the
// background so the wait doesn't add to actual load time, then the
// overlay fades away to reveal it. Only shown the very first time this
// browser ever signs in (tracked via HAS_WELCOMED_KEY); every sign-in
// after that skips straight to the app with no delay at all.
const SPLASH_MIN_DURATION_MS = 1100;
const HAS_WELCOMED_KEY = 'choir-hub-has-welcomed';

// Full-screen lockout once a tenant's trial has ended with no plan
// assigned (tenants.status = 'trial_expired') -- replaces the app
// shell entirely (same "swap which top-level section is visible"
// pattern as showAuth()/showPasswordRecovery()) rather than just a
// dismissible banner, since every department/tool should be
// unreachable until the owner assigns a plan (owner_set_tenant_plan
// also flips status back to 'active', see sql/saas_platform/87_
// trial_lockout.sql) or the tenant upgrades themselves.
//
// The Platform Owner is deliberately NOT exempted from this screen --
// they explicitly wanted to be able to preview exactly what a locked-
// out user sees, the same way they can preview a plan on their own
// account. So they don't get trapped doing that, this screen embeds
// the Owner panel directly (renderOwnerTab() already accepts an
// arbitrary container, built for exactly this kind of reuse) so they
// can fix their own (or anyone's) trial/plan right here without
// needing a separate escape hatch.
// Same current-password-reverify-then-updateUser() logic as
// changePasswordModal.js (Supabase's updateUser() alone doesn't check
// the current password, so a plain updateUser() here would let
// someone skip straight past "prove you know the temp password" by
// just picking a new one) -- not reused directly since that's a
// dismissible overlay instance and this has to be a permanent,
// non-closeable screen; duplicating this one small block was simpler
// than reshaping that component to support both.
async function showForcePasswordChange() {
  const { data: { user } } = await supabase.auth.getUser();

  forcePasswordEl.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
      <h1 class="text-xl font-bold text-slate-800 mb-2">${t('forcePassword.title')}</h1>
      <p class="text-sm text-slate-600 mb-4">${t('forcePassword.body')}</p>
      <form data-el="form" class="space-y-3">
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('changePassword.current')}</label>
          <input type="password" name="current" required autocomplete="current-password" class="w-full border border-slate-300 rounded-lg px-3 py-2" />
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('changePassword.new')}</label>
          <input type="password" name="new" required minlength="6" autocomplete="new-password" class="w-full border border-slate-300 rounded-lg px-3 py-2" />
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('changePassword.confirm')}</label>
          <input type="password" name="confirm" required minlength="6" autocomplete="new-password" class="w-full border border-slate-300 rounded-lg px-3 py-2" />
        </div>
        <p data-el="status" class="text-sm"></p>
        <button type="submit" data-el="submit-btn" class="w-full py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">${t('forcePassword.action')}</button>
      </form>
    </div>
  `;

  const form = forcePasswordEl.querySelector('[data-el="form"]');
  const statusEl = forcePasswordEl.querySelector('[data-el="status"]');
  const submitBtn = forcePasswordEl.querySelector('[data-el="submit-btn"]');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const currentPassword = form.elements.current.value;
    const newPassword = form.elements.new.value;
    const confirmPassword = form.elements.confirm.value;

    if (newPassword !== confirmPassword) {
      statusEl.className = 'text-sm text-rose-600';
      statusEl.textContent = t('changePassword.mismatch');
      return;
    }

    submitBtn.disabled = true;
    statusEl.className = 'text-sm text-slate-500';
    statusEl.textContent = t('common.loading');

    const { error: verifyError } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword });
    if (verifyError) {
      submitBtn.disabled = false;
      statusEl.className = 'text-sm text-rose-600';
      statusEl.textContent = t('changePassword.currentWrong');
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    if (updateError) {
      submitBtn.disabled = false;
      statusEl.className = 'text-sm text-rose-600';
      statusEl.textContent = t('changePassword.failed', { message: updateError.message });
      return;
    }

    const { error: clearError } = await supabase.rpc('clear_must_change_password');
    submitBtn.disabled = false;
    if (clearError) {
      statusEl.className = 'text-sm text-rose-600';
      statusEl.textContent = t('changePassword.failed', { message: clearError.message });
      return;
    }

    // A fresh showApp() pass, not just hiding this screen in place --
    // everything after this gate in showApp() (trial check, loading
    // departments, etc.) has never run yet for this session.
    await showApp({ user }, { isFreshSignIn: true });
  });

  authScreenEl.classList.add('hidden');
  passwordRecoveryEl.classList.add('hidden');
  trialEndedEl.classList.add('hidden');
  appShellEl.classList.add('hidden');
  forcePasswordEl.classList.remove('hidden');
  forcePasswordEl.classList.add('flex');
}

async function showTrialEnded() {
  await loadPlatformOwnerStatus();
  const tenant = getTenant();
  const isOwner = getIsPlatformOwner();

  trialEndedEl.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full ${isOwner ? 'max-w-4xl' : 'max-w-lg'} p-6 my-8">
      <h1 class="text-xl font-bold text-slate-800 mb-2">${t('trial.endedTitle')}</h1>
      <p class="text-sm text-slate-600 mb-4">${t('trial.endedBody', { church: tenant?.name || '' })}</p>
      <div class="flex items-center gap-3">
        <button type="button" data-action="upgrade" class="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">${t('trial.upgradeNow')}</button>
        <button type="button" data-action="sign-out" class="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">${t('sidebar.signOut')}</button>
      </div>
      ${isOwner ? `
        <div class="border-t border-slate-200 mt-6 pt-6">
          <p class="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-2">${t('trial.ownerPreviewNote')}</p>
          <div id="trial-ended-owner-panel"></div>
        </div>
      ` : ''}
    </div>
  `;
  trialEndedEl.querySelector('[data-action="upgrade"]').addEventListener('click', openPlansModal);
  trialEndedEl.querySelector('[data-action="sign-out"]').addEventListener('click', () => supabase.auth.signOut());
  // A reload, not a live in-place update -- fixing the own tenant's
  // plan/trial from right here crosses the trial_expired status
  // boundary itself, which needs showApp()'s own gate check to re-run
  // from scratch, not just an entitlements refresh.
  if (isOwner) renderOwnerTab(trialEndedEl.querySelector('#trial-ended-owner-panel'), { onOwnTenantChanged: () => window.location.reload() });

  authScreenEl.classList.add('hidden');
  passwordRecoveryEl.classList.add('hidden');
  appShellEl.classList.add('hidden');
  trialEndedEl.classList.remove('hidden');
  trialEndedEl.classList.add('flex');
}

async function showSplashThenApp(session) {
  if (localStorage.getItem(HAS_WELCOMED_KEY)) {
    await showApp(session, { isFreshSignIn: true });
    return;
  }
  localStorage.setItem(HAS_WELCOMED_KEY, '1');

  loginSplashEl.classList.remove('hidden', 'opacity-0');
  loginSplashEl.classList.add('flex');

  await Promise.all([
    showApp(session, { isFreshSignIn: true }),
    new Promise((resolve) => setTimeout(resolve, SPLASH_MIN_DURATION_MS)),
  ]);

  loginSplashEl.classList.add('opacity-0');
  setTimeout(() => {
    loginSplashEl.classList.add('hidden');
    loginSplashEl.classList.remove('flex');
  }, 700);
}

function showAuth() {
  currentUserId = null;
  isRecovering = false;
  stopViewAs();
  localStorage.removeItem(SESSION_STARTED_KEY);
  document.querySelector('#stay-connected-prompt')?.remove();
  passwordRecoveryEl.classList.add('hidden');
  appShellEl.classList.add('hidden');
  trialEndedEl.classList.add('hidden');
  trialEndedEl.classList.remove('flex');
  forcePasswordEl.classList.add('hidden');
  forcePasswordEl.classList.remove('flex');
  authScreenEl.classList.remove('hidden');
  forEachNavGroup('members-nav', (el) => el.classList.add('hidden'));
  departmentSwitcherWrapEl.classList.add('hidden');
  forEachNavGroup('view-as-wrap', (el) => el.classList.add('hidden'));
  viewAsBannerEl.classList.add('hidden');
  forEachNavGroup('preview-as-member-wrap', (el) => el.classList.add('hidden'));
  forEachNavGroup('role-switcher-wrap', (el) => el.classList.add('hidden'));
  inboxBtn.classList.add('hidden');
  inboxBadgeEl.classList.add('hidden');
  notificationsBadgeEl.classList.add('hidden');
  sidebarToolsSelect.innerHTML = '<option value=""></option>';
  headerNewMemberBtn.classList.add('hidden');
  headerNewMemberBtn.classList.remove('flex');
  setAppBadgeCount(0);
}

supabase.auth.getSession().then(({ data: { session }, error }) => {
  if (error) console.error('Supabase session check failed:', error.message);
  if (session) showApp(session); else showAuth();
});

initVersionCheck();

// supabase-js can fire a 'SIGNED_IN' event for reasons that have
// nothing to do with a real, interactive login -- confirmed (via
// console.trace on a live reproduction) that its own internal
// visibilitychange handling re-notifies 'SIGNED_IN' every time this tab
// regains focus, as long as the stored session is still valid. Event
// name alone can't distinguish that from a genuine sign-in, so
// markInteractiveSignIn()/consumeInteractiveSignIn() (js/utils/
// authIntent.js) tag the real ones explicitly instead of guessing from
// firing order -- only a SIGNED_IN that was actually preceded by this
// tab's own signUp()/signInWithPassword() call is ever treated as a
// fresh sign-in (see showApp()'s isFreshSignIn, which resets a
// global-role holder to Home -- exactly what must NOT happen on a
// plain tab switch).
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') {
    showPasswordRecovery();
    return;
  }
  if (!session) {
    showAuth();
    return;
  }
  if (event === 'SIGNED_IN' && consumeInteractiveSignIn()) {
    showSplashThenApp(session);
  } else {
    showApp(session);
  }
});

signOutBtn.addEventListener('click', () => supabase.auth.signOut());
signOutBtnDesktop.addEventListener('click', () => supabase.auth.signOut());
