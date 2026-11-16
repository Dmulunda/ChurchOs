// Entry point for give.html -- the public giving page (anyone, no
// account needed; reached from the church's giving link/QR code or the
// in-app "Give online" button). Same shape as js/publicPrayerRequest.js:
// outside the app.js shell, ?church=<tenant-slug> picks the church.
//
// Card gifts go to the church's own Stripe account through Stripe's
// hosted Checkout page (online-giving edge function); this page never
// sees card details. If the visitor happens to be signed in to this same
// church, supabase-js sends their session automatically and the gift is
// linked to them for their tax receipt (decided server-side).
// Interac e-Transfer and mobile money are shown as instructions only.
// See sql/saas_platform/144_online_giving.sql.
import { supabase } from './supabaseClient.js';
import { loadLabelOverrides, applyStaticTranslations, t, formatMoney } from './i18n.js';

const COP_LOGO = 'img/church-on-point-icon.png';
const OFFERING_TYPES = ['tithe', 'general', 'sacrifice', 'construction', 'other'];
const PRESETS = [20, 50, 100, 200];

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

async function main() {
  try { await loadLabelOverrides(); } catch { /* built-in translations */ }
  applyStaticTranslations();

  const container = document.querySelector('#public-giving-content');
  const params = new URLSearchParams(window.location.search);
  const slug = params.get('church');
  if (!slug) {
    container.innerHTML = `<p class="bg-white rounded-xl shadow p-4 sm:p-6 text-slate-600">${t('giving.noChurch')}</p>`;
    return;
  }

  const { data, error } = await supabase.rpc('get_public_giving_info', { p_tenant_slug: slug });
  const info = Array.isArray(data) ? data[0] : data;
  if (error || !info) {
    container.innerHTML = `<p class="bg-white rounded-xl shadow p-4 sm:p-6 text-slate-600">${t('giving.notAvailable')}</p>`;
    return;
  }

  document.querySelector('#give-header img').src = info.logo_url || COP_LOGO;
  if (info.tenant_name) document.querySelector('#give-header h1').textContent = info.tenant_name;
  document.title = `${t('giving.publicTitle')} — ${info.tenant_name || ''}`;

  if (params.get('gift') === 'thanks') {
    container.innerHTML = `
      <div class="bg-white rounded-xl shadow p-6 text-center space-y-2">
        <div class="text-4xl">🙏</div>
        <p class="font-semibold text-slate-800">${t('giving.thanksTitle')}</p>
        <p class="text-sm text-slate-600">${escapeHtml(info.thank_you_message || t('giving.thanksDefault'))}</p>
        <a href="?church=${encodeURIComponent(slug)}" class="inline-block mt-2 text-sm text-indigo-600 hover:underline">${t('giving.giveAgain')}</a>
      </div>`;
    return;
  }

  if (!info.enabled) {
    container.innerHTML = `<p class="bg-white rounded-xl shadow p-4 sm:p-6 text-slate-600">${t('giving.notAvailable')}</p>`;
    return;
  }

  const { data: { session } } = await supabase.auth.getSession();
  const cancelled = params.get('gift') === 'cancelled';

  container.innerHTML = `
    ${cancelled ? `<p class="mb-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm px-3 py-2">${t('giving.cancelled')}</p>` : ''}
    ${info.card_enabled ? `
    <form id="give-form" class="bg-white rounded-xl shadow p-4 sm:p-6 space-y-4">
      <div>
        <p class="text-sm font-medium text-slate-700 mb-2">${t('giving.amount')}</p>
        <div class="grid grid-cols-4 gap-2 mb-2">
          ${PRESETS.map((p) => `<button type="button" data-preset="${p}" class="py-2 rounded-lg border border-slate-300 text-sm font-medium hover:border-indigo-500">${escapeHtml(formatMoney(p))}</button>`).join('')}
        </div>
        <div class="flex gap-2">
          <input name="amount" type="number" inputmode="decimal" min="1" step="0.01" required placeholder="${t('giving.otherAmount')}"
                 class="flex-1 min-w-0 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          <select name="currency" class="border border-slate-300 rounded-lg px-2 py-2 text-sm">
            ${['CAD', 'USD', 'EUR'].map((c) => `<option value="${c}" ${c === info.default_currency ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </div>
      </div>
      <div>
        <label class="text-sm font-medium text-slate-700">${t('giving.type')}</label>
        <select name="offering_type" class="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
          ${OFFERING_TYPES.map((v) => `<option value="${v}">${escapeHtml(t(`offerings.type.${v}`))}</option>`).join('')}
        </select>
      </div>
      ${session ? `<p class="text-xs text-slate-500">${t('giving.signedInNote')}</p>` : `
      <div class="space-y-2">
        <input name="donor_name" type="text" required maxlength="200" placeholder="${t('giving.namePlaceholder')}"
               class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        <input name="donor_email" type="email" maxlength="200" placeholder="${t('giving.emailPlaceholder')}"
               class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      </div>`}
      <p data-el="error" class="hidden text-sm text-rose-600"></p>
      <button type="submit" class="w-full py-2.5 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">${t('giving.payByCard')}</button>
      <p class="text-xs text-slate-400 text-center">🔒 ${t('giving.secureNote')}</p>
    </form>` : ''}
    ${info.interac_email ? `
    <div class="mt-4 bg-white rounded-xl shadow p-4 sm:p-6">
      <p class="font-medium text-slate-800">${t('giving.interacTitle')}</p>
      <p class="text-sm text-slate-600 mt-1">${t('giving.interacText')}</p>
      <p class="mt-2 font-mono text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 break-all">${escapeHtml(info.interac_email)}</p>
    </div>` : ''}
    ${info.mobile_money_instructions ? `
    <div class="mt-4 bg-white rounded-xl shadow p-4 sm:p-6">
      <p class="font-medium text-slate-800">${t('giving.mobileMoneyTitle')}</p>
      <p class="text-sm text-slate-600 mt-1 whitespace-pre-line">${escapeHtml(info.mobile_money_instructions)}</p>
    </div>` : ''}
    ${!info.card_enabled && !info.interac_email && !info.mobile_money_instructions ? `<p class="bg-white rounded-xl shadow p-4 sm:p-6 text-slate-600">${t('giving.notAvailable')}</p>` : ''}
  `;

  const form = container.querySelector('#give-form');
  if (!form) return;
  const amountInput = form.elements.amount;
  form.querySelectorAll('[data-preset]').forEach((btn) => btn.addEventListener('click', () => {
    amountInput.value = btn.dataset.preset;
    form.querySelectorAll('[data-preset]').forEach((b) => b.classList.toggle('border-indigo-600', b === btn));
  }));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = form.querySelector('[data-el="error"]');
    errorEl.classList.add('hidden');
    const amountCents = Math.round(Number(String(amountInput.value).replace(',', '.')) * 100);
    if (!Number.isFinite(amountCents) || amountCents < 100) {
      errorEl.textContent = t('giving.errorAmount');
      errorEl.classList.remove('hidden');
      return;
    }
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    const returnUrl = new URL(window.location.href);
    returnUrl.search = `?church=${encodeURIComponent(slug)}`;
    const { data: res, error: fnError } = await supabase.functions.invoke('online-giving', {
      body: {
        action: 'create_checkout',
        tenant_slug: slug,
        amount_cents: amountCents,
        currency: form.elements.currency.value,
        offering_type: form.elements.offering_type.value,
        donor_name: form.elements.donor_name?.value || '',
        donor_email: form.elements.donor_email?.value || '',
        returnUrl: returnUrl.toString(),
      },
    });
    if (fnError || !res?.url) {
      errorEl.textContent = t('giving.errorGeneric');
      errorEl.classList.remove('hidden');
      submitBtn.disabled = false;
      return;
    }
    window.location.href = res.url;
  });
}

main();
