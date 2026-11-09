// A pastor's own meeting-availability calendar — month grid (same
// shape as calendar.js's) where days with at least one slot are
// marked; clicking a day shows that date's slots as a read-only list
// (individually deletable) plus a *generator* form: pick a time
// window (e.g. 5:00-6:00) and a meeting length (e.g. 10 minutes), and
// every slot in that window is created in one submit -- no more
// entering each slot's start/end by hand. Optionally recurring
// (weekly, until a chosen end date). Writes straight to
// pastor_availability under normal RLS (pastor_id = auth.uid()) via a
// single bulk upsert -- no RPC needed, this isn't a contested resource
// the way booking is. Generated rows upsert with ignoreDuplicates
// against the (pastor_id, date, start_time, end_time) unique
// constraint, so re-running the generator over a window that already
// has some slots in it never creates a duplicate, independently-
// bookable copy of the same slot.
import { formatDateLocal, todayLocal } from '../utils/date.js';
import { t, tn, monthName } from '../i18n.js';
import { confirmDialog } from './confirmDialog.js';

const MAX_GENERATED_SLOTS = 500;
const DEFAULT_PAUSE_MESSAGE_EN = "We're sorry to let you know that our pastor will not be available this week. We apologize for any inconvenience this may cause, and we appreciate your patience and understanding.\nIf you need pastoral care or have an urgent matter, please contact the church office and we will do our best to assist you. Regular services and activities will resume as usual next week.\nThank you for your understanding, and may God bless you all.";
const DEFAULT_PAUSE_MESSAGE_FR = "Nous sommes désolés de vous informer que notre pasteur ne sera pas disponible cette semaine. Nous nous excusons pour tout inconvénient que cela pourrait causer, et nous apprécions votre patience et votre compréhension.\nSi vous avez besoin de soins pastoraux ou d'une question urgente, veuillez contacter le bureau de l'église et nous ferons de notre mieux pour vous aider. Les services et activités habituels reprendront normalement la semaine prochaine.\nMerci de votre compréhension, et que Dieu vous bénisse tous.";

