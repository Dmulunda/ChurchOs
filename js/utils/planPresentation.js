// Shared between plansModal.js (signed-in, in-app "Plans & Pricing"),
// planPickerModal.js (right after a new signup), and welcomePage.js
// (public marketing site, anonymous visitors) so all three never
// describe a plan's limits/features differently. Pure display-string
// logic only -- no Supabase calls; renderComparisonTable() returns an
// HTML string for the caller to insert, not a DOM node itself.
import { t, formatMoney } from '../i18n.js';

// Core functionality included in every tier -- not gated per plan, so
// not stored in plan_features (that table is only for things a plan
// can turn on/off, like vpd_academy).
export const BASE_FEATURE_KEYS = [
  'plans.featureChoirManagement',
  'plans.featureMemberManagement',
  'plans.featureDepartmentManagement',
  'plans.featureProgramsEvents',
  'plans.featureFinancialManagement',
  'plans.featurePastoralScheduling',
  'plans.featureAttendanceTracking',
  'plans.featureTeamScheduling',
];

// A feature-comparison TABLE (one row per differentiator, one column
// per plan) instead of a per-plan bullet list -- easier to compare
// price/limits/features across tiers at a glance, matching exactly
// the comparison table the pricing was specified from. `plans` must
// be the SAME billing_interval (pre-filtered by the caller) and in
// price order; each plan needs plan_features ( features ( key ) ) and
// the max_* columns selected.
function hasFeatureRow(plan, key) {
  return plan.plan_features.some((pf) => pf.features.key === key);
}

function numberOrUnlimited(n) {
  return n === null ? t('plans.tableUnlimited') : String(n);
}

function departmentsText(plan) {
  if (hasFeatureRow(plan, 'create_departments')) return t('plans.tableDepartmentsCreate');
  if (hasFeatureRow(plan, 'all_departments')) return t('plans.tableDepartmentsAll');
  return t('plans.tableDepartmentsCore');
}

function churchesText(plan) {
  if (plan.max_extensions === 0) return t('plans.tableChurchesSingle');
  if (plan.max_extensions === null) return t('plans.tableChurchesUnlimitedExtensions');
  return t('plans.tableChurchesUpTo', { count: plan.max_extensions });
}

const CHECK = '✓';
const CROSS = '✗';

export function buildComparisonRows(plans) {
  const check = (bool) => (bool ? CHECK : CROSS);
  return [
    { label: t('plans.tableRowMembers'), values: plans.map((p) => numberOrUnlimited(p.max_members)) },
    { label: t('plans.tableRowDepartments'), values: plans.map(departmentsText) },
    { label: t('plans.tableRowCustomizeDepartments'), values: plans.map((p) => check(hasFeatureRow(p, 'customize_departments'))) },
    { label: t('plans.tableRowAdmins'), values: plans.map((p) => numberOrUnlimited(p.max_admins)) },
    { label: t('plans.tableRowSuperAdmins'), values: plans.map((p) => numberOrUnlimited(p.max_super_admins_per_tenant)) },
    { label: t('plans.tableRowGlobalAdmins'), values: plans.map((p) => (p.max_global_admins === 0 ? CROSS : numberOrUnlimited(p.max_global_admins))) },
    { label: t('plans.tableRowChurches'), values: plans.map(churchesText) },
    { label: t('plans.tableRowProjection'), values: plans.map((p) => check(hasFeatureRow(p, 'projection'))) },
    { label: t('plans.tableRowCopAcademy'), values: plans.map((p) => check(hasFeatureRow(p, 'vpd_academy'))) },
    { label: t('plans.tableRowFlyers'), values: plans.map((p) => check(hasFeatureRow(p, 'flyers'))) },
    { label: t('plans.tableRowMemberCard'), values: plans.map((p) => check(hasFeatureRow(p, 'member_card'))) },
    { label: t('plans.tableRowUpdates'), values: plans.map((p) => (p.key.startsWith('premium') ? t('plans.tableEarlyAccess') : t('plans.tableStandardUpdates'))) },
  ];
}

function escapeHtmlLocal(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

// Renders the full table as an HTML string -- `priceCellsHtml` is one
// pre-rendered HTML string per plan (callers format price/promo
// discount differently), `actionCellsHtml` likewise for the trailing
// button/CTA row (checkout button, "Select Plan", "Get Started" link
// -- all different per caller). Buttons are inert at this point
// (plain HTML); the caller wires real listeners after inserting this
// into the DOM, same as it already did for the old card buttons.
export function renderComparisonTable({ plans, currentPlanId, priceCellsHtml, actionCellsHtml }) {
  const rows = buildComparisonRows(plans);
  const cellClass = (v) => (v === CHECK ? 'text-emerald-600 font-bold' : v === CROSS ? 'text-slate-300' : 'text-slate-700');

  return `
    <table class="w-full text-sm border-collapse">
      <thead>
        <tr class="border-b border-slate-200">
          <th class="text-left py-2 px-2"></th>
          ${plans.map((p) => `
            <th class="py-2 px-2 text-center align-bottom">
              <div class="font-bold text-slate-800">${escapeHtmlLocal(p.name)}</div>
              ${p.id === currentPlanId ? `<div class="text-[11px] font-semibold text-indigo-600 mt-0.5">${t('plans.currentPlan')}</div>` : ''}
            </th>
          `).join('')}
        </tr>
        <tr class="border-b border-slate-200">
          <th class="text-left py-2 px-2"></th>
          ${priceCellsHtml.map((html) => `<td class="py-2 px-2 text-center">${html}</td>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => `
          <tr class="border-b border-slate-100">
            <td class="py-2 px-2 text-slate-600 whitespace-nowrap">${row.label}</td>
            ${row.values.map((v) => `<td class="py-2 px-2 text-center ${cellClass(v)}">${escapeHtmlLocal(v)}</td>`).join('')}
          </tr>
        `).join('')}
      </tbody>
      ${actionCellsHtml ? `
        <tfoot>
          <tr>
            <td class="py-3 px-2"></td>
            ${actionCellsHtml.map((html) => `<td class="py-3 px-2 text-center">${html}</td>`).join('')}
          </tr>
        </tfoot>
      ` : ''}
    </table>
  `;
}

// toFixed(0) would round 59.99/99.99/199.99 to whole dollars
// ($60/$100/$200) -- keep the exact cents, comma as the decimal
// separator per how these prices were originally given (59,99).
export function formatPlanPrice(priceCents, billingInterval = 'monthly') {
  if (priceCents === 0) return t('plans.free');
  const suffix = billingInterval === 'yearly' ? t('plans.perYear') : t('plans.perMonth');
  return `${formatMoney(priceCents / 100)}${suffix}`;
}

// The "≈ $X/mo billed annually" subtitle shown under a yearly card's
// price -- same comma-decimal convention as formatPlanPrice above.
export function formatMonthlyEquivalent(yearlyPriceCents) {
  return `${formatMoney(yearlyPriceCents / 1200)}`;
}
