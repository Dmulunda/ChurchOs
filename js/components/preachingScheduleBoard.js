// Preaching & Moderation schedule: Moderator and Preacher are both a
// dropdown of registered members; Guest (an outside preacher without an
// account) stays free text. A day isn't limited to one entry (sql/057)
// — e.g. two services, or a lineup of several speakers for a special
// event — so the form is insert-or-edit-by-id rather than upsert-by-
// date; clicking "Edit" on a card loads that specific entry, and
// submitting with nothing being edited always adds a new one. Each
// entry can expand to show that day's Choir song program — visible
// here specifically because sql/017_preaching_schedule.sql grants the
// scheduled moderator read access to it, even without Choir department
// membership. The moderator can approve or decline being scheduled
// (sql/049), same as every other department now.
import { t } from '../i18n.js';
import { renderMyAssignmentsPanel } from './myAssignmentsPanel.js';
import { renderAssigneeBadge } from './assignmentStatusBadge.js';
import { confirmDialog } from './confirmDialog.js';
import { todayLocal } from '../utils/date.js';
import { getGlobalRole } from '../departments.js';
import { notifyDepartment } from '../utils/notifyDepartment.js';
import { checkAndConfirmAssignment } from '../utils/schedulingConflicts.js';
import { createPreachingScheduleImportModal } from './preachingScheduleImport.js';

