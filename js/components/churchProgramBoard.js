// Church Program department board (sql/065/066) — every member has
// access automatically, so this is meant to be the first thing most
// people see. Lists upcoming church-wide programs (ordinary and
// "special"), with an add/edit form + flyer upload for the
// department's own admins. A program can span multiple, possibly
// non-consecutive dates (a week-long series, or scattered sessions) —
// same pick-a-date-then-Add-it-as-a-chip pattern as Report Absence,
// plus an optional weekly/monthly recurrence that expands into the
// same chip list up front (mirrors pastorAvailabilityCalendar.js's
// "materialize concrete rows, not an abstract rule" approach) rather
// than storing a recurrence rule anywhere. A special program also
// triggers a pop-up elsewhere (specialProgramPopup.js, wired from
// app.js) independent of whether someone ever opens this tab.
//
// The list below is shared with upcomingChurchEvents.js's widget
// (fetchUpcomingChurchEvents) rather than querying church_programs
// alone, so anything a department admin posts to their own public
// calendar (department_shifts, is_public_calendar) shows up here too --
// this page doubles as the one place to see everything coming up
// church-wide without a department admin having to re-enter it as a
// separate program. Those department-sourced entries render read-only
// (no edit/delete/flyer), tagged with the department they came from.
//
// Above all of that: the Church Calendar grid (churchCalendarGrid.js) --
// a monthly view merging these same Upcoming Events with Church
// Bookings, the newer "any department can reserve a date for their own
// event" mechanism. One date, one thing on it -- enforced in the
// database, not just this UI.
import { confirmDialog } from './confirmDialog.js';
import { fetchUpcomingChurchEvents } from './upcomingChurchEvents.js';
import { renderChurchCalendarGrid } from './churchCalendarGrid.js';
import { t, departmentLabel } from '../i18n.js';
import { todayLocal, formatDateLocal } from '../utils/date.js';

const FLYER_BUCKET = 'church-program-flyers';
// Same spirit as pastorAvailabilityCalendar.js's MAX_GENERATED_SLOTS --
// a sanity cap so a mis-picked "repeat until" decades out can't spin
// this into thousands of rows.
const MAX_RECURRING_DATES = 52;
const MAX_DAILY_DATES = 92;

function generateRecurringDates(startStr, untilStr, interval) {
  const dates = [];
  const cur = new Date(`${startStr}T00:00:00`);
  const until = new Date(`${untilStr}T00:00:00`);
  // Daily allows about three months; weekly/monthly keep the 52 cap.
  const cap = interval === 'daily' ? MAX_DAILY_DATES : MAX_RECURRING_DATES;
  while (cur <= until && dates.length < cap) {
    dates.push(formatDateLocal(cur));
    if (interval === 'monthly') cur.setMonth(cur.getMonth() + 1);
    else if (interval === 'daily') cur.setDate(cur.getDate() + 1);
    else cur.setDate(cur.getDate() + 7);
  }
  return dates;
}

