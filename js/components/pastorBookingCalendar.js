// Shared booking calendar -- used both by the authenticated "Book a
// Meeting" tab and the public booking.html page for guests. Both call
// the exact same pair of RPCs (get_public_pastor_slots/
// submit_pastor_meeting_booking); a logged-in call naturally carries
// auth.uid(), a guest call doesn't, and the RPC branches accordingly --
// so there's no separate "member" vs "guest" booking logic here, only
// currentUserProfile deciding whether to show the email field (name +
// phone are collected either way now). Manual vs random assignment
// mode is inferred purely from whether get_public_pastor_slots()
// returned a pastor_name for a row (populated in manual mode, null in
// random) -- no separate settings fetch needed.
//
// tenantSlug (sandbox2-only difference from main): an anon caller has
// no session, so no current_tenant_id() -- every RPC here takes an
// optional p_tenant_slug, resolved the same way get_tenant_by_slug()
// already does. Only booking.html (the public page) actually passes
// it; the authenticated in-app tab omits it and the RPC falls back to
// the caller's own current_tenant_id().
//
// Timezone: pastor_availability's date/start_time/end_time are plain
// wall-clock values in the church's own configured timezone
// (get_church_timezone()) -- there's no other sense of "when" baked
// into them. A visitor whose browser reports a different IANA zone
// sees each slot's time converted for display (with the original
// church-time kept alongside it), but the booking itself is still
// submitted using the original, unconverted date/time -- the RPC
// compares against pastor_availability rows in church-time terms, so
// converting before submitting would silently book the wrong slot.
// Luxon (via the same jsdelivr "+esm" CDN convention already used for
// qrcode in memberIdCard.js) does the actual IANA conversion --
// hand-rolled DST-aware timezone math is exactly the kind of thing
// this app doesn't otherwise attempt anywhere, and getting it wrong
// here means showing someone the wrong meeting time.
import { formatDateLocal, todayLocal } from '../utils/date.js';
import { t, tn, monthName, getLang } from '../i18n.js';
import { openMeetingWindow, navigateMeetingWindow } from './videoMeeting.js';
import { DateTime } from 'https://cdn.jsdelivr.net/npm/luxon@3.5.0/+esm';

