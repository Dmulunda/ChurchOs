// App Suggestion Portal — open to every signed-in member (sql/049
// widened this from the original elevated-roles-only gate; sql/049's
// RLS is the real enforcement either way). A submission fans out to
// every Site Admin via notify_site_admins(), not one hardcoded person.
//
// "My Suggestions" (sql/061) shows a submitter their own past rows and
// any site_admin_reply -- a Site Admin's status/note change used to be
// invisible to whoever submitted it; this is the other half of that
// fix (the notification bell also fires, but this is where the full
// reply text actually lives).
import { t, appLocale } from '../i18n.js';

export function createAppSuggestionModal({ supabase, currentUserId }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${t('appSuggestion.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <p class="text-sm text-slate-500 mb-4">${t('appSuggestion.intro')}</p>
      <textarea data-el="message" rows="5" placeholder="${t('appSuggestion.placeholder')}"
                class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-3"></textarea>
      <div class="flex items-center gap-3 mb-5">
        <button type="button" data-action="submit" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">
          ${t('appSuggestion.submit')}
        </button>
        <span data-el="status" class="text-sm text-slate-500"></span>
      </div>

      <h3 class="text-sm font-semibold text-slate-700 mb-2">${t('appSuggestion.mySuggestions')}</h3>
      <div data-el="my-list"></div>
    </div>
  `;
  document.body.appendChild(root);

  const messageEl = root.querySelector('[data-el="message"]');
  const statusEl = root.querySelector('[data-el="status"]');
  const submitBtn = root.querySelector('[data-action="submit"]');
  const myListEl = root.querySelector('[data-el="my-list"]');

  async function loadMySuggestions() {
    myListEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;
    const { data, error } = await supabase
      .from('app_suggestions')
      .select('id, message, status, site_admin_reply, created_at')
      .eq('submitted_by', currentUserId)
      .order('created_at', { ascending: false });

    if (error) {
      myListEl.innerHTML = `<p class="text-sm text-rose-600">${t('appSuggestion.loadFailed', { message: error.message })}</p>`;
      return;
    }
    if (!data || data.length === 0) {
      myListEl.innerHTML = `<p class="text-sm text-slate-400">${t('appSuggestion.none')}</p>`;
      return;
    }
    myListEl.innerHTML = `<div class="space-y-2">${data.map((row) => `
      <div class="border border-slate-200 rounded-lg p-3">
        <div class="flex items-center justify-between gap-2 mb-1">
          <span class="text-xs text-slate-400">${new Date(row.created_at).toLocaleDateString(appLocale())}</span>
          <span class="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">${escapeHtml(t(`siteAdmin.status.${row.status}`))}</span>
        </div>
        <p class="text-sm text-slate-800 whitespace-pre-wrap">${escapeHtml(row.message)}</p>
        ${row.site_admin_reply ? `<p class="text-sm text-indigo-700 bg-indigo-50 rounded px-2 py-1.5 mt-2 whitespace-pre-wrap"><strong>${escapeHtml(t('appSuggestion.replyLabel'))}</strong> ${escapeHtml(row.site_admin_reply)}</p>` : ''}
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
      statusEl.textContent = t('appSuggestion.emptyMessage');
      return;
    }

    submitBtn.disabled = true;
    statusEl.className = 'text-sm text-slate-500';
    statusEl.textContent = t('common.saving');

    const { error } = await supabase.from('app_suggestions').insert({ submitted_by: currentUserId, message });

    submitBtn.disabled = false;
    if (error) {
      statusEl.className = 'text-sm text-rose-600';
      statusEl.textContent = t('appSuggestion.submitFailed', { message: error.message });
      return;
    }

    messageEl.value = '';
    statusEl.className = 'text-sm text-emerald-600';
    statusEl.textContent = t('appSuggestion.submitted');
    loadMySuggestions();
  });

  function open() {
    root.classList.remove('hidden');
    root.classList.add('flex');
    messageEl.value = '';
    statusEl.textContent = '';
    loadMySuggestions();
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  return { open };
}
