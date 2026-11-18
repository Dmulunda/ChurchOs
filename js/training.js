// Training tab entry point — a "My Courses" catalog everyone gets, and
// "Manage Courses"/"Approvals" sub-tabs for School Admins (who can also
// take courses themselves, hence sub-tabs rather than an either/or).
import { getEffectiveSupabase } from './departments.js';
import { getIsSchoolAdmin } from './schoolAdmin.js';
import { renderCourseBuilder } from './components/courseBuilder.js';
import { renderCourseCatalog } from './components/courseCatalog.js';
import { renderCourseApprovalQueue } from './components/courseApprovalQueue.js';
import { renderCourseAccessReport } from './components/courseAccessReport.js';
import { t } from './i18n.js';

export async function renderTrainingTab() {
  const supabase = getEffectiveSupabase();
  const container = document.querySelector('#training-content');
  container.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    container.innerHTML = `<p class="text-slate-500">${t('scheduling.pleaseSignIn')}</p>`;
    return;
  }

  const isSchoolAdmin = getIsSchoolAdmin();

  container.innerHTML = isSchoolAdmin ? `
    <div class="flex gap-2 mb-4 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
      <button type="button" data-el="tab-catalog" class="shrink-0 whitespace-nowrap px-3 py-1.5 rounded-lg text-sm font-medium">${t('courses.myCourses')}</button>
      <button type="button" data-el="tab-manage" class="shrink-0 whitespace-nowrap px-3 py-1.5 rounded-lg text-sm font-medium">${t('courses.manageTitle')}</button>
      <button type="button" data-el="tab-approvals" class="shrink-0 whitespace-nowrap px-3 py-1.5 rounded-lg text-sm font-medium">${t('courses.approvalsTab')}</button>
      <button type="button" data-el="tab-access" class="shrink-0 whitespace-nowrap px-3 py-1.5 rounded-lg text-sm font-medium">${t('courses.accessTab')}</button>
    </div>
    <div data-el="body"></div>
  ` : `<div data-el="body"></div>`;

  const bodyEl = container.querySelector('[data-el="body"]');

  if (!isSchoolAdmin) {
    renderCourseCatalog(bodyEl, { supabase, currentUserId: user.id });
    return;
  }

  const tabCatalogBtn = container.querySelector('[data-el="tab-catalog"]');
  const tabManageBtn = container.querySelector('[data-el="tab-manage"]');
  const tabApprovalsBtn = container.querySelector('[data-el="tab-approvals"]');
  const tabAccessBtn = container.querySelector('[data-el="tab-access"]');

  function setTabStyle(btn, active) {
    btn.classList.toggle('bg-indigo-600', active);
    btn.classList.toggle('text-white', active);
    btn.classList.toggle('text-slate-600', !active);
    btn.classList.toggle('hover:bg-slate-100', !active);
  }

  function activate(tab) {
    setTabStyle(tabCatalogBtn, tab === 'catalog');
    setTabStyle(tabManageBtn, tab === 'manage');
    setTabStyle(tabApprovalsBtn, tab === 'approvals');
    setTabStyle(tabAccessBtn, tab === 'access');
    if (tab === 'catalog') renderCourseCatalog(bodyEl, { supabase, currentUserId: user.id });
    else if (tab === 'manage') renderCourseBuilder(bodyEl, { supabase, currentUserId: user.id });
    else if (tab === 'approvals') renderCourseApprovalQueue(bodyEl, { supabase });
    else renderCourseAccessReport(bodyEl, { supabase });
  }

  tabCatalogBtn.addEventListener('click', () => activate('catalog'));
  tabManageBtn.addEventListener('click', () => activate('manage'));
  tabApprovalsBtn.addEventListener('click', () => activate('approvals'));
  tabAccessBtn.addEventListener('click', () => activate('access'));
  activate('catalog');
}
