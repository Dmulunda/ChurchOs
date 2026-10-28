// Import historical Offering records (Excel/CSV, or a best-effort PDF
// parse) into the system that already runs today — same two-step
// upload/review shape as taxDonationImport.js (parse, editable preview
// table, confirmDialog() before committing), adapted for offering rows
// (name/date/amount/type/payment method) instead of plain donations.
//
// A row dated in the current (still-open) month is inserted exactly
// like a manual entry from offeringsBoard.js (report_period_id left
// null) -- it shows up in "This Month's Offerings" and gets swept into
// a PDF by the regular monthly cron, same as anything typed in by hand.
// A row dated in a past month gets its own closed report period
// (get_or_create_offering_period RPC, sql/059) so it doesn't pollute
// the current ledger, and this import then asks the offering-reports
// Edge Function to (re)generate that month's PDF on the spot --
// imported history still ends up with a real "bank statement" PDF,
// not just raw rows.
//
// Linking a row to a real member (same fuzzy match as taxDonationImport,
// js/utils/nameMatch.js) mirrors it into donation_entries via the
// existing offerings trigger (sql/057) -- so an imported historical
// offering counts toward that member's tax receipt exactly like one
// entered by hand.
//
// Likely duplicates (same donor name + date + amount as an offering
// already on file, or repeated within this same batch -- catches
// re-uploading the same file, or re-uploading with an overlapping
// date range) are detected once per file (markDuplicates()) and
// automatically excluded from the import, reported as a count rather
// than reviewed row by row.
//
// A row can also link to a Guest Donor (sql/065) instead -- a real
// church member who gives but has no app account. The donor-identity
// column offers existing members AND existing guest donors (fuzzy-
// matched together, whichever scores higher), plus a "+ New guest
// donor" option that reveals inline name/email inputs; new guests are
// created once per distinct name+email in the batch, then linked the
// same way a member match is.
import { t } from '../i18n.js';
import { confirmDialog } from './confirmDialog.js';
import { findBestMatch } from '../utils/nameMatch.js';
import { extractFunctionErrorMessage } from '../utils/edgeFunctionError.js';

const OFFERING_TYPES = ['tithe', 'general', 'sacrifice', 'construction', 'other'];
const PAYMENT_METHODS = ['cash', 'transfer', 'check', 'other'];
const CURRENCIES = ['CAD', 'USD', 'EUR', 'other'];

const NAME_HEADERS = ['name', 'fullname', 'donorname', 'donor', 'nom', 'nomcomplet', 'donateur'];
const DATE_HEADERS = ['date', 'offeringdate', 'donationdate', 'datededon', 'dateoffrande'];
const AMOUNT_HEADERS = ['amount', 'montant', 'don', 'donation', 'offering', 'offrande'];
const TYPE_HEADERS = ['type', 'offeringtype', 'typedoffrande', 'category', 'categorie'];
const PAYMENT_HEADERS = ['paymentmethod', 'payment', 'method', 'modedepaiement', 'mode'];
const CURRENCY_HEADERS = ['currency', 'devise'];

const TYPE_ALIASES = {
  tithe: ['tithe', 'dime'],
  general: ['general', 'offrande', 'ordinaire', 'ordinary'],
  sacrifice: ['sacrifice'],
  construction: ['construction', 'batiment'],
};

const PAYMENT_ALIASES = {
  cash: ['cash', 'especes', 'comptant'],
  transfer: ['transfer', 'virement', 'wire', 'etransfer', 'interac'],
  check: ['check', 'cheque'],
};

function normalizeToken(str) {
  return String(str || '')
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '');
}

function findHeaderKey(sampleRow, candidates) {
  const keys = Object.keys(sampleRow || {});
  return keys.find((k) => candidates.includes(normalizeToken(k))) || null;
}

function toIsoDate(raw) {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw.toISOString().slice(0, 10);
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return '';
}

function toAmount(raw) {
  const cleaned = String(raw ?? '').replace(/[^0-9.-]/g, '');
  const value = parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
}

// Matches a free-text value (spreadsheet cell or PDF-extracted word)
// against our fixed enum via small alias lists -- anything unrecognized
// falls back to the given default (type) or 'other' + the raw text
// kept for "please specify" (payment method).
function resolveType(raw) {
  const norm = normalizeToken(raw);
  if (!norm) return 'general';
  if (OFFERING_TYPES.includes(norm)) return norm;
  for (const [key, aliases] of Object.entries(TYPE_ALIASES)) {
    if (aliases.some((a) => norm.includes(a))) return key;
  }
  return 'general';
}

