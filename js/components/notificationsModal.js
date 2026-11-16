// Automatic system alerts -- the bell icon's own feed, separate from
// Messages (js/components/inboxModal.js, for things a person wrote).
// Can't be replied to, matching the feature's own definition. A "⚙"
// button opens notification preferences (push device toggle + which
// types show in-app/email, js/components/notificationSettingsModal.js).
import { openMeetingWindow, navigateMeetingWindow } from './videoMeeting.js';
import { createNotificationSettingsModal } from './notificationSettingsModal.js';
import { t, formatDate } from '../i18n.js';

export function createNotificationsModal({ supabase, currentUserId, onRead }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col">
      <div class="flex items-center justify-between p-6 pb-2">
        <h2 class="text-xl font-bold">${t('notifications.title')}</h2>
        <div class="flex items-center gap-3">
          <button type="button" data-action="settings" class="text-slate-400 hover:text-slate-600 text-lg leading-none" title="${t('notifications.settings')}">⚙</button>
          <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
        </div>
      </div>
      <div data-el="list" class="flex-1 overflow-y-auto px-6 pb-6 space-y-2"></div>
    </div>
  `;
  document.body.appendChild(root);

  const listEl = root.querySelector('[data-el="list"]');
  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  root.querySelector('[data-action="settings"]').addEventListener('click', () => {
    createNotificationSettingsModal({ supabase, currentUserId }).open();
  });

  async function load() {
    listEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const { data, error } = await supabase
      .from('notifications')
      .select('id, type, title, body, created_at, read_at')
      .eq('recipient_id', currentUserId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      listEl.innerHTML = `<p class="text-sm text-rose-600">${t('notifications.loadFailed', { message: error.message })}</p>`;
      return;
    }

    if (data.length === 0) {
      listEl.innerHTML = `<p class="text-sm text-slate-500">${t('notifications.none')}</p>`;
      return;
    }

    listEl.innerHTML = '';
    data.forEach((n) => listEl.appendChild(buildNotificationRow(n)));

    const unreadIds = data.filter((n) => !n.read_at).map((n) => n.id);
    if (unreadIds.length > 0) {
      await supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', unreadIds);
      onRead?.();
    }
  }

  // A call_invite's body is the Jitsi room name (sql/069) rather than
  // free text -- this is the one notification type with a real action
  // instead of just being informational.
  function buildNotificationRow(n) {
    const el = document.createElement('div');
    el.className = `border rounded-lg p-3 ${n.read_at ? 'border-slate-200' : 'border-indigo-300 bg-indigo-50'}`;
    if (n.type === 'call_invite') {
      el.innerHTML = `
        <div class="font-medium text-slate-800">${escapeHtml(n.title)}</div>
        <div class="text-xs text-slate-400 mt-1">${escapeHtml(formatDate(n.created_at))}</div>
        <button type="button" data-action="join-call" class="mt-2 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700">
          ${t('meeting.join')}
        </button>
      `;
      el.querySelector('[data-action="join-call"]').addEventListener('click', async () => {
        const win = openMeetingWindow();
        const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', currentUserId).single();
        navigateMeetingWindow(win, { roomName: n.body, displayName: profile?.full_name || '' });
      });
    } else {
      el.innerHTML = `
        <div class="font-medium text-slate-800">${escapeHtml(n.title)}</div>
        ${n.body ? `<p class="text-sm text-slate-600 mt-1 whitespace-pre-wrap">${escapeHtml(n.body)}</p>` : ''}
        <div class="text-xs text-slate-400 mt-2">${escapeHtml(formatDate(n.created_at))}</div>
      `;
    }
    return el;
  }

  function open() {
    root.classList.remove('hidden');
    root.classList.add('flex');
    load();
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  return { open };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
