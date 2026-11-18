// Pieces of the redesigned Home page (approved design canvas, step 2):
// "Mon prochain service" with confirm, quick actions, this week's
// services, the live countdown card and the leaders' "À traiter" list.
// superAdminHome.js lays them out; each piece fills its own container
// and fails quietly (an empty, readable state) rather than breaking the
// rest of the page.
import { t, getLang, appLocale, departmentLabel, mediaTechRoleLabel } from '../i18n.js';
import { fetchLiveStatus } from '../liveStatus.js';
import { serviceState, formatCountdown, formatServiceTime, slotFor, slotForWeekday, placeLabel } from '../liveSchedule.js';

const ICONS = {
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  sermons: '<path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3"/>',
  give: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  prayer: '<path d="M12 3c-1 3-4 5-4 9a4 4 0 0 0 8 0c0-4-3-6-4-9zM5 21h14"/>',
  check: '<path d="M5 12l5 5L20 7"/>',
};
const icon = (name, cls = 'w-5 h-5') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

// "CULTE D'ENSEIGNEMENT" -> "Culte d'enseignement"; mixed case is kept.
export function cap(s) {
  const v = String(s || '');
  if (v !== v.toUpperCase()) return v;
  const lower = v.toLocaleLowerCase(appLocale());
  return lower.charAt(0).toLocaleUpperCase(appLocale()) + lower.slice(1);
}