export function renderPastorBookingCalendar(container, { supabase, currentUserProfile, tenantSlug, onBooked }) {
  let viewDate = new Date();
  viewDate.setDate(1);
  let slotsByDate = new Map();
  let selectedDate = null;
  let churchTimezone = 'America/Toronto';
  // get_public_church_info() is dual-mode (auth.uid() OR slug) as of
  // sql/saas_platform/137 -- works for both the authenticated in-app
  // tab (tenantSlug is undefined, falls back to current_tenant_id())
  // and the guest public page (tenantSlug from booking.html's own
  // ?church= param).
  let churchName = '';
  const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  container.innerHTML = `
    <div data-el="calendar-view">
      <div data-el="pause-banner" class="hidden mb-4"></div>
      <div class="flex items-center justify-between mb-4">
        <button type="button" data-action="prev-month" class="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700">${t('calendar.prev')}</button>
        <h2 data-el="month-label" class="text-lg font-semibold"></h2>
        <button type="button" data-action="next-month" class="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700">${t('calendar.next')}</button>
      </div>
      <div data-el="tz-note" class="hidden text-xs text-slate-500 mb-2"></div>
      <div class="grid grid-cols-7 gap-1 text-center text-xs font-medium text-slate-500 mb-1">
        <div>${t('calendar.days.sun')}</div><div>${t('calendar.days.mon')}</div><div>${t('calendar.days.tue')}</div><div>${t('calendar.days.wed')}</div><div>${t('calendar.days.thu')}</div><div>${t('calendar.days.fri')}</div><div>${t('calendar.days.sat')}</div>
      </div>
      <div data-el="grid" class="grid grid-cols-7 gap-1 mb-6"></div>
      <div data-el="day-panel" class="hidden bg-white rounded-xl shadow p-4 sm:p-6"></div>
    </div>
    <div data-el="confirmation" class="hidden bg-white rounded-xl shadow p-6"></div>
  `;

  const calendarView = container.querySelector('[data-el="calendar-view"]');
  const confirmationView = container.querySelector('[data-el="confirmation"]');
  const pauseBannerEl = container.querySelector('[data-el="pause-banner"]');
  const tzNoteEl = container.querySelector('[data-el="tz-note"]');
  const monthLabel = container.querySelector('[data-el="month-label"]');
  const grid = container.querySelector('[data-el="grid"]');
  const dayPanel = container.querySelector('[data-el="day-panel"]');

  container.querySelector('[data-action="prev-month"]').addEventListener('click', () => { viewDate.setMonth(viewDate.getMonth() - 1); loadSlots(); });
  container.querySelector('[data-action="next-month"]').addEventListener('click', () => { viewDate.setMonth(viewDate.getMonth() + 1); loadSlots(); });

  init();

  async function init() {
    const [{ data: tz }, { data: info }] = await Promise.all([
      supabase.rpc('get_church_timezone', { p_tenant_slug: tenantSlug || null }),
      supabase.rpc('get_public_church_info', { p_tenant_slug: tenantSlug || null }),
    ]);
    if (tz) churchTimezone = tz;
    churchName = info?.name || '';
    if (churchTimezone !== browserTimezone) {
      tzNoteEl.classList.remove('hidden');
      tzNoteEl.textContent = t('pastorBooking.tzNote', { tz: browserTimezone });
    }
    loadSlots();
  }

  async function loadSlots() {
    monthLabel.textContent = `${monthName(viewDate.getMonth())} ${viewDate.getFullYear()}`;

    const [{ data, error }, { data: notices }] = await Promise.all([
      supabase.rpc('get_public_pastor_slots', { p_tenant_slug: tenantSlug || null }),
      supabase.rpc('get_pastor_pause_notices', { p_tenant_slug: tenantSlug || null }),
    ]);

    slotsByDate = new Map();
    if (!error) {
      (data || []).forEach((row) => {
        if (!slotsByDate.has(row.date)) slotsByDate.set(row.date, []);
        slotsByDate.get(row.date).push(row);
      });
    }
    renderPauseBanner(notices || []);

    renderGrid();
    if (selectedDate && isInMonth(selectedDate)) {
      renderDayPanel();
    } else if (selectedDate) {
      dayPanel.classList.add('hidden');
      selectedDate = null;
    }
  }

  function renderPauseBanner(notices) {
    if (!notices || notices.length === 0) {
      pauseBannerEl.classList.add('hidden');
      pauseBannerEl.innerHTML = '';
      return;
    }
    pauseBannerEl.classList.remove('hidden');
    pauseBannerEl.innerHTML = notices.map((n) => {
      const message = getLang() === 'fr' ? (n.message_fr || n.message_en) : (n.message_en || n.message_fr);
      return `<div class="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 text-sm mb-2 whitespace-pre-wrap">${escapeHtml(message || t('pastorBooking.defaultPauseMessage'))}</div>`;
    }).join('');
  }

  // Converts a church-timezone wall-clock date+time to the browser's
  // own timezone for display only -- never used for what gets
  // submitted. dayShift flags when the conversion lands on a different
  // calendar date than the one this slot is grouped under.
  function convertForDisplay(dateStr, timeStr) {
    if (churchTimezone === browserTimezone) {
      return { display: formatTime(timeStr), churchTime: null, dayShift: null };
    }
    const churchDt = DateTime.fromFormat(`${dateStr} ${timeStr}`, 'yyyy-MM-dd HH:mm:ss', { zone: churchTimezone });
    if (!churchDt.isValid) return { display: formatTime(timeStr), churchTime: null, dayShift: null };
    const localDt = churchDt.setZone(browserTimezone);
    const localDateStr = localDt.toFormat('yyyy-MM-dd');
    return {
      display: localDt.toFormat('h:mm a'),
      churchTime: t('pastorBooking.churchTimeLabel', { time: formatTime(timeStr) }),
      dayShift: localDateStr === dateStr ? null : (localDateStr > dateStr ? t('pastorBooking.nextDayForYou') : t('pastorBooking.prevDayForYou')),
    };
  }

  function isInMonth(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.getFullYear() === viewDate.getFullYear() && d.getMonth() === viewDate.getMonth();
  }

  function renderGrid() {
    grid.innerHTML = '';
    const firstDay = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
    const lastDay = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0);

    for (let i = 0; i < firstDay.getDay(); i++) grid.appendChild(document.createElement('div'));

    const todayStr = todayLocal();
    for (let day = 1; day <= lastDay.getDate(); day++) {
      const dateStr = formatDateLocal(new Date(viewDate.getFullYear(), viewDate.getMonth(), day));
      const isPast = dateStr < todayStr;
      const slots = slotsByDate.get(dateStr) || [];
      const bookable = !isPast && slots.length > 0;

      const cell = document.createElement('button');
      cell.type = 'button';
      cell.disabled = !bookable;
      cell.className = `border rounded-lg p-1.5 min-h-[3.25rem] text-left transition-colors ${
        !bookable ? 'border-slate-100 text-slate-300 cursor-not-allowed'
        : selectedDate === dateStr ? 'border-indigo-400 bg-indigo-50'
        : 'border-emerald-300 bg-emerald-50 hover:bg-emerald-100'
      }`;
      cell.innerHTML = `
        <div class="text-xs font-semibold ${bookable ? 'text-slate-600' : 'text-slate-300'}">${day}</div>
        ${bookable ? `<div class="text-[11px] text-emerald-700 font-medium mt-0.5">${tn('pastorBooking.slotCount', slots.length)}</div>` : ''}
      `;
      if (bookable) cell.addEventListener('click', () => { selectedDate = dateStr; renderDayPanel(); });
      grid.appendChild(cell);
    }
  }

  function renderDayPanel() {
    dayPanel.classList.remove('hidden');
    const slots = slotsByDate.get(selectedDate) || [];

    dayPanel.innerHTML = `
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-semibold text-slate-800">${escapeHtml(selectedDate)}</h3>
        <button type="button" data-action="close-panel" class="text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
      </div>
      <div data-el="slot-list" class="space-y-2"></div>
      <div data-el="book-form-wrap" class="hidden mt-4 pt-4 border-t border-slate-200"></div>
    `;

    dayPanel.querySelector('[data-action="close-panel"]').addEventListener('click', () => {
      dayPanel.classList.add('hidden');
      selectedDate = null;
      renderGrid();
    });

    const listEl = dayPanel.querySelector('[data-el="slot-list"]');
    slots.forEach((slot) => {
      const { display, churchTime, dayShift } = convertForDisplay(selectedDate, slot.start_time);
      const endTimeConverted = convertForDisplay(selectedDate, slot.end_time).display;
      const row = document.createElement('div');
      row.className = 'flex items-center justify-between gap-2 border border-slate-200 rounded-lg px-3 py-2 text-sm';
      row.innerHTML = `
        <span>
          ${display} – ${endTimeConverted}
          <span class="ml-2 px-1.5 py-0.5 rounded text-[11px] font-medium ${slot.location_type === 'online' ? 'bg-sky-100 text-sky-700' : 'bg-amber-100 text-amber-700'}">${slot.location_type === 'online' ? t('pastorBooking.online') : t('pastorBooking.office')}</span>
          ${slot.pastor_name ? `<span class="text-slate-500 ml-2">${t('pastorBooking.withPastor', { name: escapeHtml(slot.pastor_name) })}</span>` : ''}
          ${churchTime ? `<div class="text-xs text-slate-400 mt-0.5">${churchTime}${dayShift ? ` · ${dayShift}` : ''}</div>` : ''}
        </span>
        <button type="button" data-action="select-slot" class="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700">${t('pastorBooking.book')}</button>
      `;
      row.querySelector('[data-action="select-slot"]').addEventListener('click', () => renderBookForm(slot));
      listEl.appendChild(row);
    });
  }

  function renderBookForm(slot) {
    const wrap = dayPanel.querySelector('[data-el="book-form-wrap"]');
    wrap.classList.remove('hidden');
    const isGuest = !currentUserProfile;
    const { display, churchTime, dayShift } = convertForDisplay(selectedDate, slot.start_time);
    const endTimeConverted = convertForDisplay(selectedDate, slot.end_time).display;

    wrap.innerHTML = `
      <h4 class="font-medium text-slate-800 mb-2">${t('pastorBooking.confirmTitle')}</h4>
      <p class="text-sm text-slate-600 mb-3">
        ${escapeHtml(selectedDate)} · ${display} – ${endTimeConverted}
        ${slot.pastor_name ? ` · ${escapeHtml(slot.pastor_name)}` : ''}
        ${churchTime ? `<br /><span class="text-xs text-slate-400">${churchTime}${dayShift ? ` · ${dayShift}` : ''}</span>` : ''}
      </p>
      <form data-el="book-form" class="space-y-3">
        <div class="grid sm:grid-cols-2 gap-2">
          <input type="text" name="contact_name" required placeholder="${t('pastorBooking.yourName')}" value="${escapeAttr(currentUserProfile?.full_name || '')}" class="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          <input type="tel" name="contact_phone" required placeholder="${t('pastorBooking.yourPhone')}" value="${escapeAttr(currentUserProfile?.phone || '')}" class="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        ${isGuest ? `
          <input type="email" name="guest_email" required placeholder="${t('pastorBooking.yourEmail')}" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        ` : ''}
        <textarea name="note" rows="2" placeholder="${t('pastorBooking.notePlaceholder')}" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"></textarea>
        <div class="flex items-center gap-3">
          <button type="submit" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">${t('pastorBooking.confirmBooking')}</button>
          <span data-el="book-status" class="text-sm text-rose-600"></span>
        </div>
      </form>
    `;

    const form = wrap.querySelector('[data-el="book-form"]');
    const statusEl = wrap.querySelector('[data-el="book-status"]');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      statusEl.className = 'text-sm text-slate-500';
      statusEl.textContent = t('common.saving');

      const { data, error } = await supabase.rpc('submit_pastor_meeting_booking', {
        p_date: selectedDate,
        p_start_time: slot.start_time,
        p_end_time: slot.end_time,
        p_location_type: slot.location_type,
        p_contact_name: form.elements.contact_name.value.trim(),
        p_contact_phone: form.elements.contact_phone.value.trim(),
        p_pastor_id: slot.pastor_id || null,
        p_note: form.elements.note.value.trim() || null,
        p_guest_email: isGuest ? form.elements.guest_email.value.trim() : null,
        p_tenant_slug: tenantSlug || null,
      });

      submitBtn.disabled = false;
      if (error) {
        statusEl.className = 'text-sm text-rose-600';
        statusEl.textContent = t('pastorBooking.bookingFailed', { message: error.message });
        loadSlots();
        return;
      }

      const booking = data?.[0];
      // Best-effort: the booking itself already succeeded, so a guest's
      // confirmation email is a nice-to-have, not something to block or
      // surface errors for. Member bookings have no guest email at all
      // (they already see it in-app), and the function itself no-ops
      // when guest_email is null -- but skipping the call for members
      // avoids an unnecessary round trip.
      if (isGuest && booking?.booking_id) {
        supabase.functions.invoke('send-booking-email', { body: { booking_id: booking.booking_id } }).catch(() => {});
      }
      showConfirmation(slot, booking);
      onBooked?.();
    });
  }

  function showConfirmation(slot, booking) {
    calendarView.classList.add('hidden');
    confirmationView.classList.remove('hidden');
    const { display, churchTime, dayShift } = convertForDisplay(selectedDate, slot.start_time);
    const endTimeConverted = convertForDisplay(selectedDate, slot.end_time).display;
    const canJoin = booking?.meeting_room || booking?.meeting_link;
    const bookingNote = getLang() === 'fr' ? (booking?.booking_note_fr || booking?.booking_note_en) : (booking?.booking_note_en || booking?.booking_note_fr);
    confirmationView.innerHTML = `
      ${churchName ? `<div class="text-base font-bold text-slate-800 mb-0.5">${escapeHtml(churchName)}</div>` : ''}
      <div class="text-emerald-600 text-lg font-semibold mb-2">${t('pastorBooking.bookedTitle')}</div>
      <p class="text-slate-700 mb-4">
        ${escapeHtml(selectedDate)} · ${display} – ${endTimeConverted}
        ${booking?.pastor_name ? ` · ${escapeHtml(booking.pastor_name)}` : ''}
        ${churchTime ? `<br /><span class="text-xs text-slate-400">${churchTime}${dayShift ? ` · ${dayShift}` : ''}</span>` : ''}
      </p>
      ${canJoin ? `<button type="button" data-action="join-now" class="px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700">${t('meeting.join')}</button>` : `<p class="text-sm text-slate-500">${t('pastorBooking.officeReminder')}</p>`}
      ${booking?.office_address ? `<p class="text-sm text-slate-500 mt-2">${t('pastorBooking.addressLabel')}: ${escapeHtml(booking.office_address)}</p>` : ''}
      ${bookingNote ? `<p class="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3 mt-3 whitespace-pre-wrap">${escapeHtml(bookingNote)}</p>` : ''}
      <div class="mt-4">
        <button type="button" data-action="book-another" class="text-sm text-indigo-600 hover:text-indigo-800 font-medium">${t('pastorBooking.bookAnother')}</button>
      </div>
    `;

    if (canJoin) {
      confirmationView.querySelector('[data-action="join-now"]').addEventListener('click', () => {
        if (booking.meeting_link) {
          window.open(booking.meeting_link, '_blank', 'noopener');
          return;
        }
        const win = openMeetingWindow();
        navigateMeetingWindow(win, { roomName: booking.meeting_room, displayName: currentUserProfile?.full_name || '' });
      });
    }
    confirmationView.querySelector('[data-action="book-another"]').addEventListener('click', () => {
      confirmationView.classList.add('hidden');
      calendarView.classList.remove('hidden');
      selectedDate = null;
      dayPanel.classList.add('hidden');
      loadSlots();
    });
  }
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
