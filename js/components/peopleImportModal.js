// Super-Admin-only bulk "Import People" tool — reads a spreadsheet
// (.xlsx/.xls/.csv) via SheetJS (window.XLSX, loaded in index.html), or a
// roster PDF (text extracted client-side via pdf.js, then structured by
// the parse-roster-pdf Edge Function) and creates many people at once.
// Each "member" row's Access decides what actually happens:
//   - 'real' gets a real Supabase Auth account, exactly like
//     userCreatorModal.js's one-at-a-time flow (scopedClient.signUp()
//     so the admin's own session isn't touched), sharing ONE temp
//     password across the whole batch — everyone imported this way
//     logs in with it once and changes it themselves afterward.
//   - 'silent' calls the same create-silent-user Edge Function
//     userCreatorModal.js's silent toggle uses — no login access, just a
//     real profile, for someone who isn't ready for an account yet.
//   - 'existing' creates nothing: the row is recognized as someone
//     already in the system (real or silent), so only a department
//     membership gets added, if one was picked.
// "Visitor" rows never get an account at all — they go straight into
// guest_follow_ups, the same table the Guest Onboarding Hub already
// manages, since a visitor has no login concept in this app.
// Real-account signups are paced (SIGNUP_DELAY_MS) since Supabase
// throttles how fast new accounts can be created from one client;
// create-silent-user goes through the admin API instead and isn't
// throttled the same way, so silent rows run back-to-back.
import { createScopedClient } from '../supabaseClient.js';
import { departmentLabel, t } from '../i18n.js';
import { confirmDialog } from './confirmDialog.js';
import { getTenantId } from '../tenant.js';
import { extractFunctionErrorMessage } from '../utils/edgeFunctionError.js';

const SIGNUP_DELAY_MS = 400;
const MATCH_THRESHOLD = 0.7;
// A wide spreadsheet exported/printed to PDF without "fit to page width"
// can easily run to dozens of pages (each column-chunk of the sheet
// becomes its own page) -- Claude Sonnet 5's context window comfortably
// fits far more than this, so the cap exists only to keep requests
// bounded, not because more would fail; see parsePdfFile() below for why
// every page is kept and labeled rather than silently truncated.
const PDF_TEXT_LIMIT = 120000;
// Both English and French header names are recognized (this church runs
// bilingually) — normalizeHeader() strips accents before matching, so
// "Département"/"Téléphone" match their unaccented candidates below.
const NAME_HEADERS = ['name', 'fullname', 'nom', 'nomcomplet'];
const EMAIL_HEADERS = ['email', 'emailaddress', 'courriel', 'mail'];
const PHONE_HEADERS = ['phone', 'telephone', 'tel', 'phonenumber', 'numero', 'numerodetelephone'];
const TYPE_HEADERS = ['type', 'status', 'membertype', 'statut'];
const DEPARTMENT_HEADERS = ['department', 'dept', 'ministry', 'departement', 'ministere'];

function normalizeHeader(header) {
  return String(header || '')
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z]/g, '');
}

function findHeaderKey(sampleRow, candidates) {
  const keys = Object.keys(sampleRow || {});
  return keys.find((k) => candidates.includes(normalizeHeader(k))) || null;
}

function resolveType(raw) {
  const normalized = String(raw || '').trim().toLowerCase();
  return normalized.includes('visit') || normalized.includes('guest') ? 'visitor' : 'member';
}

function slugifyName(fullName) {
  return String(fullName || 'member')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .split(/\s+/)
    .join('.') || 'member';
}

