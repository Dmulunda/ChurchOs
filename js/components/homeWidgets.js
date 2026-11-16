// Home dashboard widgets — replaces the flat black link list on the
// Super Admin Home tab with small, self-contained "what needs my
// attention today" cards. Each render function owns one card
// (container.className is set by the function itself, same contract
// as upcomingChurchEvents.js) so superAdminHome.js can lay them out in
// a grid without knowing their internals. All queries are plain
// authenticated-client reads -- RLS already scopes everything to the
// caller's own tenant, same as every other read in this app.
import { t, appLocale } from '../i18n.js';

const CARD = 'bg-white rounded-xl border border-slate-100 p-4 flex flex-col';

function head(title, linkLabel) {
  return `
    <div class="flex items-center justify-between mb-2.5">
      <h3 class="text-[12.5px] font-bold text-slate-900 flex items-center gap-1.5">${title}</h3>
      ${linkLabel ? `<button type="button" data-action="widget-link" class="text-[10.5px] font-semibold text-indigo-600 hover:text-indigo-800">${linkLabel}</button>` : ''}
    </div>
  `;
}

function empty(container, message) {
  container.innerHTML += `<p class="text-[12px] text-slate-400">${message}</p>`;
}

// ---- Birthdays this week ----
// profiles.birth_date exists in the schema but nothing writes to it
// yet (no profile-edit UI collects it) -- this widget is honest about
// that with its own empty state rather than pretending the feature is
// further along than it is.
export async function renderBirthdaysWidget(container, { supabase, onOpenDirectory }) {
  container.className = CARD;
  container.innerHTML = `<p class="text-[12px] text-slate-400">${t('common.loading')}</p>`;

  const { data, error } = await supabase.from('profiles').select('id, full_name, birth_date').not('birth_date', 'is', null);

  container.innerHTML = head(t('homeWidgets.birthdaysTitle'), onOpenDirectory ? t('homeWidgets.directoryLink') : null);
  if (onOpenDirectory) container.querySelector('[data-action="widget-link"]').addEventListener('click', onOpenDirectory);

  if (error) { empty(container, t('homeWidgets.loadFailed', { message: error.message })); return; }

  const upcoming = upcomingBirthdays(data || [], 7);
  if (upcoming.length === 0) {
    empty(container, t('homeWidgets.noBirthdays'));
    return;
  }

  const palette = ['#4f46e5', '#0ea5a4', '#d97706', '#7c3aed', '#0369a1'];
  const list = document.createElement('div');
  list.className = 'space-y-2';
  list.innerHTML = upcoming.map((p, i) => `
    <div class="flex items-center justify-between gap-2 text-[12px]">
      <div class="flex items-center gap-2 min-w-0">
        <div class="w-[26px] h-[26px] rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0" style="background:${palette[i % palette.length]}">${initials(p.full_name)}</div>
        <span class="text-slate-700 font-medium truncate">${escapeHtml(p.full_name)}</span>
      </div>
      <span class="text-slate-400 text-[10.5px] shrink-0">${p.label}</span>
    </div>
  `).join('');
  container.appendChild(list);
}

function initials(fullName) {
  return (fullName || '').trim().split(/\s+/).slice(0, 2).map((n) => n[0]?.toUpperCase() || '').join('');
}

function upcomingBirthdays(profiles, withinDays) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return profiles
    .map((p) => {
      const bd = new Date(`${p.birth_date}T00:00:00`);
      if (Number.isNaN(bd.getTime())) return null;
      let next = new Date(today.getFullYear(), bd.getMonth(), bd.getDate());
      if (next < today) next = new Date(today.getFullYear() + 1, bd.getMonth(), bd.getDate());
      const diffDays = Math.round((next - today) / 86400000);
      if (diffDays > withinDays) return null;
      const label = diffDays === 0 ? t('homeWidgets.today') : dayLabels[next.getDay()];
      return { ...p, diffDays, label };
    })
    .filter(Boolean)
    .sort((a, b) => a.diffDays - b.diffDays)
    .slice(0, 5);
}

