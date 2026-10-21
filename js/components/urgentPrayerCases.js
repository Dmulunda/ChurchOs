// Urgent Prayer Cases — distinct from the self-service Prayer
// Requests queue (prayerRequests.js): created BY the Pastor or any
// department admin ON BEHALF OF someone needing urgent prayer, either
// picking a real member or typing a name freely (sql/saas_platform/98).
// The one thing nothing else in this app has: a per-case custom "who
// else can see this" access list (urgent_prayer_case_viewers) —
// visible by default to Super Admin/Pastor/Church Admin/Intercession's
// own admin-secretary, the creator, and whoever the creator explicitly
// grants. Granted viewers can see a case but only the creator or an
// oversight role can edit it or manage who else is on the list.
//
// Split into a mountable render function plus a thin modal wrapper
// (same shape as js/components/userManager.js's renderUserManager vs.
// createUserManagerModal) so the consolidated pastoral dashboard
// (Part 6) can mount this directly into a tab panel.
import { confirmDialog } from './confirmDialog.js';
import { getGlobalRole, getMyDepartments } from '../departments.js';
import { t } from '../i18n.js';

const STATUSES = ['open', 'resolved'];

export function renderUrgentPrayerCases(container, { supabase, currentUserId }) {
  container.innerHTML = `
    <button type="button" data-action="toggle-new-case" class="mb-3 px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">
      ${t('urgentPrayer.newCase')}
    </button>

    <div data-el="create-form" class="hidden border border-slate-200 rounded-lg p-4 mb-4 space-y-2">
      <label class="block text-sm font-medium text-slate-600">${t('urgentPrayer.person')}</label>
      <input type="text" data-el="person-name" placeholder="${t('urgentPrayer.personPlaceholder')}"
             class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      <div data-el="member-results" class="max-h-32 overflow-y-auto border border-slate-100 rounded-lg divide-y"></div>
      <p data-el="member-selected" class="text-xs text-emerald-600"></p>

      <label class="block text-sm font-medium text-slate-600">${t('urgentPrayer.need')}</label>
      <textarea data-el="need-description" rows="3" placeholder="${t('urgentPrayer.needPlaceholder')}"
                class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"></textarea>

      <label class="block text-sm font-medium text-slate-600">${t('urgentPrayer.viewers')}</label>
      <p class="text-xs text-slate-500">${t('urgentPrayer.viewersHint')}</p>
      <input type="search" data-el="viewer-search" placeholder="${t('urgentPrayer.viewerSearchPlaceholder')}"
             class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      <div data-el="viewer-list" class="max-h-40 overflow-y-auto border border-slate-200 rounded-lg divide-y"></div>

      <div class="flex items-center gap-3">
        <button type="button" data-action="submit-case" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">
          ${t('urgentPrayer.createCase')}
        </button>
        <span data-el="create-status" class="text-sm text-slate-500"></span>
      </div>
    </div>

    <div data-el="body"></div>
  `;

  const newCaseBtn = container.querySelector('[data-action="toggle-new-case"]');
  const createFormEl = container.querySelector('[data-el="create-form"]');
  const personNameEl = container.querySelector('[data-el="person-name"]');
  const memberResultsEl = container.querySelector('[data-el="member-results"]');
  const memberSelectedEl = container.querySelector('[data-el="member-selected"]');
  const needDescriptionEl = container.querySelector('[data-el="need-description"]');
  const viewerSearchEl = container.querySelector('[data-el="viewer-search"]');
  const viewerListEl = container.querySelector('[data-el="viewer-list"]');
  const createStatusEl = container.querySelector('[data-el="create-status"]');
  const bodyEl = container.querySelector('[data-el="body"]');

  let members = [];
  let admins = [];
  let selectedMemberId = null;
  const selectedViewerIds = new Set();

  newCaseBtn.addEventListener('click', () => {
    createFormEl.classList.toggle('hidden');
    if (!createFormEl.classList.contains('hidden')) resetCreateForm();
  });

  function resetCreateForm() {
    personNameEl.value = '';
    memberResultsEl.innerHTML = '';
    memberSelectedEl.textContent = '';
    selectedMemberId = null;
    needDescriptionEl.value = '';
    viewerSearchEl.value = '';
    selectedViewerIds.clear();
    createStatusEl.textContent = '';
    renderViewerList('');
  }

  // Free-typed name by default; picking a search result also links
  // person_member_id. Typing again after picking clears that link —
  // the name field is the source of truth, matching
  // offeringsBoard.js's own donor-name-or-member pattern.
  personNameEl.addEventListener('input', () => {
    selectedMemberId = null;
    memberSelectedEl.textContent = '';
    const query = personNameEl.value.trim().toLowerCase();
    const matches = query ? members.filter((m) => m.full_name.toLowerCase().includes(query)) : [];
    memberResultsEl.innerHTML = matches.slice(0, 10).map((m) => `
      <button type="button" data-member-id="${m.id}" class="w-full text-left px-2 py-1.5 text-sm hover:bg-slate-100">${escapeHtml(m.full_name)}${m.isSilent ? ` <span class="text-xs text-slate-400">(${t('users.silentBadge')})</span>` : ''}</button>
    `).join('');
    memberResultsEl.querySelectorAll('[data-member-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedMemberId = btn.dataset.memberId;
        const member = members.find((m) => m.id === selectedMemberId);
        personNameEl.value = member?.full_name || '';
        memberSelectedEl.textContent = t('urgentPrayer.memberLinked');
        memberResultsEl.innerHTML = '';
      });
    });
  });

  viewerSearchEl.addEventListener('input', () => renderViewerList(viewerSearchEl.value.trim().toLowerCase()));

  function renderViewerList(query) {
    const matches = query ? admins.filter((a) => a.full_name.toLowerCase().includes(query)) : admins;
    viewerListEl.innerHTML = matches.map((a) => `
      <label class="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-slate-50 cursor-pointer">
        <input type="checkbox" data-admin-id="${a.id}" ${selectedViewerIds.has(a.id) ? 'checked' : ''} />
        <span>${escapeHtml(a.full_name)}</span>
        <span class="text-xs text-slate-400">${escapeHtml(a.departments.join(', '))}</span>
      </label>
    `).join('');
    viewerListEl.querySelectorAll('[data-admin-id]').forEach((cb) => {
      cb.addEventListener('change', () => {
        if (cb.checked) selectedViewerIds.add(cb.dataset.adminId); else selectedViewerIds.delete(cb.dataset.adminId);
      });
    });
  }

  container.querySelector('[data-action="submit-case"]').addEventListener('click', async () => {
    const personName = personNameEl.value.trim();
    if (!personName) {
      createStatusEl.className = 'text-sm text-rose-600';
      createStatusEl.textContent = t('urgentPrayer.noPersonName');
      return;
    }

    const submitBtn = container.querySelector('[data-action="submit-case"]');
    submitBtn.disabled = true;
    createStatusEl.className = 'text-sm text-slate-500';
    createStatusEl.textContent = t('common.saving');

    const { data: created, error } = await supabase.from('urgent_prayer_cases').insert({
      person_name: personName,
      person_member_id: selectedMemberId,
      need_description: needDescriptionEl.value.trim() || null,
      created_by: currentUserId,
    }).select('id').single();

    if (error) {
      submitBtn.disabled = false;
      createStatusEl.className = 'text-sm text-rose-600';
      createStatusEl.textContent = t('urgentPrayer.createFailed', { message: error.message });
      return;
    }

    if (selectedViewerIds.size > 0) {
      await supabase.from('urgent_prayer_case_viewers').insert(
        Array.from(selectedViewerIds).map((userId) => ({ case_id: created.id, user_id: userId, added_by: currentUserId }))
      );
    }

    submitBtn.disabled = false;
    createFormEl.classList.add('hidden');
    load();
  });

  async function loadMembers() {
    const { data } = await supabase
      .from('department_memberships')
      .select('user_id, member:profiles!user_id ( id, full_name, is_silent )')
      .eq('status', 'approved');
    const byId = new Map();
    (data || []).forEach((r) => { if (r.member) byId.set(r.member.id, r.member); });
    members = Array.from(byId.values()).map((m) => ({ id: m.id, full_name: m.full_name, isSilent: m.is_silent })).sort((a, b) => a.full_name.localeCompare(b.full_name));
  }

  async function loadAdmins() {
    const { data } = await supabase
      .from('department_memberships')
      .select('user_id, member:profiles!user_id ( id, full_name ), departments ( name )')
      .eq('role', 'admin').eq('status', 'approved');
    const byId = new Map();
    (data || []).forEach((r) => {
      if (!r.member) return;
      if (!byId.has(r.member.id)) byId.set(r.member.id, { id: r.member.id, full_name: r.member.full_name, departments: [] });
      if (r.departments?.name) byId.get(r.member.id).departments.push(r.departments.name);
    });
    admins = Array.from(byId.values()).filter((a) => a.id !== currentUserId).sort((a, b) => a.full_name.localeCompare(b.full_name));
  }

  async function load() {
    bodyEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const { data: cases, error } = await supabase
      .from('urgent_prayer_cases')
      .select('id, person_name, person_member_id, need_description, status, created_by, created_at, creator:profiles!created_by ( full_name )')
      .order('created_at', { ascending: false });

    if (error) {
      bodyEl.innerHTML = `<p class="text-sm text-rose-600">${t('urgentPrayer.loadFailed', { message: error.message })}</p>`;
      return;
    }
    if (!cases || cases.length === 0) {
      bodyEl.innerHTML = `<p class="text-sm text-slate-500">${t('urgentPrayer.none')}</p>`;
      return;
    }

    const table = document.createElement('table');
    table.className = 'w-full text-sm';
    table.innerHTML = `
      <thead class="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
        <tr>
          <th class="text-left px-4 py-2">${t('urgentPrayer.person')}</th>
          <th class="text-left px-4 py-2">${t('memberCase.openedBy')}</th>
          <th class="text-left px-4 py-2">${t('memberCase.status')}</th>
          <th class="text-left px-4 py-2"></th>
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-100"></tbody>
    `;
    const tbody = table.querySelector('tbody');

    // Mirrors the RLS update policy (sql/saas_platform/98) as closely
    // as this client can -- super_admin/pastor_admin/Intercession's
    // own admin-secretary, same as the creator. Doesn't yet check
    // Church Admin client-side (that flag isn't loaded here, same gap
    // noted in Part 3's attendance widening) -- a Church Admin who
    // didn't create the case would still have the RLS access but miss
    // these controls until Part 6 loads that flag; the server-side
    // check is what actually matters, this is just UI convenience.
    const canManageAny = getGlobalRole() === 'super_admin'
      || getGlobalRole() === 'pastor_admin'
      || getMyDepartments().some((d) => d.key === 'intercession' && (d.role === 'admin' || d.role === 'secretary'));

    cases.forEach((c) => {
      const canManage = c.created_by === currentUserId || canManageAny;
      const tr = document.createElement('tr');

      const nameCell = document.createElement('td');
      nameCell.className = 'px-4 py-2.5 font-medium whitespace-nowrap';
      const nameBtn = document.createElement('button');
      nameBtn.type = 'button';
      nameBtn.className = 'text-slate-800 hover:text-indigo-600 hover:underline';
      nameBtn.textContent = c.person_name;
      nameBtn.addEventListener('click', () => detailsRow.classList.toggle('hidden'));
      nameCell.appendChild(nameBtn);
      tr.appendChild(nameCell);

      const openedByCell = document.createElement('td');
      openedByCell.className = 'px-4 py-2.5 text-slate-500';
      openedByCell.textContent = c.creator?.full_name || '—';
      tr.appendChild(openedByCell);

      const statusCell = document.createElement('td');
      statusCell.className = 'px-4 py-2.5';
      if (canManage) {
        const statusSelect = document.createElement('select');
        statusSelect.className = 'border border-slate-300 rounded-lg px-2 py-1 text-sm';
        statusSelect.innerHTML = STATUSES.map((s) => `<option value="${s}" ${s === c.status ? 'selected' : ''}>${t(`urgentPrayer.status.${s}`)}</option>`).join('');
        statusSelect.addEventListener('change', () => updateCaseStatus(c.id, statusSelect.value));
        statusCell.appendChild(statusSelect);
      } else {
        statusCell.textContent = t(`urgentPrayer.status.${c.status}`);
      }
      tr.appendChild(statusCell);

      const actionsCell = document.createElement('td');
      actionsCell.className = 'px-4 py-2.5';
      if (canManage) {
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'text-xs font-medium text-rose-600 hover:text-rose-800';
        deleteBtn.textContent = t('moderation.delete');
        deleteBtn.addEventListener('click', () => deleteCase(c));
        actionsCell.appendChild(deleteBtn);
      }
      tr.appendChild(actionsCell);

      tbody.appendChild(tr);

      const detailsRow = document.createElement('tr');
      detailsRow.className = 'hidden bg-slate-50';
      const detailsCell = document.createElement('td');
      detailsCell.colSpan = 4;
      detailsCell.className = 'px-4 py-3 text-sm text-slate-600 space-y-3';

      if (canManage) {
        const needEl = document.createElement('div');
        needEl.innerHTML = `
          <label class="block font-medium text-slate-700 mb-1">${escapeHtml(t('urgentPrayer.need'))}</label>
          <textarea data-el="need-edit" rows="3" class="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white">${escapeHtml(c.need_description || '')}</textarea>
          <div class="flex items-center gap-2 mt-1">
            <button type="button" data-action="save-need" class="px-2.5 py-1 rounded-lg border border-slate-300 text-xs font-medium text-slate-600 hover:bg-white">
              ${t('common.saveNote')}
            </button>
            <span data-el="need-save-status" class="text-xs text-slate-500"></span>
          </div>
        `;
        needEl.querySelector('[data-action="save-need"]').addEventListener('click', () => saveNeedDescription(c.id, needEl));
        detailsCell.appendChild(needEl);
      } else if (c.need_description) {
        const needEl = document.createElement('div');
        needEl.innerHTML = `<span class="font-medium text-slate-700">${escapeHtml(t('urgentPrayer.need'))}:</span> ${escapeHtml(c.need_description)}`;
        detailsCell.appendChild(needEl);
      }

      if (canManage) {
        const viewersEl = document.createElement('div');
        viewersEl.className = 'border-t border-slate-200 pt-2';
        viewersEl.innerHTML = `<div class="font-medium text-slate-700 mb-1">${t('urgentPrayer.sharedWith')}</div><div data-el="viewer-chips" class="flex flex-wrap gap-1.5 mb-2"></div>`;
        detailsCell.appendChild(viewersEl);
        loadCaseViewers(c.id, viewersEl.querySelector('[data-el="viewer-chips"]'));
      }

      detailsRow.appendChild(detailsCell);
      tbody.appendChild(detailsRow);
    });

    bodyEl.innerHTML = '';
    bodyEl.appendChild(table);
  }

  async function loadCaseViewers(caseId, chipsEl) {
    const { data } = await supabase
      .from('urgent_prayer_case_viewers')
      .select('user_id, viewer:profiles!user_id ( full_name )')
      .eq('case_id', caseId);

    const current = data || [];
    chipsEl.innerHTML = current.length === 0
      ? `<span class="text-xs text-slate-400">${t('urgentPrayer.noneShared')}</span>`
      : current.map((v) => `
          <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-600" data-user-id="${v.user_id}">
            ${escapeHtml(v.viewer?.full_name || '—')}
            <button type="button" data-action="remove-viewer" class="text-slate-400 hover:text-rose-600">&times;</button>
          </span>
        `).join('');
    chipsEl.querySelectorAll('[data-action="remove-viewer"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const userId = btn.closest('[data-user-id]').dataset.userId;
        await supabase.from('urgent_prayer_case_viewers').delete().eq('case_id', caseId).eq('user_id', userId);
        loadCaseViewers(caseId, chipsEl);
      });
    });
  }

  async function saveNeedDescription(caseId, needEl) {
    const textarea = needEl.querySelector('[data-el="need-edit"]');
    const statusEl = needEl.querySelector('[data-el="need-save-status"]');
    statusEl.className = 'text-xs text-slate-500';
    statusEl.textContent = t('common.saving');
    const { error } = await supabase.from('urgent_prayer_cases')
      .update({ need_description: textarea.value.trim() || null, updated_at: new Date().toISOString() })
      .eq('id', caseId);
    if (error) {
      statusEl.className = 'text-xs text-rose-600';
      statusEl.textContent = t('common.saveFailed', { message: error.message });
      return;
    }
    statusEl.className = 'text-xs text-emerald-600';
    statusEl.textContent = t('common.saved');
  }

  async function updateCaseStatus(caseId, status) {
    const { error } = await supabase.from('urgent_prayer_cases').update({ status, updated_at: new Date().toISOString() }).eq('id', caseId);
    if (error) {
      window.alert(t('urgentPrayer.updateFailed', { message: error.message }));
      return;
    }
    load();
  }

  async function deleteCase(caseRow) {
    const confirmed = await confirmDialog({ message: t('urgentPrayer.confirmDelete', { name: caseRow.person_name }) });
    if (!confirmed) return;

    const { error } = await supabase.from('urgent_prayer_cases').delete().eq('id', caseRow.id);
    if (error) {
      window.alert(t('urgentPrayer.deleteFailed', { message: error.message }));
      return;
    }
    load();
  }

  (async () => {
    await Promise.all([loadMembers(), loadAdmins()]);
    await load();
  })();
}

export function createUrgentPrayerCasesModal({ supabase, currentUserId }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${t('urgentPrayer.title')}</h2>
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
    renderUrgentPrayerCases(root.querySelector('[data-el="body"]'), { supabase, currentUserId });
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
