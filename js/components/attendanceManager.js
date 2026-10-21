// Attendance check-in for Ushers' admin/secretary, any approved
// Welcoming & Socialisation member, or Super Admin/Pastor Admin/
// Church Secretary (see can_record_attendance() in sql/037, widened
// by sql/saas_platform/91) — search for a member by name and check
// them in, or log a guest visitor by name. sql/038's trigger picks
// guests up for pastoral follow-up automatically.
import { confirmDialog } from './confirmDialog.js';
import { t } from '../i18n.js';

const SERVICE_TYPES = ['sunday_service', 'midweek_service', 'special_service'];

function todayLocalDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// Mountable render function (the pastoral dashboard's own Attendance
// Check-In tab mounts this directly) plus a thin modal wrapper around
// it, same split userManager.js's renderUserManager/
// createUserManagerModal already uses.
export function renderAttendanceManager(container, { supabase, currentUserId }) {
  container.innerHTML = `
      <div class="grid sm:grid-cols-2 gap-3 mb-4">
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('attendance.serviceDate')}</label>
          <input type="date" data-el="service-date" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('attendance.serviceType')}</label>
          <select data-el="service-type" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            ${SERVICE_TYPES.map((s) => `<option value="${s}">${t(`attendance.type.${s}`)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div data-el="service-label-wrap" class="hidden mb-4">
        <label class="block text-sm font-medium text-slate-600 mb-1">${t('attendance.serviceLabel')}</label>
        <input type="text" data-el="service-label" placeholder="${t('attendance.serviceLabelPlaceholder')}"
               class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      </div>

      <input type="search" data-el="member-search" placeholder="${t('attendance.searchPlaceholder')}"
             class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-2" />
      <div data-el="search-results" class="max-h-40 overflow-y-auto border border-slate-100 rounded-lg divide-y mb-3"></div>

      <div class="border-t border-slate-200 pt-3 space-y-2">
        <p class="text-sm font-semibold text-slate-700">${t('attendance.guestName')}</p>

        <input type="text" data-el="guest-name" placeholder="${t('attendance.guestNamePlaceholder')}"
               class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />

        <div class="grid sm:grid-cols-2 gap-2">
          <input type="tel" data-el="guest-phone" placeholder="${t('attendance.guestPhonePlaceholder')}"
                 class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          <input type="email" data-el="guest-email" placeholder="${t('attendance.guestEmailPlaceholder')}"
                 class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>

        <input type="text" data-el="guest-city" placeholder="${t('attendance.guestCityPlaceholder')}"
               class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />

        <select data-el="guest-referral" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
          <option value="">${t('attendance.guestReferralPlaceholder')}</option>
          <option value="social_media">${t('attendance.referral.social_media')}</option>
          <option value="vpd_elsewhere">${t('attendance.referral.vpd_elsewhere')}</option>
          <option value="word_of_mouth">${t('attendance.referral.word_of_mouth')}</option>
        </select>

        <input type="text" data-el="guest-referred-by" placeholder="${t('attendance.guestReferredByPlaceholder')}"
               class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />

        <select data-el="guest-age-range" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
          <option value="">${t('attendance.guestAgeRangePlaceholder')}</option>
          <option value="under_18">${t('attendance.ageRange.under_18')}</option>
          <option value="18_29">${t('attendance.ageRange.18_29')}</option>
          <option value="30_40">${t('attendance.ageRange.30_40')}</option>
          <option value="40_50">${t('attendance.ageRange.40_50')}</option>
          <option value="50_plus">${t('attendance.ageRange.50_plus')}</option>
        </select>

        <label class="flex items-center gap-1.5 text-sm text-slate-600">
          <input type="checkbox" data-el="guest-has-prayer-request" /> ${t('attendance.guestPrayerRequestCheckbox')}
        </label>
        <textarea data-el="guest-prayer-request" rows="2" placeholder="${t('attendance.guestPrayerRequestPlaceholder')}"
                  class="hidden w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"></textarea>

        <label class="flex items-center gap-1.5 text-sm text-slate-600">
          <input type="checkbox" data-el="guest-wants-pastor-meeting" /> ${t('attendance.guestWantsPastorMeeting')}
        </label>

        <label class="flex items-center gap-1.5 text-sm text-slate-600">
          <input type="checkbox" data-el="guest-has-home-church" /> ${t('attendance.guestHasHomeChurchCheckbox')}
        </label>
        <input type="text" data-el="guest-home-church" placeholder="${t('attendance.guestHomeChurchPlaceholder')}"
               class="hidden w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />

        <button type="button" data-action="add-guest" class="w-full px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">
          ${t('attendance.addGuest')}
        </button>
      </div>

      <p data-el="status" class="text-sm mt-3"></p>
      <div data-el="checked-in-list" class="mt-3 space-y-1"></div>
  `;

  const serviceDateEl = container.querySelector('[data-el="service-date"]');
  const serviceTypeEl = container.querySelector('[data-el="service-type"]');
  const serviceLabelWrapEl = container.querySelector('[data-el="service-label-wrap"]');
  const serviceLabelEl = container.querySelector('[data-el="service-label"]');
  const memberSearchEl = container.querySelector('[data-el="member-search"]');
  const searchResultsEl = container.querySelector('[data-el="search-results"]');
  const guestNameEl = container.querySelector('[data-el="guest-name"]');
  const guestPhoneEl = container.querySelector('[data-el="guest-phone"]');
  const guestEmailEl = container.querySelector('[data-el="guest-email"]');
  const guestCityEl = container.querySelector('[data-el="guest-city"]');
  const guestReferralEl = container.querySelector('[data-el="guest-referral"]');
  const guestReferredByEl = container.querySelector('[data-el="guest-referred-by"]');
  const guestAgeRangeEl = container.querySelector('[data-el="guest-age-range"]');
  const guestHasPrayerRequestEl = container.querySelector('[data-el="guest-has-prayer-request"]');
  const guestPrayerRequestEl = container.querySelector('[data-el="guest-prayer-request"]');
  const guestWantsPastorMeetingEl = container.querySelector('[data-el="guest-wants-pastor-meeting"]');
  const guestHasHomeChurchEl = container.querySelector('[data-el="guest-has-home-church"]');
  const guestHomeChurchEl = container.querySelector('[data-el="guest-home-church"]');
  const addGuestBtn = container.querySelector('[data-action="add-guest"]');
  const statusEl = container.querySelector('[data-el="status"]');
  const checkedInListEl = container.querySelector('[data-el="checked-in-list"]');

  let members = [];

  serviceTypeEl.addEventListener('change', () => {
    serviceLabelWrapEl.classList.toggle('hidden', serviceTypeEl.value !== 'special_service');
    loadHistory();
  });
  serviceDateEl.addEventListener('change', loadHistory);

  async function loadMembers() {
    const { data } = await supabase
      .from('department_memberships')
      .select('user_id, member:profiles!user_id ( id, full_name )')
      .eq('status', 'approved');

    const byId = new Map();
    (data || []).forEach((r) => { if (r.member) byId.set(r.member.id, r.member.full_name); });
    members = Array.from(byId.entries()).map(([id, full_name]) => ({ id, full_name })).sort((a, b) => a.full_name.localeCompare(b.full_name));
  }

  memberSearchEl.addEventListener('input', () => renderSearchResults(memberSearchEl.value.trim().toLowerCase()));

  function renderSearchResults(query) {
    const matches = query ? members.filter((m) => m.full_name.toLowerCase().includes(query)) : [];
    searchResultsEl.innerHTML = matches.slice(0, 15).map((m) => `
      <button type="button" data-member-id="${m.id}" class="w-full text-left px-2 py-1.5 text-sm hover:bg-slate-100">${escapeHtml(m.full_name)}</button>
    `).join('');
    searchResultsEl.querySelectorAll('[data-member-id]').forEach((btn) => {
      btn.addEventListener('click', () => checkInMember(btn.dataset.memberId, btn.textContent.trim()));
    });
  }

  guestHasPrayerRequestEl.addEventListener('change', () => {
    guestPrayerRequestEl.classList.toggle('hidden', !guestHasPrayerRequestEl.checked);
  });
  guestHasHomeChurchEl.addEventListener('change', () => {
    guestHomeChurchEl.classList.toggle('hidden', !guestHasHomeChurchEl.checked);
  });

  addGuestBtn.addEventListener('click', () => {
    const name = guestNameEl.value.trim();
    if (!name) return;
    checkInGuest(name);
  });

  async function checkInMember(memberId, memberName) {
    statusEl.className = 'text-sm text-slate-500';
    statusEl.textContent = t('common.saving');

    const { error } = await supabase.from('attendance_records').insert({
      service_date: serviceDateEl.value,
      service_type: serviceTypeEl.value,
      service_label: serviceTypeEl.value === 'special_service' ? (serviceLabelEl.value.trim() || null) : null,
      member_id: memberId,
      recorded_by: currentUserId,
    });

    if (error) {
      // A repeat search for someone already checked in for this
      // service just no-ops instead of erroring — the unique index in
      // sql/037 is what actually prevents the duplicate.
      if (error.code === '23505') {
        statusEl.className = 'text-sm text-amber-600';
        statusEl.textContent = t('attendance.alreadyCheckedIn', { name: memberName });
        return;
      }
      statusEl.className = 'text-sm text-rose-600';
      statusEl.textContent = t('attendance.checkInFailed', { message: error.message });
      return;
    }

    statusEl.className = 'text-sm text-emerald-600';
    statusEl.textContent = t('attendance.checkedIn', { name: memberName });
    loadHistory();
    memberSearchEl.value = '';
    searchResultsEl.innerHTML = '';
  }

  async function checkInGuest(name) {
    statusEl.className = 'text-sm text-slate-500';
    statusEl.textContent = t('common.saving');

    const { error } = await supabase.from('attendance_records').insert({
      service_date: serviceDateEl.value,
      service_type: serviceTypeEl.value,
      service_label: serviceTypeEl.value === 'special_service' ? (serviceLabelEl.value.trim() || null) : null,
      guest_name: name,
      guest_phone: guestPhoneEl.value.trim() || null,
      guest_email: guestEmailEl.value.trim() || null,
      guest_city: guestCityEl.value.trim() || null,
      guest_referral_source: guestReferralEl.value || null,
      guest_referred_by_name: guestReferredByEl.value.trim() || null,
      guest_age_range: guestAgeRangeEl.value || null,
      guest_prayer_request: guestHasPrayerRequestEl.checked ? (guestPrayerRequestEl.value.trim() || null) : null,
      guest_wants_pastor_meeting: guestWantsPastorMeetingEl.checked,
      guest_home_church: guestHasHomeChurchEl.checked ? (guestHomeChurchEl.value.trim() || null) : null,
      recorded_by: currentUserId,
    });

    if (error) {
      statusEl.className = 'text-sm text-rose-600';
      statusEl.textContent = t('attendance.checkInFailed', { message: error.message });
      return;
    }

    statusEl.className = 'text-sm text-emerald-600';
    statusEl.textContent = t('attendance.guestCheckedIn', { name });
    loadHistory();
    resetGuestForm();
  }

  function resetGuestForm() {
    guestNameEl.value = '';
    guestPhoneEl.value = '';
    guestEmailEl.value = '';
    guestCityEl.value = '';
    guestReferralEl.value = '';
    guestReferredByEl.value = '';
    guestAgeRangeEl.value = '';
    guestHasPrayerRequestEl.checked = false;
    guestPrayerRequestEl.value = '';
    guestPrayerRequestEl.classList.add('hidden');
    guestWantsPastorMeetingEl.checked = false;
    guestHasHomeChurchEl.checked = false;
    guestHomeChurchEl.value = '';
    guestHomeChurchEl.classList.add('hidden');
  }

  // Shows everyone already checked in for the currently-selected
  // service date/type — real records, not just this browser session —
  // each with a delete button (can_record_attendance() already allows
  // this same audience to delete, per sql/037; this is the first UI
  // exposing it).
  async function loadHistory() {
    checkedInListEl.innerHTML = `<p class="text-xs text-slate-400">${t('common.loading')}</p>`;

    const { data, error } = await supabase
      .from('attendance_records')
      .select('id, member_id, guest_name, member:profiles!member_id ( full_name )')
      .eq('service_date', serviceDateEl.value)
      .eq('service_type', serviceTypeEl.value)
      .order('created_at', { ascending: false });

    if (error) {
      checkedInListEl.innerHTML = `<p class="text-xs text-rose-600">${t('courses.loadFailed', { message: error.message })}</p>`;
      return;
    }

    if ((data || []).length === 0) {
      checkedInListEl.innerHTML = '';
      return;
    }

    checkedInListEl.innerHTML = '';
    data.forEach((rec) => {
      const name = rec.member ? rec.member.full_name : `${rec.guest_name} (${t('attendance.guestBadge')})`;
      const row = document.createElement('div');
      row.className = 'flex items-center justify-between text-sm text-slate-600 px-2 py-1 bg-slate-50 rounded';
      row.innerHTML = `
        <span>${escapeHtml(name)}</span>
        <button type="button" class="text-xs font-medium text-rose-600 hover:text-rose-800">${t('moderation.delete')}</button>
      `;
      row.querySelector('button').addEventListener('click', async () => {
        const confirmed = await confirmDialog({ message: t('moderation.confirmDeleteAttendance', { name }) });
        if (!confirmed) return;
        const { error: deleteError } = await supabase.from('attendance_records').delete().eq('id', rec.id);
        if (deleteError) {
          window.alert(t('moderation.deleteFailed', { message: deleteError.message }));
          return;
        }
        loadHistory();
      });
      checkedInListEl.appendChild(row);
    });
  }

  (async () => {
    serviceDateEl.value = todayLocalDate();
    serviceTypeEl.value = 'sunday_service';
    statusEl.textContent = '';
    resetGuestForm();
    await loadMembers();
    await loadHistory();
  })();
}

export function createAttendanceManagerModal({ supabase, currentUserId }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${t('attendance.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <div data-el="body"></div>
    </div>
  `;
  document.body.appendChild(root);

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });

  function open() {
    root.classList.remove('hidden');
    root.classList.add('flex');
    renderAttendanceManager(root.querySelector('[data-el="body"]'), { supabase, currentUserId });
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  return { open, root };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