function localDate(iso) { return new Date(`${iso}T12:00:00`); }
function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDaysIso(iso, n) {
  const d = localDate(iso); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function longDate(iso) {
  const s = localDate(iso).toLocaleDateString(appLocale(), { weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function clockLabel(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  if (Number.isNaN(h)) return '';
  if (getLang() === 'fr') return `${h} h ${String(m || 0).padStart(2, '0')}`;
  return new Date(2000, 0, 1, h, m || 0).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
}

export function greeting(fullName) {
  const first = String(fullName || '').trim().split(/\s+/)[0] || '';
  const key = new Date().getHours() >= 18 ? 'home.greetEvening' : 'home.greetDay';
  return t(key, { name: first });
}

// ---- Mon prochain service ----------------------------------------------

function serviceTitle(row) {
  const dept = departmentLabel(row.department_key) || row.department_name || '';
  let what = row.title || '';
  if (row.kind === 'media_tech') what = mediaTechRoleLabel(row.title) || row.title;
  else if (row.kind === 'moderator') what = t('home.roleModerator');
  else if (row.kind === 'preacher') what = row.title && row.title !== 'preacher' ? `${t('home.rolePreacher')} · ${row.title}` : t('home.rolePreacher');
  return what ? `${dept} · ${cap(what)}` : dept;
}

export async function renderNextService(container, { supabase }) {
  container.innerHTML = `<div class="home-card"><p class="text-sm text-slate-400">${t('common.loading')}</p></div>`;
  const { data, error } = await supabase.rpc('get_my_upcoming_services', { p_limit: 3 });
  const rows = error ? [] : (data || []);

  if (rows.length === 0) {
    container.innerHTML = `
      <section class="home-card home-card--accent">
        <div class="home-kicker">${t('home.nextService')}</div>
        <p class="mt-2 text-[15px] text-slate-600">${t('home.noService')}</p>
      </section>`;
    return;
  }

  const [first, ...rest] = rows;
  const pending = first.status === 'pending';
  const canConfirm = pending && first.kind !== 'preacher';
  container.innerHTML = `
    <section class="home-card home-card--accent">
      <div class="flex flex-col sm:flex-row sm:items-center gap-4">
        <div class="flex-1 min-w-0">
          <div class="home-kicker">${t('home.nextService')}</div>
          <div class="font-display text-[20px] leading-snug text-[#0B1F3A] mt-1.5">${escapeHtml(serviceTitle(first))}</div>
          <div class="text-sm text-slate-500 mt-1">${escapeHtml(longDate(first.service_date))}</div>
        </div>
        <div class="flex gap-2 shrink-0" data-el="actions">
          ${canConfirm ? `
            <button type="button" data-action="confirm" class="home-btn home-btn--primary">${icon('check', 'w-4 h-4')}${t('home.confirm')}</button>
            <button type="button" data-action="unavailable" class="home-btn">${t('home.unavailable')}</button>
          ` : `
            <span class="home-pill home-pill--ok">${icon('check', 'w-4 h-4')}${t('home.confirmed')}</span>
            <button type="button" data-action="schedule" class="home-btn">${t('home.seeSchedule')}</button>
          `}
        </div>
      </div>
      ${rest.length ? `
        <div class="mt-4 pt-3 border-t border-[#EFEBE2]">
          <div class="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">${t('home.then')}</div>
          ${rest.map((r) => `
            <div class="flex items-center justify-between gap-3 py-1.5 text-sm">
              <span class="truncate text-slate-700">${escapeHtml(serviceTitle(r))}</span>
              <span class="shrink-0 text-slate-400">${escapeHtml(longDate(r.service_date))}</span>
            </div>`).join('')}
        </div>` : ''}
      <p data-el="msg" class="hidden mt-3 text-sm text-rose-600"></p>
    </section>`;

  const openSchedule = () => window.dispatchEvent(new CustomEvent('app:open-department-schedule', { detail: { key: first.department_key } }));
  container.querySelector('[data-action="unavailable"]')?.addEventListener('click', openSchedule);
  container.querySelector('[data-action="schedule"]')?.addEventListener('click', openSchedule);
  container.querySelector('[data-action="confirm"]')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    const { error: err } = await supabase.rpc('confirm_my_service', { p_kind: first.kind, p_ref_id: first.ref_id });
    if (err) {
      const msg = container.querySelector('[data-el="msg"]');
      msg.textContent = t('home.confirmFailed', { message: err.message });
      msg.classList.remove('hidden');
      e.currentTarget.disabled = false;
      return;
    }
    renderNextService(container, { supabase });
  });
}

// ---- Quick actions -----------------------------------------------------

export function renderQuickActions(container) {
  const items = [
    { key: 'calendar', label: t('home.qaCalendar'), tab: 'calendar' },
    { key: 'sermons', label: t('home.qaSermons'), tab: 'sermons' },
    { key: 'give', label: t('home.qaGive'), href: 'give.html' },
    { key: 'prayer', label: t('home.qaPrayer'), href: 'prayer.html' },
  ];
  container.innerHTML = `
    <nav class="grid grid-cols-4 gap-2 sm:gap-3" aria-label="${escapeHtml(t('home.quickActions'))}">
      ${items.map((it) => {
        const inner = `<span class="home-qa-icon">${icon(it.key)}</span><span>${escapeHtml(it.label)}</span>`;
        return it.href
          ? `<a href="${it.href}" class="home-qa">${inner}</a>`
          : `<button type="button" data-tab="${it.tab}" class="home-qa">${inner}</button>`;
      }).join('')}
    </nav>`;
  container.querySelectorAll('[data-tab]').forEach((btn) => btn.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('app:open-tab', { detail: { tab: btn.dataset.tab } }));
  }));
}

// ---- This week at church -----------------------------------------------

