// Finance/Budget — centralized page (js/budgetPage.js is the tab entry
// point). Two tabs: Fund Request and Budget Report, both filterable by
// month and department. Which of two audiences a viewer gets is decided
// once, client-side, purely to pick which UI to show — the real
// boundary is RLS (can_manage_finance()/can_approve_finance() vs
// can_read_department()), already enforced identically regardless of
// what this file renders:
//   - Finance oversight (hasFinanceOversight(), departments.js): every
//     department's requests/spending, both filters live, a
//     pending-count badge on the Fund Request tab, a Reimbursements
//     inbox button, and their own Finance budget to manage (only when
//     Finance is their *currently active* department -- see below).
//   - Ordinary department admin/secretary: their own *currently active*
//     department's request form + history + spending, plus a My Budget
//     (reimbursement) button. Deliberately keyed off getActiveDepartment()
//     (the same department the sidebar switcher drives everywhere else
//     in this app), not "any department they happen to lead" -- someone
//     who's admin of two departments must switch which one is active to
//     see/act on the other; they never see both merged together.
// Nobody else ever reaches this file at all -- js/app.js only
// constructs the nav button/tab for hasAnyDeptLeadership().
import { t, departmentLabel, formatMoney } from '../i18n.js';
import { hasFinanceOversight, canApproveFinance, getMyDepartments, getActiveDepartment } from '../departments.js';
import { renderMyFundRequests, renderFundRequestsInbox } from './budgetRequests.js';
import { renderBudgetBoard } from './budgetBoard.js';
import { createReimbursementRequestModal, createReimbursementInboxModal } from './reimbursementModal.js';
import { renderTaxReceiptsAdminBoard } from './taxReceiptsAdminBoard.js';

export async function renderBudgetCentralBoard(container, { supabase, currentUserId }) {
  const oversight = hasFinanceOversight();
  const active = getActiveDepartment();
  const activeIsLeader = active && (active.role === 'admin' || active.role === 'secretary');

  // A Pastor/Church Secretary/Super Admin gets oversight without being a
  // Finance department member at all -- they're an auditor here, not a
  // manager, so no "own budget" to run. A Finance admin/secretary is
  // both: full cross-department audit AND a real department that spends
  // its own money -- but that management view only shows while Finance
  // is their active department, same rule as everyone else.
  const financeDept = (activeIsLeader && active.key === 'finance') ? active : null;

  // The department(s) this viewer is actually scoped to -- for the
  // report/request views below, and for the oversight department filter's
  // options (every department) vs. a scoped admin's fixed single department.
  let scopedDepartments = [];
  if (oversight) {
    const { data } = await supabase.from('departments').select('id, key, name').order('name');
    scopedDepartments = data || [];
  } else if (activeIsLeader) {
    scopedDepartments = [active];
  }

  if (!oversight && scopedDepartments.length === 0) {
    // Distinguish "you lead nothing at all" (shouldn't happen --
    // hasAnyDeptLeadership() gates reaching this page -- but a mode
    // switch mid-session could land here) from "you lead something, just
    // not whatever's currently active" -- the point 4 fix: an admin of
    // two departments must switch which one is active, never sees both
    // merged together.
    const leadsAnyDept = getMyDepartments().some((d) => d.role === 'admin' || d.role === 'secretary');
    container.innerHTML = `<p class="text-sm text-slate-500">${leadsAnyDept ? t('budgetPage.switchDepartment') : t('budgetPage.noAccess')}</p>`;
    return;
  }

  container.innerHTML = `
    <div class="flex gap-2 mb-4">
      <button type="button" data-action="tab-requests" class="px-4 py-2 rounded-lg text-sm font-medium">
        ${t('budgetPage.fundRequestTab')}
        <span data-el="pending-badge" class="hidden ml-1.5 px-1.5 py-0.5 rounded-full bg-rose-600 text-white text-xs font-bold"></span>
      </button>
      <button type="button" data-action="tab-report" class="px-4 py-2 rounded-lg text-sm font-medium">${t('budgetPage.budgetReportTab')}</button>
      ${oversight ? `<button type="button" data-action="tab-tax" class="px-4 py-2 rounded-lg text-sm font-medium">${t('budgetPage.taxReceiptsTab')}</button>` : ''}
    </div>
    <div data-el="body"></div>
  `;

  const bodyEl = container.querySelector('[data-el="body"]');
  const tabRequestsBtn = container.querySelector('[data-action="tab-requests"]');
  const tabReportBtn = container.querySelector('[data-action="tab-report"]');
  const tabTaxBtn = container.querySelector('[data-action="tab-tax"]');
  const badgeEl = container.querySelector('[data-el="pending-badge"]');

  function setTabStyle(btn, isActive) {
    btn.classList.toggle('bg-indigo-600', isActive);
    btn.classList.toggle('text-white', isActive);
    btn.classList.toggle('text-slate-600', !isActive);
    btn.classList.toggle('hover:bg-slate-100', !isActive);
  }

  function activate(tab) {
    setTabStyle(tabRequestsBtn, tab === 'requests');
    setTabStyle(tabReportBtn, tab === 'report');
    if (tabTaxBtn) setTabStyle(tabTaxBtn, tab === 'tax');
    if (tab === 'requests') renderRequestsTab();
    else if (tab === 'tax') renderTaxReceiptsAdminBoard(bodyEl, { supabase, currentUserId });
    else renderReportTab();
  }

  tabRequestsBtn.addEventListener('click', () => activate('requests'));
  tabReportBtn.addEventListener('click', () => activate('report'));
  tabTaxBtn?.addEventListener('click', () => activate('tax'));
  activate('requests');

  function renderRequestsTab() {
    if (oversight) {
      bodyEl.innerHTML = `
        <div class="mb-4">
          <button type="button" data-action="reimbursements-inbox" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">${t('reimbursement.inboxTitle')}</button>
        </div>
        <div data-el="inbox"></div>
      `;
      bodyEl.querySelector('[data-action="reimbursements-inbox"]').addEventListener('click', () => {
        createReimbursementInboxModal({ supabase, adminUserId: currentUserId }).open();
      });
      renderFundRequestsInbox(bodyEl.querySelector('[data-el="inbox"]'), {
        supabase,
        adminUserId: currentUserId,
        departments: scopedDepartments,
        onPendingCountChange: (count) => {
          badgeEl.textContent = String(count);
          badgeEl.classList.toggle('hidden', count === 0);
        },
      });
    } else {
      // Only ever the currently active department -- scopedDepartments
      // has exactly one entry in this branch.
      bodyEl.innerHTML = `
        <div class="mb-4">
          <button type="button" data-action="my-budget" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">${t('reimbursement.myBudgetButton')}</button>
        </div>
        <div data-el="requests"></div>
      `;
      bodyEl.querySelector('[data-action="my-budget"]').addEventListener('click', () => {
        createReimbursementRequestModal({ supabase, departmentId: scopedDepartments[0].id, currentUserId }).open();
      });
      renderMyFundRequests(bodyEl.querySelector('[data-el="requests"]'), { supabase, departmentId: scopedDepartments[0].id, currentUserId });
    }
  }

  function renderReportTab() {
    renderBudgetReport(bodyEl, { supabase, oversight, departments: scopedDepartments, currentUserId, financeDept });
  }
}

function currentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function monthRange(monthValue) {
  const [year, month] = monthValue.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

async function renderBudgetReport(container, { supabase, oversight, departments, currentUserId, financeDept }) {
  // Aggregate totals below are read-only by design (spec: "totals per
  // department per month, not a line-by-line transaction feed") -- but
  // someone still has to be able to log an expense in the first place,
  // and Finance needs to be able to audit a specific department's actual
  // transactions/receipts, not just its total:
  //   - a plain department's own admin/secretary manages their own
  //     department, budgets always approval-gated (allowManualCreate: false).
  //   - a Finance admin/secretary (Finance as their active department)
  //     manages Finance's own budget the same way it always worked --
  //     direct creation (allowManualCreate: true).
  //   - Finance oversight, with a specific department selected in the
  //     filter: a drill-down into that department's own budget list
  //     underneath the aggregate table, with the same manage rights a
  //     Finance Admin has everywhere else (canManage: canApproveFinance()
  //     -- a Finance secretary still only gets read/Export PDF/View
  //     Receipt, matching the RLS write policy which also excludes them).
  const manageDepartmentId = !oversight ? departments[0].id : (financeDept ? financeDept.id : null);
  const allowManualCreate = !!financeDept;

  container.innerHTML = `
    <div class="flex flex-wrap items-center gap-2 mb-4">
      <input type="month" data-el="month-filter" value="${currentMonthValue()}" class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
      ${oversight ? `
        <select data-el="department-filter" class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
          <option value="">${t('finance.allDepartments')}</option>
          ${departments.map((d) => `<option value="${d.id}">${escapeHtml(departmentLabel(d.key))}</option>`).join('')}
        </select>
      ` : ''}
    </div>
    <div data-el="report"><p class="text-sm text-slate-500">${t('common.loading')}</p></div>
    <div data-el="drilldown"></div>
    ${manageDepartmentId ? `
      <div class="mt-6 pt-6 border-t border-slate-200">
        <h3 class="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-2">${t('budgetPage.manageBudgets')}</h3>
        <div data-el="manage"></div>
      </div>
    ` : ''}
  `;

  const reportEl = container.querySelector('[data-el="report"]');
  const drilldownEl = container.querySelector('[data-el="drilldown"]');
  const monthFilterEl = container.querySelector('[data-el="month-filter"]');
  const deptFilterEl = container.querySelector('[data-el="department-filter"]');

  monthFilterEl.addEventListener('change', load);
  deptFilterEl?.addEventListener('change', () => { load(); renderDrilldown(); });

  if (manageDepartmentId) {
    renderBudgetBoard(container.querySelector('[data-el="manage"]'), {
      supabase, departmentId: manageDepartmentId, currentUserId, canManage: true, allowManualCreate,
    });
  }

  renderDrilldown();
  load();

  function renderDrilldown() {
    drilldownEl.innerHTML = '';
    if (!oversight || !deptFilterEl?.value) return;
    const dept = departments.find((d) => d.id === deptFilterEl.value);
    drilldownEl.innerHTML = `
      <div class="mt-6 pt-6 border-t border-slate-200">
        <h3 class="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-2">
          ${t('budgetPage.departmentDetail', { department: dept ? departmentLabel(dept.key) : '' })}
        </h3>
        <div data-el="drilldown-board"></div>
      </div>
    `;
    renderBudgetBoard(drilldownEl.querySelector('[data-el="drilldown-board"]'), {
      supabase, departmentId: deptFilterEl.value, currentUserId, canManage: canApproveFinance(), allowManualCreate: false,
    });
  }

  async function load() {
    reportEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const { start, end } = monthRange(monthFilterEl.value || currentMonthValue());

    let query = supabase
      .from('budget_transactions')
      .select('amount, created_at, budgets!inner ( department_id, departments!inner ( key, name ) )')
      .gte('created_at', start)
      .lt('created_at', end);
    if (deptFilterEl?.value) query = query.eq('budgets.department_id', deptFilterEl.value);

    const { data, error } = await query;

    if (error) {
      reportEl.innerHTML = `<p class="text-sm text-rose-600">${t('budgetPage.reportLoadFailed', { message: error.message })}</p>`;
      return;
    }

    // Not a transaction feed -- only a department (never an individual)
    // can hold a fund request, so the department is the right unit of
    // aggregation here; totals per department for the selected month.
    // Keyed by department_id (not key) so oversight can click straight
    // into that department's drill-down below.
    const totals = new Map();
    (data || []).forEach((tx) => {
      const departmentId = tx.budgets.department_id;
      const dept = tx.budgets.departments;
      if (!totals.has(departmentId)) totals.set(departmentId, { key: dept.key, name: dept.name, total: 0, count: 0 });
      const entry = totals.get(departmentId);
      entry.total += Number(tx.amount);
      entry.count += 1;
    });

    if (totals.size === 0) {
      reportEl.innerHTML = `<p class="text-sm text-slate-500">${t('budgetPage.noSpending')}</p>`;
      return;
    }

    const rows = Array.from(totals.entries()).sort((a, b) => b[1].total - a[1].total);
    // Oversight only -- a plain department's own admin/secretary only
    // ever has one row (their own department), already expanded in the
    // "Manage Budgets" section below, so there's nothing to drill into.
    const rowTag = oversight ? 'button' : 'div';
    reportEl.innerHTML = `
      <div class="space-y-2">
        ${rows.map(([departmentId, entry]) => `
          <${rowTag} ${oversight ? `type="button" data-department-id="${departmentId}"` : ''} class="w-full flex items-center justify-between border border-slate-200 rounded-lg p-3 text-left ${oversight ? 'hover:border-indigo-300 hover:shadow-sm transition-shadow cursor-pointer' : ''}">
            <div class="font-medium text-slate-800">${escapeHtml(departmentLabel(entry.key) || entry.name)}</div>
            <div class="text-right">
              <div class="font-semibold">${formatAmount(entry.total)}</div>
              <div class="text-xs text-slate-400">${t('budget.transactionCount', { count: entry.count })}</div>
            </div>
          </${rowTag}>
        `).join('')}
      </div>
    `;

    if (oversight) {
      reportEl.querySelectorAll('[data-department-id]').forEach((rowEl) => {
        rowEl.addEventListener('click', () => {
          deptFilterEl.value = rowEl.dataset.departmentId;
          renderDrilldown();
          drilldownEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      });
    }
  }
}

function formatAmount(amount) {
  return formatMoney(amount);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
