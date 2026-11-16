// Contact Support — visible to every signed-in member (sql/049's RLS
// is the real enforcement either way, same as appSuggestionModal.js).
// A submission fans out to every Site Admin via notify_site_admins(),
// tenant-safe unlike the old single-recipient app_suggestion path.
//
// "My Requests" (sql/061) mirrors appSuggestionModal.js's own list --
// a submitter's own past requests plus any site_admin_reply.
import { t, appLocale } from '../i18n.js';

const TOPICS = ['tech_problem', 'question', 'other'];

export function createSupportRequestModal({ supabase, currentUserId }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${t('supportRequest.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <p class="text-sm text-slate-500 mb-4">${t('supportRequest.intro')}</p>

      <label class="block text-sm font-medium text-slate-600 mb-1">${t('supportRequest.topicLabel')}</label>
      <select data-el="topic" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-3">
        ${TOPICS.map((topic) => `<option value="${topic}">${t(`supportRequest.topic.${topic}`)}</option>`).join('')}
      </select>

      <textarea data-el="message" rows="5" placeholder="${t('supportRequest.placeholder')}"
                class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-3"></textarea>
      <div class="flex items-center gap-3 mb-5">
        <button type="button" data-action="submit" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">
          ${t('supportRequest.submit')}
        </button>
        <span data-el="status" class="text-sm text-slate-500"></span>
      </div>

      <h3 class="text-sm font-semibold text-slate-700 mb-2">${t('supportRequest.myRequests')}</h3>
      <div data-el="my-list"></div>
    </div>
  `;
  document.body.appendChild(root);

  const topicEl = root.querySelector('[data-el="topic"]');
  const messageEl = root.querySelector('[data-el="message"]');
  const statusEl = root.querySelector('[data-el="status"]');
  const submitBtn = root.querySelector('[data-action="submit"]');
  const myListEl = root.querySelector('[data-el="my-list"]');

  async function loadMyRequests() {
    myListEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;
    const { data, error } = await supabase
      .from('support_requests')
      .select('id, topic, message, status, site_admin_reply, created_at')
      .eq('submitted_by', currentUserId)
      .order('created_at', { ascending: false });

    if (error) {
      myListEl.innerHTML = `<p class="text-sm text-rose-600">${t('supportRequest.loadFailed', { message: error.message })}</p>`;
      return;
    }
    if (!data || data.length === 0) {
      myListEl.innerHTML = `<p class="text-sm text-slate-400">${t('supportRequest.none')}</p>`;
      return;
    }
    myListEl.innerHTML = `<div class="space-y-2">${data.map((row) => `
      <div class="border border-slate-200 rounded-lg p-3">
        <div class="flex items-center justify-between gap-2 mb-1">
          <span class="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">${escapeHtml(t(`supportRequest.topic.${row.topic}`))}</span>
          <span class="text-xs text-slate-400">${new Date(row.created_at).toLocaleDateString(appLocale())} · ${escapeHtml(t(`siteAdmin.status.${row.status}`))}</span>
        </div>
        <p class="text-sm text-slate-800 whitespace-pre-wrap">${escapeHtml(row.message)}</p>
        ${row.site_admin_reply ? `<p class="text-sm text-indigo-700 bg-indigo-50 rounded px-2 py-1.5 mt-2 whitespace-pre-wrap"><strong>${escapeHtml(t('supportRequest.replyLabel'))}</strong> ${escapeHtml(row.site_admin_reply)}</p>` : ''}
      </div>
    `).join('')}</div>`;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });

  submitBtn.addEventListener('click', async () => {
    const message = messageEl.value.trim();
    if (!message) {
      statusEl.className = 'text-sm text-rose-600';
      statusEl.textContent = t('supportRequest.emptyMessage');
      return;
    }

    submitBtn.disabled = true;
    statusEl.className = 'text-sm text-slate-500';
    statusEl.textContent = t('common.saving');

    const { error } = await supabase.from('support_requests').insert({
      submitted_by: currentUserId,
      topic: topicEl.value,
      message,
    });

    submitBtn.disabled = false;
    if (error) {
      statusEl.className = 'text-sm text-rose-600';
      statusEl.textContent = t('supportRequest.submitFailed', { message: error.message });
      return;
    }

    messageEl.value = '';
    statusEl.className = 'text-sm text-emerald-600';
    statusEl.textContent = t('supportRequest.submitted');
    loadMyRequests();
  });

  function open() {
    root.classList.remove('hidden');
    root.classList.add('flex');
    topicEl.value = 'tech_problem';
    messageEl.value = '';
    statusEl.textContent = '';
    loadMyRequests();
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  return { open };
}
