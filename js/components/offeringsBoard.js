// Church Offering Registration — record individual offerings (name,
// date, amount, type, payment method) and see the current month's
// running ledger. Finance-only (can_manage_finance(), sql/054) end to
// end: the RLS insert/select policies are the real gate, this UI just
// mirrors it. Every month the open period is automatically closed
// into a PDF and a new one starts (sql/058, server-side cron, like a
// bank statement) — this page always shows whichever period is still
// open, plus a read-only history of past (closed) periods and their
// PDFs once generated.
//
// Optionally linking an offering to a real member (sql/057) mirrors
// it into donation_entries — the existing Tax Receipts system — so it
// counts toward that member's annual receipt automatically. Left
// unlinked (the default, free-text name), an offering is recorded but
// never counted toward anyone's receipt, same as an unmatched
// donation_entries row already works.
//
// "Import Historical Records" (offeringsImport.js) is the same idea in
// bulk — Excel/CSV, or a best-effort PDF parse, of whatever a church
// used before this system, reviewed row by row before anything is
// written.
import { t } from '../i18n.js';
import { confirmDialog } from './confirmDialog.js';
import { canDeleteOfferings } from '../departments.js';
import { createOfferingsImportModal } from './offeringsImport.js';

const OFFERING_TYPES = ['tithe', 'general', 'sacrifice', 'construction', 'other'];
const PAYMENT_METHODS = ['cash', 'transfer', 'check', 'other'];
const CURRENCIES = ['CAD', 'USD', 'EUR', 'other'];

