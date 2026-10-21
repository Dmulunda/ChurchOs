// Prayer requests (sql/067). Two entry points sharing one table:
// createPrayerRequestModal is the member-facing self-service form
// (plus their own request history), opened from the sidebar "More"
// menu; createPrayerRequestQueueModal is the handlers' queue —
// Intercession's own admins/secretaries, plus the pastoral team —
// opened from Intercession's Dashboard and from Super Admin Home.
// mark_prayer_request_prayed() (the RPC) is the only way a request
// gets marked handled, so handled_by/handled_at are always the real
// actor and the real server time.
import { t } from '../i18n.js';

export function createPrayerRequestModal({ supabase, currentUserId }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[85vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-2">
        <h2 class="text-xl font-bold">${t('prayerRequest.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <p class="text-xs text-slate-500 mb-4">${t('prayerRequest.intro')}</p>
      <form data-el="form" class="space-y-3">
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('prayerRequest.text')}</label>
          <textarea name="request_text" rows="4" required placeholder="${t('prayerRequest.textPlaceholder')}"
                     class="w-full border border-slate-300 rounded-lg px-3 py-2"></textarea>
        </div>
        <label class="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" name="anonymous" class="rounded border-slate-300">
          ${t('prayerRequest.anonymousLabel')}
        </label>
        <div class="flex items-center gap-3">
          <button type="submit" data-el="submit-btn"
                  class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
            ${t('prayerRequest.submit')}
          </button>
          <span data-el="form-status" class="text-sm text-slate-500"></span>
        </div>
      </form>
      <div class="mt-6 pt-4 border-t border-slate-200">
        <h3 class="text-sm font-semibold text-slate-600 mb-2">${t('prayerRequest.myRequests')}</h3>
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
    const requestText = form.elements.request_text.value.trim();
    const isAnonymous = form.elements.anonymous.checked;

    if (!requestText) {
      formStatusEl.className = 'text-sm text-rose-600';
      formStatusEl.textContent = t('prayerRequest.missingText');
      return;
    }

    submitBtn.disabled = true;
    formStatusEl.className = 'text-sm text-slate-500';
    formStatusEl.textContent = t('common.saving');

    const { error } = await supabase.from('prayer_requests').insert({
      user_id: isAnonymous ? null : currentUserId,
      request_text: requestText,
    });

    submitBtn.disabled = false;
    if (error) {
      formStatusEl.className = 'text-sm text-rose-600';
      formStatusEl.textContent = t('prayerRequest.submitFailed', { message: error.message });
      return;
    }

    formStatusEl.className = 'text-sm text-emerald-600';
    formStatusEl.textContent = t('prayerRequest.submitted');
    form.reset();
    loadHistory();
  }

  async function loadHistory() {
    historyEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const { data, error } = await supabase
      .from('prayer_requests')
      .select('id, request_text, status, created_at')
      .eq('user_id', currentUserId)
      .order('created_at', { ascending: false });

    if (error) {
      historyEl.innerHTML = `<p class="text-sm text-rose-600">${t('prayerRequest.loadFailed', { message: error.message })}</p>`;
      return;
    }

    if (!data || data.length === 0) {
      historyEl.innerHTML = `<p class="text-sm text-slate-500">${t('prayerRequest.noRequests')}</p>`;
      return;
    }

    historyEl.innerHTML = data.map((row) => `
      <div class="border border-slate-200 rounded-lg p-2.5 text-sm">
        <div class="flex items-center justify-between gap-2">
          <span class="text-slate-500">${escapeHtml(new Date(row.created_at).toLocaleDateString())}</span>
          ${statusBadge(row.status)}
        </div>
        <p class="text-slate-700 mt-1">${escapeHtml(row.request_text)}</p>
      </div>
    `).join('');
  }

  return { open, root };
}

// Mountable render function (the pastoral dashboard's own Prayer
// Requests tab mounts this directly) plus a thin modal wrapper around
// it, same split userManager.js's renderUserManager/
// createUserManagerModal already uses.
export function renderPrayerRequestQueue(container, { supabase }) {
  container.innerHTML = `<div data-el="list" class="space-y-2"></div>`;
  const listEl = container.querySelector('[data-el="list"]');
  load();

  async function load() {
    listEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const { data, error } = await supabase
      .from('prayer_requests')
      .select('id, request_text, status, created_at, requester:profiles!user_id ( full_name )')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    if (error) {
      listEl.innerHTML = `<p class="text-sm text-rose-600">${t('prayerRequest.loadFailed', { message: error.message })}</p>`;
      return;
    }

    if (!data || data.length === 0) {
      listEl.innerHTML = `<p class="text-sm text-slate-500">${t('prayerRequest.noPending')}</p>`;
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
          <div class="font-medium text-slate-800">${row.requester?.full_name ? escapeHtml(row.requester.full_name) : `<span class="italic text-slate-400">${t('prayerRequest.anonymousSubmitter')}</span>`}</div>
          <div class="text-xs text-slate-400">${escapeHtml(new Date(row.created_at).toLocaleDateString())}</div>
          <p class="text-sm text-slate-600 mt-1">${escapeHtml(row.request_text)}</p>
        </div>
        <button type="button" data-action="mark-prayed"
                class="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 whitespace-nowrap">
          ${t('prayerRequest.markPrayed')}
        </button>
      </div>
      <p data-el="row-status" class="text-xs text-rose-600 mt-1"></p>
    `;

    el.querySelector('[data-action="mark-prayed"]').addEventListener('click', () => markPrayed(row.id, el));
    return el;
  }

  async function markPrayed(id, el) {
    const { error } = await supabase.rpc('mark_prayer_request_prayed', { p_request_id: id });
    if (error) {
      el.querySelector('[data-el="row-status"]').textContent = t('prayerRequest.markFailed', { message: error.message });
      return;
    }
    load();
  }
}

export function createPrayerRequestQueueModal({ supabase }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${t('prayerRequest.queueTitle')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <div data-el="body"></div>
    </div>
  `;
  document.body.appendChild(root);

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });

  function open() {
    root.classList.remove('hidden');
    root.classList.add('flex');
    renderPrayerRequestQueue(root.querySelector('[data-el="body"]'), { supabase });
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  return { open, root };
}

function statusBadge(status) {
  const styles = { pending: 'bg-slate-100 text-slate-600', prayed: 'bg-emerald-100 text-emerald-700' };
  return `<span class="px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] || styles.pending}">${t(`prayerRequest.status.${status}`)}</span>`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
