// PDF import for the Preaching & Moderation schedule
// (preachingScheduleBoard.js) -- same upload/preview/confirm shape as
// offeringsImport.js, but a preaching-schedule line has no numeric
// anchor the way an offering line has a trailing dollar amount, so
// splitting "moderator / preacher / theme" out of one line of text is
// inherently less reliable.
//
// Two input shapes are supported, tried in this order:
//
// 1. A "poster" monthly program (a grid of 2-4 styled cards per row,
//    one per date, each with a "DD/MM" badge -- no year printed
//    anywhere per-date -- followed by "Thème :", "Orateur :"/
//    "Oratrice :", and "Modérateur :"/"Modératrice :" lines). This is
//    reconstructed via parsePosterRows(): pdf.js gives every text run
//    an (x, y); rows are grouped by y as before, but cells within a
//    row are now split on a large x-gap (CELL_GAP_PT) instead of
//    joined into one string, so two side-by-side cards on the same
//    row don't get blended together. Each date cell opens a new
//    "card" tracked by its x position; every later cell is routed to
//    whichever open card's x it's closest to (COLUMN_TOLERANCE_PT),
//    and labeled by whichever of Thème/Orateur/Modérateur it starts
//    with -- a day/month badge has no year on the page, so the admin
//    picks one in the Year field, applied to every date found this
//    way.
// 2. The older simple format: one PDF line already contains a full
//    date (YYYY-MM-DD or DD/MM/YYYY) plus moderator/preacher/theme,
//    separated by a pipe, 2+ consecutive spaces, or a comma, in that
//    order of preference (parsePdfLineToPreachingRow()). When no
//    separator is found at all, the whole remainder is kept as the
//    sermon theme and the moderator/preacher fields are left blank
//    rather than guessed -- the admin reviews and assigns those by
//    hand, per the "advise so the admin can match it" ask.
//
// Whichever shape actually produced rows, each resolved name is then
// fuzzy-matched (findBestMatch, js/utils/nameMatch.js, same 80%
// threshold used everywhere else) against this department's members:
// a moderator match pre-fills moderator_id (moderator has no
// free-text fallback in the schema -- an unmatched moderator name is
// just flagged for manual selection); a preacher match pre-fills
// preacher_id, and an unmatched preacher name is treated as a guest
// preacher (guest_name), mirroring exactly how the manual entry form
// already treats an outside preacher with no account.
import { t } from '../i18n.js';
import { confirmDialog } from './confirmDialog.js';
import { findBestMatch } from '../utils/nameMatch.js';

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

// Groups pdf.js text runs into visual rows by y (as before), but -- new --
// also splits each row into separate "cells" on a wide x-gap, instead of
// joining the whole row into one string. A gap this big only occurs
// between two side-by-side cards in a poster grid; normal word/label
// spacing within one card's text is a few points at most.
const CELL_GAP_PT = 20;

async function extractPdfRows(file) {
  const pdfjsLib = await loadPdfJs();
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const rows = [];
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
      const items = byLineY.get(y)
        .filter((i) => i.str && i.str.trim())
        .sort((a, b) => a.transform[4] - b.transform[4]);
      const cells = [];
      let current = null;
      for (const item of items) {
        const x = item.transform[4];
        const endX = x + (item.width || 0);
        if (current && x - current.endX < CELL_GAP_PT) {
          current.text += ' ' + item.str;
          current.endX = endX;
        } else {
          if (current) cells.push(current);
          current = { x, endX, text: item.str };
        }
      }
      if (current) cells.push(current);
      const cleaned = cells.map((c) => ({ x: c.x, text: c.text.replace(/\s+/g, ' ').trim() })).filter((c) => c.text);
      if (cleaned.length) rows.push({ y, cells: cleaned });
    }
  }
  return rows;
}

function toIsoDate(raw) {
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return '';
}

