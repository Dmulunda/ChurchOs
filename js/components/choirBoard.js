// Choir scheduling board — mirrors js/components/mediaTechBoard.js's
// structure exactly: one admin form (date + per-voice-part multi-select,
// optional title/song attachment), save, done. Replaces the old two-tool
// flow (autoPlanner.js's separate "Generate Roster" step + a totally
// separate serviceRequestAdmin.js that invited the ENTIRE department
// regardless of who was actually placed) and the Choir-only response
// screen (serviceRequestSinger.js), which is now the same shared
// myAssignmentsPanel.js every other department already uses.
//
// Saving writes BOTH service_plan_singers (the roster, delete-all/
// reinsert per plan -- unchanged from autoPlanner.js's own behavior, so
// the shared scheduling-conflict/absence-blocking machinery and the
// dashboard's "today's schedule" widget need no changes at all) AND
// service_rsvps (now carrying voice_part alongside status/reason --
// sql/saas_platform/110 -- so one row is both the assignment and the
// response, same shape as media_tech_assignments).
import { t, voicePartLabel } from '../i18n.js';
import { renderMyAssignmentsPanel } from './myAssignmentsPanel.js';
import { renderAssigneeBadge } from './assignmentStatusBadge.js';
import { confirmDialog } from './confirmDialog.js';
import { todayLocal } from '../utils/date.js';
import { getGlobalRole } from '../departments.js';
import { notifyDepartment } from '../utils/notifyDepartment.js';
import { checkAndConfirmBatchAssignment } from '../utils/schedulingConflicts.js';

const VOICE_PARTS = ['Leader', 'Soprano', 'Alto', 'Tenor', 'Pianist', 'Bassist', 'Guitarist', 'Drummer'];

