// Finance fund requests -- the "ask Finance for money" queue that
// approve_budget_request() (sql) turns into an actual tracked budget on
// approval. Two render functions, embedded directly into the
// centralized Budget page (js/components/budgetCentralBoard.js) rather
// than opened as modals -- there's exactly one place in the app this is
// reachable from now, so there's no reason to pay for modal chrome:
//   renderMyFundRequests    -- any ordinary department's own admin/secretary:
//                              submit a request, see their own request history.
//   renderFundRequestsInbox -- Finance oversight (Finance admin/secretary,
//                              Pastor, Church Secretary, Super Admin):
//                              every department's requests, month/department
//                              filters, a pending-count callback for the
//                              tab's notification badge.
import { confirmDialog } from './confirmDialog.js';
import { t, departmentLabel, appLocale, formatMoney } from '../i18n.js';
import { canApproveFinance } from '../departments.js';

function currentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export async function renderMyFundRequests(container, { supabase, departmentId, currentUserId }) {
  // Existing (not-yet-closed) budgets this department can top up instead
  // of starting a new one -- approve_budget_request() adds the amount
  // to initial_amount when budget_id is set, or creates a fresh budget
  // when it's left as "New budget".
  const { data: openBudgets } = await supabase
    .from('budgets')
    .select('id, name')
    .eq('department_id', departmentId)
    .neq('status', 'closed')
    .order('name');

  container.innerHTML = `
    <form data-el="form" class="space-y-3 mb-6 pb-6 border-b border-slate-200">
      ${openBudgets && openBudgets.length > 0 ? `
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('finance.budgetLabel')}</label>
          <select name="budget_id" class="w-full border border-slate-300 rounded-lg px-3 py-2">
            <option value="">${t('finance.newBudgetOption')}</option>
            ${openBudgets.map((b) => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('')}
          </select>
        </div>
      ` : ''}
      <div>
        <label class="block text-sm font-medium text-slate-600 mb-1">${t('finance.titleLabel')}</label>
        <input type="text" name="title" required placeholder="${t('finance.titlePlaceholder')}"
               class="w-full border border-slate-300 rounded-lg px-3 py-2" />
      </div>
      <div>
        <label class="block text-sm font-medium text-slate-600 mb-1">${t('finance.monthLabel')}</label>
        <input type="month" name="request_month" required value="${currentMonthValue()}"
               class="w-full border border-slate-300 rounded-lg px-3 py-2" />
      </div>
      <div>
        <label class="block text-sm font-medium text-slate-600 mb-1">${t('finance.amountLabel')}</label>
        <input type="number" name="amount" step="0.01" min="0"
               class="w-full border border-slate-300 rounded-lg px-3 py-2" />
      </div>
      <div>
        <label class="block text-sm font-medium text-slate-600 mb-1">${t('finance.descriptionLabel')}</label>
        <textarea name="description" rows="3" placeholder="${t('finance.descriptionPlaceholder')}"
                  class="w-full border border-slate-300 rounded-lg px-3 py-2"></textarea>
      </div>
      <div class="flex items-center gap-3">
        <button type="submit" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">
          ${t('finance.submit')}
        </button>
        <span data-el="form-status" class="text-sm text-slate-500"></span>
      </div>
    </form>
    <div class="flex items-center justify-between mb-2">
      <h3 class="text-sm font-semibold uppercase tracking-wide text-slate-400">${t('finance.myRequests')}</h3>
      <input type="month" data-el="month-filter" class="border border-slate-300 rounded-lg px-2 py-1 text-sm" />
    </div>
    <div data-el="list" class="space-y-2"></div>
  `;

  const form = container.querySelector('[data-el="form"]');
  const formStatusEl = container.querySelector('[data-el="form-status"]');
  const listEl = container.querySelector('[data-el="list"]');
  const monthFilterEl = container.querySelector('[data-el="month-filter"]');

  monthFilterEl.addEventListener('change', () => load());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = form.elements.title.value.trim();
    const requestMonth = form.elements.request_month.value;
    const amount = form.elements.amount.value ? Number(form.elements.amount.value) : null;
    const description = form.elements.description.value.trim() || null;
    const budgetId = form.elements.budget_id?.value || null;
    if (!title || !requestMonth) return;

    if (!(await confirmDialog({ message: t('finance.confirmSubmit'), confirmLabel: t('finance.submit'), danger: false }))) return;

    formStatusEl.className = 'text-sm text-slate-500';
    formStatusEl.textContent = t('common.saving');

    const { error } = await supabase.from('budget_requests').insert({
      requesting_department_id: departmentId,
      requested_by: currentUserId,
      title,
      request_month: `${requestMonth}-01`,
      amount,
      description,
      budget_id: budgetId,
    });

    if (error) {
      formStatusEl.className = 'text-sm text-rose-600';
      formStatusEl.textContent = t('finance.submitFailed', { message: error.message });
      return;
    }

    form.reset();
    formStatusEl.className = 'text-sm text-emerald-600';
    formStatusEl.textContent = t('finance.submitted');
    load();
  });

  load();

  async function load() {
    listEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    let query = supabase
      .from('budget_requests')
      .select('id, title, amount, request_month, status, created_at, review_note')
      .eq('requesting_department_id', departmentId);
    if (monthFilterEl.value) query = query.eq('request_month', `${monthFilterEl.value}-01`);

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      listEl.innerHTML = `<p class="text-sm text-rose-600">${t('finance.loadFailed', { message: error.message })}</p>`;
      return;
    }

    if (data.length === 0) {
      listEl.innerHTML = `<p class="text-sm text-slate-500">${t('finance.noRequests')}</p>`;
      return;
    }

    listEl.innerHTML = data.map((r) => `
      <div class="border border-slate-200 rounded-lg p-3">
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="font-medium text-slate-800">${escapeHtml(r.title)}${r.amount ? ` — ${formatAmount(r.amount)}` : ''}</div>
            <div class="text-xs text-slate-400">${formatMonth(r.request_month)} · ${escapeHtml(r.created_at.slice(0, 10))}</div>
          </div>
          ${statusBadge(r.status)}
        </div>
        ${r.review_note ? `<p class="text-sm text-slate-600 mt-2 pt-2 border-t border-slate-100 whitespace-pre-wrap">${t('finance.reviewNoteLabel')}: ${escapeHtml(r.review_note)}</p>` : ''}
      </div>
    `).join('');
  }
}

