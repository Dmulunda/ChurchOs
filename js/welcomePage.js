// Entry point for index.html — the public marketing/landing page,
// anonymous visitors only (no auth gate). Deliberately outside the
// normal app.js/app.html shell, same pattern as publicBooking.js.
// Pricing is fetched live from the plans table (anon-readable per
// 46_public_pricing_read.sql) so this page can never silently drift
// from what plansModal.js shows a signed-in Super Admin — one plan
// catalog, two places it's rendered. The page's own wording lives in
// js/landingText.js (data-l="key"); shared labels stay in i18n.js
// (data-i18n).
import { supabase } from './supabaseClient.js';
import { renderComparisonTable, formatPlanPrice, formatMonthlyEquivalent, BASE_FEATURE_KEYS } from './utils/planPresentation.js';
import { getLang, setLang, onLangChange, loadLabelOverrides, applyStaticTranslations, departmentLabel, t, formatMoney } from './i18n.js';
import { DEPARTMENT_KEYS } from './departments.js';
import { LANDING_TEXT } from './landingText.js';

let allPlans = [];
let selectedPricingInterval = 'monthly';
const pricingIntervalMonthlyBtn = document.querySelector('[data-action="pricing-interval-monthly"]');
const pricingIntervalYearlyBtn = document.querySelector('[data-action="pricing-interval-yearly"]');
pricingIntervalMonthlyBtn.addEventListener('click', () => { selectedPricingInterval = 'monthly'; renderPricing(); });
pricingIntervalYearlyBtn.addEventListener('click', () => { selectedPricingInterval = 'yearly'; renderPricing(); });

document.querySelector('[data-el="year"]').textContent = new Date().getFullYear();

const langSelect = document.querySelector('#welcome-lang-select');
langSelect.value = getLang();
langSelect.addEventListener('change', () => setLang(langSelect.value));
onLangChange(() => {
  langSelect.value = getLang();
  applyStaticTranslations();
  applyLandingText();
  renderFeatures();
  renderFaq();
  renderPricing();
});

function L(key, vars = {}) {
  const dict = LANDING_TEXT[getLang()] || LANDING_TEXT.en;
  const raw = dict[key] ?? LANDING_TEXT.en[key] ?? key;
  return String(raw).replace(/\{(\w+)\}/g, (_, v) => (vars[v] ?? ''));
}

function applyLandingText() {
  document.documentElement.lang = getLang();
  document.querySelectorAll('[data-l]').forEach((el) => { el.textContent = L(el.dataset.l); });
}

init();

// A church sharing its referral link (js/components/referralModal.js)
// points here as index.html?ref=<code>. Every "Get Started" link on this
// page -- the static header/hero ones in index.html, and the ones the
// pricing cards render below -- needs to carry that code through to
// authScreen.js's signup form, or it's silently lost.
function getStartedHref() {
  const ref = new URLSearchParams(window.location.search).get('ref');
  return ref ? `app.html?mode=new-church&ref=${encodeURIComponent(ref)}` : 'app.html?mode=new-church';
}

async function init() {
  // Best-effort -- the built-in TRANSLATIONS dictionary is a fine
  // default if menu_labels can't be read by an anonymous visitor.
  try {
    await loadLabelOverrides();
  } catch { /* fall through to built-in translations */ }
  applyStaticTranslations();
  applyLandingText();

  document.querySelectorAll('a[href="app.html?mode=new-church"]').forEach((a) => { a.href = getStartedHref(); });
  document.querySelector('[data-demo-link]')?.addEventListener('click', () => {
    const topic = document.querySelector('[data-el="contact-form"] [name="topic"]');
    if (topic) topic.value = 'demo';
  });

  renderFeatures();
  renderFaq();
  loadPricing();
  wireContactForm();
}

