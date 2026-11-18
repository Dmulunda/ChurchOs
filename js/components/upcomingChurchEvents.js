// Church-wide events feed — merges two sources into one date-sorted list:
// Church Program entries (church_programs/church_program_dates,
// sql/065/066, managed on the Church Program department's own board,
// churchProgramBoard.js) and whichever department(s) are flagged
// `is_public_calendar` (sql/081; today that's the existing self-service
// "Church Calendar" department)'s department_shifts rows. Department
// admins already post their own shifts on their own Scheduling tab --
// this surfaces those same rows here too, rather than asking them to
// enter the same thing twice in Church Program. fetchUpcomingChurchEvents
// is also reused directly by churchProgramBoard.js so the two "upcoming
// events" views (the widget shown elsewhere, and the Church Program page
// itself) never drift apart. Shown on every department's Scheduling tab
// so general events (services, meetings, concerts) are visible without
// hunting for a separate calendar -- plain read-only list, not a second
// grid, since this data is sparse (a handful of announcements), not
// dense day-by-day data the way availability is.
import { t, departmentLabel, appLocale } from '../i18n.js';

// "mer. 18 nov." and sentence case for titles typed in capitals.
function shortDate(iso) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString(appLocale(), { weekday: 'short', day: 'numeric', month: 'short' });
}
function cap(s) {
  const v = String(s || '');
  if (v !== v.toUpperCase()) return v;
  const lower = v.toLocaleLowerCase(appLocale());
  return lower.charAt(0).toLocaleUpperCase(appLocale()) + lower.slice(1);
}
import { todayLocal } from '../utils/date.js';

const UPCOMING_LIMIT = 10;

// Returns a merged, date-sorted array of { kind: 'program'|'department', ... }.
// 'program' items: { id, title, description, isSpecial, flyerPath, dates, sortDate }.
// 'department' items: { title, notes, departmentKey, dates, sortDate }.
export async function fetchUpcomingChurchEvents(supabase) {
  const { data: programDates, error: programError } = await supabase
    .from('church_program_dates')
    .select('date, program:church_programs!program_id ( id, title, description, is_special, flyer_storage_path )')
    .gte('date', todayLocal())
    .order('date', { ascending: true });
  if (programError) throw programError;

  const items = [];

  const byProgram = new Map();
  (programDates || []).forEach((row) => {
    if (!row.program) return;
    if (!byProgram.has(row.program.id)) byProgram.set(row.program.id, { program: row.program, dates: [] });
    byProgram.get(row.program.id).dates.push(row.date);
  });
  byProgram.forEach(({ program, dates }) => {
    const sortedDates = dates.slice().sort();
    items.push({
      kind: 'program',
      id: program.id,
      title: program.title,
      description: program.description,
      isSpecial: program.is_special,
      flyerPath: program.flyer_storage_path,
      dates: sortedDates,
      sortDate: sortedDates[0],
    });
  });

  const { data: publicDepts, error: deptError } = await supabase
    .from('departments')
    .select('id, key')
    .eq('is_public_calendar', true);
  if (deptError) throw deptError;

  if (publicDepts && publicDepts.length > 0) {
    const { data: shifts, error: shiftError } = await supabase
      .from('department_shifts')
      .select('date, title, notes, department_id')
      .in('department_id', publicDepts.map((d) => d.id))
      .gte('date', todayLocal())
      .order('date', { ascending: true });
    if (shiftError) throw shiftError;

    const deptKeyById = new Map(publicDepts.map((d) => [d.id, d.key]));
    (shifts || []).forEach((s) => {
      items.push({
        kind: 'department',
        title: s.title,
        notes: s.notes,
        departmentKey: deptKeyById.get(s.department_id),
        dates: [s.date],
        sortDate: s.date,
      });
    });
  }

  items.sort((a, b) => a.sortDate.localeCompare(b.sortDate));
  return items;
}

export async function renderUpcomingChurchEvents(container, { supabase }) {
  function clear() {
    container.className = '';
    container.innerHTML = '';
  }

  container.className = 'bg-white rounded-xl shadow p-4 sm:p-6 mb-6';
  container.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

  let items;
  try {
    items = await fetchUpcomingChurchEvents(supabase);
  } catch {
    clear();
    return;
  }

  if (items.length === 0) { clear(); return; }
  items = items.slice(0, UPCOMING_LIMIT);

  container.innerHTML = `
    <h2 class="text-lg font-semibold mb-3">${t('churchEvents.title')}</h2>
    <ul class="space-y-2">
      ${items.map((item) => `
        <li class="flex items-baseline gap-x-3 gap-y-0.5 text-sm flex-wrap">
          <span class="font-semibold text-slate-800">${escapeHtml(cap(item.title))}</span>
          <span class="text-slate-500">${escapeHtml(item.dates.slice(0, 4).map(shortDate).join(' · '))}${item.dates.length > 4 ? ` · +${item.dates.length - 4}` : ''}</span>
          ${item.kind === 'program' && item.isSpecial ? `<span class="px-1.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">${t('churchProgram.specialBadge')}</span>` : ''}
          ${item.kind === 'department' && item.notes ? `<span class="text-slate-400">— ${escapeHtml(item.notes)}</span>` : ''}
          ${item.kind === 'department' ? `<span class="text-slate-400 text-xs whitespace-nowrap">${escapeHtml(t('churchProgram.fromDepartment', { dept: departmentLabel(item.departmentKey) }))}</span>` : ''}
        </li>
      `).join('')}
    </ul>
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
