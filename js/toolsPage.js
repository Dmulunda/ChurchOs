// Tools tab -- everything that used to live in Home's flat black link
// list, grouped by category instead of one long column. Every button
// here calls one of superAdminHome.js's exported openX() functions,
// which lazily render Home first if it hasn't yet (same guard
// openGuestOnboardingHub already used) so the underlying modal exists
// before .open() is called on it -- no modal is created or torn down
// in this file, it's purely a second set of doorways into the same
// instances Home owns.
import { getGlobalRole, getEffectiveSupabase } from './departments.js';
import { createCommunicationHubModal } from './components/communicationHubModal.js';
import {
  openDirectory, openSilentDirectory, openMemberCases, openMemberDirectory, openExitTracking, openPrayerRequests, openPrayerLinkQr, openMemberRegLinkQr, openPastorMeetings,
  openReports, openLoginActivity, openCreateDepartment, openMenuCustomizer,
  openMessageModeration, openBibleImport, openPeopleImport,
  openGuestOnboardingHub, openAttendanceManager,
} from './superAdminHome.js';
import { t } from './i18n.js';

const PASTORAL_TEAM_ROLES = ['super_admin', 'pastor_admin', 'church_secretary'];

// Line icons for the tiles (same 24px stroke style as the menu and the
// bottom bar), looked up by the emoji each tile was defined with so the
// tile list itself stays readable. Unknown emoji fall back to the emoji.
const P = {
  card: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="12" r="2.5"/><path d="M14 10h4M14 14h4"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  scroll: '<path d="M6 3h11v14a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6h3zM6 3v14M10 8h4M10 12h4"/>',
  door: '<path d="M5 21V4a1 1 0 0 1 1-1h9v18M15 3l4 2v16M3 21h18M12 12h.01"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  prayer: '<path d="M12 3c-1 3-4 5-4 9a4 4 0 0 0 8 0c0-4-3-6-4-9zM5 21h14"/>',
  form: '<path d="M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  silent: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6M3 3l18 18"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9zM9 12h6M9 16h4"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  down: '<path d="M3 5l6 6 4-4 8 8M21 9v6h-6"/>',
  hands: '<path d="M7 11V6a2 2 0 0 1 4 0v5M11 9a2 2 0 0 1 4 0v4M15 11a2 2 0 0 1 4 0v3a7 7 0 0 1-7 7h-1a6 6 0 0 1-6-6v-2a2 2 0 0 1 4 0"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  megaphone: '<path d="M3 10v4h4l6 4V6L7 10zM17 9a4 4 0 0 1 0 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8M21 7v6h-6"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3"/>',
  building: '<path d="M3 21h18M5 21V10l7-5 7 5v11M9 21v-6h6v6"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 9"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19V5M8 7h7"/>',
  inbox: '<path d="M3 13l3-8h12l3 8v6H3zM3 13h5l1 3h6l1-3h5"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
};
const EMOJI_ICON = {
  '🪪': 'card', '✉️': 'mail', '🔒': 'lock', '📜': 'scroll', '🚪': 'door', '🗓️': 'calendar', '🙏': 'prayer', '📝': 'form',
  '👤': 'user', '🤫': 'silent', '📋': 'clipboard', '🗂️': 'folder', '📉': 'down', '🙌': 'hands', '🔗': 'link', '📊': 'chart',
  '📣': 'megaphone', '⏳': 'clock', '📈': 'trend', '🔑': 'key', '🏛️': 'building', '🧭': 'compass', '🖼️': 'image', '🚩': 'flag',
  '📖': 'book', '📥': 'inbox', moon: 'moon', sun: 'sun',
};
function tileIcon(icon) {
  const d = P[EMOJI_ICON[icon]];
  return d ? `<svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>` : icon;
}

let commHubModal = null;
function openCommunicationHub() {
  if (!commHubModal) commHubModal = createCommunicationHubModal({ supabase: getEffectiveSupabase() });
  commHubModal.open();
}

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
        isPastoralTeam && { icon: '🗂️', color: '#0369a1', name: t('memberDirectory.title'), desc: t('tools.memberDirectoryDesc'), onClick: openMemberDirectory },
        isPastoralTeam && { icon: '📉', color: '#dc2626', name: t('memberExit.trackingTitle'), desc: t('tools.exitTrackingDesc'), onClick: openExitTracking },
        isPastoralTeam && { icon: '🙌', color: '#059669', name: t('guestHub.title'), desc: t('tools.guestHubDesc'), onClick: openGuestOnboardingHub },
        isPastoralTeam && { icon: '🙏', color: '#7c3aed', name: t('prayerRequest.queueTitle'), desc: t('tools.prayerDesc'), onClick: openPrayerRequests },
        isPastoralTeam && { icon: '🔗', color: '#7c3aed', name: t('prayerRequest.linkTitle'), desc: t('tools.prayerLinkDesc'), onClick: openPrayerLinkQr },
        isPastoralTeam && { icon: '📝', color: '#0369a1', name: t('memberRegistration.linkTitle'), desc: t('tools.memberRegLinkDesc'), onClick: openMemberRegLinkQr },
        isPastoralTeam && { icon: '📊', color: '#059669', name: t('attendance.title'), desc: t('tools.attendanceDesc'), onClick: openAttendanceManager },
        isPastoralTeam && { icon: '📣', color: '#db2777', name: t('commHub.title'), desc: t('commHub.toolsDesc'), onClick: openCommunicationHub, needs: 'broadcasts' },
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
      <h2 class="home-kicker mb-3">${cat.label}</h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        ${cat.items.map((item, itemIndex) => `
          <button type="button" data-cat="${catIndex}" data-item="${itemIndex}"
              class="tool-tile text-left bg-white border border-[#E6E1D6] rounded-2xl p-3.5 hover:border-[#E0B654] transition-all flex items-start gap-3">
            <div class="tool-tile-icon w-9 h-9 rounded-xl flex items-center justify-center shrink-0">${tileIcon(item.icon)}</div>
            <div class="min-w-0">
              <div class="text-[13.5px] font-semibold text-slate-900">${escapeHtml(item.name)}</div>
              <div class="text-[12px] text-slate-500 mt-0.5 leading-snug">${escapeHtml(item.desc)}</div>
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
    // Tiles for new features name the table their SQL migration creates
    // (`needs`); hidden until that migration has been applied.
    if (item.needs) {
      btn.classList.add('hidden');
      getEffectiveSupabase().from(item.needs).select('*', { head: true, count: 'exact' }).limit(1).then(({ error }) => {
        if (!error) btn.classList.remove('hidden');
      });
    }
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
