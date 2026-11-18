// Availability calendar — personal (mark your own days) merged with a
// read-only view of the rest of the active department's status, so
// there's one calendar to check instead of two: "let team members see
// at a glance who is off and who is available." Renders a monthly
// grid; clicking a day cycles YOUR OWN status through
// unset -> available -> unavailable -> unset. Changes are staged
// locally and written to Supabase in a single batch on "Save" —
// except marking a day unavailable, which needs a reason: that
// transition instead confirms, then hands off to Report Absence with
// the date already added, so the reason (and the replacement-request/
// notification logic report_absence() already triggers) isn't
// skipped. Confirming reloads the month once Report Absence succeeds,
// picking up the real status from the server rather than guessing it
// locally.
//
// Teammates' status comes from the same `availability` table (sql/080
// widened its read policy so any approved member of a shared
// department can see it) — only the plain available/unavailable flag,
// never an absence's reason, which stays exactly as private as it
// already was.
import { formatDateLocal } from '../utils/date.js';
import { t, tn, monthName } from '../i18n.js';
import { confirmDialog } from './confirmDialog.js';
import { createReportAbsenceModal } from './reportAbsenceModal.js';

const STATUS_CYCLE = [undefined, 'available', 'unavailable'];

const STATUS_STYLES = {
  available: 'bg-emerald-500 text-white hover:bg-emerald-600',
  unavailable: 'bg-rose-500 text-white hover:bg-rose-600',
  undefined: 'bg-slate-100 text-slate-700 hover:bg-slate-200',
};

