// Super-Admin-only: browse and delete direct messages. Separate from
// the normal Inbox (which only ever shows a user's own messages) since
// this is specifically a moderation tool. Read access already existed
// for Super Admin (sql/026); delete is new (sql/045) and flagged there
// as the one delete power with real privacy implications — kept
// Super-Admin-only rather than the broader pastoral team, and every
// delete requires its own confirmation naming that explicitly.
import { confirmDialog } from './confirmDialog.js';
import { t, formatDate } from '../i18n.js';

export function createMessageModerationModal({ supabase }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${t('messageModeration.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <p class="text-sm text-slate-500 mb-4">${t('messageModeration.intro')}</p>
      <input type="search" data-el="search" placeholder="${t('messageModeration.searchPlaceholder')}"
             class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-4" />
      <div data-el="list" class="space-y-2"></div>
    </div>
  `;
  document.body.appendChild(root);

  const searchEl = root.querySelector('[data-el="search"]');
  const listEl = root.querySelector('[data-el="list"]');
  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });

  let searchTimeout = null;
  searchEl.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(load, 250);
  });

  async function load() {
    listEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const { data, error } = await supabase
      .from('direct_messages')
      .select('id, body, created_at, sender:profiles!sender_id ( full_name ), recipient:profiles!recipient_id ( full_name )')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      listEl.innerHTML = `<p class="text-sm text-rose-600">${t('messageModeration.loadFailed', { message: error.message })}</p>`;
      return;
    }

    const query = searchEl.value.trim().toLowerCase();
    const filtered = query
      ? (data || []).filter((m) =>
          (m.sender?.full_name || '').toLowerCase().includes(query)
          || (m.recipient?.full_name || '').toLowerCase().includes(query)
          || (m.body || '').toLowerCase().includes(query))
      : (data || []);

    if (filtered.length === 0) {
      listEl.innerHTML = `<p class="text-sm text-slate-500">${t('messageModeration.none')}</p>`;
      return;
    }

    listEl.innerHTML = '';
    filtered.forEach((m) => {
      const row = document.createElement('div');
      row.className = 'border border-slate-200 rounded-lg p-3';
      row.innerHTML = `
        <div class="flex items-start justify-between gap-2">
          <div class="text-xs font-semibold text-slate-500">
            ${escapeHtml(m.sender?.full_name || '—')} → ${escapeHtml(m.recipient?.full_name || '—')}
          </div>
          <button type="button" class="text-xs font-medium text-rose-600 hover:text-rose-800 whitespace-nowrap">${t('moderation.delete')}</button>
        </div>
        <p class="text-sm text-slate-700 mt-1 whitespace-pre-wrap">${escapeHtml(m.body)}</p>
        <div class="text-xs text-slate-400 mt-2">${escapeHtml(formatDate(m.created_at))}</div>
      `;
      row.querySelector('button').addEventListener('click', async () => {
        const confirmed = await confirmDialog({ message: t('moderation.confirmDeleteMessage') });
        if (!confirmed) return;
        const { error: deleteError } = await supabase.from('direct_messages').delete().eq('id', m.id);
        if (deleteError) {
          window.alert(t('moderation.deleteFailed', { message: deleteError.message }));
          return;
        }
        load();
      });
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

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