const PDF_DATE_RE = /\b(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/;

// A poster date badge: day/month only, nothing else in the cell.
const DATE_ONLY_RE = /^(\d{1,2})\/(\d{1,2})$/;
// Column tolerance: a non-date cell is routed to whichever open card's
// x is closest, as long as it's within this many points -- generous
// enough for a label's slight indent under its card's date badge, far
// smaller than the gap between two side-by-side cards.
const COLUMN_TOLERANCE_PT = 40;
const POSTER_FIELD_LABELS = [
  { key: 'theme', re: /^Th[eè]me\s*:\s*/i },
  { key: 'speaker', re: /^(?:Orateur|Oratrice)\s*:\s*/i },
  { key: 'moderator', re: /^(?:Mod[ée]rateur|Mod[ée]ratrice)\s*:\s*/i },
];

// Decorative headers/badges on the poster ("CULTES DU DIMANCHE",
// "SEMAINE 1 - 4", "TOUT LE MOIS") are always all-caps, unlike the
// "Thème :"/"Orateur :" card labels -- skipped outright so they never
// get appended onto a card's last field as a stray continuation line.
function looksLikeAllCapsHeader(text) {
  const letters = text.replace(/[^a-zA-ZÀ-ÿ]/g, '');
  return letters.length >= 3 && letters === letters.toUpperCase();
}

function newPosterCard(x, day, month, year) {
  const d = Number(day);
  const m = Number(month);
  const validYear = Number.isInteger(year) && year > 0;
  const date = validYear && m >= 1 && m <= 12 && d >= 1 && d <= 31
    ? `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    : '';
  return { columnX: x, date, rawDate: `${day}/${month}`, fields: { theme: '', speaker: '', moderator: '' }, currentLabel: null };
}

function parsePosterRows(rows, year) {
  const openByColumn = [];
  const finished = [];

  function findColumnIndex(x) {
    let bestIdx = -1;
    let bestDist = Infinity;
    openByColumn.forEach((col, idx) => {
      const dist = Math.abs(col.columnX - x);
      if (dist < bestDist) { bestDist = dist; bestIdx = idx; }
    });
    return bestDist <= COLUMN_TOLERANCE_PT ? bestIdx : -1;
  }

  for (const row of rows) {
    for (const cell of row.cells) {
      const dateMatch = cell.text.match(DATE_ONLY_RE);
      if (dateMatch) {
        const idx = findColumnIndex(cell.x);
        if (idx !== -1) finished.push(openByColumn[idx]);
        const card = newPosterCard(cell.x, dateMatch[1], dateMatch[2], year);
        if (idx !== -1) openByColumn[idx] = card;
        else openByColumn.push(card);
        continue;
      }

      if (looksLikeAllCapsHeader(cell.text)) continue;

      const idx = findColumnIndex(cell.x);
      if (idx === -1) continue; // nothing open yet at this x -- a page title/footer, not card content
      const col = openByColumn[idx];
      let text = cell.text;
      let matchedLabel = null;
      for (const { key, re } of POSTER_FIELD_LABELS) {
        if (re.test(text)) { matchedLabel = key; text = text.replace(re, '').trim(); break; }
      }
      if (matchedLabel) {
        col.currentLabel = matchedLabel;
        col.fields[matchedLabel] = col.fields[matchedLabel] ? `${col.fields[matchedLabel]} ${text}` : text;
      } else if (col.currentLabel && text) {
        // a wrapped second line of the previous label's value (e.g. a long Thème)
        col.fields[col.currentLabel] += ` ${text}`;
      }
    }
  }
  finished.push(...openByColumn);

  return finished
    .map((card) => ({
      date: card.date,
      rawLine: `${card.rawDate} | ${card.fields.theme} | ${card.fields.speaker} | ${card.fields.moderator}`.trim(),
      noColumnSplit: false,
      moderatorText: card.fields.moderator,
      preacherText: card.fields.speaker,
      theme: card.fields.theme,
    }))
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}

function splitRemainderIntoSegments(remainder) {
  let segments;
  if (remainder.includes('|')) segments = remainder.split('|');
  else if (/\s{2,}/.test(remainder)) segments = remainder.split(/\s{2,}/);
  else if (remainder.includes(',')) segments = remainder.split(',');
  else segments = [remainder];
  return segments.map((s) => s.trim()).filter(Boolean);
}

function parsePdfLineToPreachingRow(line) {
  const dateMatch = line.match(PDF_DATE_RE);
  if (!dateMatch) return null;

  const remainder = (line.slice(0, dateMatch.index) + line.slice(dateMatch.index + dateMatch[0].length))
    .replace(/[•·]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const segments = splitRemainderIntoSegments(remainder);
  const date = toIsoDate(dateMatch[0]);

  if (segments.length >= 2) {
    return {
      date, rawLine: line, noColumnSplit: false,
      moderatorText: segments[0] || '', preacherText: segments[1] || '', theme: segments.slice(2).join(' - '),
    };
  }
  return { date, rawLine: line, noColumnSplit: true, moderatorText: '', preacherText: '', theme: segments[0] || '' };
}

export function createPreachingScheduleImportModal({ supabase, departmentId, currentUserId, onImported }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-6xl max-h-[90vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-2">
        <h2 class="text-xl font-bold">${t('preachingImport.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <p class="text-xs text-slate-500 mb-1">${t('preachingImport.intro')}</p>
      <p class="text-xs text-amber-600 mb-4">${t('preachingImport.pdfWarning')}</p>

      <div data-el="upload-step">
        <label class="block text-xs font-medium text-slate-600 mb-1">${t('preachingImport.yearLabel')}</label>
        <input type="number" data-el="year-input" value="${new Date().getFullYear()}" min="2000" max="2100"
               class="w-28 border border-slate-300 rounded-lg px-2 py-1.5 text-sm mb-2" />
        <p class="text-xs text-slate-500 mb-3">${t('preachingImport.yearHint')}</p>
        <input type="file" data-el="file-input" accept=".pdf" class="block w-full text-sm mb-2" />
      </div>

      <div data-el="preview-step" class="hidden">
        <div class="overflow-x-auto border border-slate-200 rounded-lg mb-2">
          <table class="w-full text-sm">
            <thead class="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
              <tr>
                <th class="text-left px-3 py-2">${t('preachingImport.colDate')}</th>
                <th class="text-left px-3 py-2">${t('preaching.moderator')}</th>
                <th class="text-left px-3 py-2">${t('preaching.preacher')}</th>
                <th class="text-left px-3 py-2">${t('preaching.sermonTheme')}</th>
                <th class="text-left px-3 py-2">${t('preaching.bibleVerse')}</th>
                <th class="text-left px-3 py-2">${t('deptCalendarImport.colStatus')}</th>
              </tr>
            </thead>
            <tbody data-el="preview-body" class="divide-y divide-slate-100"></tbody>
          </table>
        </div>

        <p data-el="summary" class="text-sm text-slate-600 mb-4"></p>

        <div class="flex justify-end gap-2">
          <button type="button" data-action="reset" class="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            ${t('deptCalendarImport.chooseAnotherFile')}
          </button>
          <button type="button" data-el="import-btn" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
            ${t('deptCalendarImport.startImport')}
          </button>
        </div>
      </div>

      <div data-el="progress" class="mt-4 text-sm space-y-1"></div>
    </div>
  `;
  document.body.appendChild(root);

  const fileInput = root.querySelector('[data-el="file-input"]');
  const yearInput = root.querySelector('[data-el="year-input"]');
  const uploadStepEl = root.querySelector('[data-el="upload-step"]');
  const previewStepEl = root.querySelector('[data-el="preview-step"]');
  const previewBodyEl = root.querySelector('[data-el="preview-body"]');
  const summaryEl = root.querySelector('[data-el="summary"]');
  const importBtn = root.querySelector('[data-el="import-btn"]');
  const progressEl = root.querySelector('[data-el="progress"]');

  let members = [];
  let rows = [];

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  root.querySelector('[data-action="reset"]').addEventListener('click', resetToUpload);
  fileInput.addEventListener('change', handleFile);
  previewBodyEl.addEventListener('change', handleRowFieldChange);
  importBtn.addEventListener('click', runImport);

  async function loadMembers() {
    const { data } = await supabase
      .from('department_memberships')
      .select('user_id, member:profiles!user_id ( full_name )')
      .eq('department_id', departmentId)
      .eq('status', 'approved');
    members = (data || []).filter((m) => m.member).map((m) => ({ id: m.user_id, full_name: m.member.full_name }));
  }

  function entrySignature(date, moderatorId, preacherId, guestName) {
    return `${date}|${moderatorId || ''}|${preacherId || ''}|${String(guestName || '').trim().toLowerCase()}`;
  }

  async function markDuplicates(targetRows) {
    const validDates = targetRows.map((r) => r.date).filter(Boolean);
    if (validDates.length === 0) return;
    const minDate = validDates.reduce((a, b) => (b < a ? b : a));
    const maxDate = validDates.reduce((a, b) => (b > a ? b : a));

    const { data: existing, error } = await supabase
      .from('preaching_schedule')
      .select('date, moderator_id, preacher_id, guest_name')
      .gte('date', minDate).lte('date', maxDate);
    if (error) return;

    const seen = new Set((existing || []).map((r) => entrySignature(r.date, r.moderator_id, r.preacher_id, r.guest_name)));
    for (const row of targetRows) {
      if (!row.date) continue;
      const sig = entrySignature(row.date, row.moderatorId, row.preacherId, row.guestName);
      row.isDuplicate = seen.has(sig);
      seen.add(sig);
    }
  }

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (members.length === 0) await loadMembers();

    let parsedRows;
    try {
      const pdfRows = await extractPdfRows(file);
      const year = Number(yearInput.value) || null;
      parsedRows = year ? parsePosterRows(pdfRows, year) : [];
      if (parsedRows.length === 0) {
        // Not a poster-grid PDF (or no year given) -- fall back to the
        // older one-full-date-per-line format.
        const lines = pdfRows.map((r) => r.cells.map((c) => c.text).join(' '));
        parsedRows = lines.map(parsePdfLineToPreachingRow).filter(Boolean);
      }
    } catch (err) {
      window.alert(t('deptCalendarImport.parseFailed', { message: err.message }));
      fileInput.value = '';
      return;
    }

    if (parsedRows.length === 0) {
      window.alert(t('deptCalendarImport.pdfNoRows'));
      fileInput.value = '';
      return;
    }

    rows = parsedRows.map((row, index) => {
      const modMatch = row.moderatorText ? findBestMatch(row.moderatorText, members) : null;
      const preMatch = row.preacherText ? findBestMatch(row.preacherText, members) : null;
      const preacherIsGuest = Boolean(row.preacherText) && !preMatch;
      return {
        index,
        date: row.date,
        rawLine: row.rawLine,
        noColumnSplit: row.noColumnSplit,
        moderatorText: row.moderatorText,
        moderatorId: modMatch ? modMatch.id : null,
        moderatorScore: modMatch ? modMatch.score : null,
        preacherText: row.preacherText,
        preacherId: preMatch ? preMatch.id : null,
        preacherScore: preMatch ? preMatch.score : null,
        isGuestPreacher: preacherIsGuest,
        guestName: preacherIsGuest ? row.preacherText : '',
        sermonTheme: row.theme,
        bibleVerse: '',
        isDuplicate: false,
      };
    });

    await markDuplicates(rows);
    renderPreview();
    uploadStepEl.classList.add('hidden');
    previewStepEl.classList.remove('hidden');
  }

  function renderPreview() {
    previewBodyEl.innerHTML = rows.map((row) => {
      const warnings = [];
      if (!row.date) warnings.push(t('deptCalendarImport.warnMissingDate'));
      if (row.noColumnSplit) warnings.push(t('preachingImport.warnNoColumnSplit'));
      if (row.moderatorText && !row.moderatorId) warnings.push(t('preachingImport.warnModeratorNoMatch', { name: row.moderatorText }));

      const statusHtml = row.isDuplicate
        ? `<span class="text-slate-500 font-medium">${t('deptCalendarImport.statusDuplicate')}</span>`
        : warnings.length > 0
          ? `<span class="text-amber-600">${escapeHtml(warnings.join('; '))}</span>`
          : `<span class="text-emerald-600">${t('deptCalendarImport.statusOk')}</span>`;

      return `
        <tr data-row-index="${row.index}" class="${row.isDuplicate ? 'bg-slate-100 opacity-60' : ''}" title="${escapeAttr(row.rawLine)}">
          <td class="px-2 py-1.5"><input type="date" data-field="date" data-row="${row.index}" value="${row.date}" class="w-full border border-slate-200 rounded px-2 py-1" /></td>
          <td class="px-2 py-1.5">
            <select data-field="moderatorId" data-row="${row.index}" class="w-full border border-slate-200 rounded px-2 py-1">
              <option value="" ${!row.moderatorId ? 'selected' : ''}>${t('preaching.moderatorNone')}</option>
              ${members.map((m) => `<option value="${m.id}" ${row.moderatorId === m.id ? 'selected' : ''}>${escapeHtml(m.full_name)}</option>`).join('')}
            </select>
            ${row.moderatorText && !row.moderatorId ? `<p class="text-[11px] text-amber-600 mt-0.5">${t('preachingImport.detectedText', { text: row.moderatorText })}</p>` : ''}
          </td>
          <td class="px-2 py-1.5">
            <select data-field="preacherIdentity" data-row="${row.index}" class="w-full border border-slate-200 rounded px-2 py-1 mb-1">
              <option value="" ${!row.preacherId && !row.isGuestPreacher ? 'selected' : ''}>${t('preaching.preacherNone')}</option>
              <optgroup label="${escapeAttr(t('preachingImport.optgroupMembers'))}">
                ${members.map((m) => `<option value="m:${m.id}" ${row.preacherId === m.id ? 'selected' : ''}>${escapeHtml(m.full_name)}</option>`).join('')}
              </optgroup>
              <option value="guest" ${row.isGuestPreacher ? 'selected' : ''}>${t('preachingImport.guestPreacher')}</option>
            </select>
            ${row.isGuestPreacher ? `<input type="text" data-field="guestName" data-row="${row.index}" value="${escapeAttr(row.guestName)}" placeholder="${escapeAttr(t('preaching.guestPlaceholder'))}" class="w-full border border-slate-200 rounded px-2 py-1" />` : ''}
          </td>
          <td class="px-2 py-1.5"><input type="text" data-field="sermonTheme" data-row="${row.index}" value="${escapeAttr(row.sermonTheme)}" class="w-full border border-slate-200 rounded px-2 py-1" /></td>
          <td class="px-2 py-1.5"><input type="text" data-field="bibleVerse" data-row="${row.index}" value="${escapeAttr(row.bibleVerse)}" class="w-full border border-slate-200 rounded px-2 py-1" /></td>
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

    if (field === 'preacherIdentity') {
      const value = e.target.value;
      row.preacherId = null;
      row.isGuestPreacher = false;
      if (value === 'guest') { row.isGuestPreacher = true; row.guestName = row.guestName || row.preacherText; }
      else if (value.startsWith('m:')) row.preacherId = value.slice(2);
      else row.guestName = '';
      renderPreview();
      return;
    }
    if (field === 'moderatorId') { row.moderatorId = e.target.value || null; return; }
    row[field] = e.target.value;
  }

  function importableRows() {
    return rows.filter((r) => r.date && !r.isDuplicate);
  }

  function updateSummary() {
    const validCount = importableRows().length;
    const duplicateCount = rows.filter((r) => r.isDuplicate).length;
    const skippedCount = rows.length - validCount - duplicateCount;

    summaryEl.textContent = t('deptCalendarImport.summary', { valid: validCount, skipped: skippedCount })
      + (duplicateCount > 0 ? ' ' + t('deptCalendarImport.summaryDuplicates', { count: duplicateCount }) : '');
    importBtn.disabled = validCount === 0;
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
    const duplicateCount = rows.filter((r) => r.isDuplicate).length;

    const confirmMsg = t('deptCalendarImport.confirmMessage', { count: validRows.length })
      + (duplicateCount > 0 ? ' ' + t('deptCalendarImport.confirmMessageDuplicates', { count: duplicateCount }) : '');
    if (!(await confirmDialog({ message: confirmMsg, confirmLabel: t('deptCalendarImport.startImport'), danger: false }))) return;

    importBtn.disabled = true;
    progressEl.innerHTML = '';

    const { error } = await supabase.from('preaching_schedule').insert(validRows.map((row) => ({
      date: row.date,
      moderator_id: row.moderatorId,
      // Matches the manual-entry form's own insert payload exactly
      // (preachingScheduleBoard.js) -- a fresh entry is always
      // "approved" the moment it's scheduled, same reasoning as sql/058.
      moderator_status: 'approved',
      preacher_id: row.preacherId,
      preacher_name: null,
      guest_name: row.guestName || null,
      sermon_theme: row.sermonTheme || null,
      bible_verse: row.bibleVerse || null,
      created_by: currentUserId,
    })));

    if (error) {
      logLine(t('deptCalendarImport.batchFailed', { message: error.message }), 'error');
      importBtn.disabled = false;
      return;
    }

    logLine(t('deptCalendarImport.allDone', { count: validRows.length }), 'success');
    if (duplicateCount > 0) logLine(t('deptCalendarImport.allDoneDuplicatesSkipped', { count: duplicateCount }), 'info');

    importBtn.disabled = false;
    onImported?.();
  }

  function open() {
    resetToUpload();
    root.classList.remove('hidden');
    root.classList.add('flex');
    loadMembers();
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
