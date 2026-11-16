// "Today, then this week's schedule" dashboard widget for every
// non-Choir department — Choir's Dashboard has always shown its own
// week with today pulled out first (dashboardOverview.js); this gives
// every other department the same shape, using whichever board that
// department's Scheduling tab already uses. Finance has no scheduling
// at all, so it's simply never called for that department. Ushers also
// gets its uniform-of-the-day text (not the photo — that's on the
// Uniform tab) shown beside each date, same as Choir's own week card.
import { t, mediaTechRoleLabel, ecodemAgeGroupLabel, formatDate } from '../i18n.js';
import { formatDateLocal, todayLocal } from '../utils/date.js';

export function renderNextUpcomingWidget(container, { supabase, departmentId, departmentKey }) {
  const RENDERERS = {
    preaching: loadPreaching,
    media_tech: loadMediaTech,
    ecodem: loadEcodem,
  };
  const load = RENDERERS[departmentKey] || loadShift;

  container.innerHTML = `
    <div class="bg-white rounded-xl border border-slate-100 p-4">
      <h2 class="text-[12.5px] font-bold text-slate-900 mb-2.5">📅 ${t('dashboard.today')}</h2>
      <div data-el="today-body" class="text-[12px] text-slate-500 space-y-2.5">${t('common.loading')}</div>
    </div>
    <div class="bg-white rounded-xl border border-slate-100 p-4">
      <h2 class="text-[12.5px] font-bold text-slate-900 mb-2.5">📆 ${t('dashboard.thisWeekSchedule')}</h2>
      <div data-el="week-body" class="text-[12px] text-slate-500 space-y-2.5">${t('common.loading')}</div>
    </div>
  `;
  const todayEl = container.querySelector('[data-el="today-body"]');
  const weekEl = container.querySelector('[data-el="week-body"]');
  load({ todayEl, weekEl }, { supabase, departmentId, departmentKey });
}

// Splits a week's rows into today's vs. the rest, then renders each
// half through the same per-row HTML builder every load* function
// already had — so today's entry shows first, in its own section, and
// the week section below no longer repeats it.
function renderTodayAndWeek(todayEl, weekEl, rows, buildHtml) {
  const todayStr = todayLocal();
  const todayRows = rows.filter((row) => row.date === todayStr);
  const restRows = rows.filter((row) => row.date !== todayStr);

  todayEl.innerHTML = todayRows.length > 0 ? buildHtml(todayRows) : noneTodayHtml();
  weekEl.innerHTML = restRows.length > 0 ? buildHtml(restRows) : noneElseHtml();
}

// Monday-through-Sunday range containing today, matching Choir's own
// week card (dashboardOverview.js) exactly.
function getWeekRange() {
  const date = new Date();
  const day = date.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setDate(date.getDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: formatDateLocal(monday), end: formatDateLocal(sunday) };
}

export async function loadUniformByDate(supabase, departmentId, startStr, endStr) {
  const { data } = await supabase
    .from('department_uniforms')
    .select('date, description')
    .eq('department_id', departmentId)
    .gte('date', startStr)
    .lte('date', endStr);
  const map = new Map();
  (data || []).forEach((row) => { if (row.description) map.set(row.date, row.description); });
  return map;
}

export function uniformLineHtml(uniformMap, date) {
  const desc = uniformMap?.get(date);
  return desc ? `<div class="text-xs text-purple-700 mt-1">${t('uniform.label')}: ${escapeHtml(desc)}</div>` : '';
}

// Still shown here as scheduled (the assignment itself is untouched
// when someone reports absence after being scheduled -- see
// report_absence()'s warn-and-allow flow), but flagged red so whoever's
// reviewing the week's schedule can see a replacement is needed. Keyed
// by "userId|date" since a multi-day week card needs to know WHICH day
// someone's absent for, not just whether they ever are that week.
async function loadAbsentKeys(supabase, start, end) {
  const { data } = await supabase
    .from('availability')
    .select('user_id, date')
    .eq('status', 'unavailable')
    .gte('date', start)
    .lte('date', end);
  return new Set((data || []).map((r) => `${r.user_id}|${r.date}`));
}

