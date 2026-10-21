// Site Admin — a full page (not a popup, per Site Admin feedback),
// reached only via the tools-menu "Site Admin" entry, same pattern as
// js/pastorMeetingsPage.js's own modal-to-page conversion. Six tabs:
// Website Inquiries (anonymous, pre-signup leads from the marketing
// page's contact form, sql/053), App Suggestions and Support Requests
// submitted by anyone on any church on the platform (via the
// list_*_for_site_admin() RPCs, which bypass each row's own
// tenant_isolation the same way every other cross-tenant lookup in
// this app already does), Churches (every tenant, basic usage,
// storage, soft-delete/restore -- sql/060/062), Training Sandbox
// (sql/064 -- see below), and a simple add/remove-by-email console
// for who else holds the role.
//
// Suggestions/Requests/Manage also pull in Main (the separate single-
// tenant app at app.eglisevpd.com, sql/main_53_site_admin.sql) via a
// second Supabase client -- one dashboard, two data sources, each row
// tagged by which system it came from. Main has no public contact
// page yet, so Inquiries and Churches are SAAS-only.
//
// Replies (sql/061): a Site Admin's status/admin_note edit is
// internal-only; `site_admin_reply` is the distinct, submitter-facing
// field -- delivered to the submitter via the notifications bell for
// suggestions/requests (any signed-in member), or by email for
// anonymous website_inquiries (site-admin-usage Edge Function's
// reply_to_inquiry action, since there's no account to notify).
//
// Training Sandbox (sql/064): a single shared "Site Admin Training"
// tenant (fixed slug, seeded with the same 15 default departments
// every real church gets) that any Site Admin can enter with REAL
// write access -- deliberately NOT the read-only View-As proxy
// (js/departments.js's startViewAs/getEffectiveSupabase, which blocks
// every mutating call at the network layer; that's the right tool for
// "preview what a member sees", the wrong one for "practice actually
// doing things"). Entering/exiting reuses profiles.acting_as_tenant_id
// (the same column the denomination/Church-Extensions feature added) --
// a full page reload re-derives the whole app from whatever
// current_tenant_id() now resolves to, exactly like switching
// extensions -- so once inside, the entire app (sidebar, department
// list, everything) just IS the training tenant, no special-casing
// needed anywhere else. The existing "Acting as {name}" banner
// (js/app.js, built for extension-switching) fires automatically too,
// since it's driven by the same acting_as_tenant_id column.
// Per-department Admin/Member is a REAL department_memberships row
// (set_training_department_role()), toggled by deleting and
// re-inserting -- every existing RLS check just works unmodified.
// Everything in the training tenant is wiped clean every 48 hours by
// a cron job (purge_training_sandbox()) -- nothing there is ever
// meant to persist.
import { t } from './i18n.js';
import { confirmDialog } from './components/confirmDialog.js';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { getEffectiveSupabase } from './departments.js';
import { getTenant } from './tenant.js';
import { extractFunctionErrorMessage } from './utils/edgeFunctionError.js';
import { getIsPlatformOwner } from './platformOwner.js';
import { renderOwnerTab } from './ownerPage.js';

const SUGGESTION_STATUSES = ['new', 'planned', 'done', 'declined'];
const REQUEST_STATUSES = ['new', 'answered', 'closed'];
const INQUIRY_STATUSES = ['new', 'contacted', 'closed'];
const INQUIRY_TOPIC_KEYS = { demo: 'welcome.topicDemo', general: 'welcome.topicGeneral', support: 'welcome.topicSupport' };
const TRAINING_TENANT_SLUG = 'site-admin-training';

const MAIN_URL = 'https://ezrwmplohjvttwosqvrn.supabase.co';
const MAIN_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV6cndtcGxvaGp2dHR3b3NxdnJuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4MzkxMjksImV4cCI6MjEwMjQxNTEyOX0.YzGP5gfb0GhGNGRylK4g_lBH4-mERiOmClqCQ_UrO_M';

