// Member Exit Tracking (Feature 3 of 3): turns a list of member_exits
// rows into the reasons chart + quarterly trend chart. Chart.js, same
// lazy-CDN-import pattern as usageDashboardModal.js. Single measure
// (count of exits) sliced by one category (reason, or quarter) --
// per the data-viz skill's form rules this is a magnitude ranking, not
// a multi-series identity chart, so it gets ONE sequential hue and no
// legend rather than a categorical rainbow (the chart's own title
// names what's being counted).
//
// Direct labels: Chart.js alone can't put "Label — NN% (N people)"
// text next to each bar without a plugin, so renderMemberExitChart
// also writes that same list into a sibling HTML element -- this
// doubles as the "a table view exists" accessibility requirement and
// as the data-viz skill's "selective direct labels" rule, with no
// extra dependency.
import { t } from '../i18n.js';
import { EXIT_REASONS } from './exitReasonFields.js';

const EXIT_CHART_HUE = '#4f46e5'; // indigo-600, matches the Directory's own accent color
const EXIT_CHART_HUE_LIGHT = '#c7d2fe'; // indigo-200, for a highlighted bar

let chartJsPromise = null;
function loadChartJs() {
  if (!chartJsPromise) chartJsPromise = import('https://cdn.jsdelivr.net/npm/chart.js@4/auto/+esm').then((m) => m.default);
  return chartJsPromise;
}

export function reasonCounts(rows) {
  const counts = new Map(EXIT_REASONS.map((r) => [r, 0]));
  rows.forEach((row) => {
    counts.set(row.main_reason, (counts.get(row.main_reason) || 0) + 1);
  });
  const total = rows.length;
  return EXIT_REASONS
    .map((reason) => ({ reason, count: counts.get(reason) || 0, pct: total > 0 ? Math.round(((counts.get(reason) || 0) / total) * 100) : 0 }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);
}

export async function renderMemberExitChart(canvas, listEl, rows, { highlightReason = null } = {}) {
  const ranked = reasonCounts(rows);

  if (listEl) {
    listEl.innerHTML = ranked.length
      ? ranked.map((r) => `
          <div class="flex items-center justify-between text-sm py-1 ${r.reason === highlightReason ? 'font-semibold text-indigo-700' : 'text-slate-600'}">
            <span>${escapeHtml(t(`exitReasons.${r.reason}`))}</span>
            <span>${r.pct}% (${r.count})</span>
          </div>
        `).join('')
      : `<p class="text-sm text-slate-400">${t('memberExit.noExits')}</p>`;
  }

  if (!canvas) return;
  if (ranked.length === 0) { canvas.replaceWith(Object.assign(document.createElement('p'), { className: 'text-sm text-slate-400', textContent: t('memberExit.noExits') })); return; }

  const Chart = await loadChartJs();
  new Chart(canvas, {
    type: 'bar',
    data: {
      labels: ranked.map((r) => t(`exitReasons.${r.reason}`)),
      datasets: [{
        data: ranked.map((r) => r.pct),
        backgroundColor: ranked.map((r) => (r.reason === highlightReason ? EXIT_CHART_HUE_LIGHT : EXIT_CHART_HUE)),
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: 'y',
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => `${ranked[ctx.dataIndex].pct}% (${ranked[ctx.dataIndex].count})` } },
      },
      scales: { x: { beginAtZero: true, max: 100, ticks: { callback: (v) => `${v}%` } } },
    },
  });
}

export function quarterCounts(rows) {
  const counts = new Map();
  rows.forEach((row) => {
    const d = new Date(row.date_left);
    const key = `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return Array.from(counts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([quarter, count]) => ({ quarter, count }));
}

export async function renderMemberExitTrendChart(canvas, rows) {
  if (!canvas) return;
  const byQuarter = quarterCounts(rows);
  if (byQuarter.length === 0) { canvas.replaceWith(Object.assign(document.createElement('p'), { className: 'text-sm text-slate-400', textContent: t('memberExit.noExits') })); return; }

  const Chart = await loadChartJs();
  new Chart(canvas, {
    type: 'bar',
    data: { labels: byQuarter.map((q) => q.quarter), datasets: [{ data: byQuarter.map((q) => q.count), backgroundColor: EXIT_CHART_HUE, borderRadius: 4 }] },
    options: {
      plugins: { legend: { display: false } },
      scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
