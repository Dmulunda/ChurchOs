// Finance: Budget Management — printable summary, same open-a-tab-and-
// window.print() pattern as certificate.js/disciplinaryLetters.js (a
// real PDF via the browser's own "Save as PDF", no jsPDF/html2canvas --
// that pattern is for image-heavy card exports, this is a text/table
// report).
//
// Layout: logo + church name, church address, "Approved by" on the
// left; department name, budget name, created by, created/closed dates
// on the right.
import { t, departmentLabel, appLocale } from '../i18n.js';
import { formatAmount } from './budgetBoard.js';
import { getTenant } from '../tenant.js';

export function printBudgetSummary(budget, transactions, { spent, remaining }) {
  // Falls back to the platform default only if this tenant hasn't
  // uploaded/set their own yet -- same pattern as memberIdCard.js's
  // header, the one other place in this app that prints the org's name
  // as text rather than just showing a logo image. churchAddress comes
  // from tenants.address (set via tenantLogoModal.js's address section,
  // sql/saas_platform/20_tenant_address.sql) -- the line is only
  // rendered when a tenant has actually set one.
  const churchName = getTenant()?.name || t('app.brand');
  const churchAddress = getTenant()?.address || '';
  const logoUrl = getTenant()?.logo_url || null;
  // A real approver only ever exists for a budget that went through
  // Finance's approve_budget_request() -- always a Finance admin. The
  // creator fallback is for Finance's own directly-created budgets
  // (self-approved, budgetBoard.js sets approved_by = creator for
  // those specifically) -- restricted to Finance's own department, or
  // any other department's budget with no real approver on record
  // (stray/legacy data) would misleadingly show its own creator, who
  // was never a Finance admin, as if they'd approved themselves.
  const isFinanceOwnBudget = budget.department?.key === 'finance';
  const approverName = budget.approver?.full_name || (isFinanceOwnBudget ? budget.creator?.full_name : null);
  const departmentName = budget.department ? departmentLabel(budget.department.key) : '';
  const createdLabel = formatDateTime(budget.created_at);
  const closedLabel = budget.closed_at ? formatDateTime(budget.closed_at) : null;

  const html = `
    <!DOCTYPE html>
    <html lang="${document.documentElement.lang || 'en'}">
    <head>
      <meta charset="UTF-8" />
      <title>${escapeHtml(budget.name)} — ${escapeHtml(churchName)}</title>
      <style>
        body { font-family: Georgia, 'Times New Roman', serif; margin: 0; padding: 48px; color: #0B1F3A; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; border-bottom: 2px solid #D4AF37; padding-bottom: 16px; margin-bottom: 24px; }
        .header .left, .header .right { font-size: 13px; line-height: 1.6; }
        .header .right { text-align: right; }
        .header .church-logo { height: 40px; width: auto; margin-bottom: 6px; }
        .header .church-name { font-size: 18px; font-weight: bold; }
        .header .department-name { font-size: 15px; font-weight: bold; }
        .header .budget-name { font-size: 13px; }
        .summary { display: flex; gap: 32px; margin-bottom: 32px; }
        .summary .stat { flex: 1; border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px 16px; }
        .summary .stat .label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
        .summary .stat .value { font-size: 20px; font-weight: bold; margin-top: 4px; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; border-bottom: 2px solid #cbd5e1; padding: 8px 12px 8px 0; }
        td { padding: 8px 12px 8px 0; border-bottom: 1px solid #e2e8f0; }
        .no-print { text-align: center; margin-top: 32px; }
        .no-print button { font-family: inherit; font-size: 14px; padding: 10px 20px; border-radius: 8px; border: none; background: #0B1F3A; color: white; cursor: pointer; }
        @media print { .no-print { display: none; } }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="left">
          ${logoUrl ? `<img src="${logoUrl}" alt="" class="church-logo" />` : ''}
          <div class="church-name">${escapeHtml(churchName)}</div>
          ${churchAddress ? `<div>${escapeHtml(churchAddress)}</div>` : ''}
          ${approverName ? `<div>${t('budget.approvedBy')}: ${escapeHtml(approverName)}</div>` : ''}
        </div>
        <div class="right">
          ${departmentName ? `<div class="department-name">${escapeHtml(departmentName)}</div>` : ''}
          <div class="budget-name">${escapeHtml(budget.name)}</div>
          <div>${t('budget.createdBy')}: ${escapeHtml(budget.creator?.full_name || '—')}</div>
          <div>${t('budget.createdOn')}: ${escapeHtml(createdLabel)}</div>
          ${closedLabel ? `<div>${t('budget.closedOn')}: ${escapeHtml(closedLabel)}</div>` : ''}
        </div>
      </div>

      <div class="summary">
        <div class="stat"><div class="label">${t('budget.assigned')}</div><div class="value">${formatAmount(budget.initial_amount)}</div></div>
        <div class="stat"><div class="label">${t('budget.spent')}</div><div class="value">${formatAmount(spent)}</div></div>
        <div class="stat"><div class="label">${t('budget.remaining')}</div><div class="value">${formatAmount(remaining)}</div></div>
      </div>

      ${transactions.length === 0 ? `<p>${t('budget.noTransactions')}</p>` : `
        <table>
          <thead>
            <tr>
              <th>${t('budget.transactionDate')}</th>
              <th>${t('budget.transactionPerson')}</th>
              <th>${t('budget.transactionAmount')}</th>
            </tr>
          </thead>
          <tbody>
            ${transactions.map((tx) => `
              <tr>
                <td>${escapeHtml(formatDateTime(tx.created_at))}</td>
                <td>${escapeHtml(tx.spender?.full_name || '—')}</td>
                <td>${formatAmount(tx.amount)}${tx.note ? ` — ${escapeHtml(tx.note)}` : ''}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}

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

function formatDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(appLocale(), { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