// ---- Prayer requests ----
export async function renderPrayerRequestsWidget(container, { supabase, onOpenQueue }) {
  container.className = CARD;
  container.innerHTML = `<p class="text-[12px] text-slate-400">${t('common.loading')}</p>`;

  const { data, error } = await supabase
    .from('prayer_requests')
    .select('id, request_text, status, created_at, requester:profiles!user_id ( full_name )')
    .order('created_at', { ascending: false })
    .limit(3);

  container.innerHTML = head(t('homeWidgets.prayerTitle'), onOpenQueue ? t('homeWidgets.queueLink') : null);
  if (onOpenQueue) container.querySelector('[data-action="widget-link"]').addEventListener('click', onOpenQueue);

  if (error) { empty(container, t('homeWidgets.loadFailed', { message: error.message })); return; }
  if (!data || data.length === 0) { empty(container, t('homeWidgets.noPrayerRequests')); return; }

  const list = document.createElement('div');
  list.className = 'space-y-2';
  list.innerHTML = data.map((row) => `
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0">
        <div class="text-[12px] font-semibold text-slate-700 truncate">${escapeHtml(row.request_text)}</div>
        <div class="text-[10.5px] text-slate-400 mt-0.5">${escapeHtml(row.requester?.full_name || '')}</div>
      </div>
      <span class="shrink-0 px-1.5 py-0.5 rounded-full text-[9.5px] font-bold uppercase tracking-wide ${row.status === 'pending' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}">
        ${row.status === 'pending' ? t('homeWidgets.statusNew') : t('homeWidgets.statusPrayed')}
      </span>
    </div>
  `).join('');
  container.appendChild(list);
}

// ---- Pending requests (aggregate preview across request types) ----
export async function renderPendingRequestsWidget(container, { supabase, onScrollToPending }) {
  container.className = CARD;
  container.innerHTML = `<p class="text-[12px] text-slate-400">${t('common.loading')}</p>`;

  const [memberships, meetings, budgets] = await Promise.all([
    supabase.from('department_memberships')
      .select('id, requested_at, member:profiles!user_id(full_name), department:departments!department_id(name)')
      .eq('status', 'pending').order('requested_at', { ascending: false }).limit(3),
    supabase.from('pastor_meeting_requests')
      .select('id, created_at, contact_name, requester:profiles!user_id(full_name)')
      .eq('status', 'pending').order('created_at', { ascending: false }).limit(3),
    supabase.from('budget_requests')
      .select('id, created_at, title, department:departments!requesting_department_id(name)')
      .eq('status', 'pending').order('created_at', { ascending: false }).limit(3),
  ]);

  container.innerHTML = head(t('homeWidgets.pendingTitle'), onScrollToPending ? t('homeWidgets.viewAllLink') : null);
  if (onScrollToPending) container.querySelector('[data-action="widget-link"]').addEventListener('click', onScrollToPending);

  const rows = [
    ...(memberships.data || []).map((m) => ({
      label: t('homeWidgets.pendingMembership', { name: m.member?.full_name || '', dept: m.department?.name || '' }),
      created_at: m.requested_at,
    })),
    ...(meetings.data || []).map((m) => ({
      label: t('homeWidgets.pendingMeeting', { name: m.requester?.full_name || m.contact_name || '' }),
      created_at: m.created_at,
    })),
    ...(budgets.data || []).map((b) => ({
      label: t('homeWidgets.pendingBudget', { title: b.title, dept: b.department?.name || '' }),
      created_at: b.created_at,
    })),
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);

  if (rows.length === 0) { empty(container, t('homeWidgets.noPendingRequests')); return; }

  const list = document.createElement('div');
  list.className = 'space-y-2';
  list.innerHTML = rows.map((r) => `
    <div class="flex items-center justify-between gap-2">
      <span class="text-[12px] font-semibold text-slate-700 truncate">${escapeHtml(r.label)}</span>
      <span class="px-1.5 py-0.5 rounded-full text-[9.5px] font-bold uppercase tracking-wide bg-amber-50 text-amber-700 shrink-0">${t('homeWidgets.statusPending')}</span>
    </div>
  `).join('');
  container.appendChild(list);
}

