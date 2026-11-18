// Dashboard tab entry point: department announcements, roster overview,
// and a snapshot of the next upcoming service.
import { getEffectiveSupabase, getActiveDepartment, canPostAnnouncements, isGlobalAnnouncer } from './departments.js';
import { renderDashboard } from './components/dashboardOverview.js';
import { renderAnnouncements } from './components/departmentAnnouncements.js';
import { renderMyPreachingWidget } from './components/myPreachingWidget.js';
import { renderDateHeader } from './components/dateHeader.js';
import { renderMeetingControls } from './components/videoMeeting.js';
import { ensureAgreementsSigned } from './components/agreementSigningModal.js';
import { t } from './i18n.js';

export async function renderDashboardTab() {
  const supabase = getEffectiveSupabase();
  const container = document.querySelector('#dashboard-content');
  const cardClass = 'bg-white rounded-xl shadow p-4 sm:p-6';
  container.innerHTML = `<p class="text-slate-500 ${cardClass}">${t('common.loading')}</p>`;

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    container.innerHTML = `<p class="text-slate-500 ${cardClass}">${t('scheduling.pleaseSignIn')}</p>`;
    return;
  }

  const active = getActiveDepartment();
  // Reached with no department selected (e.g. a direct link to this
  // tab): say what to do instead of crashing.
  if (!active) {
    container.innerHTML = `<p class="text-slate-500 ${cardClass}">${t('dashboard.pickDepartment')}</p>`;
    return;
  }
  await ensureAgreementsSigned({ supabase, userId: user.id, departmentId: active.id });

  container.innerHTML = '';

  const dateHeaderEl = document.createElement('div');
  container.appendChild(dateHeaderEl);
  renderDateHeader(dateHeaderEl);

  renderMeetingControls(container, {
    supabase,
    active,
    canAdminister: active.role === 'admin' || active.role === 'super_admin',
    getDisplayName: async () => (await supabase.from('profiles').select('full_name').eq('id', user.id).single()).data?.full_name || '',
    onLinkChanged: () => renderDashboardTab(),
  });

  const myPreachingEl = document.createElement('div');
  container.appendChild(myPreachingEl);
  renderMyPreachingWidget(myPreachingEl, { supabase, userId: user.id });

  const announcementsCard = document.createElement('div');
  announcementsCard.className = `${cardClass} mb-6`;
  container.appendChild(announcementsCard);
  renderAnnouncements(announcementsCard, {
    supabase,
    departmentId: active.id,
    canPost: canPostAnnouncements(active.role),
    isGlobalPoster: isGlobalAnnouncer(active.role),
    canManage: active.role === 'admin' || active.role === 'super_admin',
    currentUserId: user.id,
  });

  // Fund Request moved to the centralized Budget page (js/budgetPage.js).

  const dashboardEl = document.createElement('div');
  container.appendChild(dashboardEl);
  renderDashboard(dashboardEl, { supabase });
}