let mainClient = null;
function getMainClient() {
  if (!mainClient) mainClient = createClient(MAIN_URL, MAIN_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  return mainClient;
}

// Usage Dashboard charts only -- loaded on first use, not at module
// load, same lazy pattern as pdfjs-dist/JSZip in projectionControl.js.
// Module-level (not per-tab-visit) so switching away from Site Admin
// and back doesn't re-fetch it. `/auto` auto-registers every
// controller/element this file uses (line, bar) in one import.
let chartJsPromise = null;
function loadChartJs() {
  if (!chartJsPromise) chartJsPromise = import('https://cdn.jsdelivr.net/npm/chart.js@4/auto/+esm').then((m) => m.default);
  return chartJsPromise;
}

function centsOrBytesToSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export async function renderSiteAdminTab() {
  const supabase = getEffectiveSupabase();
  const container = document.querySelector('#site-admin-content');
  container.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    container.innerHTML = `<p class="text-slate-500">${t('scheduling.pleaseSignIn')}</p>`;
    return;
  }
  const currentUserId = user.id;

  container.innerHTML = `
    <div data-el="main-connect" class="flex items-center gap-2 mb-4 text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2"></div>

    <div class="flex gap-2 mb-4 border-b border-slate-200 flex-wrap">
      <button type="button" data-tab="inquiries" class="px-3 py-2 text-sm font-medium border-b-2 border-indigo-600 text-indigo-600">${t('siteAdmin.tabInquiries')}</button>
      <button type="button" data-tab="suggestions" class="px-3 py-2 text-sm font-medium border-b-2 border-transparent text-slate-500 hover:text-slate-700">${t('siteAdmin.tabSuggestions')}</button>
      <button type="button" data-tab="requests" class="px-3 py-2 text-sm font-medium border-b-2 border-transparent text-slate-500 hover:text-slate-700">${t('siteAdmin.tabRequests')}</button>
      <button type="button" data-tab="churches" class="px-3 py-2 text-sm font-medium border-b-2 border-transparent text-slate-500 hover:text-slate-700">${t('siteAdmin.tabChurches')}</button>
      <button type="button" data-tab="promo-codes" class="px-3 py-2 text-sm font-medium border-b-2 border-transparent text-slate-500 hover:text-slate-700">${t('siteAdmin.tabPromoCodes')}</button>
      <button type="button" data-tab="usage" class="px-3 py-2 text-sm font-medium border-b-2 border-transparent text-slate-500 hover:text-slate-700">${t('siteAdmin.tabUsage')}</button>
      <button type="button" data-tab="sandbox" class="px-3 py-2 text-sm font-medium border-b-2 border-transparent text-slate-500 hover:text-slate-700">${t('siteAdmin.tabSandbox')}</button>
      <button type="button" data-tab="manage" class="px-3 py-2 text-sm font-medium border-b-2 border-transparent text-slate-500 hover:text-slate-700">${t('siteAdmin.tabManage')}</button>
      ${getIsPlatformOwner() ? `<button type="button" data-tab="owner" class="px-3 py-2 text-sm font-medium border-b-2 border-transparent text-slate-500 hover:text-slate-700">${t('owner.title')}</button>` : ''}
    </div>

    <div data-panel="inquiries"></div>
    <div data-panel="suggestions" class="hidden"></div>
    <div data-panel="requests" class="hidden"></div>
    <div data-panel="churches" class="hidden"></div>
    <div data-panel="promo-codes" class="hidden"></div>
    <div data-panel="usage" class="hidden"></div>
    <div data-panel="sandbox" class="hidden"></div>
    <div data-panel="manage" class="hidden"></div>
    ${getIsPlatformOwner() ? `<div data-panel="owner" class="hidden"></div>` : ''}
  `;

  const mainConnectEl = container.querySelector('[data-el="main-connect"]');
  const tabBtns = container.querySelectorAll('[data-tab]');
  const panels = {
    inquiries: container.querySelector('[data-panel="inquiries"]'),
    suggestions: container.querySelector('[data-panel="suggestions"]'),
    requests: container.querySelector('[data-panel="requests"]'),
    churches: container.querySelector('[data-panel="churches"]'),
    'promo-codes': container.querySelector('[data-panel="promo-codes"]'),
    usage: container.querySelector('[data-panel="usage"]'),
    sandbox: container.querySelector('[data-panel="sandbox"]'),
    manage: container.querySelector('[data-panel="manage"]'),
    ...(getIsPlatformOwner() ? { owner: container.querySelector('[data-panel="owner"]') } : {}),
  };
  const loaded = { inquiries: false, suggestions: false, requests: false, churches: false, 'promo-codes': false, usage: false, sandbox: false, manage: false, owner: false };

  tabBtns.forEach((btn) => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

  function switchTab(tab) {
    tabBtns.forEach((btn) => {
      const active = btn.dataset.tab === tab;
      btn.classList.toggle('border-indigo-600', active);
      btn.classList.toggle('text-indigo-600', active);
      btn.classList.toggle('border-transparent', !active);
      btn.classList.toggle('text-slate-500', !active);
    });
    Object.entries(panels).forEach(([key, el]) => el.classList.toggle('hidden', key !== tab));
    if (tab === 'inquiries' && !loaded.inquiries) loadInquiries();
    if (tab === 'suggestions' && !loaded.suggestions) loadSuggestions();
    if (tab === 'requests' && !loaded.requests) loadRequests();
    if (tab === 'churches' && !loaded.churches) loadChurches();
    if (tab === 'promo-codes' && !loaded['promo-codes']) loadPromoCodes();
    if (tab === 'usage' && !loaded.usage) loadUsageDashboard();
    if (tab === 'sandbox' && !loaded.sandbox) loadSandbox();
    if (tab === 'manage' && !loaded.manage) loadManage();
    if (tab === 'owner' && !loaded.owner && panels.owner) { renderOwnerTab(panels.owner); loaded.owner = true; }
  }

  // ---- Main connection (one login, two data sources) ----
  async function renderMainConnect() {
    const client = getMainClient();
    const { data: { session } } = await client.auth.getSession();
    if (session) {
      mainConnectEl.innerHTML = `
        <span class="text-emerald-600">●</span>
        <span>${t('siteAdmin.mainConnected')}</span>
        <button type="button" data-action="main-disconnect" class="ml-auto text-indigo-600 hover:text-indigo-700 font-medium">${t('siteAdmin.mainDisconnect')}</button>
      `;
      mainConnectEl.querySelector('[data-action="main-disconnect"]').addEventListener('click', async () => {
        await client.auth.signOut();
        renderMainConnect();
      });
    } else {
      mainConnectEl.innerHTML = `
        <span class="text-slate-400">●</span>
        <span>${t('siteAdmin.mainNotConnected')}</span>
        <input type="email" data-el="main-email" placeholder="${t('siteAdmin.mainEmailPlaceholder')}" class="ml-auto border border-slate-300 rounded px-2 py-1 text-sm w-40" />
        <input type="password" data-el="main-password" placeholder="${t('siteAdmin.mainPasswordPlaceholder')}" class="border border-slate-300 rounded px-2 py-1 text-sm w-32" />
        <button type="button" data-action="main-connect" class="text-indigo-600 hover:text-indigo-700 font-medium">${t('siteAdmin.mainConnect')}</button>
        <span data-el="main-connect-status" class="text-rose-600"></span>
      `;
      mainConnectEl.querySelector('[data-action="main-connect"]').addEventListener('click', async () => {
        const email = mainConnectEl.querySelector('[data-el="main-email"]').value.trim();
        const password = mainConnectEl.querySelector('[data-el="main-password"]').value;
        const statusEl = mainConnectEl.querySelector('[data-el="main-connect-status"]');
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) { statusEl.textContent = error.message; return; }
        await renderMainConnect();
        loaded.suggestions = false; loaded.requests = false; loaded.manage = false;
        Object.keys(panels).forEach((tab) => { if (!panels[tab].classList.contains('hidden')) switchTab(tab); });
      });
    }
  }

  // ---- Website Inquiries (SAAS only) ----
  async function loadInquiries() {
    panels.inquiries.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;
    const { data, error } = await supabase.rpc('list_website_inquiries_for_site_admin');
    if (error) {
      panels.inquiries.innerHTML = `<p class="text-rose-600">${t('siteAdmin.loadFailed', { message: error.message })}</p>`;
      return;
    }
    loaded.inquiries = true;
    if (!data.length) {
      panels.inquiries.innerHTML = `<p class="text-slate-400">${t('siteAdmin.noInquiries')}</p>`;
      return;
    }
    panels.inquiries.innerHTML = `<div class="space-y-3">${data.map((row) => buildInquiryCard(row)).join('')}</div>`;
    wireInquiryCards();
  }

  function buildInquiryCard(row) {
    const topicLabel = t(INQUIRY_TOPIC_KEYS[row.topic] || '') || row.topic;
    const topicBadge = `<span class="inline-block text-[11px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 mr-2">${escapeHtml(topicLabel)}</span>`;
    const contactBits = [row.email, row.phone, row.church_name].filter(Boolean).map(escapeHtml).join(' · ');
    return `
      <div class="border border-slate-200 rounded-lg p-4" data-row-id="${row.id}">
        <div class="flex items-start justify-between gap-2 mb-2">
          <div class="text-xs text-slate-500">
            ${topicBadge}<span class="font-medium text-slate-700">${escapeHtml(row.name)}</span>
            ${contactBits ? ` · ${contactBits}` : ''}
            · ${new Date(row.created_at).toLocaleDateString()}
          </div>
        </div>
        ${row.message ? `<p class="text-sm text-slate-800 mb-3 whitespace-pre-wrap">${escapeHtml(row.message)}</p>` : ''}
        <div class="grid sm:grid-cols-[auto_1fr] gap-2 items-start mb-2">
          <select data-el="status" class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
            ${INQUIRY_STATUSES.map((s) => `<option value="${s}" ${s === row.status ? 'selected' : ''}>${escapeHtml(t(`siteAdmin.status.${s}`))}</option>`).join('')}
          </select>
          <textarea data-el="admin-note" rows="1" placeholder="${escapeHtml(t('siteAdmin.adminNotePlaceholder'))}"
                    class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">${escapeHtml(row.admin_note || '')}</textarea>
        </div>
        <div class="flex items-center gap-2 mb-2">
          <button type="button" data-action="save" class="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">${t('siteAdmin.save')}</button>
          <span data-el="row-status" class="text-xs text-slate-500"></span>
        </div>
        ${buildReplyBlock(row)}
      </div>
    `;
  }

  function buildReplyBlock(row) {
    return `
      <div class="border-t border-slate-100 pt-2 mt-1">
        ${row.site_admin_reply ? `<p class="text-xs text-slate-500 mb-1">${t('siteAdmin.alreadyReplied', { date: new Date(row.replied_at).toLocaleDateString() })}</p>` : ''}
        <textarea data-el="reply" rows="2" placeholder="${escapeHtml(t('siteAdmin.replyPlaceholder'))}"
                  class="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm mb-1">${escapeHtml(row.site_admin_reply || '')}</textarea>
        <div class="flex items-center gap-2">
          <button type="button" data-action="reply" class="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700">${t('siteAdmin.sendReply')}</button>
          <span data-el="reply-status" class="text-xs text-slate-500"></span>
        </div>
      </div>
    `;
  }

  function wireInquiryCards() {
    panels.inquiries.querySelectorAll('[data-row-id]').forEach((card) => {
      const id = card.dataset.rowId;
      card.querySelector('[data-action="save"]').addEventListener('click', async () => {
        const statusEl = card.querySelector('[data-el="row-status"]');
        const status = card.querySelector('[data-el="status"]').value;
        const admin_note = card.querySelector('[data-el="admin-note"]').value.trim() || null;
        statusEl.className = 'text-xs text-slate-500';
        statusEl.textContent = t('common.saving');
        const { error } = await supabase.from('website_inquiries').update({ status, admin_note, updated_at: new Date().toISOString() }).eq('id', id);
        statusEl.className = error ? 'text-xs text-rose-600' : 'text-xs text-emerald-600';
        statusEl.textContent = error ? t('siteAdmin.saveFailed', { message: error.message }) : t('siteAdmin.saved');
      });
      card.querySelector('[data-action="reply"]').addEventListener('click', async () => {
        const replyStatusEl = card.querySelector('[data-el="reply-status"]');
        const reply = card.querySelector('[data-el="reply"]').value.trim();
        if (!reply) return;
        replyStatusEl.className = 'text-xs text-slate-500';
        replyStatusEl.textContent = t('common.saving');
        const { data, error } = await supabase.functions.invoke('site-admin-usage', {
          body: { action: 'reply_to_inquiry', inquiry_id: id, reply },
        });
        if (error || data?.error) {
          replyStatusEl.className = 'text-xs text-rose-600';
          replyStatusEl.textContent = t('siteAdmin.replyFailed', { message: data?.error || await extractFunctionErrorMessage(error) });
          return;
        }
        replyStatusEl.className = 'text-xs text-emerald-600';
        replyStatusEl.textContent = t('siteAdmin.replySent');
        loaded.inquiries = false;
        loadInquiries();
      });
    });
  }

  // ---- Suggestions / Requests (merged SAAS + Main) ----
  async function fetchFromBothSystems(rpcName) {
    const saasPromise = supabase.rpc(rpcName).then(({ data, error }) => ({
      data: (data || []).map((row) => ({ ...row, _system: 'SAAS', _client: supabase })), error,
    }));
    const promises = [saasPromise];

    const mc = getMainClient();
    const { data: { session } } = await mc.auth.getSession();
    if (session) {
      promises.push(mc.rpc(rpcName).then(({ data, error }) => ({
        data: (data || []).map((row) => ({ ...row, _system: 'Main', _client: mc })), error,
      })));
    }

    const results = await Promise.all(promises);
    const firstError = results.find((r) => r.error)?.error;
    const rows = results.flatMap((r) => r.data || []);
    rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return { rows, error: firstError };
  }

  async function loadSuggestions() {
    panels.suggestions.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;
    const { rows, error } = await fetchFromBothSystems('list_app_suggestions_for_site_admin');
    if (error) {
      panels.suggestions.innerHTML = `<p class="text-rose-600">${t('siteAdmin.loadFailed', { message: error.message })}</p>`;
      return;
    }
    loaded.suggestions = true;
    if (!rows.length) {
      panels.suggestions.innerHTML = `<p class="text-slate-400">${t('siteAdmin.noSuggestions')}</p>`;
      return;
    }
    panels.suggestions.innerHTML = `<div class="space-y-3">${rows.map((row) => buildCard(row, SUGGESTION_STATUSES, 'suggestion')).join('')}</div>`;
    wireCards(panels.suggestions, 'app_suggestions', loadSuggestions);
  }

  async function loadRequests() {
    panels.requests.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;
    const { rows, error } = await fetchFromBothSystems('list_support_requests_for_site_admin');
    if (error) {
      panels.requests.innerHTML = `<p class="text-rose-600">${t('siteAdmin.loadFailed', { message: error.message })}</p>`;
      return;
    }
    loaded.requests = true;
    if (!rows.length) {
      panels.requests.innerHTML = `<p class="text-slate-400">${t('siteAdmin.noRequests')}</p>`;
      return;
    }
    panels.requests.innerHTML = `<div class="space-y-3">${rows.map((row) => buildCard(row, REQUEST_STATUSES, 'request')).join('')}</div>`;
    wireCards(panels.requests, 'support_requests', loadRequests);
  }

  function buildCard(row, statuses, kind) {
    const topicBadge = kind === 'request'
      ? `<span class="inline-block text-[11px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 mr-2">${escapeHtml(t(`supportRequest.topic.${row.topic}`))}</span>`
      : '';
    const systemBadge = `<span class="inline-block text-[11px] font-semibold px-1.5 py-0.5 rounded ${row._system === 'Main' ? 'bg-amber-100 text-amber-700' : 'bg-indigo-100 text-indigo-700'} mr-2">${row._system}</span>`;
    return `
      <div class="border border-slate-200 rounded-lg p-4" data-row-id="${row.id}" data-system="${row._system}">
        <div class="flex items-start justify-between gap-2 mb-2">
          <div class="text-xs text-slate-500">
            ${systemBadge}${topicBadge}<span class="font-medium text-slate-700">${escapeHtml(row.full_name || '—')}</span>
            ${row.tenant_name ? ` · ${escapeHtml(row.tenant_name)}` : ''}
            · ${new Date(row.created_at).toLocaleDateString()}
          </div>
        </div>
        <p class="text-sm text-slate-800 mb-3 whitespace-pre-wrap">${escapeHtml(row.message)}</p>
        <div class="grid sm:grid-cols-[auto_1fr] gap-2 items-start mb-2">
          <select data-el="status" class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
            ${statuses.map((s) => `<option value="${s}" ${s === row.status ? 'selected' : ''}>${escapeHtml(t(`siteAdmin.status.${s}`))}</option>`).join('')}
          </select>
          <textarea data-el="admin-note" rows="1" placeholder="${escapeHtml(t('siteAdmin.adminNotePlaceholder'))}"
                    class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">${escapeHtml(row.admin_note || '')}</textarea>
        </div>
        <div class="flex items-center gap-2 mb-2">
          <button type="button" data-action="save" class="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">${t('siteAdmin.save')}</button>
          <span data-el="row-status" class="text-xs text-slate-500"></span>
        </div>
        ${buildReplyBlock(row)}
      </div>
    `;
  }

  function wireCards(panelEl, table, reload) {
    panelEl.querySelectorAll('[data-row-id]').forEach((card) => {
      const id = card.dataset.rowId;
      const client = card.dataset.system === 'Main' ? getMainClient() : supabase;
      card.querySelector('[data-action="save"]').addEventListener('click', async () => {
        const statusEl = card.querySelector('[data-el="row-status"]');
        const status = card.querySelector('[data-el="status"]').value;
        const admin_note = card.querySelector('[data-el="admin-note"]').value.trim() || null;
        statusEl.className = 'text-xs text-slate-500';
        statusEl.textContent = t('common.saving');
        const { error } = await client.from(table).update({ status, admin_note, updated_at: new Date().toISOString() }).eq('id', id);
        statusEl.className = error ? 'text-xs text-rose-600' : 'text-xs text-emerald-600';
        statusEl.textContent = error ? t('siteAdmin.saveFailed', { message: error.message }) : t('siteAdmin.saved');
      });
      card.querySelector('[data-action="reply"]').addEventListener('click', async () => {
        const replyStatusEl = card.querySelector('[data-el="reply-status"]');
        const reply = card.querySelector('[data-el="reply"]').value.trim();
        if (!reply) return;
        replyStatusEl.className = 'text-xs text-slate-500';
        replyStatusEl.textContent = t('common.saving');
        const { error } = await client.from(table).update({ site_admin_reply: reply, replied_at: new Date().toISOString() }).eq('id', id);
        if (error) {
          replyStatusEl.className = 'text-xs text-rose-600';
          replyStatusEl.textContent = t('siteAdmin.replyFailed', { message: error.message });
          return;
        }
        replyStatusEl.className = 'text-xs text-emerald-600';
        replyStatusEl.textContent = t('siteAdmin.replySent');
        reload();
      });
    });
  }

  // ---- Churches (SAAS only) ----
  async function loadChurches() {
    panels.churches.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;
    const [{ data: tenants, error }, usageResp, { data: redemptions }] = await Promise.all([
      supabase.rpc('list_all_tenants_for_site_admin'),
      supabase.functions.invoke('site-admin-usage').catch(() => ({ data: null, error: null })),
      // RLS-readable directly (Site Admin), no edge function needed --
      // ordered newest-first so the Map below keeps each tenant's MOST
      // RECENT redemption when a church has used more than one code.
      supabase.from('promo_code_redemptions')
        .select('tenant_id, discount_percent, duration, duration_in_months, redeemed_at, promo_codes ( code )')
        .order('redeemed_at', { ascending: false }),
    ]);
    if (error) {
      panels.churches.innerHTML = `<p class="text-rose-600">${t('siteAdmin.loadFailed', { message: error.message })}</p>`;
      return;
    }
    loaded.churches = true;
    const r2ByTenant = usageResp?.data?.byTenant || {};
    const promoByTenant = new Map();
    (redemptions || []).forEach((r) => { if (!promoByTenant.has(r.tenant_id)) promoByTenant.set(r.tenant_id, r); });

    panels.churches.innerHTML = `
      <div class="overflow-x-auto border border-slate-200 rounded-lg mb-2">
        <table class="w-full text-sm">
          <thead class="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th class="text-left px-3 py-2">${t('siteAdmin.colChurch')}</th>
              <th class="text-left px-3 py-2">${t('siteAdmin.colStatus')}</th>
              <th class="text-right px-3 py-2">${t('siteAdmin.colMembers')}</th>
              <th class="text-right px-3 py-2">${t('siteAdmin.colStorage')}</th>
              <th class="text-left px-3 py-2">${t('siteAdmin.colLastActive')}</th>
              <th class="text-left px-3 py-2">${t('siteAdmin.promoColCode')}</th>
              <th class="text-left px-3 py-2"></th>
            </tr>
          </thead>
          <tbody data-el="rows"></tbody>
        </table>
      </div>
      <p class="text-xs text-slate-500">${t('siteAdmin.churchesCount', { count: (tenants || []).filter((t2) => !t2.deleted_at).length })}</p>
    `;
    const rowsEl = panels.churches.querySelector('[data-el="rows"]');
    rowsEl.innerHTML = (tenants || []).map((row) => {
      const totalBytes = Number(row.storage_bytes || 0) + Number(r2ByTenant[row.id] || 0);
      const isDeleted = !!row.deleted_at;
      const promo = promoByTenant.get(row.id);
      const promoCell = promo
        ? `<span class="font-mono font-medium">${escapeHtml(promo.promo_codes?.code || '—')}</span> <span class="text-slate-400">(${promo.discount_percent}% · ${promoDurationLabel(promo.duration, promo.duration_in_months)})</span>`
        : '<span class="text-slate-300">—</span>';
      return `
        <tr class="border-b border-slate-100 ${isDeleted ? 'bg-rose-50 opacity-70' : ''}" data-row-id="${row.id}">
          <td class="px-3 py-2 font-medium text-slate-800">${escapeHtml(row.name)}${isDeleted ? ` <span class="text-xs text-rose-600">(${t('siteAdmin.deleted')})</span>` : ''}</td>
          <td class="px-3 py-2">${escapeHtml(row.status)}</td>
          <td class="px-3 py-2 text-right">${row.member_count} / ${row.department_count}</td>
          <td class="px-3 py-2 text-right whitespace-nowrap">${centsOrBytesToSize(totalBytes)}</td>
          <td class="px-3 py-2 text-slate-500">${row.last_active_at ? new Date(row.last_active_at).toLocaleDateString() : '—'}</td>
          <td class="px-3 py-2 whitespace-nowrap">${promoCell}</td>
          <td class="px-3 py-2 text-right">
            ${isDeleted
              ? `<button type="button" data-action="restore" class="text-xs text-indigo-600 hover:text-indigo-700 font-medium">${t('siteAdmin.restore')}</button>`
              : `<button type="button" data-action="delete" class="text-xs text-rose-600 hover:text-rose-700">${t('siteAdmin.delete')}</button>`}
          </td>
        </tr>
      `;
    }).join('');

    rowsEl.querySelectorAll('[data-action="delete"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('[data-row-id]');
        const id = row.dataset.rowId;
        const name = row.querySelector('td').textContent;
        const ok = await confirmDialog({ message: t('siteAdmin.deleteChurchConfirm', { name }), danger: true });
        if (!ok) return;
        await supabase.rpc('soft_delete_tenant', { p_tenant_id: id });
        loaded.churches = false;
        loadChurches();
      });
    });
    rowsEl.querySelectorAll('[data-action="restore"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.closest('[data-row-id]').dataset.rowId;
        await supabase.rpc('restore_tenant', { p_tenant_id: id });
        loaded.churches = false;
        loadChurches();
      });
    });
  }

  // ---- Promo Codes (SAAS only -- billing is SAAS-only, see
  // supabase/functions/stripe-billing/index.ts's create_promo_code/
  // list_promo_codes/update_promo_code_status actions, Site-Admin-gated
  // there too). Real discount/duration/limits/expiry are native Stripe
  // Coupon + Promotion Code fields -- this page is a thin admin UI over
  // those, plus the tracking view sourced from the local redemptions
  // mirror table. ----
  let planGroupOptions = null; // [{ group, name }], loaded once per page visit

  async function loadPlanGroupOptions() {
    if (planGroupOptions) return planGroupOptions;
    const { data } = await supabase.from('plans').select('plan_group, name').eq('billing_interval', 'monthly').order('price_cents');
    planGroupOptions = (data || []).map((p) => ({ group: p.plan_group, name: p.name }));
    return planGroupOptions;
  }

  function formatCents(cents) {
    return `$${(Number(cents || 0) / 100).toFixed(2)}`;
  }

  function promoDurationLabel(duration, durationInMonths) {
    if (duration === 'once') return t('siteAdmin.promoDurationOnce');
    if (duration === 'forever') return t('siteAdmin.promoDurationForever');
    return t('siteAdmin.promoDurationMonths', { count: durationInMonths });
  }

  async function loadPromoCodes() {
    panels['promo-codes'].innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;
    const { data, error } = await supabase.functions.invoke('stripe-billing', { body: { action: 'list_promo_codes' } });
    if (error || data?.error) {
      panels['promo-codes'].innerHTML = `<p class="text-rose-600">${t('siteAdmin.loadFailed', { message: data?.error || await extractFunctionErrorMessage(error) })}</p>`;
      return;
    }
    loaded['promo-codes'] = true;
    const codes = data.promoCodes || [];
    const planGroups = await loadPlanGroupOptions();
    const groupName = (g) => planGroups.find((p) => p.group === g)?.name || g;

    panels['promo-codes'].innerHTML = `
      <div class="flex items-center justify-between mb-3">
        <button type="button" data-action="new-promo-code" class="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">${t('siteAdmin.createPromoCode')}</button>
      </div>
      <div data-el="promo-form"></div>
      <div class="overflow-x-auto border border-slate-200 rounded-lg">
        <table class="w-full text-sm">
          <thead class="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th class="text-left px-3 py-2">${t('siteAdmin.promoColCode')}</th>
              <th class="text-left px-3 py-2">${t('siteAdmin.promoColDiscount')}</th>
              <th class="text-left px-3 py-2">${t('siteAdmin.promoColPlans')}</th>
              <th class="text-left px-3 py-2">${t('siteAdmin.promoColDuration')}</th>
              <th class="text-left px-3 py-2">${t('siteAdmin.promoColStatus')}</th>
              <th class="text-right px-3 py-2">${t('siteAdmin.promoColUses')}</th>
              <th class="text-right px-3 py-2">${t('siteAdmin.promoColTotalDiscount')}</th>
              <th class="text-left px-3 py-2"></th>
            </tr>
          </thead>
          <tbody data-el="rows"></tbody>
        </table>
      </div>
      ${codes.length === 0 ? `<p class="text-slate-400 mt-3">${t('siteAdmin.noPromoCodes')}</p>` : ''}
      <div data-el="redemptions-detail" class="mt-4"></div>
    `;

    const rowsEl = panels['promo-codes'].querySelector('[data-el="rows"]');
    rowsEl.innerHTML = codes.map((c) => {
      const durationLabel = promoDurationLabel(c.duration, c.duration_in_months);
      const plansLabel = c.applies_to_plan_groups ? c.applies_to_plan_groups.map(groupName).join(', ') : t('siteAdmin.promoAllPlans');
      const usesLabel = c.usage_limit != null ? `${c.redemptionCount} / ${c.usage_limit}` : `${c.redemptionCount}`;
      return `
        <tr class="border-b border-slate-100" data-promo-id="${c.id}">
          <td class="px-3 py-2 font-mono font-medium text-slate-800">${escapeHtml(c.code)}</td>
          <td class="px-3 py-2">${c.discount_percent}%</td>
          <td class="px-3 py-2 text-slate-600">${escapeHtml(plansLabel)}</td>
          <td class="px-3 py-2 text-slate-600">${durationLabel}</td>
          <td class="px-3 py-2">
            <span class="text-xs font-semibold px-1.5 py-0.5 rounded ${c.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}">${t(`siteAdmin.promoStatus.${c.status}`)}</span>
          </td>
          <td class="px-3 py-2 text-right">${usesLabel}</td>
          <td class="px-3 py-2 text-right">${formatCents(c.totalDiscountCents)}</td>
          <td class="px-3 py-2 text-right whitespace-nowrap">
            <button type="button" data-action="view-redemptions" class="text-xs text-indigo-600 hover:text-indigo-700 font-medium mr-2">${t('siteAdmin.promoViewUses')}</button>
            <button type="button" data-action="toggle-status" class="text-xs ${c.status === 'active' ? 'text-amber-600 hover:text-amber-700' : 'text-emerald-600 hover:text-emerald-700'} font-medium">${c.status === 'active' ? t('siteAdmin.promoPause') : t('siteAdmin.promoResume')}</button>
          </td>
        </tr>
      `;
    }).join('');

    rowsEl.querySelectorAll('[data-action="toggle-status"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('[data-promo-id]');
        const id = row.dataset.promoId;
        const codeRow = codes.find((c) => c.id === id);
        const newStatus = codeRow.status === 'active' ? 'paused' : 'active';
        btn.disabled = true;
        const { data: res, error: err } = await supabase.functions.invoke('stripe-billing', { body: { action: 'update_promo_code_status', promo_code_id: id, status: newStatus } });
        if (err || res?.error) { window.alert(res?.error || await extractFunctionErrorMessage(err)); btn.disabled = false; return; }
        loaded['promo-codes'] = false;
        loadPromoCodes();
      });
    });

    const detailEl = panels['promo-codes'].querySelector('[data-el="redemptions-detail"]');
    rowsEl.querySelectorAll('[data-action="view-redemptions"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.closest('[data-promo-id]').dataset.promoId;
        detailEl.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;
        const { data: res, error: err } = await supabase.functions.invoke('stripe-billing', { body: { action: 'list_promo_code_redemptions', promo_code_id: id } });
        if (err || res?.error) { detailEl.innerHTML = `<p class="text-rose-600">${res?.error || await extractFunctionErrorMessage(err)}</p>`; return; }
        const rows = res.redemptions || [];
        detailEl.innerHTML = rows.length === 0
          ? `<p class="text-slate-400">${t('siteAdmin.promoNoRedemptions')}</p>`
          : `
            <div class="border border-slate-200 rounded-lg overflow-x-auto">
              <table class="w-full text-sm">
                <thead class="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                  <tr>
                    <th class="text-left px-3 py-2">${t('siteAdmin.promoColChurch')}</th>
                    <th class="text-left px-3 py-2">${t('siteAdmin.promoColDate')}</th>
                    <th class="text-right px-3 py-2">${t('siteAdmin.promoColDiscount')}</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows.map((r) => `
                    <tr class="border-b border-slate-100">
                      <td class="px-3 py-2">${escapeHtml(r.tenants?.name || '—')}</td>
                      <td class="px-3 py-2 text-slate-500">${new Date(r.redeemed_at).toLocaleDateString()}</td>
                      <td class="px-3 py-2 text-right">${formatCents(r.original_price_cents - r.discounted_price_cents)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `;
      });
    });

    panels['promo-codes'].querySelector('[data-action="new-promo-code"]').addEventListener('click', () => renderPromoCodeForm(planGroups));
  }

  function renderPromoCodeForm(planGroups) {
    const formEl = panels['promo-codes'].querySelector('[data-el="promo-form"]');
    formEl.innerHTML = `
      <div class="border border-slate-200 rounded-lg p-4 mb-4 bg-slate-50">
        <div class="grid sm:grid-cols-2 gap-3 mb-3">
          <div>
            <label class="block text-xs font-medium text-slate-600 mb-1">${t('siteAdmin.promoFormCode')}</label>
            <input type="text" data-el="code" placeholder="WELCOME10" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm uppercase" />
          </div>
          <div>
            <label class="block text-xs font-medium text-slate-600 mb-1">${t('siteAdmin.promoFormDiscount')}</label>
            <input type="number" data-el="discount" min="1" max="100" value="10" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>
        <div class="mb-3">
          <label class="block text-xs font-medium text-slate-600 mb-1">${t('siteAdmin.promoFormPlans')}</label>
          <div class="flex flex-wrap gap-3">
            ${planGroups.map((p) => `
              <label class="flex items-center gap-1.5 text-sm">
                <input type="checkbox" data-plan-group="${escapeAttr(p.group)}" /> ${escapeHtml(p.name)}
              </label>
            `).join('')}
          </div>
          <p class="text-xs text-slate-400 mt-1">${t('siteAdmin.promoFormPlansHint')}</p>
        </div>
        <div class="grid sm:grid-cols-3 gap-3 mb-3">
          <div>
            <label class="block text-xs font-medium text-slate-600 mb-1">${t('siteAdmin.promoFormDuration')}</label>
            <select data-el="duration" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
              <option value="once">${t('siteAdmin.promoDurationOnce')}</option>
              <option value="repeating">${t('siteAdmin.promoFormDurationMonthsOption')}</option>
              <option value="forever">${t('siteAdmin.promoDurationForever')}</option>
            </select>
          </div>
          <div data-el="duration-months-wrap" class="hidden">
            <label class="block text-xs font-medium text-slate-600 mb-1">${t('siteAdmin.promoFormDurationMonths')}</label>
            <input type="number" data-el="duration-months" min="1" value="3" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label class="block text-xs font-medium text-slate-600 mb-1">${t('siteAdmin.promoFormUsageLimit')}</label>
            <input type="number" data-el="usage-limit" min="1" placeholder="${t('siteAdmin.promoFormUnlimited')}" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>
        <div class="grid sm:grid-cols-2 gap-3 mb-3">
          <div>
            <label class="block text-xs font-medium text-slate-600 mb-1">${t('siteAdmin.promoFormStartsAt')}</label>
            <input type="date" data-el="starts-at" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label class="block text-xs font-medium text-slate-600 mb-1">${t('siteAdmin.promoFormEndsAt')}</label>
            <input type="date" data-el="ends-at" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>
        <div class="flex flex-wrap gap-4 mb-3">
          <label class="flex items-center gap-1.5 text-sm">
            <input type="checkbox" data-el="one-use-per-church" checked /> ${t('siteAdmin.promoFormOneUsePerChurch')}
          </label>
          <label class="flex items-center gap-1.5 text-sm">
            <input type="checkbox" data-el="new-customers-only" /> ${t('siteAdmin.promoFormNewCustomersOnly')}
          </label>
        </div>
        <div class="flex items-center gap-2">
          <button type="button" data-action="save-promo-code" class="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">${t('siteAdmin.promoFormCreate')}</button>
          <button type="button" data-action="cancel-promo-code" class="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">${t('common.cancel')}</button>
          <span data-el="promo-form-status" class="text-sm"></span>
        </div>
      </div>
    `;

    const durationSelect = formEl.querySelector('[data-el="duration"]');
    const monthsWrap = formEl.querySelector('[data-el="duration-months-wrap"]');
    durationSelect.addEventListener('change', () => monthsWrap.classList.toggle('hidden', durationSelect.value !== 'repeating'));

    formEl.querySelector('[data-action="cancel-promo-code"]').addEventListener('click', () => { formEl.innerHTML = ''; });

    formEl.querySelector('[data-action="save-promo-code"]').addEventListener('click', async () => {
      const statusEl = formEl.querySelector('[data-el="promo-form-status"]');
      const code = formEl.querySelector('[data-el="code"]').value.trim();
      const discountPercent = Number(formEl.querySelector('[data-el="discount"]').value);
      const appliesToPlanGroups = [...formEl.querySelectorAll('[data-plan-group]:checked')].map((el) => el.dataset.planGroup);
      const duration = durationSelect.value;
      const durationInMonths = Number(formEl.querySelector('[data-el="duration-months"]').value);
      const usageLimitRaw = formEl.querySelector('[data-el="usage-limit"]').value;
      const startsAtRaw = formEl.querySelector('[data-el="starts-at"]').value;
      const endsAtRaw = formEl.querySelector('[data-el="ends-at"]').value;
      const oneUsePerChurch = formEl.querySelector('[data-el="one-use-per-church"]').checked;
      const newCustomersOnly = formEl.querySelector('[data-el="new-customers-only"]').checked;

      statusEl.className = 'text-sm text-slate-500';
      statusEl.textContent = t('common.saving');

      const { data: res, error } = await supabase.functions.invoke('stripe-billing', {
        body: {
          action: 'create_promo_code',
          code,
          discountPercent,
          appliesToPlanGroups,
          duration,
          durationInMonths: duration === 'repeating' ? durationInMonths : null,
          usageLimit: usageLimitRaw ? Number(usageLimitRaw) : null,
          startsAt: startsAtRaw ? new Date(startsAtRaw).toISOString() : null,
          endsAt: endsAtRaw ? new Date(endsAtRaw).toISOString() : null,
          oneUsePerChurch,
          newCustomersOnly,
        },
      });

      if (error || res?.error) {
        statusEl.className = 'text-sm text-rose-600';
        statusEl.textContent = res?.error || await extractFunctionErrorMessage(error);
        return;
      }

      formEl.innerHTML = '';
      loaded['promo-codes'] = false;
      loadPromoCodes();
    });
  }

  // ---- Usage Dashboard (SAAS only -- sql/saas_platform/76/77_*.sql).
  // Scoped to what's actually instrumented today: login_events gives
  // real per-login counts (not just a single last-sign-in timestamp),
  // current_period_end is the real Stripe renewal date now that the
  // webhook persists it, department_shifts gives a real per-department
  // schedule count. Events/tickets and messages/emails-sent numbers
  // from the feature spec aren't shown -- neither feature exists yet.
  // Attendance rate is deliberately not shown per-department --
  // attendance_records has no department_id at all (it's a whole
  // SERVICE's attendance), so there's no real figure to report there
  // without fabricating one.
  //
  // Two levels: a church picker drives between the platform-wide
  // overview (cards + table, click any row to drill in) and a single
  // church's own view (plan/renewal + member/extension meters, a
  // 30-day login trend, and a members-per-department bar chart whose
  // bars -- or a plain dropdown -- drill into that department's own
  // numbers). Follows the data-viz skill's form rules: a ratio against
  // a limit is a linear METER, not a gauge/donut; single-series
  // bar/line charts get one sequential hue (this app's own indigo) and
  // no legend, since the chart's own title already names the series.
  function formatDate(iso) {
    return iso ? new Date(iso).toLocaleDateString() : '—';
  }

  async function loadUsageDashboard() {
    panels.usage.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;
    const [{ data: overview, error: overviewError }, { data: rows, error: rowsError }] = await Promise.all([
      supabase.rpc('get_platform_usage_overview'),
      supabase.rpc('list_tenant_usage_for_site_admin'),
    ]);
    if (overviewError || rowsError) {
      panels.usage.innerHTML = `<p class="text-rose-600">${t('siteAdmin.loadFailed', { message: (overviewError || rowsError).message })}</p>`;
      return;
    }
    loaded.usage = true;
    const tenantRows = rows || [];

    panels.usage.innerHTML = `
      <div data-el="fullscreen-target" class="bg-white">
        <div class="flex items-center gap-2 mb-4">
          <label class="text-sm font-medium text-slate-600">${t('siteAdmin.usageSelectChurch')}</label>
          <select data-el="church-select" class="border border-slate-300 rounded-lg px-3 py-1.5 text-sm">
            <option value="">${t('siteAdmin.usageAllChurches')}</option>
            ${tenantRows.map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('')}
          </select>
          <button type="button" data-action="fullscreen" class="ml-auto text-slate-400 hover:text-slate-600 text-lg leading-none" title="${t('siteAdmin.usageFullscreen')}">⛶</button>
        </div>
        <div data-el="overview-view"></div>
        <div data-el="church-view" class="hidden"></div>
      </div>
    `;

    const churchSelectEl = panels.usage.querySelector('[data-el="church-select"]');
    const overviewViewEl = panels.usage.querySelector('[data-el="overview-view"]');
    const churchViewEl = panels.usage.querySelector('[data-el="church-view"]');

    // Native Fullscreen API on just the dashboard's own content (not
    // the whole Site Admin page with its tab bar/other panels) -- the
    // browser handles Esc-to-exit for free. An explicit bg-white/
    // padding is needed here specifically because a fullscreen element
    // leaves the normal document flow entirely, so it can no longer
    // lean on an ancestor's background the way it does inline.
    const fullscreenTargetEl = panels.usage.querySelector('[data-el="fullscreen-target"]');
    const fullscreenBtn = panels.usage.querySelector('[data-action="fullscreen"]');
    fullscreenBtn.addEventListener('click', () => {
      if (document.fullscreenElement === fullscreenTargetEl) document.exitFullscreen();
      else fullscreenTargetEl.requestFullscreen?.();
    });
    document.addEventListener('fullscreenchange', () => {
      const isFs = document.fullscreenElement === fullscreenTargetEl;
      fullscreenTargetEl.classList.toggle('p-6', isFs);
      fullscreenTargetEl.classList.toggle('overflow-y-auto', isFs);
      fullscreenTargetEl.classList.toggle('h-full', isFs);
      fullscreenBtn.title = isFs ? t('siteAdmin.usageExitFullscreen') : t('siteAdmin.usageFullscreen');
    });

    renderUsageOverview(overviewViewEl, overview, tenantRows, (tenantId) => {
      churchSelectEl.value = tenantId;
      churchSelectEl.dispatchEvent(new Event('change'));
    });

    churchSelectEl.addEventListener('change', (e) => {
      const tenantId = e.target.value;
      if (!tenantId) {
        overviewViewEl.classList.remove('hidden');
        churchViewEl.classList.add('hidden');
        return;
      }
      overviewViewEl.classList.add('hidden');
      churchViewEl.classList.remove('hidden');
      const tenantRow = tenantRows.find((r) => r.id === tenantId);
      renderChurchUsage(churchViewEl, tenantRow, () => { churchSelectEl.value = ''; churchSelectEl.dispatchEvent(new Event('change')); });
    });
  }

  function renderUsageOverview(container, overview, tenantRows, onSelectChurch) {
    const byPlan = overview?.byPlan || {};
    const planCards = Object.entries(byPlan).map(([planName, count]) => `
      <div class="border border-slate-200 rounded-lg px-3 py-2">
        <p class="text-xs text-slate-500">${escapeHtml(planName)}</p>
        <p class="text-xl font-bold text-slate-800">${count}</p>
      </div>
    `).join('');

    container.innerHTML = `
      <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        ${planCards}
        <div class="border border-slate-200 rounded-lg px-3 py-2">
          <p class="text-xs text-slate-500">${t('siteAdmin.usageNewThisMonth')}</p>
          <p class="text-xl font-bold text-emerald-600">${overview?.newThisMonth ?? 0}</p>
        </div>
        <div class="border border-slate-200 rounded-lg px-3 py-2">
          <p class="text-xs text-slate-500">${t('siteAdmin.usageCancelledThisMonth')}</p>
          <p class="text-xl font-bold text-rose-600">${overview?.cancelledThisMonth ?? 0}</p>
        </div>
        <div class="border border-amber-200 bg-amber-50 rounded-lg px-3 py-2">
          <p class="text-xs text-amber-700">${t('siteAdmin.usageAtRisk')}</p>
          <p class="text-xl font-bold text-amber-700">${overview?.atRiskCount ?? 0}</p>
        </div>
      </div>
      <div class="overflow-x-auto border border-slate-200 rounded-lg">
        <table class="w-full text-sm">
          <thead class="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th class="text-left px-3 py-2">${t('siteAdmin.colChurch')}</th>
              <th class="text-left px-3 py-2">${t('siteAdmin.usageColPlan')}</th>
              <th class="text-left px-3 py-2">${t('siteAdmin.usageColRenews')}</th>
              <th class="text-right px-3 py-2">${t('siteAdmin.usageColMembers')}</th>
              <th class="text-right px-3 py-2">${t('siteAdmin.usageColExtensions')}</th>
              <th class="text-right px-3 py-2">${t('siteAdmin.usageColLogins7d')}</th>
              <th class="text-right px-3 py-2">${t('siteAdmin.usageColLogins30d')}</th>
              <th class="text-left px-3 py-2">${t('siteAdmin.colLastActive')}</th>
            </tr>
          </thead>
          <tbody data-el="rows"></tbody>
        </table>
      </div>
    `;

    const now = Date.now();
    const rowsEl = container.querySelector('[data-el="rows"]');
    rowsEl.innerHTML = (tenantRows || []).map((row) => {
      const isAtRisk = !row.last_active_at || (now - new Date(row.last_active_at).getTime()) > 14 * 24 * 60 * 60 * 1000;
      const membersNearLimit = row.max_members != null && row.member_count >= row.max_members * 0.9;
      const extensionsNearLimit = row.max_extensions != null && row.extension_count >= row.max_extensions * 0.9;
      const renewsLabel = row.status === 'trial' ? t('siteAdmin.usageTrialEnds', { date: formatDate(row.trial_ends_at) }) : formatDate(row.current_period_end);
      return `
        <tr class="border-b border-slate-100 cursor-pointer hover:bg-slate-50 ${isAtRisk ? 'bg-amber-50' : ''}" data-tenant-id="${row.id}">
          <td class="px-3 py-2 font-medium text-slate-800">${escapeHtml(row.name)}</td>
          <td class="px-3 py-2 text-slate-600">${escapeHtml(row.plan_name || 'Basic')}</td>
          <td class="px-3 py-2 text-slate-600 whitespace-nowrap">${renewsLabel}</td>
          <td class="px-3 py-2 text-right whitespace-nowrap ${membersNearLimit ? 'text-amber-700 font-semibold' : ''}">${row.member_count} / ${row.max_members ?? '∞'}</td>
          <td class="px-3 py-2 text-right whitespace-nowrap ${extensionsNearLimit ? 'text-amber-700 font-semibold' : ''}">${row.extension_count} / ${row.max_extensions ?? '∞'}</td>
          <td class="px-3 py-2 text-right">${row.logins_7d}</td>
          <td class="px-3 py-2 text-right">${row.logins_30d}</td>
          <td class="px-3 py-2 ${isAtRisk ? 'text-amber-700 font-medium' : 'text-slate-500'}">${formatDate(row.last_active_at)}${isAtRisk ? ` ⚠ ${t('siteAdmin.usageAtRisk')}` : ''}</td>
        </tr>
      `;
    }).join('');

    rowsEl.querySelectorAll('[data-tenant-id]').forEach((tr) => {
      tr.addEventListener('click', () => onSelectChurch(tr.dataset.tenantId));
    });
  }

  // A ratio against a limit is a linear track+fill meter, not a
  // gauge/donut -- amber once it crosses 90%, matching the overview
  // table's own near-limit highlight.
  function usageMeterHtml(label, count, limit) {
    const pct = limit ? Math.min(100, Math.round((count / limit) * 100)) : null;
    const nearLimit = pct != null && pct >= 90;
    return `
      <div>
        <div class="flex items-center justify-between text-xs text-slate-500 mb-1">
          <span>${label}</span>
          <span class="${nearLimit ? 'text-amber-700 font-semibold' : ''}">${count} / ${limit ?? '∞'}</span>
        </div>
        <div class="h-2 rounded-full bg-slate-100 overflow-hidden">
          <div class="h-full rounded-full ${nearLimit ? 'bg-amber-500' : 'bg-indigo-600'}" style="width:${pct ?? 0}%"></div>
        </div>
      </div>
    `;
  }

  async function renderChurchUsage(container, tenantRow, onBack) {
    if (!tenantRow) { container.innerHTML = ''; return; }
    container.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;

    const [{ data: trend }, { data: depts }] = await Promise.all([
      supabase.rpc('get_tenant_login_trend', { p_tenant_id: tenantRow.id }),
      supabase.rpc('list_department_usage_for_tenant', { p_tenant_id: tenantRow.id }),
    ]);
    const departments = depts || [];

    const renewsLabel = tenantRow.status === 'trial' ? t('siteAdmin.usageTrialEnds', { date: formatDate(tenantRow.trial_ends_at) }) : formatDate(tenantRow.current_period_end);

    container.innerHTML = `
      <button type="button" data-action="back-to-overview" class="text-sm text-indigo-600 hover:text-indigo-700 font-medium mb-3">&larr; ${t('siteAdmin.usageBackToOverview')}</button>
      <h3 class="text-lg font-bold text-slate-800 mb-3">${escapeHtml(tenantRow.name)}</h3>
      <div class="grid sm:grid-cols-3 gap-3 mb-4">
        <div class="border border-slate-200 rounded-lg px-3 py-2">
          <p class="text-xs text-slate-500">${t('siteAdmin.usageColPlan')}</p>
          <p class="text-lg font-bold text-slate-800">${escapeHtml(tenantRow.plan_name || 'Basic')}</p>
          <p class="text-xs text-slate-500">${renewsLabel}</p>
        </div>
        <div class="border border-slate-200 rounded-lg px-3 py-2 flex flex-col justify-center">${usageMeterHtml(t('siteAdmin.usageColMembers'), tenantRow.member_count, tenantRow.max_members)}</div>
        <div class="border border-slate-200 rounded-lg px-3 py-2 flex flex-col justify-center">${usageMeterHtml(t('siteAdmin.usageColExtensions'), tenantRow.extension_count, tenantRow.max_extensions)}</div>
      </div>
      <div class="grid lg:grid-cols-2 gap-4 mb-4">
        <div class="border border-slate-200 rounded-lg p-3">
          <p class="text-sm font-semibold text-slate-700 mb-2">${t('siteAdmin.usageLoginTrend')}</p>
          <canvas data-el="login-chart" height="160"></canvas>
        </div>
        <div class="border border-slate-200 rounded-lg p-3">
          <p class="text-sm font-semibold text-slate-700 mb-2">${t('siteAdmin.usageMembersByDept')}</p>
          ${departments.length ? '<canvas data-el="dept-chart" height="160"></canvas>' : `<p class="text-sm text-slate-400">${t('siteAdmin.usageNoDepartments')}</p>`}
        </div>
      </div>
      ${departments.length ? `
        <div class="mb-2">
          <label class="text-sm font-medium text-slate-600 mr-2">${t('siteAdmin.usageSelectDepartment')}</label>
          <select data-el="dept-select" class="border border-slate-300 rounded-lg px-3 py-1.5 text-sm">
            <option value="">${t('siteAdmin.usageSelectDepartmentPlaceholder')}</option>
            ${departments.map((d) => `<option value="${d.department_id}">${escapeHtml(d.department_name)}</option>`).join('')}
          </select>
        </div>
        <div data-el="dept-detail"></div>
      ` : ''}
    `;

    container.querySelector('[data-action="back-to-overview"]').addEventListener('click', onBack);

    await renderLoginTrendChart(container.querySelector('[data-el="login-chart"]'), trend || []);

    if (departments.length) {
      const deptDetailEl = container.querySelector('[data-el="dept-detail"]');
      const deptSelectEl = container.querySelector('[data-el="dept-select"]');
      const selectDept = (deptId) => {
        deptSelectEl.value = deptId;
        renderDepartmentUsage(deptDetailEl, departments.find((d) => d.department_id === deptId));
      };
      await renderDeptMembersChart(container.querySelector('[data-el="dept-chart"]'), departments, selectDept);
      deptSelectEl.addEventListener('change', (e) => renderDepartmentUsage(deptDetailEl, departments.find((d) => d.department_id === e.target.value)));
    }
  }

  function renderDepartmentUsage(container, dept) {
    if (!dept) { container.innerHTML = ''; return; }
    container.innerHTML = `
      <div class="border border-indigo-200 bg-indigo-50 rounded-lg p-4">
        <p class="text-sm font-semibold text-indigo-900 mb-2">${escapeHtml(dept.department_name)}</p>
        <div class="grid sm:grid-cols-3 gap-3">
          <div><p class="text-xs text-slate-500">${t('siteAdmin.usageColMembers')}</p><p class="text-xl font-bold text-slate-800">${dept.active_member_count}</p></div>
          <div><p class="text-xs text-slate-500">${t('siteAdmin.usageShiftsScheduled')}</p><p class="text-xl font-bold text-slate-800">${dept.shift_count}</p></div>
          <div><p class="text-xs text-slate-500">${t('siteAdmin.usageUpcomingShifts')}</p><p class="text-xl font-bold text-slate-800">${dept.upcoming_shift_count}</p></div>
        </div>
        <p class="text-xs text-slate-400 mt-3">${t('siteAdmin.usageAttendanceNote')}</p>
      </div>
    `;
  }

  // Sequential single hue (this app's own indigo), no legend -- a
  // single-series chart's title already names it (data-viz skill:
  // "a single series needs no legend box").
  const USAGE_CHART_INDIGO = '#4f46e5';

  async function renderLoginTrendChart(canvas, trendRows) {
    if (!canvas) return;
    const Chart = await loadChartJs();
    const byDay = new Map((trendRows || []).map((r) => [r.day, Number(r.logins)]));
    const labels = [];
    const counts = [];
    for (let i = 29; i >= 0; i -= 1) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      labels.push(d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
      counts.push(byDay.get(key) || 0);
    }
    new Chart(canvas, {
      type: 'line',
      data: { labels, datasets: [{ data: counts, borderColor: USAGE_CHART_INDIGO, backgroundColor: 'rgba(79,70,229,0.1)', fill: true, tension: 0.3, pointRadius: 0, borderWidth: 2 }] },
      options: {
        plugins: { legend: { display: false } },
        scales: { x: { ticks: { maxTicksLimit: 6 }, grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 } } },
      },
    });
  }

  async function renderDeptMembersChart(canvas, departments, onSelectDept) {
    if (!canvas) return;
    const Chart = await loadChartJs();
    new Chart(canvas, {
      type: 'bar',
      data: { labels: departments.map((d) => d.department_name), datasets: [{ data: departments.map((d) => d.active_member_count), backgroundColor: USAGE_CHART_INDIGO, borderRadius: 4 }] },
      options: {
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true, ticks: { precision: 0 } } },
        onClick: (evt, elements) => {
          if (!elements.length) return;
          const dept = departments[elements[0].index];
          if (dept) onSelectDept(dept.department_id);
        },
        onHover: (evt, elements) => { evt.native.target.style.cursor = elements.length ? 'pointer' : 'default'; },
      },
    });
  }

  // ---- Training Sandbox ----
  async function loadSandbox() {
    panels.sandbox.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;
    loaded.sandbox = true;
    const inSandbox = getTenant()?.slug === TRAINING_TENANT_SLUG;

    if (!inSandbox) {
      panels.sandbox.innerHTML = `
        <p class="text-sm text-slate-600 mb-4">${t('siteAdmin.sandboxIntro')}</p>
        <button type="button" data-action="enter-sandbox" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">${t('siteAdmin.enterSandbox')}</button>
      `;
      panels.sandbox.querySelector('[data-action="enter-sandbox"]').addEventListener('click', async () => {
        const { error } = await supabase.rpc('enter_training_sandbox');
        if (error) { window.alert(error.message); return; }
        window.location.reload();
      });
      return;
    }

    const [{ data: departments, error: deptError }, { data: memberships, error: memError }] = await Promise.all([
      supabase.from('departments').select('id, key, name').order('name'),
      supabase.from('department_memberships').select('department_id, role').eq('user_id', currentUserId),
    ]);
    if (deptError || memError) {
      panels.sandbox.innerHTML = `<p class="text-rose-600">${t('siteAdmin.loadFailed', { message: (deptError || memError).message })}</p>`;
      return;
    }
    const roleByDept = new Map((memberships || []).map((m) => [m.department_id, m.role]));

    panels.sandbox.innerHTML = `
      <div class="bg-indigo-50 border border-indigo-200 text-indigo-800 text-sm rounded-lg px-3 py-2 mb-4 flex items-center justify-between gap-2">
        <span>${t('siteAdmin.sandboxActive')}</span>
        <button type="button" data-action="exit-sandbox" class="font-medium text-indigo-700 hover:text-indigo-900">${t('siteAdmin.exitSandbox')}</button>
      </div>
      <p class="text-xs text-slate-500 mb-3">${t('siteAdmin.sandboxDeptIntro')}</p>
      <div data-el="dept-list" class="divide-y border border-slate-200 rounded-lg"></div>
    `;

    panels.sandbox.querySelector('[data-action="exit-sandbox"]').addEventListener('click', async () => {
      const { error } = await supabase.rpc('exit_training_sandbox');
      if (error) { window.alert(error.message); return; }
      window.location.reload();
    });

    const deptListEl = panels.sandbox.querySelector('[data-el="dept-list"]');
    deptListEl.innerHTML = (departments || []).map((d) => {
      const currentRole = roleByDept.get(d.id) || null;
      return `
        <div class="flex items-center justify-between px-3 py-2" data-department-key="${escapeAttr(d.key)}">
          <div>
            <p class="text-sm font-medium text-slate-800">${escapeHtml(d.name)}</p>
            <p class="text-xs text-slate-500">${currentRole ? t('siteAdmin.currentlyActingAs', { role: t(`siteAdmin.role.${currentRole}`) }) : t('siteAdmin.notJoined')}</p>
          </div>
          <div class="flex gap-2">
            <button type="button" data-action="set-role" data-role="admin" class="text-xs px-2 py-1 rounded ${currentRole === 'admin' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}">${t('siteAdmin.role.admin')}</button>
            <button type="button" data-action="set-role" data-role="member" class="text-xs px-2 py-1 rounded ${currentRole === 'member' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}">${t('siteAdmin.role.member')}</button>
          </div>
        </div>
      `;
    }).join('');

    deptListEl.querySelectorAll('[data-action="set-role"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const key = btn.closest('[data-department-key]').dataset.departmentKey;
        const role = btn.dataset.role;
        const { error } = await supabase.rpc('set_training_department_role', { p_department_key: key, p_role: role });
        if (error) { window.alert(error.message); return; }
        loaded.sandbox = false;
        loadSandbox();
      });
    });
  }

  // ---- Manage Site Admins (SAAS + Main) ----
  async function loadManage() {
    panels.manage.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;
    const { data: saasAdmins, error } = await supabase.rpc('list_site_admins');
    if (error) {
      panels.manage.innerHTML = `<p class="text-rose-600">${t('siteAdmin.loadFailed', { message: error.message })}</p>`;
      return;
    }
    loaded.manage = true;

    const mc = getMainClient();
    const { data: { session } } = await mc.auth.getSession();
    let mainAdmins = [];
    if (session) {
      const { data } = await mc.rpc('list_site_admins');
      mainAdmins = data || [];
    }

    panels.manage.innerHTML = `
      <div class="flex items-end gap-2 mb-4 flex-wrap">
        <div class="flex-1 min-w-[180px]">
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('siteAdmin.addByEmail')}</label>
          <input type="email" data-el="add-email" placeholder="${escapeHtml(t('siteAdmin.emailPlaceholder'))}"
                 class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('siteAdmin.system')}</label>
          <select data-el="add-system" class="border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="SAAS">SAAS</option>
            ${session ? '<option value="Main">Main</option>' : ''}
          </select>
        </div>
        <button type="button" data-action="add" class="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">${t('siteAdmin.add')}</button>
      </div>
      <span data-el="add-status" class="block text-sm mb-3"></span>
      <p class="text-sm font-semibold text-slate-700 mb-2">${t('siteAdmin.currentAdmins')}</p>
      <div data-el="admin-list" class="divide-y border border-slate-200 rounded-lg"></div>
    `;
    renderAdminList([
      ...saasAdmins.map((a) => ({ ...a, _system: 'SAAS' })),
      ...mainAdmins.map((a) => ({ ...a, _system: 'Main' })),
    ]);

    const emailEl = panels.manage.querySelector('[data-el="add-email"]');
    const systemEl = panels.manage.querySelector('[data-el="add-system"]');
    const addStatusEl = panels.manage.querySelector('[data-el="add-status"]');
    panels.manage.querySelector('[data-action="add"]').addEventListener('click', async () => {
      const email = emailEl.value.trim();
      if (!email) return;
      const client = systemEl.value === 'Main' ? getMainClient() : supabase;
      addStatusEl.className = 'block text-sm text-slate-500 mb-3';
      addStatusEl.textContent = t('common.saving');
      const { error } = await client.rpc('grant_site_admin_by_email', { p_email: email });
      if (error) {
        addStatusEl.className = 'block text-sm text-rose-600 mb-3';
        addStatusEl.textContent = t('siteAdmin.addFailed', { message: error.message });
        return;
      }
      emailEl.value = '';
      addStatusEl.textContent = '';
      loaded.manage = false;
      loadManage();
    });
  }

  function renderAdminList(admins) {
    const listEl = panels.manage.querySelector('[data-el="admin-list"]');
    listEl.innerHTML = admins.map((a) => `
      <div class="flex items-center justify-between px-3 py-2" data-admin-id="${a.user_id}" data-system="${a._system}">
        <div>
          <p class="text-sm font-medium text-slate-800">
            ${escapeHtml(a.full_name || '—')}
            <span class="text-[11px] font-semibold px-1.5 py-0.5 rounded ${a._system === 'Main' ? 'bg-amber-100 text-amber-700' : 'bg-indigo-100 text-indigo-700'}">${a._system}</span>
          </p>
          <p class="text-xs text-slate-500">${escapeHtml(a.tenant_name || '—')} · ${t('siteAdmin.grantedOn', { date: new Date(a.granted_at).toLocaleDateString() })}</p>
        </div>
        <button type="button" data-action="remove" class="text-sm text-rose-600 hover:text-rose-700">${t('siteAdmin.remove')}</button>
      </div>
    `).join('');

    listEl.querySelectorAll('[data-action="remove"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('[data-admin-id]');
        const id = row.dataset.adminId;
        const client = row.dataset.system === 'Main' ? getMainClient() : supabase;
        const name = row.querySelector('p').textContent;
        const ok = await confirmDialog({ message: t('siteAdmin.removeConfirm', { name }) });
        if (!ok) return;
        await client.rpc('revoke_site_admin', { p_user_id: id });
        loaded.manage = false;
        loadManage();
      });
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return escapeHtml(str).replaceAll('"', '&quot;');
  }

  renderMainConnect();
  switchTab('inquiries');
}
