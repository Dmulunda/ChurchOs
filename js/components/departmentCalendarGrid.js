// Department calendar — a monthly grid view of this department's own
// department_shifts (sql/*: date, title, notes), scoped to one
// department_id. Unlike Church Calendar (churchCalendarGrid.js), a
// single day here can hold several entries (no unique-date
// constraint on department_shifts), so each day cell stacks a chip
// per entry instead of showing at most one. Entries created or
// edited here are full department_shifts rows -- they show up in the
// existing shift list (departmentShiftBoard.js) too, same table,
// just a second view of it. Currently only mounted for Intercession
// (deptScheduling.js), but intentionally generic -- any lightweight
// department could use it.
import { formatDateLocal, todayLocal } from '../utils/date.js';
import { t, monthName } from '../i18n.js';
import { confirmDialog } from './confirmDialog.js';

const CHIP = 'bg-indigo-100 text-indigo-800 border border-indigo-200';

export function renderDepartmentCalendarGrid(container, { supabase, departmentId, canAdminister, currentUserId, onImportClick }) {
  let viewDate = new Date();
  viewDate.setDate(1);
  let shiftsByDate = new Map(); // dateStr -> [{ id, title, notes, createdBy, assignees: [{ user_id, full_name }] }]
  let draft = null; // { dateStr } for a new entry, or { id, dateStr, title, notes, assigneeIds } for editing
  let allMembers = []; // this department's approved members, for the assignee picker

  container.innerHTML = `
    <div class="flex items-center justify-between mb-4">
      <button type="button" data-action="prev-month" class="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700"><span aria-hidden="true">‹</span><span class="sr-only">${t('calendar.prevMonth')}</span></button>
      <h2 data-el="month-label" class="text-lg font-semibold"></h2>
      <div class="flex items-center gap-2">
        ${canAdminister && onImportClick ? `<button type="button" data-action="import-pdf" class="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm">${t('deptCalendar.importPdf')}</button>` : ''}
        <button type="button" data-action="next-month" class="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700"><span aria-hidden="true">›</span><span class="sr-only">${t('calendar.nextMonth')}</span></button>
      </div>
    </div>
    <div class="grid grid-cols-7 gap-1 text-center text-xs font-medium text-slate-500 mb-1">
      <div>${t('calendar.days.sun')}</div><div>${t('calendar.days.mon')}</div><div>${t('calendar.days.tue')}</div><div>${t('calendar.days.wed')}</div><div>${t('calendar.days.thu')}</div><div>${t('calendar.days.fri')}</div><div>${t('calendar.days.sat')}</div>
    </div>
    <div data-el="grid" class="grid grid-cols-7 gap-1"></div>
    <div data-el="entry-form" class="hidden mt-4 bg-slate-50 border border-slate-200 rounded-lg p-4"></div>
  `;

  const monthLabel = container.querySelector('[data-el="month-label"]');
  const grid = container.querySelector('[data-el="grid"]');
  const formEl = container.querySelector('[data-el="entry-form"]');

  container.querySelector('[data-action="prev-month"]').addEventListener('click', () => { viewDate.setMonth(viewDate.getMonth() - 1); loadMonth(); });
  container.querySelector('[data-action="next-month"]').addEventListener('click', () => { viewDate.setMonth(viewDate.getMonth() + 1); loadMonth(); });
  container.querySelector('[data-action="import-pdf"]')?.addEventListener('click', () => onImportClick());

  if (canAdminister) loadMemberOptions();
  loadMonth();

  async function loadMemberOptions() {
    const { data } = await supabase
      .from('department_memberships')
      .select('user_id, member:profiles!user_id ( full_name )')
      .eq('department_id', departmentId)
      .eq('status', 'approved');
    allMembers = (data || []).filter((m) => m.member);
  }

  async function loadMonth() {
    monthLabel.textContent = `${monthName(viewDate.getMonth())} ${viewDate.getFullYear()}`;
    hideForm();
    grid.innerHTML = `<p class="col-span-7 text-sm text-slate-500">${t('common.loading')}</p>`;

    const firstDay = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
    const lastDay = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0);
    const fromDate = formatDateLocal(firstDay);
    const toDate = formatDateLocal(lastDay);

    const { data } = await supabase
      .from('department_shifts')
      .select('id, date, title, notes, created_by, department_shift_assignments ( user_id, assignee:profiles!user_id ( full_name ) )')
      .eq('department_id', departmentId)
      .gte('date', fromDate).lte('date', toDate);

    shiftsByDate = new Map();
    (data || []).forEach((row) => {
      const assignees = (row.department_shift_assignments || [])
        .filter((a) => a.assignee?.full_name)
        .map((a) => ({ user_id: a.user_id, full_name: a.assignee.full_name }));
      const list = shiftsByDate.get(row.date) || [];
      list.push({ id: row.id, title: row.title, notes: row.notes, created_by: row.created_by, assignees });
      shiftsByDate.set(row.date, list);
    });

    renderGrid();
  }

  function renderGrid() {
    grid.innerHTML = '';
    const firstDay = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
    const lastDay = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0);
    for (let i = 0; i < firstDay.getDay(); i++) grid.appendChild(document.createElement('div'));

    const todayStr = todayLocal();
    for (let day = 1; day <= lastDay.getDate(); day++) {
      const cellDate = new Date(viewDate.getFullYear(), viewDate.getMonth(), day);
      const dateStr = formatDateLocal(cellDate);
      grid.appendChild(buildDayCell(dateStr, day, dateStr < todayStr));
    }
  }

  function buildDayCell(dateStr, day, isPast) {
    const cell = document.createElement('div');
    cell.className = 'border border-slate-200 rounded-lg p-1 flex flex-col gap-1 min-h-[3.5rem]';

    const dayNumEl = document.createElement('div');
    dayNumEl.className = `text-xs font-semibold px-0.5 ${isPast ? 'text-slate-300' : 'text-slate-500'}`;
    dayNumEl.textContent = String(day);
    cell.appendChild(dayNumEl);

    (shiftsByDate.get(dateStr) || []).forEach((shift) => {
      const names = shift.assignees.map((a) => a.full_name).join(', ');
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `text-left rounded px-1.5 py-0.5 text-[11px] font-semibold truncate ${CHIP}`;
      chip.title = `${dateStr} — ${shift.title}${names ? ` (${names})` : ''}`;
      chip.innerHTML = `<div class="truncate">${escapeHtml(shift.title)}</div>${names ? `<div class="truncate font-normal opacity-80">${escapeHtml(names)}</div>` : ''}`;
      if (canAdminister) chip.addEventListener('click', () => openEditForm(shift, dateStr));
      cell.appendChild(chip);
    });

    if (canAdminister && !isPast) {
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'text-left rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-400 hover:bg-slate-100 hover:text-slate-600 border border-dashed border-slate-300';
      addBtn.textContent = t('deptCalendar.addEntry');
      addBtn.addEventListener('click', () => openNewForm(dateStr));
      cell.appendChild(addBtn);
    }

    return cell;
  }

  function openNewForm(dateStr) {
    draft = { dateStr };
    renderForm();
  }

  function openEditForm(shift, dateStr) {
    draft = {
      id: shift.id, dateStr, title: shift.title, notes: shift.notes, createdBy: shift.created_by,
      assigneeIds: new Set(shift.assignees.map((a) => a.user_id)),
    };
    renderForm();
  }

  function renderForm() {
    const isEdit = Boolean(draft.id);
    const selectedIds = draft.assigneeIds || new Set();
    formEl.classList.remove('hidden');
    formEl.innerHTML = `
      <h3 class="text-sm font-semibold text-slate-700 mb-3">${t('deptCalendar.formTitle', { date: draft.dateStr })}</h3>
      <label class="block text-xs font-medium text-slate-600 mb-1">${t('deptCalendar.entryTitle')}</label>
      <input type="text" data-el="title" required value="${escapeAttr(draft.title || '')}" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-3" />
      <label class="block text-xs font-medium text-slate-600 mb-1">${t('deptScheduling.assignMembers')}</label>
      <select data-el="assignees" multiple size="5" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-3">
        ${allMembers.map((m) => `<option value="${m.user_id}" ${selectedIds.has(m.user_id) ? 'selected' : ''}>${escapeHtml(m.member.full_name)}</option>`).join('')}
      </select>
      <label class="block text-xs font-medium text-slate-600 mb-1">${t('deptCalendar.notes')}</label>
      <textarea data-el="notes" rows="2" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-3">${escapeHtml(draft.notes || '')}</textarea>
      <div class="flex items-center gap-3">
        <button type="button" data-action="submit" class="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">${t('deptCalendar.save')}</button>
        ${isEdit ? `<button type="button" data-action="delete" class="px-4 py-2 rounded-lg text-rose-600 hover:bg-rose-50 text-sm font-medium">${t('deptCalendar.delete')}</button>` : ''}
        <button type="button" data-action="cancel" class="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100 text-sm">${t('common.cancel')}</button>
        <span data-el="status" class="text-sm text-slate-500"></span>
      </div>
    `;
    formEl.querySelector('[data-action="cancel"]').addEventListener('click', hideForm);
    formEl.querySelector('[data-action="submit"]').addEventListener('click', submitForm);
    formEl.querySelector('[data-action="delete"]')?.addEventListener('click', deleteEntry);
    formEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function hideForm() {
    draft = null;
    formEl.classList.add('hidden');
    formEl.innerHTML = '';
  }

  async function submitForm() {
    const title = formEl.querySelector('[data-el="title"]').value.trim();
    const notes = formEl.querySelector('[data-el="notes"]').value.trim() || null;
    const assigneeIds = Array.from(formEl.querySelector('[data-el="assignees"]').selectedOptions).map((opt) => opt.value);
    const statusEl = formEl.querySelector('[data-el="status"]');

    if (!title) {
      statusEl.className = 'text-sm text-rose-600';
      statusEl.textContent = t('deptCalendar.titleRequired');
      return;
    }

    statusEl.className = 'text-sm text-slate-500';
    statusEl.textContent = t('common.saving');

    const isEdit = Boolean(draft.id);
    let shiftId = draft.id;
    if (isEdit) {
      const { error } = await supabase.from('department_shifts').update({ title, notes }).eq('id', shiftId);
      if (error) {
        statusEl.className = 'text-sm text-rose-600';
        statusEl.textContent = t('deptCalendar.saveFailed', { message: error.message });
        return;
      }
      // Simplest correct way to reconcile the assignee list on an edit:
      // drop everything and re-insert exactly what's selected now, same
      // as how re-saving a board-level roster would work.
      await supabase.from('department_shift_assignments').delete().eq('shift_id', shiftId);
    } else {
      const { data, error } = await supabase
        .from('department_shifts')
        .insert({ department_id: departmentId, date: draft.dateStr, title, notes, created_by: currentUserId })
        .select('id')
        .single();
      if (error) {
        statusEl.className = 'text-sm text-rose-600';
        statusEl.textContent = t('deptCalendar.saveFailed', { message: error.message });
        return;
      }
      shiftId = data.id;
    }

    if (assigneeIds.length > 0) {
      const { error: assignError } = await supabase
        .from('department_shift_assignments')
        .insert(assigneeIds.map((user_id) => ({ shift_id: shiftId, user_id })));
      if (assignError) {
        statusEl.className = 'text-sm text-rose-600';
        statusEl.textContent = t('deptCalendar.saveFailed', { message: assignError.message });
        return;
      }
    }

    hideForm();
    loadMonth();
  }

  async function deleteEntry() {
    const ok = await confirmDialog({ message: t('deptCalendar.deleteConfirm', { title: draft.title }) });
    if (!ok) return;
    await supabase.from('department_shifts').delete().eq('id', draft.id);
    hideForm();
    loadMonth();
  }

  return { reload: loadMonth };

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, '&quot;');
  }
}
