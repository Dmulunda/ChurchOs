// "Add User" modal — creates a real Supabase Auth account for a new
// person via a throwaway client (so it doesn't touch the admin's own
// session — signUp() would otherwise sign the admin out and the new
// user in), then assigns phone/departments/roles/access level with the
// admin's own client. Modeled on the old memberCreatorModal.js's
// create-and-return-{open} pattern, generalized across departments.
//
// Departments the creator can't approve (per can_approve_department_
// membership() in sql/021) are only ever assignable as role='member',
// landing status='pending' — the department's real admin (or a Super
// Admin / Pastor Admin) has to approve it. The RLS insert policy in
// sql/021/022 enforces this regardless of what the client sends; the UI
// just predicts it up front so the admin isn't surprised.
import { createScopedClient } from '../supabaseClient.js';
import { getMyDepartments, getGlobalRole } from '../departments.js';
import { getTenantId } from '../tenant.js';
import { confirmDialog } from './confirmDialog.js';
import { extractFunctionErrorMessage } from '../utils/edgeFunctionError.js';
import { t, roleLabel } from '../i18n.js';

const DEPARTMENT_ROLES = ['member', 'secretary', 'admin'];
const ACCESS_LEVELS = ['super_admin', 'super_viewer', 'pastor_admin', 'church_secretary'];

