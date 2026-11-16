// Generic "your assignments — approve or decline" panel, reused by
// every non-Choir scheduling board (Preaching, Media & Tech, Ecodem,
// every lightweight department's shift board) so they all get the same
// accept/decline flow Choir's Service Requests has always had. Each
// board passes in how to fetch/update its own assignment rows since the
// underlying tables differ (preaching_schedule, media_tech_assignments,
// ecodem_session_workers, department_shift_assignments); the UI and the
// decline-reason logic — free text, or "I'll be working in another
// department instead" — stays identical everywhere.
import { t, formatDate } from '../i18n.js';
import { getMyDepartments } from '../departments.js';
import { departmentLabel } from '../i18n.js';
import { todayLocal } from '../utils/date.js';

export function renderMyAssignmentsPanel(container, { departmentId, fetchMyAssignments, updateAssignment }) {
  container.innerHTML = `
    <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-6">
      <h2 class="text-lg font-semibold mb-4">${t('requests.yourAssignments')}</h2>
      <div data-el="list"></div>
    </div>
  `;

  const listEl = container.querySelector('[data-el="list"]');
  // Ids just responded to in this panel instance -- kept visible (with the
  // decline-reason UI reachable) until the panel next reloads from a fresh
  // page visit, then dropped. Once-responded items don't linger indefinitely
  // like before; they just don't vanish out from under you mid-edit.
  const justResponded = new Set();

  load();

  async function load() {
    listEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const { data, error } = await fetchMyAssignments();
    if (error) {
      listEl.innerHTML = `<p class="text-sm text-rose-600">${t('requests.failedToLoad', { message: error.message })}</p>`;
      return;
    }

    render(data || []);
  }

  function render(rows) {
    const visible = rows.filter((r) => r.date >= todayLocal() && (r.status === 'pending' || justResponded.has(r.id)));

    if (visible.length === 0) {
      listEl.innerHTML = `<p class="text-sm text-slate-500">${t('requests.noRequests')}</p>`;
      return;
    }

    const pending = visible.filter((r) => r.status === 'pending');
    const responded = visible.filter((r) => r.status !== 'pending');

    listEl.innerHTML = '';

    if (pending.length > 0) {
      const section = document.createElement('div');
      section.className = 'mb-4';
      section.innerHTML = `<div class="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">${t('requests.needsResponse')}</div>`;
      const list = document.createElement('div');
      list.className = 'space-y-2';
      pending.forEach((row) => list.appendChild(renderCard(row)));
      section.appendChild(list);
      listEl.appendChild(section);
    }

    if (responded.length > 0) {
      const section = document.createElement('div');
      section.innerHTML = `<div class="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">${t('requests.yourResponses')}</div>`;
      const list = document.createElement('div');
      list.className = 'space-y-2';
      responded.forEach((row) => list.appendChild(renderCard(row)));
      section.appendChild(list);
      listEl.appendChild(section);
    }
  }

  function departmentOptions(selectedId) {
    const options = getMyDepartments().filter((d) => d.id !== departmentId);
    return `<option value="">${t('requests.selectDepartment')}</option>`
      + options.map((d) => `<option value="${d.id}" ${d.id === selectedId ? 'selected' : ''}>${escapeHtml(departmentLabel(d.key))}</option>`).join('');
  }

  function renderCard(row) {
    const card = document.createElement('div');
    card.className = 'border border-slate-200 rounded-lg p-3';
    card.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div class="font-medium text-slate-800">${escapeHtml(row.label)}</div>
          <div class="text-sm text-slate-500">${escapeHtml(formatDate(row.date))}</div>
        </div>
        <div class="flex gap-2">
          <button type="button" data-action="approve"
                  class="px-3 py-1.5 rounded-lg text-sm font-medium ${row.status === 'approved' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-emerald-100'}">
            ${t('requests.approve')}
          </button>
          <button type="button" data-action="decline"
                  class="px-3 py-1.5 rounded-lg text-sm font-medium ${row.status === 'declined' ? 'bg-rose-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-rose-100'}">
            ${t('requests.decline')}
          </button>
        </div>
      </div>
      ${row.status === 'declined' ? `
        <div class="mt-3 pt-3 border-t border-slate-100 space-y-3">
          <div>
            <label class="block text-xs font-medium text-slate-500 mb-1">${t('requests.reason')}</label>
            <div class="flex gap-2">
              <input type="text" data-el="reason-input" value="${escapeAttr(row.reason || '')}"
                     placeholder="${t('requests.reasonPlaceholder')}"
                     class="flex-1 border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
              <button type="button" data-action="save-reason"
                      class="px-3 py-1.5 rounded-lg bg-slate-700 text-white text-sm font-medium hover:bg-slate-800 whitespace-nowrap">
                ${t('requests.saveReason')}
              </button>
            </div>
          </div>
          <div>
            <label class="block text-xs font-medium text-slate-500 mb-1">${t('requests.workingElsewhere')}</label>
            <div class="flex gap-2">
              <select data-el="dept-select" class="flex-1 border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
                ${departmentOptions(row.workingDepartmentId)}
              </select>
              <button type="button" data-action="save-department"
                      class="px-3 py-1.5 rounded-lg bg-slate-700 text-white text-sm font-medium hover:bg-slate-800 whitespace-nowrap">
                ${t('requests.saveReason')}
              </button>
            </div>
          </div>
          <p data-el="row-status" class="text-xs"></p>
        </div>
      ` : ''}
    `;

    card.querySelector('[data-action="approve"]').addEventListener('click', () => respond(row, 'approved'));
    card.querySelector('[data-action="decline"]').addEventListener('click', () => respond(row, 'declined'));

    if (row.status === 'declined') {
      const rowStatusEl = card.querySelector('[data-el="row-status"]');

      card.querySelector('[data-action="save-reason"]').addEventListener('click', async () => {
        const reason = card.querySelector('[data-el="reason-input"]').value.trim() || null;
        const { error } = await updateAssignment(row.id, { reason, workingDepartmentId: null });
        if (error) {
          rowStatusEl.className = 'text-xs text-rose-600';
          rowStatusEl.textContent = t('requests.reasonSaveFailed', { message: error.message });
          return;
        }
        row.reason = reason;
        row.workingDepartmentId = null;
        rowStatusEl.className = 'text-xs text-emerald-600';
        rowStatusEl.textContent = t('requests.reasonSaved');
      });

      card.querySelector('[data-action="save-department"]').addEventListener('click', async () => {
        const workingDepartmentId = card.querySelector('[data-el="dept-select"]').value || null;
        const { error } = await updateAssignment(row.id, { reason: null, workingDepartmentId });
        if (error) {
          rowStatusEl.className = 'text-xs text-rose-600';
          rowStatusEl.textContent = t('requests.reasonSaveFailed', { message: error.message });
          return;
        }
        row.reason = null;
        row.workingDepartmentId = workingDepartmentId;
        rowStatusEl.className = 'text-xs text-emerald-600';
        rowStatusEl.textContent = t('requests.reasonSaved');
      });
    }

    return card;
  }

  async function respond(row, status) {
    const { error } = await updateAssignment(row.id, { status });
    if (error) {
      window.alert(t('requests.responseFailed', { message: error?.message || '' }));
      return;
    }
    justResponded.add(row.id);
    load();
  }
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
