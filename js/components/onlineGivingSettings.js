// "Online giving" card at the top of the Offerings page, for a Super
// Admin or Finance admin (sql/saas_platform/144_online_giving.sql).
//   * Connect the church's own Stripe account (money goes straight to
//     the church) and see whether it can take card payments yet.
//   * Switch giving on/off, default currency, Interac e-Transfer email,
//     mobile money instructions, thank-you message.
//   * Share the public giving link / QR code.
// Renders nothing at all until sql 144 is applied (giving_settings
// missing), so shipping this code early can't break the Offerings page.
import { t } from '../i18n.js';
import { getTenant } from '../tenant.js';
import { createPublicLinkQrModal } from './publicLinkQrModal.js';

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

let qrModal = null;

export async function renderOnlineGivingSettings(container, { supabase }) {
  const tenant = getTenant();
  if (!tenant) return;
  const { data: settings, error } = await supabase.from('giving_settings').select('*').eq('tenant_id', tenant.id).maybeSingle();
  if (error) { container.innerHTML = ''; return; } // feature not installed yet

  const s = settings || { enabled: false, stripe_account_id: null, stripe_charges_enabled: false, default_currency: 'CAD' };
  const params = new URLSearchParams(window.location.search);
  const justConnected = params.get('giving') === 'connected';

  let stripeStatus;
  if (!s.stripe_account_id) stripeStatus = `<span class="text-slate-500">${t('givingAdmin.stripeNotConnected')}</span>`;
  else if (!s.stripe_charges_enabled) stripeStatus = `<span class="text-amber-600">${t('givingAdmin.stripePending')}</span>`;
  else stripeStatus = `<span class="text-emerald-600">${t('givingAdmin.stripeReady')}</span>`;

  container.innerHTML = `
    <details class="bg-white rounded-xl shadow mb-4" ${justConnected || !s.enabled ? 'open' : ''}>
      <summary class="cursor-pointer select-none px-4 sm:px-6 py-3 flex items-center justify-between gap-2">
        <span class="font-semibold">💳 ${t('givingAdmin.title')}</span>
        <span class="text-xs font-medium ${s.enabled ? 'text-emerald-600' : 'text-slate-400'}">${s.enabled ? t('givingAdmin.on') : t('givingAdmin.off')}</span>
      </summary>
      <div class="px-4 sm:px-6 pb-5 space-y-4 border-t border-slate-100 pt-4">
        <p class="text-sm text-slate-600">${t('givingAdmin.intro')}</p>

        <div class="rounded-lg border border-slate-200 p-3 space-y-2">
          <p class="text-sm font-medium text-slate-700">${t('givingAdmin.cardTitle')}</p>
          <p class="text-sm">${stripeStatus}</p>
          <div class="flex flex-wrap gap-2">
            <button type="button" data-action="connect" class="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">
              ${s.stripe_account_id ? t('givingAdmin.continueStripe') : t('givingAdmin.connectStripe')}
            </button>
            ${s.stripe_account_id ? `<button type="button" data-action="refresh" class="px-3 py-1.5 rounded-lg border border-slate-300 text-sm hover:bg-slate-50">${t('givingAdmin.refresh')}</button>` : ''}
          </div>
          <p data-el="stripe-msg" class="hidden text-xs text-rose-600"></p>
        </div>

        <form data-el="settings-form" class="space-y-3">
          <label class="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input type="checkbox" name="enabled" ${s.enabled ? 'checked' : ''} class="rounded border-slate-300" />
            ${t('givingAdmin.enable')}
          </label>
          <div class="grid sm:grid-cols-2 gap-3">
            <label class="text-sm text-slate-700">${t('givingAdmin.currency')}
              <select name="default_currency" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-sm">
                ${['CAD', 'USD', 'EUR'].map((c) => `<option value="${c}" ${c === s.default_currency ? 'selected' : ''}>${c}</option>`).join('')}
              </select>
            </label>
            <label class="text-sm text-slate-700">${t('givingAdmin.interacEmail')}
              <input name="interac_email" type="email" value="${escapeHtml(s.interac_email || '')}" placeholder="dons@monéglise.ca"
                     class="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            </label>
          </div>
          <label class="block text-sm text-slate-700">${t('givingAdmin.mobileMoney')}
            <textarea name="mobile_money_instructions" rows="3" placeholder="${t('givingAdmin.mobileMoneyPlaceholder')}"
                      class="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">${escapeHtml(s.mobile_money_instructions || '')}</textarea>
          </label>
          <label class="block text-sm text-slate-700">${t('givingAdmin.thankYou')}
            <input name="thank_you_message" type="text" maxlength="300" value="${escapeHtml(s.thank_you_message || '')}" placeholder="${t('giving.thanksDefault')}"
                   class="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </label>
          <div class="flex flex-wrap items-center gap-2">
            <button type="submit" class="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">${t('givingAdmin.save')}</button>
            <button type="button" data-action="share" class="px-4 py-2 rounded-lg border border-slate-300 text-sm hover:bg-slate-50">${t('givingAdmin.shareLink')}</button>
            <span data-el="save-msg" class="text-sm"></span>
          </div>
        </form>
      </div>
    </details>
  `;

  const stripeMsgEl = container.querySelector('[data-el="stripe-msg"]');
  const showStripeError = (msg) => { stripeMsgEl.textContent = msg; stripeMsgEl.classList.remove('hidden'); };

  container.querySelector('[data-action="connect"]').addEventListener('click', async (e) => {
    e.target.disabled = true;
    const returnUrl = new URL(window.location.href);
    returnUrl.search = '';
    returnUrl.hash = '';
    const { data, error: fnError } = await supabase.functions.invoke('online-giving', { body: { action: 'connect_link', returnUrl: returnUrl.toString() } });
    if (fnError || !data?.url) {
      // Show the server's own reason (e.g. Stripe Connect not enabled) next to the generic message.
      let detail = '';
      try { detail = (await fnError?.context?.json?.())?.error || ''; } catch { /* not JSON */ }
      showStripeError(detail ? `${t('givingAdmin.stripeError')} (${detail})` : t('givingAdmin.stripeError'));
      e.target.disabled = false;
      return;
    }
    window.location.href = data.url;
  });

  const refresh = async () => {
    const { error: fnError } = await supabase.functions.invoke('online-giving', { body: { action: 'refresh_status' } });
    if (fnError) {
      let detail = '';
      try { detail = (await fnError.context?.json?.())?.error || ''; } catch { /* not JSON */ }
      showStripeError(detail ? `${t('givingAdmin.stripeError')} (${detail})` : t('givingAdmin.stripeError'));
      return;
    }
    renderOnlineGivingSettings(container, { supabase });
  };
  container.querySelector('[data-action="refresh"]')?.addEventListener('click', refresh);
  // Back from Stripe onboarding: pick up the new status once.
  if (justConnected && s.stripe_account_id) {
    params.delete('giving');
    const clean = new URL(window.location.href);
    clean.search = params.toString();
    window.history.replaceState(null, '', clean.toString());
    refresh();
  }

  container.querySelector('[data-action="share"]').addEventListener('click', () => {
    if (!qrModal) qrModal = createPublicLinkQrModal({ pageFile: 'give.html', titleKey: 'givingAdmin.shareTitle', hintKey: 'givingAdmin.shareHint' });
    qrModal.open();
  });

  container.querySelector('[data-el="settings-form"]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const msgEl = container.querySelector('[data-el="save-msg"]');
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    const { error: saveError } = await supabase.rpc('update_giving_settings', {
      p_enabled: form.elements.enabled.checked,
      p_default_currency: form.elements.default_currency.value,
      p_interac_email: form.elements.interac_email.value,
      p_mobile_money_instructions: form.elements.mobile_money_instructions.value,
      p_thank_you_message: form.elements.thank_you_message.value,
    });
    btn.disabled = false;
    msgEl.className = saveError ? 'text-sm text-rose-600' : 'text-sm text-emerald-600';
    msgEl.textContent = saveError ? saveError.message : t('givingAdmin.saved');
  });
}