// ---------- icons ----------
const ICON_PATHS = {
  layers: '<path d="M12 2 3 7l9 5 9-5-9-5z"/><path d="m3 17 9 5 9-5"/><path d="m3 12 9 5 9-5"/>',
  calendarCheck: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="m9 16 2 2 4-4"/>',
  building: '<path d="M3 21h18M5 21V7l7-4 7 4v14"/><path d="M9 21v-5h6v5"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  counter: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h2M14 11h2M8 15h2M14 15h2"/>',
  wallet: '<path d="M20 7H5a2 2 0 0 1 0-4h13v4"/><path d="M3 5v14a2 2 0 0 0 2 2h15V7"/><path d="M16 14h.01"/>',
  idCard: '<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="8" cy="12" r="2"/><path d="M14 10h4M14 14h4"/>',
};
const icon = (name, size = 22) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`;
const CHECK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const DASH = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 12h12"/></svg>';

// Specific to what's actually built, each title/desc names the real
// mechanism. The "ministries" card pulls the live DEPARTMENT_KEYS +
// departmentLabel() the app itself uses.
function buildFeatures() {
  const deptList = DEPARTMENT_KEYS.map((key) => departmentLabel(key)).join(', ');
  return [
    { icon: 'layers', title: t('welcome.featureDeptsTitle'), desc: t('welcome.featureDeptsDesc', { list: deptList }) },
    { icon: 'calendarCheck', title: t('welcome.featureSchedulingTitle'), desc: t('welcome.featureSchedulingDesc') },
    { icon: 'list', title: t('welcome.featureServiceProgramTitle'), desc: t('welcome.featureServiceProgramDesc') },
    { icon: 'building', title: t('welcome.featureExtensionsTitle'), desc: t('welcome.featureExtensionsDesc') },
    { icon: 'clock', title: t('welcome.featureBookingTitle'), desc: t('welcome.featureBookingDesc') },
    { icon: 'receipt', title: t('welcome.featureTaxTitle'), desc: t('welcome.featureTaxDesc') },
    { icon: 'wallet', title: t('welcome.featureBudgetTitle'), desc: t('welcome.featureBudgetDesc') },
    { icon: 'counter', title: t('welcome.featureHeadcountTitle'), desc: t('welcome.featureHeadcountDesc') },
    { icon: 'idCard', title: t('welcome.featureIdCardTitle'), desc: t('welcome.featureIdCardDesc') },
  ];
}

function renderFeatures() {
  const grid = document.querySelector('[data-el="features-grid"]');
  grid.innerHTML = buildFeatures().map(({ icon: ic, title, desc }) => `
    <div class="card p-6">
      <span class="icon-chip">${icon(ic)}</span>
      <p class="mt-4 font-bold text-[16px]" style="color:var(--navy)">${escapeHtml(title)}</p>
      <p class="mt-1.5 text-[14.5px] leading-relaxed" style="color:var(--muted)">${escapeHtml(desc)}</p>
    </div>
  `).join('');
}

function renderFaq() {
  const el = document.querySelector('[data-el="faq"]');
  el.innerHTML = [1, 2, 3, 4, 5].map((n) => `
    <details class="faq py-1">
      <summary class="py-4 flex items-center justify-between gap-4 font-semibold text-[16px]" style="color:var(--navy)">
        <span>${escapeHtml(L(`faq${n}Q`))}</span>
        <svg class="chev shrink-0" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
      </summary>
      <p class="pb-4 -mt-1 text-[15px] leading-relaxed" style="color:var(--muted)">${escapeHtml(L(`faq${n}A`))}</p>
    </details>
  `).join('');
}

// ---------- pricing ----------
async function loadPricing() {
  const grid = document.querySelector('[data-el="pricing-grid"]');
  grid.innerHTML = `<p class="text-center" style="color:var(--muted)">${escapeHtml(L('loading'))}</p>`;

  const { data: plans, error } = await supabase
    .from('plans')
    .select(`
      id, key, name, price_cents, billing_interval, plan_group,
      max_extensions, max_super_admins_per_tenant, max_members, max_admins, max_global_admins, storage_gb,
      plan_features ( features ( key, name ) )
    `)
    .order('price_cents');

  if (error || !plans) {
    grid.innerHTML = `<p class="text-center text-rose-600">${escapeHtml(L('failed'))}</p>`;
    return;
  }

  allPlans = plans;
  renderPricing();
}

const hasFeature = (plan, key) => (plan.plan_features || []).some((pf) => pf.features?.key === key);

// Yearly saving per plan group, from the real prices (12 x monthly vs yearly).
function savingPct(plan) {
  const monthly = allPlans.find((p) => p.plan_group === plan.plan_group && p.billing_interval === 'monthly');
  const yearly = allPlans.find((p) => p.plan_group === plan.plan_group && p.billing_interval === 'yearly');
  if (!monthly || !yearly || !monthly.price_cents) return 0;
  return Math.round((1 - yearly.price_cents / (monthly.price_cents * 12)) * 100);
}

function planBullets(plan) {
  const items = [];
  items.push({ on: true, text: plan.max_members === null ? L('membersUnlimited') : L('members', { n: plan.max_members.toLocaleString(getLang() === 'fr' ? 'fr-CA' : 'en-CA') }) });
  items.push({ on: true, text: plan.max_admins === null ? L('adminsUnlimited') : L('admins', { n: plan.max_admins }) });
  items.push({ on: true, text: !plan.max_extensions ? L('oneChurch') : L('extensions', { n: plan.max_extensions }) });
  items.push({ on: true, text: hasFeature(plan, 'create_departments') ? L('deptCreate') : hasFeature(plan, 'all_departments') ? L('deptAll') : L('deptCore') });
  if (plan.storage_gb) items.push({ on: true, text: L('storage', { n: plan.storage_gb }) });
  items.push({ on: hasFeature(plan, 'customize_departments'), text: L('customize') });
  items.push({ on: hasFeature(plan, 'projection'), text: L('projection') });
  items.push({ on: hasFeature(plan, 'flyers'), text: L('flyers') });
  items.push({ on: hasFeature(plan, 'member_card'), text: L('memberCard') });
  items.push({ on: hasFeature(plan, 'vpd_academy'), text: L('academy') });
  return items;
}

function renderPricing() {
  const yearlySaving = Math.max(0, ...allPlans.filter((p) => p.billing_interval === 'yearly').map(savingPct));
  pricingIntervalMonthlyBtn.innerHTML = escapeHtml(L('monthly'));
  pricingIntervalYearlyBtn.innerHTML = `${escapeHtml(L('yearly'))}${yearlySaving > 0 ? ` <span class="save-pill">${escapeHtml(L('saveUpTo', { pct: yearlySaving }))}</span>` : ''}`;
  pricingIntervalMonthlyBtn.classList.toggle('is-on', selectedPricingInterval === 'monthly');
  pricingIntervalYearlyBtn.classList.toggle('is-on', selectedPricingInterval === 'yearly');

  if (allPlans.length === 0) return;
  const grid = document.querySelector('[data-el="pricing-grid"]');
  const plans = allPlans.filter((p) => p.billing_interval === selectedPricingInterval);
  // The middle plan is highlighted (Pro today).
  const highlightIndex = plans.length >= 3 ? 1 : -1;

  grid.innerHTML = `<div class="grid md:grid-cols-${Math.min(plans.length, 3)} gap-5 items-stretch">${plans.map((plan, i) => {
    const hl = i === highlightIndex;
    const isYearly = plan.billing_interval === 'yearly';
    const price = plan.price_cents === 0
      ? escapeHtml(t('plans.free'))
      : escapeHtml(formatMoney(plan.price_cents / 100));
    const pct = isYearly ? savingPct(plan) : 0;
    return `
      <div class="plan ${hl ? 'plan--hl md:-my-3 md:py-10' : ''}">
        ${hl ? `<span class="absolute -top-3 left-1/2 -translate-x-1/2 text-[11px] font-bold uppercase tracking-wider px-3 py-1 rounded-full" style="background:var(--gold);color:var(--navy)">${escapeHtml(L('recommended'))}</span>` : ''}
        <p class="font-display text-[24px] font-bold" style="color:${hl ? '#fff' : 'var(--navy)'}">${escapeHtml(plan.name)}</p>
        <div class="mt-4 flex items-end gap-1">
          <span class="font-display text-[42px] leading-none font-bold">${price}</span>
          ${plan.price_cents ? `<span class="pb-1 text-sm ${hl ? 'text-white/70' : ''}" style="${hl ? '' : 'color:var(--muted)'}">${escapeHtml(isYearly ? L('perYearShort') : L('perMonthShort'))}</span>` : ''}
        </div>
        <p class="mt-2 text-[13px] min-h-[20px] ${hl ? 'text-white/70' : ''}" style="${hl ? '' : 'color:var(--muted)'}">
          ${isYearly && plan.price_cents ? escapeHtml(L('billedYearly', { amount: formatMonthlyEquivalent(plan.price_cents) })) : '&nbsp;'}
          ${pct > 0 ? ` <span class="save-pill">${escapeHtml(L('save', { pct }))}</span>` : ''}
        </p>
        <a href="${getStartedHref()}" class="btn ${hl ? 'btn-gold' : 'btn-outline'} w-full mt-5">${escapeHtml(L('choose'))}</a>
        <ul class="mt-6 space-y-3">
          ${planBullets(plan).map((b) => `<li class="${b.on ? '' : 'no'}"><span style="color:${b.on ? (hl ? 'var(--gold)' : '#1F8A4C') : 'currentColor'}">${b.on ? CHECK : DASH}</span><span>${escapeHtml(b.text)}</span></li>`).join('')}
        </ul>
      </div>`;
  }).join('')}</div>`;

  // Included in every plan (BASE_FEATURE_KEYS, the same list the in-app plans dialog uses).
  document.querySelector('[data-el="every-plan"]').innerHTML = `
    <div class="card p-6">
      <p class="kicker">${escapeHtml(L('everyPlan'))}</p>
      <ul class="mt-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-3">
        ${BASE_FEATURE_KEYS.map((k) => `<li class="flex gap-2.5 text-[14px]" style="color:var(--ink)"><span style="color:#1F8A4C">${CHECK}</span><span>${escapeHtml(t(k))}</span></li>`).join('')}
      </ul>
    </div>`;

  // Full comparison table, folded away under "Compare all plan details".
  const priceCellsHtml = plans.map((plan) => {
    const monthlyEquivalent = plan.billing_interval === 'yearly' && plan.price_cents > 0
      ? `<div class="text-[11px] font-normal text-slate-500">${t('plans.monthlyEquivalent', { amount: formatMonthlyEquivalent(plan.price_cents) })}</div>`
      : '';
    return `<div class="font-bold text-slate-900">${formatPlanPrice(plan.price_cents, plan.billing_interval)}</div>${monthlyEquivalent}`;
  });
  document.querySelector('[data-el="compare-table"]').innerHTML = renderComparisonTable({ plans, currentPlanId: null, priceCellsHtml, actionCellsHtml: null });
}

const TOPIC_KEYS = { demo: 'welcome.topicDemo', general: 'welcome.topicGeneral', support: 'welcome.topicSupport' };

// Saves to website_inquiries (sql/053), which every Site Admin sees.
// The visitor gets a thank-you in the page; the email app only opens if
// saving fails (as a way to still reach us).
function wireContactForm() {
  const form = document.querySelector('[data-el="contact-form"]');
  const submitBtn = form.querySelector('[data-el="submit-btn"]');
  const errorEl = form.querySelector('[data-el="form-error"]');
  const thanksEl = document.querySelector('[data-el="form-thanks"]');

  const showError = (html) => { errorEl.innerHTML = html; errorEl.classList.remove('hidden'); };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.classList.add('hidden');
    const topicValue = form.elements.topic.value || 'general';
    const name = form.elements.name.value.trim();
    const email = form.elements.email.value.trim();
    const phone = form.elements.phone.value.trim();
    const church = form.elements.church.value.trim();
    const message = form.elements.message.value.trim();

    if (!name) { form.elements.name.focus(); form.elements.name.reportValidity?.(); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { form.elements.email.focus(); form.elements.email.reportValidity?.(); return; }

    submitBtn.disabled = true;
    const label = submitBtn.textContent;
    submitBtn.textContent = L('formSending');

    const { error } = await supabase.from('website_inquiries').insert({
      topic: topicValue,
      name,
      email,
      phone: phone || '',
      church_name: church || null,
      message: message || null,
    });

    submitBtn.disabled = false;
    submitBtn.textContent = label;

    if (error) {
      const topic = t(TOPIC_KEYS[topicValue] || TOPIC_KEYS.general);
      const subject = `ChurchOnPoint — ${topic}${church ? ` — ${church}` : ''}`;
      const body = [`Name: ${name}`, `Email: ${email}`, phone ? `Phone: ${phone}` : null, church ? `Church: ${church}` : null, '', message]
        .filter((line) => line !== null).join('\n');
      const href = `mailto:info@aliviatech.ca?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      showError(`${escapeHtml(L('formError'))} <a class="underline font-semibold" href="${href}">${escapeHtml(L('formEmailUs'))}</a>`);
      return;
    }

    thanksEl.querySelector('[data-el="thanks-title"]').textContent = L('formThanksTitle', { name: name.split(' ')[0] });
    thanksEl.querySelector('[data-el="thanks-body"]').textContent = L('formThanksBody', { email });
    form.classList.add('hidden');
    thanksEl.classList.remove('hidden');
    form.reset();
  });

  thanksEl.querySelector('[data-action="form-again"]').addEventListener('click', () => {
    thanksEl.classList.add('hidden');
    form.classList.remove('hidden');
    form.elements.name.focus();
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