// ---- Attendance overview (last 6 Sundays) ----
export async function renderAttendanceWidget(container, { supabase, onOpenAttendance }) {
  container.className = `${CARD} md:col-span-2`;
  container.innerHTML = `<p class="text-[12px] text-slate-400">${t('common.loading')}</p>`;

  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - 7 * 8);
  const sinceStr = sinceDate.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('attendance_records')
    .select('service_date')
    .eq('service_type', 'sunday_service')
    .gte('service_date', sinceStr)
    .order('service_date', { ascending: true });

  container.innerHTML = head(t('homeWidgets.attendanceTitle'), onOpenAttendance ? t('homeWidgets.fullReportLink') : null);
  if (onOpenAttendance) container.querySelector('[data-action="widget-link"]').addEventListener('click', onOpenAttendance);

  if (error) { empty(container, t('homeWidgets.loadFailed', { message: error.message })); return; }
  if (!data || data.length === 0) { empty(container, t('homeWidgets.noAttendance')); return; }

  const weeks = bucketByWeek(data.map((r) => r.service_date)).slice(-6);
  const max = Math.max(...weeks.map((w) => w.count), 1);

  const chart = document.createElement('div');
  chart.innerHTML = `
    <div class="flex items-end gap-3 h-24 relative"
        style="background-image:repeating-linear-gradient(to top, #edeef2 0, #edeef2 1px, transparent 1px, transparent 33.33%)">
      ${weeks.map((w) => `
        <div class="flex-1 flex flex-col items-center justify-end gap-1 h-full relative z-10">
          <span class="text-[9px] font-bold text-slate-500 tabular-nums">${w.count}</span>
          <div class="w-full rounded-t ${w === weeks[weeks.length - 1] ? 'bg-indigo-600' : 'bg-indigo-200'}" style="height:${Math.max((w.count / max) * 100, 4)}%"></div>
        </div>
      `).join('')}
    </div>
    <div class="flex gap-3 mt-1.5">
      ${weeks.map((w) => `<div class="flex-1 text-center text-[9px] text-slate-400">${w.label}</div>`).join('')}
    </div>
  `;
  container.appendChild(chart);
}

function bucketByWeek(dateStrs) {
  const buckets = new Map();
  dateStrs.forEach((ds) => {
    const d = new Date(`${ds}T00:00:00`);
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const key = monday.toISOString().slice(0, 10);
    buckets.set(key, (buckets.get(key) || 0) + 1);
  });
  return Array.from(buckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, count]) => {
      const d = new Date(`${key}T00:00:00`);
      return { key, count, label: `${d.toLocaleString(appLocale(), { month: 'short' })} ${d.getDate()}` };
    });
}

// ---- Announcements ----
export async function renderAnnouncementsWidget(container, { supabase }) {
  container.className = CARD;
  container.innerHTML = `<p class="text-[12px] text-slate-400">${t('common.loading')}</p>`;

  const { data, error } = await supabase
    .from('department_announcements')
    .select('id, title, body, created_at, department:departments!department_id(name)')
    .order('created_at', { ascending: false })
    .limit(3);

  container.innerHTML = head(t('homeWidgets.announcementsTitle'), null);

  if (error) { empty(container, t('homeWidgets.loadFailed', { message: error.message })); return; }
  if (!data || data.length === 0) { empty(container, t('homeWidgets.noAnnouncements')); return; }

  const list = document.createElement('div');
  list.className = 'space-y-3';
  list.innerHTML = data.map((a) => `
    <div class="border-l-2 border-indigo-600 pl-3">
      <div class="text-[12px] font-semibold text-slate-800">${escapeHtml(a.title)}</div>
      ${a.body ? `<div class="text-[11px] text-slate-500 mt-0.5 line-clamp-2">${escapeHtml(a.body)}</div>` : ''}
      <div class="text-[9.5px] text-slate-400 mt-1">${escapeHtml(a.department?.name || '')}</div>
    </div>
  `).join('');
  container.appendChild(list);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
