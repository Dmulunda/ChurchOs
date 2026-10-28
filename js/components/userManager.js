// Roster/directory table shared by every department's "Users" section
// and the global User Directory. `scope` decides what's loaded and
// which columns make sense:
//   { type: 'department', departmentId, departmentKey } — that
//     department's approved members; department-role is inline-
//     editable (the page only renders this component when the viewer
//     already administers departmentId, so no extra per-row check is
//     needed); "Remove" removes them from *this* department only, not
//     their account.
//   { type: 'global' } — every user, across every department, with a
//     read-only "Departments" badge column (department transfers happen
//     through the Edit modal instead, since a row here can span
//     departments the viewer doesn't administer) and an editable global
//     Access Level column (Super Admin only).
import { createUserCreatorModal } from './userCreatorModal.js';
import { createUserEditModal } from './userEditModal.js';
import { createBulkAddMembersModal } from './bulkAddMembersModal.js';
import { createResetPasswordModal } from './resetPasswordModal.js';
import { confirmDialog } from './confirmDialog.js';
import { reassignAdminDialog } from './reassignAdminDialog.js';
import { openMeetingWindow, navigateMeetingWindow } from './videoMeeting.js';
import { isViewingAs, getGlobalRole } from '../departments.js';
import { extractFunctionErrorMessage } from '../utils/edgeFunctionError.js';
import { t, voicePartLabel, roleLabel, mediaTechRoleLabel } from '../i18n.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DELETION_GRACE_DAYS = 60;

const VOICE_PARTS = ['Leader', 'Soprano', 'Alto', 'Tenor', 'Pianist', 'Bassist', 'Guitarist', 'Drummer'];
const MEDIA_TECH_ROLES = ['stream_operator', 'sound_operator', 'media_inventory', 'camera_operator', 'slides_operator', 'video_content_creator', 'photo_editor'];
const DEPARTMENT_ROLES = ['member', 'secretary', 'admin'];