export function renderPreachingSchedule(container, { supabase, departmentId, canAdminister, userId }) {
  // Super Admin keeps the ability to correct an already-past entry;
  // every other department admin is hard-blocked (sql/052's DB trigger
  // enforces the same rule), so the picker shouldn't even let them try.
  const dateMinAttr = getGlobalRole() === 'super_admin' ? '' : `min="${todayLocal()}"`;

  container.innerHTML = `
    <div data-el="my-assignments"></div>
    ${canAdminister ? `
      <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-6">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-semibold">${t('preaching.title')}</h2>
          <button type="button" data-action="import-pdf" class="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm">${t('deptCalendar.importPdf')}</button>
        </div>
        <p class="text-xs text-slate-500 mb-3">${t('preaching.multipleHint')}</p>
        <p data-el="edit-indicator" class="hidden text-sm text-indigo-700 bg-indigo-50 rounded-lg px-3 py-2 mb-3">
          ${t('preaching.editingEntry')}
          <button type="button" data-action="cancel-edit" class="ml-2 font-medium underline hover:no-underline">${t('preaching.newEntryInstead')}</button>
        </p>
        <form data-el="form" class="grid sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('requests.date')}</label>
            <input type="date" name="date" required ${dateMinAttr} class="w-full border border-slate-300 rounded-lg px-3 py-2" />
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('preaching.moderator')}</label>
            <select name="moderator" data-el="moderator-select" class="w-full border border-slate-300 rounded-lg px-3 py-2">
              <option value="">${t('preaching.moderatorNone')}</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('preaching.preacher')}</label>
            <select name="preacher" data-el="preacher-select" class="w-full border border-slate-300 rounded-lg px-3 py-2">
              <option value="">${t('preaching.preacherNone')}</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('preaching.guest')}</label>
            <input type="text" name="guest_name" placeholder="${t('preaching.guestPlaceholder')}"
                   class="w-full border border-slate-300 rounded-lg px-3 py-2" />
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('preaching.sermonTheme')}</label>
            <input type="text" name="sermon_theme" placeholder="${t('preaching.sermonThemePlaceholder')}"
                   class="w-full border border-slate-300 rounded-lg px-3 py-2" />
          </div>
          <div class="sm:col-span-2">
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('preaching.bibleVerse')}</label>
            <input type="text" name="bible_verse" placeholder="${t('preaching.bibleVersePlaceholder')}"
                   class="w-full border border-slate-300 rounded-lg px-3 py-2" />
          </div>
          <div class="sm:col-span-2 flex items-center gap-3">
            <button type="submit" data-el="save-btn" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">
              ${t('preaching.save')}
            </button>
            <span data-el="form-status" class="text-sm text-slate-500"></span>
          </div>
        </form>
      </div>
    ` : ''}
    <div class="bg-white rounded-xl shadow p-4 sm:p-6">
      <h2 class="text-lg font-semibold mb-4">${t('preaching.upcoming')}</h2>
      <div data-el="list" class="space-y-3"></div>
    </div>
  `;

  const form = container.querySelector('[data-el="form"]');
  const moderatorSelect = container.querySelector('[data-el="moderator-select"]');
  const preacherSelect = container.querySelector('[data-el="preacher-select"]');
  const formStatusEl = container.querySelector('[data-el="form-status"]');
  const saveBtn = container.querySelector('[data-el="save-btn"]');
  const editIndicatorEl = container.querySelector('[data-el="edit-indicator"]');
  const listEl = container.querySelector('[data-el="list"]');
  let editingRow = null;

  if (userId) {
    renderMyAssignmentsPanel(container.querySelector('[data-el="my-assignments"]'), {
      departmentId,
      fetchMyAssignments: async () => {
        const { data, error } = await supabase
          .from('preaching_schedule')
          .select('id, date, moderator_status, moderator_reason, moderator_working_department_id')
          .eq('moderator_id', userId)
          .order('date', { ascending: true });
        if (error) return { error };
        return {
          data: (data || []).map((r) => ({
            id: r.id,
            label: t('preaching.moderator'),
            date: r.date,
            status: r.moderator_status,
            reason: r.moderator_reason,
            workingDepartmentId: r.moderator_working_department_id,
          })),
        };
      },
      updateAssignment: async (id, patch) => {
        const update = {};
        if ('status' in patch) { update.moderator_status = patch.status; update.moderator_responded_at = new Date().toISOString(); }
        if ('reason' in patch) update.moderator_reason = patch.reason;
        if ('workingDepartmentId' in patch) update.moderator_working_department_id = patch.workingDepartmentId;
        const { error } = await supabase.from('preaching_schedule').update(update).eq('id', id);
        if (!error) load();
        return { error };
      },
    });
  }

  if (form) {
    loadMemberOptions();
    // A day can have several entries now, so picking a date no longer
    // loads an existing entry into the form automatically — it just
    // re-filters who's available. Loading a specific entry for editing
    // only happens via that entry's own "Edit" button in the list.
    form.elements.date.addEventListener('change', () => refreshAvailabilityForDate(form.elements.date.value));
    form.addEventListener('submit', handleSubmit);
    container.querySelector('[data-action="cancel-edit"]').addEventListener('click', resetForm);

    const importModal = createPreachingScheduleImportModal({
      supabase, departmentId, currentUserId: userId, onImported: load,
    });
    container.querySelector('[data-action="import-pdf"]').addEventListener('click', () => importModal.open());
  }

  load();

  let allMembers = [];

  async function loadMemberOptions() {
    const { data } = await supabase
      .from('department_memberships')
      .select('user_id, member:profiles!user_id ( full_name )')
      .eq('department_id', departmentId)
      .eq('status', 'approved');

    allMembers = (data || []).filter((m) => m.member);
    renderMemberSelect(moderatorSelect, t('preaching.moderatorNone'), new Set(), null);
    renderMemberSelect(preacherSelect, t('preaching.preacherNone'), new Set(), null);
  }

  // Excludes anyone who reported themselves unavailable for the
  // selected date — the whole point being that scheduling someone who
  // already said they can't make it should not even be possible,
  // rather than relying on an admin to notice. Whoever's already
  // selected for this date stays in the list regardless, same
  // exception Choir's auto-planner already makes, so an existing
  // (now-unavailable) assignment doesn't just silently disappear.
  //
  // conflictMap (user_id -> department name) flags anyone already
  // assigned in a DIFFERENT department that day -- a plain-text note,
  // not a filter (native <option> elements can't render bold/color, so
  // this can't be a richer visual warning; get_all_schedule_conflicts_for_date
  // still lets the scheduler pick them, same as the save-time confirm
  // dialog in schedulingConflicts.js).
  function renderMemberSelect(selectEl, placeholderLabel, unavailableIds, selectedId, conflictMap = new Map()) {
    const options = allMembers
      .filter((m) => m.user_id === selectedId || !unavailableIds.has(m.user_id))
      .map((m) => {
        const conflictDept = conflictMap.get(m.user_id);
        const note = unavailableIds.has(m.user_id)
          ? ` (${t('deptScheduling.unavailableOnDate')})`
          : conflictDept ? ` (${t('deptScheduling.alreadyAssignedTo', { department: conflictDept })})` : '';
        return `<option value="${m.user_id}" ${m.user_id === selectedId ? 'selected' : ''}>${escapeHtml(m.member.full_name)}${note}</option>`;
      })
      .join('');
    selectEl.innerHTML = `<option value="">${placeholderLabel}</option>` + options;
  }

  async function refreshAvailabilityForDate(dateStr) {
    if (!dateStr) {
      renderMemberSelect(moderatorSelect, t('preaching.moderatorNone'), new Set(), editingRow?.moderator_id || null);
      renderMemberSelect(preacherSelect, t('preaching.preacherNone'), new Set(), editingRow?.preacher_id || null);
      return;
    }

    const [{ data: unavailableRows }, { data: conflictRows }] = await Promise.all([
      supabase.from('availability').select('user_id').eq('date', dateStr).eq('status', 'unavailable'),
      supabase.rpc('get_all_schedule_conflicts_for_date', { p_date: dateStr, p_exclude_department_id: departmentId }),
    ]);

    const unavailableIds = new Set((unavailableRows || []).map((r) => r.user_id));
    const conflictMap = new Map((conflictRows || []).map((r) => [r.user_id, r.department_name]));
    renderMemberSelect(moderatorSelect, t('preaching.moderatorNone'), unavailableIds, editingRow?.moderator_id || null, conflictMap);
    renderMemberSelect(preacherSelect, t('preaching.preacherNone'), unavailableIds, editingRow?.preacher_id || null, conflictMap);
  }

  function startEditing(row) {
    editingRow = row;
    form.elements.date.value = row.date;
    form.elements.guest_name.value = row.guest_name || '';
    form.elements.sermon_theme.value = row.sermon_theme || '';
    form.elements.bible_verse.value = row.bible_verse || '';
    refreshAvailabilityForDate(row.date);

    editIndicatorEl.classList.remove('hidden');
    saveBtn.textContent = t('preaching.update');
    formStatusEl.textContent = '';
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function resetForm() {
    editingRow = null;
    form.reset();
    renderMemberSelect(moderatorSelect, t('preaching.moderatorNone'), new Set(), null);
    renderMemberSelect(preacherSelect, t('preaching.preacherNone'), new Set(), null);
    editIndicatorEl.classList.add('hidden');
    saveBtn.textContent = t('preaching.save');
    formStatusEl.textContent = '';
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const date = form.elements.date.value;
    if (!date) return;

    formStatusEl.className = 'text-sm text-slate-500';
    formStatusEl.textContent = t('common.saving');

    const { data: { user } } = await supabase.auth.getUser();
    const newModeratorId = form.elements.moderator.value || null;
    // A new or changed moderator starts fresh at "approved" — being
    // scheduled is the approval now (sql/058); carrying over the
    // previous moderator's declined status would misattribute it to
    // whoever is scheduled now. A brand new entry is always "changed"
    // (nothing to carry over from).
    const moderatorChanged = !editingRow || (editingRow.moderator_id || null) !== newModeratorId;
    const newPreacherId = form.elements.preacher.value || null;
    const preacherChanged = !editingRow || (editingRow.preacher_id || null) !== newPreacherId;

    if (moderatorChanged && newModeratorId) {
      const moderatorLabel = moderatorSelect.selectedOptions[0]?.textContent || newModeratorId;
      const proceed = await checkAndConfirmAssignment({
        supabase, userId: newModeratorId, userLabel: moderatorLabel, date, departmentId,
      });
      if (!proceed) { formStatusEl.textContent = ''; return; }
    }

    if (preacherChanged && newPreacherId) {
      const preacherLabel = preacherSelect.selectedOptions[0]?.textContent || newPreacherId;
      const proceed = await checkAndConfirmAssignment({
        supabase, userId: newPreacherId, userLabel: preacherLabel, date, departmentId,
      });
      if (!proceed) { formStatusEl.textContent = ''; return; }
    }

    const payload = {
      date,
      moderator_id: newModeratorId,
      ...(moderatorChanged ? { moderator_status: 'approved', moderator_reason: null, moderator_working_department_id: null } : {}),
      preacher_id: newPreacherId,
      // Clears out the old free-text value once an entry is saved
      // through this dropdown-based form, so it never shows a stale
      // name alongside a newly picked preacher_id.
      preacher_name: null,
      guest_name: form.elements.guest_name.value.trim() || null,
      sermon_theme: form.elements.sermon_theme.value.trim() || null,
      bible_verse: form.elements.bible_verse.value.trim() || null,
      created_by: user.id,
    };

    // A day isn't limited to one entry (sql/057) — editing an existing
    // one updates it by id; anything else is a brand new entry for
    // that date, even if the date already has others.
    const { error } = editingRow
      ? await supabase.from('preaching_schedule').update(payload).eq('id', editingRow.id)
      : await supabase.from('preaching_schedule').insert(payload);

    if (error) {
      formStatusEl.className = 'text-sm text-rose-600';
      formStatusEl.textContent = t('preaching.saveFailed', { message: error.message });
      return;
    }

    resetForm();
    load();
    notifyDepartment(supabase, departmentId, t('notifications.newSchedule'), t('notifications.newScheduleBodyDate', { date }));
  }

  async function load() {
    listEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    // Past entries are hidden once they're gone by, except for Super
    // Admin, who still needs to find and correct an already-past one.
    let query = supabase
      .from('preaching_schedule')
      .select('id, date, moderator_id, preacher_id, preacher_name, guest_name, sermon_theme, bible_verse, moderator_status, moderator_reason, moderator:profiles!moderator_id ( full_name ), preacher:profiles!preacher_id ( full_name ), working_department:departments!moderator_working_department_id ( key )');
    if (getGlobalRole() !== 'super_admin') query = query.gte('date', todayLocal());
    const { data, error } = await query.order('date', { ascending: true });

    if (error) {
      listEl.innerHTML = `<p class="text-sm text-rose-600">${t('preaching.loadFailed', { message: error.message })}</p>`;
      return;
    }

    if (data.length === 0) {
      listEl.innerHTML = `<p class="text-sm text-slate-500">${t('preaching.none')}</p>`;
      return;
    }

    listEl.innerHTML = '';
    data.forEach((row) => listEl.appendChild(renderRow(row)));
  }

  function renderRow(row) {
    const el = document.createElement('div');
    el.className = 'border border-slate-200 rounded-lg p-3';
    el.innerHTML = `
      <div class="flex items-baseline justify-between gap-3">
        <div class="font-medium text-slate-800">${row.sermon_theme ? escapeHtml(row.sermon_theme) : `<span class="text-slate-400">${t('preaching.noSermonTheme')}</span>`}</div>
        <div class="flex items-center gap-3 shrink-0">
          <div class="text-sm text-slate-500 whitespace-nowrap">${escapeHtml(row.date)}</div>
          ${canAdminister ? `
            <button type="button" data-action="edit" class="text-xs font-medium text-indigo-600 hover:text-indigo-800 whitespace-nowrap">${t('common.edit')}</button>
            <button type="button" data-action="delete" class="text-xs font-medium text-rose-600 hover:text-rose-800 whitespace-nowrap">${t('moderation.delete')}</button>
          ` : ''}
        </div>
      </div>
      <div class="text-sm text-slate-600 mt-1">
        ${t('preaching.moderator')}: ${row.moderator?.full_name
          ? renderAssigneeBadge({ name: row.moderator.full_name, status: row.moderator_status, reason: row.moderator_reason, workingDepartmentKey: row.working_department?.key })
          : `<span class="text-slate-400">${t('preaching.noModerator')}</span>`}
        &nbsp;·&nbsp;
        ${t('preaching.preacher')}: ${(() => {
          const name = row.preacher?.full_name || row.preacher_name;
          return name ? escapeHtml(name) : `<span class="text-slate-400">${t('preaching.noPreacher')}</span>`;
        })()}
        &nbsp;·&nbsp;
        ${t('preaching.guest')}: ${row.guest_name ? escapeHtml(row.guest_name) : `<span class="text-slate-400">${t('preaching.noGuest')}</span>`}
      </div>
      ${row.bible_verse ? `<div class="text-sm text-indigo-700 mt-1 italic">${t('preaching.bibleVerse')}: ${escapeHtml(row.bible_verse)}</div>` : ''}
      <details class="mt-2">
        <summary class="text-xs font-medium text-slate-500 cursor-pointer">${t('preaching.songProgram')}</summary>
        <div data-el="song-program" class="mt-2 text-sm"></div>
      </details>
    `;

    el.querySelector('details').addEventListener('toggle', function onToggle(e) {
      if (!e.target.open) return;
      e.target.removeEventListener('toggle', onToggle);
      loadSongProgram(row.date, el.querySelector('[data-el="song-program"]'));
    });

    if (canAdminister) {
      el.querySelector('[data-action="edit"]').addEventListener('click', () => startEditing(row));
      el.querySelector('[data-action="delete"]').addEventListener('click', () => deleteEntry(row));
    }

    return el;
  }

  async function deleteEntry(row) {
    if (!(await confirmDialog({ message: t('preaching.confirmDelete', { date: row.date }) }))) return;
    const { error } = await supabase.from('preaching_schedule').delete().eq('id', row.id);
    if (error) {
      window.alert(t('preaching.deleteFailed', { message: error.message }));
      return;
    }
    if (editingRow?.id === row.id) resetForm();
    load();
  }

  async function loadSongProgram(date, el) {
    el.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;

    const { data: plan } = await supabase
      .from('service_plans')
      .select('id, title')
      .eq('date', date)
      .maybeSingle();

    if (!plan) {
      el.innerHTML = `<p class="text-slate-400">${t('preaching.noSongProgram')}</p>`;
      return;
    }

    const { data: planSongs } = await supabase
      .from('service_plan_songs')
      .select('category, songs ( title )')
      .eq('service_plan_id', plan.id)
      .order('position');

    const praise = (planSongs || []).filter((r) => r.category === 'praise' && r.songs).map((r) => r.songs.title);
    const worship = (planSongs || []).filter((r) => r.category === 'worship' && r.songs).map((r) => r.songs.title);

    if (praise.length === 0 && worship.length === 0) {
      el.innerHTML = `<p class="text-slate-400">${t('preaching.noSongProgram')}</p>`;
      return;
    }

    el.innerHTML = `
      <div class="grid sm:grid-cols-2 gap-3">
        <div>
          <div class="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">${t('requests.praiseSongs')}</div>
          ${praise.length > 0
            ? `<ul class="list-disc list-inside text-slate-700">${praise.map((title) => `<li>${escapeHtml(title)}</li>`).join('')}</ul>`
            : `<p class="text-slate-400">${t('dashboard.noSongsYet')}</p>`
          }
        </div>
        <div>
          <div class="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">${t('requests.worshipSongs')}</div>
          ${worship.length > 0
            ? `<ul class="list-disc list-inside text-slate-700">${worship.map((title) => `<li>${escapeHtml(title)}</li>`).join('')}</ul>`
            : `<p class="text-slate-400">${t('dashboard.noSongsYet')}</p>`
          }
        </div>
      </div>
    `;
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