export function createUserCreatorModal({ supabase, scope, currentUserId, onCreated }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-2">
        <h2 class="text-xl font-bold">${t('userCreator.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <p class="text-xs text-slate-500 mb-4">${t('userCreator.intro')}</p>

      <form data-el="form" class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('userCreator.fullName')}</label>
          <input type="text" name="full_name" required class="w-full border border-slate-300 rounded-lg px-3 py-2" />
        </div>

        <label class="flex items-start gap-2 text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3">
          <input type="checkbox" data-el="silent-toggle" class="mt-0.5" />
          <span>
            <span class="font-medium">${t('userCreator.silentToggle')}</span>
            <br /><span class="text-xs text-slate-500">${t('userCreator.silentToggleHint')}</span>
          </span>
        </label>

        <div class="grid sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('userCreator.email')}</label>
            <input type="email" name="email" required class="w-full border border-slate-300 rounded-lg px-3 py-2" />
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('userCreator.phone')}</label>
            <input type="tel" name="phone" class="w-full border border-slate-300 rounded-lg px-3 py-2" />
          </div>
        </div>
        <div data-el="password-field">
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('userCreator.password')}</label>
          <div class="flex gap-2">
            <input type="text" name="password" required minlength="6"
                   class="flex-1 border border-slate-300 rounded-lg px-3 py-2 font-mono" />
            <button type="button" data-action="generate-password"
                    class="px-3 py-2 rounded-lg bg-slate-700 text-white text-sm font-medium hover:bg-slate-800 whitespace-nowrap">
              ${t('userCreator.generatePassword')}
            </button>
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('userCreator.departments')}</label>
          <div data-el="departments" class="space-y-2 border border-slate-200 rounded-lg p-3"></div>
        </div>
        <div data-el="access-level-wrap" class="hidden">
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('userCreator.accessLevel')}</label>
          <select name="global_role" class="w-full border border-slate-300 rounded-lg px-3 py-2">
            <option value="">${t('userCreator.accessLevelNone')}</option>
            ${ACCESS_LEVELS.map((r) => `<option value="${r}">${roleLabel(r)}</option>`).join('')}
          </select>
        </div>

        <p data-el="form-status" class="text-sm"></p>

        <div class="flex justify-end gap-2 pt-2">
          <button type="button" data-action="close" class="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100">${t('common.cancel')}</button>
          <button type="submit" data-el="save-btn" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
            ${t('userCreator.save')}
          </button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(root);

  const form = root.querySelector('[data-el="form"]');
  const departmentsEl = root.querySelector('[data-el="departments"]');
  const accessLevelWrapEl = root.querySelector('[data-el="access-level-wrap"]');
  const formStatusEl = root.querySelector('[data-el="form-status"]');
  const saveBtn = root.querySelector('[data-el="save-btn"]');
  const silentToggleEl = root.querySelector('[data-el="silent-toggle"]');
  const passwordFieldEl = root.querySelector('[data-el="password-field"]');

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  root.querySelector('[data-action="generate-password"]').addEventListener('click', () => {
    form.elements.password.value = generateTempPassword();
  });
  // No login yet -- no password to set, and a global access level
  // (super_admin etc.) is meaningless for someone who can't sign in.
  silentToggleEl.addEventListener('change', () => {
    const silent = silentToggleEl.checked;
    passwordFieldEl.classList.toggle('hidden', silent);
    form.elements.password.required = !silent;
    form.elements.email.required = !silent;
    if (silent) accessLevelWrapEl.classList.add('hidden');
    else accessLevelWrapEl.classList.toggle('hidden', getGlobalRole() !== 'super_admin');
  });
  form.addEventListener('submit', handleSubmit);

  let departments = [];

  async function loadDepartments() {
    const { data } = await supabase.from('departments').select('id, key, name').order('name');
    departments = data || [];

    const myDepartments = getMyDepartments();
    const canApprove = (deptId) => {
      const mine = myDepartments.find((d) => d.id === deptId);
      return mine?.role === 'admin' || mine?.role === 'super_admin' || mine?.role === 'pastor_admin';
    };

    departmentsEl.innerHTML = departments.map((dept) => {
      const approvable = canApprove(dept.id);
      const preChecked = scope.type === 'department' && dept.id === scope.departmentId;
      return `
        <div class="flex items-center gap-2" data-dept-row="${dept.id}">
          <input type="checkbox" data-el="dept-checkbox" value="${dept.id}" id="dept-${dept.id}"
                 ${preChecked ? 'checked disabled' : ''} />
          <label for="dept-${dept.id}" class="flex-1 text-sm">${escapeHtml(dept.name)}</label>
          <select data-el="dept-role" data-dept-id="${dept.id}"
                  class="border border-slate-300 rounded-lg px-2 py-1 text-sm ${preChecked ? '' : 'hidden'}"
                  ${approvable ? '' : 'disabled'}>
            ${DEPARTMENT_ROLES.map((r) => `<option value="${r}">${roleLabel(r)}</option>`).join('')}
          </select>
          ${approvable ? '' : `<span class="text-xs text-amber-600 ${preChecked ? '' : 'hidden'}" data-el="pending-hint">${t('userCreator.pendingHint')}</span>`}
        </div>
      `;
    }).join('');

    departmentsEl.querySelectorAll('[data-el="dept-checkbox"]').forEach((cb) => {
      cb.addEventListener('change', () => {
        const row = cb.closest('[data-dept-row]');
        row.querySelector('[data-el="dept-role"]')?.classList.toggle('hidden', !cb.checked);
        row.querySelector('[data-el="pending-hint"]')?.classList.toggle('hidden', !cb.checked);
      });
    });

    accessLevelWrapEl.classList.toggle('hidden', getGlobalRole() !== 'super_admin');
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const isSilent = silentToggleEl.checked;
    const fullName = form.elements.full_name.value.trim();
    const email = form.elements.email.value.trim();
    const phone = form.elements.phone.value.trim() || null;
    const password = form.elements.password.value;
    const globalRole = form.elements.global_role ? (form.elements.global_role.value || null) : null;

    const selectedDeptRows = Array.from(departmentsEl.querySelectorAll('[data-el="dept-checkbox"]:checked'))
      .map((cb) => {
        const deptId = cb.value;
        const roleSelect = departmentsEl.querySelector(`[data-el="dept-role"][data-dept-id="${deptId}"]`);
        return { departmentId: deptId, role: roleSelect.disabled ? 'member' : roleSelect.value };
      });

    if (!fullName || (!isSilent && !email) || (!isSilent && !password)) {
      formStatusEl.className = 'text-sm text-rose-600';
      formStatusEl.textContent = t('userCreator.missingFields');
      return;
    }
    if (!isSilent && password.length < 6) {
      formStatusEl.className = 'text-sm text-rose-600';
      formStatusEl.textContent = t('userCreator.passwordTooShort');
      return;
    }
    if (selectedDeptRows.length === 0) {
      formStatusEl.className = 'text-sm text-rose-600';
      formStatusEl.textContent = t('userCreator.noDepartmentSelected');
      return;
    }

    if (!(await confirmDialog({ message: t('userCreator.confirmCreate', { name: fullName }), confirmLabel: t('userCreator.save'), danger: false }))) return;

    saveBtn.disabled = true;
    formStatusEl.className = 'text-sm text-slate-500';
    formStatusEl.textContent = t('userCreator.creating');

    let newUserId;
    let profileError = null;

    if (isSilent) {
      const { data, error } = await supabase.functions.invoke('create-silent-user', {
        body: { full_name: fullName, email: email || undefined, phone: phone || undefined },
      });
      if (error) {
        formStatusEl.className = 'text-sm text-rose-600';
        formStatusEl.textContent = t('userCreator.failedToCreate', { message: await extractFunctionErrorMessage(error) });
        saveBtn.disabled = false;
        return;
      }
      newUserId = data.profile_id;
      if (globalRole) {
        const { error: roleError } = await supabase.from('profiles').update({ global_role: globalRole }).eq('id', newUserId);
        profileError = roleError;
      }
    } else {
      const scopedClient = createScopedClient();
      const { data, error } = await scopedClient.auth.signUp({
        email,
        password,
        // tenant_id must travel in here -- handle_new_user() (the trigger
        // that creates the profiles row) reads it from raw_user_meta_data,
        // since it has no other way to know which church this account
        // belongs to. Without it the insert fails outright (tenant_id is
        // NOT NULL). The creating admin's own tenant is always the right
        // one here -- there's no path in this modal for a Super Admin to
        // create an account in a church other than their own.
        options: { data: { full_name: fullName, tenant_id: getTenantId() } },
      });

      // Supabase's anti-enumeration behavior: signing up with an email that's
      // already registered can return a fake user with no identities instead
      // of an error.
      const alreadyRegistered = !error && data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0;

      if (error || alreadyRegistered) {
        formStatusEl.className = 'text-sm text-rose-600';
        formStatusEl.textContent = alreadyRegistered
          ? t('userCreator.emailAlreadyRegistered')
          : t('userCreator.failedToCreate', { message: error.message });
        saveBtn.disabled = false;
        return;
      }

      newUserId = data.user.id;
      const profileUpdate = { phone };
      if (globalRole) profileUpdate.global_role = globalRole;
      const { error: updateError } = await supabase.from('profiles').update(profileUpdate).eq('id', newUserId);
      profileError = updateError;
    }

    const myDepartments = getMyDepartments();
    const canApprove = (deptId) => {
      const mine = myDepartments.find((d) => d.id === deptId);
      return mine?.role === 'admin' || mine?.role === 'super_admin' || mine?.role === 'pastor_admin';
    };

    const membershipRows = selectedDeptRows.map(({ departmentId, role }) => {
      const approved = canApprove(departmentId);
      return {
        user_id: newUserId,
        department_id: departmentId,
        role: approved ? role : 'member',
        status: approved ? 'approved' : 'pending',
        ...(approved ? { approved_at: new Date().toISOString(), approved_by: currentUserId } : {}),
      };
    });

    const { error: membershipError } = await supabase.from('department_memberships').insert(membershipRows);

    if (profileError || membershipError) {
      formStatusEl.className = 'text-sm text-amber-600';
      formStatusEl.textContent = t('userCreator.roleAssignFailed', { message: (profileError || membershipError).message });
      saveBtn.disabled = false;
      onCreated?.();
      return;
    }

    saveBtn.disabled = false;
    formStatusEl.className = 'text-sm text-emerald-600';
    formStatusEl.textContent = isSilent
      ? t('userCreator.silentSuccess', { name: fullName })
      : t('userCreator.success', { name: fullName, password });
    onCreated?.();
  }

  function generateTempPassword() {
    const bytes = new Uint8Array(9);
    window.crypto.getRandomValues(bytes);
    return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '').slice(0, 12);
  }

  // prefill lets a caller (e.g. "Create Account" on a Guest Case,
  // which already has the person's name/email/phone captured at
  // intake) start the form with those fields filled in but still
  // fully editable -- every other field (password, departments)
  // still needs the admin's own input same as today.
  function open(prefill = {}) {
    form.reset();
    if (prefill.fullName) form.elements.full_name.value = prefill.fullName;
    if (prefill.email) form.elements.email.value = prefill.email;
    if (prefill.phone) form.elements.phone.value = prefill.phone;
    passwordFieldEl.classList.remove('hidden');
    form.elements.password.required = true;
    form.elements.email.required = true;
    formStatusEl.textContent = '';
    root.classList.remove('hidden');
    root.classList.add('flex');
    loadDepartments();
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
