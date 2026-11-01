// Entry point for index.html — the public marketing/landing page,
// anonymous visitors only (no auth gate). Deliberately outside the
// normal app.js/app.html shell, same pattern as publicBooking.js.
// Pricing is fetched live from the plans table (anon-readable per
// 46_public_pricing_read.sql) so this page can never silently drift
// from what plansModal.js shows a signed-in Super Admin — one plan
// catalog, two places it's rendered.
import { supabase } from './supabaseClient.js';
import { renderComparisonTable, formatPlanPrice, formatMonthlyEquivalent } from './utils/planPresentation.js';
import { getLang, setLang, onLangChange, loadLabelOverrides, applyStaticTranslations, departmentLabel, t } from './i18n.js';
import { DEPARTMENT_KEYS } from './departments.js';

let allPlans = [];
let selectedPricingInterval = 'monthly';
const pricingIntervalMonthlyBtn = document.querySelector('[data-action="pricing-interval-monthly"]');
const pricingIntervalYearlyBtn = document.querySelector('[data-action="pricing-interval-yearly"]');
pricingIntervalMonthlyBtn.addEventListener('click', () => { selectedPricingInterval = 'monthly'; renderPricing(); });
pricingIntervalYearlyBtn.addEventListener('click', () => { selectedPricingInterval = 'yearly'; renderPricing(); });

document.querySelector('[data-el="year"]').textContent = new Date().getFullYear();
document.documentElement.lang = getLang();

const langSelect = document.querySelector('#welcome-lang-select');
langSelect.value = getLang();
langSelect.addEventListener('change', () => setLang(langSelect.value));
onLangChange(() => {
  langSelect.value = getLang();
  applyStaticTranslations();
  renderFeatures();
  loadPricing();
});

init();

// A church sharing its referral link (js/components/referralModal.js)
// points here as index.html?ref=<code>. Every "Get Started" link on this
// page -- the static header/hero ones in index.html, and the ones the
// pricing table renders below -- needs to carry that code through to
// authScreen.js's signup form, or it's silently lost.
function getStartedHref() {
  const ref = new URLSearchParams(window.location.search).get('ref');
  return ref ? `app.html?mode=new-church&ref=${encodeURIComponent(ref)}` : 'app.html?mode=new-church';
}

async function init() {
  // Best-effort, same as publicBooking.js -- menu_labels has never been
  // read by an anonymous visitor before now; the built-in TRANSLATIONS
  // dictionary is a perfectly fine default if RLS or anything else
  // about that turns out unfriendly to the anon role.
  try {
    await loadLabelOverrides();
  } catch { /* fall through to built-in translations */ }
  applyStaticTranslations();

  document.querySelectorAll('a[href="app.html?mode=new-church"]').forEach((a) => { a.href = getStartedHref(); });

  renderFeatures();
  loadPricing();
  wireContactForm();
}

// Specific to what's actually built (see sql/saas_platform/*.sql and
// js/components/*.js), not a generic "member management, event
// planning, reports" list every church-software site has -- each
// title/desc names the real mechanism, not a category label. The
// "ministries" card pulls the live DEPARTMENT_KEYS + departmentLabel()
// the app itself uses (not a hand-copied list), so it can't drift out
// of sync with the real seeded department names, in either language.
function buildFeatures() {
  const deptList = DEPARTMENT_KEYS.map((key) => departmentLabel(key)).join(', ');
  return [
    { title: t('welcome.featureDeptsTitle'), desc: t('welcome.featureDeptsDesc', { list: deptList }) },
    { title: t('welcome.featureSchedulingTitle'), desc: t('welcome.featureSchedulingDesc') },
    { title: t('welcome.featureExtensionsTitle'), desc: t('welcome.featureExtensionsDesc') },
    { title: t('welcome.featureTaxTitle'), desc: t('welcome.featureTaxDesc') },
    { title: t('welcome.featureBookingTitle'), desc: t('welcome.featureBookingDesc') },
    { title: t('welcome.featureServiceProgramTitle'), desc: t('welcome.featureServiceProgramDesc') },
    { title: t('welcome.featureHeadcountTitle'), desc: t('welcome.featureHeadcountDesc') },
    { title: t('welcome.featureBudgetTitle'), desc: t('welcome.featureBudgetDesc') },
    { title: t('welcome.featureIdCardTitle'), desc: t('welcome.featureIdCardDesc') },
  ];
}

function renderFeatures() {
  const grid = document.querySelector('[data-el="features-grid"]');
  grid.innerHTML = buildFeatures().map(({ title, desc }) => `
    <div class="bg-white rounded-xl border border-slate-200 p-5">
      <p class="text-sm font-semibold text-[#0B1F3A] mb-1.5">${escapeHtml(title)}</p>
      <p class="text-sm text-slate-600 leading-relaxed">${escapeHtml(desc)}</p>
    </div>
  `).join('');
}