export async function renderThisWeek(container, { supabase, liveInfo }) {
  container.innerHTML = `<section class="home-card"><h2 class="home-h2">${t('home.thisWeek')}</h2><p class="mt-3 text-sm text-slate-400">${t('common.loading')}</p></section>`;
  const from = todayIso();
  const to = addDaysIso(from, 6);
  const { data, error } = await supabase
    .from('church_program_dates')
    .select('date, program:church_programs!program_id ( title, is_special )')
    .gte('date', from).lte('date', to)
    .order('date', { ascending: true });

  const info = await liveInfo;
  const schedule = info?.schedule || [];
  const timeFor = (iso) => schedule.find((s) => Number(s.day) === localDate(iso).getDay())?.time || null;

  const rows = (error ? [] : (data || [])).filter((r) => r.program?.title);
  const body = rows.length === 0
    ? `<p class="mt-3 text-sm text-slate-500">${t('home.noProgram')}</p>`
    : rows.map((r) => {
      const d = localDate(r.date);
      const time = timeFor(r.date);
      const wk = d.toLocaleDateString(appLocale(), { weekday: 'short' }).replace('.', '');
      return `
        <div class="flex items-center gap-4 py-3 border-t border-[#EFEBE2] first:border-t-0">
          <div class="w-11 text-center shrink-0">
            <div class="font-display text-[22px] leading-none text-[#0B1F3A]">${d.getDate()}</div>
            <div class="text-[11px] font-semibold uppercase text-slate-500 mt-0.5">${escapeHtml(wk)}</div>
          </div>
          <div class="min-w-0">
            <div class="font-semibold text-[15px] text-slate-800 truncate">${escapeHtml(cap(r.program.title))}${r.program.is_special ? ` <span class="home-pill home-pill--gold ml-1">★</span>` : ''}</div>
            ${time ? `<div class="text-[13px] text-slate-500">${escapeHtml(clockLabel(time))} · ${escapeHtml(placeLabel(slotForWeekday(schedule, d.getDay()), info?.address, getLang()))}</div>` : ''}
          </div>
        </div>`;
    }).join('');

  container.innerHTML = `
    <section class="home-card">
      <div class="flex items-center justify-between gap-2">
        <h2 class="home-h2">${t('home.thisWeek')}</h2>
        <button type="button" data-tab="calendar" class="home-link">${t('home.qaCalendar')}</button>
      </div>
      <div class="mt-2">${body}</div>
    </section>`;
  container.querySelector('[data-tab]').addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('app:open-tab', { detail: { tab: 'calendar' } }));
  });
}

// ---- Live: navy card (desktop side column) + compact chip (phone) -------

export function loadLiveInfo(supabase) {
  const address = supabase
    ? supabase.from('church_branding').select('address').eq('id', true).maybeSingle().then((r) => r.data?.address || null, () => null)
    : Promise.resolve(null);
  return Promise.all([fetchLiveStatus(), address]).then(([info, addr]) => (info ? { ...info, address: addr } : null));
}

export async function renderLive(cardEl, chipEl, { liveInfo }) {
  const info = await liveInfo;
  if (!info || !info.configured) { cardEl.innerHTML = ''; chipEl.innerHTML = ''; return; }
  const lang = getLang();
  const tz = info.timezone || 'America/Toronto';

  function paint() {
    if (!cardEl.isConnected && !chipEl.isConnected) { clearInterval(timer); return; }
    if (info.live) {
      cardEl.innerHTML = `
        <section class="rounded-2xl p-5 text-white bg-[#C81E1E]">
          <div class="flex items-center gap-2 text-[12px] font-bold uppercase tracking-wider"><span class="home-dot"></span>${t('home.liveNow')}</div>
          ${info.title ? `<div class="font-display text-[20px] mt-2 leading-snug">${escapeHtml(info.title)}</div>` : ''}
          <a href="live.html" class="mt-4 h-10 rounded-xl bg-white text-[#C81E1E] font-semibold text-sm flex items-center justify-center">${t('home.watch')}</a>
        </section>`;
      chipEl.innerHTML = `<a href="live.html" class="home-chip home-chip--live"><span class="home-dot"></span>${t('home.liveNow')} · ${t('home.watch')}</a>`;
      return;
    }
    const st = serviceState(info.schedule || [], tz, new Date());
    if (st.state === 'starting') {
      cardEl.innerHTML = `
        <section class="rounded-2xl p-5 text-white bg-[#0B1F3A]">
          <div class="text-[12px] font-bold uppercase tracking-wider text-[#E0B654]">${t('home.nextLive')}</div>
          <div class="font-display text-[24px] mt-2">${t('home.starting')}</div>
          <a href="live.html" class="mt-4 h-10 rounded-xl bg-[#E0B654] text-[#0B1F3A] font-semibold text-sm flex items-center justify-center">${t('home.openLive')}</a>
        </section>`;
      chipEl.innerHTML = `<a href="live.html" class="home-chip">${t('home.starting')}</a>`;
      return;
    }
    if (!st.next) { cardEl.innerHTML = ''; chipEl.innerHTML = ''; return; }
    const when = formatServiceTime(st.next, tz, lang);
    const left = formatCountdown(st.next - new Date(), lang);
    cardEl.innerHTML = `
      <section class="rounded-2xl p-5 text-white bg-[#0B1F3A]">
        <div class="text-[12px] font-bold uppercase tracking-wider text-[#E0B654]">${t('home.nextLive')}</div>
        <div class="font-display text-[28px] mt-2 tabular-nums">${escapeHtml(left)}</div>
        <div class="text-[13px] text-slate-300 mt-1">${escapeHtml(when.charAt(0).toUpperCase() + when.slice(1))}</div>
        ${placeLabel(slotFor(info.schedule, st.next, tz), info.address, lang) ? `<div class="text-[13px] text-[#E0B654] mt-1">${escapeHtml(placeLabel(slotFor(info.schedule, st.next, tz), info.address, lang))}</div>` : ''}
        <a href="live.html" class="mt-4 h-10 rounded-xl bg-[#E0B654] text-[#0B1F3A] font-semibold text-sm flex items-center justify-center">${t('home.openLive')}</a>
      </section>`;
    chipEl.innerHTML = `<a href="live.html" class="home-chip"><span class="text-[#8A6A1F] font-bold">${t('home.nextLive')}</span> · ${escapeHtml(when)}</a>`;
  }
  const timer = setInterval(paint, 30000);
  paint();
}