export function renderFundRequestsInbox(container, { supabase, adminUserId, departments, onPendingCountChange }) {
  container.innerHTML = `
    <div class="flex flex-wrap items-center gap-2 mb-4">
      <input type="month" data-el="month-filter" class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
      <select data-el="department-filter" class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
        <option value="">${t('finance.allDepartments')}</option>
        ${departments.map((d) => `<option value="${d.id}">${escapeHtml(departmentLabel(d.key))}</option>`).join('')}
      </select>
    </div>
    <div data-el="list"><p class="text-sm text-slate-500">${t('common.loading')}</p></div>
  `;

  const listEl = container.querySelector('[data-el="list"]');
  const monthFilterEl = container.querySelector('[data-el="month-filter"]');
  const deptFilterEl = container.querySelector('[data-el="department-filter"]');

  monthFilterEl.addEventListener('change', load);
  deptFilterEl.addEventListener('change', load);

  load();
  refreshPendingCount();

  async function load() {
    listEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const canApprove = canApproveFinance();

    let query = supabase
      .from('budget_requests')
      .select('id, title, amount, description, request_month, status, created_at, review_note, requester:profiles!requested_by ( full_name ), departments ( key )');
    if (monthFilterEl.value) query = query.eq('request_month', `${monthFilterEl.value}-01`);
    if (deptFilterEl.value) query = query.eq('requesting_department_id', deptFilterEl.value);

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      listEl.innerHTML = `<p class="text-sm text-rose-600">${t('finance.loadFailed', { message: error.message })}</p>`;
      return;
    }

    if (data.length === 0) {
      listEl.innerHTML = `<p class="text-sm text-slate-500">${t('finance.noRequests')}</p>`;
      return;
    }

    listEl.innerHTML = data.map((r) => `
      <div class="border border-slate-200 rounded-lg p-3 mb-2" data-row="${r.id}">
        <div class="flex items-center justify-between gap-3">
          <div class="font-medium text-slate-800">${escapeHtml(r.title)}${r.amount ? ` — ${formatAmount(r.amount)}` : ''}</div>
          ${statusBadge(r.status)}
        </div>
        <div class="text-xs text-slate-500 mt-1">
          ${t('finance.requestedBy')}: ${escapeHtml(r.requester?.full_name || '')} · ${r.departments ? departmentLabel(r.departments.key) : ''} · ${formatMonth(r.request_month)} · ${escapeHtml(r.created_at.slice(0, 10))}
        </div>
        ${r.description ? `<p class="text-sm text-slate-600 mt-2 whitespace-pre-wrap">${escapeHtml(r.description)}</p>` : ''}
        ${r.review_note ? `<p class="text-sm text-slate-600 mt-2 pt-2 border-t border-slate-100 whitespace-pre-wrap">${t('finance.reviewNoteLabel')}: ${escapeHtml(r.review_note)}</p>` : ''}
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
      const noteInput = rowEl.querySelector('[data-el="review-note-input"]');
      rowEl.querySelector('[data-action="approve"]')?.addEventListener('click', () => respond(id, 'approved', noteInput?.value.trim() || null));
      rowEl.querySelector('[data-action="reject"]')?.addEventListener('click', () => respond(id, 'rejected', noteInput?.value.trim() || null));
    });
  }

  // Independent of the filters above -- the badge always reflects the
  // true total, not whatever's currently being viewed.
  async function refreshPendingCount() {
    const { count } = await supabase
      .from('budget_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');
    onPendingCountChange?.(count || 0);
  }

  async function respond(id, status, reviewNote) {
    const confirmLabel = status === 'approved' ? t('approvals.approve') : t('approvals.reject');
    if (!(await confirmDialog({ message: t('finance.confirmRespond', { status: confirmLabel.toLowerCase() }), confirmLabel, danger: status === 'rejected' }))) return;

    // Approval needs to create (or top up) a budget in a department the
    // approver isn't necessarily a member of -- that write wouldn't pass
    // RLS from here, so it goes through approve_budget_request() instead,
    // which runs with the privilege to do both atomically. Rejection
    // doesn't touch budgets at all, so the plain update is unchanged.
    const { error } = status === 'approved'
      ? await supabase.rpc('approve_budget_request', { p_request_id: id, p_review_note: reviewNote })
      : await supabase
          .from('budget_requests')
          .update({ status, resolved_at: new Date().toISOString(), resolved_by: adminUserId, review_note: reviewNote })
          .eq('id', id);

    if (error) {
      window.alert(t('finance.updateFailed', { message: error.message }));
      return;
    }
    load();
    refreshPendingCount();
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

function formatAmount(amount) {
  return formatMoney(amount);
}

function formatMonth(dateStr) {
  if (!dateStr) return '';
  const [year, month] = dateStr.split('-');
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString(appLocale(), { year: 'numeric', month: 'long' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