function resolvePaymentMethod(raw) {
  const norm = normalizeToken(raw);
  if (!norm) return { payment_method: 'cash', payment_method_other: null };
  if (PAYMENT_METHODS.includes(norm)) return { payment_method: norm, payment_method_other: null };
  for (const [key, aliases] of Object.entries(PAYMENT_ALIASES)) {
    if (aliases.some((a) => norm.includes(a))) return { payment_method: key, payment_method_other: null };
  }
  return { payment_method: 'other', payment_method_other: String(raw).trim() };
}

// No alias list -- unlike type/payment method, a currency column
// (when present at all) is almost always already a real ISO code
// (CAD/USD/EUR), so this only needs an exact match; anything else
// falls through to 'other' with the raw text kept for "please
// specify", same shape as resolvePaymentMethod above. Defaults to CAD
// when there's no currency column at all (the common case -- existing
// import files need no changes).
function resolveCurrency(raw) {
  const norm = String(raw || '').trim().toUpperCase();
  if (!norm) return { currency: 'CAD', currency_other: null };
  if (CURRENCIES.includes(norm)) return { currency: norm, currency_other: null };
  return { currency: 'other', currency_other: String(raw).trim() };
}

function monthKey(isoDate) {
  return isoDate.slice(0, 7); // YYYY-MM
}

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// ---- PDF best-effort parsing (acknowledged up front as much less
// reliable than Excel/CSV -- every row it produces still goes through
// the same editable preview as a spreadsheet import, nothing is ever
// applied without review) ----
// 3.11.174 (the first version tried here) never shipped an ESM build at
// all -- only build/pdf.min.js (UMD/global), no .mjs -- which made this
// dynamic import() 404 against the CDN every time. pdfjs-dist only
// started publishing build/pdf.min.mjs/pdf.worker.min.mjs from 4.x on;
// confirmed reachable on jsdelivr before pinning.
const PDFJS_VERSION = '4.0.379';
let pdfjsLibPromise = null;
function loadPdfJs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import(`https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.mjs`).then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;
      return lib;
    });
  }
  return pdfjsLibPromise;
}

async function extractPdfLines(file) {
  const pdfjsLib = await loadPdfJs();
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const lines = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const byLineY = new Map();
    for (const item of content.items) {
      const y = Math.round(item.transform[5]);
      if (!byLineY.has(y)) byLineY.set(y, []);
      byLineY.get(y).push(item);
    }
    const sortedYs = Array.from(byLineY.keys()).sort((a, b) => b - a);
    for (const y of sortedYs) {
      const text = byLineY.get(y)
        .sort((a, b) => a.transform[4] - b.transform[4])
        .map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
      if (text) lines.push(text);
    }
  }
  return lines;
}