export function renderUserManager(container, { supabase, scope, currentUserId }) {
  let rows = [];
  let searchQuery = '';
  let showEmail = true;
  let showPhone = true;
  let departmentFilter = '';
  let sortBy = 'name';
  const isGlobalScope = scope.type === 'global';
  const isSuperAdmin = getGlobalRole() === 'super_admin';

  const addUserBtn = isViewingAs() ? '' : `
    <button type="button" data-action="add-user"
            class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 whitespace-nowrap">
      ${t('users.addUser')}
    </button>`;

  // Bulk-add existing tenant members (as opposed to "Add User" above,
  // which creates a brand-new account) -- only makes sense for a
  // single target department, not the global Directory.
  const bulkAddBtn = (!isViewingAs() && scope.type === 'department') ? `
    <button type="button" data-action="bulk-add"
            class="px-4 py-2 rounded-lg border border-indigo-200 text-indigo-600 font-medium hover:bg-indigo-50 whitespace-nowrap">
      ${t('users.bulkAdd')}
    </button>` : '';

  const filterSortControls = isGlobalScope ? `
    <div class="flex flex-wrap items-center gap-3 mb-3">
      <select data-el="department-filter" class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
        <option value="">${t('users.allDepartments')}</option>
        <option value="__none__">${t('users.noDepartment')}</option>
      </select>
      <select data-el="sort-by" class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
        <option value="name">${t('users.sortByName')}</option>
        <option value="accessLevel">${t('users.sortByAccessLevel')}</option>
        <option value="departmentCount">${t('users.sortByDepartmentCount')}</option>
      </select>
    </div>` : '';

  container.innerHTML = `
    <div class="flex flex-wrap items-center gap-3 mb-4">
      <input type="search" data-el="search" placeholder="${t('users.searchPlaceholder')}"
             class="flex-1 min-w-[200px] border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      ${addUserBtn}
      ${bulkAddBtn}
    </div>
    ${filterSortControls}
    <div class="flex flex-wrap items-center gap-4 mb-3 text-sm text-slate-500">
      <span>${t('users.columns')}</span>
      <label class="flex items-center gap-1.5"><input type="checkbox" data-el="toggle-email" checked /> ${t('users.showEmail')}</label>
      <label class="flex items-center gap-1.5"><input type="checkbox" data-el="toggle-phone" checked /> ${t('users.showPhone')}</label>
    </div>
    <span data-el="status" class="text-sm text-slate-500"></span>
    <div data-el="view" class="bg-white rounded-xl shadow overflow-x-auto"></div>
  `;

  const searchEl = container.querySelector('[data-el="search"]');
  const toggleEmailEl = container.querySelector('[data-el="toggle-email"]');
  const togglePhoneEl = container.querySelector('[data-el="toggle-phone"]');
  const departmentFilterEl = container.querySelector('[data-el="department-filter"]');
  const sortByEl = container.querySelector('[data-el="sort-by"]');
  const statusEl = container.querySelector('[data-el="status"]');
  const viewEl = container.querySelector('[data-el="view"]');

  searchEl.addEventListener('input', () => { searchQuery = searchEl.value.trim().toLowerCase(); renderTable(); });
  toggleEmailEl.addEventListener('change', () => { showEmail = toggleEmailEl.checked; renderTable(); });
  togglePhoneEl.addEventListener('change', () => { showPhone = togglePhoneEl.checked; renderTable(); });
  departmentFilterEl?.addEventListener('change', () => { departmentFilter = departmentFilterEl.value; renderTable(); });
  sortByEl?.addEventListener('change', () => { sortBy = sortByEl.value; renderTable(); });

  const editModal = createUserEditModal({ supabase, currentUserId, onSaved: loadUsers });
  const resetPasswordModal = createResetPasswordModal({ supabase });

  if (!isViewingAs()) {
    const creatorModal = createUserCreatorModal({ supabase, scope, currentUserId, onCreated: loadUsers });
    container.querySelector('[data-action="add-user"]').addEventListener('click', () => creatorModal.open());
  }

  if (!isViewingAs() && scope.type === 'department') {
    const bulkAddModal = createBulkAddMembersModal({ supabase, departmentId: scope.departmentId, currentUserId, onAdded: loadUsers });
    container.querySelector('[data-action="bulk-add"]').addEventListener('click', () => bulkAddModal.open());
  }

  loadUsers();

  async function loadUsers() {
    statusEl.textContent = t('users.loading');
    viewEl.innerHTML = '';

    if (scope.type === 'department') {
      const { data, error } = await supabase
        .from('department_memberships')
        .select('id, role, status, user_id, member:profiles!user_id ( id, full_name, phone, address, photo_path, member_title, parish, sex, birth_date, birth_country, birth_city, card_revoked_at, signature_data, voice_parts, media_tech_skills, is_silent, profile_emails ( email ) )')
        .eq('department_id', scope.departmentId)
        .eq('status', 'approved');

      if (error) {
        statusEl.textContent = '';
        viewEl.innerHTML = `<p class="p-4 text-rose-600">${t('users.failedToLoad', { message: error.message })}</p>`;
        return;
      }

      rows = (data || [])
        .filter((r) => r.member)
        .map((r) => ({
          id: r.member.id,
          full_name: r.member.full_name,
          phone: r.member.phone,
          address: r.member.address,
          photo_path: r.member.photo_path,
          member_title: r.member.member_title,
          parish: r.member.parish,
          sex: r.member.sex,
          birth_date: r.member.birth_date,
          birth_country: r.member.birth_country,
          birth_city: r.member.birth_city,
          card_revoked_at: r.member.card_revoked_at,
          signature_data: r.member.signature_data,
          email: r.member.profile_emails?.email,
          voice_parts: r.member.voice_parts,
          media_tech_skills: r.member.media_tech_skills,
          isSilent: r.member.is_silent,
          membershipId: r.id,
          deptRole: r.role,
        }))
        .sort((a, b) => a.full_name.localeCompare(b.full_name));
    } else {
      const [{ data: profiles, error: profilesError }, { data: memberships, error: membershipsError }] = await Promise.all([
        supabase.from('profiles').select('id, full_name, phone, address, photo_path, member_title, parish, sex, birth_date, birth_country, birth_city, card_revoked_at, signature_data, global_role, removed_at, permanently_deleted_at, is_primary_admin, is_school_admin, is_silent, can_view_all_departments, can_manage_pastoral_cases, can_post_global_announcements, can_message_any_member, can_approve_any_membership, profile_emails ( email )').order('full_name'),
        supabase.from('department_memberships').select('user_id, role, status, departments ( key, name )').eq('status', 'approved'),
      ]);

      if (profilesError || membershipsError) {
        statusEl.textContent = '';
        viewEl.innerHTML = `<p class="p-4 text-rose-600">${t('users.failedToLoad', { message: (profilesError || membershipsError).message })}</p>`;
        return;
      }

      const byUser = new Map();
      const departmentOptions = new Map();
      (memberships || []).forEach((m) => {
        if (!m.departments) return;
        if (!byUser.has(m.user_id)) byUser.set(m.user_id, []);
        byUser.get(m.user_id).push({ key: m.departments.key, name: m.departments.name, role: m.role });
        departmentOptions.set(m.departments.key, m.departments.name);
      });

      rows = (profiles || []).map((p) => ({
        id: p.id,
        full_name: p.full_name,
        phone: p.phone,
        address: p.address,
        photo_path: p.photo_path,
        member_title: p.member_title,
        parish: p.parish,
        sex: p.sex,
        birth_country: p.birth_country,
        birth_city: p.birth_city,
        card_revoked_at: p.card_revoked_at,
        signature_data: p.signature_data,
        email: p.profile_emails?.email,
        globalRole: p.global_role,
        removedAt: p.removed_at,
        isPrimaryAdmin: p.is_primary_admin,
        isSchoolAdmin: p.is_school_admin,
        isSilent: p.is_silent,
        can_view_all_departments: p.can_view_all_departments,
        can_manage_pastoral_cases: p.can_manage_pastoral_cases,
        can_post_global_announcements: p.can_post_global_announcements,
        can_message_any_member: p.can_message_any_member,
        can_approve_any_membership: p.can_approve_any_membership,
        permanentlyDeletedAt: p.permanently_deleted_at,
        departments: byUser.get(p.id) || [],
      }));

      if (departmentFilterEl) {
        const currentValue = departmentFilterEl.value;
        const optionsHtml = Array.from(departmentOptions.entries())
          .sort((a, b) => a[1].localeCompare(b[1]))
          .map(([key, name]) => `<option value="${escapeHtml(key)}">${escapeHtml(name)}</option>`)
          .join('');
        departmentFilterEl.innerHTML = `
          <option value="">${t('users.allDepartments')}</option>
          <option value="__none__">${t('users.noDepartment')}</option>
          ${optionsHtml}
        `;
        departmentFilterEl.value = currentValue;
      }
    }

    statusEl.textContent = '';
    renderTable();
  }

  function renderTable() {
    let filtered = searchQuery
      ? rows.filter((r) => r.full_name.toLowerCase().includes(searchQuery) || (r.email || '').toLowerCase().includes(searchQuery))
      : rows;

    if (isGlobalScope && departmentFilter) {
      filtered = departmentFilter === '__none__'
        ? filtered.filter((r) => r.departments.length === 0)
        : filtered.filter((r) => r.departments.some((d) => d.key === departmentFilter));
    }

    if (isGlobalScope && sortBy === 'accessLevel') {
      filtered = [...filtered].sort((a, b) => (a.globalRole || '').localeCompare(b.globalRole || '') || a.full_name.localeCompare(b.full_name));
    } else if (isGlobalScope && sortBy === 'departmentCount') {
      filtered = [...filtered].sort((a, b) => b.departments.length - a.departments.length || a.full_name.localeCompare(b.full_name));
    }

    if (filtered.length === 0) {
      viewEl.innerHTML = `<p class="p-4 text-slate-500">${t('users.noUsers')}</p>`;
      return;
    }

    const isChoir = scope.type === 'department' && scope.departmentKey === 'choir';
    const isMediaTech = scope.type === 'department' && scope.departmentKey === 'media_tech';
    const isGlobal = scope.type === 'global';

    const table = document.createElement('table');
    table.className = 'w-full text-sm';
    table.innerHTML = `
      <thead class="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
        <tr>
          <th class="text-left px-4 py-2">${t('users.name')}</th>
          ${showEmail ? `<th class="text-left px-4 py-2">${t('users.email')}</th>` : ''}
          ${showPhone ? `<th class="text-left px-4 py-2">${t('users.phone')}</th>` : ''}
          ${isChoir ? `<th class="text-left px-4 py-2">${t('users.voicePart')}</th>` : ''}
          ${isMediaTech ? `<th class="text-left px-4 py-2">${t('users.mediaTechSkills')}</th>` : ''}
          ${isGlobal ? `<th class="text-left px-4 py-2">${t('users.departments')}</th><th class="text-left px-4 py-2">${t('users.accessLevel')}</th>` : `<th class="text-left px-4 py-2">${t('users.role')}</th>`}
          <th class="text-left px-4 py-2">${t('users.actions')}</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-100"></tbody>
    `;

    const tbody = table.querySelector('tbody');

    filtered.forEach((row) => {
      const tr = document.createElement('tr');

      const openEdit = () => editModal.open({
        id: row.id,
        full_name: row.full_name,
        phone: row.phone,
        address: row.address,
        photo_path: row.photo_path,
        member_title: row.member_title,
        parish: row.parish,
        sex: row.sex,
        birth_country: row.birth_country,
        birth_city: row.birth_city,
        card_revoked_at: row.card_revoked_at,
        signature_data: row.signature_data,
        profile_emails: { email: row.email },
        global_role: row.globalRole,
        can_view_all_departments: row.can_view_all_departments,
        can_manage_pastoral_cases: row.can_manage_pastoral_cases,
        can_post_global_announcements: row.can_post_global_announcements,
        can_message_any_member: row.can_message_any_member,
        can_approve_any_membership: row.can_approve_any_membership,
      });

      const nameCell = document.createElement('td');
      nameCell.className = 'px-4 py-2.5 whitespace-nowrap';
      const nameBtn = document.createElement('button');
      nameBtn.type = 'button';
      nameBtn.className = 'font-medium text-slate-800 hover:text-indigo-600 hover:underline';
      nameBtn.textContent = row.full_name;
      nameBtn.addEventListener('click', openEdit);
      nameCell.appendChild(nameBtn);
      if (row.isSilent) {
        const silentBadge = document.createElement('span');
        silentBadge.className = 'ml-2 inline-block px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-500 align-middle';
        silentBadge.textContent = t('users.silentBadge');
        nameCell.appendChild(silentBadge);
      }
      if (isGlobal && row.permanentlyDeletedAt) {
        const badge = document.createElement('span');
        badge.className = 'ml-2 inline-block px-2 py-0.5 rounded-full text-xs bg-slate-200 text-slate-600 align-middle';
        badge.textContent = t('users.permanentlyDeletedBadge');
        nameCell.appendChild(badge);
      } else if (isGlobal && row.removedAt) {
        const daysLeft = Math.max(0, DELETION_GRACE_DAYS - Math.floor((Date.now() - new Date(row.removedAt).getTime()) / MS_PER_DAY));
        const badge = document.createElement('span');
        badge.className = 'ml-2 inline-block px-2 py-0.5 rounded-full text-xs bg-rose-100 text-rose-700 align-middle';
        badge.textContent = t('users.deletedBadge', { days: daysLeft });
        nameCell.appendChild(badge);
      }
      tr.appendChild(nameCell);

      if (showEmail) {
        const emailCell = document.createElement('td');
        emailCell.className = 'px-4 py-2.5 text-slate-500 whitespace-nowrap';
        emailCell.textContent = row.email || t('users.emailUnknown');
        tr.appendChild(emailCell);
      }

      if (showPhone) {
        const phoneCell = document.createElement('td');
        phoneCell.className = 'px-4 py-2.5 text-slate-500 whitespace-nowrap';
        phoneCell.textContent = row.phone || t('users.phoneUnknown');
        tr.appendChild(phoneCell);
      }

      if (isChoir) {
        const voicePartCell = document.createElement('td');
        voicePartCell.className = 'px-4 py-2.5';
        const select = document.createElement('select');
        select.multiple = true;
        select.size = Math.min(VOICE_PARTS.length, 5);
        select.className = 'border border-slate-300 rounded-lg px-2 py-1 text-sm';
        select.innerHTML = VOICE_PARTS.map((part) => `<option value="${part}">${voicePartLabel(part)}</option>`).join('');
        const selected = new Set(row.voice_parts || []);
        Array.from(select.options).forEach((opt) => { opt.selected = selected.has(opt.value); });
        select.addEventListener('change', () => updateVoiceParts(row, select));
        voicePartCell.appendChild(select);
        tr.appendChild(voicePartCell);
      }

      if (isMediaTech) {
        const skillsCell = document.createElement('td');
        skillsCell.className = 'px-4 py-2.5';
        const select = document.createElement('select');
        select.multiple = true;
        select.size = Math.min(MEDIA_TECH_ROLES.length, 5);
        select.className = 'border border-slate-300 rounded-lg px-2 py-1 text-sm';
        select.innerHTML = MEDIA_TECH_ROLES.map((role) => `<option value="${role}">${mediaTechRoleLabel(role)}</option>`).join('');
        const selected = new Set(row.media_tech_skills || []);
        Array.from(select.options).forEach((opt) => { opt.selected = selected.has(opt.value); });
        select.addEventListener('change', () => updateMediaTechSkills(row, select));
        skillsCell.appendChild(select);
        tr.appendChild(skillsCell);
      }

      if (isGlobal) {
        const deptsCell = document.createElement('td');
        deptsCell.className = 'px-4 py-2.5';
        deptsCell.innerHTML = row.departments.length === 0
          ? ''
          : row.departments.map((d) => `<span class="inline-block px-2 py-0.5 mb-1 mr-1 rounded-full text-xs bg-slate-100 text-slate-600">${escapeHtml(d.name)} (${roleLabel(d.role)})</span>`).join('');
        tr.appendChild(deptsCell);

        const accessCell = document.createElement('td');
        accessCell.className = 'px-4 py-2.5';
        accessCell.textContent = row.globalRole ? roleLabel(row.globalRole) : '—';
        tr.appendChild(accessCell);
      } else {
        const roleCell = document.createElement('td');
        roleCell.className = 'px-4 py-2.5';
        const select = document.createElement('select');
        select.className = 'border border-slate-300 rounded-lg px-2 py-1 text-sm';
        select.innerHTML = DEPARTMENT_ROLES.map((r) => `<option value="${r}" ${r === row.deptRole ? 'selected' : ''}>${roleLabel(r)}</option>`).join('');
        select.addEventListener('change', () => updateDeptRole(row, select));
        roleCell.appendChild(select);
        tr.appendChild(roleCell);
      }

      const actionsCell = document.createElement('td');
      actionsCell.className = 'px-4 py-2.5';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'text-sm font-medium text-indigo-600 hover:text-indigo-800 whitespace-nowrap block mb-1';
      editBtn.textContent = t('users.edit');
      editBtn.addEventListener('click', openEdit);
      actionsCell.appendChild(editBtn);

      // Only an admin ever reaches this screen for a department scope
      // (the caller gates the "Users" button on canAdminister before
      // rendering it); the global Directory is also open to Super
      // Viewer, so that one needs an explicit isSuperAdmin check.
      if ((scope.type === 'department' || (isGlobal && isSuperAdmin)) && row.id !== currentUserId) {
        const callBtn = document.createElement('button');
        callBtn.type = 'button';
        callBtn.className = 'text-sm font-medium text-emerald-600 hover:text-emerald-800 whitespace-nowrap block mb-1';
        callBtn.textContent = t('users.call');
        callBtn.addEventListener('click', () => startCall(row));
        actionsCell.appendChild(callBtn);
      }

      if (row.email) {
        const resetBtn = document.createElement('button');
        resetBtn.type = 'button';
        resetBtn.className = 'text-sm font-medium text-slate-500 hover:text-slate-700 whitespace-nowrap block mb-1';
        resetBtn.textContent = t('users.sendReset');
        resetBtn.addEventListener('click', () => sendPasswordReset(row, resetBtn));
        actionsCell.appendChild(resetBtn);
      }

      if (isGlobal && isSuperAdmin && !row.permanentlyDeletedAt) {
        if (row.isPrimaryAdmin) {
          const badge = document.createElement('span');
          badge.className = 'text-xs font-medium text-amber-600 block';
          badge.textContent = t('users.primaryAdminBadge');
          actionsCell.appendChild(badge);
        } else {
          const setPrimaryBtn = document.createElement('button');
          setPrimaryBtn.type = 'button';
          setPrimaryBtn.className = 'text-sm font-medium text-amber-600 hover:text-amber-800 whitespace-nowrap block';
          setPrimaryBtn.textContent = t('users.setPrimaryAdmin');
          setPrimaryBtn.addEventListener('click', () => setPrimaryAdmin(row));
          actionsCell.appendChild(setPrimaryBtn);
        }

        // Multiple School Admins are allowed (unlike Primary Admin, which
        // is capped at one) — course authoring benefits from more than
        // one person able to help build/manage the catalog.
        const schoolAdminBtn = document.createElement('button');
        schoolAdminBtn.type = 'button';
        schoolAdminBtn.className = 'text-sm font-medium text-sky-600 hover:text-sky-800 whitespace-nowrap block';
        schoolAdminBtn.textContent = row.isSchoolAdmin ? t('users.removeSchoolAdmin') : t('users.setSchoolAdmin');
        schoolAdminBtn.addEventListener('click', () => toggleSchoolAdmin(row));
        actionsCell.appendChild(schoolAdminBtn);
      }

      if (isGlobal && isSuperAdmin && row.id !== currentUserId && !row.permanentlyDeletedAt) {
        if (row.removedAt) {
          const reinstateBtn = document.createElement('button');
          reinstateBtn.type = 'button';
          reinstateBtn.className = 'text-sm font-medium text-emerald-600 hover:text-emerald-800 whitespace-nowrap block';
          reinstateBtn.textContent = t('users.reinstate');
          reinstateBtn.addEventListener('click', () => reinstateUser(row));
          actionsCell.appendChild(reinstateBtn);
        } else {
          const resetPasswordBtn = document.createElement('button');
          resetPasswordBtn.type = 'button';
          resetPasswordBtn.className = 'text-sm font-medium text-indigo-600 hover:text-indigo-800 whitespace-nowrap block';
          resetPasswordBtn.textContent = t('users.resetPassword');
          resetPasswordBtn.addEventListener('click', () => resetPasswordModal.open(row));
          actionsCell.appendChild(resetPasswordBtn);

          const removeChurchBtn = document.createElement('button');
          removeChurchBtn.type = 'button';
          removeChurchBtn.className = 'text-sm font-medium text-rose-600 hover:text-rose-800 whitespace-nowrap block';
          removeChurchBtn.textContent = t('users.removeFromChurch');
          removeChurchBtn.addEventListener('click', () => removeFromChurch(row));
          actionsCell.appendChild(removeChurchBtn);

          if (!row.isSilent) {
            const moveToSilentBtn = document.createElement('button');
            moveToSilentBtn.type = 'button';
            moveToSilentBtn.className = 'text-sm font-medium text-slate-500 hover:text-slate-700 whitespace-nowrap block';
            moveToSilentBtn.textContent = t('users.moveToSilent');
            moveToSilentBtn.addEventListener('click', () => moveToSilent(row));
            actionsCell.appendChild(moveToSilentBtn);
          }
        }
      }

      if (scope.type === 'department') {
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'text-sm font-medium text-rose-600 hover:text-rose-800 whitespace-nowrap block';
        removeBtn.textContent = t('users.remove');
        removeBtn.addEventListener('click', () => removeFromDepartment(row));
        actionsCell.appendChild(removeBtn);
      }

      tr.appendChild(actionsCell);
      tbody.appendChild(tr);
    });

    viewEl.innerHTML = '';
    viewEl.appendChild(table);
  }

  async function updateVoiceParts(row, selectEl) {
    const newVoiceParts = Array.from(selectEl.selectedOptions).map((opt) => opt.value);
    const { error } = await supabase.from('profiles').update({ voice_parts: newVoiceParts }).eq('id', row.id);
    if (error) {
      window.alert(t('users.roleUpdateFailed', { message: error.message }));
      loadUsers();
      return;
    }
    row.voice_parts = newVoiceParts;
  }

  async function updateMediaTechSkills(row, selectEl) {
    const newSkills = Array.from(selectEl.selectedOptions).map((opt) => opt.value);
    const { error } = await supabase.from('profiles').update({ media_tech_skills: newSkills }).eq('id', row.id);
    if (error) {
      window.alert(t('users.roleUpdateFailed', { message: error.message }));
      loadUsers();
      return;
    }
    row.media_tech_skills = newSkills;
  }

  async function updateDeptRole(row, selectEl) {
    const newRole = selectEl.value;
    const { error } = await supabase.from('department_memberships').update({ role: newRole }).eq('id', row.membershipId);
    if (error) {
      window.alert(t('users.roleUpdateFailed', { message: error.message }));
      loadUsers();
      return;
    }
    row.deptRole = newRole;
  }

  async function removeFromDepartment(row) {
    const departmentLabel = scope.departmentKey ? t(`department.${scope.departmentKey}`) : '';
    const confirmed = await confirmDialog({ message: t('users.confirmRemove', { name: row.full_name, department: departmentLabel }) });
    if (!confirmed) return;

    const { error } = await supabase.from('department_memberships').delete().eq('id', row.membershipId);
    if (error) {
      window.alert(t('users.removeFailed', { message: error.message }));
      return;
    }
    rows = rows.filter((r) => r.id !== row.id);
    renderTable();
  }

  async function removeFromChurch(row) {
    const soleAdminDepartments = await getSoleAdminDepartments(row.id);

    if (soleAdminDepartments.length > 0) {
      const result = await reassignAdminDialog({ targetName: row.full_name, departments: soleAdminDepartments });
      if (!result) return;

      for (const { departmentId, newUserId } of result.reassignments) {
        const { error } = await supabase.rpc('reassign_department_admin', { department_id: departmentId, new_admin_user_id: newUserId });
        if (error) {
          window.alert(t('users.removeFailed', { message: error.message }));
          return;
        }
      }
    } else {
      const confirmed = await confirmDialog({
        title: t('users.confirmRemoveChurchTitle'),
        message: t('users.confirmRemoveChurch', { name: row.full_name }),
        confirmLabel: t('users.removeFromChurch'),
        danger: true,
      });
      if (!confirmed) return;
    }

    const { error } = await supabase.rpc('remove_user_from_church', { target_user_id: row.id });
    if (error) {
      window.alert(t('users.removeFailed', { message: error.message }));
      return;
    }
    loadUsers();
  }

  // Active -> Silent (silentDirectory.js's counterpart to the
  // Promote-to-Active action there). Revokes login (ban, via the
  // downgrade-to-silent Edge Function) rather than deleting anything
  // -- same profile id, full history untouched, reversible.
  async function moveToSilent(row) {
    const confirmed = await confirmDialog({
      title: t('users.confirmMoveToSilentTitle'),
      message: t('users.confirmMoveToSilent', { name: row.full_name }),
      confirmLabel: t('users.moveToSilent'),
      danger: true,
    });
    if (!confirmed) return;

    const { data, error } = await supabase.functions.invoke('downgrade-to-silent', { body: { profile_id: row.id } });
    if (error || data?.error) {
      window.alert(t('users.moveToSilentFailed', { message: error ? await extractFunctionErrorMessage(error) : data.error }));
      return;
    }
    loadUsers();
  }

  // Departments where `userId` is currently the only approved admin —
  // deleting them without reassigning first would leave the department
  // with nobody able to manage it.
  async function getSoleAdminDepartments(userId) {
    const { data: targetAdminRows } = await supabase
      .from('department_memberships')
      .select('department_id, departments ( name )')
      .eq('user_id', userId)
      .eq('role', 'admin')
      .eq('status', 'approved');

    if (!targetAdminRows || targetAdminRows.length === 0) return [];

    const deptIds = targetAdminRows.map((r) => r.department_id);
    const { data: allAdmins } = await supabase
      .from('department_memberships')
      .select('department_id, user_id')
      .in('department_id', deptIds)
      .eq('role', 'admin')
      .eq('status', 'approved');

    const adminCounts = new Map();
    (allAdmins || []).forEach((r) => adminCounts.set(r.department_id, (adminCounts.get(r.department_id) || 0) + 1));

    const soleDeptIds = deptIds.filter((id) => (adminCounts.get(id) || 0) <= 1);
    if (soleDeptIds.length === 0) return [];

    const { data: candidateRows } = await supabase
      .from('department_memberships')
      .select('department_id, user_id, member:profiles!user_id ( full_name )')
      .in('department_id', soleDeptIds)
      .eq('status', 'approved')
      .neq('user_id', userId);

    const candidatesByDept = new Map();
    (candidateRows || []).forEach((r) => {
      if (!candidatesByDept.has(r.department_id)) candidatesByDept.set(r.department_id, []);
      candidatesByDept.get(r.department_id).push({ id: r.user_id, full_name: r.member?.full_name || '—' });
    });

    return targetAdminRows
      .filter((r) => soleDeptIds.includes(r.department_id))
      .map((r) => ({
        id: r.department_id,
        name: r.departments?.name || '',
        candidates: candidatesByDept.get(r.department_id) || [],
      }));
  }

  async function reinstateUser(row) {
    const confirmed = await confirmDialog({
      title: t('users.confirmReinstateTitle'),
      message: t('users.confirmReinstate', { name: row.full_name }),
      confirmLabel: t('users.reinstate'),
      danger: false,
    });
    if (!confirmed) return;

    const { error } = await supabase.rpc('reinstate_user', { target_user_id: row.id });
    if (error) {
      window.alert(t('users.removeFailed', { message: error.message }));
      return;
    }
    loadUsers();
  }

  // The App Suggestion Portal's "routed exclusively to the primary
  // admin" requirement needs exactly one profile flagged — the unique
  // partial index in sql/040 enforces that, so the previous holder has
  // to be cleared first (a single .update({is_primary_admin:false})
  // with no id filter — the RLS UPDATE policy still limits it to rows
  // this Super Admin can already write, which is every profile).
  async function setPrimaryAdmin(row) {
    const confirmed = await confirmDialog({
      message: t('users.confirmSetPrimaryAdmin', { name: row.full_name }),
      confirmLabel: t('users.setPrimaryAdmin'),
      danger: false,
    });
    if (!confirmed) return;

    const { error: clearError } = await supabase.from('profiles').update({ is_primary_admin: false }).eq('is_primary_admin', true);
    if (clearError) {
      window.alert(t('users.updateFailed', { message: clearError.message }));
      return;
    }

    const { error } = await supabase.from('profiles').update({ is_primary_admin: true }).eq('id', row.id);
    if (error) {
      window.alert(t('users.updateFailed', { message: error.message }));
      return;
    }
    loadUsers();
  }

  async function toggleSchoolAdmin(row) {
    const next = !row.isSchoolAdmin;
    const confirmed = await confirmDialog({
      message: t(next ? 'users.confirmSetSchoolAdmin' : 'users.confirmRemoveSchoolAdmin', { name: row.full_name }),
      confirmLabel: t(next ? 'users.setSchoolAdmin' : 'users.removeSchoolAdmin'),
      danger: !next,
    });
    if (!confirmed) return;

    const { error } = await supabase.from('profiles').update({ is_school_admin: next }).eq('id', row.id);
    if (error) {
      window.alert(t('users.updateFailed', { message: error.message }));
      return;
    }
    loadUsers();
  }

  async function sendPasswordReset(row, button) {
    button.disabled = true;
    const { error } = await supabase.auth.resetPasswordForEmail(row.email);
    button.disabled = false;

    if (error) {
      window.alert(t('users.resetFailed', { message: error.message }));
      return;
    }
    window.alert(t('users.resetSent', { name: row.full_name }));
  }

  async function startCall(row) {
    const win = openMeetingWindow();

    const { data: room, error } = await supabase.rpc('start_direct_call', { p_recipient_id: row.id });
    if (error) {
      win?.close();
      window.alert(t('users.callFailed', { message: error.message }));
      return;
    }

    const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', currentUserId).single();
    navigateMeetingWindow(win, { roomName: room, displayName: profile?.full_name || '' });
  }
}

// Pop-up wrapper around renderUserManager — same createXModal({...}) =>
// { open } shape as every other modal in this app, so a "Users" /
// "User Directory" button can open the roster on demand instead of it
// always taking up space on the page. Wider than most modals
// (max-w-4xl) since the roster table has several columns.
export function createUserManagerModal({ supabase, scope, currentUserId, title }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[85vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${title}</h2>
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
    renderUserManager(root.querySelector('[data-el="body"]'), { supabase, scope, currentUserId });
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  // root is exposed (unlike this app's other createXModal helpers) so a
  // caller that re-creates this modal on every render — like Super Admin
  // Home, which re-renders on every View-As/language/department-switch
  // event — can remove the previous instance's DOM node first instead of
  // silently accumulating orphaned hidden modals in the body.
  return { open, root };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
