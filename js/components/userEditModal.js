// "Edit User" modal — full profile editing (name, phone, global access
// level) plus department transfer/attach: add the user to another
// department, change their role within a department they're already in,
// or remove them from one. Same createXModal({ ... }) => { open } shape
// as userCreatorModal.js/viewAsPicker.js, except open() here takes the
// target user so one modal instance can be reused across every row in
// the roster.
import { getMyDepartments, getGlobalRole } from '../departments.js';
import { confirmDialog } from './confirmDialog.js';
import { renderMemberIdCard } from './memberIdCard.js';
import { createSignaturePad } from './signaturePad.js';
import { t, roleLabel } from '../i18n.js';
import { hasFeature } from '../entitlements.js';

// Member Card is a plan-gated feature (sql/saas_platform/86_pricing_v2.sql)
// -- its own data is just ordinary profile columns used elsewhere too,
// so this is a UI-level gate, not a table-level RESTRICTIVE policy.
function renderMemberIdCardGated(container, opts) {
  if (hasFeature('member_card')) {
    renderMemberIdCard(container, opts);
  } else {
    container.innerHTML = `<p class="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3">${t('entitlements.memberCardLocked')}</p>`;
  }
}

const DEPARTMENT_ROLES = ['member', 'secretary', 'admin'];
const ACCESS_LEVELS = ['super_admin', 'super_viewer', 'pastor_admin', 'church_secretary'];
const MEMBER_TITLES = ['pastor_principal', 'department_head', 'member'];
const CUSTOM_POWERS = [
  'can_view_all_departments',
  'can_manage_pastoral_cases',
  'can_post_global_announcements',
  'can_message_any_member',
  'can_approve_any_membership',
];

