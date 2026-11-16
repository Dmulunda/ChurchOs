// Department headcount board (sql/067) — Men/Women/Kids counts (+ a
// database-computed Total) for a specific date, one entry per
// department per date (re-submitting the same date updates it rather
// than duplicating). Wired into Ushers, Welcoming and Socialisation,
// and Ecodem's Dashboard tabs, admin/secretary only. Also a
// week/month/year progression summary, each compared against the
// equivalent prior period, computed client-side from the same history
// fetch (a department's headcount log is small enough that a second
// query isn't worth it).
//
// Same department_headcounts row Headcount Tally (headcountTally.js)
// writes to additively -- this form pre-fills from the real current
// totals (loadCurrentValues()) rather than always starting from 0, so
// it reads as "correct what's already been counted" instead of
// risking silently discarding tally submissions on save.
import { t, formatDate } from '../i18n.js';
import { todayLocal, formatDateLocal } from '../utils/date.js';

// Combined attendance across all 3 headcount-eligible departments
// (Ushers/Welcoming & Socialisation/Ecodem -- deptDashboard.js's
// HEADCOUNT_DEPARTMENT_KEYS) for one date -- e.g. Ecodem recording
// 1/4/31 (Men/Women/Kids) and Ushers recording 32/65/0 shows as one
// combined 33/69/31 card. Additive context next to each department's
// own count, not a replacement for it.
//
// Only sums whatever department_headcounts rows RLS actually returns
// for the caller -- a plain member approved in just one of the three
// departments only ever sees that department's own row (sql/71 widens
// read access to any approved member, but still only for departments
// they're actually in), so this card is complete for a super
// admin/pastoral team member and partial-but-honest for anyone else.
// That's an access boundary, not a bug.
export function renderCombinedHeadcountCard(container, { supabase }) {
  container.innerHTML = `
    <div class="bg-white rounded-xl border border-slate-100 p-4">
      <div class="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h2 class="text-[13px] font-bold text-slate-900">🤝 ${t('headcount.combinedTitle')}</h2>
        <input type="date" data-el="combined-date" value="${todayLocal()}" max="${todayLocal()}" class="border border-slate-300 rounded-lg px-2 py-1 text-sm" />
      </div>
      <div data-el="combined-totals" class="grid grid-cols-3 gap-3 text-center"></div>
    </div>
  `;

  const dateInput = container.querySelector('[data-el="combined-date"]');
  const totalsEl = container.querySelector('[data-el="combined-totals"]');
  dateInput.addEventListener('change', load);
  load();

  async function load() {
    totalsEl.innerHTML = `<p class="col-span-3 text-sm text-slate-500">${t('common.loading')}</p>`;

    const { data: depts } = await supabase
      .from('departments')
      .select('id')
      .in('key', ['ushers', 'welcoming_socialisation', 'ecodem']);

    const { data: rows } = await supabase
      .from('department_headcounts')
      .select('men_count, women_count, kids_count')
      .in('department_id', (depts || []).map((d) => d.id))
      .eq('date', dateInput.value);

    const totals = (rows || []).reduce((acc, r) => ({
      men: acc.men + r.men_count, women: acc.women + r.women_count, kids: acc.kids + r.kids_count,
    }), { men: 0, women: 0, kids: 0 });

    totalsEl.innerHTML = `
      <div><div class="text-xs text-slate-500">${t('headcount.men')}</div><div class="text-lg font-bold text-slate-800">${totals.men}</div></div>
      <div><div class="text-xs text-slate-500">${t('headcount.women')}</div><div class="text-lg font-bold text-slate-800">${totals.women}</div></div>
      <div><div class="text-xs text-slate-500">${t('headcount.kids')}</div><div class="text-lg font-bold text-slate-800">${totals.kids}</div></div>
    `;
  }
}

