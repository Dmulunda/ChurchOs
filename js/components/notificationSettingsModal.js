// Notification settings: push on/off for this device (unchanged from
// before), plus which notification types show in-app and/or email the
// person -- sql/saas_platform/78_notification_redesign.sql's new
// notification_preferences table, with nothing to configure before
// this existed. Defaults match today's actual behavior (in_app on,
// email off) so nobody's experience silently changes just because
// this feature shipped.
import { t } from '../i18n.js';
import { isPushSupported, getPushStatus, enablePushNotifications, disablePushNotifications } from '../pushNotifications.js';

// 'announcement' is deliberately excluded -- department announcements
// no longer create notification rows at all (they moved to Messages),
// so there's nothing left to configure for that type going forward.
const PREFERENCE_TYPES = [
  { type: 'shift_assigned', labelKey: 'notifications.type.shiftAssigned' },
  { type: 'absence', labelKey: 'notifications.type.absence' },
  { type: 'replacement_request', labelKey: 'notifications.type.replacementRequest' },
  { type: 'replacement_response', labelKey: 'notifications.type.replacementResponse' },
  { type: 'call_invite', labelKey: 'notifications.type.callInvite' },
  { type: 'disciplinary_letter', labelKey: 'notifications.type.disciplinaryLetter' },
  { type: 'app_suggestion', labelKey: 'notifications.type.appSuggestion' },
  { type: 'suggestion_reply', labelKey: 'notifications.type.suggestionReply' },
  { type: 'support_reply', labelKey: 'notifications.type.supportReply' },
  { type: 'pastor_meeting_booked', labelKey: 'notifications.type.pastorMeetingBooked' },
  { type: 'guest_follow_up_reminder', labelKey: 'notifications.type.guestFollowUpReminder' },
];

export function createNotificationSettingsModal({ supabase, currentUserId }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4 overflow-y-auto';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-md my-8 p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${t('notifications.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <p data-el="status-text" class="text-sm text-slate-600 mb-3"></p>
      <button type="button" data-action="toggle" class="w-full py-2 rounded-lg font-medium disabled:opacity-50 mb-5"></button>

      <h3 class="text-sm font-semibold text-slate-700 mb-1">${t('notifications.preferencesTitle')}</h3>
      <p class="text-xs text-slate-500 mb-3">${t('notifications.preferencesIntro')}</p>
      <div class="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-2 items-center text-sm mb-1">
        <span></span>
        <span class="text-xs font-semibold text-slate-500 text-center">${t('notifications.colInApp')}</span>
        <span class="text-xs font-semibold text-slate-500 text-center">${t('notifications.colEmail')}</span>
      </div>
      <div data-el="preferences-list" class="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-2 items-center text-sm"></div>
    </div>
  `;
  document.body.appendChild(root);

  const statusTextEl = root.querySelector('[data-el="status-text"]');
  const toggleBtn = root.querySelector('[data-action="toggle"]');
  const preferencesListEl = root.querySelector('[data-el="preferences-list"]');

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  toggleBtn.addEventListener('click', handleToggle);

  let status = 'unsupported';

  async function open() {
    root.classList.remove('hidden');
    root.classList.add('flex');
    await Promise.all([refresh(), loadPreferences()]);
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  async function refresh() {
    status = await getPushStatus();
    render();
  }

  function render() {
    if (status === 'unsupported') {
      statusTextEl.textContent = t('notifications.unsupported');
      toggleBtn.classList.add('hidden');
      return;
    }
    toggleBtn.classList.remove('hidden');
    toggleBtn.disabled = false;

    if (status === 'denied') {
      statusTextEl.textContent = t('notifications.denied');
      toggleBtn.classList.add('hidden');
    } else if (status === 'subscribed') {
      statusTextEl.textContent = t('notifications.onThisDevice');
      toggleBtn.textContent = t('notifications.turnOff');
      toggleBtn.className = 'w-full py-2 rounded-lg font-medium bg-slate-200 text-slate-700 hover:bg-slate-300 mb-5';
    } else {
      statusTextEl.textContent = t('notifications.offThisDevice');
      toggleBtn.textContent = t('notifications.turnOn');
      toggleBtn.className = 'w-full py-2 rounded-lg font-medium bg-indigo-600 text-white hover:bg-indigo-700 mb-5';
    }
  }

  async function handleToggle() {
    toggleBtn.disabled = true;
    try {
      if (status === 'subscribed') {
        await disablePushNotifications(supabase);
      } else {
        await enablePushNotifications(supabase, currentUserId);
      }
    } catch (err) {
      if (err.message === 'denied') {
        statusTextEl.textContent = t('notifications.permissionDenied');
      } else {
        statusTextEl.textContent = t('notifications.failed', { message: err.message });
      }
      toggleBtn.disabled = false;
      return;
    }
    await refresh();
  }

  async function loadPreferences() {
    preferencesListEl.innerHTML = `<p class="col-span-3 text-sm text-slate-500">${t('common.loading')}</p>`;

    const { data, error } = await supabase
      .from('notification_preferences')
      .select('notification_type, in_app, email')
      .eq('user_id', currentUserId);

    if (error) {
      preferencesListEl.innerHTML = `<p class="col-span-3 text-sm text-rose-600">${t('notifications.loadFailed', { message: error.message })}</p>`;
      return;
    }

    const byType = new Map((data || []).map((row) => [row.notification_type, row]));

    preferencesListEl.innerHTML = '';
    PREFERENCE_TYPES.forEach(({ type, labelKey }) => {
      const row = byType.get(type) || { in_app: true, email: false };
      const rowEl = document.createElement('div');
      rowEl.className = 'contents';
      rowEl.innerHTML = `
        <span class="text-slate-700">${t(labelKey)}</span>
        <input type="checkbox" data-type="${type}" data-field="in_app" class="justify-self-center" ${row.in_app ? 'checked' : ''} />
        <input type="checkbox" data-type="${type}" data-field="email" class="justify-self-center" ${row.email ? 'checked' : ''} />
      `;
      preferencesListEl.appendChild(rowEl);
    });

    preferencesListEl.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.addEventListener('change', async () => {
        const type = input.dataset.type;
        const existing = byType.get(type) || { in_app: true, email: false };
        const updated = { ...existing, [input.dataset.field]: input.checked };
        byType.set(type, updated);
        input.disabled = true;
        await supabase.from('notification_preferences').upsert({
          user_id: currentUserId,
          notification_type: type,
          in_app: updated.in_app,
          email: updated.email,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,notification_type' });
        input.disabled = false;
      });
    });
  }

  return { open, root };
}
