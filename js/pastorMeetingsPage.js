// Pastor Meetings tab -- replaces the old note-only "Request meeting
// with pastor" popup. Visible to every signed-in user (everyone can
// book), with extra sections layered in by role:
//   - Pastor Admin, or anyone designated a meeting host in the Staff
//     tab (department admin, visiting pastor, etc. -- see
//     is_pastor_meeting_host()): "My Availability" (self-service
//     calendar) + "My Bookings" (people who booked with them).
//   - Super Admin / Church Secretary: "All Bookings" (every booking,
//     with contact info), "Staff" (roster of bookable pastors/hosts,
//     with the ability to manage a pastor's availability on their
//     behalf and add/remove meeting hosts).
//   - Super Admin / Church Secretary / Pastor Admin: "Settings"
//     (assignment mode, notice/lead time, timezone, online meeting
//     link, public booking link).
import { getEffectiveSupabase, getGlobalRole } from './departments.js';
import { renderPastorBookingCalendar } from './components/pastorBookingCalendar.js';
import { renderPastorAvailabilityCalendar } from './components/pastorAvailabilityCalendar.js';
import { t, tn } from './i18n.js';
import { confirmDialog } from './components/confirmDialog.js';
import { openMeetingWindow, navigateMeetingWindow } from './components/videoMeeting.js';
import { getTenantId, getTenant } from './tenant.js';
import { publicPageUrl } from './utils/publicUrl.js';

const PASTORAL_TEAM_ROLES = ['super_admin', 'church_secretary'];

// Curated rather than a free-text field -- a typo'd IANA zone would
// silently break every time conversion in pastorBookingCalendar.js.
// Covers the regions this app's actual congregation data spans
// (Canada/US, Western/Central Europe, Central/West/East/Southern
// Africa) rather than the full ~400-zone IANA list.
const TIMEZONE_CHOICES = [
  { value: 'America/Toronto', label: 'Eastern Time (Toronto/Ottawa)' },
  { value: 'America/Vancouver', label: 'Pacific Time (Vancouver)' },
  { value: 'America/New_York', label: 'Eastern Time (US)' },
  { value: 'America/Chicago', label: 'Central Time (US)' },
  { value: 'America/Denver', label: 'Mountain Time (US)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (US)' },
  { value: 'Europe/London', label: 'London' },
  { value: 'Europe/Paris', label: 'Paris/Brussels' },
  { value: 'Africa/Kinshasa', label: 'Kinshasa' },
  { value: 'Africa/Lagos', label: 'Lagos' },
  { value: 'Africa/Nairobi', label: 'Nairobi' },
  { value: 'Africa/Johannesburg', label: 'Johannesburg' },
];