export function renderHeadcountBoard(container, { supabase, departmentId }) {
  container.innerHTML = `
    <div class="bg-white rounded-xl border border-slate-100 p-4 mb-4">
      <h2 class="text-[13px] font-bold text-slate-900 mb-3">📋 ${t('headcount.addTitle')}</h2>
      <form data-el="form" class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('requests.date')}</label>
          <input type="date" name="date" required value="${todayLocal()}" max="${todayLocal()}"
                 class="w-full max-w-xs border border-slate-300 rounded-lg px-3 py-2" />
        </div>
        <div class="grid grid-cols-3 gap-4 max-w-md">
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('headcount.men')}</label>
            <input type="number" name="men_count" min="0" required value="0" class="w-full border border-slate-300 rounded-lg px-3 py-2" />
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('headcount.women')}</label>
            <input type="number" name="women_count" min="0" required value="0" class="w-full border border-slate-300 rounded-lg px-3 py-2" />
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('headcount.kids')}</label>
            <input type="number" name="kids_count" min="0" required value="0" class="w-full border border-slate-300 rounded-lg px-3 py-2" />
          </div>
        </div>
        <div class="flex items-center gap-3">
          <button type="submit" data-el="submit-btn"
                  class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
            ${t('headcount.save')}
          </button>
          <span data-el="form-status" class="text-sm text-slate-500"></span>
        </div>
      </form>
    </div>
    <div class="bg-white rounded-xl border border-slate-100 p-4 mb-4">
      <h2 class="text-[13px] font-bold text-slate-900 mb-3">📈 ${t('headcount.progressionTitle')}</h2>
      <div data-el="progression" class="grid sm:grid-cols-3 gap-3"></div>
    </div>
    <div class="bg-white rounded-xl border border-slate-100 p-4">
      <h2 class="text-[13px] font-bold text-slate-900 mb-3">🗂️ ${t('headcount.history')}</h2>
      <div data-el="history" class="overflow-x-auto"></div>
    </div>
  `;

  const form = container.querySelector('[data-el="form"]');
  const formStatusEl = container.querySelector('[data-el="form-status"]');
  const submitBtn = container.querySelector('[data-el="submit-btn"]');
  const historyEl = container.querySelector('[data-el="history"]');
  const progressionEl = container.querySelector('[data-el="progression"]');

  form.addEventListener('submit', handleSubmit);
  form.elements.date.addEventListener('change', loadCurrentValues);

  // This form is a correction/override on top of whatever Headcount
  // Tally (headcountTally.js) has already accumulated for the selected
  // date -- both write the same department_headcounts row, keyed by
  // (department_id, date). Pre-filling with the real current totals
  // (instead of always starting from 0) means an admin opening this
  // for a date that already has tally data sees what's actually been
  // counted so far, and a save that only touches one field no longer
  // silently discards the other two.
  async function loadCurrentValues() {
    const date = form.elements.date.value;
    if (!date) return;
    const { data } = await supabase
      .from('department_headcounts')
      .select('men_count, women_count, kids_count')
      .eq('department_id', departmentId)
      .eq('date', date)
      .maybeSingle();
    form.elements.men_count.value = data?.men_count ?? 0;
    form.elements.women_count.value = data?.women_count ?? 0;
    form.elements.kids_count.value = data?.kids_count ?? 0;
  }

  loadCurrentValues();
  loadHistory();

  async function handleSubmit(e) {
    e.preventDefault();
    const date = form.elements.date.value;
    const menCount = Number(form.elements.men_count.value) || 0;
    const womenCount = Number(form.elements.women_count.value) || 0;
    const kidsCount = Number(form.elements.kids_count.value) || 0;

    submitBtn.disabled = true;
    formStatusEl.className = 'text-sm text-slate-500';
    formStatusEl.textContent = t('common.saving');

    const { error } = await supabase.from('department_headcounts').upsert({
      department_id: departmentId,
      date,
      men_count: menCount,
      women_count: womenCount,
      kids_count: kidsCount,
    }, { onConflict: 'department_id,date' });

    submitBtn.disabled = false;
    if (error) {
      formStatusEl.className = 'text-sm text-rose-600';
      formStatusEl.textContent = t('headcount.saveFailed', { message: error.message });
      return;
    }

    formStatusEl.className = 'text-sm text-emerald-600';
    formStatusEl.textContent = t('headcount.saved');
    loadHistory();
  }

  async function loadHistory() {
    historyEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;
    progressionEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const { data, error } = await supabase
      .from('department_headcounts')
      .select('date, men_count, women_count, kids_count, total_count')
      .eq('department_id', departmentId)
      .order('date', { ascending: false });

    if (error) {
      historyEl.innerHTML = `<p class="text-sm text-rose-600">${t('headcount.loadFailed', { message: error.message })}</p>`;
      progressionEl.innerHTML = '';
      return;
    }

    renderProgression(data || []);

    if (!data || data.length === 0) {
      historyEl.innerHTML = `<p class="text-[11.5px] text-slate-400">${t('headcount.none')}</p>`;
      return;
    }

    historyEl.innerHTML = `
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
          <tr>
            <th class="text-left px-3 py-2">${t('requests.date')}</th>
            <th class="text-left px-3 py-2">${t('headcount.men')}</th>
            <th class="text-left px-3 py-2">${t('headcount.women')}</th>
            <th class="text-left px-3 py-2">${t('headcount.kids')}</th>
            <th class="text-left px-3 py-2">${t('headcount.total')}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${data.map((row) => `
            <tr>
              <td class="px-3 py-2 whitespace-nowrap">${escapeHtml(formatDate(row.date))}</td>
              <td class="px-3 py-2">${row.men_count}</td>
              <td class="px-3 py-2">${row.women_count}</td>
              <td class="px-3 py-2">${row.kids_count}</td>
              <td class="px-3 py-2 font-semibold text-slate-800">${row.total_count}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  function renderProgression(rows) {
    const { thisWeek, lastWeek, thisMonth, lastMonth, thisYear, lastYear } = getPeriodRanges();

    progressionEl.innerHTML = [
      buildPeriodCard(t('headcount.thisWeek'), sumInRange(rows, thisWeek), sumInRange(rows, lastWeek)),
      buildPeriodCard(t('headcount.thisMonth'), sumInRange(rows, thisMonth), sumInRange(rows, lastMonth)),
      buildPeriodCard(t('headcount.thisYear'), sumInRange(rows, thisYear), sumInRange(rows, lastYear)),
    ].join('');
  }
}

function getPeriodRanges() {
  const now = new Date();

  const day = now.getDay();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() + (day === 0 ? -6 : 1 - day));
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  const lastWeekStart = new Date(weekStart);
  lastWeekStart.setDate(weekStart.getDate() - 7);
  const lastWeekEnd = new Date(weekStart);
  lastWeekEnd.setDate(weekStart.getDate() - 1);

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

  const yearStart = new Date(now.getFullYear(), 0, 1);
  const yearEnd = new Date(now.getFullYear(), 11, 31);
  const lastYearStart = new Date(now.getFullYear() - 1, 0, 1);
  const lastYearEnd = new Date(now.getFullYear() - 1, 11, 31);

  return {
    thisWeek: [formatDateLocal(weekStart), formatDateLocal(weekEnd)],
    lastWeek: [formatDateLocal(lastWeekStart), formatDateLocal(lastWeekEnd)],
    thisMonth: [formatDateLocal(monthStart), formatDateLocal(monthEnd)],
    lastMonth: [formatDateLocal(lastMonthStart), formatDateLocal(lastMonthEnd)],
    thisYear: [formatDateLocal(yearStart), formatDateLocal(yearEnd)],
    lastYear: [formatDateLocal(lastYearStart), formatDateLocal(lastYearEnd)],
  };
}

