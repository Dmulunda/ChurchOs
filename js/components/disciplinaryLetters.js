// Disciplinary letters (warning/suspension) with pastor + member
// e-signatures (sql/087). Two entry points sharing this module:
//
//   createMyLettersModal — every signed-in member: see their own
//     letters, sign (acknowledge) a 'sent' one with the shared
//     signature pad, then Print once acknowledged (certificate.js's
//     open-a-tab-and-window.print() pattern, with both signature
//     images embedded).
//
//   createDisciplinaryLettersAdminModal — Pastor Admin/Super Admin
//     only: draft a letter (member search, modeled on
//     memberCaseManager.js's), sign it themselves to send it (which
//     also pushes/notifies the member — sql/087's trigger creates the
//     in-app notification, supabase/functions/send-push's
//     'disciplinary_letter' kind sends the actual push), and mark a
//     long-unanswered one as disputed.
//
// "Suspended" is never stored on profiles — it's just whether an
// acknowledged suspension-type letter's date range covers today,
// computed wherever that matters, matching sql/083/084's existing
// no-separate-status design.
import { t } from '../i18n.js';
import { publicPageUrl } from '../utils/publicUrl.js';
import { confirmDialog } from './confirmDialog.js';
import { createSignaturePad } from './signaturePad.js';
import { getTenant } from '../tenant.js';

const LETTER_TYPES = ['warning', 'suspension'];

function statusLabel(status) {
  return t(`disciplinaryLetter.status.${status}`);
}

function typeLabel(type) {
  return t(`disciplinaryLetter.type.${type}`);
}

function formatDate(d) {
  return d ? new Date(d).toLocaleDateString() : '—';
}

// ---------------------------------------------------------------
// Member's own view
// ---------------------------------------------------------------

