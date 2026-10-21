// Member Cases — an internal admin/pastoral-only file about an
// existing member (never the guest/visitor kind — see
// guestOnboardingHub.js for that), used when an admin notices someone
// who needs follow-up (prayer, support, a pastoral conversation, ...)
// and wants another department to pick it up. Creation is admin-only —
// never self-service — and the member the case is about never sees it.
//
// scope: { type: 'pastoral' } — Super Admin/Pastor Admin/Church
//   Secretary, sees every case regardless of which department holds
//   it, can open a case in any department.
// scope: { type: 'department', departmentId } — that department's own
//   admin, sees only cases currently assigned to them (see sql/043's
//   RLS), can open a new case (starting in their own department) and
//   send an existing one onward.
//
// "Send to Department" moves the same row — never duplicated — and
// every hop is logged in member_case_transfers, mirroring Guest Cases'
// transfer history exactly.
import { confirmDialog } from './confirmDialog.js';
import { t, departmentLabel } from '../i18n.js';

const STATUSES = ['open', 'in_progress', 'resolved'];

// Mountable render function (the pastoral dashboard's own Member
// Cases tab mounts this directly) plus a thin modal wrapper around
// it, same split userManager.js's renderUserManager/
// createUserManagerModal already uses.
export function renderMemberCases(container, { supabase, currentUserId, scope }) {
  container.innerHTML = `
    <button type="button" data-action="toggle-new-case" class="mb-3 px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">
      ${t('memberCase.newCase')}
    </button>

    <div data-el="create-form" class="hidden border border-slate-200 rounded-lg p-4 mb-4 space-y-2">
      <label class="block text-sm font-medium text-slate-600">${t('memberCase.member')}</label>
      <input type="search" data-el="member-search" placeholder="${t('memberCase.memberSearchPlaceholder')}"
             class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      <div data-el="member-results" class="max-h-32 overflow-y-auto border border-slate-100 rounded-lg divide-y"></div>
      <p data-el="member-selected" class="text-sm text-slate-500"></p>

      <label class="block text-sm font-medium text-slate-600">${t('memberCase.note')}</label>
      <textarea data-el="case-note" rows="3" placeholder="${t('memberCase.notePlaceholder')}"
                class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"></textarea>

      <div data-el="department-picker-wrap" class="hidden">
        <label class="block text-sm font-medium text-slate-600 mb-1">${t('memberCase.startingDepartment')}</label>
        <select data-el="case-department" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"></select>
      </div>

      <div class="flex items-center gap-3">
        <button type="button" data-action="submit-case" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">
          ${t('memberCase.createCase')}
        </button>
        <span data-el="create-status" class="text-sm text-slate-500"></span>
      </div>
    </div>

    <div data-el="body"></div>
  `;

  const newCaseBtn = container.querySelector('[data-action="toggle-new-case"]');
  const createFormEl = container.querySelector('[data-el="create-form"]');
  const memberSearchEl = container.querySelector('[data-el="member-search"]');
  const memberResultsEl = container.querySelector('[data-el="member-results"]');
  const memberSelectedEl = container.querySelector('[data-el="member-selected"]');
  const caseNoteEl = container.querySelector('[data-el="case-note"]');
  const departmentPickerWrapEl = container.querySelector('[data-el="department-picker-wrap"]');
  const caseDepartmentEl = container.querySelector('[data-el="case-department"]');
  const createStatusEl = container.querySelector('[data-el="create-status"]');
  const submitCaseBtn = container.querySelector('[data-action="submit-case"]');
  const bodyEl = container.querySelector('[data-el="body"]');

  let departments = [];
  let members = [];
  let selectedMemberId = null;

  newCaseBtn.addEventListener('click', () => {
    createFormEl.classList.toggle('hidden');
    if (!createFormEl.classList.contains('hidden')) resetCreateForm();
  });

  function resetCreateForm() {
    memberSearchEl.value = '';
    memberResultsEl.innerHTML = '';
    memberSelectedEl.textContent = '';
    selectedMemberId = null;
    caseNoteEl.value = '';
    createStatusEl.textContent = '';

    departmentPickerWrapEl.classList.toggle('hidden', scope.type !== 'pastoral');
    if (scope.type === 'pastoral') {
      caseDepartmentEl.innerHTML = departments.map((d) => `<option value="${d.id}">${departmentLabel(d.key)}</option>`).join('');
    }
  }

  memberSearchEl.addEventListener('input', () => renderMemberResults(memberSearchEl.value.trim().toLowerCase()));

  function renderMemberResults(query) {
    const matches = query ? members.filter((m) => m.full_name.toLowerCase().includes(query)) : [];
    memberResultsEl.innerHTML = matches.slice(0, 15).map((m) => `
      <button type="button" data-member-id="${m.id}" class="w-full text-left px-2 py-1.5 text-sm hover:bg-slate-100">${escapeHtml(m.full_name)}</button>
    `).join('');
    memberResultsEl.querySelectorAll('[data-member-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedMemberId = btn.dataset.memberId;
        memberSelectedEl.textContent = `${t('memberCase.member')}: ${btn.textContent.trim()}`;
        memberResultsEl.innerHTML = '';
        memberSearchEl.value = '';
      });
    });
  }

  submitCaseBtn.addEventListener('click', async () => {
    const note = caseNoteEl.value.trim();
    if (!selectedMemberId) {
      createStatusEl.className = 'text-sm text-rose-600';
      createStatusEl.textContent = t('memberCase.noMemberSelected');
      return;
    }
    if (!note) {
      createStatusEl.className = 'text-sm text-rose-600';
      createStatusEl.textContent = t('memberCase.emptyNote');
      return;
    }

    const departmentId = scope.type === 'pastoral' ? caseDepartmentEl.value : scope.departmentId;

    submitCaseBtn.disabled = true;
    createStatusEl.className = 'text-sm text-slate-500';
    createStatusEl.textContent = t('common.saving');

    const { error } = await supabase.from('member_cases').insert({
      subject_user_id: selectedMemberId,
      note,
      assigned_department_id: departmentId,
      created_by: currentUserId,
    });

    submitCaseBtn.disabled = false;
    if (error) {
      createStatusEl.className = 'text-sm text-rose-600';
      createStatusEl.textContent = t('memberCase.createFailed', { message: error.message });
      return;
    }

    createFormEl.classList.add('hidden');
    load();
  });

  async function loadMembers() {
    const { data } = await supabase
      .from('department_memberships')
      .select('user_id, member:profiles!user_id ( id, full_name )')
      .eq('status', 'approved');

    const byId = new Map();
    (data || []).forEach((r) => { if (r.member) byId.set(r.member.id, r.member.full_name); });
    members = Array.from(byId.entries()).map(([id, full_name]) => ({ id, full_name })).sort((a, b) => a.full_name.localeCompare(b.full_name));
  }

  async function load() {
    bodyEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    let casesQuery = supabase
      .from('member_cases')
      .select('id, note, status, assigned_department_id, created_at, subject:profiles!subject_user_id ( full_name ), creator:profiles!created_by ( full_name )')
      .order('created_at', { ascending: false });
    if (scope.type === 'department') casesQuery = casesQuery.eq('assigned_department_id', scope.departmentId);

    const { data: cases, error: casesError } = await casesQuery;
    if (casesError) {
      bodyEl.innerHTML = `<p class="text-sm text-rose-600">${t('memberCase.loadFailed', { message: casesError.message })}</p>`;
      return;
    }

    if ((cases || []).length === 0) {
      bodyEl.innerHTML = `<p class="text-sm text-slate-500">${t('memberCase.none')}</p>`;
      return;
    }

    const caseIds = cases.map((c) => c.id);
    const { data: transfers } = await supabase.from('member_case_transfers').select('member_case_id, from_department_id, to_department_id, note, created_at').in('member_case_id', caseIds).order('created_at');
    const transfersByCase = new Map();
    (transfers || []).forEach((tr) => {
      if (!transfersByCase.has(tr.member_case_id)) transfersByCase.set(tr.member_case_id, []);
      transfersByCase.get(tr.member_case_id).push(tr);
    });

    const table = document.createElement('table');
    table.className = 'w-full text-sm';
    table.innerHTML = `
      <thead class="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
        <tr>
          <th class="text-left px-4 py-2">${t('memberCase.member')}</th>
          <th class="text-left px-4 py-2">${t('memberCase.openedBy')}</th>
          <th class="text-left px-4 py-2">${t('memberCase.status')}</th>
          <th class="text-left px-4 py-2">${t('guestHub.department')}</th>
          ${scope.type === 'pastoral' ? `<th class="text-left px-4 py-2"></th>` : ''}
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-100"></tbody>
    `;
    const tbody = table.querySelector('tbody');

    cases.forEach((c) => {
      const tr = document.createElement('tr');

      const nameCell = document.createElement('td');
      nameCell.className = 'px-4 py-2.5 font-medium whitespace-nowrap';
      const nameBtn = document.createElement('button');
      nameBtn.type = 'button';
      nameBtn.className = 'text-slate-800 hover:text-indigo-600 hover:underline';
      nameBtn.textContent = c.subject?.full_name || '—';
      nameBtn.addEventListener('click', () => detailsRow.classList.toggle('hidden'));
      nameCell.appendChild(nameBtn);
      tr.appendChild(nameCell);

      const openedByCell = document.createElement('td');
      openedByCell.className = 'px-4 py-2.5 text-slate-500';
      openedByCell.textContent = c.creator?.full_name || '—';
      tr.appendChild(openedByCell);

      const statusCell = document.createElement('td');
      statusCell.className = 'px-4 py-2.5';
      const statusSelect = document.createElement('select');
      statusSelect.className = 'border border-slate-300 rounded-lg px-2 py-1 text-sm';
      statusSelect.innerHTML = STATUSES.map((s) => `<option value="${s}" ${s === c.status ? 'selected' : ''}>${t(`memberCase.status.${s}`)}</option>`).join('');
      statusSelect.addEventListener('change', () => updateCaseStatus(c.id, statusSelect.value));
      statusCell.appendChild(statusSelect);
      tr.appendChild(statusCell);

      const deptCell = document.createElement('td');
      deptCell.className = 'px-4 py-2.5';
      deptCell.textContent = c.assigned_department_id ? departmentLabel(departments.find((d) => d.id === c.assigned_department_id)?.key) : '—';
      tr.appendChild(deptCell);

      if (scope.type === 'pastoral') {
        const actionsCell = document.createElement('td');
        actionsCell.className = 'px-4 py-2.5';
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'text-xs font-medium text-rose-600 hover:text-rose-800';
        deleteBtn.textContent = t('moderation.delete');
        deleteBtn.addEventListener('click', () => deleteCase(c));
        actionsCell.appendChild(deleteBtn);
        tr.appendChild(actionsCell);
      }

      tbody.appendChild(tr);

      const detailsRow = document.createElement('tr');
      detailsRow.className = 'hidden bg-slate-50';
      const detailsCell = document.createElement('td');
      detailsCell.colSpan = scope.type === 'pastoral' ? 5 : 4;
      detailsCell.className = 'px-4 py-3 text-sm text-slate-600 space-y-3';

      const noteEl = document.createElement('div');
      noteEl.innerHTML = `
        <label class="block font-medium text-slate-700 mb-1">${escapeHtml(t('memberCase.note'))}</label>
        <textarea data-el="case-note-edit" rows="3" class="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white">${escapeHtml(c.note)}</textarea>
        <div class="flex items-center gap-2 mt-1">
          <button type="button" data-action="save-case-note" class="px-2.5 py-1 rounded-lg border border-slate-300 text-xs font-medium text-slate-600 hover:bg-white">
            ${t('common.saveNote')}
          </button>
          <span data-el="note-save-status" class="text-xs text-slate-500"></span>
        </div>
      `;
      noteEl.querySelector('[data-action="save-case-note"]').addEventListener('click', () => saveCaseNote(c.id, noteEl));
      detailsCell.appendChild(noteEl);

      const history = transfersByCase.get(c.id) || [];
      if (history.length > 0) {
        const historyEl = document.createElement('div');
        historyEl.innerHTML = `<div class="font-medium text-slate-700 mb-1">${t('guestHub.detail.history')}</div>` +
          history.map((h) => {
            const from = h.from_department_id ? departmentLabel(departments.find((d) => d.id === h.from_department_id)?.key) : t('memberCase.historyOpened');
            const to = departmentLabel(departments.find((d) => d.id === h.to_department_id)?.key);
            return `<div class="text-xs text-slate-500">${escapeHtml(h.created_at.slice(0, 10))} — ${escapeHtml(from)} → ${escapeHtml(to)}${h.note ? ` (${escapeHtml(h.note)})` : ''}</div>`;
          }).join('');
        detailsCell.appendChild(historyEl);
      }

      const transferForm = document.createElement('div');
      transferForm.className = 'border-t border-slate-200 pt-2 flex flex-wrap items-end gap-2';
      transferForm.innerHTML = `
        <div>
          <label class="block text-xs font-medium text-slate-500 mb-1">${t('guestHub.sendToDepartment')}</label>
          <select data-el="transfer-dept" class="border border-slate-300 rounded-lg px-2 py-1 text-sm">
            <option value="">${t('guestHub.selectDepartment')}</option>
            ${departments.filter((d) => d.id !== c.assigned_department_id).map((d) => `<option value="${d.id}">${departmentLabel(d.key)}</option>`).join('')}
          </select>
        </div>
        <div class="flex-1 min-w-[140px]">
          <label class="block text-xs font-medium text-slate-500 mb-1">${t('guestHub.transferNote')}</label>
          <input type="text" data-el="transfer-note" placeholder="${t('guestHub.transferNotePlaceholder')}" class="w-full border border-slate-300 rounded-lg px-2 py-1 text-sm" />
        </div>
        <button type="button" data-action="transfer" class="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">
          ${t('guestHub.send')}
        </button>
      `;
      const transferDeptSelect = transferForm.querySelector('[data-el="transfer-dept"]');
      const transferNoteInput = transferForm.querySelector('[data-el="transfer-note"]');
      transferForm.querySelector('[data-action="transfer"]').addEventListener('click', () => {
        if (!transferDeptSelect.value) return;
        sendCaseToDepartment(c, transferDeptSelect.value, transferNoteInput.value.trim());
      });
      detailsCell.appendChild(transferForm);

      detailsRow.appendChild(detailsCell);
      tbody.appendChild(detailsRow);
    });

    bodyEl.innerHTML = '';
    bodyEl.appendChild(table);
  }

  async function saveCaseNote(caseId, noteEl) {
    const textarea = noteEl.querySelector('[data-el="case-note-edit"]');
    const statusEl = noteEl.querySelector('[data-el="note-save-status"]');
    const note = textarea.value.trim();
    if (!note) {
      statusEl.className = 'text-xs text-rose-600';
      statusEl.textContent = t('memberCase.emptyNote');
      return;
    }
    statusEl.className = 'text-xs text-slate-500';
    statusEl.textContent = t('common.saving');
    const { error } = await supabase.from('member_cases').update({ note, updated_at: new Date().toISOString() }).eq('id', caseId);
    if (error) {
      statusEl.className = 'text-xs text-rose-600';
      statusEl.textContent = t('common.saveFailed', { message: error.message });
      return;
    }
    statusEl.className = 'text-xs text-emerald-600';
    statusEl.textContent = t('common.saved');
  }

  async function updateCaseStatus(caseId, status) {
    const { error } = await supabase.from('member_cases').update({ status, updated_at: new Date().toISOString() }).eq('id', caseId);
    if (error) {
      window.alert(t('memberCase.updateFailed', { message: error.message }));
      return;
    }
    load();
  }

  async function sendCaseToDepartment(caseRow, departmentId, note) {
    const confirmed = await confirmDialog({
      message: t('memberCase.confirmSend', { name: caseRow.subject?.full_name || '', department: departmentLabel(departments.find((d) => d.id === departmentId)?.key) }),
      confirmLabel: t('guestHub.send'),
      danger: false,
    });
    if (!confirmed) return;

    const { error } = await supabase.rpc('transfer_member_case_to_department', {
      p_member_case_id: caseRow.id,
      p_department_id: departmentId,
      p_note: note || null,
    });

    if (error) {
      window.alert(t('memberCase.updateFailed', { message: error.message }));
      return;
    }
    load();
  }

  async function deleteCase(caseRow) {
    const confirmed = await confirmDialog({ message: t('moderation.confirmDeleteCase') });
    if (!confirmed) return;

    const { error } = await supabase.from('member_cases').delete().eq('id', caseRow.id);
    if (error) {
      window.alert(t('moderation.deleteFailed', { message: error.message }));
      return;
    }
    load();
  }

  (async () => {
    const { data: depts } = await supabase.from('departments').select('id, key, name').order('name');
    departments = depts || [];
    await loadMembers();
    await load();
  })();
}

export function createMemberCaseModal({ supabase, currentUserId, scope }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${t('memberCase.title')}</h2>
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
    renderMemberCases(root.querySelector('[data-el="body"]'), { supabase, currentUserId, scope });
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