async function loadPricing() {
  const grid = document.querySelector('[data-el="pricing-grid"]');
  grid.innerHTML = `<p class="text-center text-slate-400">${escapeHtml(t('welcome.loadingPlans'))}</p>`;

  const { data: plans, error } = await supabase
    .from('plans')
    .select(`
      id, key, name, price_cents, billing_interval, plan_group,
      max_extensions, max_super_admins_per_tenant, max_members, max_admins, max_global_admins, storage_gb,
      plan_features ( features ( key, name ) )
    `)
    .order('price_cents');

  if (error || !plans) {
    grid.innerHTML = `<p class="text-center text-rose-600">${escapeHtml(t('welcome.pricingFailed'))}</p>`;
    return;
  }

  allPlans = plans;
  renderPricing();
}

function renderPricing() {
  pricingIntervalMonthlyBtn.textContent = t('plans.billedMonthly');
  pricingIntervalYearlyBtn.textContent = t('plans.billedYearly');
  const activeClass = 'bg-indigo-600 text-white';
  const inactiveClass = 'text-slate-600 hover:bg-slate-100';
  pricingIntervalMonthlyBtn.className = `px-3 py-1.5 rounded-md text-sm font-medium ${selectedPricingInterval === 'monthly' ? activeClass : inactiveClass}`;
  pricingIntervalYearlyBtn.className = `px-3 py-1.5 rounded-md text-sm font-medium ${selectedPricingInterval === 'yearly' ? activeClass : inactiveClass}`;

  const grid = document.querySelector('[data-el="pricing-grid"]');
  if (allPlans.length === 0) return;

  const plans = allPlans.filter((p) => p.billing_interval === selectedPricingInterval);
  const priceCellsHtml = plans.map((plan) => {
    const monthlyEquivalent = plan.billing_interval === 'yearly' && plan.price_cents > 0
      ? `<div class="text-[11px] font-normal text-slate-500">${t('plans.monthlyEquivalent', { amount: formatMonthlyEquivalent(plan.price_cents) })}</div>`
      : '';
    return `<div class="font-bold text-slate-900">${formatPlanPrice(plan.price_cents, plan.billing_interval)}</div>${monthlyEquivalent}`;
  });
  const actionCellsHtml = plans.map(() => `<a href="${getStartedHref()}" class="inline-block px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">${escapeHtml(t('welcome.getStarted'))}</a>`);

  grid.innerHTML = `<div class="overflow-x-auto">${renderComparisonTable({ plans, currentPlanId: null, priceCellsHtml, actionCellsHtml })}</div>`;
}

const TOPIC_KEYS = { demo: 'welcome.topicDemo', general: 'welcome.topicGeneral', support: 'welcome.topicSupport' };

// Saves to website_inquiries first (sql/053) -- a real, reliably-
// captured backend every Site Admin sees, unlike the old mailto-only
// flow, which silently went nowhere on a device with no configured
// email app. Once that's done, still finishes the original mailto
// flow too (pre-addressed to info@aliviatech.ca) so a visitor who
// wants to follow up directly by email still can, and Site Admins get
// both the in-app record and, if the visitor's own client cooperates,
// a direct email.
function wireContactForm() {
  const form = document.querySelector('[data-el="contact-form"]');
  const submitBtn = form.querySelector('[data-el="submit-btn"]');
  const statusEl = form.querySelector('[data-el="form-status"]');
  const hintText = t('welcome.formHint');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const topicValue = form.elements.topic.value;
    const topic = t(TOPIC_KEYS[topicValue] || TOPIC_KEYS.general);
    const name = form.elements.name.value.trim();
    const email = form.elements.email.value.trim();
    const phone = form.elements.phone.value.trim();
    const church = form.elements.church.value.trim();
    const message = form.elements.message.value.trim();

    submitBtn.disabled = true;
    statusEl.textContent = t('common.saving');

    const { error } = await supabase.from('website_inquiries').insert({
      topic: topicValue || 'general',
      name,
      email,
      phone,
      church_name: church || null,
      message: message || null,
    });

    submitBtn.disabled = false;
    statusEl.textContent = error ? t('welcome.formSaveFailed') : hintText;

    const subject = `ChurchOnPoint — ${topic}${church ? ` — ${church}` : ''}`;
    const body = [
      `Name: ${name}`,
      `Email: ${email}`,
      `Phone: ${phone}`,
      church ? `Church: ${church}` : null,
      '',
      message,
    ].filter((line) => line !== null).join('\n');

    window.location.href = `mailto:info@aliviatech.ca?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
