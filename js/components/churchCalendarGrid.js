// Church Calendar — a monthly grid (same layout as the Availability
// calendar) merging the two things that can occupy a date, church-wide:
// Upcoming Events (church_programs/church_program_dates, Church
// Program's own board above this) and Church Bookings (sql/050, any
// department admin reserving a date for their own department). Only
// one of the two can ever land on a given date -- enforced at the
// database level (a unique index + two symmetric triggers) -- so this
// grid is really just "is this date free, and if not, what/who has
// it," with a click-to-book flow on whatever's still open.
import { formatDateLocal, todayLocal } from '../utils/date.js';
import { t, monthName } from '../i18n.js';
import { confirmDialog } from './confirmDialog.js';

const CHIP_EVENT = 'bg-amber-100 text-amber-800 border border-amber-200';
const CHIP_BOOKING_MINE = 'bg-indigo-100 text-indigo-800 border border-indigo-200';
const CHIP_BOOKING_OTHER = 'bg-slate-100 text-slate-700 border border-slate-200';

export function renderChurchCalendarGrid(container, { supabase, currentUserId, isSuperAdmin, myBookableDepartments = [] }) {
  let viewDate = new Date();
  viewDate.setDate(1);
  let eventsByDate = new Map(); // dateStr -> { title, isSpecial }
  let bookingsByDate = new Map(); // dateStr -> { id, title, notes, departmentName, createdBy }
  let bookingDraftDate = null;

  container.innerHTML = `
    <div class="flex items-center justify-between mb-4">
      <button type="button" data-action="prev-month" class="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700"><span aria-hidden="true">‹</span><span class="sr-only">${t('calendar.prevMonth')}</span></button>
      <h2 data-el="month-label" class="text-lg font-semibold"></h2>
      <button type="button" data-action="next-month" class="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700"><span aria-hidden="true">›</span><span class="sr-only">${t('calendar.nextMonth')}</span></button>
    </div>
    <div class="flex items-center gap-4 text-sm text-slate-500 mb-3 flex-wrap">
      <span class="inline-flex items-center gap-1.5"><span class="w-3 h-3 rounded bg-amber-200 inline-block"></span> ${t('churchCalendar.legendEvent')}</span>
      <span class="inline-flex items-center gap-1.5"><span class="w-3 h-3 rounded bg-indigo-200 inline-block"></span> ${t('churchCalendar.legendBooking')}</span>
      <span class="inline-flex items-center gap-1.5"><span class="w-3 h-3 rounded bg-slate-100 border border-slate-300 inline-block"></span> ${t('churchCalendar.legendFree')}</span>
    </div>
    <div class="grid grid-cols-7 gap-1 text-center text-xs font-medium text-slate-500 mb-1">
      <div>${t('calendar.days.sun')}</div><div>${t('calendar.days.mon')}</div><div>${t('calendar.days.tue')}</div><div>${t('calendar.days.wed')}</div><div>${t('calendar.days.thu')}</div><div>${t('calendar.days.fri')}</div><div>${t('calendar.days.sat')}</div>
    </div>
    <div data-el="grid" class="grid grid-cols-7 gap-1"></div>
    <div data-el="booking-form" class="hidden mt-4 bg-slate-50 border border-slate-200 rounded-lg p-4"></div>
  `;

  const monthLabel = container.querySelector('[data-el="month-label"]');
  const grid = container.querySelector('[data-el="grid"]');
  const formEl = container.querySelector('[data-el="booking-form"]');

  container.querySelector('[data-action="prev-month"]').addEventListener('click', () => { viewDate.setMonth(viewDate.getMonth() - 1); loadMonth(); });
  container.querySelector('[data-action="next-month"]').addEventListener('click', () => { viewDate.setMonth(viewDate.getMonth() + 1); loadMonth(); });

  loadMonth();

  async function loadMonth() {
    monthLabel.textContent = `${monthName(viewDate.getMonth())} ${viewDate.getFullYear()}`;
    hideBookingForm();
    grid.innerHTML = `<p class="col-span-7 text-sm text-slate-500">${t('common.loading')}</p>`;

    const firstDay = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
    const lastDay = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0);
    const fromDate = formatDateLocal(firstDay);
    const toDate = formatDateLocal(lastDay);

    const [{ data: programDates }, { data: bookings }] = await Promise.all([
      supabase.from('church_program_dates')
        .select('date, program:church_programs!program_id ( title, is_special )')
        .gte('date', fromDate).lte('date', toDate),
      supabase.from('church_bookings')
        .select('id, date, title, notes, created_by, department:departments!department_id ( name )')
        .gte('date', fromDate).lte('date', toDate),
    ]);

    eventsByDate = new Map((programDates || []).filter((r) => r.program).map((r) => [r.date, { title: r.program.title, isSpecial: r.program.is_special }]));
    bookingsByDate = new Map((bookings || []).map((r) => [r.date, {
      id: r.id, title: r.title, notes: r.notes, createdBy: r.created_by, departmentName: r.department?.name || '',
    }]));

    renderGrid();
  }

  function renderGrid() {
    grid.innerHTML = '';
    const firstDay = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
    const lastDay = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0);
    for (let i = 0; i < firstDay.getDay(); i++) grid.appendChild(document.createElement('div'));

    const todayStr = todayLocal();
    for (let day = 1; day <= lastDay.getDate(); day++) {
      const cellDate = new Date(viewDate.getFullYear(), viewDate.getMonth(), day);
      const dateStr = formatDateLocal(cellDate);
      grid.appendChild(buildDayCell(dateStr, day, dateStr < todayStr));
    }
  }

  function buildDayCell(dateStr, day, isPast) {
    const cell = document.createElement('div');
    cell.className = 'border border-slate-200 rounded-lg p-1 flex flex-col gap-1 min-h-[3.5rem]';

    const dayNumEl = document.createElement('div');
    dayNumEl.className = `text-xs font-semibold px-0.5 ${isPast ? 'text-slate-300' : 'text-slate-500'}`;
    dayNumEl.textContent = String(day);
    cell.appendChild(dayNumEl);

    const event = eventsByDate.get(dateStr);
    const booking = bookingsByDate.get(dateStr);

    if (event) {
      const chip = document.createElement('div');
      chip.className = `text-left rounded px-1.5 py-0.5 text-[11px] font-semibold truncate ${CHIP_EVENT}`;
      chip.textContent = event.title;
      chip.title = event.title;
      cell.appendChild(chip);
    } else if (booking) {
      const mine = booking.createdBy === currentUserId;
      const wrap = document.createElement('div');
      wrap.className = `flex items-start gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ${mine ? CHIP_BOOKING_MINE : CHIP_BOOKING_OTHER}`;
      const label = document.createElement('span');
      label.className = 'truncate flex-1';
      label.textContent = `${booking.departmentName}: ${booking.title}`;
      label.title = `${booking.departmentName}: ${booking.title}`;
      wrap.appendChild(label);
      if (mine || isSuperAdmin) {
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'shrink-0 hover:text-rose-600';
        delBtn.textContent = '×';
        delBtn.addEventListener('click', () => deleteBooking(booking));
        wrap.appendChild(delBtn);
      }
      cell.appendChild(wrap);
    } else if (!isPast && myBookableDepartments.length > 0) {
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'text-left rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-400 hover:bg-slate-100 hover:text-slate-600 border border-dashed border-slate-300';
      addBtn.textContent = t('churchCalendar.book');
      addBtn.addEventListener('click', () => openBookingForm(dateStr));
      cell.appendChild(addBtn);
    }

    return cell;
  }

  function openBookingForm(dateStr) {
    bookingDraftDate = dateStr;
    formEl.classList.remove('hidden');
    formEl.innerHTML = `
      <h3 class="text-sm font-semibold text-slate-700 mb-3">${t('churchCalendar.bookTitle', { date: dateStr })}</h3>
      <div class="grid sm:grid-cols-2 gap-3 mb-3">
        <div>
          <label class="block text-xs font-medium text-slate-600 mb-1">${t('churchCalendar.department')}</label>
          <select data-el="department" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            ${myBookableDepartments.map((d) => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="block text-xs font-medium text-slate-600 mb-1">${t('churchCalendar.eventTitle')}</label>
          <input type="text" data-el="title" required class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>
      <label class="block text-xs font-medium text-slate-600 mb-1">${t('churchCalendar.notes')}</label>
      <textarea data-el="notes" rows="2" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-3"></textarea>
      <div class="flex items-center gap-3">
        <button type="button" data-action="submit" class="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">${t('churchCalendar.submit')}</button>
        <button type="button" data-action="cancel" class="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100 text-sm">${t('common.cancel')}</button>
        <span data-el="status" class="text-sm text-slate-500"></span>
      </div>
    `;
    formEl.querySelector('[data-action="cancel"]').addEventListener('click', hideBookingForm);
    formEl.querySelector('[data-action="submit"]').addEventListener('click', submitBooking);
    formEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function hideBookingForm() {
    bookingDraftDate = null;
    formEl.classList.add('hidden');
    formEl.innerHTML = '';
  }

  async function submitBooking() {
    const departmentId = formEl.querySelector('[data-el="department"]').value;
    const title = formEl.querySelector('[data-el="title"]').value.trim();
    const notes = formEl.querySelector('[data-el="notes"]').value.trim() || null;
    const statusEl = formEl.querySelector('[data-el="status"]');

    if (!title) {
      statusEl.className = 'text-sm text-rose-600';
      statusEl.textContent = t('churchCalendar.titleRequired');
      return;
    }

    statusEl.className = 'text-sm text-slate-500';
    statusEl.textContent = t('common.saving');

    const { error } = await supabase.from('church_bookings').insert({
      department_id: departmentId, title, notes, date: bookingDraftDate, created_by: currentUserId,
    });

    if (error) {
      statusEl.className = 'text-sm text-rose-600';
      if (error.code === '23505') statusEl.textContent = t('churchCalendar.dateJustTaken');
      else if (error.message?.includes('DATE_TAKEN_BY_EVENT')) statusEl.textContent = t('churchCalendar.dateHasEvent');
      else statusEl.textContent = t('churchCalendar.bookFailed', { message: error.message });
      return;
    }

    hideBookingForm();
    loadMonth();
  }

  async function deleteBooking(booking) {
    const ok = await confirmDialog({ message: t('churchCalendar.deleteConfirm', { title: booking.title }) });
    if (!ok) return;
    await supabase.from('church_bookings').delete().eq('id', booking.id);
    loadMonth();
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }
}
