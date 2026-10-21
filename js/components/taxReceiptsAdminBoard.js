// Finance admin's Tax Receipts board -- Tax Settings + donation
// spreadsheet import (both modals, see taxReceiptSettingsModal.js /
// taxDonationImport.js) plus a per-fiscal-year list of running totals
// with a Finalize action. Only reachable via budgetCentralBoard.js's
// oversight-only third tab (hasFinanceOversight()) -- matches how the
// Reimbursements inbox there is oversight-only too, since this is a
// church-wide financial/legal feature, not a per-department one.
//
// Silent Members: a real church member who gives but has no login
// (profiles.is_silent) -- offeringsBoard.js/offeringsImport.js link an
// offering straight to their member_id, same as any other member, so
// it already flows through to donation_entries and
// finalize_tax_receipt_year() like any other member's. Since they
// have no account to log in and download their receipt themselves,
// Finance emails it to them here -- the PDF is built client-side with
// the exact same code the member-facing download button uses
// (js/utils/taxReceiptPdf.js), then handed to the offering-reports
// Edge Function's send_tax_receipt_email action as base64.
import { t } from '../i18n.js';
import { confirmDialog } from './confirmDialog.js';
import { createTaxReceiptSettingsModal } from './taxReceiptSettingsModal.js';
import { createTaxDonationImportModal } from './taxDonationImport.js';
import { receiptPdfAvailable, buildReceiptPdfBlob, blobToBase64 } from '../utils/taxReceiptPdf.js';
import { extractFunctionErrorMessage } from '../utils/edgeFunctionError.js';

