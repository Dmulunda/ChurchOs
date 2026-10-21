// Guest / Visitor Connection System — a follow-up queue covering two
// kinds of "unassigned" people: anonymous guest visitors logged during
// attendance check-in (attendanceManager.js), and signed-up members
// with zero approved department memberships. Both share the same
// NEW_GUEST -> CONTACTED -> ASSIGNED_TO_DEPARTMENT status.
//
// scope: { type: 'pastoral' } (default) — Super Admin/Pastor Admin/
//   Church Secretary, sees every case plus the unassigned-member
//   section, can send a guest case to any department.
// scope: { type: 'department', departmentId } — that department's own
//   admin, sees only guest cases currently assigned to them (see
//   is_pastoral_team()/can_write_department() in sql/042's RLS), can
//   send a case onward to a different department. No unassigned-member
//   section here — that's a pastoral-team concern (it creates a real
//   department_membership, distinct from case routing).
//
// A guest visitor has no account, so "sending" their case between
// departments is pure ownership/routing on the one guest_follow_ups
// row — never a membership, and never a duplicated file. Every hop is
// logged in guest_follow_up_transfers so whoever holds the case next
// (or the pastoral team, always) can see where it's been.
//
// "Delete" (pastoral-team scope only) is a soft delete
// (removed_at/removed_by/removed_reason, sql/saas_platform/94) — cases
// used to vanish for good with no trash and no undo; now they move to
// a separate "Recently Removed" section (same shape
// offeringsBoard.js's own soft-delete already uses) and can be
// restored.
import { confirmDialog } from './confirmDialog.js';
import { createUserCreatorModal } from './userCreatorModal.js';
import { t, departmentLabel } from '../i18n.js';

const STATUSES = ['new_guest', 'contacted', 'assigned_to_department'];

