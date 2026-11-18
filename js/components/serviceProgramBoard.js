// Service Program / Team Roster — one date's assignments across every
// department, aggregated server-side by get_service_program() (a
// SECURITY DEFINER RPC, sql applied directly to the live DB) since no
// single department's RLS policy allows reading another department's
// rows: each existing board already enforces per-department read
// access, and that's deliberately left untouched here — this view is
// the one place that intentionally widens "who can see this roster" to
// every signed-in member OF THE SAME TENANT, same spirit as departments'
// own is_public_calendar opt-in, just applied uniformly. The RPC itself
// scopes every table reference to current_tenant_id() -- it bypasses
// RLS entirely, so that scoping is the only thing standing between
// tenants for this one read.
//
// Two independent highlight layers, per the spec:
//   Layer 1 (yellow) — the whole department card, when department_key
//     is one of the viewer's own (getMyDepartments()).
//   Layer 2 (red) — a ring around just that person's chip, when
//     person_user_id is the viewer. A ring rather than a color swap:
//     rows with a status already reuse renderAssigneeBadge's fill
//     colors (amber=pending, emerald=approved, rose=declined) --
//     turning "that's me" red too would collide with "declined".
// The two checks run fully independently, so a guest/one-off assignment
// outside someone's usual department still shows red without yellow --
// intentional, matches how cross-department reassignment already works.
import { t, departmentLabel, voicePartLabel, mediaTechRoleLabel, ecodemAgeGroupLabel } from '../i18n.js';
import { getMyDepartments } from '../departments.js';
import { renderAssigneeBadge } from './assignmentStatusBadge.js';
import { todayLocal } from '../utils/date.js';

export function renderServiceProgram(container, { supabase, userId }) {
  container.innerHTML = `
    <p class="text-sm text-slate-500 mb-3">${t('serviceProgram.intro')}</p>
    <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-6">
      <label class="block text-sm font-medium text-slate-600 mb-1">${t('requests.date')}</label>
      <input type="date" data-el="date-input" value="${todayLocal()}" class="w-full max-w-xs border border-slate-300 rounded-lg px-3 py-2" />
    </div>
    <div data-el="roster"></div>
    <div data-el="attendance"></div>
  `;

  const dateInput = container.querySelector('[data-el="date-input"]');
  const rosterEl = container.querySelector('[data-el="roster"]');
  const attendanceEl = container.querySelector('[data-el="attendance"]');
  const myDeptKeys = new Set(getMyDepartments().map((d) => d.key));

  dateInput.addEventListener('change', () => load());

  load();

  async function load() {
    rosterEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;
    attendanceEl.innerHTML = '';

    const { data, error } = await supabase.rpc('get_service_program', { p_date: dateInput.value });
    if (error) {
      rosterEl.innerHTML = `<p class="text-sm text-rose-600">${t('serviceProgram.loadFailed', { message: error.message })}</p>`;
      return;
    }

    renderRoster(data?.roster || []);
    renderAttendance(data?.attendance || null);
  }

  function renderRoster(rows) {
    if (rows.length === 0) {
      rosterEl.innerHTML = `<p class="text-sm text-slate-500 bg-white rounded-xl shadow p-4 sm:p-6">${t('serviceProgram.none')}</p>`;
      return;
    }

    const byDept = new Map();
    rows.forEach((row) => {
      if (!byDept.has(row.dept_key)) byDept.set(row.dept_key, { dept_name: row.dept_name, rows: [] });
      byDept.get(row.dept_key).rows.push(row);
    });

    const depts = Array.from(byDept.entries()).sort((a, b) => a[1].dept_name.localeCompare(b[1].dept_name));

    rosterEl.innerHTML = '';
    depts.forEach(([deptKey, { dept_name, rows: deptRows }]) => {
      const isMyDept = myDeptKeys.has(deptKey);
      const card = document.createElement('div');
      card.className = `rounded-xl shadow p-4 sm:p-6 mb-4 border-2 ${isMyDept ? 'bg-amber-50 border-amber-300' : 'bg-white border-transparent'}`;

      const byRole = new Map();
      deptRows.forEach((row) => {
        const label = roleLabel(deptKey, row.role_label);
        if (!byRole.has(label)) byRole.set(label, []);
        byRole.get(label).push(row);
      });

      card.innerHTML = `
        <h2 class="text-lg font-semibold mb-3">${escapeHtml(departmentLabel(deptKey) || dept_name)}</h2>
        <div class="space-y-2">
          ${Array.from(byRole.entries()).map(([label, personRows]) => `
            <div>
              <div class="text-sm text-slate-500">${escapeHtml(label)}</div>
              <div class="flex flex-wrap gap-1.5 mt-1">
                ${personRows.map((row) => personChip(row, row.person_user_id === userId)).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      `;
      rosterEl.appendChild(card);
    });
  }

  function personChip(row, isMe) {
    const name = row.person_name || '—';
    const ringClass = isMe ? 'ring-2 ring-rose-600 ring-offset-1 rounded-lg' : '';
    const inner = row.status
      ? renderAssigneeBadge({ name, status: row.status, reason: null, workingDepartmentKey: null })
      : `<span class="inline-flex items-center px-2 py-1 rounded-lg text-sm bg-slate-100 text-slate-700">${escapeHtml(name)}</span>`;
    // Still shown on the roster (the schedule itself is untouched when
    // someone reports absence after being scheduled -- see
    // report_absence()'s warn-and-allow flow), but flagged in red so
    // whoever's reviewing the roster can see a replacement is needed.
    const absentNote = row.is_absent
      ? `<div class="text-xs font-bold text-rose-600 mt-0.5">${t('serviceProgram.reportedAbsent')}</div>`
      : '';
    return `<span class="inline-block ${ringClass}">${inner}${absentNote}${isMe ? `<span class="sr-only">${t('serviceProgram.you')}</span>` : ''}</span>`;
  }

  function renderAttendance(attendance) {
    attendanceEl.innerHTML = `
      <div class="bg-white rounded-xl shadow p-4 sm:p-6">
        <h2 class="text-lg font-semibold mb-3">${t('serviceProgram.attendanceTitle')}</h2>
        ${attendance ? `
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div><div class="text-xs text-slate-500">${t('headcount.men')}</div><div class="text-lg font-semibold">${attendance.men_count}</div></div>
            <div><div class="text-xs text-slate-500">${t('headcount.women')}</div><div class="text-lg font-semibold">${attendance.women_count}</div></div>
            <div><div class="text-xs text-slate-500">${t('headcount.kids')}</div><div class="text-lg font-semibold">${attendance.kids_count}</div></div>
            <div><div class="text-xs text-slate-500">${t('headcount.total')}</div><div class="text-lg font-semibold">${attendance.total_count}</div></div>
          </div>
        ` : `<p class="text-sm text-slate-500">${t('serviceProgram.noAttendance')}</p>`}
      </div>
    `;
  }
}

function roleLabel(deptKey, rawLabel) {
  if (deptKey === 'preaching') {
    if (rawLabel === 'moderator') return t('preaching.moderator');
    if (rawLabel === 'preacher') return t('preaching.preacher');
  }
  if (deptKey === 'choir') {
    if (rawLabel === 'lead') return t('serviceProgram.choirLead');
    return voicePartLabel(rawLabel);
  }
  if (deptKey === 'media_tech') return mediaTechRoleLabel(rawLabel);
  if (deptKey === 'ecodem') return ecodemAgeGroupLabel(rawLabel);
  return rawLabel;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