export function renderTaxReceiptsAdminBoard(container, { supabase, currentUserId }) {
  container.innerHTML = `
    <div class="flex flex-wrap items-center gap-2 mb-4">
      <button type="button" data-action="settings" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">${t('taxAdmin.settingsButton')}</button>
      <button type="button" data-action="import" class="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">${t('taxAdmin.importButton')}</button>
    </div>
    <div data-el="years-list"><p class="text-sm text-slate-500">${t('common.loading')}</p></div>

    <h3 class="text-base font-semibold text-slate-800 mt-6 mb-1">${t('taxAdmin.silentMembersTitle')}</h3>
    <p class="text-xs text-slate-500 mb-3">${t('taxAdmin.silentMembersIntro')}</p>
    <div data-el="silent-members-list"><p class="text-sm text-slate-500">${t('common.loading')}</p></div>
  `;

  const yearsListEl = container.querySelector('[data-el="years-list"]');
  const silentMembersListEl = container.querySelector('[data-el="silent-members-list"]');

  const settingsModal = createTaxReceiptSettingsModal({ supabase, currentUserId });
  const importModal = createTaxDonationImportModal({ supabase, currentUserId, onImported: loadYears });

  container.querySelector('[data-action="settings"]').addEventListener('click', () => settingsModal.open());
  container.querySelector('[data-action="import"]').addEventListener('click', () => importModal.open());

  loadYears();
  loadSilentMembers();

  async function loadYears() {
    yearsListEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const [{ data: entries, error: entriesError }, { data: years, error: yearsError }] = await Promise.all([
      supabase.from('donation_entries').select('fiscal_year, amount, currency, member_id'),
      supabase.from('tax_receipt_years').select('fiscal_year, status'),
    ]);

    if (entriesError || yearsError) {
      yearsListEl.innerHTML = `<p class="text-sm text-rose-600">${t('taxAdmin.loadFailed', { message: (entriesError || yearsError).message })}</p>`;
      return;
    }

    // Grouped by (fiscal_year, currency) -- never blended into one
    // converted number, same reasoning as offeringsBoard.js's period
    // total.
    const statusByYear = new Map((years || []).map((y) => [y.fiscal_year, y.status]));
    const byYear = new Map(); // fiscal_year -> Map<currency, { total, members, unmatchedTotal }>
    (entries || []).forEach((e) => {
      if (!byYear.has(e.fiscal_year)) byYear.set(e.fiscal_year, new Map());
      const byCurrency = byYear.get(e.fiscal_year);
      const currency = e.currency || 'CAD';
      if (!byCurrency.has(currency)) byCurrency.set(currency, { total: 0, members: new Set(), unmatchedTotal: 0 });
      const entry = byCurrency.get(currency);
      if (e.member_id) { entry.total += Number(e.amount); entry.members.add(e.member_id); }
      else entry.unmatchedTotal += Number(e.amount);
    });
    // A year Finance already finalized but that has no donation_entries
    // rows anymore (shouldn't normally happen) still needs to show up.
    (years || []).forEach((y) => { if (!byYear.has(y.fiscal_year)) byYear.set(y.fiscal_year, new Map()); });

    if (byYear.size === 0) {
      yearsListEl.innerHTML = `<p class="text-sm text-slate-500">${t('taxAdmin.noData')}</p>`;
      return;
    }

    const fiscalYears = Array.from(byYear.keys()).sort((a, b) => b - a);
    yearsListEl.innerHTML = fiscalYears.map((year) => {
      const byCurrency = byYear.get(year);
      const status = statusByYear.get(year) || 'open';
      const currencyRows = byCurrency.size > 0 ? Array.from(byCurrency.entries()) : [['CAD', { total: 0, members: new Set(), unmatchedTotal: 0 }]];
      return `
        <div class="border border-slate-200 rounded-lg p-3 flex items-center justify-between gap-3 mb-2">
          <div>
            <div class="font-semibold text-slate-800">${year}</div>
            ${currencyRows.map(([currency, entry]) => `
              <div class="text-sm text-slate-500">${t('taxAdmin.yearSummary', { total: formatAmount(entry.total, currency), members: entry.members.size })}</div>
              ${entry.unmatchedTotal > 0 ? `<div class="text-xs text-amber-600 mt-0.5">${t('taxAdmin.unmatchedTotal', { amount: formatAmount(entry.unmatchedTotal, currency) })}</div>` : ''}
            `).join('')}
          </div>
          <div class="flex items-center gap-2">
            <span class="px-2 py-0.5 rounded-full text-xs font-medium ${status === 'finalized' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}">
              ${status === 'finalized' ? t('taxAdmin.statusFinalized') : t('taxAdmin.statusOpen')}
            </span>
            <button type="button" data-action="finalize" data-year="${year}" class="px-3 py-1.5 rounded-lg bg-slate-800 text-white text-xs font-medium hover:bg-slate-900">
              ${status === 'finalized' ? t('taxAdmin.reFinalizeButton') : t('taxAdmin.finalizeButton')}
            </button>
          </div>
        </div>
      `;
    }).join('');

    yearsListEl.querySelectorAll('[data-action="finalize"]').forEach((btn) => {
      btn.addEventListener('click', () => finalizeYear(Number(btn.dataset.year)));
    });
  }

  async function finalizeYear(year) {
    if (!(await confirmDialog({
      message: t('taxAdmin.confirmFinalize', { year }),
      confirmLabel: t('taxAdmin.finalizeButton'),
      danger: false,
    }))) return;

    const { data, error } = await supabase.rpc('finalize_tax_receipt_year', { p_fiscal_year: year });

    if (error) {
      window.alert(t('taxAdmin.finalizeFailed', { message: error.message }));
      return;
    }

    const result = Array.isArray(data) ? data[0] : data;
    const skipped = result?.skipped_members || [];
    let message = t('taxAdmin.finalizeSuccess', { count: result?.issued_count ?? 0 });
    if (skipped.length > 0) {
      message += '\n\n' + t('taxAdmin.finalizeSkipped', { names: skipped.map((m) => m.full_name).join(', ') });
    }
    window.alert(message);
    loadYears();
    loadSilentMembers();
  }

  // ---- Silent Members ----
  async function loadSilentMembers() {
    silentMembersListEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const [{ data: members, error: membersError }, { data: entries, error: entriesError }, { data: receipts, error: receiptsError }] = await Promise.all([
      supabase.from('profiles').select('id, full_name').eq('is_silent', true).order('full_name'),
      supabase.from('donation_entries').select('member_id, amount, currency').not('member_id', 'is', null),
      supabase.from('tax_receipts').select('id, member_id, fiscal_year, receipt_number, total_amount, currency, issued_at, legal_name_snapshot, tenant_info_snapshot').not('member_id', 'is', null),
    ]);

    if (membersError || entriesError || receiptsError) {
      silentMembersListEl.innerHTML = `<p class="text-sm text-rose-600">${t('taxAdmin.loadFailed', { message: (membersError || entriesError || receiptsError).message })}</p>`;
      return;
    }

    const silentIds = new Set((members || []).map((m) => m.id));

    // One subtotal per currency per person, same reasoning throughout
    // this file.
    const totalsByMember = new Map(); // member_id -> Map<currency, total>
    (entries || []).forEach((e) => {
      if (!silentIds.has(e.member_id)) return;
      if (!totalsByMember.has(e.member_id)) totalsByMember.set(e.member_id, new Map());
      const byCurrency = totalsByMember.get(e.member_id);
      const currency = e.currency || 'CAD';
      byCurrency.set(currency, (byCurrency.get(currency) || 0) + Number(e.amount));
    });
    const receiptsByMember = new Map();
    (receipts || []).forEach((r) => {
      if (!silentIds.has(r.member_id)) return;
      if (!receiptsByMember.has(r.member_id)) receiptsByMember.set(r.member_id, []);
      receiptsByMember.get(r.member_id).push(r);
    });

    if (!members || members.length === 0) {
      silentMembersListEl.innerHTML = `<p class="text-sm text-slate-400">${t('taxAdmin.noSilentMembers')}</p>`;
      return;
    }

    silentMembersListEl.innerHTML = members.map((m) => {
      const byCurrency = totalsByMember.get(m.id) || new Map();
      const totalLines = byCurrency.size > 0
        ? Array.from(byCurrency.entries()).map(([currency, total]) => t('taxAdmin.guestTotal', { amount: formatAmount(total, currency) })).join('<br>')
        : t('taxAdmin.guestTotal', { amount: formatAmount(0, 'CAD') });
      const receiptsForMember = (receiptsByMember.get(m.id) || []).sort((a, b) => b.fiscal_year - a.fiscal_year);
      return `
        <div class="border border-slate-200 rounded-lg p-3 mb-2" data-member-id="${m.id}">
          <div class="flex items-center justify-between gap-3 flex-wrap mb-2">
            <div class="flex-1 min-w-[160px]">
              <div class="font-semibold text-slate-800">${escapeHtml(m.full_name)}</div>
              <input type="email" data-el="email" placeholder="${escapeAttr(t('taxAdmin.guestEmailPlaceholder'))}" class="text-sm text-slate-500 border border-transparent hover:border-slate-300 focus:border-slate-300 rounded px-1.5 py-0.5 -ml-1.5 w-full" />
            </div>
            <div class="text-right">
              <div class="text-sm text-slate-600">${totalLines}</div>
              <button type="button" data-action="save-email" class="text-xs text-indigo-600 hover:text-indigo-700 font-medium">${t('taxAdmin.saveGuest')}</button>
              <span data-el="save-status" class="text-xs text-slate-500 ml-1"></span>
            </div>
          </div>
          ${receiptsForMember.length > 0 ? `
            <div class="divide-y divide-slate-100 border-t border-slate-100 pt-1">
              ${receiptsForMember.map((r) => `
                <div class="flex items-center justify-between py-1.5 text-sm" data-receipt-id="${r.id}">
                  <span class="text-slate-600">${r.fiscal_year} — ${escapeHtml(r.receipt_number)} — ${formatAmount(r.total_amount, r.currency)}</span>
                  <span>
                    <button type="button" data-action="email-receipt" class="text-xs text-emerald-600 hover:text-emerald-700 font-medium">${t('taxAdmin.emailReceipt')}</button>
                    <span data-el="email-status" class="text-xs text-slate-500 ml-1"></span>
                  </span>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    silentMembersListEl.querySelectorAll('[data-member-id]').forEach((row) => {
      const memberId = row.dataset.memberId;
      row.querySelector('[data-action="save-email"]').addEventListener('click', async () => {
        const statusEl = row.querySelector('[data-el="save-status"]');
        const email = row.querySelector('[data-el="email"]').value.trim();
        if (!email) return;
        statusEl.textContent = t('common.saving');
        const { error } = await supabase.functions.invoke('upgrade-silent-user', {
          body: { silent_profile_id: memberId, email, email_only: true },
        });
        statusEl.textContent = error ? t('taxAdmin.saveGuestFailed', { message: await extractFunctionErrorMessage(error) }) : t('taxAdmin.saved');
        if (!error) setTimeout(() => { statusEl.textContent = ''; }, 2000);
      });
      row.querySelectorAll('[data-receipt-id]').forEach((receiptRow) => {
        const receiptId = receiptRow.dataset.receiptId;
        receiptRow.querySelector('[data-action="email-receipt"]').addEventListener('click', async () => {
          const statusEl = receiptRow.querySelector('[data-el="email-status"]');
          const receipt = (receipts || []).find((r) => r.id === receiptId);
          if (!receipt) return;
          if (!receiptPdfAvailable()) { statusEl.textContent = t('taxMember.exportUnavailable'); return; }
          statusEl.textContent = t('common.saving');
          const blob = await buildReceiptPdfBlob(receipt);
          const pdf_base64 = await blobToBase64(blob);
          const { data, error } = await supabase.functions.invoke('offering-reports', {
            body: { action: 'send_tax_receipt_email', receipt_id: receiptId, pdf_base64 },
          });
          if (error || data?.error) {
            statusEl.className = 'text-xs text-rose-600 ml-1';
            statusEl.textContent = t('taxAdmin.emailReceiptFailed', { message: data?.error || error?.message || 'Unknown error' });
            return;
          }
          statusEl.className = 'text-xs text-emerald-600 ml-1';
          statusEl.textContent = t('taxAdmin.emailReceiptSent');
        });
      });
    });
  }
}

function formatAmount(amount, currency) {
  const base = '$' + Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${base} ${currency}` : base;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(str).replaceAll('"', '&quot;');
}