export function createMyLettersModal({ supabase, currentUserId }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${t('myLetters.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <div data-el="body"></div>
    </div>
  `;
  document.body.appendChild(root);

  const bodyEl = root.querySelector('[data-el="body"]');
  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });

  async function load() {
    bodyEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const { data: letters, error } = await supabase
      .from('disciplinary_letters')
      .select('id, type, reason, issued_at, suspension_start, suspension_end, status, issuer:profiles!issued_by ( full_name )')
      .eq('member_id', currentUserId)
      .order('issued_at', { ascending: false });

    if (error) {
      bodyEl.innerHTML = `<p class="text-sm text-rose-600">${t('myLetters.loadFailed', { message: error.message })}</p>`;
      return;
    }

    if (!letters || letters.length === 0) {
      bodyEl.innerHTML = `<p class="text-sm text-slate-500">${t('myLetters.none')}</p>`;
      return;
    }

    const { data: signatures } = await supabase
      .from('letter_signatures')
      .select('letter_id, signer_role, signature_data')
      .in('letter_id', letters.map((l) => l.id));

    const sigsByLetter = new Map();
    (signatures || []).forEach((s) => {
      if (!sigsByLetter.has(s.letter_id)) sigsByLetter.set(s.letter_id, {});
      sigsByLetter.get(s.letter_id)[s.signer_role] = s.signature_data;
    });

    bodyEl.innerHTML = '';
    letters.forEach((letter) => bodyEl.appendChild(buildLetterCard(letter, sigsByLetter.get(letter.id) || {})));
  }

  function buildLetterCard(letter, sigs) {
    const card = document.createElement('div');
    card.className = 'border border-slate-200 rounded-lg p-4 mb-3';
    card.innerHTML = `
      <div class="flex items-center justify-between mb-2">
        <span class="font-medium text-slate-800">${escapeHtml(typeLabel(letter.type))}</span>
        <span class="text-xs font-medium ${letter.status === 'acknowledged' ? 'text-emerald-600' : letter.status === 'disputed' ? 'text-rose-600' : 'text-amber-600'}">${escapeHtml(statusLabel(letter.status))}</span>
      </div>
      <p class="text-sm text-slate-600 mb-2">${escapeHtml(letter.reason)}</p>
      ${letter.type === 'suspension' ? `<p class="text-xs text-slate-500 mb-2">${t('disciplinaryLetter.suspensionDates', { start: formatDate(letter.suspension_start), end: formatDate(letter.suspension_end) })}</p>` : ''}
      <p class="text-xs text-slate-400 mb-3">${t('disciplinaryLetter.issuedBy', { name: letter.issuer?.full_name || '—', date: formatDate(letter.issued_at) })}</p>
      <div data-el="action-area"></div>
    `;

    const actionArea = card.querySelector('[data-el="action-area"]');

    if (letter.status === 'sent') {
      actionArea.appendChild(buildSignSection(letter));
    } else if (letter.status === 'acknowledged') {
      const printBtn = document.createElement('button');
      printBtn.type = 'button';
      printBtn.className = 'px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium';
      printBtn.textContent = t('disciplinaryLetter.print');
      printBtn.addEventListener('click', () => printLetter(letter, sigs));
      actionArea.appendChild(printBtn);
    }

    return card;
  }

  function buildSignSection(letter) {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <p class="text-xs text-slate-500 mb-1">${t('disciplinaryLetter.acknowledgeHint')}</p>
      <canvas data-el="pad" width="400" height="120" class="w-full border border-slate-300 rounded-lg bg-white touch-none" style="max-width:400px;height:120px;"></canvas>
      <div class="flex items-center justify-between mt-1 mb-2">
        <button type="button" data-action="clear" class="text-xs text-slate-500 hover:text-slate-700 underline">${t('myProfile.clearSignature')}</button>
        <p data-el="status" class="text-sm text-rose-600"></p>
      </div>
      <button type="button" data-action="sign" class="w-full px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
        ${t('disciplinaryLetter.acknowledgeAndSign')}
      </button>
    `;
    const pad = createSignaturePad(wrap.querySelector('[data-el="pad"]'));
    const statusEl = wrap.querySelector('[data-el="status"]');
    const signBtn = wrap.querySelector('[data-action="sign"]');
    wrap.querySelector('[data-action="clear"]').addEventListener('click', () => pad.clear());

    signBtn.addEventListener('click', async () => {
      if (pad.isEmpty()) {
        statusEl.textContent = t('agreementSigning.signatureRequired');
        return;
      }
      signBtn.disabled = true;

      const { error: sigError } = await supabase.from('letter_signatures').insert({
        letter_id: letter.id,
        signer_id: currentUserId,
        signer_role: 'member',
        signature_data: pad.toDataUrl(),
      });
      if (sigError) {
        signBtn.disabled = false;
        statusEl.textContent = t('disciplinaryLetter.signFailed', { message: sigError.message });
        return;
      }

      const { error: statusError } = await supabase.from('disciplinary_letters').update({ status: 'acknowledged' }).eq('id', letter.id);
      signBtn.disabled = false;
      if (statusError) {
        statusEl.textContent = t('disciplinaryLetter.signFailed', { message: statusError.message });
        return;
      }

      load();
    });

    return wrap;
  }

  function open() {
    root.classList.remove('hidden');
    root.classList.add('flex');
    load();
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  return { open, root };
}

// ---------------------------------------------------------------
// Pastor Admin / Super Admin oversight view
// ---------------------------------------------------------------

export function createDisciplinaryLettersAdminModal({ supabase, currentUserId }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${t('disciplinaryLetter.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>

      <button type="button" data-action="toggle-new" class="mb-3 px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">
        ${t('disciplinaryLetter.newLetter')}
      </button>

      <div data-el="create-form" class="hidden border border-slate-200 rounded-lg p-4 mb-4 space-y-2">
        <label class="block text-sm font-medium text-slate-600">${t('memberCase.member')}</label>
        <input type="search" data-el="member-search" placeholder="${t('memberCase.memberSearchPlaceholder')}"
               class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        <div data-el="member-results" class="max-h-32 overflow-y-auto border border-slate-100 rounded-lg divide-y"></div>
        <p data-el="member-selected" class="text-sm text-slate-500"></p>

        <label class="block text-sm font-medium text-slate-600">${t('disciplinaryLetter.type')}</label>
        <select data-el="letter-type" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
          ${LETTER_TYPES.map((ty) => `<option value="${ty}">${typeLabel(ty)}</option>`).join('')}
        </select>

        <div data-el="suspension-dates-wrap" class="hidden grid grid-cols-2 gap-2">
          <div>
            <label class="block text-xs font-medium text-slate-500 mb-1">${t('disciplinaryLetter.suspensionStart')}</label>
            <input type="date" data-el="suspension-start" class="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label class="block text-xs font-medium text-slate-500 mb-1">${t('disciplinaryLetter.suspensionEnd')}</label>
            <input type="date" data-el="suspension-end" class="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
          </div>
        </div>

        <label class="block text-sm font-medium text-slate-600">${t('disciplinaryLetter.reason')}</label>
        <textarea data-el="reason" rows="3" placeholder="${t('disciplinaryLetter.reasonPlaceholder')}"
                  class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"></textarea>

        <div class="flex items-center gap-3">
          <button type="button" data-action="submit-draft" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">
            ${t('disciplinaryLetter.saveDraft')}
          </button>
          <span data-el="create-status" class="text-sm text-slate-500"></span>
        </div>
      </div>

      <div data-el="body"></div>
    </div>
  `;
  document.body.appendChild(root);

  const newBtn = root.querySelector('[data-action="toggle-new"]');
  const createFormEl = root.querySelector('[data-el="create-form"]');
  const memberSearchEl = root.querySelector('[data-el="member-search"]');
  const memberResultsEl = root.querySelector('[data-el="member-results"]');
  const memberSelectedEl = root.querySelector('[data-el="member-selected"]');
  const letterTypeEl = root.querySelector('[data-el="letter-type"]');
  const suspensionDatesWrapEl = root.querySelector('[data-el="suspension-dates-wrap"]');
  const suspensionStartEl = root.querySelector('[data-el="suspension-start"]');
  const suspensionEndEl = root.querySelector('[data-el="suspension-end"]');
  const reasonEl = root.querySelector('[data-el="reason"]');
  const createStatusEl = root.querySelector('[data-el="create-status"]');
  const bodyEl = root.querySelector('[data-el="body"]');

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });

  let members = [];
  let selectedMemberId = null;

  newBtn.addEventListener('click', () => {
    createFormEl.classList.toggle('hidden');
    if (!createFormEl.classList.contains('hidden')) resetCreateForm();
  });

  letterTypeEl.addEventListener('change', () => {
    suspensionDatesWrapEl.classList.toggle('hidden', letterTypeEl.value !== 'suspension');
  });

  function resetCreateForm() {
    memberSearchEl.value = '';
    memberResultsEl.innerHTML = '';
    memberSelectedEl.textContent = '';
    selectedMemberId = null;
    letterTypeEl.value = 'warning';
    suspensionDatesWrapEl.classList.add('hidden');
    suspensionStartEl.value = '';
    suspensionEndEl.value = '';
    reasonEl.value = '';
    createStatusEl.textContent = '';
  }

  memberSearchEl.addEventListener('input', () => renderMemberResults(memberSearchEl.value.trim().toLowerCase()));

  function renderMemberResults(query) {
    const matches = query ? members.filter((m) => m.full_name.toLowerCase().includes(query)) : [];
    memberResultsEl.innerHTML = matches.slice(0, 15).map((m) => `
      <button type="button" data-member-id="${m.id}" class="w-full text-left px-2 py-1.5 text-sm hover:bg-slate-100">${escapeHtml(m.full_name)}</button>
    `).join('');
    memberResultsEl.querySelectorAll('[data-member-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedMemberId = btn.dataset.memberId;
        memberSelectedEl.textContent = `${t('memberCase.member')}: ${btn.textContent.trim()}`;
        memberResultsEl.innerHTML = '';
        memberSearchEl.value = '';
      });
    });
  }

  root.querySelector('[data-action="submit-draft"]').addEventListener('click', async () => {
    const reason = reasonEl.value.trim();
    if (!selectedMemberId) {
      createStatusEl.className = 'text-sm text-rose-600';
      createStatusEl.textContent = t('memberCase.noMemberSelected');
      return;
    }
    if (!reason) {
      createStatusEl.className = 'text-sm text-rose-600';
      createStatusEl.textContent = t('disciplinaryLetter.reasonRequired');
      return;
    }
    const type = letterTypeEl.value;
    if (type === 'suspension' && (!suspensionStartEl.value || !suspensionEndEl.value)) {
      createStatusEl.className = 'text-sm text-rose-600';
      createStatusEl.textContent = t('disciplinaryLetter.suspensionDatesRequired');
      return;
    }

    createStatusEl.className = 'text-sm text-slate-500';
    createStatusEl.textContent = t('common.saving');

    const { error } = await supabase.from('disciplinary_letters').insert({
      member_id: selectedMemberId,
      type,
      reason,
      issued_by: currentUserId,
      suspension_start: type === 'suspension' ? suspensionStartEl.value : null,
      suspension_end: type === 'suspension' ? suspensionEndEl.value : null,
    });

    if (error) {
      createStatusEl.className = 'text-sm text-rose-600';
      createStatusEl.textContent = t('disciplinaryLetter.saveFailed', { message: error.message });
      return;
    }

    createFormEl.classList.add('hidden');
    load();
  });

  async function loadMembers() {
    const { data } = await supabase.from('profiles').select('id, full_name').is('removed_at', null).order('full_name');
    members = data || [];
  }

  async function load() {
    bodyEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const { data: letters, error } = await supabase
      .from('disciplinary_letters')
      .select('id, type, reason, issued_at, suspension_start, suspension_end, status, member:profiles!member_id ( full_name )')
      .order('issued_at', { ascending: false });

    if (error) {
      bodyEl.innerHTML = `<p class="text-sm text-rose-600">${t('myLetters.loadFailed', { message: error.message })}</p>`;
      return;
    }

    if (!letters || letters.length === 0) {
      bodyEl.innerHTML = `<p class="text-sm text-slate-500">${t('myLetters.none')}</p>`;
      return;
    }

    bodyEl.innerHTML = '';
    letters.forEach((letter) => bodyEl.appendChild(buildAdminLetterCard(letter)));
  }

  function buildAdminLetterCard(letter) {
    const card = document.createElement('div');
    card.className = 'border border-slate-200 rounded-lg p-4 mb-3';
    card.innerHTML = `
      <div class="flex items-center justify-between mb-2">
        <span class="font-medium text-slate-800">${escapeHtml(letter.member?.full_name || '—')} — ${escapeHtml(typeLabel(letter.type))}</span>
        <span class="text-xs font-medium ${letter.status === 'acknowledged' ? 'text-emerald-600' : letter.status === 'disputed' ? 'text-rose-600' : 'text-amber-600'}">${escapeHtml(statusLabel(letter.status))}</span>
      </div>
      <p class="text-sm text-slate-600 mb-2">${escapeHtml(letter.reason)}</p>
      ${letter.type === 'suspension' ? `<p class="text-xs text-slate-500 mb-2">${t('disciplinaryLetter.suspensionDates', { start: formatDate(letter.suspension_start), end: formatDate(letter.suspension_end) })}</p>` : ''}
      <p class="text-xs text-slate-400 mb-3">${t('disciplinaryLetter.issuedOn', { date: formatDate(letter.issued_at) })}</p>
      <div data-el="action-area"></div>
    `;

    const actionArea = card.querySelector('[data-el="action-area"]');

    if (letter.status === 'draft') {
      actionArea.appendChild(buildPastorSignSection(letter));
    } else if (letter.status === 'sent') {
      const disputeBtn = document.createElement('button');
      disputeBtn.type = 'button';
      disputeBtn.className = 'text-xs font-medium text-rose-600 hover:text-rose-800';
      disputeBtn.textContent = t('disciplinaryLetter.markDisputed');
      disputeBtn.addEventListener('click', () => markDisputed(letter));
      actionArea.appendChild(disputeBtn);
    }

    return card;
  }

  function buildPastorSignSection(letter) {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <p class="text-xs text-slate-500 mb-1">${t('disciplinaryLetter.pastorSignHint')}</p>
      <canvas data-el="pad" width="400" height="120" class="w-full border border-slate-300 rounded-lg bg-white touch-none" style="max-width:400px;height:120px;"></canvas>
      <div class="flex items-center justify-between mt-1 mb-2">
        <button type="button" data-action="clear" class="text-xs text-slate-500 hover:text-slate-700 underline">${t('myProfile.clearSignature')}</button>
        <p data-el="status" class="text-sm text-rose-600"></p>
      </div>
      <button type="button" data-action="sign" class="w-full px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
        ${t('disciplinaryLetter.signAndSend')}
      </button>
    `;
    const pad = createSignaturePad(wrap.querySelector('[data-el="pad"]'));
    const statusEl = wrap.querySelector('[data-el="status"]');
    const signBtn = wrap.querySelector('[data-action="sign"]');
    wrap.querySelector('[data-action="clear"]').addEventListener('click', () => pad.clear());

    signBtn.addEventListener('click', async () => {
      if (pad.isEmpty()) {
        statusEl.textContent = t('agreementSigning.signatureRequired');
        return;
      }
      signBtn.disabled = true;

      const { error: sigError } = await supabase.from('letter_signatures').insert({
        letter_id: letter.id,
        signer_id: currentUserId,
        signer_role: 'pastor',
        signature_data: pad.toDataUrl(),
      });
      if (sigError) {
        signBtn.disabled = false;
        statusEl.textContent = t('disciplinaryLetter.signFailed', { message: sigError.message });
        return;
      }

      const { error: statusError } = await supabase.from('disciplinary_letters').update({ status: 'sent' }).eq('id', letter.id);
      signBtn.disabled = false;
      if (statusError) {
        statusEl.textContent = t('disciplinaryLetter.signFailed', { message: statusError.message });
        return;
      }

      // Best-effort — the in-app notification (sql/087's trigger) has
      // already landed regardless of whether this push succeeds.
      supabase.functions.invoke('send-push', { body: { kind: 'disciplinary_letter', letter_id: letter.id } }).catch(() => {});

      load();
    });

    return wrap;
  }

  async function markDisputed(letter) {
    const confirmed = await confirmDialog({
      message: t('disciplinaryLetter.confirmDispute', { name: letter.member?.full_name || '' }),
    });
    if (!confirmed) return;

    const { error } = await supabase.from('disciplinary_letters').update({ status: 'disputed' }).eq('id', letter.id);
    if (error) {
      window.alert(t('disciplinaryLetter.saveFailed', { message: error.message }));
      return;
    }
    load();
  }

  async function open() {
    root.classList.remove('hidden');
    root.classList.add('flex');
    createFormEl.classList.add('hidden');
    await loadMembers();
    await load();
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  return { open, root };
}

// ---------------------------------------------------------------
// Shared: printable letter (certificate.js's pattern — a fresh
// window/tab with self-contained HTML, printed via window.print())
// ---------------------------------------------------------------

function printLetter(letter, sigs) {
  const dateLabel = new Date(letter.issued_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  // Falls back to the platform default only if this tenant hasn't
  // uploaded their own yet -- see js/components/tenantLogoModal.js,
  // same pattern as memberIdCard.js's header.
  const logoUrl = getTenant()?.logo_url || publicPageUrl('img/church-on-point-icon.png');

  const html = `
    <!DOCTYPE html>
    <html lang="${document.documentElement.lang || 'en'}">
    <head>
      <meta charset="UTF-8" />
      <title>${escapeHtml(typeLabel(letter.type))} — ${escapeHtml(letter.issuer?.full_name || '')}</title>
      <style>
        body { font-family: Georgia, 'Times New Roman', serif; margin: 0; padding: 48px; color: #0B1F3A; }
        .header { display: flex; align-items: center; gap: 16px; margin-bottom: 32px; border-bottom: 2px solid #D4AF37; padding-bottom: 16px; }
        .header img { height: 48px; }
        h1 { font-size: 22px; margin: 24px 0 8px; }
        .meta { font-size: 13px; color: #475569; margin-bottom: 24px; }
        .reason { font-size: 15px; line-height: 1.6; margin-bottom: 32px; white-space: pre-wrap; }
        .signatures { display: flex; gap: 48px; margin-top: 48px; }
        .sig-block { flex: 1; }
        .sig-line { border-bottom: 1px solid #0B1F3A; height: 60px; display: flex; align-items: flex-end; }
        .sig-line img { max-height: 56px; max-width: 100%; }
        .sig-label { font-size: 12px; color: #475569; margin-top: 6px; }
        .no-print { text-align: center; margin-top: 32px; }
        .no-print button { font-family: inherit; font-size: 14px; padding: 10px 20px; border-radius: 8px; border: none; background: #0B1F3A; color: white; cursor: pointer; }
        @media print { .no-print { display: none; } }
      </style>
    </head>
    <body>
      <div class="header">
        <img src="${logoUrl}" alt="" />
      </div>
      <h1>${escapeHtml(typeLabel(letter.type))}</h1>
      <p class="meta">${escapeHtml(dateLabel)}</p>
      <p class="reason">${escapeHtml(letter.reason)}</p>
      ${letter.type === 'suspension' ? `<p class="meta">${t('disciplinaryLetter.suspensionDates', { start: formatDate(letter.suspension_start), end: formatDate(letter.suspension_end) })}</p>` : ''}
      <div class="signatures">
        <div class="sig-block">
          <div class="sig-line">${sigs.pastor ? `<img src="${sigs.pastor}" alt="" />` : ''}</div>
          <div class="sig-label">${escapeHtml(t('memberCard.pastorSignature'))}</div>
        </div>
        <div class="sig-block">
          <div class="sig-line">${sigs.member ? `<img src="${sigs.member}" alt="" />` : ''}</div>
          <div class="sig-label">${escapeHtml(t('memberCard.memberSignature'))}</div>
        </div>
      </div>
      <div class="no-print">
        <button onclick="window.print()">${escapeHtml(t('courses.print'))}</button>
      </div>
    </body>
    </html>
  `;

  const win = window.open('', '_blank');
  if (!win) {
    window.alert(t('courses.certificatePopupBlocked'));
    return;
  }
  win.document.write(html);
  win.document.close();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
