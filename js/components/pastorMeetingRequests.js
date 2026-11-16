// Pastor meeting requests (sql/067). Two entry points sharing one
// table: createPastorMeetingRequestModal is the member-facing
// self-service form (plus their own request history), opened from the
// sidebar "More" menu; createPastorMeetingQueueModal is the pastoral
// team's (Super Admin/Pastor Admin/Church Secretary) queue of pending
// requests, opened from Super Admin Home. respond_to_pastor_meeting_
// request() (the RPC) is the only way a request actually gets
// confirmed/declined, so confirmed_by/confirmed_at are always the real
// actor and the real server time.
import { t, appLocale } from '../i18n.js';
import { openMeetingWindow, navigateMeetingWindow } from './videoMeeting.js';

export function createPastorMeetingRequestModal({ supabase, currentUserId }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[85vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-2">
        <h2 class="text-xl font-bold">${t('pastorMeeting.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <p class="text-xs text-slate-500 mb-4">${t('pastorMeeting.intro')}</p>
      <form data-el="form" class="space-y-3">
        <textarea name="note" rows="3" placeholder="${t('pastorMeeting.note')}"
                   class="w-full border border-slate-300 rounded-lg px-3 py-2"></textarea>
        <div class="flex items-center gap-3">
          <button type="submit" data-el="submit-btn"
                  class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
            ${t('pastorMeeting.submit')}
          </button>
          <span data-el="form-status" class="text-sm text-slate-500"></span>
        </div>
      </form>
      <div class="mt-6 pt-4 border-t border-slate-200">
        <h3 class="text-sm font-semibold text-slate-600 mb-2">${t('pastorMeeting.myRequests')}</h3>
        <div data-el="history" class="space-y-2"></div>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const form = root.querySelector('[data-el="form"]');
  const formStatusEl = root.querySelector('[data-el="form-status"]');
  const submitBtn = root.querySelector('[data-el="submit-btn"]');
  const historyEl = root.querySelector('[data-el="history"]');

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  form.addEventListener('submit', handleSubmit);

  function open() {
    form.reset();
    formStatusEl.textContent = '';
    root.classList.remove('hidden');
    root.classList.add('flex');
    loadHistory();
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const note = form.elements.note.value.trim() || null;

    submitBtn.disabled = true;
    formStatusEl.className = 'text-sm text-slate-500';
    formStatusEl.textContent = t('common.saving');

    const { error } = await supabase.from('pastor_meeting_requests').insert({ user_id: currentUserId, note });

    submitBtn.disabled = false;
    if (error) {
      formStatusEl.className = 'text-sm text-rose-600';
      formStatusEl.textContent = t('pastorMeeting.submitFailed', { message: error.message });
      return;
    }

    formStatusEl.className = 'text-sm text-emerald-600';
    formStatusEl.textContent = t('pastorMeeting.submitted');
    form.reset();
    loadHistory();
  }

  async function loadHistory() {
    historyEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const { data, error } = await supabase
      .from('pastor_meeting_requests')
      .select('id, note, status, meeting_room, created_at')
      .eq('user_id', currentUserId)
      .order('created_at', { ascending: false });

    if (error) {
      historyEl.innerHTML = `<p class="text-sm text-rose-600">${t('pastorMeeting.loadFailed', { message: error.message })}</p>`;
      return;
    }

    if (!data || data.length === 0) {
      historyEl.innerHTML = `<p class="text-sm text-slate-500">${t('pastorMeeting.noRequests')}</p>`;
      return;
    }

    historyEl.innerHTML = '';
    data.forEach((row) => historyEl.appendChild(buildHistoryRow(row)));
  }

  function buildHistoryRow(row) {
    const el = document.createElement('div');
    el.className = 'border border-slate-200 rounded-lg p-2.5 text-sm';
    el.innerHTML = `
      <div class="flex items-center justify-between gap-2">
        <span class="text-slate-500">${escapeHtml(new Date(row.created_at).toLocaleDateString(appLocale()))}</span>
        ${statusBadge(row.status)}
      </div>
      ${row.note ? `<p class="text-slate-700 mt-1">${escapeHtml(row.note)}</p>` : ''}
      ${row.meeting_room ? `<button type="button" data-action="join" class="mt-2 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700">${t('meeting.join')}</button>` : ''}
    `;

    el.querySelector('[data-action="join"]')?.addEventListener('click', async () => {
      const win = openMeetingWindow();
      const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', currentUserId).single();
      navigateMeetingWindow(win, { roomName: row.meeting_room, displayName: profile?.full_name || '' });
    });

    return el;
  }

  return { open, root };
}

export function createPastorMeetingQueueModal({ supabase }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${t('pastorMeeting.queueTitle')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <div data-el="list" class="space-y-2"></div>
    </div>
  `;
  document.body.appendChild(root);

  const listEl = root.querySelector('[data-el="list"]');
  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });

  function open() {
    root.classList.remove('hidden');
    root.classList.add('flex');
    load();
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  async function load() {
    listEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const { data, error } = await supabase
      .from('pastor_meeting_requests')
      .select('id, note, status, created_at, requester:profiles!user_id ( full_name )')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    if (error) {
      listEl.innerHTML = `<p class="text-sm text-rose-600">${t('pastorMeeting.loadFailed', { message: error.message })}</p>`;
      return;
    }

    if (!data || data.length === 0) {
      listEl.innerHTML = `<p class="text-sm text-slate-500">${t('pastorMeeting.noPending')}</p>`;
      return;
    }

    listEl.innerHTML = '';
    data.forEach((row) => listEl.appendChild(buildRow(row)));
  }

  function buildRow(row) {
    const el = document.createElement('div');
    el.className = 'border border-slate-200 rounded-lg p-3';
    el.innerHTML = `
      <div class="flex items-start justify-between gap-3">
        <div>
          <div class="font-medium text-slate-800">${escapeHtml(row.requester?.full_name || '')}</div>
          <div class="text-xs text-slate-400">${escapeHtml(new Date(row.created_at).toLocaleDateString(appLocale()))}</div>
          ${row.note ? `<p class="text-sm text-slate-600 mt-1">${escapeHtml(row.note)}</p>` : ''}
        </div>
        <div data-el="actions" class="flex gap-2 shrink-0">
          <button type="button" data-action="confirm" class="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700">
            ${t('pastorMeeting.confirm')}
          </button>
          <button type="button" data-action="decline" class="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-medium hover:bg-rose-700">
            ${t('pastorMeeting.decline')}
          </button>
        </div>
      </div>
      <p data-el="row-status" class="text-xs text-rose-600 mt-1"></p>
    `;

    el.querySelector('[data-action="confirm"]').addEventListener('click', () => respond(row.id, 'confirmed', el));
    el.querySelector('[data-action="decline"]').addEventListener('click', () => respond(row.id, 'declined', el));
    return el;
  }

  async function respond(id, status, el) {
    const { error } = await supabase.rpc('respond_to_pastor_meeting_request', { p_request_id: id, p_status: status });
    if (error) {
      el.querySelector('[data-el="row-status"]').textContent = t('pastorMeeting.respondFailed', { message: error.message });
      return;
    }

    if (status !== 'confirmed') {
      load();
      return;
    }

    // Show Join Meeting right here instead of reloading straight to
    // load() — a reload would only show pending requests and this one
    // just left that state, so the person who confirmed it would have
    // no way back to the room they just created.
    const { data: confirmedRow } = await supabase
      .from('pastor_meeting_requests')
      .select('meeting_room')
      .eq('id', id)
      .single();

    const actionsEl = el.querySelector('[data-el="actions"]');
    if (actionsEl && confirmedRow?.meeting_room) {
      actionsEl.innerHTML = `
        <button type="button" data-action="join" class="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700">
          ${t('meeting.join')}
        </button>
      `;
      actionsEl.querySelector('[data-action="join"]').addEventListener('click', async () => {
        const win = openMeetingWindow();
        const { data: { user } } = await supabase.auth.getUser();
        const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', user.id).single();
        navigateMeetingWindow(win, { roomName: confirmedRow.meeting_room, displayName: profile?.full_name || '' });
      });
    }
    el.querySelector('[data-el="row-status"]').textContent = '';
  }

  return { open, root };
}

function statusBadge(status) {
  const styles = { pending: 'bg-slate-100 text-slate-600', confirmed: 'bg-emerald-100 text-emerald-700', declined: 'bg-rose-100 text-rose-700' };
  return `<span class="px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] || styles.pending}">${t(`pastorMeeting.status.${status}`)}</span>`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
