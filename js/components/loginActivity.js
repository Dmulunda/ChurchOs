// Super-Admin-only: each person's 3 most recent sign-ins. Rows come
// from get_recent_login_activity() (sql/051), a window-function query
// over login_events (populated by a trigger on auth.users — not
// tracked client-side, so it can't be missed regardless of which
// device someone signs in from) so every person gets their own most
// recent 3, rather than a flat "last 200 events" list one very active
// signer-in could crowd everyone else out of.
import { t, appLocale } from '../i18n.js';

export function createLoginActivityModal({ supabase }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${t('loginActivity.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <p class="text-sm text-slate-500 mb-4">${t('loginActivity.intro')}</p>
      <input type="search" data-el="search" placeholder="${t('loginActivity.searchPlaceholder')}"
             class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-4" />
      <div data-el="list"></div>
    </div>
  `;
  document.body.appendChild(root);

  const searchEl = root.querySelector('[data-el="search"]');
  const listEl = root.querySelector('[data-el="list"]');
  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });

  let allRows = [];
  let searchTimeout = null;
  searchEl.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(render, 200);
  });

  async function load() {
    listEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const { data, error } = await supabase.rpc('get_recent_login_activity');

    if (error) {
      listEl.innerHTML = `<p class="text-sm text-rose-600">${t('loginActivity.loadFailed', { message: error.message })}</p>`;
      return;
    }

    allRows = data || [];
    render();
  }

  function render() {
    const query = searchEl.value.trim().toLowerCase();
    const filtered = query
      ? allRows.filter((r) => (r.full_name || '').toLowerCase().includes(query))
      : allRows;

    if (filtered.length === 0) {
      listEl.innerHTML = `<p class="text-sm text-slate-500">${t('loginActivity.none')}</p>`;
      return;
    }

    const byUser = new Map();
    filtered.forEach((r) => {
      if (!byUser.has(r.user_id)) byUser.set(r.user_id, { full_name: r.full_name, times: [] });
      byUser.get(r.user_id).times.push(r.logged_in_at);
    });

    listEl.innerHTML = '';
    listEl.className = 'space-y-2';
    byUser.forEach((entry) => {
      const row = document.createElement('div');
      row.className = 'border border-slate-200 rounded-lg p-3';
      row.innerHTML = `
        <div class="font-medium text-slate-800">${escapeHtml(entry.full_name || t('loginActivity.unknownUser'))}</div>
        <div class="text-sm text-slate-600 mt-1">${entry.times.map(formatWhen).map(escapeHtml).join(' &nbsp;·&nbsp; ')}</div>
      `;
      listEl.appendChild(row);
    });
  }

  function open() {
    root.classList.remove('hidden');
    root.classList.add('flex');
    searchEl.value = '';
    load();
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  return { open, root };
}

function formatWhen(isoString) {
  return new Date(isoString).toLocaleString(appLocale(), { dateStyle: 'medium', timeStyle: 'short' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