export function renderAvailabilityCalendar(container, { supabase, userId, departmentId }) {
  let viewDate = new Date(); // any date within the currently viewed month
  viewDate.setDate(1);

  let savedStatus = new Map(); // dateStr -> status, as last loaded from Supabase
  let localStatus = new Map(); // dateStr -> status, including unsaved edits
  let dirty = new Set(); // dateStrs changed since last load/save
  let teammatesByDate = new Map(); // dateStr -> [{ full_name, status }, ...], excludes the current user

  container.innerHTML = `
    <div class="flex items-center justify-between mb-4">
      <button type="button" data-action="prev-month"
              class="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700"><span aria-hidden="true">‹</span><span class="sr-only">${t('calendar.prevMonth')}</span></button>
      <h2 data-el="month-label" class="text-lg font-semibold"></h2>
      <button type="button" data-action="next-month"
              class="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700"><span aria-hidden="true">›</span><span class="sr-only">${t('calendar.nextMonth')}</span></button>
    </div>

    <div class="flex items-center gap-4 text-sm text-slate-500 mb-3 flex-wrap">
      <span class="inline-flex items-center gap-1.5"><span class="w-3 h-3 rounded bg-emerald-500 inline-block"></span> ${t('calendar.available')}</span>
      <span class="inline-flex items-center gap-1.5"><span class="w-3 h-3 rounded bg-rose-500 inline-block"></span> ${t('calendar.unavailable')}</span>
      <span class="inline-flex items-center gap-1.5"><span class="w-3 h-3 rounded bg-slate-100 border border-slate-300 inline-block"></span> ${t('calendar.notSet')}</span>
    </div>

    <div class="grid grid-cols-7 gap-1 text-center text-xs font-medium text-slate-500 mb-1">
      <div>${t('calendar.days.sun')}</div><div>${t('calendar.days.mon')}</div><div>${t('calendar.days.tue')}</div><div>${t('calendar.days.wed')}</div><div>${t('calendar.days.thu')}</div><div>${t('calendar.days.fri')}</div><div>${t('calendar.days.sat')}</div>
    </div>
    <div data-el="grid" class="grid grid-cols-7 gap-1"></div>

    <div class="mt-5 flex items-center gap-3">
      <button type="button" data-action="save"
              class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed">
        ${t('calendar.saveAvailability')}
      </button>
      <span data-el="status" class="text-sm text-slate-500"></span>
    </div>
  `;

  const monthLabel = container.querySelector('[data-el="month-label"]');
  const grid = container.querySelector('[data-el="grid"]');
  const statusEl = container.querySelector('[data-el="status"]');
  const saveBtn = container.querySelector('[data-action="save"]');
  const reportAbsenceModal = createReportAbsenceModal({ supabase, onReported: () => loadMonth() });

  container.querySelector('[data-action="prev-month"]').addEventListener('click', () => {
    viewDate.setMonth(viewDate.getMonth() - 1);
    loadMonth();
  });
  container.querySelector('[data-action="next-month"]').addEventListener('click', () => {
    viewDate.setMonth(viewDate.getMonth() + 1);
    loadMonth();
  });
  saveBtn.addEventListener('click', saveChanges);

  loadMonth();

  async function loadMonth() {
    monthLabel.textContent = `${monthName(viewDate.getMonth())} ${viewDate.getFullYear()}`;
    statusEl.textContent = t('common.loading');
    dirty.clear();

    const firstDay = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
    const lastDay = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0);
    const fromDate = formatDateLocal(firstDay);
    const toDate = formatDateLocal(lastDay);

    const [{ data, error }, teammateRows] = await Promise.all([
      supabase
        .from('availability')
        .select('date, status')
        .eq('user_id', userId)
        .gte('date', fromDate)
        .lte('date', toDate),
      loadTeammates(fromDate, toDate),
    ]);

    if (error) {
      statusEl.textContent = t('calendar.failedToLoad', { message: error.message });
      return;
    }

    savedStatus = new Map(data.map((row) => [row.date, row.status]));
    localStatus = new Map(savedStatus);
    teammatesByDate = teammateRows;
    statusEl.textContent = '';
    renderGrid();
  }

  // Skipped entirely when there's no department context (departmentId
  // not passed) — the calendar still works as a plain personal one.
  async function loadTeammates(fromDate, toDate) {
    const byDate = new Map();
    if (!departmentId) return byDate;

    const { data: members } = await supabase
      .from('department_memberships')
      .select('user_id, member:profiles!user_id ( full_name )')
      .eq('department_id', departmentId)
      .eq('status', 'approved')
      .neq('user_id', userId);
    const namesById = new Map((members || []).filter((m) => m.member).map((m) => [m.user_id, m.member.full_name]));
    if (namesById.size === 0) return byDate;

    const { data: rows } = await supabase
      .from('availability')
      .select('user_id, date, status')
      .in('user_id', Array.from(namesById.keys()))
      .gte('date', fromDate)
      .lte('date', toDate);

    for (const row of rows || []) {
      const fullName = namesById.get(row.user_id);
      if (!fullName) continue;
      if (!byDate.has(row.date)) byDate.set(row.date, []);
      byDate.get(row.date).push({ full_name: fullName, status: row.status });
    }
    return byDate;
  }

  function renderGrid() {
    grid.innerHTML = '';

    const firstDay = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
    const lastDay = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0);

    // Leading blanks so day 1 lands in the correct weekday column.
    for (let i = 0; i < firstDay.getDay(); i++) {
      grid.appendChild(document.createElement('div'));
    }

    const todayStr = formatDateLocal(new Date());

    for (let day = 1; day <= lastDay.getDate(); day++) {
      const cellDate = new Date(viewDate.getFullYear(), viewDate.getMonth(), day);
      const dateStr = formatDateLocal(cellDate);
      grid.appendChild(buildDayCell(dateStr, day, dateStr < todayStr));
    }
  }

  // A whole-cell "everyone's status, named" view rather than a single
  // clickable square — matches the shared-calendar layout requested:
  // one colored row per person who has a status set that day, name and
  // status both visible at a glance, not just a color. Your own row
  // stays the clickable one (same unset -> available -> unavailable ->
  // unset cycle as before); teammates' rows are read-only.
  function buildDayCell(dateStr, day, isPast) {
    const cell = document.createElement('div');
    cell.className = 'border border-slate-200 rounded-lg p-1 flex flex-col gap-1 min-h-[3.25rem]';

    const dayNumEl = document.createElement('div');
    dayNumEl.className = `text-xs font-semibold px-0.5 ${isPast ? 'text-slate-300' : 'text-slate-500'}`;
    dayNumEl.textContent = String(day);
    cell.appendChild(dayNumEl);

    const selfStatus = localStatus.get(dateStr);
    if (selfStatus) {
      cell.appendChild(buildChip({
        name: t('calendar.you'),
        status: selfStatus,
        clickable: !isPast,
        onClick: () => toggleDate(dateStr),
      }));
    } else if (!isPast) {
      cell.appendChild(buildAddChip(dateStr));
    }

    // Every teammate with a status set that day is shown — no cap —
    // so nobody's availability is hidden from the rest of the team.
    const teammates = teammatesByDate.get(dateStr) || [];
    for (const { full_name, status } of teammates) {
      cell.appendChild(buildChip({ name: full_name, status, clickable: false }));
    }

    return cell;
  }

  // Just the name, colored — the red/green background alone says
  // available/unavailable, so no separate status line is needed
  // (keeps each row compact enough to fit everyone in the cell).
  function buildChip({ name, status, clickable, onClick }) {
    const chip = document.createElement(clickable ? 'button' : 'div');
    if (clickable) chip.type = 'button';
    chip.className = `text-left rounded px-1.5 py-0.5 text-[11px] font-semibold truncate transition-colors ${STATUS_STYLES[status]} ${clickable ? 'cursor-pointer' : ''}`;
    chip.textContent = name;
    if (clickable) chip.addEventListener('click', onClick);
    return chip;
  }

  // A faint, dashed placeholder shown only for today/future days you
  // haven't set a status for yet — keeps the click-to-set interaction
  // discoverable now that there's no longer one big clickable square.
  function buildAddChip(dateStr) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'text-left rounded px-1.5 py-1 text-[11px] leading-tight border border-dashed border-slate-300 text-slate-400 hover:bg-slate-50 hover:text-slate-500 transition-colors';
    chip.textContent = t('calendar.setYours');
    chip.addEventListener('click', () => toggleDate(dateStr));
    return chip;
  }

  function toggleDate(dateStr) {
    const current = localStatus.get(dateStr);
    const nextIndex = (STATUS_CYCLE.indexOf(current) + 1) % STATUS_CYCLE.length;
    const next = STATUS_CYCLE[nextIndex];

    if (next === 'unavailable') {
      confirmDialog({ message: t('calendar.confirmUnavailable', { date: dateStr }), danger: false }).then((confirmed) => {
        if (confirmed) reportAbsenceModal.open(dateStr);
      });
      return;
    }

    if (next === undefined) {
      localStatus.delete(dateStr);
    } else {
      localStatus.set(dateStr, next);
    }

    if (localStatus.get(dateStr) === savedStatus.get(dateStr)) {
      dirty.delete(dateStr);
    } else {
      dirty.add(dateStr);
    }

    renderGrid();
    statusEl.textContent = dirty.size > 0 ? tn('calendar.unsavedChanges', dirty.size) : '';
  }

  async function saveChanges() {
    if (dirty.size === 0) return;

    saveBtn.disabled = true;
    statusEl.textContent = t('common.saving');

    const toUpsert = [];
    const toDeleteDates = [];

    for (const dateStr of dirty) {
      const status = localStatus.get(dateStr);
      if (status === undefined) {
        toDeleteDates.push(dateStr);
      } else {
        toUpsert.push({ user_id: userId, date: dateStr, status });
      }
    }

    if (toUpsert.length > 0) {
      const { error } = await supabase
        .from('availability')
        .upsert(toUpsert, { onConflict: 'user_id,date' });
      if (error) {
        statusEl.textContent = t('calendar.saveFailed', { message: error.message });
        saveBtn.disabled = false;
        return;
      }
    }

    if (toDeleteDates.length > 0) {
      const { error } = await supabase
        .from('availability')
        .delete()
        .eq('user_id', userId)
        .in('date', toDeleteDates);
      if (error) {
        statusEl.textContent = t('calendar.saveFailed', { message: error.message });
        saveBtn.disabled = false;
        return;
      }
    }

    savedStatus = new Map(localStatus);
    dirty.clear();
    statusEl.textContent = t('calendar.saved');
    saveBtn.disabled = false;
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