// Mountable render function (the pastoral dashboard's own Guest Cases
// tab mounts this directly) plus a thin modal wrapper around it, same
// split userManager.js's renderUserManager/createUserManagerModal
// already uses.
export function renderGuestOnboardingHub(container, { supabase, currentUserId, scope = { type: 'pastoral' } }) {
  const bodyEl = container;

  let departments = [];
  let followUpOnly = false;
  // Lazily built on first use -- a guest case's captured name/email/
  // phone pre-fills the same "Add User" flow every other account in
  // this app goes through (userCreatorModal.js), rather than a
  // parallel one. Still requires an email before it can actually
  // submit (Supabase auth here is email/password only); a phone-only
  // guest just needs the admin to type one in at that point.
  let userCreatorModal = null;
  function openCreateAccount(row) {
    if (!userCreatorModal) {
      userCreatorModal = createUserCreatorModal({ supabase, scope, currentUserId, onCreated: load });
    }
    userCreatorModal.open({ fullName: row.full_name, email: row.email, phone: row.phone });
  }

  async function load() {
    bodyEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    let leadsQuery = supabase
      .from('guest_follow_ups')
      .select('id, full_name, phone, email, city, referral_source, referred_by_name, age_range, prayer_request, wants_pastor_meeting, home_church, user_id, status, assigned_department_id, notes, source, created_at, follow_up_completed_at, follow_up_completed_by, follow_up_note')
      .is('removed_at', null)
      .order('created_at', { ascending: false });
    if (scope.type === 'department') leadsQuery = leadsQuery.eq('assigned_department_id', scope.departmentId);

    const [{ data: depts }, { data: leads, error: leadsError }, unassignedResult] = await Promise.all([
      supabase.from('departments').select('id, key, name').order('name'),
      leadsQuery,
      scope.type === 'pastoral'
        ? Promise.all([
            supabase.from('profiles').select('id, full_name, created_at, global_role, profile_emails ( email )').is('removed_at', null).order('created_at', { ascending: false }),
            supabase.from('department_memberships').select('user_id'),
          ])
        : Promise.resolve(null),
    ]);

    if (leadsError) {
      bodyEl.innerHTML = `<p class="text-sm text-rose-600">${t('guestHub.loadFailed', { message: leadsError.message })}</p>`;
      return;
    }

    departments = depts || [];

    let rows = leads || [];
    const leadIds = rows.map((r) => r.id);
    const { data: transfers } = leadIds.length > 0
      ? await supabase.from('guest_follow_up_transfers').select('guest_follow_up_id, from_department_id, to_department_id, note, created_at').in('guest_follow_up_id', leadIds).order('created_at')
      : { data: [] };
    const transfersByLead = new Map();
    (transfers || []).forEach((tr) => {
      if (!transfersByLead.has(tr.guest_follow_up_id)) transfersByLead.set(tr.guest_follow_up_id, []);
      transfersByLead.get(tr.guest_follow_up_id).push(tr);
    });

    if (unassignedResult) {
      const [{ data: profiles, error: profilesError }, { data: memberships }] = unassignedResult;
      if (profilesError) {
        bodyEl.innerHTML = `<p class="text-sm text-rose-600">${t('guestHub.loadFailed', { message: profilesError.message })}</p>`;
        return;
      }

      const assignedUserIds = new Set((memberships || []).map((m) => m.user_id));
      const leadUserIds = new Set(rows.filter((l) => l.user_id).map((l) => l.user_id));

      // Unassigned real accounts that don't have a lead row yet — shown
      // as a virtual "new_guest" row; a lead row is only actually
      // created once the pastoral team changes its status (see
      // updateMemberAssignment()). Global-role holders are excluded —
      // they often have zero literal department_memberships by design
      // (their access is church-wide), so they'd otherwise show up here
      // as false "unassigned" leads.
      const unassignedProfiles = (profiles || [])
        .filter((p) => !p.global_role && !assignedUserIds.has(p.id) && !leadUserIds.has(p.id))
        .map((p) => ({
          id: null,
          full_name: p.full_name,
          email: p.profile_emails?.email || null,
          phone: null,
          user_id: p.id,
          status: 'new_guest',
          assigned_department_id: null,
          source: 'signup',
        }));

      rows = [...rows, ...unassignedProfiles];
    }

    const filterWrap = document.createElement('label');
    filterWrap.className = 'flex items-center gap-1.5 text-sm text-slate-600 mb-3';
    filterWrap.innerHTML = `<input type="checkbox" data-el="follow-up-filter" ${followUpOnly ? 'checked' : ''} /> ${t('guestHub.followUpFilterLabel')}`;
    bodyEl.innerHTML = '';
    bodyEl.appendChild(filterWrap);
    filterWrap.querySelector('[data-el="follow-up-filter"]').addEventListener('change', (e) => {
      followUpOnly = e.target.checked;
      load();
    });

    const displayRows = followUpOnly ? rows.filter((r) => r.id !== null && !r.follow_up_completed_at) : rows;

    if (displayRows.length === 0) {
      const emptyEl = document.createElement('p');
      emptyEl.className = 'text-sm text-slate-500';
      emptyEl.textContent = followUpOnly ? t('guestHub.noneNeedFollowUp') : t('guestHub.none');
      bodyEl.appendChild(emptyEl);
      return;
    }

    rows = displayRows;
    const table = document.createElement('table');
    table.className = 'w-full text-sm';
    table.innerHTML = `
      <thead class="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
        <tr>
          <th class="text-left px-4 py-2">${t('guestHub.name')}</th>
          <th class="text-left px-4 py-2">${t('guestHub.source')}</th>
          <th class="text-left px-4 py-2">${t('guestHub.status')}</th>
          <th class="text-left px-4 py-2">${t('guestHub.department')}</th>
          ${scope.type === 'pastoral' ? `<th class="text-left px-4 py-2"></th>` : ''}
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-100"></tbody>
    `;
    const tbody = table.querySelector('tbody');

    rows.forEach((row) => {
      const isGuestLead = row.id !== null;
      const tr = document.createElement('tr');
      const hasDetails = row.phone || row.email || row.city || row.referral_source
        || row.referred_by_name || row.age_range || row.prayer_request || row.wants_pastor_meeting || row.home_church;
      const expandable = isGuestLead || hasDetails;

      const nameCell = document.createElement('td');
      nameCell.className = 'px-4 py-2.5 font-medium whitespace-nowrap';
      if (expandable) {
        const nameBtn = document.createElement('button');
        nameBtn.type = 'button';
        nameBtn.className = 'text-slate-800 hover:text-indigo-600 hover:underline';
        nameBtn.textContent = row.full_name;
        nameBtn.addEventListener('click', () => detailsRow.classList.toggle('hidden'));
        nameCell.appendChild(nameBtn);
      } else {
        nameCell.className += ' text-slate-800';
        nameCell.textContent = row.full_name;
      }
      tr.appendChild(nameCell);

      const sourceCell = document.createElement('td');
      sourceCell.className = 'px-4 py-2.5 text-slate-500';
      sourceCell.textContent = t(`guestHub.source.${row.source || 'manual'}`);
      tr.appendChild(sourceCell);

      const statusCell = document.createElement('td');
      statusCell.className = 'px-4 py-2.5';
      const statusSelect = document.createElement('select');
      statusSelect.className = 'border border-slate-300 rounded-lg px-2 py-1 text-sm';
      statusSelect.innerHTML = STATUSES.map((s) => `<option value="${s}" ${s === row.status ? 'selected' : ''}>${t(`guestHub.status.${s}`)}</option>`).join('');
      statusSelect.addEventListener('change', () => updateLeadFields(row, { status: statusSelect.value }));
      statusCell.appendChild(statusSelect);
      tr.appendChild(statusCell);

      const deptCell = document.createElement('td');
      deptCell.className = 'px-4 py-2.5';
      if (isGuestLead) {
        // A guest has no account — "department" here is who currently
        // owns their case, changed only via Send to Department below,
        // never a plain dropdown (that would skip logging the hop).
        deptCell.textContent = row.assigned_department_id ? departmentLabel(departments.find((d) => d.id === row.assigned_department_id)?.key) : t('guestHub.noDepartment');
      } else {
        const deptSelect = document.createElement('select');
        deptSelect.className = 'border border-slate-300 rounded-lg px-2 py-1 text-sm';
        deptSelect.innerHTML = `<option value="">${t('guestHub.noDepartment')}</option>` +
          departments.map((d) => `<option value="${d.id}" ${d.id === row.assigned_department_id ? 'selected' : ''}>${departmentLabel(d.key)}</option>`).join('');
        deptSelect.addEventListener('change', () => updateMemberAssignment(row, deptSelect.value));
        deptCell.appendChild(deptSelect);
      }
      tr.appendChild(deptCell);

      if (scope.type === 'pastoral') {
        const actionsCell = document.createElement('td');
        actionsCell.className = 'px-4 py-2.5 flex items-center gap-2 flex-wrap';
        if (isGuestLead && !row.user_id) {
          const createAccountBtn = document.createElement('button');
          createAccountBtn.type = 'button';
          createAccountBtn.className = 'text-xs font-medium text-indigo-600 hover:text-indigo-800';
          createAccountBtn.textContent = t('guestHub.createAccount');
          createAccountBtn.addEventListener('click', () => openCreateAccount(row));
          actionsCell.appendChild(createAccountBtn);
        }
        if (isGuestLead) {
          const removeBtn = document.createElement('button');
          removeBtn.type = 'button';
          removeBtn.className = 'text-xs font-medium text-rose-600 hover:text-rose-800';
          removeBtn.textContent = t('guestHub.remove');
          removeBtn.addEventListener('click', () => removeLead(row));
          actionsCell.appendChild(removeBtn);
        }
        tr.appendChild(actionsCell);
      }

      tbody.appendChild(tr);

      let detailsRow;
      if (expandable) {
        detailsRow = document.createElement('tr');
        detailsRow.className = 'hidden bg-slate-50';
        const detailsCell = document.createElement('td');
        detailsCell.colSpan = scope.type === 'pastoral' ? 5 : 4;
        detailsCell.className = 'px-4 py-3 text-sm text-slate-600 space-y-3';

        const fields = [
          [t('guestHub.detail.phone'), row.phone],
          [t('guestHub.detail.email'), row.email],
          [t('guestHub.detail.city'), row.city],
          [t('guestHub.detail.referral'), row.referral_source ? t(`attendance.referral.${row.referral_source}`) : null],
          [t('guestHub.detail.referredBy'), row.referred_by_name],
          [t('guestHub.detail.ageRange'), row.age_range ? t(`attendance.ageRange.${row.age_range}`) : null],
          [t('guestHub.detail.prayerRequest'), row.prayer_request],
          [t('guestHub.detail.wantsPastorMeeting'), row.wants_pastor_meeting ? t('common.yes') : null],
          [t('guestHub.detail.homeChurch'), row.home_church],
        ].filter(([, value]) => value);
        if (fields.length > 0) {
          const fieldsEl = document.createElement('div');
          fieldsEl.innerHTML = fields.map(([label, value]) => `<div><span class="font-medium text-slate-700">${escapeHtml(label)}:</span> ${escapeHtml(value)}</div>`).join('');
          detailsCell.appendChild(fieldsEl);
        }

        if (isGuestLead) {
          const generalNoteEl = document.createElement('div');
          generalNoteEl.innerHTML = `
            <label class="block font-medium text-slate-700 mb-1">${t('guestHub.generalNote')}</label>
            <textarea data-el="general-note" rows="2" placeholder="${t('guestHub.generalNotePlaceholder')}"
                      class="w-full border border-slate-300 rounded-lg px-2 py-1 text-sm mb-1.5">${escapeHtml(row.notes || '')}</textarea>
            <button type="button" data-action="save-general-note" class="text-xs font-medium text-indigo-600 hover:text-indigo-800">${t('guestHub.saveNote')}</button>
            <span data-el="general-note-status" class="text-xs text-slate-500 ml-2"></span>
          `;
          const generalNoteTextarea = generalNoteEl.querySelector('[data-el="general-note"]');
          generalNoteEl.querySelector('[data-action="save-general-note"]').addEventListener('click', () => saveGeneralNote(row, generalNoteTextarea.value.trim(), generalNoteEl));
          detailsCell.appendChild(generalNoteEl);

          const followUpEl = document.createElement('div');
          followUpEl.className = 'border-t border-slate-200 pt-2';
          followUpEl.innerHTML = `
            <div class="font-medium text-slate-700 mb-1">${t('guestHub.followUpTitle')}</div>
            <p class="text-xs ${row.follow_up_completed_at ? 'text-emerald-600' : 'text-amber-600'} mb-1.5">
              ${row.follow_up_completed_at ? t('guestHub.followUpDoneOn', { date: row.follow_up_completed_at.slice(0, 10) }) : t('guestHub.followUpNeeded')}
            </p>
            <textarea data-el="follow-up-note" rows="2" placeholder="${t('guestHub.followUpNotePlaceholder')}"
                      class="w-full border border-slate-300 rounded-lg px-2 py-1 text-sm mb-1.5">${escapeHtml(row.follow_up_note || '')}</textarea>
            <div class="flex gap-2">
              <button type="button" data-action="save-follow-up-note" class="text-xs font-medium text-indigo-600 hover:text-indigo-800">${t('guestHub.saveNote')}</button>
              <button type="button" data-action="toggle-follow-up" class="text-xs font-medium ${row.follow_up_completed_at ? 'text-slate-500 hover:text-slate-700' : 'text-emerald-600 hover:text-emerald-800'}">
                ${row.follow_up_completed_at ? t('guestHub.reopenFollowUp') : t('guestHub.markFollowUpComplete')}
              </button>
            </div>
          `;
          const noteEl = followUpEl.querySelector('[data-el="follow-up-note"]');
          followUpEl.querySelector('[data-action="save-follow-up-note"]').addEventListener('click', () => saveFollowUpNote(row, noteEl.value.trim()));
          followUpEl.querySelector('[data-action="toggle-follow-up"]').addEventListener('click', () => toggleFollowUpComplete(row));
          detailsCell.appendChild(followUpEl);

          const history = transfersByLead.get(row.id) || [];
          if (history.length > 0) {
            const historyEl = document.createElement('div');
            historyEl.innerHTML = `<div class="font-medium text-slate-700 mb-1">${t('guestHub.detail.history')}</div>` +
              history.map((h) => {
                const from = h.from_department_id ? departmentLabel(departments.find((d) => d.id === h.from_department_id)?.key) : t('guestHub.historyIntake');
                const to = departmentLabel(departments.find((d) => d.id === h.to_department_id)?.key);
                return `<div class="text-xs text-slate-500">${escapeHtml(h.created_at.slice(0, 10))} — ${escapeHtml(from)} → ${escapeHtml(to)}${h.note ? ` (${escapeHtml(h.note)})` : ''}</div>`;
              }).join('');
            detailsCell.appendChild(historyEl);
          }

          const transferForm = document.createElement('div');
          transferForm.className = 'border-t border-slate-200 pt-2 flex flex-wrap items-end gap-2';
          transferForm.innerHTML = `
            <div>
              <label class="block text-xs font-medium text-slate-500 mb-1">${t('guestHub.sendToDepartment')}</label>
              <select data-el="transfer-dept" class="border border-slate-300 rounded-lg px-2 py-1 text-sm">
                <option value="">${t('guestHub.selectDepartment')}</option>
                ${departments.filter((d) => d.id !== row.assigned_department_id).map((d) => `<option value="${d.id}">${departmentLabel(d.key)}</option>`).join('')}
              </select>
            </div>
            <div class="flex-1 min-w-[140px]">
              <label class="block text-xs font-medium text-slate-500 mb-1">${t('guestHub.transferNote')}</label>
              <input type="text" data-el="transfer-note" placeholder="${t('guestHub.transferNotePlaceholder')}" class="w-full border border-slate-300 rounded-lg px-2 py-1 text-sm" />
            </div>
            <button type="button" data-action="transfer" class="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">
              ${t('guestHub.send')}
            </button>
          `;
          const transferDeptSelect = transferForm.querySelector('[data-el="transfer-dept"]');
          const transferNoteInput = transferForm.querySelector('[data-el="transfer-note"]');
          transferForm.querySelector('[data-action="transfer"]').addEventListener('click', () => {
            if (!transferDeptSelect.value) return;
            sendToDepartment(row, transferDeptSelect.value, transferNoteInput.value.trim());
          });
          detailsCell.appendChild(transferForm);
        }

        detailsRow.appendChild(detailsCell);
        tbody.appendChild(detailsRow);
      }
    });

    bodyEl.appendChild(table);

    if (scope.type === 'pastoral') await loadRemoved();
  }

  // Soft-deleted cases (sql/saas_platform/94) -- separate section,
  // pastoral-team scope only, same shape offeringsBoard.js's own
  // "Recently Removed" + restore already uses.
  async function loadRemoved() {
    const { data: removed, error } = await supabase
      .from('guest_follow_ups')
      .select('id, full_name, removed_at, removed_reason')
      .not('removed_at', 'is', null)
      .order('removed_at', { ascending: false });

    if (error || !removed || removed.length === 0) return;

    const section = document.createElement('div');
    section.className = 'border-t border-slate-200 mt-4 pt-4';
    section.innerHTML = `
      <h3 class="text-sm font-semibold text-slate-700 mb-2">${t('guestHub.recentlyRemovedTitle')}</h3>
      <div data-el="removed-list" class="space-y-1.5"></div>
    `;
    const removedListEl = section.querySelector('[data-el="removed-list"]');
    removedListEl.innerHTML = removed.map((row) => `
      <div class="flex items-center justify-between gap-2 text-sm" data-row-id="${row.id}">
        <div>
          <span class="text-slate-700">${escapeHtml(row.full_name)}</span>
          ${row.removed_reason ? `<span class="text-xs text-slate-400"> — ${escapeHtml(row.removed_reason)}</span>` : ''}
        </div>
        <button type="button" data-action="restore" class="text-xs font-medium text-indigo-600 hover:text-indigo-800 whitespace-nowrap">${t('guestHub.restore')}</button>
      </div>
    `).join('');
    removedListEl.querySelectorAll('[data-action="restore"]').forEach((btn) => {
      btn.addEventListener('click', () => restoreLead(btn.closest('[data-row-id]').dataset.rowId));
    });

    bodyEl.appendChild(section);
  }

  async function sendToDepartment(row, departmentId, note) {
    const confirmed = await confirmDialog({
      message: t('guestHub.confirmSend', { name: row.full_name, department: departmentLabel(departments.find((d) => d.id === departmentId)?.key) }),
      confirmLabel: t('guestHub.send'),
      danger: false,
    });
    if (!confirmed) return;

    const { error } = await supabase.rpc('transfer_guest_to_department', {
      p_guest_follow_up_id: row.id,
      p_department_id: departmentId,
      p_note: note || null,
    });

    if (error) {
      window.alert(t('guestHub.updateFailed', { message: error.message }));
      return;
    }
    load();
  }

  async function updateLeadFields(row, changes) {
    if (!row.id) return; // status on a virtual unassigned-member row needs a lead row first — see updateMemberAssignment()
    const { error } = await supabase.from('guest_follow_ups')
      .update({ ...changes, updated_at: new Date().toISOString() })
      .eq('id', row.id);

    if (error) {
      window.alert(t('guestHub.updateFailed', { message: error.message }));
      return;
    }
    load();
  }

  // Independent of `status` (routing state, sql/038/041/042) on
  // purpose (sql/saas_platform/97) -- a case can be mid-routing and
  // still need/have a completed follow-up call.
  async function saveGeneralNote(row, note, generalNoteEl) {
    const statusEl = generalNoteEl.querySelector('[data-el="general-note-status"]');
    statusEl.className = 'text-xs text-slate-500 ml-2';
    statusEl.textContent = t('common.saving');
    const { error } = await supabase.from('guest_follow_ups')
      .update({ notes: note || null, updated_at: new Date().toISOString() })
      .eq('id', row.id);
    if (error) {
      statusEl.className = 'text-xs text-rose-600 ml-2';
      statusEl.textContent = t('common.saveFailed', { message: error.message });
      return;
    }
    statusEl.className = 'text-xs text-emerald-600 ml-2';
    statusEl.textContent = t('common.saved');
  }

  async function saveFollowUpNote(row, note) {
    const { error } = await supabase.from('guest_follow_ups')
      .update({ follow_up_note: note || null, updated_at: new Date().toISOString() })
      .eq('id', row.id);
    if (error) {
      window.alert(t('guestHub.updateFailed', { message: error.message }));
      return;
    }
    load();
  }

  async function toggleFollowUpComplete(row) {
    const completing = !row.follow_up_completed_at;
    const { error } = await supabase.from('guest_follow_ups')
      .update(completing
        ? { follow_up_completed_at: new Date().toISOString(), follow_up_completed_by: currentUserId }
        : { follow_up_completed_at: null, follow_up_completed_by: null })
      .eq('id', row.id);
    if (error) {
      window.alert(t('guestHub.updateFailed', { message: error.message }));
      return;
    }
    load();
  }

  // A signed-up-but-unassigned member being put into a department here
  // creates an actual (pending) membership — distinct from a guest
  // visitor's case, which has no account to attach a membership to.
  async function updateMemberAssignment(row, departmentId) {
    if (!departmentId) return;

    const confirmed = await confirmDialog({
      message: t('guestHub.confirmAssign', { name: row.full_name, department: departmentLabel(departments.find((d) => d.id === departmentId)?.key) }),
      confirmLabel: t('guestHub.assign'),
      danger: false,
    });
    if (!confirmed) return;

    if (!row.id) {
      const { error } = await supabase.from('guest_follow_ups').insert({
        full_name: row.full_name,
        email: row.email,
        user_id: row.user_id,
        source: row.source,
        created_by: currentUserId,
        status: 'assigned_to_department',
        assigned_department_id: departmentId,
      });
      if (error) {
        window.alert(t('guestHub.updateFailed', { message: error.message }));
        return;
      }
    } else {
      const { error } = await supabase.from('guest_follow_ups')
        .update({ assigned_department_id: departmentId, status: 'assigned_to_department', updated_at: new Date().toISOString() })
        .eq('id', row.id);
      if (error) {
        window.alert(t('guestHub.updateFailed', { message: error.message }));
        return;
      }
    }

    await supabase.from('department_memberships').insert({
      user_id: row.user_id,
      department_id: departmentId,
      role: 'member',
      status: 'pending',
    });

    load();
  }

  // Soft delete (sql/saas_platform/94) -- recoverable via the
  // "Recently Removed" section above, not a real DELETE (that policy
  // no longer exists on this table at all).
  async function removeLead(row) {
    const reason = await confirmDialog({
      message: t('guestHub.removeConfirm', { name: row.full_name }),
      reasonLabel: t('guestHub.removeReasonLabel'),
      reasonPlaceholder: t('guestHub.removeReasonPlaceholder'),
    });
    if (!reason) return;

    const { error } = await supabase.from('guest_follow_ups').update({
      removed_at: new Date().toISOString(),
      removed_by: currentUserId,
      removed_reason: reason,
    }).eq('id', row.id);
    if (error) {
      window.alert(t('guestHub.removeFailed', { message: error.message }));
      return;
    }
    load();
  }

  async function restoreLead(id) {
    const { error } = await supabase.from('guest_follow_ups')
      .update({ removed_at: null, removed_by: null, removed_reason: null })
      .eq('id', id);
    if (error) {
      window.alert(t('guestHub.restoreFailed', { message: error.message }));
      return;
    }
    load();
  }

  load();
}

export function createGuestOnboardingModal({ supabase, currentUserId, scope = { type: 'pastoral' } }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${t('guestHub.title')}</h2>
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
    renderGuestOnboardingHub(root.querySelector('[data-el="body"]'), { supabase, currentUserId, scope });
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