function generatePlaceholderEmail(fullName, usedEmails) {
  const base = slugifyName(fullName);
  let candidate = `${base}@vpd.local`;
  let suffix = 2;
  while (usedEmails.has(candidate.toLowerCase())) {
    candidate = `${base}${suffix}@vpd.local`;
    suffix += 1;
  }
  return candidate;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Lightweight client-side name-similarity score, no server round-trip --
// find_silent_user_match (sql/saas_platform/102) only searches is_silent
// profiles, but a row here needs to be checked against EVERY existing
// person (silent or real) to avoid creating a duplicate of either. Exact
// match (after normalizing) scores 1; otherwise a bigram-overlap ratio,
// similar in spirit to the trigram similarity that RPC itself uses.
function normalizeName(name) {
  return String(name || '')
    .trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

function bigrams(str) {
  const set = new Set();
  for (let i = 0; i < str.length - 1; i += 1) set.add(str.slice(i, i + 2));
  return set;
}

function nameSimilarity(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ba = bigrams(na);
  const bb = bigrams(nb);
  if (ba.size === 0 || bb.size === 0) return 0;
  let shared = 0;
  ba.forEach((g) => { if (bb.has(g)) shared += 1; });
  return (2 * shared) / (ba.size + bb.size);
}

function findBestRosterMatch(fullName, roster) {
  let best = null;
  let bestScore = 0;
  roster.forEach((person) => {
    const score = nameSimilarity(fullName, person.full_name);
    if (score > bestScore) {
      bestScore = score;
      best = person;
    }
  });
  return bestScore >= MATCH_THRESHOLD ? best : null;
}

export function createPeopleImportModal({ supabase, currentUserId }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[90vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-2">
        <h2 class="text-xl font-bold">${t('peopleImport.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <p class="text-xs text-slate-500 mb-4">${t('peopleImport.intro')}</p>

      <div data-el="upload-step">
        <input type="file" data-el="file-input" accept=".xlsx,.xls,.csv,.pdf" class="block w-full text-sm mb-2" />
        <p class="text-xs text-slate-500">${t('peopleImport.columnsHint')}</p>
        <p data-el="pdf-status" class="text-xs text-indigo-600 mt-1 hidden"></p>
      </div>

      <div data-el="preview-step" class="hidden">
        <div class="mb-4">
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('peopleImport.tempPassword')}</label>
          <div class="flex gap-2 max-w-sm">
            <input type="text" data-el="temp-password" minlength="6"
                   class="flex-1 border border-slate-300 rounded-lg px-3 py-2 font-mono" />
            <button type="button" data-action="generate-password"
                    class="px-3 py-2 rounded-lg bg-slate-700 text-white text-sm font-medium hover:bg-slate-800 whitespace-nowrap">
              ${t('userCreator.generatePassword')}
            </button>
          </div>
          <p class="text-xs text-slate-500 mt-1">${t('peopleImport.tempPasswordHint')}</p>
        </div>

        <div class="overflow-x-auto border border-slate-200 rounded-lg mb-2">
          <table class="w-full text-sm">
            <thead class="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
              <tr>
                <th class="text-left px-3 py-2">${t('peopleImport.colName')}</th>
                <th class="text-left px-3 py-2">${t('peopleImport.colType')}</th>
                <th class="text-left px-3 py-2">${t('peopleImport.colEmail')}</th>
                <th class="text-left px-3 py-2">${t('peopleImport.colPhone')}</th>
                <th class="text-left px-3 py-2">${t('peopleImport.colDepartment')}</th>
                <th class="text-left px-3 py-2">${t('peopleImport.colAccess')}</th>
                <th class="text-left px-3 py-2">${t('peopleImport.colStatus')}</th>
              </tr>
            </thead>
            <tbody data-el="preview-body" class="divide-y divide-slate-100"></tbody>
          </table>
        </div>

        <p data-el="summary" class="text-sm text-slate-600 mb-4"></p>
        <p data-el="pdf-review-hint" class="hidden text-xs text-amber-600 mb-4">${t('peopleImport.pdfReviewHint')}</p>

        <div class="flex justify-end gap-2">
          <button type="button" data-action="reset" class="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            ${t('peopleImport.chooseAnotherFile')}
          </button>
          <button type="button" data-el="import-btn" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
            ${t('peopleImport.startImport')}
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
  const tempPasswordEl = root.querySelector('[data-el="temp-password"]');
  const previewBodyEl = root.querySelector('[data-el="preview-body"]');
  const summaryEl = root.querySelector('[data-el="summary"]');
  const pdfReviewHintEl = root.querySelector('[data-el="pdf-review-hint"]');
  const importBtn = root.querySelector('[data-el="import-btn"]');
  const progressEl = root.querySelector('[data-el="progress"]');
  const pdfStatusEl = root.querySelector('[data-el="pdf-status"]');

  let departments = [];
  let existingRoster = []; // { id, full_name, is_silent } for every non-removed profile in this tenant, for duplicate-match suggestions
  let rows = [];

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  root.querySelector('[data-action="reset"]').addEventListener('click', resetToUpload);
  root.querySelector('[data-action="generate-password"]').addEventListener('click', () => {
    tempPasswordEl.value = generateTempPassword();
  });
  fileInput.addEventListener('change', handleFile);
  // 'change' only (fires on blur for text inputs, immediately for
  // selects) — not 'input', since renderPreview() below rebuilds every
  // cell's DOM node, which would drop focus after every keystroke.
  previewBodyEl.addEventListener('change', handleRowFieldChange);
  importBtn.addEventListener('click', runImport);

  async function loadDepartments() {
    const { data } = await supabase.from('departments').select('id, key, name').order('name');
    departments = data || [];
  }

  async function loadExistingRoster() {
    const { data } = await supabase.from('profiles').select('id, full_name, is_silent').is('removed_at', null);
    existingRoster = data || [];
  }

  function matchDepartment(text) {
    const needle = String(text || '').trim().toLowerCase();
    if (!needle) return null;
    const found = departments.find((d) => (
      d.name.toLowerCase() === needle
      || d.key.toLowerCase() === needle
      || departmentLabel(d.key).toLowerCase() === needle
    ));
    return found ? found.id : null;
  }

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    // open() kicks off loadDepartments()/loadExistingRoster() but doesn't
    // wait for them — guard here too so a very fast file pick can't race
    // ahead and match nothing.
    if (departments.length === 0) await loadDepartments();
    if (existingRoster.length === 0) await loadExistingRoster();

    const isPdf = /\.pdf$/i.test(file.name);
    const items = isPdf ? await parsePdfFile(file) : await parseSpreadsheetFile(file);
    if (items === null) { fileInput.value = ''; return; } // error already shown to the admin

    pdfReviewHintEl.classList.toggle('hidden', !isPdf);

    rows = items.map((item, index) => {
      const departmentText = item.departmentText || '';
      const row = {
        index,
        full_name: item.full_name,
        email: item.email,
        phone: item.phone,
        type: item.type,
        departmentText,
        departmentId: matchDepartment(departmentText),
        access: null,
        matchedProfileId: null,
      };
      Object.assign(row, computeAccessDefaults(row));
      return row;
    });

    renderPreview();
    uploadStepEl.classList.add('hidden');
    previewStepEl.classList.remove('hidden');
  }

  async function parseSpreadsheetFile(file) {
    let rawRows;
    try {
      const buffer = await file.arrayBuffer();
      // XLSX's type:'array' means "array of 8-bit ints" — a raw
      // ArrayBuffer isn't one, only a typed array/plain array is, so
      // this must be wrapped or SheetJS silently misreads it.
      const workbook = window.XLSX.read(new Uint8Array(buffer), { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      rawRows = window.XLSX.utils.sheet_to_json(firstSheet, { defval: '' });
    } catch (err) {
      window.alert(t('peopleImport.parseFailed', { message: err.message }));
      return null;
    }

    if (rawRows.length === 0) {
      window.alert(t('peopleImport.emptyFile'));
      return null;
    }

    const nameKey = findHeaderKey(rawRows[0], NAME_HEADERS);
    const emailKey = findHeaderKey(rawRows[0], EMAIL_HEADERS);
    const phoneKey = findHeaderKey(rawRows[0], PHONE_HEADERS);
    const typeKey = findHeaderKey(rawRows[0], TYPE_HEADERS);
    const departmentKey = findHeaderKey(rawRows[0], DEPARTMENT_HEADERS);

    return rawRows.map((raw) => ({
      full_name: nameKey ? String(raw[nameKey] || '').trim() : '',
      email: emailKey ? String(raw[emailKey] || '').trim() : '',
      phone: phoneKey ? String(raw[phoneKey] || '').trim() : '',
      type: resolveType(typeKey ? raw[typeKey] : ''),
      departmentText: departmentKey ? String(raw[departmentKey] || '').trim() : '',
    }));
  }

  // Groups a page's text items into lines by Y position (within a small
  // tolerance, since characters on the "same" printed line rarely share
  // an exact baseline) and sorts each line left-to-right by X -- turns
  // pdf.js's raw item list (whose order isn't reliably reading-order for
  // a table, especially one with overlapping/offset cells) into
  // something that actually looks like the printed table again, which
  // matters a lot for a wide spreadsheet exported to PDF (see the big
  // comment on parsePdfFile below).
  function pageTextAsLines(content) {
    const rows = [];
    content.items.forEach((it) => {
      if (!it.str.trim()) return;
      const y = Math.round(it.transform[5]);
      let row = rows.find((r) => Math.abs(r.y - y) <= 3);
      if (!row) { row = { y, items: [] }; rows.push(row); }
      row.items.push({ x: it.transform[4], str: it.str });
    });
    return rows
      .sort((a, b) => b.y - a.y) // PDF y-axis runs bottom-to-top
      .map((r) => r.items.sort((a, b) => a.x - b.x).map((i) => i.str).join(' '))
      .join('\n');
  }

  // A PDF roster has no reliable column structure to key off of the way
  // a spreadsheet's headers do, so the extracted text is handed to
  // Claude (parse-roster-pdf Edge Function) to turn into the same
  // {full_name, email, phone} shape a spreadsheet row already produces
  // -- no type or department column is derivable from a PDF, so every
  // row defaults to 'member' with no department, same as everything
  // else from here on.
  //
  // Each page is kept separate and labeled ("=== PDF PAGE n ===")
  // instead of concatenated into one blob -- a wide spreadsheet printed
  // without "fit to page width" splits into column-chunk pages (a batch
  // of rows' Id/Name on one page, the same rows' Phone/Email on the
  // next, etc.), sometimes repeating the whole thing again later in the
  // document in a different page grouping. Without page boundaries,
  // Claude has no way to tell where one table block ends and the next
  // begins, which is exactly what it needs to correlate rows across
  // them and to recognize/deduplicate a repeated block -- see
  // parse-roster-pdf's system prompt, which spells this pattern out
  // explicitly.
  async function parsePdfFile(file) {
    pdfStatusEl.textContent = t('peopleImport.pdfReading');
    pdfStatusEl.classList.remove('hidden');
    try {
      const buffer = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
      const pages = [];
      for (let i = 1; i <= pdf.numPages; i += 1) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = pageTextAsLines(content);
        if (pageText) pages.push(`=== PDF PAGE ${i} ===\n${pageText}`);
      }
      const text = pages.join('\n\n').slice(0, PDF_TEXT_LIMIT).trim();
      if (!text) {
        window.alert(t('peopleImport.emptyFile'));
        return null;
      }

      pdfStatusEl.textContent = t('peopleImport.pdfParsing');
      const { data, error } = await supabase.functions.invoke('parse-roster-pdf', { body: { text } });
      if (error) {
        window.alert(t('peopleImport.pdfParseFailed', { message: error.message }));
        return null;
      }
      if (!data?.rows?.length) {
        window.alert(t('peopleImport.emptyFile'));
        return null;
      }

      return data.rows.map((r) => ({
        full_name: r.full_name || '',
        email: r.email || '',
        phone: r.phone || '',
        type: 'member',
        departmentText: '',
      }));
    } catch (err) {
      window.alert(t('peopleImport.pdfParseFailed', { message: err.message }));
      return null;
    } finally {
      pdfStatusEl.classList.add('hidden');
    }
  }

  // Default Access per row: a strong name match against the existing
  // roster wins (avoid creating a duplicate of someone already in the
  // system, real or silent), otherwise a row with an email becomes a real
  // account (today's existing behavior, preserved for rows that came with
  // a usable email) and a row with none becomes a Silent user instead of
  // today's placeholder-email real account.
  function computeAccessDefaults(row) {
    if (row.type === 'visitor') return { access: null, matchedProfileId: null };
    const match = findBestRosterMatch(row.full_name, existingRoster);
    if (match) return { access: 'existing', matchedProfileId: match.id };
    return { access: row.email ? 'real' : 'silent', matchedProfileId: null };
  }

  function renderPreview() {
    const usedEmails = new Map(); // lowercased email -> count, for duplicate detection

    rows.forEach((row) => {
      const email = row.email.trim().toLowerCase();
      if (email) usedEmails.set(email, (usedEmails.get(email) || 0) + 1);
    });

    previewBodyEl.innerHTML = rows.map((row) => {
      const warnings = [];
      if (!row.full_name) warnings.push(t('peopleImport.warnMissingName'));
      const emailLower = row.email.trim().toLowerCase();
      if (emailLower && usedEmails.get(emailLower) > 1) warnings.push(t('peopleImport.warnDuplicateEmail'));
      if (row.type === 'member' && row.access === 'real' && !row.email) warnings.push(t('peopleImport.infoPlaceholderEmail'));
      if (row.departmentText && !row.departmentId) warnings.push(t('peopleImport.warnDepartmentNotMatched'));

      if (row.type === 'member' && row.access === 'existing' && !row.matchedProfileId) warnings.push(t('peopleImport.warnPickExistingMatch'));

      const statusHtml = warnings.length === 0
        ? `<span class="text-emerald-600">${t('peopleImport.statusOk')}</span>`
        : `<span class="text-amber-600">${escapeHtml(warnings.join('; '))}</span>`;

      const accessHtml = row.type !== 'member' ? '<span class="text-slate-300">—</span>' : `
        <div class="flex flex-col gap-1">
          <select data-field="access" data-row="${row.index}" class="w-full border border-slate-200 rounded px-2 py-1">
            <option value="silent" ${row.access === 'silent' ? 'selected' : ''}>${t('peopleImport.accessSilent')}</option>
            <option value="real" ${row.access === 'real' ? 'selected' : ''}>${t('peopleImport.accessReal')}</option>
            <option value="existing" ${row.access === 'existing' ? 'selected' : ''}>${t('peopleImport.accessExisting')}</option>
          </select>
          ${row.access === 'existing' ? `
            <select data-field="matchedProfileId" data-row="${row.index}" class="w-full border border-slate-200 rounded px-2 py-1">
              <option value="">${t('peopleImport.pickExistingPlaceholder')}</option>
              ${existingRoster
                .slice()
                .sort((a, b) => nameSimilarity(row.full_name, b.full_name) - nameSimilarity(row.full_name, a.full_name))
                .map((p) => `<option value="${p.id}" ${row.matchedProfileId === p.id ? 'selected' : ''}>${escapeHtml(p.full_name)}${p.is_silent ? ` (${t('users.silentBadge')})` : ''}</option>`)
                .join('')}
            </select>
          ` : ''}
        </div>
      `;

      return `
        <tr data-row-index="${row.index}" class="${row.full_name ? '' : 'bg-rose-50'}">
          <td class="px-2 py-1.5"><input type="text" data-field="full_name" data-row="${row.index}" value="${escapeHtml(row.full_name)}" class="w-full border border-slate-200 rounded px-2 py-1" /></td>
          <td class="px-2 py-1.5">
            <select data-field="type" data-row="${row.index}" class="w-full border border-slate-200 rounded px-2 py-1">
              <option value="member" ${row.type === 'member' ? 'selected' : ''}>${t('peopleImport.typeMember')}</option>
              <option value="visitor" ${row.type === 'visitor' ? 'selected' : ''}>${t('peopleImport.typeVisitor')}</option>
            </select>
          </td>
          <td class="px-2 py-1.5"><input type="email" data-field="email" data-row="${row.index}" value="${escapeHtml(row.email)}" class="w-full border border-slate-200 rounded px-2 py-1" /></td>
          <td class="px-2 py-1.5"><input type="text" data-field="phone" data-row="${row.index}" value="${escapeHtml(row.phone)}" class="w-full border border-slate-200 rounded px-2 py-1" /></td>
          <td class="px-2 py-1.5">
            <select data-field="department" data-row="${row.index}" class="w-full border border-slate-200 rounded px-2 py-1">
              <option value="">—</option>
              ${departments.map((d) => `<option value="${d.id}" ${row.departmentId === d.id ? 'selected' : ''}>${escapeHtml(departmentLabel(d.key))}</option>`).join('')}
            </select>
          </td>
          <td class="px-2 py-1.5">${accessHtml}</td>
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

    if (field === 'department') row.departmentId = e.target.value || null;
    else if (field === 'matchedProfileId') row.matchedProfileId = e.target.value || null;
    else if (field === 'type') {
      row.type = e.target.value;
      Object.assign(row, computeAccessDefaults(row));
    } else if (field === 'access') {
      row.access = e.target.value;
      if (row.access === 'existing' && !row.matchedProfileId) {
        const match = findBestRosterMatch(row.full_name, existingRoster);
        row.matchedProfileId = match ? match.id : null;
      }
    } else {
      row[field] = e.target.value;
    }

    renderPreview();
  }

  function getValidRows() {
    // A row claiming to match an existing person but with no match
    // actually picked yet can't be imported either way -- it's withheld
    // from counts/import until the admin resolves it, same treatment as a
    // missing name.
    return rows.filter((r) => r.full_name && !(r.type === 'member' && r.access === 'existing' && !r.matchedProfileId));
  }

  function updateSummary() {
    const validRows = getValidRows();
    const silentCount = validRows.filter((r) => r.type === 'member' && r.access === 'silent').length;
    const realCount = validRows.filter((r) => r.type === 'member' && r.access === 'real').length;
    const existingCount = validRows.filter((r) => r.type === 'member' && r.access === 'existing').length;
    const visitorCount = validRows.filter((r) => r.type === 'visitor').length;
    const skippedCount = rows.length - validRows.length;

    summaryEl.textContent = t('peopleImport.summary', { silent: silentCount, real: realCount, existing: existingCount, visitors: visitorCount, skipped: skippedCount });
    importBtn.disabled = validRows.length === 0;
  }

  function resetToUpload() {
    rows = [];
    fileInput.value = '';
    progressEl.innerHTML = '';
    pdfStatusEl.classList.add('hidden');
    pdfReviewHintEl.classList.add('hidden');
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

  // Shared by both the 'existing' path (matchedProfileId already points
  // at a real row) and the 'silent' path (matchedProfileId is the just-
  // created profile) -- a unique-violation here just means they're
  // already in that department, which is a no-op worth a quiet success
  // line, not an error.
  async function addDepartmentMembership(profileId, departmentId) {
    if (!departmentId) return null;
    const { error } = await supabase.from('department_memberships').insert({
      user_id: profileId,
      department_id: departmentId,
      role: 'member',
      status: 'approved',
      approved_at: new Date().toISOString(),
      approved_by: currentUserId,
    });
    if (error && error.code !== '23505') return error;
    return null;
  }

  async function runImport() {
    const validRows = getValidRows();
    const silentCount = validRows.filter((r) => r.type === 'member' && r.access === 'silent').length;
    const realCount = validRows.filter((r) => r.type === 'member' && r.access === 'real').length;
    const existingCount = validRows.filter((r) => r.type === 'member' && r.access === 'existing').length;
    const visitorCount = validRows.filter((r) => r.type === 'visitor').length;
    const password = tempPasswordEl.value;

    if (realCount > 0 && password.length < 6) {
      window.alert(t('peopleImport.passwordTooShort'));
      return;
    }
    if (!(await confirmDialog({
      message: t('peopleImport.confirmMessage', { silent: silentCount, real: realCount, existing: existingCount, visitors: visitorCount }),
      confirmLabel: t('peopleImport.startImport'),
      danger: false,
    }))) return;

    importBtn.disabled = true;
    progressEl.innerHTML = '';

    const scopedClient = createScopedClient();
    const usedEmails = new Set(validRows.filter((r) => r.email).map((r) => r.email.trim().toLowerCase()));

    for (const row of validRows) {
      if (row.type === 'visitor') {
        const { error } = await supabase.from('guest_follow_ups').insert({
          full_name: row.full_name,
          phone: row.phone || null,
          email: row.email || null,
          assigned_department_id: row.departmentId || null,
          source: 'import',
          created_by: currentUserId,
        });
        if (error) logLine(t('peopleImport.rowFailed', { name: row.full_name, message: error.message }), 'error');
        else logLine(t('peopleImport.visitorAdded', { name: row.full_name }), 'success');
        continue;
      }

      if (row.access === 'existing') {
        const membershipError = await addDepartmentMembership(row.matchedProfileId, row.departmentId);
        if (membershipError) logLine(t('peopleImport.rowFailed', { name: row.full_name, message: membershipError.message }), 'error');
        else logLine(t('peopleImport.existingLinked', { name: row.full_name }), 'success');
        continue;
      }

      if (row.access === 'silent') {
        const { data, error } = await supabase.functions.invoke('create-silent-user', {
          body: { full_name: row.full_name, email: row.email || undefined, phone: row.phone || undefined },
        });
        if (error) {
          logLine(t('peopleImport.rowFailed', { name: row.full_name, message: await extractFunctionErrorMessage(error) }), 'error');
          continue;
        }
        const membershipError = await addDepartmentMembership(data.profile_id, row.departmentId);
        if (membershipError) logLine(t('peopleImport.memberCreatedWithWarning', { name: row.full_name, email: '', message: membershipError.message }), 'error');
        else logLine(t('peopleImport.silentCreated', { name: row.full_name }), 'success');
        continue;
      }

      // row.access === 'real' -- unchanged from before this feature.
      const email = row.email.trim() || generatePlaceholderEmail(row.full_name, usedEmails);
      usedEmails.add(email.toLowerCase());

      const { data, error } = await scopedClient.auth.signUp({
        email,
        password,
        // See userCreatorModal.js for why this is required -- the
        // handle_new_user() trigger can't create a profiles row without it.
        options: { data: { full_name: row.full_name, tenant_id: getTenantId() } },
      });
      const alreadyRegistered = !error && data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0;

      if (error || alreadyRegistered) {
        logLine(t('peopleImport.rowFailed', {
          name: row.full_name,
          message: alreadyRegistered ? t('userCreator.emailAlreadyRegistered') : error.message,
        }), 'error');
        await sleep(SIGNUP_DELAY_MS);
        continue;
      }

      const newUserId = data.user.id;
      const { error: profileError } = await supabase.from('profiles').update({ phone: row.phone || null }).eq('id', newUserId);
      const membershipError = await addDepartmentMembership(newUserId, row.departmentId);

      if (profileError || membershipError) {
        logLine(t('peopleImport.memberCreatedWithWarning', { name: row.full_name, email, message: (profileError || membershipError).message }), 'error');
      } else {
        logLine(t('peopleImport.memberCreated', { name: row.full_name, email }), 'success');
      }

      await sleep(SIGNUP_DELAY_MS);
    }

    logLine(t('peopleImport.allDone', { password }), 'success');
    importBtn.disabled = false;
  }

  function generateTempPassword() {
    const bytes = new Uint8Array(9);
    window.crypto.getRandomValues(bytes);
    return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '').slice(0, 12);
  }

  function open() {
    resetToUpload();
    tempPasswordEl.value = generateTempPassword();
    root.classList.remove('hidden');
    root.classList.add('flex');
    loadDepartments();
    loadExistingRoster();
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  return { open, root };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