function sumInRange(rows, [start, end]) {
  return rows
    .filter((r) => r.date >= start && r.date <= end)
    .reduce((acc, r) => ({
      men: acc.men + r.men_count,
      women: acc.women + r.women_count,
      total: acc.total + r.total_count,
    }), { men: 0, women: 0, total: 0 });
}

function buildPeriodCard(label, current, previous) {
  return `
    <div class="border border-slate-100 rounded-lg p-3">
      <div class="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">${escapeHtml(label)}</div>
      <div class="text-sm text-slate-600">${t('headcount.men')}: <span class="font-semibold text-slate-800">${current.men}</span> ${trendHtml(current.men, previous.men)}</div>
      <div class="text-sm text-slate-600">${t('headcount.women')}: <span class="font-semibold text-slate-800">${current.women}</span> ${trendHtml(current.women, previous.women)}</div>
      <div class="text-sm text-slate-600 mt-1 pt-1 border-t border-slate-100">${t('headcount.total')}: <span class="font-semibold text-slate-800">${current.total}</span> ${trendHtml(current.total, previous.total)}</div>
    </div>
  `;
}

function trendHtml(current, previous) {
  const delta = current - previous;
  if (delta === 0) return `<span class="text-xs text-slate-400">(±0)</span>`;
  const cls = delta > 0 ? 'text-emerald-600' : 'text-rose-600';
  const sign = delta > 0 ? '+' : '';
  return `<span class="text-xs ${cls}">(${sign}${delta})</span>`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