export function renderPastorAvailabilityCalendar(container, { supabase, pastorId }) {
  let viewDate = new Date();
  viewDate.setDate(1);
  let slotsByDate = new Map(); // dateStr -> [{id, start_time, end_time, location_type}, ...]
  let selectedDate = null;

  container.innerHTML = `
    <div data-el="pause-control" class="bg-white rounded-xl shadow p-4 sm:p-6 mb-6"></div>
    <div class="flex items-center justify-between mb-4">
      <button type="button" data-action="prev-month" class="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700">${t('calendar.prev')}</button>
      <h2 data-el="month-label" class="text-lg font-semibold"></h2>
      <button type="button" data-action="next-month" class="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700">${t('calendar.next')}</button>
    </div>
    <div class="grid grid-cols-7 gap-1 text-center text-xs font-medium text-slate-500 mb-1">
      <div>${t('calendar.days.sun')}</div><div>${t('calendar.days.mon')}</div><div>${t('calendar.days.tue')}</div><div>${t('calendar.days.wed')}</div><div>${t('calendar.days.thu')}</div><div>${t('calendar.days.fri')}</div><div>${t('calendar.days.sat')}</div>
    </div>
    <div data-el="grid" class="grid grid-cols-7 gap-1 mb-6"></div>
    <div data-el="day-panel" class="hidden bg-white rounded-xl shadow p-4 sm:p-6"></div>
  `;

  const pauseControlEl = container.querySelector('[data-el="pause-control"]');
  const monthLabel = container.querySelector('[data-el="month-label"]');
  const grid = container.querySelector('[data-el="grid"]');
  const dayPanel = container.querySelector('[data-el="day-panel"]');

  loadPauseState();

  async function loadPauseState() {
    const { data } = await supabase.from('pastor_meeting_pause').select('paused, message_en, message_fr').eq('pastor_id', pastorId).maybeSingle();
    renderPauseControl(data?.paused || false, data?.message_en || DEFAULT_PAUSE_MESSAGE_EN, data?.message_fr || DEFAULT_PAUSE_MESSAGE_FR);
  }

  function renderPauseControl(paused, messageEn, messageFr) {
    if (!paused) {
      pauseControlEl.innerHTML = `
        <button type="button" data-action="open-pause-form" class="px-3 py-1.5 rounded-lg bg-amber-100 text-amber-800 text-sm font-medium hover:bg-amber-200">
          ${t('pastorAvailability.pauseButton')}
        </button>
        <div data-el="pause-form-wrap" class="hidden mt-3"></div>
      `;
      pauseControlEl.querySelector('[data-action="open-pause-form"]').addEventListener('click', () => {
        const wrap = pauseControlEl.querySelector('[data-el="pause-form-wrap"]');
        wrap.classList.remove('hidden');
        wrap.innerHTML = `
          <p class="text-sm text-slate-500 mb-2">${t('pastorAvailability.pauseIntro')}</p>
          <div class="grid sm:grid-cols-2 gap-2 mb-2">
            <div>
              <label class="block text-xs font-medium text-slate-500 mb-1">${t('menuCustomizer.english')}</label>
              <textarea data-el="pause-message-en" rows="5" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">${escapeHtml(messageEn)}</textarea>
            </div>
            <div>
              <label class="block text-xs font-medium text-slate-500 mb-1">${t('menuCustomizer.french')}</label>
              <textarea data-el="pause-message-fr" rows="5" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">${escapeHtml(messageFr)}</textarea>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <button type="button" data-action="confirm-pause" class="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700">${t('pastorAvailability.confirmPause')}</button>
            <button type="button" data-action="cancel-pause-form" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">${t('common.cancel')}</button>
            <span data-el="pause-status" class="text-sm"></span>
          </div>
        `;
        wrap.querySelector('[data-action="cancel-pause-form"]').addEventListener('click', () => wrap.classList.add('hidden'));
        wrap.querySelector('[data-action="confirm-pause"]').addEventListener('click', async () => {
          const statusEl = wrap.querySelector('[data-el="pause-status"]');
          statusEl.className = 'text-sm text-slate-500';
          statusEl.textContent = t('common.saving');
          const { error } = await supabase.from('pastor_meeting_pause').upsert(
            {
              pastor_id: pastorId,
              paused: true,
              message_en: wrap.querySelector('[data-el="pause-message-en"]').value.trim() || DEFAULT_PAUSE_MESSAGE_EN,
              message_fr: wrap.querySelector('[data-el="pause-message-fr"]').value.trim() || DEFAULT_PAUSE_MESSAGE_FR,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'pastor_id' },
          );
          if (error) {
            statusEl.className = 'text-sm text-rose-600';
            statusEl.textContent = t('pastorAvailability.saveFailed', { message: error.message });
            return;
          }
          loadPauseState();
        });
      });
    } else {
      pauseControlEl.innerHTML = `
        <div class="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <p class="text-sm font-medium text-amber-800 mb-1">${t('pastorAvailability.pausedNotice')}</p>
          <div class="grid sm:grid-cols-2 gap-3 mb-3">
            <div>
              <p class="text-xs font-medium text-amber-700 mb-0.5">${t('menuCustomizer.english')}</p>
              <p class="text-sm text-amber-700 whitespace-pre-wrap">${escapeHtml(messageEn)}</p>
            </div>
            <div>
              <p class="text-xs font-medium text-amber-700 mb-0.5">${t('menuCustomizer.french')}</p>
              <p class="text-sm text-amber-700 whitespace-pre-wrap">${escapeHtml(messageFr)}</p>
            </div>
          </div>
          <button type="button" data-action="resume" class="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700">${t('pastorAvailability.resumeButton')}</button>
          <span data-el="resume-status" class="text-sm ml-2"></span>
        </div>
      `;
      pauseControlEl.querySelector('[data-action="resume"]').addEventListener('click', async () => {
        const statusEl = pauseControlEl.querySelector('[data-el="resume-status"]');
        statusEl.className = 'text-sm text-slate-500';
        statusEl.textContent = t('common.saving');
        const { error } = await supabase.from('pastor_meeting_pause').update({ paused: false, updated_at: new Date().toISOString() }).eq('pastor_id', pastorId);
        if (error) {
          statusEl.className = 'text-sm text-rose-600';
          statusEl.textContent = t('pastorAvailability.saveFailed', { message: error.message });
          return;
        }
        loadPauseState();
      });
    }
  }

  container.querySelector('[data-action="prev-month"]').addEventListener('click', () => { viewDate.setMonth(viewDate.getMonth() - 1); loadMonth(); });
  container.querySelector('[data-action="next-month"]').addEventListener('click', () => { viewDate.setMonth(viewDate.getMonth() + 1); loadMonth(); });

  loadMonth();

  async function loadMonth() {
    monthLabel.textContent = `${monthName(viewDate.getMonth())} ${viewDate.getFullYear()}`;
    const firstDay = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
    const lastDay = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0);
    const fromDate = formatDateLocal(firstDay);
    const toDate = formatDateLocal(lastDay);

    const { data, error } = await supabase
      .from('pastor_availability')
      .select('id, date, start_time, end_time, location_type')
      .eq('pastor_id', pastorId)
      .gte('date', fromDate)
      .lte('date', toDate)
      .order('start_time');

    slotsByDate = new Map();
    if (!error) {
      (data || []).forEach((row) => {
        if (!slotsByDate.has(row.date)) slotsByDate.set(row.date, []);
        slotsByDate.get(row.date).push(row);
      });
    }

    renderGrid();
    if (selectedDate && isInMonth(selectedDate)) {
      renderDayPanel();
    } else if (selectedDate) {
      // Navigated to a different month than the one that was open --
      // the panel no longer refers to a visible day, so close it.
      dayPanel.classList.add('hidden');
      selectedDate = null;
    }
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
      const count = (slotsByDate.get(dateStr) || []).length;

      const cell = document.createElement('button');
      cell.type = 'button';
      cell.disabled = isPast;
      cell.className = `border rounded-lg p-1.5 min-h-[3.25rem] text-left transition-colors ${
        isPast ? 'border-slate-100 text-slate-300 cursor-not-allowed'
        : selectedDate === dateStr ? 'border-indigo-400 bg-indigo-50'
        : count > 0 ? 'border-emerald-300 bg-emerald-50 hover:bg-emerald-100'
        : 'border-slate-200 hover:bg-slate-50'
      }`;
      cell.innerHTML = `
        <div class="text-xs font-semibold ${isPast ? 'text-slate-300' : 'text-slate-600'}">${day}</div>
        ${count > 0 ? `<div class="text-[11px] text-emerald-700 font-medium mt-0.5">${tn('pastorAvailability.slotCount', count)}</div>` : ''}
      `;
      if (!isPast) cell.addEventListener('click', () => { selectedDate = dateStr; renderDayPanel(); });
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
      <div data-el="slot-list" class="space-y-2 mb-4"></div>
      <form data-el="add-form" class="space-y-3">
        <div class="grid sm:grid-cols-2 gap-2">
          <div>
            <label class="block text-xs font-medium text-slate-500 mb-1">${t('pastorAvailability.windowStart')}</label>
            <input type="time" name="window_start" required class="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label class="block text-xs font-medium text-slate-500 mb-1">${t('pastorAvailability.windowEnd')}</label>
            <input type="time" name="window_end" required class="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
          </div>
        </div>
        <div class="grid sm:grid-cols-2 gap-2">
          <div>
            <label class="block text-xs font-medium text-slate-500 mb-1">${t('pastorAvailability.duration')}</label>
            <input type="number" name="duration" min="5" step="5" value="30" required class="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label class="block text-xs font-medium text-slate-500 mb-1">${t('pastorAvailability.locationType')}</label>
            <select name="location_type" class="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
              <option value="office">${t('pastorAvailability.office')}</option>
              <option value="online">${t('pastorAvailability.online')}</option>
            </select>
          </div>
        </div>
        <label class="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" name="recurring" data-el="recurring-checkbox" />
          ${t('pastorAvailability.recurring')}
        </label>
        <div data-el="recur-until-wrap" class="hidden">
          <label class="block text-xs font-medium text-slate-500 mb-1">${t('pastorAvailability.repeatUntil')}</label>
          <input type="date" name="repeat_until" min="${selectedDate}" class="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
        </div>
        <button type="submit" class="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">${t('pastorAvailability.generateSlots')}</button>
      </form>
      <p data-el="panel-status" class="text-sm mt-2"></p>
    `;

    dayPanel.querySelector('[data-action="close-panel"]').addEventListener('click', () => {
      dayPanel.classList.add('hidden');
      selectedDate = null;
      renderGrid();
    });

    const listEl = dayPanel.querySelector('[data-el="slot-list"]');
    if (slots.length === 0) {
      listEl.innerHTML = `<p class="text-sm text-slate-500">${t('pastorAvailability.noSlots')}</p>`;
    } else {
      slots.forEach((slot) => {
        const row = document.createElement('div');
        row.className = 'flex items-center justify-between gap-2 border border-slate-200 rounded-lg px-3 py-2 text-sm';
        row.innerHTML = `
          <span>${formatTime(slot.start_time)} – ${formatTime(slot.end_time)} · <span class="font-medium">${slot.location_type === 'online' ? t('pastorAvailability.online') : t('pastorAvailability.office')}</span></span>
          <button type="button" data-action="delete-slot" class="text-xs text-rose-600 hover:text-rose-800 font-medium">${t('moderation.delete')}</button>
        `;
        row.querySelector('[data-action="delete-slot"]').addEventListener('click', () => deleteSlot(slot.id));
        listEl.appendChild(row);
      });
    }

    const addForm = dayPanel.querySelector('[data-el="add-form"]');
    const panelStatusEl = dayPanel.querySelector('[data-el="panel-status"]');
    const recurringCheckbox = addForm.querySelector('[data-el="recurring-checkbox"]');
    const recurUntilWrap = addForm.querySelector('[data-el="recur-until-wrap"]');
    recurringCheckbox.addEventListener('change', () => {
      recurUntilWrap.classList.toggle('hidden', !recurringCheckbox.checked);
      addForm.elements.repeat_until.required = recurringCheckbox.checked;
    });

    addForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      panelStatusEl.className = 'text-sm text-rose-600 mt-2';
      panelStatusEl.textContent = '';

      const windowStart = addForm.elements.window_start.value;
      const windowEnd = addForm.elements.window_end.value;
      const duration = Number(addForm.elements.duration.value);
      const locationType = addForm.elements.location_type.value;
      const recurring = recurringCheckbox.checked;
      const repeatUntil = addForm.elements.repeat_until.value;

      if (windowEnd <= windowStart) {
        panelStatusEl.textContent = t('pastorAvailability.endBeforeStart');
        return;
      }
      if (!duration || duration < 5) {
        panelStatusEl.textContent = t('pastorAvailability.invalidDuration');
        return;
      }
      if (recurring && (!repeatUntil || repeatUntil < selectedDate)) {
        panelStatusEl.textContent = t('pastorAvailability.invalidRepeatUntil');
        return;
      }

      const rows = generateSlotRows({
        pastorId,
        startDateStr: selectedDate,
        windowStart,
        windowEnd,
        durationMinutes: duration,
        locationType,
        recurring,
        repeatUntilStr: recurring ? repeatUntil : null,
      });

      if (rows.length === 0) {
        panelStatusEl.textContent = t('pastorAvailability.noSlotsGenerated');
        return;
      }
      if (rows.length > MAX_GENERATED_SLOTS) {
        panelStatusEl.textContent = t('pastorAvailability.tooManySlots', { count: rows.length, max: MAX_GENERATED_SLOTS });
        return;
      }

      const { error } = await supabase.from('pastor_availability').upsert(rows, {
        onConflict: 'pastor_id,date,start_time,end_time',
        ignoreDuplicates: true,
      });
      if (error) {
        panelStatusEl.textContent = t('pastorAvailability.saveFailed', { message: error.message });
        return;
      }

      panelStatusEl.className = 'text-sm text-emerald-600 mt-2';
      panelStatusEl.textContent = tn('pastorAvailability.slotsGenerated', rows.length);
      addForm.reset();
      recurUntilWrap.classList.add('hidden');
      loadMonth();
    });
  }

  async function deleteSlot(id) {
    if (!(await confirmDialog({ message: t('pastorAvailability.confirmDelete') }))) return;
    const { error } = await supabase.from('pastor_availability').delete().eq('id', id);
    if (error) {
      window.alert(t('pastorAvailability.saveFailed', { message: error.message }));
      return;
    }
    loadMonth();
  }
}

// Expands one time window into consecutive duration-length slots
// (5:00-6:00 at 10 minutes -> six 10-minute slots), repeated weekly
// through repeatUntilStr when recurring -- materialized as concrete
// rows up front rather than stored as an abstract recurrence rule, so
// every existing booking/query path keeps working against plain date
// rows unchanged.
function generateSlotRows({ pastorId, startDateStr, windowStart, windowEnd, durationMinutes, locationType, recurring, repeatUntilStr }) {
  const dates = [];
  if (recurring && repeatUntilStr) {
    let cur = new Date(startDateStr + 'T00:00:00');
    const until = new Date(repeatUntilStr + 'T00:00:00');
    while (cur <= until) {
      dates.push(formatDateLocal(cur));
      cur.setDate(cur.getDate() + 7);
    }
  } else {
    dates.push(startDateStr);
  }

  const [wsH, wsM] = windowStart.split(':').map(Number);
  const [weH, weM] = windowEnd.split(':').map(Number);
  const windowStartMin = wsH * 60 + wsM;
  const windowEndMin = weH * 60 + weM;

  const rows = [];
  for (const dateStr of dates) {
    let cursor = windowStartMin;
    while (cursor + durationMinutes <= windowEndMin) {
      rows.push({
        pastor_id: pastorId,
        date: dateStr,
        start_time: minutesToTimeStr(cursor),
        end_time: minutesToTimeStr(cursor + durationMinutes),
        location_type: locationType,
      });
      cursor += durationMinutes;
    }
  }
  return rows;
}

function minutesToTimeStr(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
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