export function createUserEditModal({ supabase, currentUserId, onSaved }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold" data-el="title"></h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>

      <form data-el="form" class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('userEdit.fullName')}</label>
          <input type="text" name="full_name" required class="w-full border border-slate-300 rounded-lg px-3 py-2" />
        </div>
        <div class="grid sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('userEdit.email')}</label>
            <input type="text" data-el="email" disabled class="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-slate-500" />
            <p class="text-xs text-slate-400 mt-1">${t('userEdit.emailReadOnlyHint')}</p>
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('userEdit.phone')}</label>
            <input type="tel" name="phone" class="w-full border border-slate-300 rounded-lg px-3 py-2" />
          </div>
        </div>
        <div class="grid sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('userEdit.address')}</label>
            <input type="text" name="address" class="w-full border border-slate-300 rounded-lg px-3 py-2" />
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('userEdit.photo')}</label>
            <input type="file" accept="image/*" data-el="photo-input" class="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
          </div>
        </div>
        <div class="grid sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('userEdit.joinedAt')}</label>
            <input type="date" name="joined_at" class="w-full border border-slate-300 rounded-lg px-3 py-2" />
            <p class="text-xs text-slate-400 mt-1">${t('userEdit.joinedAtHint')}</p>
          </div>
        </div>
        <div class="grid sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('memberCard.function')}</label>
            <select name="member_title" class="w-full border border-slate-300 rounded-lg px-3 py-2">
              <option value="">—</option>
              ${MEMBER_TITLES.map((k) => `<option value="${k}">${t(`memberCard.function.${k}`)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('memberCard.parish')}</label>
            <input type="text" name="parish" class="w-full border border-slate-300 rounded-lg px-3 py-2" />
          </div>
        </div>
        <div class="grid sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('memberCard.sex')}</label>
            <select name="sex" class="w-full border border-slate-300 rounded-lg px-3 py-2">
              <option value="">—</option>
              <option value="M">${t('memberCard.male')}</option>
              <option value="F">${t('memberCard.female')}</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('myProfile.birthDate')}</label>
            <input type="date" name="birth_date" class="w-full border border-slate-300 rounded-lg px-3 py-2" />
          </div>
        </div>
        <div class="grid sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('myProfile.birthCountry')}</label>
            <input type="text" name="birth_country" class="w-full border border-slate-300 rounded-lg px-3 py-2" />
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('myProfile.birthCity')}</label>
            <input type="text" name="birth_city" class="w-full border border-slate-300 rounded-lg px-3 py-2" />
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('myProfile.signature')}</label>
          <p class="text-xs text-slate-400 mb-1">${t('userEdit.signatureHint')}</p>
          <canvas data-el="signature-pad" width="360" height="120" class="w-full border border-slate-300 rounded-lg bg-white touch-none" style="max-width:360px;height:120px;"></canvas>
          <button type="button" data-action="clear-signature" class="mt-1 text-xs text-slate-500 hover:text-slate-700 underline">${t('myProfile.clearSignature')}</button>
        </div>
        <div class="flex items-center gap-3 border-t border-slate-200 pt-4">
          <span data-el="revoke-status" class="text-sm font-medium"></span>
          <button type="button" data-action="toggle-revoke" class="px-3 py-1.5 rounded-lg text-sm font-medium"></button>
        </div>
        <div data-el="access-level-wrap" class="hidden">
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('userEdit.accessLevel')}</label>
          <select name="global_role" class="w-full border border-slate-300 rounded-lg px-3 py-2">
            <option value="">${t('userCreator.accessLevelNone')}</option>
            ${ACCESS_LEVELS.map((r) => `<option value="${r}">${roleLabel(r)}</option>`).join('')}
          </select>
        </div>

        <div data-el="custom-powers-wrap" class="hidden border-t border-slate-200 pt-4">
          <p class="text-sm font-medium text-slate-600 mb-1">${t('userEdit.customAccessTitle')}</p>
          <p class="text-xs text-slate-400 mb-2">${t('userEdit.customAccessHint')}</p>
          <button type="button" data-action="apply-technical-helper-preset"
                  class="mb-2 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs font-medium hover:bg-slate-200">
            ${t('userEdit.technicalHelperPreset')}
          </button>
          <p class="text-xs text-slate-400 mb-2">${t('userEdit.technicalHelperPresetHint')}</p>
          <div class="space-y-1.5">
            ${CUSTOM_POWERS.map((key) => `
              <label class="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" name="${key}" class="rounded border-slate-300" />
                ${t(`userEdit.${toCamel(key)}`)}
              </label>
            `).join('')}
          </div>
        </div>

        <p data-el="form-status" class="text-sm"></p>

        <div class="flex justify-end gap-2 pt-2 border-b border-slate-200 pb-4">
          <button type="button" data-action="close" class="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100">${t('common.cancel')}</button>
          <button type="submit" data-el="save-btn" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
            ${t('userEdit.save')}
          </button>
        </div>
      </form>

      <div class="pt-4 border-b border-slate-200 pb-4 mb-4">
        <h3 class="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-2">${t('userEdit.idCardTitle')}</h3>
        <div data-el="id-card-container"></div>
      </div>

      <div class="pt-4">
        <h3 class="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-2">${t('userEdit.departmentsTitle')}</h3>
        <div data-el="memberships" class="space-y-2 mb-3"></div>
        <div class="flex items-center gap-2">
          <select data-el="add-dept-select" class="flex-1 border border-slate-300 rounded-lg px-2 py-1.5 text-sm"></select>
          <select data-el="add-dept-role" class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
            ${DEPARTMENT_ROLES.map((r) => `<option value="${r}">${roleLabel(r)}</option>`).join('')}
          </select>
          <button type="button" data-action="add-dept" class="px-3 py-1.5 rounded-lg bg-slate-700 text-white text-sm font-medium hover:bg-slate-800">
            ${t('userEdit.addDepartment')}
          </button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const titleEl = root.querySelector('[data-el="title"]');
  const form = root.querySelector('[data-el="form"]');
  const emailEl = root.querySelector('[data-el="email"]');
  const accessLevelWrapEl = root.querySelector('[data-el="access-level-wrap"]');
  const customPowersWrapEl = root.querySelector('[data-el="custom-powers-wrap"]');
  const formStatusEl = root.querySelector('[data-el="form-status"]');
  const saveBtn = root.querySelector('[data-el="save-btn"]');
  const membershipsEl = root.querySelector('[data-el="memberships"]');
  const idCardContainerEl = root.querySelector('[data-el="id-card-container"]');
  const addDeptSelectEl = root.querySelector('[data-el="add-dept-select"]');
  const addDeptRoleEl = root.querySelector('[data-el="add-dept-role"]');
  const revokeStatusEl = root.querySelector('[data-el="revoke-status"]');
  const toggleRevokeBtn = root.querySelector('[data-action="toggle-revoke"]');
  const signaturePad = createSignaturePad(root.querySelector('[data-el="signature-pad"]'));

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  root.querySelector('[data-action="add-dept"]').addEventListener('click', addDepartment);
  root.querySelector('[data-action="clear-signature"]').addEventListener('click', () => signaturePad.clear());
  toggleRevokeBtn.addEventListener('click', toggleRevoke);
  // Fills in the checkboxes only — still needs Save, same as manually
  // checking each box, so nothing changes until the admin reviews and
  // confirms it like any other edit here.
  root.querySelector('[data-action="apply-technical-helper-preset"]').addEventListener('click', () => {
    form.elements.can_view_all_departments.checked = true;
    form.elements.can_approve_any_membership.checked = true;
    form.elements.can_manage_pastoral_cases.checked = false;
  });
  form.addEventListener('submit', handleSubmit);

  let targetUser = null;
  let allDepartments = [];
  let memberships = [];
  let cardRevokedAt = null;

  // getGlobalRole() reads the real, unfiltered role directly — unlike
  // getMyDepartments(), it isn't affected by Standard User Mode or
  // View-As, and it's populated from a live query over every
  // department (sql/059's Create Department tool included), so a
  // brand-new department with no members yet is never a blind spot
  // here the way it could be relying on the synthesized list.
  function canApprove(deptId) {
    const role = getGlobalRole();
    if (role === 'super_admin' || role === 'pastor_admin') return true;
    const mine = getMyDepartments().find((d) => d.id === deptId);
    return mine?.role === 'admin';
  }

  async function loadDepartmentsAndMemberships() {
    const [{ data: departments }, { data: rows }] = await Promise.all([
      supabase.from('departments').select('id, key, name').order('name'),
      supabase
        .from('department_memberships')
        .select('id, role, status, department_id, departments ( id, key, name )')
        .eq('user_id', targetUser.id),
    ]);

    allDepartments = departments || [];
    memberships = (rows || []).filter((r) => r.departments);
    renderMemberships();
    renderAddDeptSelect();
  }

  function renderMemberships() {
    if (memberships.length === 0) {
      membershipsEl.innerHTML = '';
      return;
    }

    membershipsEl.innerHTML = memberships.map((m) => {
      const approvable = canApprove(m.department_id);
      return `
        <div class="flex items-center gap-2 border border-slate-200 rounded-lg p-2" data-membership-row="${m.id}">
          <span class="flex-1 text-sm">${escapeHtml(m.departments.name)}</span>
          ${m.status === 'pending' ? `<span class="text-xs font-medium text-amber-600">${t('users.pending')}</span>` : ''}
          <select data-el="role-select" class="border border-slate-300 rounded-lg px-2 py-1 text-sm" ${approvable ? '' : 'disabled'}>
            ${DEPARTMENT_ROLES.map((r) => `<option value="${r}" ${r === m.role ? 'selected' : ''}>${roleLabel(r)}</option>`).join('')}
          </select>
          <button type="button" data-action="remove-membership"
                  class="text-sm font-medium text-rose-600 hover:text-rose-800 disabled:opacity-40" ${approvable ? '' : 'disabled'}>
            ${t('userEdit.removeDepartment')}
          </button>
        </div>
      `;
    }).join('');

    membershipsEl.querySelectorAll('[data-membership-row]').forEach((row) => {
      const membershipId = row.dataset.membershipRow;
      const membership = memberships.find((m) => m.id === membershipId);
      row.querySelector('[data-el="role-select"]').addEventListener('change', (e) => updateRole(membership, e.target.value));
      row.querySelector('[data-action="remove-membership"]').addEventListener('click', () => removeMembership(membership));
    });
  }

  function renderAddDeptSelect() {
    const assignedIds = new Set(memberships.map((m) => m.department_id));
    const available = allDepartments.filter((d) => !assignedIds.has(d.id));
    addDeptSelectEl.innerHTML = available.length === 0
      ? `<option value="">${t('userEdit.selectDepartmentPlaceholder')}</option>`
      : available.map((d) => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('');
  }

  async function updateRole(membership, newRole) {
    const { error } = await supabase.from('department_memberships').update({ role: newRole }).eq('id', membership.id);
    if (error) {
      window.alert(t('userEdit.roleUpdateFailed', { message: error.message }));
      renderMemberships();
      return;
    }
    membership.role = newRole;
  }

  async function removeMembership(membership) {
    const confirmed = await confirmDialog({
      message: t('userEdit.confirmRemoveDepartment', {
        name: targetUser.full_name,
        department: membership.departments.name,
      }),
    });
    if (!confirmed) return;

    const { error } = await supabase.from('department_memberships').delete().eq('id', membership.id);
    if (error) {
      window.alert(t('userEdit.removeDepartmentFailed', { message: error.message }));
      return;
    }
    memberships = memberships.filter((m) => m.id !== membership.id);
    renderMemberships();
    renderAddDeptSelect();
  }

  async function addDepartment() {
    const departmentId = addDeptSelectEl.value;
    if (!departmentId) return;

    const approved = canApprove(departmentId);
    // A pending (not-yet-approved) row can only ever be role 'member'
    // (sql/021's insert policy enforces this too) — a role someone
    // picked before it's actually approved would just fail the insert,
    // so it's forced back to 'member' here instead.
    const role = approved ? addDeptRoleEl.value : 'member';
    const { data, error } = await supabase
      .from('department_memberships')
      .insert({
        user_id: targetUser.id,
        department_id: departmentId,
        role,
        status: approved ? 'approved' : 'pending',
        ...(approved ? { approved_at: new Date().toISOString(), approved_by: currentUserId } : {}),
      })
      .select('id, role, status, department_id, departments ( id, key, name )')
      .single();

    if (error) {
      window.alert(t('userEdit.addDepartmentFailed', { message: error.message }));
      return;
    }

    memberships.push(data);
    renderMemberships();
    renderAddDeptSelect();
    addDeptRoleEl.value = 'member';
  }

  // Reinstating resets card_issued_at to today — a clean fresh 2-year
  // clock, same as a physical card actually being reissued, rather
  // than a revoked-then-reinstated card silently keeping its old
  // (possibly already-expired) issue date.
  async function toggleRevoke() {
    const revoking = !cardRevokedAt;
    const confirmed = await confirmDialog({
      message: t(revoking ? 'userEdit.confirmRevoke' : 'userEdit.confirmReinstate', { name: targetUser.full_name }),
      danger: revoking,
    });
    if (!confirmed) return;

    const update = revoking
      ? { card_revoked_at: new Date().toISOString() }
      : { card_revoked_at: null, card_issued_at: new Date().toISOString().slice(0, 10) };

    const { error } = await supabase.from('profiles').update(update).eq('id', targetUser.id);
    if (error) {
      window.alert(t('userEdit.saveFailed', { message: error.message }));
      return;
    }

    cardRevokedAt = update.card_revoked_at;
    renderRevokeUi();
    renderMemberIdCardGated(idCardContainerEl, { supabase, userId: targetUser.id });
  }

  function renderRevokeUi() {
    if (cardRevokedAt) {
      revokeStatusEl.className = 'text-sm font-medium text-rose-600';
      revokeStatusEl.textContent = t('userEdit.cardRevoked');
      toggleRevokeBtn.className = 'px-3 py-1.5 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700';
      toggleRevokeBtn.textContent = t('userEdit.reinstateCard');
    } else {
      revokeStatusEl.className = 'text-sm font-medium text-emerald-600';
      revokeStatusEl.textContent = t('userEdit.cardActive');
      toggleRevokeBtn.className = 'px-3 py-1.5 rounded-lg text-sm font-medium bg-rose-600 text-white hover:bg-rose-700';
      toggleRevokeBtn.textContent = t('userEdit.revokeCard');
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const fullName = form.elements.full_name.value.trim();
    const phone = form.elements.phone.value.trim() || null;
    const globalRole = form.elements.global_role ? (form.elements.global_role.value || null) : undefined;

    if (!fullName) return;

    saveBtn.disabled = true;
    formStatusEl.className = 'text-sm text-slate-500';
    formStatusEl.textContent = t('userEdit.saving');

    const update = {
      full_name: fullName,
      phone,
      address: form.elements.address.value.trim() || null,
      member_title: form.elements.member_title.value || null,
      parish: form.elements.parish.value.trim() || null,
      sex: form.elements.sex.value || null,
      birth_date: form.elements.birth_date.value || null,
      birth_country: form.elements.birth_country.value.trim() || null,
      birth_city: form.elements.birth_city.value.trim() || null,
      signature_data: signaturePad.isEmpty() ? null : signaturePad.toDataUrl(),
    };
    // joined_at is not-null on the table -- only sent when the admin
    // actually set a value, so clearing the date field leaves whatever
    // was already on file untouched instead of trying to null it out.
    if (form.elements.joined_at.value) update.joined_at = form.elements.joined_at.value;
    if (globalRole !== undefined) update.global_role = globalRole;
    if (form.elements[CUSTOM_POWERS[0]]) {
      CUSTOM_POWERS.forEach((key) => { update[key] = form.elements[key].checked; });
    }

    const photoFile = form.elements['photo-input']?.files?.[0];
    if (photoFile) {
      const path = `${targetUser.id}/${Date.now()}-${photoFile.name}`;
      const { error: uploadError } = await supabase.storage.from('member-photos').upload(path, photoFile);
      if (uploadError) {
        saveBtn.disabled = false;
        formStatusEl.className = 'text-sm text-rose-600';
        formStatusEl.textContent = t('userEdit.saveFailed', { message: uploadError.message });
        return;
      }
      update.photo_path = path;
    }

    const { error } = await supabase.from('profiles').update(update).eq('id', targetUser.id);

    saveBtn.disabled = false;
    if (error) {
      formStatusEl.className = 'text-sm text-rose-600';
      formStatusEl.textContent = t('userEdit.saveFailed', { message: error.message });
      return;
    }

    formStatusEl.className = 'text-sm text-emerald-600';
    formStatusEl.textContent = t('userEdit.saved');
    form.querySelector('[data-el="photo-input"]').value = '';
    renderMemberIdCardGated(idCardContainerEl, { supabase, userId: targetUser.id });
    onSaved?.();
  }

  function open(user) {
    targetUser = user;
    titleEl.textContent = t('userEdit.title', { name: user.full_name });
    form.elements.full_name.value = user.full_name || '';
    form.elements.phone.value = user.phone || '';
    form.elements.joined_at.value = user.joined_at || '';
    form.elements.address.value = user.address || '';
    form.elements.member_title.value = user.member_title || '';
    form.elements.parish.value = user.parish || '';
    form.elements.sex.value = user.sex || '';
    form.elements.birth_date.value = user.birth_date || '';
    form.elements.birth_country.value = user.birth_country || '';
    form.elements.birth_city.value = user.birth_city || '';
    signaturePad.clear();
    signaturePad.loadFromDataUrl(user.signature_data);
    cardRevokedAt = user.card_revoked_at || null;
    renderRevokeUi();
    emailEl.value = user.profile_emails?.email || t('users.emailUnknown');
    renderMemberIdCardGated(idCardContainerEl, { supabase, userId: user.id });
    if (form.elements.global_role) form.elements.global_role.value = user.global_role || '';
    const isSuperAdmin = getGlobalRole() === 'super_admin';
    accessLevelWrapEl.classList.toggle('hidden', !isSuperAdmin);
    customPowersWrapEl.classList.toggle('hidden', !isSuperAdmin);
    CUSTOM_POWERS.forEach((key) => { if (form.elements[key]) form.elements[key].checked = !!user[key]; });
    formStatusEl.textContent = '';
    root.classList.remove('hidden');
    root.classList.add('flex');
    loadDepartmentsAndMemberships();
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  return { open };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function toCamel(snake) {
  return snake.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}