export async function renderPastorMeetingsTab() {
  const supabase = getEffectiveSupabase();
  const container = document.querySelector('#pastor-meetings-content');
  container.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    container.innerHTML = `<p class="text-slate-500">${t('scheduling.pleaseSignIn')}</p>`;
    return;
  }

  const { data: profile } = await supabase.from('profiles').select('id, full_name, phone').eq('id', user.id).single();
  const role = getGlobalRole();
  const isPastorAdminRole = role === 'pastor_admin';
  // A meeting host who isn't a Pastor Admin (a department admin or
  // visiting pastor added via the Staff tab) needs the same
  // "My Availability"/"My Bookings" access -- is_pastor_meeting_host()
  // is the single source of truth this whole feature already uses
  // server-side for who can actually write pastor_availability rows.
  const { data: isHost } = await supabase.rpc('is_pastor_meeting_host');
  const isPastor = isPastorAdminRole || !!isHost;
  const isAdminTeam = PASTORAL_TEAM_ROLES.includes(role);

  const tabs = [{ key: 'book', label: t('pastorBooking.tabBook') }, { key: 'my-requests', label: t('pastorBooking.tabMyRequests') }];
  if (isPastor) {
    tabs.push({ key: 'my-availability', label: t('pastorBooking.tabMyAvailability') });
    tabs.push({ key: 'my-bookings', label: t('pastorBooking.tabMyBookings') });
  }
  if (isAdminTeam) {
    tabs.push({ key: 'all-bookings', label: t('pastorBooking.tabAllBookings') });
    tabs.push({ key: 'staff', label: t('pastorBooking.tabStaff') });
  }
  if (isAdminTeam || isPastorAdminRole) {
    tabs.push({ key: 'settings', label: t('pastorBooking.tabSettings') });
  }

  container.innerHTML = `
    <div class="flex flex-wrap gap-2 mb-6" data-el="tab-buttons"></div>
    <div data-el="tab-body"></div>
  `;
  const tabButtonsEl = container.querySelector('[data-el="tab-buttons"]');
  const bodyEl = container.querySelector('[data-el="tab-body"]');

  tabs.forEach((tabDef, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.tabKey = tabDef.key;
    btn.textContent = tabDef.label;
    btn.className = 'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors';
    btn.addEventListener('click', () => activate(tabDef.key));
    tabButtonsEl.appendChild(btn);
    if (i === 0) activate(tabDef.key);
  });

  function setTabStyle(key) {
    tabButtonsEl.querySelectorAll('button').forEach((btn) => {
      const active = btn.dataset.tabKey === key;
      btn.classList.toggle('bg-indigo-600', active);
      btn.classList.toggle('text-white', active);
      btn.classList.toggle('text-slate-600', !active);
      btn.classList.toggle('hover:bg-slate-100', !active);
    });
  }

  function activate(key) {
    setTabStyle(key);
    bodyEl.innerHTML = '';
    if (key === 'book') renderBookTab();
    else if (key === 'my-requests') renderMyRequestsTab();
    else if (key === 'my-availability') renderPastorAvailabilityCalendar(bodyEl, { supabase, pastorId: user.id });
    else if (key === 'my-bookings') renderBookingsList(bodyEl, { supabase, filter: { pastor_id: user.id }, canCancel: true, currentUserId: user.id });
    else if (key === 'all-bookings') renderBookingsList(bodyEl, { supabase, filter: {}, canCancel: true, currentUserId: user.id, showPastorColumn: true });
    else if (key === 'staff') renderStaffTab(bodyEl, { supabase });
    else if (key === 'settings') renderSettingsTab(bodyEl, { supabase, currentUserId: user.id });
  }

  function renderBookTab() {
    const wrap = document.createElement('div');
    wrap.className = 'bg-white rounded-xl shadow p-4 sm:p-6';
    bodyEl.appendChild(wrap);
    renderPastorBookingCalendar(wrap, {
      supabase,
      currentUserProfile: profile,
      onBooked: () => {},
    });
  }

  function renderMyRequestsTab() {
    renderBookingsList(bodyEl, { supabase, filter: { user_id: user.id }, canCancel: false, currentUserId: user.id, showPastorColumn: true });
  }
}