// ---- À traiter (leaders only) ------------------------------------------

export async function renderTodo(container, { supabase, actions }) {
  container.innerHTML = `<section class="home-card"><h2 class="home-h2 text-[18px]">${t('home.todo')}</h2><p class="mt-3 text-sm text-slate-400">${t('common.loading')}</p></section>`;
  const count = (q) => q.then((r) => (r.error ? 0 : (r.count || 0)));
  const head = { count: 'exact', head: true };
  const [memberships, meetings, prayer, budgets] = await Promise.all([
    count(supabase.from('department_memberships').select('id', head).eq('status', 'pending')),
    actions.meetings ? count(supabase.from('pastor_meeting_requests').select('id', head).eq('status', 'pending')) : 0,
    actions.prayer ? count(supabase.from('prayer_requests').select('id', head).eq('status', 'pending')) : 0,
    count(supabase.from('budget_requests').select('id', head).eq('status', 'pending')),
  ]);
  const items = [
    { n: memberships, label: t('home.todoMemberships'), go: actions.memberships },
    { n: meetings, label: t('home.todoMeetings'), go: actions.meetings },
    { n: prayer, label: t('home.todoPrayer'), go: actions.prayer },
    { n: budgets, label: t('home.todoBudgets'), go: actions.budgets },
  ].filter((i) => i.n > 0);

  container.innerHTML = `
    <section class="home-card">
      <h2 class="home-h2 text-[18px]">${t('home.todo')}</h2>
      <div class="mt-2">
        ${items.map((i, idx) => `
          <button type="button" data-i="${idx}" class="w-full flex items-center justify-between gap-3 py-2.5 border-t border-[#EFEBE2] first:border-t-0 text-left text-[14px] text-slate-700 hover:text-[#0B1F3A]">
            <span>${escapeHtml(i.label)}</span>
            <span class="home-pill home-pill--gold">${i.n}</span>
          </button>`).join('')}
        <p class="${items.length ? 'pt-2.5 border-t border-[#EFEBE2]' : 'pt-1'} text-[13px] text-slate-500">${items.length ? t('home.restClear') : t('home.allClear')}</p>
      </div>
    </section>`;
  container.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => items[Number(b.dataset.i)].go?.()));
}
