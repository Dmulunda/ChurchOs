// Finance: personal-fund reimbursements ("My Budget") -- a standalone
// escape hatch for spending before a fund request is approved. Not
// linked to any budget row and doesn't touch any budget's spent/
// remaining math; it's just a record that a department owes someone
// back money, pending Finance's approval. Same createXModal({...}) =>
// { open } shape and two-export structure (submit form / Finance
// inbox) as budgetRequests.js, which this deliberately mirrors.
import { confirmDialog } from './confirmDialog.js';
import { t, departmentLabel, formatDate } from '../i18n.js';
import { formatAmount } from './budgetBoard.js';
import { canApproveFinance } from '../departments.js';

const RECEIPT_BUCKET = 'budget-receipts';

export function createReimbursementRequestModal({ supabase, departmentId, currentUserId }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${t('reimbursement.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <div data-el="body"></div>
    </div>
  `;
  document.body.appendChild(root);

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });

  async function open() {
    // The spec's own confirm prompt -- shown before the form, not
    // inside it, so declining just closes nothing (the modal never
    // opens at all).
    if (!(await confirmDialog({ message: t('reimbursement.confirmPersonalFunds'), confirmLabel: t('reimbursement.yesUsingOwnMoney'), danger: false }))) return;

    root.classList.remove('hidden');
    root.classList.add('flex');
    renderFormBody(root.querySelector('[data-el="body"]'), { supabase, departmentId, currentUserId });
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  return { open };
}

export function createReimbursementInboxModal({ supabase, adminUserId }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${t('reimbursement.inboxTitle')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <div data-el="body"></div>
    </div>
  `;
  document.body.appendChild(root);

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });

  function open() {
    root.classList.remove('hidden');
    root.classList.add('flex');
    renderInboxBody(root.querySelector('[data-el="body"]'), { supabase, adminUserId });
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  return { open };
}

function renderFormBody(container, { supabase, departmentId, currentUserId }) {
  container.innerHTML = `
    <form data-el="form" class="space-y-3 mb-6 pb-6 border-b border-slate-200">
      <div>
        <label class="block text-sm font-medium text-slate-600 mb-1">${t('reimbursement.amountLabel')}</label>
        <input type="number" name="amount" step="0.01" min="0.01" required class="w-full border border-slate-300 rounded-lg px-3 py-2" />
      </div>
      <div>
        <label class="block text-sm font-medium text-slate-600 mb-1">${t('reimbursement.noteLabel')}</label>
        <textarea name="note" rows="2" class="w-full border border-slate-300 rounded-lg px-3 py-2"></textarea>
      </div>
      <div>
        <label class="block text-sm font-medium text-slate-600 mb-1">${t('reimbursement.receiptLabel')}</label>
        <input type="file" name="receipt" accept="image/*,application/pdf" class="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
        <p class="text-xs text-slate-400 mt-1">${t('reimbursement.receiptHint')}</p>
      </div>
      <div class="flex items-center gap-3">
        <button type="submit" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">${t('reimbursement.submit')}</button>
        <span data-el="form-status" class="text-sm text-slate-500"></span>
      </div>
    </form>
    <h3 class="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-2">${t('reimbursement.myRequests')}</h3>
    <div data-el="list" class="space-y-2"></div>
  `;

  const form = container.querySelector('[data-el="form"]');
  const formStatusEl = container.querySelector('[data-el="form-status"]');
  const listEl = container.querySelector('[data-el="list"]');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const amount = Number(form.elements.amount.value);
    const note = form.elements.note.value.trim() || null;
    const file = form.elements.receipt.files?.[0];
    if (!amount || amount <= 0) return;

    formStatusEl.className = 'text-sm text-slate-500';
    formStatusEl.textContent = t('common.saving');

    let receiptPath = null;
    if (file) {
      const path = `${departmentId}/reimbursements/${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage.from(RECEIPT_BUCKET).upload(path, file);
      if (uploadError) {
        formStatusEl.className = 'text-sm text-rose-600';
        formStatusEl.textContent = t('reimbursement.submitFailed', { message: uploadError.message });
        return;
      }
      receiptPath = path;
    }

    const { error } = await supabase.from('reimbursement_requests').insert({
      department_id: departmentId,
      requested_by: currentUserId,
      amount,
      note,
      receipt_path: receiptPath,
    });

    if (error) {
      formStatusEl.className = 'text-sm text-rose-600';
      formStatusEl.textContent = t('reimbursement.submitFailed', { message: error.message });
      return;
    }

    form.reset();
    formStatusEl.className = 'text-sm text-emerald-600';
    formStatusEl.textContent = t('reimbursement.submitted');
    load();
  });

  load();

  async function load() {
    listEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const { data, error } = await supabase
      .from('reimbursement_requests')
      .select('id, amount, note, receipt_path, status, created_at, review_note')
      .eq('department_id', departmentId)
      .eq('requested_by', currentUserId)
      .order('created_at', { ascending: false });

    if (error) {
      listEl.innerHTML = `<p class="text-sm text-rose-600">${t('reimbursement.loadFailed', { message: error.message })}</p>`;
      return;
    }

    if (data.length === 0) {
      listEl.innerHTML = `<p class="text-sm text-slate-500">${t('reimbursement.noRequests')}</p>`;
      return;
    }

    listEl.innerHTML = data.map((r) => `
      <div class="border border-slate-200 rounded-lg p-3">
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="font-medium text-slate-800">${formatAmount(r.amount)}${r.note ? ` — ${escapeHtml(r.note)}` : ''}</div>
            <div class="text-xs text-slate-400">${escapeHtml(formatDate(r.created_at))}${r.receipt_path ? '' : ` · ${t('reimbursement.noReceiptYet')}`}</div>
          </div>
          ${statusBadge(r.status)}
        </div>
        ${r.review_note ? `<p class="text-sm text-slate-600 mt-2 pt-2 border-t border-slate-100 whitespace-pre-wrap">${t('finance.reviewNoteLabel')}: ${escapeHtml(r.review_note)}</p>` : ''}
      </div>
    `).join('');
  }
}

function renderInboxBody(container, { supabase, adminUserId }) {
  container.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;
  load();

  async function load() {
    const canApprove = canApproveFinance();

    const { data, error } = await supabase
      .from('reimbursement_requests')
      .select('id, amount, note, receipt_path, status, created_at, review_note, requester:profiles!requested_by ( full_name ), departments ( key )')
      .order('created_at', { ascending: false });

    if (error) {
      container.innerHTML = `<p class="text-sm text-rose-600">${t('reimbursement.loadFailed', { message: error.message })}</p>`;
      return;
    }

    if (data.length === 0) {
      container.innerHTML = `<p class="text-sm text-slate-500">${t('reimbursement.noRequests')}</p>`;
      return;
    }

    container.innerHTML = data.map((r) => `
      <div class="border border-slate-200 rounded-lg p-3 mb-2" data-row="${r.id}">
        <div class="flex items-center justify-between gap-3">
          <div class="font-medium text-slate-800">${formatAmount(r.amount)}</div>
          ${statusBadge(r.status)}
        </div>
        <div class="text-xs text-slate-500 mt-1">
          ${t('reimbursement.requestedBy')}: ${escapeHtml(r.requester?.full_name || '')} · ${r.departments ? departmentLabel(r.departments.key) : ''} · ${escapeHtml(formatDate(r.created_at))}
        </div>
        ${r.note ? `<p class="text-sm text-slate-600 mt-2 whitespace-pre-wrap">${escapeHtml(r.note)}</p>` : ''}
        ${r.review_note ? `<p class="text-sm text-slate-600 mt-2 pt-2 border-t border-slate-100 whitespace-pre-wrap">${t('finance.reviewNoteLabel')}: ${escapeHtml(r.review_note)}</p>` : ''}
        <div class="mt-2" data-el="receipt-slot"></div>
        ${r.status === 'pending' && canApprove ? `
          <div class="mt-3 pt-3 border-t border-slate-100">
            <input type="text" data-el="review-note-input" placeholder="${t('finance.reviewNotePlaceholder')}"
                   class="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm mb-2" />
            <div class="flex gap-2">
              <button type="button" data-action="approve" class="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700">${t('approvals.approve')}</button>
              <button type="button" data-action="reject" class="px-3 py-1.5 rounded-lg bg-rose-100 text-rose-700 text-sm font-medium hover:bg-rose-200">${t('approvals.reject')}</button>
            </div>
          </div>
        ` : ''}
      </div>
    `).join('');

    container.querySelectorAll('[data-row]').forEach((rowEl) => {
      const id = rowEl.dataset.row;
      const row = data.find((r) => r.id === id);
      const receiptSlot = rowEl.querySelector('[data-el="receipt-slot"]');
      if (row.receipt_path) {
        const link = document.createElement('button');
        link.type = 'button';
        link.className = 'text-indigo-600 hover:text-indigo-800 text-xs font-medium underline';
        link.textContent = t('budget.viewReceipt');
        link.addEventListener('click', async () => {
          const original = link.textContent;
          link.textContent = t('common.loading');
          const { data: signed, error: signError } = await supabase.storage.from(RECEIPT_BUCKET).createSignedUrl(row.receipt_path, 3600);
          link.textContent = original;
          if (signError || !signed) { window.alert(t('budget.receiptLoadFailed', { message: signError?.message || '' })); return; }
          window.open(signed.signedUrl, '_blank');
        });
        receiptSlot.appendChild(link);
      } else {
        receiptSlot.innerHTML = `<span class="text-xs text-amber-600">${t('reimbursement.noReceiptYet')}</span>`;
      }

      const noteInput = rowEl.querySelector('[data-el="review-note-input"]');
      rowEl.querySelector('[data-action="approve"]')?.addEventListener('click', () => approve(id, noteInput?.value.trim() || null));
      rowEl.querySelector('[data-action="reject"]')?.addEventListener('click', () => reject(id, noteInput?.value.trim() || null));
    });
  }

  async function approve(id, reviewNote) {
    if (!(await confirmDialog({ message: t('reimbursement.confirmApprove'), confirmLabel: t('approvals.approve'), danger: false }))) return;

    const { error } = await supabase.rpc('approve_reimbursement_request', { p_request_id: id, p_review_note: reviewNote });
    if (error) {
      window.alert(t('reimbursement.updateFailed', { message: error.message }));
      return;
    }
    load();
  }

  async function reject(id, reviewNote) {
    if (!(await confirmDialog({ message: t('reimbursement.confirmReject'), confirmLabel: t('approvals.reject'), danger: true }))) return;

    const { error } = await supabase
      .from('reimbursement_requests')
      .update({ status: 'rejected', resolved_at: new Date().toISOString(), resolved_by: adminUserId, review_note: reviewNote })
      .eq('id', id);

    if (error) {
      window.alert(t('reimbursement.updateFailed', { message: error.message }));
      return;
    }
    load();
  }
}

function statusBadge(status) {
  const classes = {
    pending: 'bg-amber-100 text-amber-700',
    approved: 'bg-emerald-100 text-emerald-700',
    rejected: 'bg-rose-100 text-rose-700',
  };
  return `<span class="px-2 py-0.5 rounded-full text-xs font-medium ${classes[status] || 'bg-slate-100 text-slate-600'}">${t(`finance.status.${status}`)}</span>`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