async function renderBookingsList(container, { supabase, filter, canCancel, currentUserId, showPastorColumn }) {
  container.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

  let query = supabase
    .from('pastor_meeting_requests')
    .select('id, note, status, meeting_room, meeting_link, meeting_date, meeting_start_time, meeting_end_time, created_at, contact_name, contact_phone, guest_email, cancellation_reason, meeting_type, requester:profiles!user_id(full_name), pastor:profiles!pastor_id(full_name)')
    .order('created_at', { ascending: false });
  Object.entries(filter).forEach(([col, val]) => { query = query.eq(col, val); });

  const { data, error } = await query;
  if (error) {
    container.innerHTML = `<p class="text-sm text-rose-600">${t('pastorBooking.loadFailed', { message: error.message })}</p>`;
    return;
  }
  if (!data || data.length === 0) {
    container.innerHTML = `<p class="text-sm text-slate-500 bg-white rounded-xl shadow p-4 sm:p-6">${t('pastorBooking.noBookings')}</p>`;
    return;
  }

  container.innerHTML = '';
  const list = document.createElement('div');
  list.className = 'space-y-2';
  container.appendChild(list);

  data.forEach((row) => {
    const who = row.requester?.full_name || row.contact_name || t('pastorBooking.unknownRequester');
    const joinUrl = row.meeting_link || null;
    const el = document.createElement('div');
    el.className = 'bg-white rounded-xl shadow p-3 sm:p-4 text-sm';
    el.innerHTML = `
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <span class="font-medium text-slate-800">${escapeHtml(who)}</span>
          ${showPastorColumn && row.pastor?.full_name ? ` <span class="text-slate-400">${t('pastorBooking.withPastor', { name: escapeHtml(row.pastor.full_name) })}</span>` : ''}
        </div>
        ${statusBadge(row.status)}
      </div>
      ${row.meeting_date ? `
        <div class="text-sm font-medium text-indigo-700 mt-1">${escapeHtml(formatMeetingDate(row.meeting_date))} · ${escapeHtml(formatTime(row.meeting_start_time))}–${escapeHtml(formatTime(row.meeting_end_time))}</div>
      ` : ''}
      <div class="text-xs text-slate-500 mt-1">${t('pastorBooking.bookedOn', { date: escapeHtml(new Date(row.created_at).toLocaleString()) })} · ${row.meeting_type === 'online' ? t('pastorBooking.online') : t('pastorBooking.office')}</div>
      ${row.contact_name || row.contact_phone || row.guest_email ? `
        <div class="text-xs text-slate-500 mt-1">
          ${[row.contact_name, row.contact_phone, row.guest_email].filter(Boolean).map(escapeHtml).join(' · ')}
        </div>
      ` : ''}
      ${row.note ? `<p class="text-slate-700 mt-2">${escapeHtml(row.note)}</p>` : ''}
      ${row.status === 'cancelled' && row.cancellation_reason ? `<p class="text-xs text-rose-600 mt-2">${t('pastorBooking.cancellationReasonLabel')}: ${escapeHtml(row.cancellation_reason)}</p>` : ''}
      <div class="flex items-center gap-2 mt-2">
        ${row.status === 'confirmed' && (joinUrl || row.meeting_room) ? `<button type="button" data-action="join" class="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700">${t('meeting.join')}</button>` : ''}
        ${canCancel && row.status === 'confirmed' ? `<button type="button" data-action="cancel" class="px-3 py-1.5 rounded-lg bg-rose-100 text-rose-700 text-xs font-medium hover:bg-rose-200">${t('pastorBooking.cancel')}</button>` : ''}
      </div>
    `;

    el.querySelector('[data-action="join"]')?.addEventListener('click', async () => {
      if (joinUrl) {
        window.open(joinUrl, '_blank', 'noopener');
        return;
      }
      const win = openMeetingWindow();
      const { data: myProfile } = await supabase.from('profiles').select('full_name').eq('id', currentUserId).single();
      navigateMeetingWindow(win, { roomName: row.meeting_room, displayName: myProfile?.full_name || '' });
    });

    el.querySelector('[data-action="cancel"]')?.addEventListener('click', async () => {
      // window.prompt for the single required text field -- same
      // lightweight pattern already used elsewhere in this app
      // (courseBuilder.js) rather than building a whole modal for one
      // input.
      const reason = window.prompt(t('pastorBooking.cancelReasonPrompt'));
      if (reason === null) return; // user cancelled the prompt itself
      if (!reason.trim()) {
        window.alert(t('pastorBooking.cancelReasonRequired'));
        return;
      }
      if (!(await confirmDialog({ message: t('pastorBooking.confirmCancel') }))) return;
      const { error: cancelError } = await supabase.rpc('cancel_pastor_meeting_booking', { p_id: row.id, p_reason: reason.trim() });
      if (cancelError) {
        window.alert(t('pastorBooking.cancelFailed', { message: cancelError.message }));
        return;
      }
      renderBookingsList(container, { supabase, filter, canCancel, currentUserId, showPastorColumn });
    });

    list.appendChild(el);
  });
}

function statusBadge(status) {
  const styles = {
    confirmed: 'bg-emerald-100 text-emerald-700',
    cancelled: 'bg-slate-100 text-slate-500',
    pending: 'bg-amber-100 text-amber-700',
    declined: 'bg-rose-100 text-rose-700',
  };
  return `<span class="px-2 py-0.5 rounded text-xs font-medium ${styles[status] || styles.pending}">${t(`pastorMeeting.status.${status}`) || status}</span>`;
}

