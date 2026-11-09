// Member Directory (Feature 2 of 3, part 3b) -- the searchable/
// filterable table of every row in `members`, modeled on
// silentDirectory.js's structure (single flat query, inline per-row
// actions, modal wrapper) crossed with userManager.js's column-
// visibility/filter/sort conventions.
//
// Newcomer rows are highlighted orange, Left rows are greyed out --
// per the spec. "Mark as left" (Feature 3) opens the shared exit-
// reason dialog and calls record_member_exit() directly rather than
// remove_user_from_church() -- a member here can have no linked
// login (profile_id null), so there's no profiles.id to pass that
// RPC, and it's super-admin-only while this Directory is pastoral-
// team-gated.
import { t } from '../i18n.js';
import { GENDERS, MARITAL_STATUSES, AGE_GROUPS, SKILLS } from './memberRegistrationFields.js';
import { exportRowsToExcel, exportRowsToCsv } from '../utils/tableExport.js';
import { exportMemberDirectoryPdf } from './memberDirectoryPdf.js';
import { openMemberExitModal } from './memberExitModal.js';

const COLUMN_DEFS = [
  { key: 'gender', label: 'memberDirectory.colGender' },
  { key: 'marital_status', label: 'memberDirectory.colMaritalStatus' },
  { key: 'age_group', label: 'memberDirectory.colAgeGroup' },
  { key: 'phone', label: 'memberDirectory.colPhone' },
  { key: 'email', label: 'memberDirectory.colEmail' },
  { key: 'career', label: 'memberDirectory.colCareer' },
  { key: 'skills', label: 'memberDirectory.colSkills' },
  { key: 'address', label: 'memberDirectory.colAddress' },
];
const DEFAULT_VISIBLE = ['phone', 'email', 'age_group'];