function nameWithAbsentNote(name, userId, date, absentKeys) {
  if (!absentKeys.has(`${userId}|${date}`)) return escapeHtml(name);
  return `${escapeHtml(name)} <span class="text-rose-600 font-bold">(${t('serviceProgram.reportedAbsent')})</span>`;
}

async function loadPreaching({ todayEl, weekEl }, { supabase }) {
  const { start, end } = getWeekRange();
  const [{ data, error }, absentKeys] = await Promise.all([
    supabase
      .from('preaching_schedule')
      .select('date, sermon_theme, bible_verse, moderator_id, preacher_id, preacher_name, moderator:profiles!moderator_id ( full_name ), preacher:profiles!preacher_id ( full_name )')
      .gte('date', start)
      .lte('date', end)
      .order('date', { ascending: true }),
    loadAbsentKeys(supabase, start, end),
  ]);

  if (error) { todayEl.innerHTML = weekEl.innerHTML = errorHtml(error); return; }
  renderTodayAndWeek(todayEl, weekEl, data || [], (rows) => buildPreachingHtml(rows, absentKeys));
}

function buildPreachingHtml(rows, absentKeys) {
  return rows.map((row) => {
    const preacherName = row.preacher?.full_name || row.preacher_name;
    const moderatorHtml = row.moderator?.full_name
      ? nameWithAbsentNote(row.moderator.full_name, row.moderator_id, row.date, absentKeys)
      : '—';
    const preacherHtml = preacherName
      ? (row.preacher_id ? nameWithAbsentNote(preacherName, row.preacher_id, row.date, absentKeys) : escapeHtml(preacherName))
      : '—';
    return `
      <div class="border border-slate-100 rounded-lg p-3">
        <div class="font-medium text-slate-800">${escapeHtml(row.sermon_theme || t('preaching.noSermonTheme'))} <span class="text-slate-400 font-normal">— ${escapeHtml(formatDate(row.date))}</span></div>
        <div class="text-slate-600 mt-1 text-sm">
          ${t('preaching.moderator')}: ${moderatorHtml}
          &nbsp;·&nbsp; ${t('preaching.preacher')}: ${preacherHtml}
        </div>
        ${row.bible_verse ? `<div class="text-indigo-700 italic mt-1 text-sm">${escapeHtml(row.bible_verse)}</div>` : ''}
      </div>
    `;
  }).join('');
}

async function loadMediaTech({ todayEl, weekEl }, { supabase }) {
  const { start, end } = getWeekRange();
  const [{ data, error }, absentKeys] = await Promise.all([
    supabase
      .from('media_tech_assignments')
      .select('date, role, user_id, assignee:profiles!user_id ( full_name )')
      .gte('date', start)
      .lte('date', end)
      .order('date', { ascending: true }),
    loadAbsentKeys(supabase, start, end),
  ]);

  if (error) { todayEl.innerHTML = weekEl.innerHTML = errorHtml(error); return; }
  renderTodayAndWeek(todayEl, weekEl, data || [], (rows) => buildMediaTechHtml(rows, absentKeys));
}

