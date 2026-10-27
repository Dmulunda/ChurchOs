// Scheduling tab entry point: loads the current user's profile and
// routes to the singer calendar or the admin auto-planner.
import { getEffectiveSupabase, getActiveDepartment, getViewAsTarget } from './departments.js';
import { renderAvailabilityCalendar } from './components/calendar.js';
import { renderChoirBoard } from './components/choirBoard.js';
import { renderReplacementRequests } from './components/replacementRequests.js';
import { renderDepartmentSwitchShortcut } from './components/departmentSwitchShortcut.js';
import { renderUpcomingChurchEvents } from './components/upcomingChurchEvents.js';
import { t } from './i18n.js';

export async function renderSchedulingTab() {
  const supabase = getEffectiveSupabase();
  const container = document.querySelector('#scheduling-content');
  const cardClass = 'bg-white rounded-xl shadow p-4 sm:p-6';
  container.innerHTML = `<p class="text-slate-500 ${cardClass}">${t('common.loading')}</p>`;

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    container.innerHTML = `<p class="text-slate-500 ${cardClass}">${t('scheduling.pleaseSignIn')}</p>`;
    return;
  }

  // supabase.auth.getUser() always resolves to the real signed-in
  // account, even through the View-As read-only wrapper (only
  // .from()/.rpc()/.storage are intercepted, not .auth) — so every
  // read scoped to "me" below has to resolve through the simulated
  // target instead, or View-As would show the admin's own (usually
  // empty) assignments/voice parts rather than the target's.
  const userId = getViewAsTarget()?.id || user.id;

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('voice_parts')
    .eq('id', userId)
    .single();

  if (profileError) {
    container.innerHTML = `<p class="text-rose-600 ${cardClass}">${t('scheduling.failedToLoadProfile', { message: profileError.message })}</p>`;
    return;
  }

  // Choir's admin/member split now comes from the active department
  // context (not a raw profiles.role lookup), so it correctly reflects
  // whoever's being simulated in View-As mode, not just the real
  // signed-in user.
  const activeDept = getActiveDepartment();
  const isChoirAdmin = activeDept?.role === 'admin' || activeDept?.role === 'super_admin';

  container.innerHTML = '';
  const deptSwitchEl = document.createElement('div');
  const churchEventsEl = document.createElement('div');
  const requestsEl = document.createElement('div');
  const replacementEl = document.createElement('div');
  const plannerEl = document.createElement('div');
  plannerEl.className = 'bg-white rounded-xl shadow p-4 sm:p-6';

  container.append(deptSwitchEl, churchEventsEl);
  renderDepartmentSwitchShortcut(deptSwitchEl, { activeKey: 'choir' });
  renderUpcomingChurchEvents(churchEventsEl, { supabase });

  // renderChoirBoard covers both the admin assignment form and everyone's
  // "my assignments" accept/decline — an admin can also be scheduled as
  // a singer, so they need the same response access as any other
  // member; it just sits alongside their admin tools instead of
  // replacing them, same as before.
  container.append(requestsEl, replacementEl);
  renderChoirBoard(requestsEl, { supabase, departmentId: activeDept?.id, canAdminister: isChoirAdmin, userId });
  renderReplacementRequests(replacementEl, { supabase, userId, myVoiceParts: profile.voice_parts });

  if (!isChoirAdmin) {
    container.append(plannerEl);
    renderAvailabilityCalendar(plannerEl, { supabase, userId, departmentId: activeDept?.id });
  }
}