export function renderChoirBoard(container, { supabase, departmentId, canAdminister, userId }) {
  const dateMinAttr = getGlobalRole() === 'super_admin' ? '' : `min="${todayLocal()}"`;

  container.innerHTML = `
    <div data-el="my-assignments"></div>
    ${canAdminister ? `
      <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-6">
        <h2 class="text-lg font-semibold mb-4">${t('choirBoard.assignForDate')}</h2>
        <form data-el="form" class="space-y-4">
          <div class="grid sm:grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-slate-600 mb-1">${t('requests.date')}</label>
              <input type="date" name="date" required ${dateMinAttr} class="w-full border border-slate-300 rounded-lg px-3 py-2" />
            </div>
            <div>
              <label class="block text-sm font-medium text-slate-600 mb-1">${t('choirBoard.titleOptional')}</label>
              <input type="text" name="title" placeholder="${t('requests.eventTitlePlaceholder')}"
                     class="w-full border border-slate-300 rounded-lg px-3 py-2" />
            </div>
          </div>

          <div class="grid sm:grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-slate-600 mb-1">${t('requests.praiseSongs')}</label>
              <div data-el="praise-checklist" class="border border-slate-300 rounded-lg p-2 max-h-40 overflow-y-auto space-y-1 text-sm"></div>
            </div>
            <div>
              <label class="block text-sm font-medium text-slate-600 mb-1">${t('requests.worshipSongs')}</label>
              <div data-el="worship-checklist" class="border border-slate-300 rounded-lg p-2 max-h-40 overflow-y-auto space-y-1 text-sm"></div>
            </div>
          </div>

          <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            ${VOICE_PARTS.map((part) => `
              <div>
                <label class="block text-sm font-medium text-slate-600 mb-1">${voicePartLabel(part)}</label>
                <select multiple size="4" data-part-select="${part}"
                        class="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"></select>
              </div>
            `).join('')}
          </div>

          <div class="flex items-center gap-3">
            <button type="submit" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">
              ${t('choirBoard.save')}
            </button>
            <span data-el="form-status" class="text-sm text-slate-500"></span>
          </div>
        </form>
      </div>
    ` : ''}
    <div class="bg-white rounded-xl shadow p-4 sm:p-6">
      <h2 class="text-lg font-semibold mb-4">${t('choirBoard.upcoming')}</h2>
      <div data-el="list" class="space-y-3"></div>
    </div>
  `;

  const form = container.querySelector('[data-el="form"]');
  const formStatusEl = container.querySelector('[data-el="form-status"]');
  const praiseChecklistEl = container.querySelector('[data-el="praise-checklist"]');
  const worshipChecklistEl = container.querySelector('[data-el="worship-checklist"]');
  const listEl = container.querySelector('[data-el="list"]');

  if (userId) {
    renderMyAssignmentsPanel(container.querySelector('[data-el="my-assignments"]'), {
      departmentId,
      fetchMyAssignments: async () => {
        const { data, error } = await supabase
          .from('service_rsvps')
          .select('id, voice_part, status, reason, working_department:departments!working_department_id ( key ), service_plans ( date, title )')
          .eq('singer_id', userId)
          .not('voice_part', 'is', null);
        if (error) return { error };
        return {
          data: (data || [])
            .filter((r) => r.service_plans)
            .map((r) => ({
              id: r.id,
              label: r.service_plans.title ? `${voicePartLabel(r.voice_part)} — ${r.service_plans.title}` : voicePartLabel(r.voice_part),
              date: r.service_plans.date,
              status: r.status,
              reason: r.reason,
              workingDepartmentId: r.working_department?.id || null,
            })),
        };
      },
      updateAssignment: async (id, patch) => {
        const update = {};
        if ('status' in patch) { update.status = patch.status; update.responded_at = new Date().toISOString(); }
        if ('reason' in patch) update.reason = patch.reason;
        if ('workingDepartmentId' in patch) update.working_department_id = patch.workingDepartmentId;
        const { error } = await supabase.from('service_rsvps').update(update).eq('id', id);
        if (!error) load();
        return { error };
      },
    });
  }

  if (form) {
    loadSongOptions();
    loadMemberOptions();
    form.elements.date.addEventListener('change', () => prefillFromDate(form.elements.date.value));
    form.addEventListener('submit', handleSubmit);
  }

  load();

  // ---- Praise/Worship song checklist, ported verbatim from the old
  // serviceRequestAdmin.js -- unrelated to the one-step merge, just
  // relocated here. ----

  async function loadSongOptions() {
    const { data } = await supabase.from('songs').select('id, title').order('title');
    const songs = data || [];
    renderChecklist(praiseChecklistEl, songs);
    renderChecklist(worshipChecklistEl, songs);
    wireExclusivity(praiseChecklistEl, worshipChecklistEl);
    wireExclusivity(worshipChecklistEl, praiseChecklistEl);
  }

  function renderChecklist(el, songs) {
    el.innerHTML = songs.length === 0
      ? `<p class="text-slate-400 text-xs">${t('requests.noSongsAvailable')}</p>`
      : songs.map((song) => `
          <div data-song-row="${song.id}">
            <label class="flex items-center gap-2">
              <input type="checkbox" value="${song.id}" data-song-checkbox />
              <span>${escapeHtml(song.title)}</span>
            </label>
            <input type="text" data-song-note="${song.id}" placeholder="${t('requests.notePlaceholder')}"
                   class="hidden mt-1 ml-6 w-[calc(100%-1.5rem)] text-xs border border-slate-300 rounded px-2 py-1" />
          </div>
        `).join('');

    el.querySelectorAll('[data-song-checkbox]').forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        const noteInput = el.querySelector(`[data-song-note="${checkbox.value}"]`);
        noteInput.classList.toggle('hidden', !checkbox.checked);
      });
    });
  }

  function wireExclusivity(el, otherEl) {
    el.querySelectorAll('[data-song-checkbox]').forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        if (!checkbox.checked) return;
        const twin = otherEl.querySelector(`[data-song-checkbox][value="${checkbox.value}"]`);
        if (twin) {
          twin.checked = false;
          otherEl.querySelector(`[data-song-note="${checkbox.value}"]`)?.classList.add('hidden');
        }
      });
    });
  }

  function checkedSongsWithNotes(el) {
    return Array.from(el.querySelectorAll('[data-song-checkbox]:checked')).map((cb) => ({
      song_id: cb.value,
      note: el.querySelector(`[data-song-note="${cb.value}"]`)?.value.trim() || null,
    }));
  }

  // ---- Member options + prefill, mirroring mediaTechBoard.js's own
  // loadMemberOptions/renderRoleOptions/prefillFromDate exactly, keyed
  // by voice_part instead of role. ----

  let allMembers = [];

  async function loadMemberOptions() {
    const { data } = await supabase
      .from('department_memberships')
      .select('user_id, member:profiles!user_id ( full_name, voice_parts )')
      .eq('department_id', departmentId)
      .eq('status', 'approved');

    allMembers = (data || []).filter((m) => m.member);
    renderPartOptions(new Set());
  }

  function renderPartOptions(unavailableIds, conflictMap = new Map()) {
    VOICE_PARTS.forEach((part) => {
      const options = allMembers
        .filter((m) => (m.member.voice_parts || []).includes(part) && !unavailableIds.has(m.user_id))
        .map((m) => {
          const conflictDept = conflictMap.get(m.user_id);
          const note = conflictDept ? ` (${t('deptScheduling.alreadyAssignedTo', { department: conflictDept })})` : '';
          return `<option value="${m.user_id}">${escapeHtml(m.member.full_name)}${note}</option>`;
        })
        .join('');
      container.querySelector(`[data-part-select="${part}"]`).innerHTML = options;
    });
  }

  async function prefillFromDate(dateStr) {
    [praiseChecklistEl, worshipChecklistEl].forEach((el) => {
      el.querySelectorAll('[data-song-checkbox]').forEach((cb) => { cb.checked = false; });
      el.querySelectorAll('[data-song-note]').forEach((input) => { input.value = ''; input.classList.add('hidden'); });
    });
    if (!dateStr) { renderPartOptions(new Set()); return; }

    const [{ data: plan }, { data: unavailableRows }, { data: conflictRows }] = await Promise.all([
      supabase.from('service_plans').select('id, title').eq('date', dateStr).maybeSingle(),
      supabase.from('availability').select('user_id').eq('date', dateStr).eq('status', 'unavailable'),
      supabase.rpc('get_all_schedule_conflicts_for_date', { p_date: dateStr, p_exclude_department_id: departmentId }),
    ]);

    renderPartOptions(
      new Set((unavailableRows || []).map((r) => r.user_id)),
      new Map((conflictRows || []).map((r) => [r.user_id, r.department_name])),
    );

    form.elements.title.value = plan?.title || '';
    if (!plan) return;

    const [{ data: singerRows }, { data: planSongs }] = await Promise.all([
      supabase.from('service_plan_singers').select('voice_part, singer_id, singer:profiles!singer_id ( full_name )').eq('service_plan_id', plan.id),
      supabase.from('service_plan_songs').select('song_id, category, note').eq('service_plan_id', plan.id),
    ]);

    (singerRows || []).forEach((row) => {
      const select = container.querySelector(`[data-part-select="${row.voice_part}"]`);
      if (!select) return;
      let option = select.querySelector(`option[value="${row.singer_id}"]`);
      if (!option && row.singer?.full_name) {
        // Already assigned here but no longer eligible/available for
        // this part -- keep them visible and selected so resaving this
        // form doesn't silently drop them; admin has to deselect.
        option = document.createElement('option');
        option.value = row.singer_id;
        option.textContent = row.singer.full_name;
        select.appendChild(option);
      }
      if (option) option.selected = true;
    });

    (planSongs || []).forEach((row) => {
      const el = row.category === 'praise' ? praiseChecklistEl : worshipChecklistEl;
      const checkbox = el.querySelector(`[data-song-checkbox][value="${row.song_id}"]`);
      const noteInput = el.querySelector(`[data-song-note="${row.song_id}"]`);
      if (checkbox) checkbox.checked = true;
      if (noteInput) { noteInput.value = row.note || ''; noteInput.classList.remove('hidden'); }
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const date = form.elements.date.value;
    if (!date) return;
    const title = form.elements.title.value.trim();

    formStatusEl.className = 'text-sm text-slate-500';
    formStatusEl.textContent = t('common.saving');

    const { data: { user } } = await supabase.auth.getUser();

    try {
      const { data: existingPlan, error: findError } = await supabase
        .from('service_plans').select('id').eq('date', date).maybeSingle();
      if (findError) throw findError;

      let planId = existingPlan?.id;
      if (planId) {
        const { error: updateError } = await supabase.from('service_plans').update({ title: title || null, choir_leader_id: user.id }).eq('id', planId);
        if (updateError) throw updateError;
      } else {
        const { data: newPlan, error: insertError } = await supabase
          .from('service_plans').insert({ date, title: title || null, choir_leader_id: user.id, status: 'draft' }).select('id').single();
        if (insertError) throw insertError;
        planId = newPlan.id;
      }

      const praiseSongs = checkedSongsWithNotes(praiseChecklistEl);
      const worshipSongs = checkedSongsWithNotes(worshipChecklistEl);
      const { error: deleteSongsError } = await supabase.from('service_plan_songs').delete().eq('service_plan_id', planId);
      if (deleteSongsError) throw deleteSongsError;
      const songRows = [
        ...praiseSongs.map(({ song_id, note }, position) => ({ service_plan_id: planId, song_id, category: 'praise', position, note })),
        ...worshipSongs.map(({ song_id, note }, position) => ({ service_plan_id: planId, song_id, category: 'worship', position, note })),
      ];
      if (songRows.length > 0) {
        const { error: insertSongsError } = await supabase.from('service_plan_songs').insert(songRows);
        if (insertSongsError) throw insertSongsError;
      }

      const desired = VOICE_PARTS.flatMap((part) => {
        const select = container.querySelector(`[data-part-select="${part}"]`);
        return Array.from(select.selectedOptions).map((opt) => ({ voice_part: part, singer_id: opt.value, singer_label: opt.textContent }));
      });
      const desiredKeys = new Set(desired.map((d) => `${d.voice_part}:${d.singer_id}`));

      const { data: existingSingers, error: existingSingersError } = await supabase
        .from('service_plan_singers').select('id, voice_part, singer_id').eq('service_plan_id', planId);
      if (existingSingersError) throw existingSingersError;
      const { data: existingRsvps, error: existingRsvpsError } = await supabase
        .from('service_rsvps').select('id, voice_part, singer_id').eq('service_plan_id', planId).not('voice_part', 'is', null);
      if (existingRsvpsError) throw existingRsvpsError;

      // Conflict check before anything is written, same as both
      // autoPlanner.js and mediaTechBoard.js already do.
      const newlyDesired = desired.filter((d) => !(existingRsvps || []).some((r) => r.voice_part === d.voice_part && r.singer_id === d.singer_id));
      if (newlyDesired.length > 0) {
        const proceed = await checkAndConfirmBatchAssignment({
          supabase, departmentId,
          assignments: newlyDesired.map((d) => ({ userId: d.singer_id, userLabel: d.singer_label, date })),
        });
        if (!proceed) { formStatusEl.textContent = ''; return; }
      }

      // service_plan_singers: delete-all/reinsert per plan, unchanged
      // from autoPlanner.js's own behavior -- the shared conflict/
      // absence/dashboard machinery reads this table and needs no
      // changes.
      const { error: deleteSingersError } = await supabase.from('service_plan_singers').delete().eq('service_plan_id', planId);
      if (deleteSingersError) throw deleteSingersError;
      if (desired.length > 0) {
        const { error: insertSingersError } = await supabase.from('service_plan_singers')
          .insert(desired.map((d) => ({ service_plan_id: planId, singer_id: d.singer_id, voice_part: d.voice_part })));
        if (insertSingersError) throw insertSingersError;
      }

      // service_rsvps: diff-and-save, not delete-all/reinsert -- an
      // assignment someone already approved or declined must keep that
      // status if it's still in the desired set (mirrors
      // mediaTechBoard.js's handleSubmit exactly).
      const existingKeys = new Set((existingRsvps || []).map((r) => `${r.voice_part}:${r.singer_id}`));
      const toDeleteIds = (existingRsvps || []).filter((r) => !desiredKeys.has(`${r.voice_part}:${r.singer_id}`)).map((r) => r.id);
      const toInsert = desired
        .filter((d) => !existingKeys.has(`${d.voice_part}:${d.singer_id}`))
        .map((d) => ({ service_plan_id: planId, singer_id: d.singer_id, voice_part: d.voice_part, status: 'pending', created_by: user.id }));

      if (toDeleteIds.length > 0) {
        const { error: deleteRsvpsError } = await supabase.from('service_rsvps').delete().in('id', toDeleteIds);
        if (deleteRsvpsError) throw deleteRsvpsError;
      }
      if (toInsert.length > 0) {
        const { error: insertRsvpsError } = await supabase.from('service_rsvps').insert(toInsert);
        if (insertRsvpsError) throw insertRsvpsError;
      }

      formStatusEl.textContent = '';
      load();
      if (toInsert.length > 0 || toDeleteIds.length > 0) {
        notifyDepartment(supabase, departmentId, t('notifications.newSchedule'), t('notifications.newScheduleBodyDate', { date }));
      }
    } catch (error) {
      formStatusEl.className = 'text-sm text-rose-600';
      formStatusEl.textContent = t('choirBoard.saveFailed', { message: error.message });
    }
  }

  async function load() {
    listEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    let plansQuery = supabase.from('service_plans').select('id, date, title');
    if (getGlobalRole() !== 'super_admin') plansQuery = plansQuery.gte('date', todayLocal());
    const { data: plans, error: plansError } = await plansQuery.order('date', { ascending: true });

    if (plansError) {
      listEl.innerHTML = `<p class="text-sm text-rose-600">${t('choirBoard.loadFailed', { message: plansError.message })}</p>`;
      return;
    }
    // Only plans with an actual roster or invite are worth listing --
    // an empty draft from a half-finished form isn't useful to show.
    const planIds = plans.map((p) => p.id);
    if (planIds.length === 0) {
      listEl.innerHTML = `<p class="text-sm text-slate-500">${t('choirBoard.none')}</p>`;
      return;
    }

    const [{ data: rsvps }, { data: planSongs }] = await Promise.all([
      supabase.from('service_rsvps')
        .select('service_plan_id, voice_part, status, reason, assignee:profiles!singer_id ( full_name ), working_department:departments!working_department_id ( key )')
        .in('service_plan_id', planIds).not('voice_part', 'is', null),
      supabase.from('service_plan_songs')
        .select('service_plan_id, category, note, songs ( title )').in('service_plan_id', planIds).order('position'),
    ]);

    const rsvpsByPlan = new Map(planIds.map((id) => [id, []]));
    (rsvps || []).forEach((r) => rsvpsByPlan.get(r.service_plan_id)?.push(r));
    const songsByPlan = new Map(planIds.map((id) => [id, { praise: [], worship: [] }]));
    (planSongs || []).forEach((row) => { if (row.songs) songsByPlan.get(row.service_plan_id)?.[row.category].push({ title: row.songs.title, note: row.note }); });

    const plansWithContent = plans.filter((p) => (rsvpsByPlan.get(p.id) || []).length > 0);
    if (plansWithContent.length === 0) {
      listEl.innerHTML = `<p class="text-sm text-slate-500">${t('choirBoard.none')}</p>`;
      return;
    }

    listEl.innerHTML = plansWithContent.map((plan) => {
      const planRsvps = rsvpsByPlan.get(plan.id) || [];
      const byPart = new Map();
      planRsvps.forEach((r) => {
        if (!byPart.has(r.voice_part)) byPart.set(r.voice_part, []);
        if (r.assignee?.full_name) byPart.get(r.voice_part).push(r);
      });
      const { praise, worship } = songsByPlan.get(plan.id) || { praise: [], worship: [] };

      return `
        <div class="border border-slate-200 rounded-lg p-3">
          <div class="flex items-baseline justify-between gap-3 mb-2">
            <div>
              <div class="text-sm font-semibold text-slate-800">${escapeHtml(plan.date)}</div>
              ${plan.title ? `<div class="text-xs text-slate-500">${escapeHtml(plan.title)}</div>` : ''}
            </div>
            ${canAdminister ? `<button type="button" data-action="delete" data-date="${escapeHtml(plan.date)}" class="text-xs font-medium text-rose-600 hover:text-rose-800 whitespace-nowrap">${t('choirBoard.delete')}</button>` : ''}
          </div>
          ${(praise.length > 0 || worship.length > 0) ? `
            <div class="grid sm:grid-cols-2 gap-2 mb-2 text-xs text-slate-600">
              ${praise.length > 0 ? `<div><span class="font-semibold">${t('requests.praiseSongs')}:</span> ${formatSongList(praise)}</div>` : '<div></div>'}
              ${worship.length > 0 ? `<div><span class="font-semibold">${t('requests.worshipSongs')}:</span> ${formatSongList(worship)}</div>` : ''}
            </div>
          ` : ''}
          <div class="grid sm:grid-cols-2 gap-2">
            ${VOICE_PARTS.filter((part) => byPart.has(part)).map((part) => `
              <div class="text-sm">
                <span class="text-slate-500">${voicePartLabel(part)}:</span>
                ${byPart.get(part).length > 0
                  ? byPart.get(part).map((row) => renderAssigneeBadge({
                      name: row.assignee.full_name, status: row.status, reason: row.reason,
                      workingDepartmentKey: row.working_department?.key,
                    })).join(' ')
                  : `<span class="text-slate-400">${t('deptScheduling.unassigned')}</span>`}
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }).join('');
  }

  listEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action="delete"]');
    if (!btn) return;
    const date = btn.dataset.date;
    if (!(await confirmDialog({ message: t('choirBoard.confirmDelete', { date }) }))) return;
    const { error } = await supabase.from('service_plans').delete().eq('date', date);
    if (error) {
      window.alert(t('choirBoard.deleteFailed', { message: error.message }));
      return;
    }
    load();
  });
}

function formatSongList(songs) {
  return songs.map(({ title, note }) => note ? `${escapeHtml(title)} (${escapeHtml(note)})` : escapeHtml(title)).join(', ');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