function buildMediaTechHtml(rows, absentKeys) {
  const byDate = new Map();
  rows.forEach((row) => {
    if (!byDate.has(row.date)) byDate.set(row.date, new Map());
    const roleMap = byDate.get(row.date);
    if (!roleMap.has(row.role)) roleMap.set(row.role, []);
    if (row.assignee?.full_name) roleMap.get(row.role).push({ name: row.assignee.full_name, userId: row.user_id });
  });

  return Array.from(byDate.entries()).map(([date, roleMap]) => `
    <div class="border border-slate-100 rounded-lg p-3">
      <div class="font-medium text-slate-800 mb-1">${escapeHtml(date)}</div>
      <div class="space-y-1 text-sm">
        ${Array.from(roleMap.entries()).map(([role, people]) => `
          <div><span class="text-slate-500">${mediaTechRoleLabel(role)}:</span> <span class="text-slate-800">${people.length > 0 ? people.map((p) => nameWithAbsentNote(p.name, p.userId, date, absentKeys)).join(', ') : `<span class="text-slate-400">${t('deptScheduling.unassigned')}</span>`}</span></div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

async function loadEcodem({ todayEl, weekEl }, { supabase }) {
  const { start, end } = getWeekRange();
  const [{ data, error }, absentKeys] = await Promise.all([
    supabase
      .from('ecodem_sessions')
      .select('date, age_group, topic, ecodem_session_workers ( user_id, worker:profiles!user_id ( full_name ) )')
      .gte('date', start)
      .lte('date', end)
      .order('date', { ascending: true }),
    loadAbsentKeys(supabase, start, end),
  ]);

  if (error) { todayEl.innerHTML = weekEl.innerHTML = errorHtml(error); return; }
  renderTodayAndWeek(todayEl, weekEl, data || [], (rows) => buildEcodemHtml(rows, absentKeys));
}

function buildEcodemHtml(rows, absentKeys) {
  const byDate = new Map();
  rows.forEach((session) => {
    if (!byDate.has(session.date)) byDate.set(session.date, []);
    byDate.get(session.date).push(session);
  });

  return Array.from(byDate.entries()).map(([date, sessions]) => `
    <div class="border border-slate-100 rounded-lg p-3">
      <div class="font-medium text-slate-800 mb-1">${escapeHtml(date)}</div>
      <div class="grid sm:grid-cols-3 gap-3 text-sm">
        ${sessions.map((session) => {
          const workers = (session.ecodem_session_workers || []).filter((w) => w.worker?.full_name);
          return `
            <div>
              <div class="font-medium text-slate-700">${ecodemAgeGroupLabel(session.age_group)}</div>
              <div class="text-slate-600">${session.topic ? escapeHtml(session.topic) : `<span class="text-slate-400">${t('ecodem.noTopic')}</span>`}</div>
              <div class="text-slate-500 mt-1">${workers.length > 0 ? workers.map((w) => nameWithAbsentNote(w.worker.full_name, w.user_id, date, absentKeys)).join(', ') : `<span class="text-slate-400">${t('deptScheduling.unassigned')}</span>`}</div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `).join('');
}

async function loadShift({ todayEl, weekEl }, { supabase, departmentId, departmentKey }) {
  const { start, end } = getWeekRange();
  const [{ data, error }, uniformMap, absentKeys] = await Promise.all([
    supabase
      .from('department_shifts')
      .select('date, title, notes, department_shift_assignments ( user_id, assignee:profiles!user_id ( full_name ) )')
      .eq('department_id', departmentId)
      .gte('date', start)
      .lte('date', end)
      .order('date', { ascending: true }),
    departmentKey === 'ushers' ? loadUniformByDate(supabase, departmentId, start, end) : Promise.resolve(null),
    loadAbsentKeys(supabase, start, end),
  ]);

  if (error) { todayEl.innerHTML = weekEl.innerHTML = errorHtml(error); return; }
  renderTodayAndWeek(todayEl, weekEl, data || [], (rows) => buildShiftHtml(rows, uniformMap, absentKeys));
}

function buildShiftHtml(rows, uniformMap, absentKeys) {
  return rows.map((row) => {
    const people = (row.department_shift_assignments || []).filter((a) => a.assignee?.full_name);
    return `
      <div class="border border-slate-100 rounded-lg p-3">
        <div class="font-medium text-slate-800">${escapeHtml(row.title)} <span class="text-slate-400 font-normal">— ${escapeHtml(formatDate(row.date))}</span></div>
        ${row.notes ? `<p class="text-slate-600 mt-1 text-sm">${escapeHtml(row.notes)}</p>` : ''}
        <div class="text-slate-500 mt-1 text-sm">${people.length > 0 ? people.map((a) => nameWithAbsentNote(a.assignee.full_name, a.user_id, row.date, absentKeys)).join(', ') : `<span class="text-slate-400">${t('deptScheduling.unassigned')}</span>`}</div>
        ${uniformLineHtml(uniformMap, row.date)}
      </div>
    `;
  }).join('');
}

function emptyHtml(message) {
  return `
    <div class="flex items-start gap-2 py-0.5">
      <span class="text-lg opacity-50">🗓️</span>
      <span class="text-[11.5px] text-slate-400 leading-snug pt-0.5">${message}</span>
    </div>
  `;
}

function noneTodayHtml() {
  return emptyHtml(t('dashboard.nothingToday'));
}

function noneElseHtml() {
  return emptyHtml(t('dashboard.nothingElseThisWeek'));
}

function errorHtml(error) {
  return `<p class="text-rose-600">${t('dashboard.loadFailed', { message: error.message })}</p>`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
