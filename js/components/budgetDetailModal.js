// Finance: Budget Management — detail view for one budget (opened from
// budgetBoard.js's card). New Expense / Edit Budget are inline toggle
// forms within this same modal (same collapse-in-place pattern as
// myProfileModal.js), not modal-on-modal. Initial Amount is read-only
// here per spec -- only name/description are editable after creation.
import { t, appLocale } from '../i18n.js';
import { confirmDialog } from './confirmDialog.js';
import { formatAmount } from './budgetBoard.js';
import { printBudgetSummary } from './budgetPdf.js';
import { hasFinanceOversight } from '../departments.js';
import { safeFileName } from '../utils/safeFileName.js';

const RECEIPT_BUCKET = 'budget-receipts';

export function createBudgetDetailModal({ supabase, budgetId, departmentId, currentUserId, canManage, onChanged }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4 overflow-y-auto';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-2xl my-8 p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold" data-el="title"></h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <div data-el="body"></div>
    </div>
  `;
  document.body.appendChild(root);

  const bodyEl = root.querySelector('[data-el="body"]');
  const titleEl = root.querySelector('[data-el="title"]');
  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });

  let budget = null;

  function open() {
    root.classList.remove('hidden');
    root.classList.add('flex');
    load();
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
    onChanged?.();
  }

  async function load() {
    bodyEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const [{ data: budgetRow, error: budgetError }, { data: transactions, error: txError }] = await Promise.all([
      supabase.from('budgets').select('id, name, description, initial_amount, status, created_at, closed_at, finance_note, creator:profiles!created_by ( full_name ), approver:profiles!approved_by ( full_name ), department:departments ( key, name )').eq('id', budgetId).single(),
      supabase.from('budget_transactions').select('id, amount, note, receipt_path, created_at, spender:profiles!created_by ( full_name )').eq('budget_id', budgetId).order('created_at', { ascending: false }),
    ]);

    if (budgetError || !budgetRow) {
      bodyEl.innerHTML = `<p class="text-sm text-rose-600">${t('budget.loadFailed', { message: budgetError?.message || '' })}</p>`;
      return;
    }

    budget = budgetRow;
    titleEl.textContent = budget.name;
    render(transactions || [], txError);
  }

  function render(transactions, txError) {
    const spent = transactions.reduce((sum, tx) => sum + Number(tx.amount), 0);
    const remaining = Number(budget.initial_amount) - spent;
    const isOversight = hasFinanceOversight();
    // Falls back to the creator when there's no distinct approver on
    // record -- true for Finance's own directly-created budgets
    // (self-approved, budgetBoard.js sets approved_by = creator at
    // insert time) and for any pre-existing row from before that
    // column existed. Every other department's budget only ever comes
    // from approve_budget_request(), which always sets a real approver.
    const approverName = budget.approver?.full_name || budget.creator?.full_name;

    bodyEl.innerHTML = `
      <div class="text-sm text-slate-500 mb-4 space-y-0.5">
        <div>${t('budget.createdBy')}: ${escapeHtml(budget.creator?.full_name || '—')}</div>
        <div>${t('budget.createdOn')}: ${formatDateTime(budget.created_at)}</div>
        ${approverName ? `<div>${t('budget.approvedBy')}: ${escapeHtml(approverName)}</div>` : ''}
        ${budget.closed_at ? `<div>${t('budget.closedOn')}: ${formatDateTime(budget.closed_at)}</div>` : ''}
      </div>

      <div class="grid grid-cols-3 gap-3 mb-4">
        <div class="border border-slate-200 rounded-lg p-3">
          <div class="text-xs text-slate-500">${t('budget.assigned')}</div>
          <div class="text-lg font-semibold">${formatAmount(budget.initial_amount)}</div>
        </div>
        <div class="border border-slate-200 rounded-lg p-3">
          <div class="text-xs text-slate-500">${t('budget.spent')}</div>
          <div class="text-lg font-semibold">${formatAmount(spent)}</div>
        </div>
        <div class="border border-slate-200 rounded-lg p-3">
          <div class="text-xs text-slate-500">${t('budget.remaining')}</div>
          <div class="text-lg font-semibold ${remaining < 0 ? 'text-rose-600' : ''}">${formatAmount(remaining)}</div>
        </div>
      </div>

      ${budget.description ? `<p class="text-sm text-slate-600 mb-4 whitespace-pre-wrap">${escapeHtml(budget.description)}</p>` : ''}

      <div class="mb-4 pb-4 border-b border-slate-200">
        <div class="flex items-center justify-between">
          <h3 class="text-xs font-semibold uppercase tracking-wide text-slate-400">${t('budget.financeNoteTitle')}</h3>
          ${isOversight ? `<button type="button" data-action="edit-finance-note" class="text-xs text-indigo-600 hover:text-indigo-800 font-medium">${budget.finance_note ? t('budget.editNote') : t('budget.addNote')}</button>` : ''}
        </div>
        <div data-el="finance-note-display" class="text-sm text-slate-600 mt-1 whitespace-pre-wrap">${budget.finance_note ? escapeHtml(budget.finance_note) : `<span class="text-slate-400">${t('budget.noFinanceNote')}</span>`}</div>
        <div data-el="finance-note-form-wrap" class="hidden mt-2"></div>
      </div>

      ${canManage && remaining <= 0 ? `<p class="text-xs text-amber-600 mb-2">${t('budget.exhausted')}</p>` : ''}
      <div class="flex flex-wrap gap-2 mb-4">
        ${canManage ? `<button type="button" data-action="new-expense" ${remaining <= 0 ? 'disabled' : ''} class="px-3 py-1.5 rounded-lg text-sm font-medium ${remaining <= 0 ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700'}">${t('budget.newExpense')}</button>` : ''}
        <button type="button" data-action="export-pdf" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">${t('budget.exportPdf')}</button>
        ${canManage ? `<button type="button" data-action="edit-budget" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">${t('budget.editBudget')}</button>` : ''}
        ${canManage ? `
          <select data-el="status-select" class="px-3 py-1.5 rounded-lg border border-slate-300 text-sm">
            <option value="active" ${budget.status === 'active' ? 'selected' : ''}>${t('budget.active')}</option>
            <option value="upcoming" ${budget.status === 'upcoming' ? 'selected' : ''}>${t('budget.upcoming')}</option>
            <option value="closed" ${budget.status === 'closed' ? 'selected' : ''}>${t('budget.closed')}</option>
          </select>
        ` : ''}
      </div>

      <div data-el="expense-form-wrap" class="hidden mb-4 pb-4 border-b border-slate-200"></div>
      <div data-el="edit-form-wrap" class="hidden mb-4 pb-4 border-b border-slate-200"></div>

      <h3 class="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-2">${t('budget.transactionHistory')}</h3>
      ${txError ? `<p class="text-sm text-rose-600">${t('budget.loadFailed', { message: txError.message })}</p>` : ''}
      ${transactions.length === 0 ? `<p class="text-sm text-slate-500">${t('budget.noTransactions')}</p>` : `
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left text-xs text-slate-400 uppercase tracking-wide">
                <th class="pb-2 pr-3">${t('budget.transactionDate')}</th>
                <th class="pb-2 pr-3">${t('budget.transactionPerson')}</th>
                <th class="pb-2 pr-3">${t('budget.transactionAmount')}</th>
                <th class="pb-2">${t('budget.transactionReceipt')}</th>
              </tr>
            </thead>
            <tbody data-el="tx-rows"></tbody>
          </table>
        </div>
      `}
    `;

    if (transactions.length > 0) {
      const rowsEl = bodyEl.querySelector('[data-el="tx-rows"]');
      transactions.forEach((tx) => {
        const row = document.createElement('tr');
        row.className = 'border-t border-slate-100';
        row.innerHTML = `
          <td class="py-2 pr-3 text-slate-600">${formatDateTime(tx.created_at)}</td>
          <td class="py-2 pr-3 text-slate-600">${escapeHtml(tx.spender?.full_name || '—')}</td>
          <td class="py-2 pr-3 font-medium">${formatAmount(tx.amount)}${tx.note ? `<div class="text-xs text-slate-400 font-normal">${escapeHtml(tx.note)}</div>` : ''}</td>
          <td class="py-2"></td>
        `;
        const receiptCell = row.querySelector('td:last-child');
        if (tx.receipt_path) {
          const link = document.createElement('button');
          link.type = 'button';
          link.className = 'text-indigo-600 hover:text-indigo-800 text-xs font-medium underline';
          link.textContent = t('budget.viewReceipt');
          link.addEventListener('click', () => viewReceipt(tx.receipt_path, link));
          receiptCell.appendChild(link);
        } else if (canManage) {
          // Post-creation editing -- a transaction logged without a
          // receipt at the time can still get one attached later.
          const attachBtn = document.createElement('button');
          attachBtn.type = 'button';
          attachBtn.className = 'text-slate-500 hover:text-slate-700 text-xs font-medium underline';
          attachBtn.textContent = t('budget.attachReceipt');
          attachBtn.addEventListener('click', () => attachReceipt(tx.id, attachBtn));
          receiptCell.appendChild(attachBtn);
        } else {
          receiptCell.innerHTML = `<span class="text-xs text-slate-300">—</span>`;
        }
        rowsEl.appendChild(row);
      });
    }

    bodyEl.querySelector('[data-action="export-pdf"]').addEventListener('click', () => {
      printBudgetSummary(budget, transactions, { spent, remaining });
    });

    if (canManage) {
      bodyEl.querySelector('[data-action="new-expense"]').addEventListener('click', () => toggleExpenseForm());
      bodyEl.querySelector('[data-action="edit-budget"]').addEventListener('click', () => toggleEditForm());
      bodyEl.querySelector('[data-el="status-select"]').addEventListener('change', handleStatusChange);
    }
    if (isOversight) {
      bodyEl.querySelector('[data-action="edit-finance-note"]').addEventListener('click', () => toggleFinanceNoteForm());
    }
  }

  async function viewReceipt(path, triggerEl) {
    const original = triggerEl.textContent;
    triggerEl.textContent = t('common.loading');
    const { data, error } = await supabase.storage.from(RECEIPT_BUCKET).createSignedUrl(path, 3600);
    triggerEl.textContent = original;
    if (error || !data) {
      window.alert(t('budget.receiptLoadFailed', { message: error?.message || '' }));
      return;
    }
    window.open(data.signedUrl, '_blank');
  }

  function attachReceipt(transactionId, triggerEl) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,application/pdf';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;

      const original = triggerEl.textContent;
      triggerEl.textContent = t('common.saving');
      triggerEl.disabled = true;

      const path = `${departmentId}/${budgetId}/${Date.now()}-${safeFileName(file.name)}`;
      const { error: uploadError } = await supabase.storage.from(RECEIPT_BUCKET).upload(path, file);
      if (uploadError) {
        triggerEl.textContent = original;
        triggerEl.disabled = false;
        window.alert(t('budget.expenseFailed', { message: uploadError.message }));
        return;
      }

      const { error } = await supabase.from('budget_transactions').update({ receipt_path: path }).eq('id', transactionId);
      if (error) {
        triggerEl.textContent = original;
        triggerEl.disabled = false;
        window.alert(t('budget.expenseFailed', { message: error.message }));
        return;
      }

      load();
    });
    input.click();
  }

  async function handleStatusChange(e) {
    const newStatus = e.target.value;
    if (newStatus === 'closed' && !(await confirmDialog({ message: t('budget.confirmClose') }))) {
      e.target.value = budget.status;
      return;
    }

    const update = { status: newStatus, closed_at: newStatus === 'closed' ? new Date().toISOString() : null };
    const { error } = await supabase.from('budgets').update(update).eq('id', budgetId);
    if (error) {
      window.alert(t('budget.updateFailed', { message: error.message }));
      e.target.value = budget.status;
      return;
    }
    load();
  }

  function toggleExpenseForm() {
    const wrap = bodyEl.querySelector('[data-el="expense-form-wrap"]');
    const isHidden = wrap.classList.contains('hidden');
    if (!isHidden) { wrap.classList.add('hidden'); wrap.innerHTML = ''; return; }
    wrap.classList.remove('hidden');
    wrap.innerHTML = `
      <form data-el="expense-form" class="space-y-3">
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('budget.expenseAmount')}</label>
          <input type="number" name="amount" step="0.01" min="0.01" required class="w-full border border-slate-300 rounded-lg px-3 py-2" />
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('budget.expenseNote')}</label>
          <input type="text" name="note" class="w-full border border-slate-300 rounded-lg px-3 py-2" />
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('budget.expenseReceipt')}</label>
          <input type="file" name="receipt" accept="image/*,application/pdf" class="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
        </div>
        <div class="flex items-center gap-3">
          <button type="submit" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">${t('budget.addExpense')}</button>
          <span data-el="expense-status" class="text-sm text-slate-500"></span>
        </div>
      </form>
    `;
    const form = wrap.querySelector('[data-el="expense-form"]');
    const statusEl = wrap.querySelector('[data-el="expense-status"]');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const amount = Number(form.elements.amount.value);
      const note = form.elements.note.value.trim() || null;
      const file = form.elements.receipt.files?.[0];
      if (!amount || amount <= 0) return;

      statusEl.className = 'text-sm text-slate-500';
      statusEl.textContent = t('common.saving');

      let receiptPath = null;
      if (file) {
        const path = `${departmentId}/${budgetId}/${Date.now()}-${safeFileName(file.name)}`;
        const { error: uploadError } = await supabase.storage.from(RECEIPT_BUCKET).upload(path, file);
        if (uploadError) {
          statusEl.className = 'text-sm text-rose-600';
          statusEl.textContent = t('budget.expenseFailed', { message: uploadError.message });
          return;
        }
        receiptPath = path;
      }

      const { error } = await supabase.from('budget_transactions').insert({
        budget_id: budgetId,
        amount,
        note,
        receipt_path: receiptPath,
        created_by: currentUserId,
      });

      if (error) {
        statusEl.className = 'text-sm text-rose-600';
        statusEl.textContent = t('budget.expenseFailed', { message: error.message });
        return;
      }

      toggleExpenseForm();
      load();
    });
  }

  function toggleEditForm() {
    const wrap = bodyEl.querySelector('[data-el="edit-form-wrap"]');
    const isHidden = wrap.classList.contains('hidden');
    if (!isHidden) { wrap.classList.add('hidden'); wrap.innerHTML = ''; return; }
    wrap.classList.remove('hidden');
    wrap.innerHTML = `
      <form data-el="edit-form" class="space-y-3">
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('budget.name')}</label>
          <input type="text" name="name" required value="${escapeAttr(budget.name)}" class="w-full border border-slate-300 rounded-lg px-3 py-2" />
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('budget.description')}</label>
          <textarea name="description" rows="2" class="w-full border border-slate-300 rounded-lg px-3 py-2">${escapeHtml(budget.description || '')}</textarea>
        </div>
        <div class="flex items-center gap-3">
          <button type="submit" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">${t('budget.saveChanges')}</button>
          <span data-el="edit-status" class="text-sm text-slate-500"></span>
        </div>
      </form>
    `;
    const form = wrap.querySelector('[data-el="edit-form"]');
    const statusEl = wrap.querySelector('[data-el="edit-status"]');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = form.elements.name.value.trim();
      const description = form.elements.description.value.trim() || null;
      if (!name) return;

      statusEl.className = 'text-sm text-slate-500';
      statusEl.textContent = t('common.saving');

      const { error } = await supabase.from('budgets').update({ name, description }).eq('id', budgetId);
      if (error) {
        statusEl.className = 'text-sm text-rose-600';
        statusEl.textContent = t('budget.updateFailed', { message: error.message });
        return;
      }

      toggleEditForm();
      load();
    });
  }

  function toggleFinanceNoteForm() {
    const wrap = bodyEl.querySelector('[data-el="finance-note-form-wrap"]');
    const isHidden = wrap.classList.contains('hidden');
    if (!isHidden) { wrap.classList.add('hidden'); wrap.innerHTML = ''; return; }
    wrap.classList.remove('hidden');
    wrap.innerHTML = `
      <form data-el="finance-note-form" class="space-y-2">
        <textarea name="finance_note" rows="2" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">${escapeHtml(budget.finance_note || '')}</textarea>
        <div class="flex items-center gap-3">
          <button type="submit" class="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">${t('budget.saveChanges')}</button>
          <span data-el="finance-note-status" class="text-sm text-slate-500"></span>
        </div>
      </form>
    `;
    const form = wrap.querySelector('[data-el="finance-note-form"]');
    const statusEl = wrap.querySelector('[data-el="finance-note-status"]');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const note = form.elements.finance_note.value.trim() || null;

      statusEl.className = 'text-sm text-slate-500';
      statusEl.textContent = t('common.saving');

      // Finance annotating a budget it doesn't otherwise have write
      // access to (any department's, not just its own) -- goes through
      // set_budget_finance_note() rather than a plain update, same
      // reasoning as every other privilege-escalation RPC this session.
      const { error } = await supabase.rpc('set_budget_finance_note', { p_budget_id: budgetId, p_note: note });
      if (error) {
        statusEl.className = 'text-sm text-rose-600';
        statusEl.textContent = t('budget.updateFailed', { message: error.message });
        return;
      }

      toggleFinanceNoteForm();
      load();
    });
  }

  return { open };
}

function formatDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(appLocale(), { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;');
}
