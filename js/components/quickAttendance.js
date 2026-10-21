// Quick Attendance -- a full-roster tap-to-check-in screen, as
// opposed to attendanceManager.js's search-then-click flow (better
// for a handful of guests/late arrivals than for marking a whole
// room). Same underlying attendance_records table, same
// can_record_attendance() INSERT/DELETE policies -- this is a
// different way to write the same rows, not a new permission model.
//
// Roster is every profile in the tenant (live + silent), not scoped
// through department_memberships like every other picker in this
// app -- confirmed with the user as the intended scope here, since
// the point is a full roll call, not a department-specific list.
import { t } from '../i18n.js';

const SERVICE_TYPES = ['sunday_service', 'midweek_service', 'special_service'];

function todayLocalDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function renderQuickAttendance(container, { supabase, currentUserId }) {
  container.innerHTML = `
    <div class="grid sm:grid-cols-2 gap-3 mb-3">
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

    <input type="search" data-el="search" placeholder="${t('quickAttendance.searchPlaceholder')}"
           class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-3" />

    <p data-el="summary" class="text-xs text-slate-500 mb-2"></p>
    <div data-el="roster" class="space-y-1 max-h-[60vh] overflow-y-auto"></div>
  `;

  const serviceDateEl = container.querySelector('[data-el="service-date"]');
  const serviceTypeEl = container.querySelector('[data-el="service-type"]');
  const searchEl = container.querySelector('[data-el="search"]');
  const summaryEl = container.querySelector('[data-el="summary"]');
  const rosterEl = container.querySelector('[data-el="roster"]');

  let roster = [];
  let presentIds = new Set();

  async function loadRoster() {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, is_silent')
      .is('removed_at', null)
      .order('full_name');
    roster = data || [];
  }

  async function loadPresent() {
    const { data } = await supabase
      .from('attendance_records')
      .select('member_id')
      .eq('service_date', serviceDateEl.value)
      .eq('service_type', serviceTypeEl.value)
      .not('member_id', 'is', null);
    presentIds = new Set((data || []).map((r) => r.member_id));
  }

  function renderRoster() {
    const query = searchEl.value.trim().toLowerCase();
    const filtered = query ? roster.filter((p) => p.full_name.toLowerCase().includes(query)) : roster;

    summaryEl.textContent = t('quickAttendance.presentCount', { present: presentIds.size, total: roster.length });

    if (filtered.length === 0) {
      rosterEl.innerHTML = `<p class="text-sm text-slate-500">${t('quickAttendance.none')}</p>`;
      return;
    }

    rosterEl.innerHTML = '';
    filtered.forEach((p) => {
      const present = presentIds.has(p.id);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm text-left border ${
        present ? 'bg-emerald-50 border-emerald-300 text-emerald-800' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
      }`;
      btn.innerHTML = `
        <span>${escapeHtml(p.full_name)}${p.is_silent ? ` <span class="text-xs text-slate-400">(${t('users.silentBadge')})</span>` : ''}</span>
        <span class="text-xs font-medium ${present ? 'text-emerald-600' : 'text-slate-400'}">${present ? t('quickAttendance.present') : ''}</span>
      `;
      btn.addEventListener('click', () => toggle(p, btn, present));
      rosterEl.appendChild(btn);
    });
  }

  async function toggle(person, btn, wasPresent) {
    btn.disabled = true;
    if (wasPresent) {
      const { error } = await supabase
        .from('attendance_records')
        .delete()
        .eq('service_date', serviceDateEl.value)
        .eq('service_type', serviceTypeEl.value)
        .eq('member_id', person.id);
      if (!error) presentIds.delete(person.id);
    } else {
      const { error } = await supabase.from('attendance_records').insert({
        service_date: serviceDateEl.value,
        service_type: serviceTypeEl.value,
        member_id: person.id,
        recorded_by: currentUserId,
      });
      // A repeat tap for someone already checked in just no-ops instead
      // of erroring -- the unique index already prevents the duplicate,
      // same as attendanceManager.js's own search-based check-in.
      if (!error || error.code === '23505') presentIds.add(person.id);
    }
    btn.disabled = false;
    renderRoster();
  }

  serviceDateEl.addEventListener('change', async () => { await loadPresent(); renderRoster(); });
  serviceTypeEl.addEventListener('change', async () => { await loadPresent(); renderRoster(); });
  searchEl.addEventListener('input', renderRoster);

  (async () => {
    serviceDateEl.value = todayLocalDate();
    serviceTypeEl.value = 'sunday_service';
    await Promise.all([loadRoster(), loadPresent()]);
    renderRoster();
  })();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
