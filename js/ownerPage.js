// Platform Owner panel -- reached three ways: its own standalone page
// (tools-menu "Owner" entry), as a tab inside Site Admin (for whoever
// holds both roles, see js/siteAdminPage.js), and embedded directly on
// the trial-ended lockout screen (js/app.js's showTrialEnded()) so the
// owner can fix their own (or anyone's) trial/plan without getting
// stuck behind the very screen they're previewing. Visible only to
// accounts in public.platform_owner (see js/platformOwner.js, sql/083).
// Lets the owner manually set any tenant's plan without Stripe -- to
// comp a partner church for free, or to preview Basic/Pro/Premium on
// their own account by applying a plan to themselves the same way --
// and move a tenant's trial end date, including their own, to preview
// exactly what a trial-expired user sees.
import { t } from './i18n.js';
import { supabase } from './supabaseClient.js';
import { getTenantId } from './tenant.js';
import { loadMyEntitlements } from './entitlements.js';
import { renderEntitlementGates } from './app.js';

const PLAN_KEYS = ['basic', 'pro', 'premium'];

// container defaults to the standalone page's own element -- other
// call sites pass their own element instead. onOwnTenantChanged (if
// given) fires, IN ADDITION to the usual live entitlement refresh
// below, whenever the OWNER's own tenant's plan or trial end was just
// changed -- the lockout screen uses it to actually re-run showApp()'s
// trial-status check (entitlements alone wouldn't escape that screen),
// the other two call sites simply don't pass it.
export async function renderOwnerTab(container = document.querySelector('#owner-content'), { onOwnTenantChanged } = {}) {
  container.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;

  const { data: tenants, error } = await supabase.rpc('owner_list_tenants');
  if (error) {
    container.innerHTML = `<p class="text-rose-600">${t('owner.loadFailed', { message: error.message })}</p>`;
    return;
  }

  const myTenantId = getTenantId?.() || null;

  container.innerHTML = `
    <div class="bg-white border border-slate-200 rounded-lg p-4 mb-4">
      <h3 class="text-sm font-semibold text-slate-800 mb-3">${t('owner.createChurchTitle')}</h3>
      <form data-el="create-church-form" class="grid sm:grid-cols-3 gap-3">
        <div>
          <label class="block text-xs font-medium text-slate-500 mb-1">${t('owner.createChurchName')}</label>
          <input type="text" name="church_name" required class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label class="block text-xs font-medium text-slate-500 mb-1">${t('owner.createChurchAdminEmail')}</label>
          <input type="email" name="admin_email" required class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label class="block text-xs font-medium text-slate-500 mb-1">${t('owner.createChurchTempPassword')}</label>
          <div class="flex gap-2">
            <input type="text" name="admin_password" required minlength="6" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            <button type="button" data-action="generate-password" class="px-2 py-2 rounded-lg border border-slate-200 text-xs text-slate-600 hover:border-indigo-200 hover:text-indigo-600 whitespace-nowrap">${t('userCreator.generatePassword')}</button>
          </div>
        </div>
        <div class="sm:col-span-3 flex items-center gap-3">
          <button type="submit" data-el="create-church-submit" class="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">${t('owner.createChurchSubmit')}</button>
          <span data-el="create-church-status" class="text-sm text-slate-500"></span>
        </div>
      </form>
    </div>

    <div class="overflow-x-auto border border-slate-200 rounded-lg">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
          <tr>
            <th class="text-left px-3 py-2">${t('owner.colChurch')}</th>
            <th class="text-left px-3 py-2">${t('owner.colStatus')}</th>
            <th class="text-left px-3 py-2">${t('owner.colPlan')}</th>
            <th class="text-left px-3 py-2">${t('owner.colPaying')}</th>
            <th class="text-left px-3 py-2">${t('owner.colOverride')}</th>
            <th class="text-left px-3 py-2">${t('owner.colTrialEnds')}</th>
            <th class="text-left px-3 py-2"></th>
          </tr>
        </thead>
        <tbody data-el="rows"></tbody>
      </table>
    </div>
  `;

  const createChurchForm = container.querySelector('[data-el="create-church-form"]');
  const createChurchSubmitBtn = createChurchForm.querySelector('[data-el="create-church-submit"]');
  const createChurchStatusEl = createChurchForm.querySelector('[data-el="create-church-status"]');
  createChurchForm.querySelector('[data-action="generate-password"]').addEventListener('click', () => {
    createChurchForm.elements.admin_password.value = generateTempPassword();
  });
  createChurchForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const church_name = createChurchForm.elements.church_name.value.trim();
    const admin_email = createChurchForm.elements.admin_email.value.trim();
    const admin_password = createChurchForm.elements.admin_password.value;

    createChurchSubmitBtn.disabled = true;
    createChurchStatusEl.className = 'text-sm text-slate-500';
    createChurchStatusEl.textContent = t('common.saving');

    const { data, error: invokeError } = await supabase.functions.invoke('owner-create-church', {
      body: { church_name, admin_email, admin_password },
    });
    createChurchSubmitBtn.disabled = false;

    // supabase-js only rejects with `error` on a network failure --a
    // non-2xx response still resolves with `data` holding this
    // function's own { error } JSON body (same shape import-bible's
    // callers already handle).
    const message = invokeError?.message || data?.error;
    if (message) {
      createChurchStatusEl.className = 'text-sm text-rose-600';
      createChurchStatusEl.textContent = t('owner.createChurchFailed', { message });
      return;
    }

    createChurchStatusEl.className = 'text-sm text-emerald-600';
    createChurchStatusEl.textContent = t('owner.createChurchSuccess', { name: church_name });
    createChurchForm.reset();
    renderOwnerTab(container, { onOwnTenantChanged });
  });

  function generateTempPassword() {
    const bytes = new Uint8Array(9);
    window.crypto.getRandomValues(bytes);
    return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '').slice(0, 12);
  }

  const rowsEl = container.querySelector('[data-el="rows"]');
  rowsEl.innerHTML = (tenants || []).map((tn) => {
    const isMine = tn.id === myTenantId;
    const isOverridden = tn.plan_override_source === 'owner';
    const trialEndsDateValue = tn.trial_ends_at ? tn.trial_ends_at.slice(0, 10) : '';
    return `
      <tr class="border-t border-slate-100" data-tenant-id="${tn.id}">
        <td class="px-3 py-2">
          ${escapeHtml(tn.name)}
          ${isMine ? `<span class="ml-1 text-xs text-indigo-600">${t('owner.thisIsYourChurch')}</span>` : ''}
        </td>
        <td class="px-3 py-2 text-slate-500">${escapeHtml(tn.status || '')}</td>
        <td class="px-3 py-2">
          <select data-el="plan-select" class="border border-slate-300 rounded-lg px-2 py-1 text-xs">
            ${PLAN_KEYS.map((key) => `<option value="${key}" ${tn.plan_key === key ? 'selected' : ''}>${escapeHtml(key)}</option>`).join('')}
          </select>
        </td>
        <td class="px-3 py-2">${tn.is_paying ? `<span class="text-emerald-600">${t('owner.paying')}</span>` : `<span class="text-slate-400">${t('owner.notPaying')}</span>`}</td>
        <td class="px-3 py-2">${isOverridden ? `<span class="text-amber-600">${t('owner.overriddenByOwner')}</span>` : ''}</td>
        <td class="px-3 py-2">
          <input type="date" data-el="trial-ends-input" value="${trialEndsDateValue}" class="border border-slate-300 rounded-lg px-2 py-1 text-xs" />
        </td>
        <td class="px-3 py-2 whitespace-nowrap">
          <button type="button" data-action="apply-plan" class="text-xs text-indigo-600 hover:text-indigo-700 font-medium mr-2">${t('owner.applyPlan')}</button>
          ${isOverridden ? `<button type="button" data-action="clear-override" class="text-xs text-slate-500 hover:text-slate-700 mr-2">${t('owner.clearOverride')}</button>` : ''}
          <button type="button" data-action="set-trial-end" class="text-xs text-slate-500 hover:text-slate-700">${t('owner.setTrialEnd')}</button>
        </td>
      </tr>
    `;
  }).join('');

  rowsEl.querySelectorAll('[data-tenant-id]').forEach((row) => {
    const tenantId = row.dataset.tenantId;
    row.querySelector('[data-action="apply-plan"]').addEventListener('click', async () => {
      const planKey = row.querySelector('[data-el="plan-select"]').value;
      const { error: applyError } = await supabase.rpc('owner_set_tenant_plan', { p_tenant_id: tenantId, p_plan_key: planKey });
      if (applyError) {
        window.alert(t('owner.applyFailed', { message: applyError.message }));
        return;
      }
      if (tenantId === myTenantId) {
        await loadMyEntitlements();
        renderEntitlementGates();
        onOwnTenantChanged?.();
      }
      renderOwnerTab(container, { onOwnTenantChanged });
    });
    row.querySelector('[data-action="clear-override"]')?.addEventListener('click', async () => {
      const { error: clearError } = await supabase.rpc('owner_clear_tenant_override', { p_tenant_id: tenantId });
      if (clearError) {
        window.alert(t('owner.clearFailed', { message: clearError.message }));
        return;
      }
      renderOwnerTab(container, { onOwnTenantChanged });
    });
    row.querySelector('[data-action="set-trial-end"]').addEventListener('click', async () => {
      const dateValue = row.querySelector('[data-el="trial-ends-input"]').value;
      if (!dateValue) return;
      // End of that calendar day, not midnight-start -- "ends October
      // 20th" should still mean access all day on the 20th.
      const trialEndsAt = new Date(`${dateValue}T23:59:59`).toISOString();
      const { error: trialError } = await supabase.rpc('owner_set_tenant_trial_end', { p_tenant_id: tenantId, p_trial_ends_at: trialEndsAt });
      if (trialError) {
        window.alert(t('owner.setTrialEndFailed', { message: trialError.message }));
        return;
      }
      if (tenantId === myTenantId) {
        await loadMyEntitlements();
        renderEntitlementGates();
        onOwnTenantChanged?.();
      }
      renderOwnerTab(container, { onOwnTenantChanged });
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
