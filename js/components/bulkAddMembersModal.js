// Add several existing tenant members to one department at once --
// checkbox multi-select over everyone NOT already in this department
// (any status: department_memberships has a UNIQUE(user_id,
// department_id), so a pending row also has to be excluded, not just
// an approved one), with a name search and a global-access-level
// filter. One batch insert, all rows approved immediately -- the
// caller only ever shows this to someone who already administers the
// target department (same "Manage Roster" entry point as the single-
// add flow in userEditModal.js), so the existing insert policy
// (can_create_users() AND can_approve_department_membership(department_id))
// already allows it; no new SQL needed.
import { t, roleLabel } from '../i18n.js';

const ACCESS_LEVELS = ['super_admin', 'super_viewer', 'pastor_admin', 'church_secretary'];

export function createBulkAddMembersModal({ supabase, departmentId, currentUserId, onAdded }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${t('bulkAdd.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <div class="flex flex-wrap items-center gap-3 mb-3">
        <input type="search" data-el="search" placeholder="${t('bulkAdd.searchPlaceholder')}"
               class="flex-1 min-w-[180px] border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        <select data-el="role-filter" class="border border-slate-300 rounded-lg px-2 py-2 text-sm">
          <option value="">${t('bulkAdd.allRoles')}</option>
          ${ACCESS_LEVELS.map((r) => `<option value="${r}">${roleLabel(r)}</option>`).join('')}
          <option value="__none__">${t('bulkAdd.noAccessLevel')}</option>
        </select>
      </div>
      <label class="flex items-center gap-1.5 text-sm text-slate-600 mb-2">
        <input type="checkbox" data-el="select-all" /> ${t('bulkAdd.selectAllVisible')}
      </label>
      <div data-el="list" class="divide-y divide-slate-100 border border-slate-200 rounded-lg max-h-[45vh] overflow-y-auto"></div>
      <div class="flex items-center justify-between mt-4">
        <span data-el="status" class="text-sm text-slate-500"></span>
        <button type="button" data-action="submit" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
          ${t('bulkAdd.addSelected')}
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const searchEl = root.querySelector('[data-el="search"]');
  const roleFilterEl = root.querySelector('[data-el="role-filter"]');
  const selectAllEl = root.querySelector('[data-el="select-all"]');
  const listEl = root.querySelector('[data-el="list"]');
  const statusEl = root.querySelector('[data-el="status"]');
  const submitBtn = root.querySelector('[data-action="submit"]');

  let candidates = [];
  let searchQuery = '';
  let roleFilter = '';
  const selected = new Set();

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  searchEl.addEventListener('input', () => { searchQuery = searchEl.value.trim().toLowerCase(); renderList(); });
  roleFilterEl.addEventListener('change', () => { roleFilter = roleFilterEl.value; renderList(); });
  selectAllEl.addEventListener('change', () => {
    visibleCandidates().forEach((c) => { if (selectAllEl.checked) selected.add(c.id); else selected.delete(c.id); });
    renderList();
  });
  submitBtn.addEventListener('click', submit);

  function visibleCandidates() {
    return candidates.filter((c) => {
      if (searchQuery && !c.full_name.toLowerCase().includes(searchQuery)) return false;
      if (roleFilter === '__none__' && c.global_role) return false;
      if (roleFilter && roleFilter !== '__none__' && c.global_role !== roleFilter) return false;
      return true;
    });
  }

  async function open() {
    root.classList.remove('hidden');
    root.classList.add('flex');
    searchEl.value = '';
    roleFilterEl.value = '';
    searchQuery = '';
    roleFilter = '';
    selected.clear();
    selectAllEl.checked = false;
    statusEl.textContent = '';
    listEl.innerHTML = `<p class="p-4 text-sm text-slate-500">${t('common.loading')}</p>`;

    const [{ data: profiles, error: profilesError }, { data: existing, error: existingError }] = await Promise.all([
      supabase.from('profiles').select('id, full_name, global_role, removed_at, permanently_deleted_at'),
      supabase.from('department_memberships').select('user_id').eq('department_id', departmentId),
    ]);

    if (profilesError || existingError) {
      listEl.innerHTML = `<p class="p-4 text-sm text-rose-600">${t('bulkAdd.loadFailed', { message: (profilesError || existingError).message })}</p>`;
      return;
    }

    const existingIds = new Set((existing || []).map((m) => m.user_id));
    candidates = (profiles || [])
      .filter((p) => !existingIds.has(p.id) && !p.removed_at && !p.permanently_deleted_at)
      .sort((a, b) => a.full_name.localeCompare(b.full_name));

    renderList();
  }

  function renderList() {
    const visible = visibleCandidates();
    selectAllEl.checked = visible.length > 0 && visible.every((c) => selected.has(c.id));

    if (visible.length === 0) {
      listEl.innerHTML = `<p class="p-4 text-sm text-slate-400">${t('bulkAdd.none')}</p>`;
    } else {
      listEl.innerHTML = visible.map((c) => `
        <label class="flex items-center gap-3 px-4 py-2 hover:bg-slate-50 cursor-pointer">
          <input type="checkbox" data-candidate-id="${c.id}" ${selected.has(c.id) ? 'checked' : ''} />
          <span class="text-sm text-slate-800">${escapeHtml(c.full_name)}</span>
          ${c.global_role ? `<span class="text-xs text-slate-400">${escapeHtml(roleLabel(c.global_role))}</span>` : ''}
        </label>
      `).join('');
      listEl.querySelectorAll('[data-candidate-id]').forEach((cb) => {
        cb.addEventListener('change', () => {
          if (cb.checked) selected.add(cb.dataset.candidateId); else selected.delete(cb.dataset.candidateId);
          selectAllEl.checked = visibleCandidates().every((c) => selected.has(c.id));
          updateStatus();
        });
      });
    }
    updateStatus();
  }

  function updateStatus() {
    statusEl.textContent = t('bulkAdd.selectedCount', { count: selected.size });
  }

  async function submit() {
    if (selected.size === 0) return;
    submitBtn.disabled = true;
    statusEl.textContent = t('common.saving');

    const inserts = Array.from(selected).map((userId) => ({
      user_id: userId,
      department_id: departmentId,
      role: 'member',
      status: 'approved',
      approved_at: new Date().toISOString(),
      approved_by: currentUserId,
    }));

    const { error } = await supabase.from('department_memberships').insert(inserts);
    submitBtn.disabled = false;

    if (error) {
      statusEl.textContent = t('bulkAdd.addFailed', { message: error.message });
      return;
    }

    close();
    onAdded?.();
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