export function renderChurchProgramBoard(container, { supabase, canAdminister, currentUserId, isSuperAdmin, myBookableDepartments }) {
  container.innerHTML = `
    <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-6">
      <h2 class="text-lg font-semibold mb-1">${t('churchCalendar.title')}</h2>
      <p class="text-sm text-slate-500 mb-4">${t('churchCalendar.intro')}</p>
      <div data-el="calendar-grid"></div>
    </div>
    ${canAdminister ? `
      <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-6">
        <h2 class="text-lg font-semibold mb-4" data-el="form-title">${t('churchProgram.addTitle')}</h2>
        <form data-el="form" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('churchProgram.programTitle')}</label>
            <input type="text" name="title" required class="w-full border border-slate-300 rounded-lg px-3 py-2" />
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('churchProgram.description')}</label>
            <textarea name="description" rows="2" class="w-full border border-slate-300 rounded-lg px-3 py-2"></textarea>
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('absence.dates')}</label>
            <div class="flex gap-2">
              <input type="date" data-el="date-picker" min="${todayLocal()}" class="flex-1 border border-slate-300 rounded-lg px-3 py-2" />
              <button type="button" data-action="add-date" class="px-3 py-2 rounded-lg bg-slate-700 text-white text-sm font-medium hover:bg-slate-800 whitespace-nowrap">
                ${t('absence.addDate')}
              </button>
            </div>
            <p class="text-xs text-slate-400 mt-1">${t('absence.datesHint')}</p>
            <div data-el="date-chips" class="flex flex-wrap gap-1.5 mt-2"></div>

            <label class="flex items-center gap-2 text-sm text-slate-600 mt-3">
              <input type="checkbox" data-el="recurring-checkbox" />
              ${t('churchProgram.recurring')}
            </label>
            <div data-el="recurring-options" class="hidden grid sm:grid-cols-2 gap-2 mt-2">
              <select data-el="recurring-interval" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
                <option value="daily">${t('churchProgram.recurringDaily')}</option>
                <option value="weekly" selected>${t('churchProgram.recurringWeekly')}</option>
                <option value="monthly">${t('churchProgram.recurringMonthly')}</option>
              </select>
              <input type="date" data-el="repeat-until" min="${todayLocal()}" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="${t('churchProgram.repeatUntil')}" />
            </div>
            <p class="text-xs text-slate-400 mt-1">${t('churchProgram.recurringHint')}</p>
          </div>
          <label class="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" name="is_special" />
            ${t('churchProgram.isSpecial')}
          </label>
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('churchProgram.flyer')}</label>
            <input type="file" name="flyer" accept="image/*" class="w-full text-sm" />
          </div>
          <div class="flex items-center gap-3">
            <button type="submit" data-el="submit-btn"
                    class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
              ${t('churchProgram.save')}
            </button>
            <button type="button" data-el="cancel-edit-btn" class="hidden px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100 font-medium">
              ${t('churchProgram.cancelEdit')}
            </button>
            <span data-el="form-status" class="text-sm text-slate-500"></span>
          </div>
        </form>
      </div>
    ` : ''}
    <div class="bg-white rounded-xl shadow p-4 sm:p-6">
      <h2 class="text-lg font-semibold mb-4">${t('churchProgram.upcomingTitle')}</h2>
      <div data-el="list" class="space-y-3"></div>
    </div>
  `;

  const formTitleEl = container.querySelector('[data-el="form-title"]');
  const form = container.querySelector('[data-el="form"]');
  const datePicker = container.querySelector('[data-el="date-picker"]');
  const chipsEl = container.querySelector('[data-el="date-chips"]');
  const recurringCheckbox = container.querySelector('[data-el="recurring-checkbox"]');
  const recurringOptionsEl = container.querySelector('[data-el="recurring-options"]');
  const recurringIntervalEl = container.querySelector('[data-el="recurring-interval"]');
  const repeatUntilEl = container.querySelector('[data-el="repeat-until"]');
  const listEl = container.querySelector('[data-el="list"]');
  const formStatusEl = container.querySelector('[data-el="form-status"]');
  const submitBtn = container.querySelector('[data-el="submit-btn"]');
  const cancelEditBtn = container.querySelector('[data-el="cancel-edit-btn"]');

  let dates = [];
  let editingProgramId = null;
  let editingFlyerPath = null;

  form?.addEventListener('submit', handleSubmit);
  container.querySelector('[data-action="add-date"]')?.addEventListener('click', addDate);
  recurringCheckbox?.addEventListener('change', () => {
    recurringOptionsEl.classList.toggle('hidden', !recurringCheckbox.checked);
  });
  cancelEditBtn?.addEventListener('click', exitEditMode);

  renderChurchCalendarGrid(container.querySelector('[data-el="calendar-grid"]'), {
    supabase, currentUserId, isSuperAdmin, myBookableDepartments: myBookableDepartments || [],
  });

  loadPrograms();

  function addDate() {
    const value = datePicker.value;
    if (!value) return;

    const newDates = (recurringCheckbox?.checked && repeatUntilEl.value)
      ? generateRecurringDates(value, repeatUntilEl.value, recurringIntervalEl.value)
      : [value];

    dates = Array.from(new Set([...dates, ...newDates])).sort();
    renderChips();
    datePicker.value = '';
    formStatusEl.textContent = '';
  }

  function removeDate(value) {
    dates = dates.filter((d) => d !== value);
    renderChips();
  }

  function renderChips() {
    chipsEl.innerHTML = dates.map((d) => `
      <span class="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full bg-indigo-50 text-indigo-700 text-sm" data-chip="${d}">
        ${d}
        <button type="button" data-action="remove-date" data-date="${d}" class="text-indigo-400 hover:text-indigo-700 leading-none text-base">&times;</button>
      </span>
    `).join('');
    chipsEl.querySelectorAll('[data-action="remove-date"]').forEach((btn) => {
      btn.addEventListener('click', () => removeDate(btn.dataset.date));
    });
  }

  function enterEditMode(item) {
    editingProgramId = item.id;
    editingFlyerPath = item.flyerPath || null;
    form.elements.title.value = item.title;
    form.elements.description.value = item.description || '';
    form.elements.is_special.checked = !!item.isSpecial;
    dates = [...item.dates];
    renderChips();
    recurringCheckbox.checked = false;
    recurringOptionsEl.classList.add('hidden');
    formTitleEl.textContent = t('churchProgram.editTitle');
    submitBtn.textContent = t('churchProgram.update');
    cancelEditBtn.classList.remove('hidden');
    formStatusEl.textContent = '';
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function exitEditMode() {
    editingProgramId = null;
    editingFlyerPath = null;
    form.reset();
    dates = [];
    renderChips();
    recurringOptionsEl.classList.add('hidden');
    formTitleEl.textContent = t('churchProgram.addTitle');
    submitBtn.textContent = t('churchProgram.save');
    cancelEditBtn.classList.add('hidden');
    formStatusEl.textContent = '';
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const title = form.elements.title.value.trim();
    const description = form.elements.description.value.trim() || null;
    const isSpecial = form.elements.is_special.checked;
    const flyerFile = form.elements.flyer.files[0] || null;

    if (!title || dates.length === 0) {
      formStatusEl.className = 'text-sm text-rose-600';
      formStatusEl.textContent = dates.length === 0 ? t('absence.noDatesPicked') : t('churchProgram.missingFields');
      return;
    }

    submitBtn.disabled = true;
    formStatusEl.className = 'text-sm text-slate-500';
    formStatusEl.textContent = t('common.saving');

    try {
      let flyerPath = editingProgramId ? editingFlyerPath : null;
      if (flyerFile) {
        flyerPath = `${crypto.randomUUID()}-${flyerFile.name}`;
        const { error: uploadError } = await supabase.storage.from(FLYER_BUCKET).upload(flyerPath, flyerFile);
        if (uploadError) throw uploadError;
      }

      if (editingProgramId) {
        const { error: updateError } = await supabase
          .from('church_programs')
          .update({ title, description, is_special: isSpecial, flyer_storage_path: flyerPath })
          .eq('id', editingProgramId);
        if (updateError) throw updateError;

        // No per-date state (status/assignment) to preserve here, unlike
        // e.g. ecodem workers -- a plain replace-all is simplest and safe.
        const { error: deleteDatesError } = await supabase
          .from('church_program_dates')
          .delete()
          .eq('program_id', editingProgramId);
        if (deleteDatesError) throw deleteDatesError;

        const { error: insertDatesError } = await supabase
          .from('church_program_dates')
          .insert(dates.map((date) => ({ program_id: editingProgramId, date })));
        if (insertDatesError) throw insertDatesError;

        formStatusEl.className = 'text-sm text-emerald-600';
        formStatusEl.textContent = t('churchProgram.updated');
        exitEditMode();
      } else {
        const { data: program, error: insertError } = await supabase
          .from('church_programs')
          .insert({
            title,
            description,
            is_special: isSpecial,
            flyer_storage_path: flyerPath,
            created_by: currentUserId,
          })
          .select('id')
          .single();
        if (insertError) throw insertError;

        const { error: datesError } = await supabase
          .from('church_program_dates')
          .insert(dates.map((date) => ({ program_id: program.id, date })));
        if (datesError) throw datesError;

        formStatusEl.className = 'text-sm text-emerald-600';
        formStatusEl.textContent = t('churchProgram.saved');
        form.reset();
        dates = [];
        renderChips();
      }
      loadPrograms();
    } catch (error) {
      formStatusEl.className = 'text-sm text-rose-600';
      // Symmetric conflict trigger -- one of the dates picked already
      // has a department's Church Booking on it.
      if (error.message?.includes('DATE_TAKEN_BY_BOOKING')) {
        formStatusEl.textContent = t('churchCalendar.dateHasBooking');
      } else {
        formStatusEl.textContent = editingProgramId
          ? t('churchProgram.updateFailed', { message: error.message })
          : t('churchProgram.saveFailed', { message: error.message });
      }
    } finally {
      submitBtn.disabled = false;
    }
  }

  async function loadPrograms() {
    listEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    let items;
    try {
      items = await fetchUpcomingChurchEvents(supabase);
    } catch (error) {
      listEl.innerHTML = `<p class="text-sm text-rose-600">${t('churchProgram.loadFailed', { message: error.message })}</p>`;
      return;
    }

    if (items.length === 0) {
      listEl.innerHTML = `<p class="text-sm text-slate-500">${t('churchProgram.none')}</p>`;
      return;
    }

    listEl.innerHTML = '';
    for (const item of items) {
      listEl.appendChild(item.kind === 'program' ? await buildProgramCard(item) : buildDepartmentCard(item));
    }
  }

  async function buildProgramCard(item) {
    let flyerUrl = null;
    if (item.flyerPath) {
      const { data: signed } = await supabase.storage.from(FLYER_BUCKET).createSignedUrl(item.flyerPath, 3600);
      flyerUrl = signed?.signedUrl || null;
    }

    const card = document.createElement('div');
    card.className = 'border border-slate-200 rounded-lg p-3';
    card.innerHTML = `
      <div class="flex items-start justify-between gap-3">
        <div>
          <div class="font-semibold text-slate-800">
            ${escapeHtml(item.title)}
            ${item.isSpecial ? `<span class="ml-2 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">${t('churchProgram.specialBadge')}</span>` : ''}
          </div>
          <div class="text-sm text-slate-500">${item.dates.map(escapeHtml).join(', ')}</div>
        </div>
        ${canAdminister ? `
          <div class="flex gap-3 shrink-0">
            <button type="button" data-action="edit" class="text-xs font-medium text-indigo-600 hover:text-indigo-800 whitespace-nowrap">${t('churchProgram.edit')}</button>
            <button type="button" data-action="delete" class="text-xs font-medium text-rose-600 hover:text-rose-800 whitespace-nowrap">${t('churchProgram.delete')}</button>
          </div>
        ` : ''}
      </div>
      ${item.description ? `<p class="text-sm text-slate-600 mt-2">${escapeHtml(item.description)}</p>` : ''}
      ${flyerUrl ? `<img src="${flyerUrl}" alt="${escapeAttr(item.title)}" class="mt-2 rounded-lg max-h-48 object-contain" />` : ''}
    `;

    card.querySelector('[data-action="edit"]')?.addEventListener('click', () => enterEditMode(item));
    card.querySelector('[data-action="delete"]')?.addEventListener('click', () => deleteProgram(item));
    return card;
  }

  // Read-only — sourced from another department's own public calendar
  // (department_shifts), managed on that department's own Scheduling
  // tab, not here.
  function buildDepartmentCard(item) {
    const card = document.createElement('div');
    card.className = 'border border-slate-200 rounded-lg p-3';
    card.innerHTML = `
      <div class="font-semibold text-slate-800">${escapeHtml(item.title)}</div>
      <div class="text-sm text-slate-500">${item.dates.map(escapeHtml).join(', ')}</div>
      ${item.notes ? `<p class="text-sm text-slate-600 mt-2">${escapeHtml(item.notes)}</p>` : ''}
      <span class="inline-block mt-2 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-500">${escapeHtml(t('churchProgram.fromDepartment', { dept: departmentLabel(item.departmentKey) }))}</span>
    `;
    return card;
  }

  async function deleteProgram(item) {
    if (!(await confirmDialog({ message: t('churchProgram.confirmDelete', { title: item.title }) }))) return;

    const { error } = await supabase.from('church_programs').delete().eq('id', item.id);
    if (error) {
      window.alert(t('churchProgram.deleteFailed', { message: error.message }));
      return;
    }
    if (editingProgramId === item.id) exitEditMode();
    loadPrograms();
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;');
}
