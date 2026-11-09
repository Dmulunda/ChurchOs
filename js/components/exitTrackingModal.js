// Member Exit Tracking (Feature 3 of 3): the pastors-only tool
// showing why people have left -- reasons chart (+ direct-read
// percentage list), a quarterly trend, a small-sample warning under 5
// exits, filters, and an exportable list. Modeled on
// usageDashboardModal.js's modal shell; the two charts and the table
// are each factored into their own file (memberExitChart.js,
// memberExitList.js) per the build plan, this file just fetches the
// data, applies the filters, and wires them together.
import { t } from '../i18n.js';
import { AGE_GROUPS } from './memberRegistrationFields.js';
import { renderMemberExitChart, renderMemberExitTrendChart } from './memberExitChart.js';
import { renderMemberExitTable, buildExitExportRows } from './memberExitList.js';
import { exportRowsToExcel, exportRowsToCsv } from '../utils/tableExport.js';

export function createExitTrackingModal({ supabase }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4 overflow-y-auto';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-4xl my-8 p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${t('memberExit.trackingTitle')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <div data-el="body"></div>
    </div>
  `;
  document.body.appendChild(root);

  const bodyEl = root.querySelector('[data-el="body"]');
  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });

  let allRows = [];
  let dateFrom = '';
  let dateTo = '';
  let ageGroupFilter = '';
  let genderFilter = '';

  async function load() {
    bodyEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;
    const { data, error } = await supabase
      .from('member_exits')
      .select('id, member_id, date_left, main_reason, other_reasons, reason_title, notes, how_we_know, joined_other_church, open_to_follow_up, members ( full_name, gender, age_group )')
      .order('date_left', { ascending: false });

    if (error) {
      bodyEl.innerHTML = `<p class="text-sm text-rose-600">${t('memberExit.loadFailed', { message: error.message })}</p>`;
      return;
    }

    allRows = data || [];
    renderShell();
    renderResults();
  }

  function renderShell() {
    bodyEl.innerHTML = `
      <div class="flex flex-wrap items-center gap-2 mb-4">
        <label class="text-xs text-slate-500">${t('memberExit.dateFrom')}
          <input type="date" data-el="date-from" class="block border border-slate-300 rounded-lg px-2 py-1 text-sm" />
        </label>
        <label class="text-xs text-slate-500">${t('memberExit.dateTo')}
          <input type="date" data-el="date-to" class="block border border-slate-300 rounded-lg px-2 py-1 text-sm" />
        </label>
        <select data-el="age-filter" class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm self-end">
          <option value="">${t('memberRegistration.ageGroup')}</option>
          ${AGE_GROUPS.map((a) => `<option value="${a}">${t(`attendance.ageRange.${a}`)}</option>`).join('')}
        </select>
        <select data-el="gender-filter" class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm self-end">
          <option value="">${t('memberRegistration.gender')}</option>
          <option value="M">${t('memberCard.male')}</option>
          <option value="F">${t('memberCard.female')}</option>
        </select>
        <div class="flex-1"></div>
        <button type="button" data-action="export-excel" class="px-2.5 py-1 rounded-lg border border-slate-300 text-xs font-medium text-slate-600 hover:bg-slate-50">${t('memberDirectory.exportExcel')}</button>
        <button type="button" data-action="export-csv" class="px-2.5 py-1 rounded-lg border border-slate-300 text-xs font-medium text-slate-600 hover:bg-slate-50">${t('memberDirectory.exportCsv')}</button>
      </div>
      <div data-el="warning" class="hidden mb-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2"></div>
      <div class="grid lg:grid-cols-2 gap-4 mb-4">
        <div class="border border-slate-200 rounded-lg p-3">
          <p class="text-sm font-semibold text-slate-700 mb-2">${t('memberExit.reasonsChartTitle')}</p>
          <canvas data-el="reasons-chart" height="180"></canvas>
          <div data-el="reasons-list" class="mt-3 border-t border-slate-100 pt-2"></div>
        </div>
        <div class="border border-slate-200 rounded-lg p-3">
          <p class="text-sm font-semibold text-slate-700 mb-2">${t('memberExit.trendChartTitle')}</p>
          <canvas data-el="trend-chart" height="180"></canvas>
        </div>
      </div>
      <div data-el="table-wrap"></div>
    `;

    bodyEl.querySelector('[data-el="date-from"]').addEventListener('change', (e) => { dateFrom = e.target.value; renderResults(); });
    bodyEl.querySelector('[data-el="date-to"]').addEventListener('change', (e) => { dateTo = e.target.value; renderResults(); });
    bodyEl.querySelector('[data-el="age-filter"]').addEventListener('change', (e) => { ageGroupFilter = e.target.value; renderResults(); });
    bodyEl.querySelector('[data-el="gender-filter"]').addEventListener('change', (e) => { genderFilter = e.target.value; renderResults(); });
    bodyEl.querySelector('[data-action="export-excel"]').addEventListener('click', () => exportRowsToExcel(buildExitExportRows(filteredRows()), 'member_exits'));
    bodyEl.querySelector('[data-action="export-csv"]').addEventListener('click', () => exportRowsToCsv(buildExitExportRows(filteredRows()), 'member_exits'));
  }

  function filteredRows() {
    return allRows.filter((row) => {
      if (dateFrom && row.date_left < dateFrom) return false;
      if (dateTo && row.date_left > dateTo) return false;
      if (ageGroupFilter && row.members?.age_group !== ageGroupFilter) return false;
      if (genderFilter && row.members?.gender !== genderFilter) return false;
      return true;
    });
  }

  function renderResults() {
    const rows = filteredRows();
    const warningEl = bodyEl.querySelector('[data-el="warning"]');
    if (rows.length > 0 && rows.length < 5) {
      warningEl.textContent = t('memberExit.smallSampleWarning', { count: rows.length });
      warningEl.classList.remove('hidden');
    } else {
      warningEl.classList.add('hidden');
    }

    renderMemberExitChart(bodyEl.querySelector('[data-el="reasons-chart"]'), bodyEl.querySelector('[data-el="reasons-list"]'), rows);
    renderMemberExitTrendChart(bodyEl.querySelector('[data-el="trend-chart"]'), rows);
    renderMemberExitTable(bodyEl.querySelector('[data-el="table-wrap"]'), rows);
  }

  function open() {
    root.classList.remove('hidden');
    root.classList.add('flex');
    load();
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  return { open, root };
}
