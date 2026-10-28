// Tools tab -- everything that used to live in Home's flat black link
// list, grouped by category instead of one long column. Every button
// here calls one of superAdminHome.js's exported openX() functions,
// which lazily render Home first if it hasn't yet (same guard
// openGuestOnboardingHub already used) so the underlying modal exists
// before .open() is called on it -- no modal is created or torn down
// in this file, it's purely a second set of doorways into the same
// instances Home owns.
import { getGlobalRole } from './departments.js';
import {
  openDirectory, openSilentDirectory, openMemberCases, openPrayerRequests, openPastorMeetings,
  openReports, openLoginActivity, openCreateDepartment, openMenuCustomizer,
  openMessageModeration, openBibleImport, openPeopleImport,
  openGuestOnboardingHub, openAttendanceManager,
} from './superAdminHome.js';
import { t } from './i18n.js';

const PASTORAL_TEAM_ROLES = ['super_admin', 'pastor_admin', 'church_secretary'];

export function renderToolsTab() {
  const container = document.querySelector('#tools-content');
  const role = getGlobalRole();
  const isPastoralTeam = PASTORAL_TEAM_ROLES.includes(role);
  const canSeeMeetings = ['super_admin', 'church_secretary'].includes(role);
  const isSuperAdmin = role === 'super_admin';

  const categories = [
    {
      label: t('tools.catPeopleCare'),
      items: [
        { icon: '👤', color: '#4f46e5', name: t('directory.title'), desc: t('tools.directoryDesc'), onClick: openDirectory },
        { icon: '🤫', color: '#4f46e5', name: t('silentDirectory.title'), desc: t('tools.silentDirectoryDesc'), onClick: openSilentDirectory },
        isPastoralTeam && { icon: '📋', color: '#0369a1', name: t('memberCase.title'), desc: t('tools.casesDesc'), onClick: openMemberCases },
        isPastoralTeam && { icon: '🙌', color: '#059669', name: t('guestHub.title'), desc: t('tools.guestHubDesc'), onClick: openGuestOnboardingHub },
        isPastoralTeam && { icon: '🙏', color: '#7c3aed', name: t('prayerRequest.queueTitle'), desc: t('tools.prayerDesc'), onClick: openPrayerRequests },
        isPastoralTeam && { icon: '📊', color: '#059669', name: t('attendance.title'), desc: t('tools.attendanceDesc'), onClick: openAttendanceManager },
      ].filter(Boolean),
    },
    canSeeMeetings && {
      label: t('tools.catRequests'),
      items: [
        { icon: '⏳', color: '#b45309', name: t('pastorMeeting.queueTitle'), desc: t('tools.pastorMeetingsDesc'), onClick: openPastorMeetings },
      ],
    },
    {
      label: t('tools.catReports'),
      items: [
        { icon: '📈', color: '#0369a1', name: t('superHome.reportsTitle'), desc: t('tools.reportsDesc'), onClick: openReports },
        isSuperAdmin && { icon: '🔑', color: '#0369a1', name: t('loginActivity.title'), desc: t('tools.loginActivityDesc'), onClick: openLoginActivity },
      ].filter(Boolean),
    },
    isSuperAdmin && {
      label: t('tools.catSystem'),
      items: [
        { icon: '🏛️', color: '#334155', name: t('superHome.createDepartmentTitle'), desc: t('tools.createDeptDesc'), onClick: openCreateDepartment },
        { icon: '🧭', color: '#334155', name: t('menuCustomizer.title'), desc: t('tools.menuCustomizerDesc'), onClick: openMenuCustomizer },
        { icon: '🚩', color: '#334155', name: t('messageModeration.title'), desc: t('tools.messageModerationDesc'), onClick: openMessageModeration },
        { icon: '📖', color: '#334155', name: t('bibleImport.title'), desc: t('tools.bibleImportDesc'), onClick: openBibleImport },
        { icon: '📥', color: '#334155', name: t('peopleImport.title'), desc: t('tools.peopleImportDesc'), onClick: openPeopleImport },
      ],
    },
  ].filter(Boolean);

  container.innerHTML = categories.map((cat, catIndex) => `
    <div class="mb-8">
      <h2 class="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-3">${cat.label}</h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        ${cat.items.map((item, itemIndex) => `
          <button type="button" data-cat="${catIndex}" data-item="${itemIndex}"
              class="text-left bg-white border border-slate-100 rounded-xl p-3.5 hover:border-indigo-200 hover:-translate-y-0.5 transition-all flex items-start gap-2.5">
            <div class="w-8 h-8 rounded-lg flex items-center justify-center text-sm shrink-0" style="background:${item.color}18; color:${item.color};">${item.icon}</div>
            <div class="min-w-0">
              <div class="text-[12.3px] font-bold text-slate-900">${escapeHtml(item.name)}</div>
              <div class="text-[10.8px] text-slate-400 mt-0.5 leading-snug">${escapeHtml(item.desc)}</div>
            </div>
          </button>
        `).join('')}
      </div>
    </div>
  `).join('');

  container.querySelectorAll('[data-cat]').forEach((btn) => {
    const cat = categories[Number(btn.dataset.cat)];
    const item = cat.items[Number(btn.dataset.item)];
    btn.addEventListener('click', () => item.onClick());
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