async function renderStaffTab(container, { supabase }) {
  container.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

  const { data: pastors, error } = await supabase.rpc('list_bookable_pastors');
  if (error) {
    container.innerHTML = `<p class="text-sm text-rose-600">${t('pastorBooking.loadFailed', { message: error.message })}</p>`;
    return;
  }

  container.innerHTML = `
    <div data-el="staff-list-view">
      <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-4">
        <h3 class="font-semibold text-slate-800 mb-2">${t('pastorBooking.addHostTitle')}</h3>
        <p class="text-sm text-slate-500 mb-2">${t('pastorBooking.addHostIntro')}</p>
        <input type="text" data-el="host-search" placeholder="${t('pastorBooking.addHostSearchPlaceholder')}" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        <div data-el="host-results" class="border border-slate-200 rounded-lg mt-1 divide-y divide-slate-100 hidden"></div>
        <p data-el="add-host-status" class="text-sm mt-2"></p>
      </div>
      <div data-el="staff-list" class="space-y-2"></div>
    </div>
    <div data-el="staff-availability-view" class="hidden"></div>
  `;

  const listViewEl = container.querySelector('[data-el="staff-list-view"]');
  const availabilityViewEl = container.querySelector('[data-el="staff-availability-view"]');
  const listEl = container.querySelector('[data-el="staff-list"]');
  const searchInput = container.querySelector('[data-el="host-search"]');
  const resultsEl = container.querySelector('[data-el="host-results"]');
  const addStatusEl = container.querySelector('[data-el="add-host-status"]');

  function renderList(rows) {
    if (!rows || rows.length === 0) {
      listEl.innerHTML = `<p class="text-sm text-slate-500 bg-white rounded-xl shadow p-4 sm:p-6">${t('pastorBooking.noStaff')}</p>`;
      return;
    }
    listEl.innerHTML = '';
    rows.forEach((p) => {
      const el = document.createElement('div');
      el.className = 'bg-white rounded-xl shadow p-3 sm:p-4 flex items-center justify-between gap-2 flex-wrap';
      el.innerHTML = `
        <div class="flex items-center gap-2">
          <span class="font-medium text-slate-800">${escapeHtml(p.full_name)}</span>
          <span class="px-1.5 py-0.5 rounded text-[11px] font-medium ${p.is_host ? 'bg-sky-100 text-sky-700' : 'bg-indigo-100 text-indigo-700'}">${p.is_host ? t('pastorBooking.hostBadge') : t('pastorBooking.pastorBadge')}</span>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-sm text-slate-500">${tn('pastorBooking.upcomingSlots', p.upcoming_slot_count || 0)}</span>
          <button type="button" data-action="manage-availability" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-medium hover:bg-slate-200">${t('pastorBooking.manageAvailability')}</button>
          ${p.is_host ? `<button type="button" data-action="remove-host" class="px-3 py-1.5 rounded-lg bg-rose-100 text-rose-700 text-xs font-medium hover:bg-rose-200">${t('pastorBooking.removeHost')}</button>` : ''}
        </div>
      `;
      el.querySelector('[data-action="manage-availability"]').addEventListener('click', () => openAvailabilityFor(p));
      el.querySelector('[data-action="remove-host"]')?.addEventListener('click', async () => {
        if (!(await confirmDialog({ message: t('pastorBooking.confirmRemoveHost', { name: p.full_name }) }))) return;
        const { error: removeError } = await supabase.rpc('remove_pastor_meeting_host', { p_user_id: p.id });
        if (removeError) {
          window.alert(t('pastorBooking.saveFailed', { message: removeError.message }));
          return;
        }
        renderStaffTab(container, { supabase });
      });
      listEl.appendChild(el);
    });
  }
  renderList(pastors);

  function openAvailabilityFor(p) {
    listViewEl.classList.add('hidden');
    availabilityViewEl.classList.remove('hidden');
    availabilityViewEl.innerHTML = `
      <button type="button" data-action="back-to-staff" class="text-sm text-indigo-600 hover:text-indigo-800 font-medium mb-4">${t('pastorBooking.backToStaff')}</button>
      <h3 class="font-semibold text-slate-800 mb-4">${t('pastorBooking.manageAvailabilityFor', { name: p.full_name })}</h3>
      <div data-el="availability-body"></div>
    `;
    availabilityViewEl.querySelector('[data-action="back-to-staff"]').addEventListener('click', () => {
      availabilityViewEl.classList.add('hidden');
      listViewEl.classList.remove('hidden');
    });
    renderPastorAvailabilityCalendar(availabilityViewEl.querySelector('[data-el="availability-body"]'), { supabase, pastorId: p.id });
  }

  let searchTimeout = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(searchMembers, 200);
  });

  async function searchMembers() {
    const query = searchInput.value.trim();
    if (!query) { resultsEl.classList.add('hidden'); resultsEl.innerHTML = ''; return; }

    const existingIds = new Set((pastors || []).map((p) => p.id));
    const { data } = await supabase.from('profiles').select('id, full_name').ilike('full_name', `%${query}%`).order('full_name').limit(8);
    const rows = (data || []).filter((r) => !existingIds.has(r.id));
    if (rows.length === 0) { resultsEl.classList.add('hidden'); resultsEl.innerHTML = ''; return; }

    resultsEl.classList.remove('hidden');
    resultsEl.innerHTML = rows.map((r) => `<button type="button" data-user-id="${r.id}" class="block w-full text-left px-3 py-2 text-sm hover:bg-slate-50">${escapeHtml(r.full_name)}</button>`).join('');
    resultsEl.querySelectorAll('[data-user-id]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const selected = rows.find((r) => r.id === btn.dataset.userId);
        addStatusEl.className = 'text-sm text-slate-500 mt-2';
        addStatusEl.textContent = t('common.saving');
        const { error: addError } = await supabase.rpc('add_pastor_meeting_host', { p_user_id: selected.id });
        if (addError) {
          addStatusEl.className = 'text-sm text-rose-600 mt-2';
          addStatusEl.textContent = t('pastorBooking.saveFailed', { message: addError.message });
          return;
        }
        addStatusEl.className = 'text-sm text-emerald-600 mt-2';
        addStatusEl.textContent = t('pastorBooking.hostAdded', { name: selected.full_name });
        searchInput.value = '';
        resultsEl.classList.add('hidden');
        renderStaffTab(container, { supabase });
      });
    });
  }
}

