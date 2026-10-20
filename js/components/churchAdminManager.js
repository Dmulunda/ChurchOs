// Church Admin management -- a Super-Admin-only panel to grant/revoke
// the new Church Admin role (sql/saas_platform/95), modeled on
// siteAdminPage.js's own "Manage Site Admins" panel but much simpler
// (single tenant, no cross-system split): add by email, list current
// Church Admins, remove.
import { t } from '../i18n.js';
import { confirmDialog } from './confirmDialog.js';

export function createChurchAdminManagerModal({ supabase }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${t('churchAdmin.manageTitle')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <p class="text-sm text-slate-500 mb-4">${t('churchAdmin.intro')}</p>
      <div data-el="body"></div>
    </div>
  `;
  document.body.appendChild(root);

  const bodyEl = root.querySelector('[data-el="body"]');
  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });

  async function load() {
    bodyEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const { data: admins, error } = await supabase.rpc('list_church_admins');
    if (error) {
      bodyEl.innerHTML = `<p class="text-sm text-rose-600">${t('churchAdmin.loadFailed', { message: error.message })}</p>`;
      return;
    }

    bodyEl.innerHTML = `
      <div class="flex items-end gap-2 mb-4 flex-wrap">
        <div class="flex-1 min-w-[180px]">
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('churchAdmin.addByEmail')}</label>
          <input type="email" data-el="add-email" placeholder="${escapeHtml(t('churchAdmin.emailPlaceholder'))}"
                 class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <button type="button" data-action="add" class="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">${t('churchAdmin.add')}</button>
      </div>
      <span data-el="add-status" class="block text-sm mb-3"></span>
      <p class="text-sm font-semibold text-slate-700 mb-2">${t('churchAdmin.currentAdmins')}</p>
      <div data-el="admin-list" class="divide-y border border-slate-200 rounded-lg"></div>
    `;

    renderAdminList(admins || []);

    const emailEl = bodyEl.querySelector('[data-el="add-email"]');
    const addStatusEl = bodyEl.querySelector('[data-el="add-status"]');
    bodyEl.querySelector('[data-action="add"]').addEventListener('click', async () => {
      const email = emailEl.value.trim();
      if (!email) return;
      addStatusEl.className = 'block text-sm text-slate-500 mb-3';
      addStatusEl.textContent = t('common.saving');
      const { error: grantError } = await supabase.rpc('grant_church_admin_by_email', { p_email: email });
      if (grantError) {
        addStatusEl.className = 'block text-sm text-rose-600 mb-3';
        addStatusEl.textContent = t('churchAdmin.addFailed', { message: grantError.message });
        return;
      }
      load();
    });
  }

  function renderAdminList(admins) {
    const listEl = bodyEl.querySelector('[data-el="admin-list"]');
    if (admins.length === 0) {
      listEl.innerHTML = `<p class="px-3 py-2 text-sm text-slate-400">${t('churchAdmin.none')}</p>`;
      return;
    }
    listEl.innerHTML = admins.map((a) => `
      <div class="flex items-center justify-between px-3 py-2" data-admin-id="${a.user_id}">
        <div>
          <p class="text-sm font-medium text-slate-800">${escapeHtml(a.full_name || '—')}</p>
          <p class="text-xs text-slate-500">${t('churchAdmin.grantedOn', { date: new Date(a.granted_at).toLocaleDateString() })}</p>
        </div>
        <button type="button" data-action="remove" class="text-sm text-rose-600 hover:text-rose-700">${t('churchAdmin.remove')}</button>
      </div>
    `).join('');

    listEl.querySelectorAll('[data-action="remove"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('[data-admin-id]');
        const id = row.dataset.adminId;
        const name = row.querySelector('p').textContent;
        const ok = await confirmDialog({ message: t('churchAdmin.removeConfirm', { name }) });
        if (!ok) return;
        await supabase.rpc('revoke_church_admin', { p_user_id: id });
        load();
      });
    });
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

  return { open, root };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
