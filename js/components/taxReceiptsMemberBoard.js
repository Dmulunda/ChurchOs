// Member-facing Tax / Impôts tab content: a running per-year total of
// what they've given (always visible, even for the current open year),
// a prompt to set their Legal Name if it's still empty (required
// before any receipt can be issued for them -- see
// finalize_tax_receipt_year() in sql/saas_platform/31_tax_receipts_rpcs.sql),
// and -- for any year Finance has finalized -- their official receipt
// with a Download PDF button.
//
// PDF building (html2canvas + jsPDF against a styled on-page template)
// lives in js/utils/taxReceiptPdf.js -- shared with
// taxReceiptsAdminBoard.js, which builds the identical PDF for a Guest
// Donor (no app account) and emails it instead of downloading it.
import { t, formatMoney } from '../i18n.js';
import { mergePrivateFields } from '../utils/privateProfile.js';
import { t, appLocale, formatMoney } from '../i18n.js';
import { createMyProfileModal } from './myProfileModal.js';
import { receiptPdfAvailable, buildReceiptPdfBlob, shareOrDownloadPdf } from '../utils/taxReceiptPdf.js';

export async function renderTaxReceiptsMemberBoard(container, { supabase, userId }) {
  container.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;

  const [{ data: profile, error: profileError }, { data: entries, error: entriesError }, { data: years }, { data: receipts }] = await Promise.all([
    supabase.from('profiles').select('id').eq('id', userId).single().then(async (r) => (r.data ? { ...r, data: (await mergePrivateFields(supabase, [r.data]))[0] } : r)),
    supabase.from('donation_entries').select('fiscal_year, amount, currency').eq('member_id', userId),
    supabase.from('tax_receipt_years').select('fiscal_year, status'),
    supabase.from('tax_receipts').select('fiscal_year, receipt_number, total_amount, currency, legal_name_snapshot, tenant_info_snapshot, issued_at').eq('member_id', userId),
  ]);

  if (profileError || entriesError) {
    container.innerHTML = `<p class="text-sm text-rose-600">${t('taxMember.loadFailed', { message: (profileError || entriesError).message })}</p>`;
    return;
  }

  // A member could have given in more than one currency in the same
  // year, which now means more than one receipt for that year (one
  // per currency, sql/70) -- both totals and receipts are keyed by
  // (fiscal_year, currency), not just fiscal_year.
  const statusByYear = new Map((years || []).map((y) => [y.fiscal_year, y.status]));
  const receiptByYear = new Map(); // fiscal_year -> Map<currency, receipt>
  (receipts || []).forEach((r) => {
    if (!receiptByYear.has(r.fiscal_year)) receiptByYear.set(r.fiscal_year, new Map());
    receiptByYear.get(r.fiscal_year).set(r.currency || 'CAD', r);
  });
  const totalByYear = new Map(); // fiscal_year -> Map<currency, total>
  (entries || []).forEach((e) => {
    if (!totalByYear.has(e.fiscal_year)) totalByYear.set(e.fiscal_year, new Map());
    const byCurrency = totalByYear.get(e.fiscal_year);
    const currency = e.currency || 'CAD';
    byCurrency.set(currency, (byCurrency.get(currency) || 0) + Number(e.amount));
  });

  const fiscalYears = Array.from(new Set([...totalByYear.keys(), ...receiptByYear.keys()])).sort((a, b) => b - a);

  container.innerHTML = `
    ${!profile?.legal_name ? `
      <div class="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4 flex items-center justify-between gap-3 flex-wrap">
        <p class="text-sm text-amber-800">${t('taxMember.legalNameMissing')}</p>
        <button type="button" data-action="set-legal-name" class="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 whitespace-nowrap">
          ${t('taxMember.setLegalName')}
        </button>
      </div>
    ` : ''}
    ${fiscalYears.length === 0
      ? `<p class="text-slate-500 bg-white rounded-xl shadow p-4 sm:p-6">${t('taxMember.none')}</p>`
      : `<div data-el="years"></div>`}
  `;

  container.querySelector('[data-action="set-legal-name"]')?.addEventListener('click', () => {
    createMyProfileModal({ supabase, userId }).open();
  });

  const yearsEl = container.querySelector('[data-el="years"]');
  if (!yearsEl) return;

  yearsEl.innerHTML = fiscalYears.map((year) => {
    const totalsByCurrency = totalByYear.get(year) || new Map();
    const receiptsByCurrency = receiptByYear.get(year) || new Map();
    const status = statusByYear.get(year) || 'open';
    const currencies = Array.from(new Set([...totalsByCurrency.keys(), ...receiptsByCurrency.keys()]));
    if (currencies.length === 0) currencies.push('CAD');

    return `
      <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-3">
        <div class="text-lg font-semibold text-slate-800 mb-2">${year}</div>
        ${currencies.map((currency) => {
          const total = totalsByCurrency.get(currency) || 0;
          const receipt = receiptsByCurrency.get(currency);
          return `
            <div class="flex items-center justify-between gap-3 flex-wrap py-1">
              <div class="text-sm text-slate-500">${t('taxMember.totalGiven', { amount: formatAmount(total, currency) })}</div>
              ${receipt ? `
                <div class="text-right">
                  <div class="text-xs text-slate-400">${t('taxMember.receiptNumber', { number: receipt.receipt_number })}</div>
                  <button type="button" data-action="download" data-year="${year}" data-currency="${currency}" class="mt-1 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">
                    ${t('taxMember.downloadPdf')}
                  </button>
                </div>
              ` : `
                <span class="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-500">
                  ${status === 'finalized' ? t('taxMember.noReceiptThisYear') : t('taxMember.notFinalizedYet')}
                </span>
              `}
            </div>
            ${receipt ? `<div data-el="receipt-status-${year}-${currency}" class="text-xs text-slate-400 mt-1"></div>` : ''}
          `;
        }).join('')}
      </div>
    `;
  }).join('');

  yearsEl.querySelectorAll('[data-action="download"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const year = Number(btn.dataset.year);
      const currency = btn.dataset.currency;
      const receipt = receiptByYear.get(year)?.get(currency);
      const statusEl = yearsEl.querySelector(`[data-el="receipt-status-${year}-${currency}"]`);
      downloadReceiptPdf(receipt, statusEl);
    });
  });
}

function formatAmount(amount, currency) {
  const base = formatMoney(amount);
  return currency ? `${base} ${currency}` : base;
}

async function downloadReceiptPdf(receipt, statusEl) {
  if (!receiptPdfAvailable()) { statusEl.textContent = t('taxMember.exportUnavailable'); return; }
  statusEl.textContent = t('common.loading');
  const blob = await buildReceiptPdfBlob(receipt);
  await shareOrDownloadPdf(new File([blob], `tax-receipt-${receipt.fiscal_year}.pdf`, { type: 'application/pdf' }), statusEl);
}
