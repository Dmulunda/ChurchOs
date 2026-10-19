// Guest check-in dashboard for Welcoming & Socialisation's own
// Dashboard tab -- a week/month bar chart (same visual idiom as
// js/components/homeWidgets.js's renderAttendanceWidget/bucketByWeek)
// of self-check-ins and staff-logged guests alike (attendance_records
// where guest_name is not null), plus the most recent period's own
// guest list for actual follow-up, not just a count. The compact list
// row only has room for name/date/phone; clicking the name opens
// showGuestDetailModal() below with every field this guest gave (city,
// referral source, age range, prayer request, etc. -- whichever of
// the full-intake columns, sql/041, actually got filled in). Read
// access is already covered by the widened can_record_attendance()
// select policy (sql/saas_platform/91) -- any approved member of this
// department, nothing new to grant here.
import { t } from '../i18n.js';

export function renderGuestAttendanceDashboard(container, { supabase }) {
  container.className = 'bg-white rounded-xl border border-slate-100 p-4';
  let groupBy = 'week';

  container.innerHTML = `
    <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
      <h2 class="text-[12.5px] font-bold text-slate-900">${t('guestDashboard.title')}</h2>
      <div class="flex gap-1.5" data-el="group-toggle">
        <button type="button" data-group="week">${t('guestDashboard.byWeek')}</button>
        <button type="button" data-group="month">${t('guestDashboard.byMonth')}</button>
      </div>
    </div>
    <div data-el="chart" class="mb-4"></div>
    <div data-el="list"></div>
  `;

  const chartEl = container.querySelector('[data-el="chart"]');
  const listEl = container.querySelector('[data-el="list"]');
  const groupBtns = container.querySelectorAll('[data-group]');

  function updateGroupButtons() {
    groupBtns.forEach((btn) => {
      const active = btn.dataset.group === groupBy;
      btn.className = `px-2.5 py-1 rounded-lg text-xs font-medium border ${active ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 text-slate-600 hover:border-indigo-200'}`;
    });
  }
  groupBtns.forEach((btn) => btn.addEventListener('click', () => {
    if (groupBy === btn.dataset.group) return;
    groupBy = btn.dataset.group;
    updateGroupButtons();
    load();
  }));
  updateGroupButtons();

  load();

  async function load() {
    chartEl.innerHTML = `<p class="text-[12px] text-slate-400">${t('common.loading')}</p>`;
    listEl.innerHTML = '';

    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - (groupBy === 'month' ? 365 : 7 * 12));
    const sinceStr = sinceDate.toISOString().slice(0, 10);

    const { data, error } = await supabase
      .from('attendance_records')
      .select(`
        id, service_date, service_type, guest_name, guest_phone, guest_email,
        guest_city, guest_referral_source, guest_referred_by_name, guest_age_range,
        guest_prayer_request, guest_wants_pastor_meeting, guest_home_church
      `)
      .not('guest_name', 'is', null)
      .gte('service_date', sinceStr)
      .order('service_date', { ascending: false });

    if (error) {
      chartEl.innerHTML = `<p class="text-[12px] text-rose-500">${t('guestDashboard.loadFailed', { message: error.message })}</p>`;
      return;
    }
    if (!data || data.length === 0) {
      chartEl.innerHTML = `<p class="text-[12px] text-slate-400">${t('guestDashboard.none')}</p>`;
      return;
    }

    const buckets = groupBy === 'month' ? bucketByMonth(data) : bucketByWeek(data);
    const recent = buckets.slice(-8);
    const max = Math.max(...recent.map((b) => b.count), 1);
    const latestKey = recent[recent.length - 1]?.key;

    chartEl.innerHTML = `
      <div class="flex items-end gap-2 h-24 relative"
          style="background-image:repeating-linear-gradient(to top, #edeef2 0, #edeef2 1px, transparent 1px, transparent 33.33%)">
        ${recent.map((b) => `
          <div class="flex-1 flex flex-col items-center justify-end gap-1 h-full relative z-10">
            <span class="text-[9px] font-bold text-slate-500 tabular-nums">${b.count}</span>
            <div class="w-full rounded-t ${b.key === latestKey ? 'bg-indigo-600' : 'bg-indigo-200'}" style="height:${Math.max((b.count / max) * 100, 4)}%"></div>
          </div>
        `).join('')}
      </div>
      <div class="flex gap-2 mt-1.5">
        ${recent.map((b) => `<div class="flex-1 text-center text-[9px] text-slate-400">${b.label}</div>`).join('')}
      </div>
    `;

    const latestGuests = data.filter((r) => (groupBy === 'month' ? r.service_date.slice(0, 7) : weekKey(r.service_date)) === latestKey);
    listEl.innerHTML = latestGuests.length === 0 ? '' : `
      <p class="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">${t('guestDashboard.recentGuests')}</p>
      <ul class="space-y-1">
        ${latestGuests.map((g) => `
          <li class="text-[12px] text-slate-600 flex items-center justify-between gap-2">
            <button type="button" data-guest-id="${g.id}" class="text-left text-indigo-600 hover:text-indigo-800 hover:underline">${escapeHtml(g.guest_name)}</button>
            <span class="text-slate-400 whitespace-nowrap">${escapeHtml(g.service_date)}${g.guest_phone ? ` · ${escapeHtml(g.guest_phone)}` : ''}</span>
          </li>
        `).join('')}
      </ul>
    `;
    listEl.querySelectorAll('[data-guest-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const guest = latestGuests.find((g) => g.id === btn.dataset.guestId);
        if (guest) showGuestDetailModal(guest);
      });
    });
  }
}