async function renderSettingsTab(container, { supabase, currentUserId }) {
  container.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

  // RESTRICTIVE tenant_isolation on this table already scopes the
  // SELECT to the caller's own tenant -- no explicit filter needed, at
  // most one row exists per tenant (tenant_id is the PK).
  const { data, error } = await supabase.from('pastor_meeting_settings')
    .select('selection_mode, min_booking_notice_hours, max_booking_lead_days, church_timezone, online_meeting_link')
    .maybeSingle();
  if (error) {
    container.innerHTML = `<p class="text-sm text-rose-600">${t('pastorBooking.loadFailed', { message: error.message })}</p>`;
    return;
  }

  // Public link needs the tenant's slug -- an anon visitor has no
  // session to resolve current_tenant_id() from, unlike main's single-
  // church booking.html, which needs no identifier at all.
  const publicUrl = publicPageUrl('booking.html', { church: getTenant()?.slug || '' });

  container.innerHTML = `
    <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-4">
      <h3 class="font-semibold text-slate-800 mb-3">${t('pastorBooking.assignmentModeTitle')}</h3>
      <div class="space-y-2">
        <label class="flex items-center gap-2 text-sm">
          <input type="radio" name="mode" value="manual" ${data?.selection_mode === 'manual' ? 'checked' : ''} />
          ${t('pastorBooking.modeManual')}
        </label>
        <label class="flex items-center gap-2 text-sm">
          <input type="radio" name="mode" value="random" ${data?.selection_mode === 'random' ? 'checked' : ''} />
          ${t('pastorBooking.modeRandom')}
        </label>
      </div>
      <p data-el="mode-status" class="text-sm mt-2"></p>
    </div>
    <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-4">
      <h3 class="font-semibold text-slate-800 mb-2">${t('pastorBooking.noticeTitle')}</h3>
      <p class="text-sm text-slate-500 mb-2">${t('pastorBooking.noticeIntro')}</p>
      <div class="flex items-center gap-2">
        <input type="number" data-el="notice-input" min="0" step="1" value="${data?.min_booking_notice_hours ?? 24}" class="w-24 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        <span class="text-sm text-slate-500">${t('pastorBooking.hours')}</span>
        <button type="button" data-action="save-notice" class="px-3 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">${t('pastorBooking.saveNotice')}</button>
      </div>
      <p data-el="notice-status" class="text-sm mt-2"></p>
    </div>
    <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-4">
      <h3 class="font-semibold text-slate-800 mb-2">${t('pastorBooking.maxLeadTitle')}</h3>
      <p class="text-sm text-slate-500 mb-2">${t('pastorBooking.maxLeadIntro')}</p>
      <div class="flex items-center gap-2">
        <input type="number" data-el="max-lead-input" min="0" step="1" value="${data?.max_booking_lead_days ?? ''}" placeholder="${t('pastorBooking.noLimit')}" class="w-24 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        <span class="text-sm text-slate-500">${t('pastorBooking.days')}</span>
        <button type="button" data-action="save-max-lead" class="px-3 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">${t('pastorBooking.saveMaxLead')}</button>
      </div>
      <p data-el="max-lead-status" class="text-sm mt-2"></p>
    </div>
    <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-4">
      <h3 class="font-semibold text-slate-800 mb-2">${t('pastorBooking.timezoneTitle')}</h3>
      <p class="text-sm text-slate-500 mb-2">${t('pastorBooking.timezoneIntro')}</p>
      <div class="flex items-center gap-2">
        <select data-el="timezone-select" class="border border-slate-300 rounded-lg px-3 py-2 text-sm">
          ${TIMEZONE_CHOICES.map((z) => `<option value="${z.value}" ${data?.church_timezone === z.value ? 'selected' : ''}>${escapeHtml(z.label)}</option>`).join('')}
        </select>
        <button type="button" data-action="save-timezone" class="px-3 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">${t('pastorBooking.saveNotice')}</button>
      </div>
      <p data-el="timezone-status" class="text-sm mt-2"></p>
    </div>
    <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-4">
      <h3 class="font-semibold text-slate-800 mb-2">${t('pastorBooking.onlineLinkTitle')}</h3>
      <p class="text-sm text-slate-500 mb-2">${t('pastorBooking.onlineLinkIntro')}</p>
      <div class="flex items-center gap-2">
        <input type="url" data-el="online-link-input" placeholder="${t('pastorBooking.onlineLinkPlaceholder')}" value="${escapeAttr(data?.online_meeting_link || '')}" class="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        <button type="button" data-action="save-online-link" class="px-3 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">${t('pastorBooking.saveNotice')}</button>
      </div>
      <p data-el="online-link-status" class="text-sm mt-2"></p>
    </div>
    <div class="bg-white rounded-xl shadow p-4 sm:p-6">
      <h3 class="font-semibold text-slate-800 mb-2">${t('pastorBooking.publicLinkTitle')}</h3>
      <p class="text-sm text-slate-500 mb-2">${t('pastorBooking.publicLinkIntro')}</p>
      <div class="flex items-center gap-2">
        <input type="text" readonly value="${escapeAttr(publicUrl)}" class="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm bg-slate-50" />
        <button type="button" data-action="copy-link" class="px-3 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">${t('pastorBooking.copyLink')}</button>
      </div>
    </div>
  `;

  const statusEl = container.querySelector('[data-el="mode-status"]');
  container.querySelectorAll('input[name="mode"]').forEach((input) => {
    input.addEventListener('change', async () => {
      statusEl.className = 'text-sm text-slate-500 mt-2';
      statusEl.textContent = t('common.saving');
      const { error: saveError } = await supabase.from('pastor_meeting_settings').upsert(
        { tenant_id: getTenantId(), selection_mode: input.value, updated_by: currentUserId, updated_at: new Date().toISOString() },
        { onConflict: 'tenant_id' },
      );
      if (saveError) {
        statusEl.className = 'text-sm text-rose-600 mt-2';
        statusEl.textContent = t('pastorBooking.saveFailed', { message: saveError.message });
        return;
      }
      statusEl.className = 'text-sm text-emerald-600 mt-2';
      statusEl.textContent = t('pastorBooking.saved');
    });
  });

  const noticeStatusEl = container.querySelector('[data-el="notice-status"]');
  container.querySelector('[data-action="save-notice"]').addEventListener('click', async () => {
    const hours = Number(container.querySelector('[data-el="notice-input"]').value);
    if (!Number.isFinite(hours) || hours < 0) {
      noticeStatusEl.className = 'text-sm text-rose-600 mt-2';
      noticeStatusEl.textContent = t('pastorBooking.invalidNotice');
      return;
    }
    noticeStatusEl.className = 'text-sm text-slate-500 mt-2';
    noticeStatusEl.textContent = t('common.saving');
    const { error: saveError } = await supabase.from('pastor_meeting_settings').upsert(
      { tenant_id: getTenantId(), min_booking_notice_hours: hours, updated_by: currentUserId, updated_at: new Date().toISOString() },
      { onConflict: 'tenant_id' },
    );
    if (saveError) {
      noticeStatusEl.className = 'text-sm text-rose-600 mt-2';
      noticeStatusEl.textContent = t('pastorBooking.saveFailed', { message: saveError.message });
      return;
    }
    noticeStatusEl.className = 'text-sm text-emerald-600 mt-2';
    noticeStatusEl.textContent = t('pastorBooking.saved');
  });

  const maxLeadStatusEl = container.querySelector('[data-el="max-lead-status"]');
  container.querySelector('[data-action="save-max-lead"]').addEventListener('click', async () => {
    const raw = container.querySelector('[data-el="max-lead-input"]').value.trim();
    const days = raw === '' ? null : Number(raw);
    if (raw !== '' && (!Number.isFinite(days) || days < 0)) {
      maxLeadStatusEl.className = 'text-sm text-rose-600 mt-2';
      maxLeadStatusEl.textContent = t('pastorBooking.invalidMaxLead');
      return;
    }
    maxLeadStatusEl.className = 'text-sm text-slate-500 mt-2';
    maxLeadStatusEl.textContent = t('common.saving');
    const { error: saveError } = await supabase.from('pastor_meeting_settings').upsert(
      { tenant_id: getTenantId(), max_booking_lead_days: days, updated_by: currentUserId, updated_at: new Date().toISOString() },
      { onConflict: 'tenant_id' },
    );
    if (saveError) {
      maxLeadStatusEl.className = 'text-sm text-rose-600 mt-2';
      maxLeadStatusEl.textContent = t('pastorBooking.saveFailed', { message: saveError.message });
      return;
    }
    maxLeadStatusEl.className = 'text-sm text-emerald-600 mt-2';
    maxLeadStatusEl.textContent = t('pastorBooking.saved');
  });

  const timezoneStatusEl = container.querySelector('[data-el="timezone-status"]');
  container.querySelector('[data-action="save-timezone"]').addEventListener('click', async () => {
    const tz = container.querySelector('[data-el="timezone-select"]').value;
    timezoneStatusEl.className = 'text-sm text-slate-500 mt-2';
    timezoneStatusEl.textContent = t('common.saving');
    const { error: saveError } = await supabase.from('pastor_meeting_settings').upsert(
      { tenant_id: getTenantId(), church_timezone: tz, updated_by: currentUserId, updated_at: new Date().toISOString() },
      { onConflict: 'tenant_id' },
    );
    if (saveError) {
      timezoneStatusEl.className = 'text-sm text-rose-600 mt-2';
      timezoneStatusEl.textContent = t('pastorBooking.saveFailed', { message: saveError.message });
      return;
    }
    timezoneStatusEl.className = 'text-sm text-emerald-600 mt-2';
    timezoneStatusEl.textContent = t('pastorBooking.saved');
  });

  const onlineLinkStatusEl = container.querySelector('[data-el="online-link-status"]');
  container.querySelector('[data-action="save-online-link"]').addEventListener('click', async () => {
    const link = container.querySelector('[data-el="online-link-input"]').value.trim();
    onlineLinkStatusEl.className = 'text-sm text-slate-500 mt-2';
    onlineLinkStatusEl.textContent = t('common.saving');
    const { error: saveError } = await supabase.from('pastor_meeting_settings').upsert(
      { tenant_id: getTenantId(), online_meeting_link: link || null, updated_by: currentUserId, updated_at: new Date().toISOString() },
      { onConflict: 'tenant_id' },
    );
    if (saveError) {
      onlineLinkStatusEl.className = 'text-sm text-rose-600 mt-2';
      onlineLinkStatusEl.textContent = t('pastorBooking.saveFailed', { message: saveError.message });
      return;
    }
    onlineLinkStatusEl.className = 'text-sm text-emerald-600 mt-2';
    onlineLinkStatusEl.textContent = t('pastorBooking.saved');
  });

  container.querySelector('[data-action="copy-link"]').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      const btn = container.querySelector('[data-action="copy-link"]');
      const original = btn.textContent;
      btn.textContent = t('pastorBooking.copied');
      setTimeout(() => { btn.textContent = original; }, 1500);
    } catch {
      window.prompt(t('pastorBooking.copyLinkManual'), publicUrl);
    }
  });
}

function formatMeetingDate(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
}

function formatTime(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(str).replaceAll('"', '&quot;');
}
