// Finance: Budget Management — the actual ledger (named budgets with an
// initial amount, expenses recorded against them), distinct from
// budgetRequests.js's fund-request inbox, which stays untouched
// alongside this. Spent/remaining/progress are computed client-side,
// not a SQL view (views need security_invoker to inherit RLS
// correctly — an easy-to-get-wrong pitfall, so this avoids it
// entirely) — same shape as dashboardOverview.js's own client-side
// aggregation.
import { t, formatMoney } from '../i18n.js';
import { createBudgetDetailModal } from './budgetDetailModal.js';

export function renderBudgetBoard(container, { supabase, departmentId, currentUserId, canManage, allowManualCreate = true }) {
  container.innerHTML = `
    <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-semibold">${t('budget.title')}</h2>
        <div data-el="header-action"></div>
      </div>
      <div data-el="create-form-wrap" class="hidden mb-6 pb-6 border-b border-slate-200"></div>
      <div data-el="sections"></div>
    </div>
  `;

  const sectionsEl = container.querySelector('[data-el="sections"]');
  const createFormWrapEl = container.querySelector('[data-el="create-form-wrap"]');
  const headerActionEl = container.querySelector('[data-el="header-action"]');

  load();

  function toggleCreateForm() {
    const isHidden = createFormWrapEl.classList.contains('hidden');
    if (!isHidden) { createFormWrapEl.classList.add('hidden'); createFormWrapEl.innerHTML = ''; return; }
    createFormWrapEl.classList.remove('hidden');
    renderCreateForm(createFormWrapEl);
  }

  // Finance creates budgets directly (unchanged). Every other department
  // only ever gets one through Finance approving a fund request
  // (budgetRequests.js) -- approval auto-creates it, so there's no
  // manual "Add New Budget" button for them to operate; a disabled
  // placeholder just explains that, shown only while they have nothing
  // yet (the spec's "button stays greyed out until approved" -- once
  // approved, what they see is the real budget, not an unlocked button).
  function renderHeaderAction(hasBudgets) {
    if (!canManage) { headerActionEl.innerHTML = ''; return; }
    if (allowManualCreate) {
      headerActionEl.innerHTML = `<button type="button" data-action="add-budget" class="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">${t('budget.addNew')}</button>`;
      headerActionEl.querySelector('[data-action="add-budget"]').addEventListener('click', toggleCreateForm);
      return;
    }
    if (!hasBudgets) {
      headerActionEl.innerHTML = `<button type="button" disabled class="px-3 py-1.5 rounded-lg bg-slate-200 text-slate-400 text-sm font-medium cursor-not-allowed" title="${t('budget.addNewDisabledHint')}">${t('budget.addNew')}</button>`;
    } else {
      headerActionEl.innerHTML = '';
    }
  }

  function renderCreateForm(el) {
    el.innerHTML = `
      <form data-el="form" class="space-y-3">
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('budget.name')}</label>
          <input type="text" name="name" required class="w-full border border-slate-300 rounded-lg px-3 py-2" />
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('budget.initialAmount')}</label>
          <input type="number" name="initial_amount" step="0.01" min="0" required class="w-full border border-slate-300 rounded-lg px-3 py-2" />
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('budget.description')}</label>
          <textarea name="description" rows="2" class="w-full border border-slate-300 rounded-lg px-3 py-2"></textarea>
        </div>
        <div class="flex items-center gap-3">
          <button type="submit" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">${t('budget.create')}</button>
          <button type="button" data-action="cancel" class="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 font-medium hover:bg-slate-200">${t('budget.cancel')}</button>
          <span data-el="form-status" class="text-sm text-slate-500"></span>
        </div>
      </form>
    `;
    const form = el.querySelector('[data-el="form"]');
    const statusEl = el.querySelector('[data-el="form-status"]');
    el.querySelector('[data-action="cancel"]').addEventListener('click', toggleCreateForm);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = form.elements.name.value.trim();
      const initialAmount = Number(form.elements.initial_amount.value);
      const description = form.elements.description.value.trim() || null;
      if (!name || Number.isNaN(initialAmount)) return;

      statusEl.className = 'text-sm text-slate-500';
      statusEl.textContent = t('common.saving');

      // Finance creating its own budget directly (this form only ever
      // reaches the server with allowManualCreate: true) has no separate
      // approval step -- self-approved, so approved_by is the creator.
      const { error } = await supabase.from('budgets').insert({
        department_id: departmentId,
        name,
        initial_amount: initialAmount,
        description,
        created_by: currentUserId,
        approved_by: currentUserId,
      });

      if (error) {
        statusEl.className = 'text-sm text-rose-600';
        statusEl.textContent = t('budget.createFailed', { message: error.message });
        return;
      }

      toggleCreateForm();
      load();
    });
  }

  async function load() {
    sectionsEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const { data: budgets, error } = await supabase
      .from('budgets')
      .select('id, name, initial_amount, description, status, created_at, closed_at')
      .eq('department_id', departmentId)
      .order('created_at', { ascending: false });

    if (error) {
      sectionsEl.innerHTML = `<p class="text-sm text-rose-600">${t('budget.loadFailed', { message: error.message })}</p>`;
      return;
    }

    renderHeaderAction((budgets || []).length > 0);

    if (!budgets || budgets.length === 0) {
      sectionsEl.innerHTML = `<p class="text-sm text-slate-500">${allowManualCreate ? t('budget.noBudgets') : t('budget.noBudgetsPendingApproval')}</p>`;
      return;
    }

    const budgetIds = budgets.map((b) => b.id);
    const { data: transactions } = await supabase
      .from('budget_transactions')
      .select('budget_id, amount')
      .in('budget_id', budgetIds);

    const spentByBudget = new Map();
    const countByBudget = new Map();
    (transactions || []).forEach((t2) => {
      spentByBudget.set(t2.budget_id, (spentByBudget.get(t2.budget_id) || 0) + Number(t2.amount));
      countByBudget.set(t2.budget_id, (countByBudget.get(t2.budget_id) || 0) + 1);
    });

    const groups = { active: [], upcoming: [], closed: [] };
    budgets.forEach((b) => groups[b.status]?.push(b));

    sectionsEl.innerHTML = '';
    renderSection(t('budget.active'), groups.active);
    renderSection(t('budget.upcoming'), groups.upcoming);
    renderSection(t('budget.closed'), groups.closed);

    function renderSection(label, list) {
      if (list.length === 0) return;
      const section = document.createElement('div');
      section.className = 'mb-6 last:mb-0';
      section.innerHTML = `<div class="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">${label}</div>`;
      const grid = document.createElement('div');
      grid.className = 'grid sm:grid-cols-2 lg:grid-cols-3 gap-3';
      list.forEach((b) => grid.appendChild(renderCard(b)));
      section.appendChild(grid);
      sectionsEl.appendChild(section);
    }

    function renderCard(budget) {
      const spent = spentByBudget.get(budget.id) || 0;
      const remaining = Number(budget.initial_amount) - spent;
      const pct = Number(budget.initial_amount) > 0 ? Math.min(100, Math.round((spent / Number(budget.initial_amount)) * 100)) : 0;
      const count = countByBudget.get(budget.id) || 0;

      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'text-left border border-slate-200 rounded-lg p-4 hover:border-indigo-300 hover:shadow-sm transition-shadow';
      card.innerHTML = `
        <div class="font-medium text-slate-800 mb-2">${escapeHtml(budget.name)}</div>
        <div class="text-xs text-slate-500 space-y-0.5 mb-2">
          <div>${t('budget.assigned')}: ${formatAmount(budget.initial_amount)}</div>
          <div>${t('budget.spent')}: ${formatAmount(spent)}</div>
          <div class="${remaining < 0 ? 'text-rose-600 font-medium' : ''}">${t('budget.remaining')}: ${formatAmount(remaining)}</div>
        </div>
        <div class="w-full bg-slate-100 rounded-full h-2 mb-2">
          <div class="h-2 rounded-full ${pct >= 100 ? 'bg-rose-500' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500'}" style="width:${pct}%"></div>
        </div>
        <div class="text-xs text-slate-400">${t('budget.transactionCount', { count })}</div>
      `;
      card.addEventListener('click', () => {
        createBudgetDetailModal({
          supabase, budgetId: budget.id, departmentId, currentUserId, canManage,
          onChanged: load,
        }).open();
      });
      return card;
    }
  }
}

export function formatAmount(amount) {
  return formatMoney(amount);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