// Every field this guest actually gave is collected via the full
// intake form (guest-checkin.html) or the staff Attendance tool
// (attendanceManager.js) -- clicking their name shows all of it, not
// just the name/date/phone the compact list row has room for. Empty
// optional fields are left out rather than shown as "—", since most
// guests will have only filled in a few of them.
function showGuestDetailModal(guest) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-sm max-h-[85vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-lg font-bold text-slate-800">${escapeHtml(guest.guest_name)}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <dl class="space-y-2 text-sm">
        ${detailRow(t('attendance.serviceDate'), guest.service_date)}
        ${detailRow(t('attendance.serviceType'), guest.service_type ? t(`attendance.type.${guest.service_type}`) : null)}
        ${detailRow(t('attendance.guestPhonePlaceholder'), guest.guest_phone)}
        ${detailRow(t('attendance.guestEmailPlaceholder'), guest.guest_email)}
        ${detailRow(t('attendance.guestCityPlaceholder'), guest.guest_city)}
        ${detailRow(t('attendance.guestReferralPlaceholder'), guest.guest_referral_source ? t(`attendance.referral.${guest.guest_referral_source}`) : null)}
        ${detailRow(t('attendance.guestReferredByPlaceholder'), guest.guest_referred_by_name)}
        ${detailRow(t('attendance.guestAgeRangePlaceholder'), guest.guest_age_range ? t(`attendance.ageRange.${guest.guest_age_range}`) : null)}
        ${detailRow(t('attendance.guestPrayerRequestCheckbox'), guest.guest_prayer_request)}
        ${detailRow(t('attendance.guestWantsPastorMeeting'), guest.guest_wants_pastor_meeting ? t('common.yes') : null)}
        ${detailRow(t('attendance.guestHasHomeChurchCheckbox'), guest.guest_home_church)}
      </dl>
    </div>
  `;
  document.body.appendChild(root);
  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', () => root.remove()));
  root.addEventListener('click', (e) => { if (e.target === root) root.remove(); });
}

function detailRow(label, value) {
  if (value === null || value === undefined || value === '') return '';
  return `
    <div>
      <dt class="text-[10.5px] font-semibold text-slate-400 uppercase tracking-wide">${escapeHtml(label)}</dt>
      <dd class="text-slate-700">${escapeHtml(value)}</dd>
    </div>
  `;
}

function weekKey(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

function bucketByWeek(rows) {
  const buckets = new Map();
  rows.forEach((r) => {
    const key = weekKey(r.service_date);
    buckets.set(key, (buckets.get(key) || 0) + 1);
  });
  return Array.from(buckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, count]) => {
      const d = new Date(`${key}T00:00:00`);
      return { key, count, label: `${d.toLocaleString(undefined, { month: 'short' })} ${d.getDate()}` };
    });
}

function bucketByMonth(rows) {
  const buckets = new Map();
  rows.forEach((r) => {
    const key = r.service_date.slice(0, 7);
    buckets.set(key, (buckets.get(key) || 0) + 1);
  });
  return Array.from(buckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, count]) => {
      const d = new Date(`${key}-01T00:00:00`);
      return { key, count, label: d.toLocaleString(undefined, { month: 'short', year: '2-digit' }) };
    });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
