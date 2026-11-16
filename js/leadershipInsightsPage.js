// Leadership Insights tab (sql/saas_platform/156_leadership_insights.sql).
// One page of church-health trends for the pastoral team: Sunday headcount,
// children, check-ins, new guests, volunteers, giving (only for people who
// already see every offering), plus period totals. All numbers come from
// get_leadership_insights(), which enforces who may see them.
import { getEffectiveSupabase } from './departments.js';
import { t, formatDate, formatMoney, appLocale } from './i18n.js';

const WEEK_CHOICES = [8, 12, 26, 52];
let selectedWeeks = 12;

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

// Average of the last 4 weeks that have a value vs the 4 before them.
function trend(values) {
  const known = values.filter((v) => v !== null && v !== undefined);
  if (known.length < 2) return null;
  const recent = known.slice(-4);
  const before = known.slice(-8, -4);
  if (!before.length) return null;
  const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const b = avg(before);
  if (b === 0) return null;
  return Math.round(((avg(recent) - b) / b) * 100);
}

function metricCard(title, weekly, key, fmt) {
  const values = weekly.map((w) => w[key]);
  const known = values.filter((v) => v !== null && v !== undefined);
  const max = Math.max(1, ...known);
  const last = [...values].reverse().find((v) => v !== null && v !== undefined);
  const change = trend(values);
  const changeHtml = change === null ? '' : `<span class="text-xs font-medium ${change >= 0 ? 'text-emerald-700' : 'text-rose-600'}">${change >= 0 ? '▲' : '▼'} ${Math.abs(change)}%</span>`;
  return `
    <div class="bg-white rounded-xl shadow p-4">
      <div class="flex items-start justify-between gap-2">
        <p class="text-sm text-slate-600">${escapeHtml(title)}</p>
        ${changeHtml}
      </div>
      <p class="text-2xl font-bold mt-1">${last === undefined ? '—' : escapeHtml(fmt(last))}</p>
      <div class="flex items-end gap-0.5 h-16 mt-3" role="img" aria-label="${escapeHtml(title)}">
        ${weekly.map((w) => {
          const v = w[key];
          const h = v === null || v === undefined ? 0 : Math.max(4, Math.round((v / max) * 100));
          return `<div class="flex-1 rounded-t ${v === null || v === undefined ? 'bg-slate-100' : 'bg-indigo-400'}" style="height:${v === null || v === undefined ? 4 : h}%" title="${escapeHtml(formatDate(w.week))}: ${v === null || v === undefined ? '—' : escapeHtml(fmt(v))}"></div>`;
        }).join('')}
      </div>
      <div class="flex justify-between text-[11px] text-slate-400 mt-1"><span>${escapeHtml(formatDate(weekly[0]?.week))}</span><span>${escapeHtml(formatDate(weekly[weekly.length - 1]?.week))}</span></div>
    </div>`;
}

function totalTile(label, value, hint) {
  return `<div class="bg-white rounded-xl shadow p-4">
    <p class="text-sm text-slate-600">${escapeHtml(label)}</p>
    <p class="text-2xl font-bold mt-1">${value === null || value === undefined ? '—' : escapeHtml(String(value))}</p>
    ${hint ? `<p class="text-xs text-slate-400 mt-1">${escapeHtml(hint)}</p>` : ''}
  </div>`;
}

export async function renderLeadershipInsightsTab() {
  const supabase = getEffectiveSupabase();
  const container = document.querySelector('#insights-content');
  container.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;

  const { data, error } = await supabase.rpc('get_leadership_insights', { p_weeks: selectedWeeks });
  if (error) {
    container.innerHTML = `<p class="text-slate-500">${/NOT_ALLOWED/.test(error.message) ? t('insights.notAllowed') : t('insights.notInstalled')}</p>`;
    return;
  }
  const weekly = data.weekly || [];
  const tot = data.totals || {};
  const num = (v) => new Intl.NumberFormat(appLocale()).format(v);
  const money = (cents) => formatMoney(cents / 100);

  container.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
      <p class="text-sm text-slate-500">${t('insights.intro', { date: formatDate(tot.from) })}</p>
      <label class="text-sm text-slate-600">${t('insights.period')}
        <select data-el="weeks" class="ml-1 border border-slate-300 rounded-lg px-2 py-1 text-sm">
          ${WEEK_CHOICES.map((w) => `<option value="${w}" ${w === selectedWeeks ? 'selected' : ''}>${t('insights.weeks', { count: w })}</option>`).join('')}
        </select>
      </label>
    </div>

    <h2 class="font-semibold mb-2">${t('insights.weeklyTitle')}</h2>
    <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
      ${metricCard(t('insights.headcount'), weekly, 'headcount', num)}
      ${metricCard(t('insights.children'), weekly, 'children', num)}
      ${metricCard(t('insights.checkedIn'), weekly, 'checked_in', num)}
      ${metricCard(t('insights.newGuests'), weekly, 'new_guests', num)}
      ${metricCard(t('insights.volunteers'), weekly, 'volunteers', num)}
      ${tot.giving_visible ? metricCard(t('insights.giving'), weekly, 'giving_cents', money) : ''}
    </div>

    <h2 class="font-semibold mb-2">${t('insights.periodTitle')}</h2>
    <div class="grid grid-cols-2 lg:grid-cols-3 gap-3">
      ${totalTile(t('insights.newMembers'), tot.new_members, t('insights.ofTotal', { count: tot.members_total }))}
      ${totalTile(t('insights.membersLeft'), tot.members_left)}
      ${totalTile(t('insights.guestsWaiting'), tot.guests_waiting, t('insights.guestsWaitingHint'))}
      ${totalTile(t('insights.prayerOpen'), tot.prayer_open)}
      ${tot.small_group_attendance === null || tot.small_group_attendance === undefined ? '' : totalTile(t('insights.smallGroups'), tot.small_group_attendance, t('insights.smallGroupsHint'))}
      ${tot.giving_visible ? totalTile(t('insights.givingTotal'), money(weekly.reduce((s, w) => s + (w.giving_cents || 0), 0))) : ''}
    </div>
    <p class="text-xs text-slate-400 mt-4">${t('insights.footnote')}</p>`;

  container.querySelector('[data-el="weeks"]').addEventListener('change', (e) => {
    selectedWeeks = Number(e.target.value) || 12;
    renderLeadershipInsightsTab();
  });
}