export function renderMemberDirectory(container, { supabase }) {
  const bodyEl = container;
  let rows = [];
  let searchQuery = '';
  let statusFilter = 'all';
  let genderFilter = '';
  let maritalFilter = '';
  let ageGroupFilter = '';
  let skillFilter = '';
  let sortBy = 'full_name';
  const visibleColumns = new Set(DEFAULT_VISIBLE);
  let selectedIds = new Set();
  let detailEl = null;

  bodyEl.innerHTML = `
    <div class="flex flex-wrap items-center gap-2 mb-3">
      <input type="search" data-el="search" placeholder="${t('memberDirectory.searchPlaceholder')}"
             class="border border-slate-300 rounded-lg px-3 py-1.5 text-sm flex-1 min-w-[160px]" />
      <select data-el="status-filter" class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
        <option value="all">${t('memberDirectory.filterAllStatuses')}</option>
        <option value="Newcomer">${t('memberDirectory.statusNewcomer')}</option>
        <option value="Member">${t('memberDirectory.statusMember')}</option>
        <option value="Left">${t('memberDirectory.statusLeft')}</option>
      </select>
      <select data-el="gender-filter" class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
        <option value="">${t('memberRegistration.gender')}</option>
        ${GENDERS.map((g) => `<option value="${g}">${t(g === 'M' ? 'memberCard.male' : 'memberCard.female')}</option>`).join('')}
      </select>
      <select data-el="marital-filter" class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
        <option value="">${t('memberRegistration.maritalStatus')}</option>
        ${MARITAL_STATUSES.map((m) => `<option value="${m}">${t(`memberRegistration.maritalStatus.${m}`)}</option>`).join('')}
      </select>
      <select data-el="age-filter" class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
        <option value="">${t('memberRegistration.ageGroup')}</option>
        ${AGE_GROUPS.map((a) => `<option value="${a}">${t(`attendance.ageRange.${a}`)}</option>`).join('')}
      </select>
      <select data-el="skill-filter" class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
        <option value="">${t('memberRegistration.skills')}</option>
        ${SKILLS.map((s) => `<option value="${s}">${t(`memberRegistration.skill.${s}`)}</option>`).join('')}
      </select>
      <select data-el="sort-by" class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
        <option value="full_name">${t('memberDirectory.sortName')}</option>
        <option value="status">${t('memberDirectory.sortStatus')}</option>
        <option value="registered_at">${t('memberDirectory.sortRegistered')}</option>
      </select>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
      <div data-el="counters" class="text-xs text-slate-500"></div>
      <div class="flex items-center gap-3">
        <div class="flex items-center gap-2 text-xs text-slate-500">
          ${COLUMN_DEFS.map((c) => `
            <label class="flex items-center gap-1">
              <input type="checkbox" data-el="col-toggle" data-col="${c.key}" ${visibleColumns.has(c.key) ? 'checked' : ''} class="rounded border-slate-300">
              ${t(c.label)}
            </label>
          `).join('')}
        </div>
        <div class="flex items-center gap-1.5">
          <button type="button" data-action="export-excel" class="px-2.5 py-1 rounded-lg border border-slate-300 text-xs font-medium text-slate-600 hover:bg-slate-50">${t('memberDirectory.exportExcel')}</button>
          <button type="button" data-action="export-csv" class="px-2.5 py-1 rounded-lg border border-slate-300 text-xs font-medium text-slate-600 hover:bg-slate-50">${t('memberDirectory.exportCsv')}</button>
          <button type="button" data-action="export-pdf" class="px-2.5 py-1 rounded-lg border border-slate-300 text-xs font-medium text-slate-600 hover:bg-slate-50">${t('memberDirectory.exportPdf')}</button>
        </div>
      </div>
    </div>

    <div data-el="bulk-bar" class="hidden mb-2 flex items-center gap-2 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-1.5 text-sm">
      <span data-el="bulk-count"></span>
      <button type="button" data-action="bulk-mark-member" class="text-indigo-700 font-medium hover:text-indigo-900">${t('memberDirectory.markAsMember')}</button>
    </div>

    <div data-el="table-wrap"></div>
    <div data-el="detail"></div>
  `;

  const searchEl = bodyEl.querySelector('[data-el="search"]');
  const statusFilterEl = bodyEl.querySelector('[data-el="status-filter"]');
  const genderFilterEl = bodyEl.querySelector('[data-el="gender-filter"]');
  const maritalFilterEl = bodyEl.querySelector('[data-el="marital-filter"]');
  const ageFilterEl = bodyEl.querySelector('[data-el="age-filter"]');
  const skillFilterEl = bodyEl.querySelector('[data-el="skill-filter"]');
  const sortByEl = bodyEl.querySelector('[data-el="sort-by"]');
  const tableWrapEl = bodyEl.querySelector('[data-el="table-wrap"]');
  const countersEl = bodyEl.querySelector('[data-el="counters"]');
  const bulkBarEl = bodyEl.querySelector('[data-el="bulk-bar"]');
  detailEl = bodyEl.querySelector('[data-el="detail"]');

  searchEl.addEventListener('input', () => { searchQuery = searchEl.value.trim().toLowerCase(); renderTable(); });
  statusFilterEl.addEventListener('change', () => { statusFilter = statusFilterEl.value; renderTable(); });
  genderFilterEl.addEventListener('change', () => { genderFilter = genderFilterEl.value; renderTable(); });
  maritalFilterEl.addEventListener('change', () => { maritalFilter = maritalFilterEl.value; renderTable(); });
  ageFilterEl.addEventListener('change', () => { ageGroupFilter = ageFilterEl.value; renderTable(); });
  skillFilterEl.addEventListener('change', () => { skillFilter = skillFilterEl.value; renderTable(); });
  sortByEl.addEventListener('change', () => { sortBy = sortByEl.value; renderTable(); });
  bodyEl.querySelectorAll('[data-el="col-toggle"]').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) visibleColumns.add(cb.dataset.col); else visibleColumns.delete(cb.dataset.col);
      renderTable();
    });
  });
  bodyEl.querySelector('[data-action="export-excel"]').addEventListener('click', () => exportRowsToExcel(buildExportRows(), 'members'));
  bodyEl.querySelector('[data-action="export-csv"]').addEventListener('click', () => exportRowsToCsv(buildExportRows(), 'members'));
  bodyEl.querySelector('[data-action="export-pdf"]').addEventListener('click', () => exportMemberDirectoryPdf({
    rows: filteredSortedRows(),
    columns: visibleColumnDefs(),
    filtersSummary: filtersSummaryText(),
  }));
  bodyEl.querySelector('[data-action="bulk-mark-member"]').addEventListener('click', bulkMarkAsMember);

  async function load() {
    tableWrapEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;
    const { data, error } = await supabase
      .from('members')
      .select('id, profile_id, full_name, gender, marital_status, address_street, address_city, address_province, address_postal, age_group, career, phone, email, skills, skills_other, status, possible_duplicate_of, registered_at, created_at')
      .order('full_name');

    if (error) {
      tableWrapEl.innerHTML = `<p class="text-sm text-rose-600">${t('memberDirectory.loadFailed', { message: error.message })}</p>`;
      return;
    }

    rows = data || [];
    selectedIds = new Set();
    renderCounters();
    renderTable();
  }

  function renderCounters() {
    const total = rows.length;
    const newcomers = rows.filter((r) => r.status === 'Newcomer').length;
    const now = new Date();
    const newcomersThisMonth = rows.filter((r) => {
      if (r.status !== 'Newcomer') return false;
      const d = new Date(r.registered_at || r.created_at);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }).length;
    countersEl.textContent = t('memberDirectory.counters', { total, newcomers, newcomersThisMonth });
  }

  function visibleColumnDefs() {
    return COLUMN_DEFS.filter((c) => visibleColumns.has(c.key));
  }

  function filtersSummaryText() {
    const bits = [];
    if (statusFilter !== 'all') bits.push(t(`memberDirectory.status${statusFilter}`));
    if (genderFilter) bits.push(t(genderFilter === 'M' ? 'memberCard.male' : 'memberCard.female'));
    if (maritalFilter) bits.push(t(`memberRegistration.maritalStatus.${maritalFilter}`));
    if (ageGroupFilter) bits.push(t(`attendance.ageRange.${ageGroupFilter}`));
    if (skillFilter) bits.push(t(`memberRegistration.skill.${skillFilter}`));
    if (searchQuery) bits.push(`"${searchQuery}"`);
    return bits.join(', ') || t('memberDirectory.filterAllStatuses');
  }

  function filteredSortedRows() {
    let filtered = rows.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (genderFilter && r.gender !== genderFilter) return false;
      if (maritalFilter && r.marital_status !== maritalFilter) return false;
      if (ageGroupFilter && r.age_group !== ageGroupFilter) return false;
      if (skillFilter && !(r.skills || []).includes(skillFilter)) return false;
      if (searchQuery) {
        const hay = [r.full_name, r.phone, r.email].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(searchQuery)) return false;
      }
      return true;
    });

    filtered = filtered.slice().sort((a, b) => {
      if (sortBy === 'status') return (a.status || '').localeCompare(b.status || '') || (a.full_name || '').localeCompare(b.full_name || '');
      if (sortBy === 'registered_at') return new Date(b.registered_at || b.created_at) - new Date(a.registered_at || a.created_at);
      return (a.full_name || '').localeCompare(b.full_name || '');
    });

    return filtered;
  }

  function addressText(r) {
    return [r.address_street, r.address_city, r.address_province, r.address_postal].filter(Boolean).join(', ');
  }

  function skillsText(r) {
    const named = (r.skills || []).map((s) => t(`memberRegistration.skill.${s}`));
    return [...named, r.skills_other].filter(Boolean).join(', ');
  }

  function cellValue(r, key) {
    switch (key) {
      case 'gender': return r.gender ? t(r.gender === 'M' ? 'memberCard.male' : 'memberCard.female') : '';
      case 'marital_status': return r.marital_status ? t(`memberRegistration.maritalStatus.${r.marital_status}`) : '';
      case 'age_group': return r.age_group ? t(`attendance.ageRange.${r.age_group}`) : '';
      case 'phone': return r.phone || '';
      case 'email': return r.email || '';
      case 'career': return r.career || '';
      case 'skills': return skillsText(r);
      case 'address': return addressText(r);
      default: return '';
    }
  }

  function buildExportRows() {
    const cols = visibleColumnDefs();
    return filteredSortedRows().map((r) => {
      const obj = { [t('memberDirectory.colName')]: r.full_name, [t('memberDirectory.colStatus')]: t(`memberDirectory.status${r.status}`) };
      cols.forEach((c) => { obj[t(c.label)] = cellValue(r, c.key); });
      return obj;
    });
  }

  function renderTable() {
    const filtered = filteredSortedRows();
    const cols = visibleColumnDefs();

    if (filtered.length === 0) {
      tableWrapEl.innerHTML = `<p class="text-sm text-slate-500">${t('memberDirectory.none')}</p>`;
      updateBulkBar();
      return;
    }

    const table = document.createElement('table');
    table.className = 'w-full text-sm';
    table.innerHTML = `
      <thead class="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
        <tr>
          <th class="w-8 px-2 py-2"><input type="checkbox" data-el="select-all" class="rounded border-slate-300" /></th>
          <th class="text-left px-4 py-2">${t('memberDirectory.colName')}</th>
          <th class="text-left px-4 py-2">${t('memberDirectory.colStatus')}</th>
          ${cols.map((c) => `<th class="text-left px-4 py-2">${t(c.label)}</th>`).join('')}
          <th class="text-left px-4 py-2"></th>
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-100"></tbody>
    `;
    const tbody = table.querySelector('tbody');

    filtered.forEach((row) => {
      const tr = document.createElement('tr');
      tr.className = row.status === 'Newcomer' ? 'bg-orange-50' : row.status === 'Left' ? 'bg-slate-100 text-slate-400' : '';

      const selectCell = document.createElement('td');
      selectCell.className = 'px-2 py-2';
      const selectCb = document.createElement('input');
      selectCb.type = 'checkbox';
      selectCb.className = 'rounded border-slate-300';
      selectCb.checked = selectedIds.has(row.id);
      selectCb.addEventListener('change', () => {
        if (selectCb.checked) selectedIds.add(row.id); else selectedIds.delete(row.id);
        updateBulkBar();
      });
      selectCell.appendChild(selectCb);
      tr.appendChild(selectCell);

      const nameCell = document.createElement('td');
      nameCell.className = 'px-4 py-2.5 font-medium whitespace-nowrap';
      const nameBtn = document.createElement('button');
      nameBtn.type = 'button';
      nameBtn.className = 'text-slate-800 hover:text-indigo-600 hover:underline text-left';
      nameBtn.textContent = row.full_name;
      nameBtn.addEventListener('click', () => openDetail(row));
      nameCell.appendChild(nameBtn);
      if (row.possible_duplicate_of) {
        const dupBadge = document.createElement('span');
        dupBadge.className = 'ml-1.5 inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700';
        dupBadge.textContent = t('memberDirectory.possibleDuplicate');
        nameCell.appendChild(dupBadge);
      }
      tr.appendChild(nameCell);

      const statusCell = document.createElement('td');
      statusCell.className = 'px-4 py-2.5';
      statusCell.appendChild(statusBadge(row.status));
      tr.appendChild(statusCell);

      cols.forEach((c) => {
        const td = document.createElement('td');
        td.className = 'px-4 py-2.5 text-slate-600';
        td.textContent = cellValue(row, c.key) || '—';
        tr.appendChild(td);
      });

      const actionsCell = document.createElement('td');
      actionsCell.className = 'px-4 py-2.5 whitespace-nowrap space-x-2';
      if (row.possible_duplicate_of) {
        const mergeBtn = document.createElement('button');
        mergeBtn.type = 'button';
        mergeBtn.className = 'text-xs font-medium text-indigo-600 hover:text-indigo-800';
        mergeBtn.textContent = t('memberDirectory.merge');
        mergeBtn.addEventListener('click', () => mergeDuplicate(row));
        actionsCell.appendChild(mergeBtn);

        const keepBtn = document.createElement('button');
        keepBtn.type = 'button';
        keepBtn.className = 'text-xs font-medium text-slate-500 hover:text-slate-700';
        keepBtn.textContent = t('memberDirectory.keepAsNew');
        keepBtn.addEventListener('click', () => keepAsNew(row));
        actionsCell.appendChild(keepBtn);
      } else {
        if (row.status === 'Newcomer') {
          const markBtn = document.createElement('button');
          markBtn.type = 'button';
          markBtn.className = 'text-xs font-medium text-indigo-600 hover:text-indigo-800';
          markBtn.textContent = t('memberDirectory.markAsMember');
          markBtn.addEventListener('click', () => markAsMember(row));
          actionsCell.appendChild(markBtn);
        }
        if (row.status !== 'Left') {
          const leftBtn = document.createElement('button');
          leftBtn.type = 'button';
          leftBtn.className = 'text-xs font-medium text-rose-600 hover:text-rose-800';
          leftBtn.textContent = t('memberDirectory.markAsLeft');
          leftBtn.addEventListener('click', () => markAsLeft(row));
          actionsCell.appendChild(leftBtn);
        }
      }
      tr.appendChild(actionsCell);

      tbody.appendChild(tr);
    });

    tableWrapEl.innerHTML = '';
    tableWrapEl.appendChild(table);

    table.querySelector('[data-el="select-all"]').addEventListener('change', (e) => {
      if (e.target.checked) filtered.forEach((r) => selectedIds.add(r.id));
      else filtered.forEach((r) => selectedIds.delete(r.id));
      renderTable();
    });

    updateBulkBar();
  }

  function updateBulkBar() {
    if (selectedIds.size === 0) {
      bulkBarEl.classList.add('hidden');
      return;
    }
    bulkBarEl.classList.remove('hidden');
    bulkBarEl.querySelector('[data-el="bulk-count"]').textContent = t('memberDirectory.selectedCount', { count: selectedIds.size });
  }

  function statusBadge(status) {
    const span = document.createElement('span');
    const styles = { Newcomer: 'bg-orange-100 text-orange-700', Member: 'bg-slate-100 text-slate-600', Left: 'bg-slate-200 text-slate-500' };
    span.className = `inline-block px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] || styles.Member}`;
    span.textContent = t(`memberDirectory.status${status}`);
    return span;
  }

  async function markAsMember(row) {
    const { error } = await supabase.from('members').update({ status: 'Member' }).eq('id', row.id);
    if (error) { window.alert(t('memberDirectory.updateFailed', { message: error.message })); return; }
    load();
  }

  async function bulkMarkAsMember() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const { error } = await supabase.from('members').update({ status: 'Member' }).in('id', ids).eq('status', 'Newcomer');
    if (error) { window.alert(t('memberDirectory.updateFailed', { message: error.message })); return; }
    load();
  }

  async function mergeDuplicate(row) {
    const { error } = await supabase.rpc('merge_duplicate_member', { p_duplicate_id: row.id });
    if (error) { window.alert(t('memberDirectory.updateFailed', { message: error.message })); return; }
    load();
  }

  async function keepAsNew(row) {
    const { error } = await supabase.from('members').update({ possible_duplicate_of: null }).eq('id', row.id);
    if (error) { window.alert(t('memberDirectory.updateFailed', { message: error.message })); return; }
    load();
  }

  async function markAsLeft(row) {
    await openMemberExitModal({ supabase, member: row, onDone: load });
  }

  async function openDetail(row) {
    detailEl.innerHTML = `<div class="border-t border-slate-200 mt-3 pt-3"><p class="text-sm text-slate-500">${t('common.loading')}</p></div>`;
    const [{ data: history }, { data: exit }] = await Promise.all([
      supabase.from('member_history').select('field, old_value, new_value, changed_at').eq('member_id', row.id).order('changed_at', { ascending: false }),
      row.status === 'Left'
        ? supabase.from('member_exits').select('date_left, main_reason, reason_title, notes').eq('member_id', row.id).order('date_left', { ascending: false }).limit(1).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    detailEl.innerHTML = `
      <div class="border-t border-slate-200 mt-3 pt-3">
        <div class="flex items-center justify-between mb-2">
          <h3 class="text-sm font-semibold text-slate-700">${escapeHtml(row.full_name)}</h3>
          <button type="button" data-action="close-detail" class="text-xs text-slate-400 hover:text-slate-600">${t('common.back')}</button>
        </div>
        <div class="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm text-slate-600 mb-3">
          ${COLUMN_DEFS.map((c) => `<div><span class="text-slate-400">${t(c.label)}:</span> ${escapeHtml(cellValue(row, c.key) || '—')}</div>`).join('')}
        </div>
        ${exit ? `
          <div class="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-3 text-sm text-slate-600">
            <p class="font-semibold text-slate-700 mb-1">${t('memberExit.exitRecordTitle')}</p>
            <p>${t('memberExit.colDateLeft')}: ${escapeHtml(exit.date_left)}</p>
            <p>${t('memberExit.colMainReason')}: ${escapeHtml(t(`exitReasons.${exit.main_reason}`))}</p>
            ${exit.reason_title ? `<p>${t('memberExit.colReasonTitle')}: ${escapeHtml(exit.reason_title)}</p>` : ''}
            ${exit.notes ? `<p>${t('memberExit.colNotes')}: ${escapeHtml(exit.notes)}</p>` : ''}
          </div>
        ` : ''}
        <h4 class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">${t('memberDirectory.changeHistory')}</h4>
        <div class="space-y-1 max-h-48 overflow-y-auto">
          ${(history || []).length > 0 ? history.map((h) => `
            <div class="text-xs text-slate-500">
              ${escapeHtml(new Date(h.changed_at).toLocaleString())} — <span class="font-medium">${escapeHtml(h.field)}</span>:
              ${escapeHtml(h.old_value || '—')} → ${escapeHtml(h.new_value || '—')}
            </div>
          `).join('') : `<p class="text-xs text-slate-400">${t('memberDirectory.noHistory')}</p>`}
        </div>
      </div>
    `;
    detailEl.querySelector('[data-action="close-detail"]').addEventListener('click', () => { detailEl.innerHTML = ''; });
  }

  load();
}

export function createMemberDirectoryModal({ supabase, title }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[85vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${title}</h2>
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
    renderMemberDirectory(root.querySelector('[data-el="body"]'), { supabase });
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