function centsToDollarsStr(cents) {
  return (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function currencyLabel(row) {
  return row.currency === 'other' && row.currency_other ? row.currency_other : row.currency;
}

export function renderOfferingsBoard(container, { supabase, currentUserId }) {
  // sql/066: deleting an offering is narrower than recording one --
  // Finance Admin (or global oversight), not a Finance secretary or
  // plain member, and requires a reason. Mirrors can_delete_offerings().
  const canDelete = canDeleteOfferings();

  container.innerHTML = `
    <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-6">
      <div class="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 class="text-lg font-semibold">${t('offerings.recordTitle')}</h2>
        <button type="button" data-el="import-open-btn" class="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">${t('offerings.importButton')}</button>
      </div>
      <form data-el="form" class="grid sm:grid-cols-2 gap-3">
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('offerings.donorName')}</label>
          <input type="text" name="donor_name" list="offerings-member-list" required class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          <datalist id="offerings-member-list"></datalist>
          <p data-el="member-link-status" class="text-xs text-slate-400 mt-1"></p>
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('offerings.date')}</label>
          <input type="date" name="offering_date" required class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('offerings.amount')}</label>
          <div class="flex gap-2">
            <input type="number" name="amount" min="0.01" step="0.01" required class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            <select name="currency" data-el="currency-select" class="border border-slate-300 rounded-lg px-2 py-2 text-sm">
              ${CURRENCIES.map((v) => `<option value="${v}" ${v === 'CAD' ? 'selected' : ''}>${v === 'other' ? escapeHtml(t('offerings.currencyOther')) : v}</option>`).join('')}
            </select>
          </div>
        </div>
        <div data-el="currency-other-wrap" class="hidden">
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('offerings.currencyOtherSpecify')}</label>
          <input type="text" name="currency_other" placeholder="${escapeAttr(t('offerings.currencyOtherPlaceholder'))}" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('offerings.type')}</label>
          <select name="offering_type" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            ${OFFERING_TYPES.map((v) => `<option value="${v}">${escapeHtml(t(`offerings.type.${v}`))}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('offerings.paymentMethod')}</label>
          <select name="payment_method" data-el="payment-method-select" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            ${PAYMENT_METHODS.map((v) => `<option value="${v}">${escapeHtml(t(`offerings.paymentMethod.${v}`))}</option>`).join('')}
          </select>
        </div>
        <div data-el="payment-method-other-wrap" class="hidden">
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('offerings.paymentMethodOtherSpecify')}</label>
          <input type="text" name="payment_method_other" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div class="sm:col-span-2 flex items-center gap-3">
          <button type="submit" data-el="submit-btn" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
            ${t('offerings.record')}
          </button>
          <span data-el="form-status" class="text-sm text-slate-500"></span>
        </div>
      </form>
    </div>

    <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-6">
      <div class="flex items-center justify-between mb-1 flex-wrap gap-2">
        <h2 class="text-lg font-semibold">${t('offerings.currentPeriodTitle')}</h2>
        <span data-el="period-total" class="text-sm font-semibold text-slate-700"></span>
      </div>
      ${!canDelete ? `<p class="text-xs text-amber-600 mb-3">${t('offerings.todayOnlyNote')}</p>` : ''}
      <div data-el="list"></div>
    </div>

    <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-6">
      <h2 class="text-lg font-semibold mb-4">${t('offerings.recentlyRemovedTitle')}</h2>
      <div data-el="removed-list"></div>
    </div>

    <div class="bg-white rounded-xl shadow p-4 sm:p-6">
      <h2 class="text-lg font-semibold mb-4">${t('offerings.reportsTitle')}</h2>
      <p class="text-sm text-slate-500 mb-4">${t('offerings.reportsIntro')}</p>
      <div data-el="reports-list"></div>
    </div>
  `;

  const form = container.querySelector('[data-el="form"]');
  const submitBtn = form.querySelector('[data-el="submit-btn"]');
  const formStatusEl = form.querySelector('[data-el="form-status"]');
  const listEl = container.querySelector('[data-el="list"]');
  const periodTotalEl = container.querySelector('[data-el="period-total"]');
  const reportsListEl = container.querySelector('[data-el="reports-list"]');
  const removedListEl = container.querySelector('[data-el="removed-list"]');
  const memberListEl = container.querySelector('#offerings-member-list');
  const memberLinkStatusEl = container.querySelector('[data-el="member-link-status"]');
  const paymentMethodSelect = form.querySelector('[data-el="payment-method-select"]');
  const paymentMethodOtherWrap = form.querySelector('[data-el="payment-method-other-wrap"]');
  const currencySelect = form.querySelector('[data-el="currency-select"]');
  const currencyOtherWrap = form.querySelector('[data-el="currency-other-wrap"]');
  const importOpenBtn = container.querySelector('[data-el="import-open-btn"]');

  const importModal = createOfferingsImportModal({
    supabase,
    currentUserId,
    onImported: () => { loadCurrentPeriod(); loadReportHistory(); loadRecentlyRemoved(); },
  });
  importOpenBtn.addEventListener('click', () => importModal.open());

  form.elements.offering_date.valueAsDate = new Date();
  form.addEventListener('submit', handleSubmit);

  paymentMethodSelect.addEventListener('change', () => {
    paymentMethodOtherWrap.classList.toggle('hidden', paymentMethodSelect.value !== 'other');
  });

  currencySelect.addEventListener('change', () => {
    currencyOtherWrap.classList.toggle('hidden', currencySelect.value !== 'other');
  });

  // Optional member link: typing (or picking, via the datalist) a
  // name that exactly matches a real member silently links this
  // offering to them -- sql/057's trigger then mirrors it into
  // donation_entries so it counts toward their tax receipt. Anything
  // that doesn't match a member is just free text, same as before.
  //
  // Guest Donors (sql/065): a real church member who gives but has no
  // app account. Matching a name against the datalist's guest entries
  // links guest_donor_id instead of member_id -- same donation_entries
  // mirror and tax-receipt eligibility, just a lighter identity than a
  // full account. Finance manages guest donors (adding an email so
  // they can actually be sent their receipt) from the Tax Receipts
  // board, not here -- this page only ever links to an existing one.
  let membersByName = new Map();
  let guestDonorsByName = new Map();
  loadMemberOptions();
  form.elements.donor_name.addEventListener('input', updateMemberLinkStatus);

  async function loadMemberOptions() {
    const [{ data: members }, { data: guests }] = await Promise.all([
      supabase.from('profiles').select('id, full_name, is_silent').order('full_name'),
      supabase.from('guest_donors').select('id, name').order('name'),
    ]);
    // Silent members are real profiles rows, so they're already in this
    // list -- the " (Silent)" suffix is the only way to tell them apart
    // in a plain <datalist>, and has to be part of the matched key too
    // (it becomes the literal input value once picked).
    const memberDisplayNames = (members || []).map((p) => (p.is_silent ? `${p.full_name} (${t('users.silentBadge')})` : p.full_name));
    membersByName = new Map((members || []).map((p, i) => [memberDisplayNames[i], p.id]));
    guestDonorsByName = new Map((guests || []).map((g) => [g.name, g.id]));
    memberListEl.innerHTML = [
      ...memberDisplayNames,
      ...(guests || []).map((g) => g.name),
    ].map((name) => `<option value="${escapeAttr(name)}"></option>`).join('');
  }

  function updateMemberLinkStatus() {
    const name = form.elements.donor_name.value.trim();
    const matchedMember = membersByName.get(name);
    const matchedGuest = !matchedMember && guestDonorsByName.get(name);
    memberLinkStatusEl.textContent = matchedMember ? t('offerings.memberLinked') : matchedGuest ? t('offerings.guestDonorLinked') : '';
    memberLinkStatusEl.className = (matchedMember || matchedGuest) ? 'text-xs text-emerald-600 mt-1' : 'text-xs text-slate-400 mt-1';
  }

  loadCurrentPeriod();
  loadReportHistory();
  loadRecentlyRemoved();

  async function handleSubmit(e) {
    e.preventDefault();
    const donor_name = form.elements.donor_name.value.trim();
    const offering_date = form.elements.offering_date.value;
    const amountDollars = parseFloat(form.elements.amount.value);
    const offering_type = form.elements.offering_type.value;
    const payment_method = form.elements.payment_method.value;
    const payment_method_other = payment_method === 'other' ? form.elements.payment_method_other.value.trim() : null;
    const currency = form.elements.currency.value;
    const currency_other = currency === 'other' ? form.elements.currency_other.value.trim() : null;
    const member_id = membersByName.get(donor_name) || null;
    const guest_donor_id = member_id ? null : (guestDonorsByName.get(donor_name) || null);

    if (!donor_name || !offering_date || !(amountDollars > 0)) {
      formStatusEl.className = 'text-sm text-rose-600';
      formStatusEl.textContent = t('offerings.missingFields');
      return;
    }
    if (payment_method === 'other' && !payment_method_other) {
      formStatusEl.className = 'text-sm text-rose-600';
      formStatusEl.textContent = t('offerings.specifyPaymentMethod');
      return;
    }
    if (currency === 'other' && !currency_other) {
      formStatusEl.className = 'text-sm text-rose-600';
      formStatusEl.textContent = t('offerings.specifyCurrency');
      return;
    }

    submitBtn.disabled = true;
    formStatusEl.className = 'text-sm text-slate-500';
    formStatusEl.textContent = t('common.saving');

    const { error } = await supabase.from('offerings').insert({
      donor_name,
      offering_date,
      amount_cents: Math.round(amountDollars * 100),
      offering_type,
      payment_method,
      payment_method_other,
      currency,
      currency_other,
      member_id,
      guest_donor_id,
      recorded_by: currentUserId,
    });

    submitBtn.disabled = false;
    if (error) {
      formStatusEl.className = 'text-sm text-rose-600';
      formStatusEl.textContent = t('offerings.saveFailed', { message: error.message });
      return;
    }

    formStatusEl.className = 'text-sm text-emerald-600';
    formStatusEl.textContent = t('offerings.saved');
    form.reset();
    form.elements.offering_date.valueAsDate = new Date();
    paymentMethodOtherWrap.classList.add('hidden');
    currencyOtherWrap.classList.add('hidden');
    currencySelect.value = 'CAD';
    memberLinkStatusEl.textContent = '';
    loadCurrentPeriod();
  }

  // "Current period" = every offering not yet rolled into a closed
  // monthly report (report_period_id is null) -- sql/058's cron tags
  // them once it closes the month, at which point they drop off this
  // list and the next entry starts a fresh one.
  async function loadCurrentPeriod() {
    listEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;
    const { data, error } = await supabase
      .from('offerings')
      .select('id, donor_name, offering_date, amount_cents, offering_type, payment_method, payment_method_other, currency, currency_other, member_id, guest_donor_id, recorded_by, recorder:profiles!recorded_by ( full_name )')
      .is('report_period_id', null)
      .is('removed_at', null)
      .order('offering_date', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      listEl.innerHTML = `<p class="text-sm text-rose-600">${t('offerings.loadFailed', { message: error.message })}</p>`;
      periodTotalEl.textContent = '';
      return;
    }

    // Grouped by currency, never blended into one converted number --
    // a period with both CAD and USD offerings shows one subtotal per
    // currency rather than a meaningless combined figure.
    const totalsByCurrency = new Map();
    for (const row of data || []) {
      const label = currencyLabel(row);
      totalsByCurrency.set(label, (totalsByCurrency.get(label) || 0) + row.amount_cents);
    }
    periodTotalEl.textContent = Array.from(totalsByCurrency.entries())
      .map(([label, cents]) => t('offerings.periodTotal', { amount: centsToDollarsStr(cents), currency: label }))
      .join('   ');

    if (!data || data.length === 0) {
      listEl.innerHTML = `<p class="text-sm text-slate-400">${t('offerings.none')}</p>`;
      return;
    }

    listEl.innerHTML = `
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-slate-500 border-b border-slate-200">
              <th class="py-2 pr-3">${t('offerings.date')}</th>
              <th class="py-2 pr-3">${t('offerings.donorName')}</th>
              <th class="py-2 pr-3">${t('offerings.type')}</th>
              <th class="py-2 pr-3">${t('offerings.paymentMethod')}</th>
              <th class="py-2 pr-3 text-right">${t('offerings.amount')}</th>
              <th class="py-2 pr-3">${t('offerings.recordedBy')}</th>
              <th class="py-2"></th>
            </tr>
          </thead>
          <tbody data-el="rows"></tbody>
        </table>
      </div>
    `;
    const rowsEl = listEl.querySelector('[data-el="rows"]');
    rowsEl.innerHTML = data.map((row) => {
      const paymentLabel = row.payment_method === 'other' && row.payment_method_other
        ? row.payment_method_other
        : t(`offerings.paymentMethod.${row.payment_method}`);
      const nameCell = row.member_id
        ? `${escapeHtml(row.donor_name)} <span class="text-emerald-600" title="${escapeAttr(t('offerings.memberLinked'))}">✓</span>`
        : row.guest_donor_id
          ? `${escapeHtml(row.donor_name)} <span class="text-indigo-600" title="${escapeAttr(t('offerings.guestDonorLinked'))}">✓</span>`
          : escapeHtml(row.donor_name);
      return `
        <tr class="border-b border-slate-100" data-row-id="${row.id}">
          <td class="py-2 pr-3 whitespace-nowrap">${escapeHtml(row.offering_date)}</td>
          <td class="py-2 pr-3">${nameCell}</td>
          <td class="py-2 pr-3">${escapeHtml(t(`offerings.type.${row.offering_type}`))}</td>
          <td class="py-2 pr-3">${escapeHtml(paymentLabel)}</td>
          <td class="py-2 pr-3 text-right whitespace-nowrap">$${centsToDollarsStr(row.amount_cents)} <span class="text-slate-400">${escapeHtml(currencyLabel(row))}</span></td>
          <td class="py-2 pr-3 text-slate-500">${escapeHtml(row.recorder?.full_name || '—')}</td>
          <td class="py-2 text-right">${canDelete ? `<button type="button" data-action="delete" class="text-xs text-rose-600 hover:text-rose-700">${t('offerings.delete')}</button>` : ''}</td>
        </tr>
      `;
    }).join('');

    rowsEl.querySelectorAll('[data-action="delete"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('[data-row-id]');
        const id = row.dataset.rowId;
        const name = row.querySelector('td:nth-child(2)').textContent;
        // sql/066 requires a reason whenever an offering is removed --
        // the trigger rejects the update without one regardless of what
        // this dialog does, but asking for it up front avoids a round
        // trip failure.
        const reason = await confirmDialog({
          message: t('offerings.deleteConfirm', { name }),
          reasonLabel: t('offerings.deleteReasonLabel'),
          reasonPlaceholder: t('offerings.deleteReasonPlaceholder'),
        });
        if (!reason) return;
        // Soft delete (sql/063) -- recoverable for 90 days via the
        // "Recently removed" section below, same removed_at/restore
        // shape as members already use, not a real DELETE.
        const { error } = await supabase.from('offerings').update({
          removed_at: new Date().toISOString(),
          removed_by: currentUserId,
          removed_reason: reason,
        }).eq('id', id);
        if (error) { window.alert(t('offerings.deleteFailed', { message: error.message })); return; }
        loadCurrentPeriod();
        loadRecentlyRemoved();
      });
    });
  }

  // "Recently removed" -- same tenant's own Finance team only (not
  // Site Admin, see sql/063) can see and restore an offering they
  // soft-deleted, until the 90-day purge cron takes it for good.
  async function loadRecentlyRemoved() {
    removedListEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;
    const { data, error } = await supabase
      .from('offerings')
      .select('id, donor_name, offering_date, amount_cents, currency, currency_other, removed_at, removed_reason')
      .not('removed_at', 'is', null)
      .order('removed_at', { ascending: false });

    if (error) {
      removedListEl.innerHTML = `<p class="text-sm text-rose-600">${t('offerings.loadFailed', { message: error.message })}</p>`;
      return;
    }
    if (!data || data.length === 0) {
      removedListEl.innerHTML = `<p class="text-sm text-slate-400">${t('offerings.noneRemoved')}</p>`;
      return;
    }

    removedListEl.innerHTML = data.map((row) => `
      <div class="py-2 border-b border-slate-100 last:border-0 text-sm" data-row-id="${row.id}">
        <div class="flex items-center justify-between">
          <span>${escapeHtml(row.offering_date)} — ${escapeHtml(row.donor_name)} — $${centsToDollarsStr(row.amount_cents)} ${escapeHtml(currencyLabel(row))}</span>
          ${canDelete ? `<button type="button" data-action="restore" class="text-indigo-600 hover:text-indigo-700 font-medium">${t('offerings.restore')}</button>` : ''}
        </div>
        ${row.removed_reason ? `<p class="text-xs text-slate-400 mt-0.5">${t('offerings.deleteReasonLabel')}: ${escapeHtml(row.removed_reason)}</p>` : ''}
      </div>
    `).join('');

    removedListEl.querySelectorAll('[data-action="restore"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.closest('[data-row-id]').dataset.rowId;
        const { error: restoreError } = await supabase.from('offerings').update({ removed_at: null, removed_by: null, removed_reason: null }).eq('id', id);
        if (restoreError) { window.alert(t('offerings.restoreFailed', { message: restoreError.message })); return; }
        loadCurrentPeriod();
        loadRecentlyRemoved();
      });
    });
  }

  async function loadReportHistory() {
    reportsListEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;
    const { data, error } = await supabase
      .from('offering_report_periods')
      .select('id, period_start, period_end, status, pdf_storage_path, generated_at')
      .order('period_start', { ascending: false });

    if (error) {
      reportsListEl.innerHTML = `<p class="text-sm text-rose-600">${t('offerings.loadFailed', { message: error.message })}</p>`;
      return;
    }
    if (!data || data.length === 0) {
      reportsListEl.innerHTML = `<p class="text-sm text-slate-400">${t('offerings.noReports')}</p>`;
      return;
    }

    reportsListEl.innerHTML = data.map((row) => `
      <div class="flex items-center justify-between py-2 border-b border-slate-100 last:border-0 text-sm">
        <span>${escapeHtml(row.period_start)} — ${escapeHtml(row.period_end)}</span>
        <span>${row.pdf_storage_path
          ? `<a href="#" data-period-id="${escapeAttr(row.id)}" class="text-indigo-600 hover:text-indigo-700 font-medium" data-action="download">${t('offerings.downloadPdf')}</a>`
          : `<span class="text-slate-400">${t('offerings.pdfPending')}</span>`}</span>
      </div>
    `).join('');

    // PDFs live in Cloudflare R2 (offering-reports Edge Function), not
    // Supabase Storage -- the function re-checks can_manage_finance()
    // itself server-side before handing back a short-lived signed URL,
    // same "never trust the client" pattern as course-video-r2.
    reportsListEl.querySelectorAll('[data-action="download"]').forEach((link) => {
      link.addEventListener('click', async (e) => {
        e.preventDefault();
        const periodId = link.dataset.periodId;
        const { data, error } = await supabase.functions.invoke('offering-reports', {
          body: { action: 'download_url', period_id: periodId },
        });
        if (error || !data?.url) {
          window.alert(t('offerings.downloadFailed', { message: error?.message || 'Unknown error' }));
          return;
        }
        window.open(data.url, '_blank');
      });
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return escapeHtml(str).replaceAll('"', '&quot;');
  }
}