const PDF_DATE_RE = /\b(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/;
const PDF_AMOUNT_RE = /\$?\s?(\d{1,3}(?:[ ,]\d{3})*(?:\.\d{2})?)\s*\$?/g;

function parsePdfLineToRow(line) {
  const dateMatch = line.match(PDF_DATE_RE);
  if (!dateMatch) return null;

  let withoutDate = line.slice(0, dateMatch.index) + line.slice(dateMatch.index + dateMatch[0].length);

  // Last number on the line (after the date is removed) is the amount --
  // in a statement-style row the running description comes first, the
  // figure comes last.
  const amountMatches = [...withoutDate.matchAll(PDF_AMOUNT_RE)].filter((m) => m[1].replace(/[ ,]/g, '').length > 0);
  if (amountMatches.length === 0) return null;
  const lastAmount = amountMatches[amountMatches.length - 1];
  const amount = toAmount(lastAmount[1]);
  if (amount === null) return null;

  const name = (withoutDate.slice(0, lastAmount.index) + withoutDate.slice(lastAmount.index + lastAmount[0].length))
    .replace(/[|•·,;:\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return { raw_name: name, donation_date: toIsoDate(dateMatch[0]), amount, offering_type: 'general', payment_method: 'cash', payment_method_other: null, currency: 'CAD', currency_other: null };
}

export function createOfferingsImportModal({ supabase, currentUserId, onImported }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-6xl max-h-[90vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-2">
        <h2 class="text-xl font-bold">${t('offeringsImport.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <p class="text-xs text-slate-500 mb-1">${t('offeringsImport.intro')}</p>
      <p class="text-xs text-amber-600 mb-4">${t('offeringsImport.pdfWarning')}</p>

      <div data-el="upload-step">
        <input type="file" data-el="file-input" accept=".xlsx,.xls,.csv,.pdf" class="block w-full text-sm mb-2" />
        <p class="text-xs text-slate-500">${t('offeringsImport.columnsHint')}</p>
      </div>

      <div data-el="preview-step" class="hidden">
        <div class="overflow-x-auto border border-slate-200 rounded-lg mb-2">
          <table class="w-full text-sm">
            <thead class="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
              <tr>
                <th class="text-left px-3 py-2">${t('offeringsImport.colName')}</th>
                <th class="text-left px-3 py-2">${t('offeringsImport.colDate')}</th>
                <th class="text-left px-3 py-2">${t('offeringsImport.colAmount')}</th>
                <th class="text-left px-3 py-2">${t('offeringsImport.colType')}</th>
                <th class="text-left px-3 py-2">${t('offeringsImport.colPaymentMethod')}</th>
                <th class="text-left px-3 py-2">${t('offeringsImport.colCurrency')}</th>
                <th class="text-left px-3 py-2">${t('offeringsImport.colMember')}</th>
                <th class="text-left px-3 py-2">${t('offeringsImport.colStatus')}</th>
              </tr>
            </thead>
            <tbody data-el="preview-body" class="divide-y divide-slate-100"></tbody>
          </table>
        </div>

        <p data-el="summary" class="text-sm text-slate-600 mb-4"></p>

        <div class="flex justify-end gap-2">
          <button type="button" data-action="reset" class="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            ${t('offeringsImport.chooseAnotherFile')}
          </button>
          <button type="button" data-el="import-btn" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
            ${t('offeringsImport.startImport')}
          </button>
        </div>
      </div>

      <div data-el="progress" class="mt-4 text-sm space-y-1"></div>
    </div>
  `;
  document.body.appendChild(root);

  const fileInput = root.querySelector('[data-el="file-input"]');
  const uploadStepEl = root.querySelector('[data-el="upload-step"]');
  const previewStepEl = root.querySelector('[data-el="preview-step"]');
  const previewBodyEl = root.querySelector('[data-el="preview-body"]');
  const summaryEl = root.querySelector('[data-el="summary"]');
  const importBtn = root.querySelector('[data-el="import-btn"]');
  const progressEl = root.querySelector('[data-el="progress"]');

  let profiles = [];
  let rows = [];

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  root.querySelector('[data-action="reset"]').addEventListener('click', resetToUpload);
  fileInput.addEventListener('change', handleFile);
  previewBodyEl.addEventListener('change', handleRowFieldChange);
  importBtn.addEventListener('click', runImport);

  async function loadProfiles() {
    const { data: members } = await supabase.from('profiles').select('id, full_name, is_silent').order('full_name');
    profiles = members || [];
  }

  // A row is a likely duplicate if an offering already on file (or an
  // earlier row already in THIS same batch) has the exact same donor
  // name, date, and amount -- catches re-uploading the same file, or
  // re-uploading with an overlapping date range (e.g. Jan–Oct, then
  // Jul–Dec next time). Name is trimmed/lowercased for the comparison
  // so trivial formatting differences don't hide a real duplicate,
  // but otherwise this is an exact match, not fuzzy -- two different
  // people who happen to share a name, date, and amount are rare
  // enough that a stricter match would risk hiding real duplicates.
  function offeringSignature(name, date, amountDollars) {
    return `${String(name || '').trim().toLowerCase()}|${date}|${Math.round(Number(amountDollars) * 100)}`;
  }

  async function markDuplicates(targetRows) {
    const validDates = targetRows.map((r) => r.donation_date).filter(Boolean);
    if (validDates.length === 0) return;
    const minDate = validDates.reduce((a, b) => (b < a ? b : a));
    const maxDate = validDates.reduce((a, b) => (b > a ? b : a));

    const { data: existing, error } = await supabase
      .from('offerings')
      .select('donor_name, offering_date, amount_cents')
      .gte('offering_date', minDate)
      .lte('offering_date', maxDate)
      .is('removed_at', null);
    if (error) return; // best-effort -- an import shouldn't hard-fail just because this check couldn't run

    const seen = new Set((existing || []).map((o) => offeringSignature(o.donor_name, o.offering_date, o.amount_cents / 100)));
    for (const row of targetRows) {
      if (!row.raw_name || !row.donation_date || !(row.amount > 0)) continue;
      const sig = offeringSignature(row.raw_name, row.donation_date, row.amount);
      row.isDuplicate = seen.has(sig);
      seen.add(sig); // a second occurrence of the same signature within this batch is also a duplicate
    }
  }

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (profiles.length === 0) await loadProfiles();

    const isPdf = /\.pdf$/i.test(file.name);
    let parsedRows;
    try {
      parsedRows = isPdf ? await parsePdf(file) : await parseSpreadsheet(file);
    } catch (err) {
      window.alert(t('offeringsImport.parseFailed', { message: err.message }));
      fileInput.value = '';
      return;
    }

    if (parsedRows.length === 0) {
      window.alert(isPdf ? t('offeringsImport.pdfNoRows') : t('offeringsImport.emptyFile'));
      fileInput.value = '';
      return;
    }

    // Fuzzy-match against profiles -- Silent users are real profiles
    // rows too, so they're already included here, no separate lookup.
    rows = parsedRows.map((row, index) => {
      const best = row.raw_name ? findBestMatch(row.raw_name, profiles) : null;
      return {
        index,
        raw_name: row.raw_name,
        donation_date: row.donation_date,
        amount: row.amount,
        offering_type: row.offering_type,
        payment_method: row.payment_method,
        payment_method_other: row.payment_method_other,
        currency: row.currency,
        currency_other: row.currency_other,
        memberId: best ? best.id : null,
        isNewPerson: false,
        newPersonName: '',
        newPersonEmail: '',
        suggestedScore: best ? best.score : null,
        isDuplicate: false,
      };
    });

    await markDuplicates(rows);

    renderPreview();
    uploadStepEl.classList.add('hidden');
    previewStepEl.classList.remove('hidden');
  }

  async function parseSpreadsheet(file) {
    const buffer = await file.arrayBuffer();
    const workbook = window.XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawRows = window.XLSX.utils.sheet_to_json(firstSheet, { defval: '' });
    if (rawRows.length === 0) return [];

    const nameKey = findHeaderKey(rawRows[0], NAME_HEADERS);
    const dateKey = findHeaderKey(rawRows[0], DATE_HEADERS);
    const amountKey = findHeaderKey(rawRows[0], AMOUNT_HEADERS);
    const typeKey = findHeaderKey(rawRows[0], TYPE_HEADERS);
    const paymentKey = findHeaderKey(rawRows[0], PAYMENT_HEADERS);
    const currencyKey = findHeaderKey(rawRows[0], CURRENCY_HEADERS);

    return rawRows.map((raw) => {
      const payment = paymentKey ? resolvePaymentMethod(raw[paymentKey]) : { payment_method: 'cash', payment_method_other: null };
      const currencyResolved = currencyKey ? resolveCurrency(raw[currencyKey]) : { currency: 'CAD', currency_other: null };
      return {
        raw_name: nameKey ? String(raw[nameKey] || '').trim() : '',
        donation_date: dateKey ? toIsoDate(raw[dateKey]) : '',
        amount: amountKey ? toAmount(raw[amountKey]) : null,
        offering_type: typeKey ? resolveType(raw[typeKey]) : 'general',
        payment_method: payment.payment_method,
        payment_method_other: payment.payment_method_other,
        currency: currencyResolved.currency,
        currency_other: currencyResolved.currency_other,
      };
    });
  }

  async function parsePdf(file) {
    const lines = await extractPdfLines(file);
    return lines.map(parsePdfLineToRow).filter(Boolean);
  }

  function renderPreview() {
    previewBodyEl.innerHTML = rows.map((row) => {
      const warnings = [];
      if (!row.raw_name) warnings.push(t('offeringsImport.warnMissingName'));
      if (!row.donation_date) warnings.push(t('offeringsImport.warnMissingDate'));
      if (row.amount === null || row.amount <= 0) warnings.push(t('offeringsImport.warnMissingAmount'));
      if (row.currency === 'other' && !row.currency_other) warnings.push(t('offerings.specifyCurrency'));
      if (!row.memberId && !(row.isNewPerson && row.newPersonName.trim())) warnings.push(t('offeringsImport.warnNoMember'));

      const statusHtml = row.isDuplicate
        ? `<span class="text-slate-500 font-medium">${t('offeringsImport.statusDuplicate')}</span>`
        : warnings.length > 0
          ? `<span class="text-amber-600">${escapeHtml(warnings.join('; '))}</span>`
          : row.suggestedScore !== null
            ? `<span class="text-emerald-600">${t('offeringsImport.statusSuggested', { score: row.suggestedScore })}</span>`
            : `<span class="text-emerald-600">${t('offeringsImport.statusOk')}</span>`;

      return `
        <tr data-row-index="${row.index}" class="${row.isDuplicate ? 'bg-slate-100 opacity-60' : row.raw_name ? '' : 'bg-rose-50'}">
          <td class="px-2 py-1.5"><input type="text" data-field="raw_name" data-row="${row.index}" value="${escapeAttr(row.raw_name)}" class="w-full border border-slate-200 rounded px-2 py-1" /></td>
          <td class="px-2 py-1.5"><input type="date" data-field="donation_date" data-row="${row.index}" value="${row.donation_date}" class="w-full border border-slate-200 rounded px-2 py-1" /></td>
          <td class="px-2 py-1.5"><input type="number" step="0.01" min="0" data-field="amount" data-row="${row.index}" value="${row.amount ?? ''}" class="w-24 border border-slate-200 rounded px-2 py-1" /></td>
          <td class="px-2 py-1.5">
            <select data-field="offering_type" data-row="${row.index}" class="w-full border border-slate-200 rounded px-2 py-1">
              ${OFFERING_TYPES.map((v) => `<option value="${v}" ${row.offering_type === v ? 'selected' : ''}>${escapeHtml(t(`offerings.type.${v}`))}</option>`).join('')}
            </select>
          </td>
          <td class="px-2 py-1.5">
            <select data-field="payment_method" data-row="${row.index}" class="w-full border border-slate-200 rounded px-2 py-1 mb-1">
              ${PAYMENT_METHODS.map((v) => `<option value="${v}" ${row.payment_method === v ? 'selected' : ''}>${escapeHtml(t(`offerings.paymentMethod.${v}`))}</option>`).join('')}
            </select>
            ${row.payment_method === 'other'
              ? `<input type="text" data-field="payment_method_other" data-row="${row.index}" value="${escapeAttr(row.payment_method_other || '')}" placeholder="${escapeAttr(t('offeringsImport.otherSpecifyPlaceholder'))}" class="w-full border border-slate-200 rounded px-2 py-1" />`
              : ''}
          </td>
          <td class="px-2 py-1.5">
            <select data-field="currency" data-row="${row.index}" class="w-full border border-slate-200 rounded px-2 py-1 mb-1">
              ${CURRENCIES.map((v) => `<option value="${v}" ${row.currency === v ? 'selected' : ''}>${v === 'other' ? escapeHtml(t('offerings.currencyOther')) : v}</option>`).join('')}
            </select>
            ${row.currency === 'other'
              ? `<input type="text" data-field="currency_other" data-row="${row.index}" value="${escapeAttr(row.currency_other || '')}" placeholder="${escapeAttr(t('offerings.currencyOtherPlaceholder'))}" class="w-full border border-slate-200 rounded px-2 py-1" />`
              : ''}
          </td>
          <td class="px-2 py-1.5">
            <select data-field="donorIdentity" data-row="${row.index}" class="w-full border border-slate-200 rounded px-2 py-1 mb-1">
              <option value="" ${!row.memberId && !row.isNewPerson ? 'selected' : ''}>${t('offeringsImport.noMember')}</option>
              ${profiles.length ? `<optgroup label="${escapeAttr(t('offeringsImport.optgroupMembers'))}">
                ${profiles.map((p) => `<option value="m:${p.id}" ${row.memberId === p.id ? 'selected' : ''}>${escapeHtml(p.full_name)}${p.is_silent ? ` (${escapeHtml(t('users.silentBadge'))})` : ''}</option>`).join('')}
              </optgroup>` : ''}
              <option value="new" ${row.isNewPerson ? 'selected' : ''}>${t('offeringsImport.newSilentUser')}</option>
            </select>
            ${row.isNewPerson ? `
              <input type="text" data-field="newPersonName" data-row="${row.index}" value="${escapeAttr(row.newPersonName)}" placeholder="${escapeAttr(t('offeringsImport.newPersonNamePlaceholder'))}" class="w-full border border-slate-200 rounded px-2 py-1 mb-1" />
              <input type="email" data-field="newPersonEmail" data-row="${row.index}" value="${escapeAttr(row.newPersonEmail)}" placeholder="${escapeAttr(t('offeringsImport.newPersonEmailPlaceholder'))}" class="w-full border border-slate-200 rounded px-2 py-1" />
            ` : ''}
          </td>
          <td class="px-2 py-1.5 text-xs">${statusHtml}</td>
        </tr>
      `;
    }).join('');

    updateSummary();
  }

  function handleRowFieldChange(e) {
    const field = e.target.dataset.field;
    if (!field) return;
    const row = rows.find((r) => r.index === Number(e.target.dataset.row));
    if (!row) return;

    if (field === 'donorIdentity') {
      const value = e.target.value;
      row.memberId = null;
      row.isNewPerson = false;
      row.suggestedScore = null;
      if (value === 'new') { row.isNewPerson = true; row.newPersonName = row.newPersonName || row.raw_name; }
      else if (value.startsWith('m:')) row.memberId = value.slice(2);
      renderPreview();
      return;
    }
    if (field === 'newPersonName' || field === 'newPersonEmail') { row[field] = e.target.value; return; }
    if (field === 'amount') { row.amount = toAmount(e.target.value); return; }
    if (field === 'payment_method') {
      row.payment_method = e.target.value;
      if (row.payment_method !== 'other') row.payment_method_other = null;
      renderPreview();
      return;
    }
    if (field === 'currency') {
      row.currency = e.target.value;
      if (row.currency !== 'other') row.currency_other = null;
      renderPreview();
      return;
    }
    row[field] = e.target.value;
  }

  function importableRows() {
    return rows.filter((r) => r.raw_name && r.donation_date && r.amount > 0 && !r.isDuplicate
      && (r.currency !== 'other' || r.currency_other));
  }

  function updateSummary() {
    const validRows = importableRows();
    const matchedCount = validRows.filter((r) => r.memberId || (r.isNewPerson && r.newPersonName.trim())).length;
    const unmatchedCount = validRows.length - matchedCount;
    const duplicateCount = rows.filter((r) => r.isDuplicate).length;
    const skippedCount = rows.length - validRows.length - duplicateCount;

    summaryEl.textContent = t('offeringsImport.summary', { matched: matchedCount, unmatched: unmatchedCount, skipped: skippedCount })
      + (duplicateCount > 0 ? ' ' + t('offeringsImport.summaryDuplicates', { count: duplicateCount }) : '');
    importBtn.disabled = validRows.length === 0;
  }

  function resetToUpload() {
    rows = [];
    fileInput.value = '';
    progressEl.innerHTML = '';
    previewStepEl.classList.add('hidden');
    uploadStepEl.classList.remove('hidden');
  }

  function logLine(text, tone = 'info') {
    const line = document.createElement('div');
    line.className = tone === 'error' ? 'text-rose-600' : tone === 'success' ? 'text-emerald-600' : 'text-slate-600';
    line.textContent = text;
    progressEl.appendChild(line);
    progressEl.scrollTop = progressEl.scrollHeight;
  }

  async function runImport() {
    const validRows = importableRows();
    const matchedCount = validRows.filter((r) => r.memberId || (r.isNewPerson && r.newPersonName.trim())).length;
    const unmatchedCount = validRows.length - matchedCount;
    const duplicateCount = rows.filter((r) => r.isDuplicate).length;

    const confirmMsg = t('offeringsImport.confirmMessage', { matched: matchedCount, unmatched: unmatchedCount })
      + (duplicateCount > 0 ? ' ' + t('offeringsImport.confirmMessageDuplicates', { count: duplicateCount }) : '');
    if (!(await confirmDialog({
      message: confirmMsg,
      confirmLabel: t('offeringsImport.startImport'),
      danger: false,
    }))) return;

    importBtn.disabled = true;
    progressEl.innerHTML = '';

    // New Silent Users: one creation per distinct name+email in this
    // batch -- two rows for the same person in one spreadsheet share a
    // single new profile rather than creating a duplicate each time.
    const newPersonKey = (row) => `${row.newPersonName.trim()}\u0000${row.newPersonEmail.trim()}`;
    const newPersonRows = validRows.filter((r) => r.isNewPerson && r.newPersonName.trim());
    const profileIdByKey = new Map();
    for (const row of newPersonRows) {
      const key = newPersonKey(row);
      if (profileIdByKey.has(key)) continue;
      const { data, error } = await supabase.functions.invoke('create-silent-user', {
        body: { full_name: row.newPersonName.trim(), email: row.newPersonEmail.trim() || undefined },
      });
      if (error) {
        const message = await extractFunctionErrorMessage(error);
        window.alert(t('offeringsImport.batchFailed', { message }));
        logLine(t('offeringsImport.batchFailed', { message }), 'error');
        importBtn.disabled = false;
        return;
      }
      profileIdByKey.set(key, data.profile_id);
    }
    for (const row of newPersonRows) row.memberId = profileIdByKey.get(newPersonKey(row));

    // Rows in the still-open current month join the normal ledger
    // (report_period_id null, same as a manual entry). Rows in a past
    // month need their own closed period -- resolved once per distinct
    // month via get_or_create_offering_period, then reused for every
    // row that falls in it.
    const thisMonth = currentMonthKey();
    const periodIdByMonth = new Map();
    for (const row of validRows) {
      const key = monthKey(row.donation_date);
      if (key === thisMonth || periodIdByMonth.has(key)) continue;
      const { data: periodId, error } = await supabase.rpc('get_or_create_offering_period', { p_date: row.donation_date });
      if (error) {
        window.alert(t('offeringsImport.batchFailed', { message: error.message }));
        logLine(t('offeringsImport.batchFailed', { message: error.message }), 'error');
        importBtn.disabled = false;
        return;
      }
      periodIdByMonth.set(key, periodId);
    }

    const { error: insertError } = await supabase.from('offerings').insert(validRows.map((row) => {
      const key = monthKey(row.donation_date);
      return {
        donor_name: row.raw_name,
        offering_date: row.donation_date,
        amount_cents: Math.round(row.amount * 100),
        offering_type: row.offering_type,
        payment_method: row.payment_method,
        payment_method_other: row.payment_method_other,
        currency: row.currency,
        currency_other: row.currency_other,
        member_id: row.memberId,
        recorded_by: currentUserId,
        report_period_id: key === thisMonth ? null : periodIdByMonth.get(key),
      };
    }));

    if (insertError) {
      window.alert(t('offeringsImport.batchFailed', { message: insertError.message }));
      logLine(t('offeringsImport.batchFailed', { message: insertError.message }), 'error');
      importBtn.disabled = false;
      return;
    }

    logLine(t('offeringsImport.allDone', { count: validRows.length }), 'success');
    if (duplicateCount > 0) logLine(t('offeringsImport.allDoneDuplicatesSkipped', { count: duplicateCount }), 'info');

    const pastPeriodIds = Array.from(periodIdByMonth.entries()).filter(([key]) => key !== thisMonth);
    const pdfErrorPeriods = [];
    if (pastPeriodIds.length > 0) {
      logLine(t('offeringsImport.generatingPdfs'));
      for (const [key, periodId] of pastPeriodIds) {
        const { error } = await supabase.functions.invoke('offering-reports', {
          body: { action: 'generate_for_period', period_id: periodId },
        });
        if (error) {
          logLine(t('offeringsImport.pdfGenFailed', { period: key, message: error.message }), 'error');
          pdfErrorPeriods.push(key);
        }
      }
    }

    importBtn.disabled = false;
    onImported?.();

    // The progress log above sits below a preview table that can run
    // to hundreds of rows -- easy to scroll past without ever seeing
    // it, which is exactly why a completed import could look like it
    // did nothing. A blocking alert (same as this file already uses
    // for a parse failure) can't be missed, so success closes the
    // modal and reports the same unambiguous way the error paths above
    // already do.
    let doneMessage = t('offeringsImport.allDone', { count: validRows.length });
    if (duplicateCount > 0) doneMessage += ' ' + t('offeringsImport.allDoneDuplicatesSkipped', { count: duplicateCount });
    if (pdfErrorPeriods.length > 0) doneMessage += ' ' + t('offeringsImport.allDonePdfErrors', { periods: pdfErrorPeriods.join(', ') });
    window.alert(doneMessage);
    close();
  }

  function open() {
    resetToUpload();
    root.classList.remove('hidden');
    root.classList.add('flex');
    loadProfiles();
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  return { open, root };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(str).replaceAll('"', '&quot;');
}
