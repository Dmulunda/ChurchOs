// Entry point for welcome.html: the public front door for guests and
// visitors (no account needed). Everything shown comes from the
// public-portal edge function (church contact, program, public events,
// sermons, social links) and the live-status function (YouTube live,
// service times). Only public fields; no member information is read.
// Layout follows the approved redesign: live countdown in the hero, two
// main actions, a 2x2 help grid, "this week" cards, latest sermon,
// events, find us, and a bottom bar (Live, Give, Prayer).
import { supabase } from './supabaseClient.js';
import { fetchLiveStatus } from './liveStatus.js';
import { serviceState, formatServiceTime, slotFor, placeLabel } from './liveSchedule.js';

const LANG_KEY = 'choir-hub-lang';
const NAVY = '#0B1F3A';
const GOLD = '#E0B654';
const LIVE_RED = '#C81E1E';

const TEXT = {
  en: {
    kicker: 'Ottawa', title: 'Welcome home.',
    intro: "First visit or long-time member, you are expected. Join our services, ask for prayer or meet a pastor.",
    signIn: 'Sign in', langSwitch: 'FR',
    nextLive: 'NEXT LIVE SERVICE', days: 'DAYS', hours: 'HOURS', min: 'MIN', sec: 'SEC',
    openLive: 'Open the live page', everyWeek: 'Every {list}',
    starting: 'The service is starting', startingSub: 'The live stream will appear in a moment.',
    liveBadge: 'LIVE NOW', liveTitle: 'The service is live', joinLive: 'Join the live service', youtubePlayer: 'YouTube player',
    newHere: "I'm new here", give: 'Give',
    helpTitle: 'How can we help you?',
    prayer: 'Request prayer', prayerSub: 'Our intercession team prays for you',
    pastor: 'Meet a pastor', pastorSub: 'Choose a time to talk',
    member: 'Become a member', memberSub: 'Fill in the membership form',
    watchLive: 'Watch live', watchLiveSub: 'Our services on YouTube',
    thisWeek: 'This week', allProgram: 'Full program', lessProgram: 'Less', noProgram: 'The program will be posted soon.', special: 'Special', flyer: 'Flyer', live: 'live',
    latestSermon: 'Latest sermon', watch: 'Watch', listen: 'Listen', notes: 'Notes', allSermons: 'All', lessSermons: 'Less', noSermons: 'Sermons will appear here soon.',
    events: 'Events', register: 'Register', free: 'Free', noEvents: 'No public events right now.',
    findUs: 'Find us', directions: 'Directions', call: 'Call', email: 'Email', follow: 'Follow us', website: 'Website',
    already: 'Already a member?', createAccount: 'Create an account',
    privacy: 'This page never shows information about our members.',
    navLive: 'Live', navGive: 'Give', navPrayer: 'Prayer',
    error: 'Could not load the latest information. Please try again later.',
  },
  fr: {
    kicker: 'Ottawa', title: 'Bienvenue à la maison.',
    intro: 'Première visite ou fidèle de longue date, vous êtes attendu. Suivez nos cultes, demandez la prière ou rencontrez un pasteur.',
    signIn: 'Se connecter', langSwitch: 'EN',
    nextLive: 'PROCHAIN DIRECT', days: 'JOURS', hours: 'HEURES', min: 'MIN', sec: 'SEC',
    openLive: 'Ouvrir la page du direct', everyWeek: 'Chaque {list}',
    starting: 'Le culte commence', startingSub: 'Le direct va apparaître dans un instant.',
    liveBadge: 'EN DIRECT MAINTENANT', liveTitle: 'Le culte est en direct', joinLive: 'Rejoindre le direct', youtubePlayer: 'Lecteur YouTube',
    newHere: 'Je suis nouveau', give: 'Faire un don',
    helpTitle: 'Comment pouvons-nous vous aider ?',
    prayer: 'Demander la prière', prayerSub: "L'équipe d'intercession prie pour vous",
    pastor: 'Rencontrer un pasteur', pastorSub: 'Choisissez un moment pour parler',
    member: 'Devenir membre', memberSub: "Remplissez le formulaire d'adhésion",
    watchLive: 'Regarder en direct', watchLiveSub: 'Nos cultes sur YouTube',
    thisWeek: 'Cette semaine', allProgram: 'Tout le programme', lessProgram: 'Moins', noProgram: 'Le programme sera bientôt publié.', special: 'Spécial', flyer: 'Affiche', live: 'en direct',
    latestSermon: 'Dernière prédication', watch: 'Regarder', listen: 'Écouter', notes: 'Notes', allSermons: 'Toutes', lessSermons: 'Moins', noSermons: 'Les prédications apparaîtront ici bientôt.',
    events: 'Événements', register: "S'inscrire", free: 'Gratuit', noEvents: "Aucun événement public pour l'instant.",
    findUs: 'Nous trouver', directions: 'Itinéraire', call: 'Appeler', email: 'Courriel', follow: 'Suivez-nous', website: 'Site web',
    already: 'Déjà membre ?', createAccount: 'Créer un compte',
    privacy: "Cette page n'affiche jamais d'information sur nos membres.",
    navLive: 'Direct', navGive: 'Don', navPrayer: 'Prière',
    error: 'Impossible de charger les dernières informations. Réessayez plus tard.',
  },
};

let lang = (() => {
  try { const v = localStorage.getItem(LANG_KEY); if (v === 'en' || v === 'fr') return v; } catch { /* storage blocked */ }
  return (navigator.language || '').toLowerCase().startsWith('en') ? 'en' : 'fr';
})();
const tx = (k, vars = {}) => String(TEXT[lang][k] ?? TEXT.en[k] ?? k).replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? '');
const locale = () => (lang === 'fr' ? 'fr-CA' : 'en-CA');

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}
const attr = (s) => esc(s).replace(/"/g, '&quot;');
function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function youtubeId(url) {
  const m = String(url || '').match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|live\/|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}

// ---- icons (stroke SVG, inherit currentColor) ----
const ICON = {
  video: '<rect x="2" y="5" width="15" height="14" rx="2"></rect><path d="M17 10l5-3v10l-5-3"></path>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"></path>',
  prayer: '<path d="M12 3v4M8 7h8"></path><path d="M6 21v-7a6 6 0 0 1 12 0v7"></path><path d="M4 21h16"></path>',
  calendar: '<rect x="3" y="4" width="18" height="17" rx="2"></rect><path d="M16 2v4M8 2v4M3 10h18"></path><path d="M9 15l2 2 4-4"></path>',
  pen: '<path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"></path>',
  userPlus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M19 8v6M22 11h-6"></path>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path>',
  pin: '<path d="M12 22s7-6.1 7-12a7 7 0 0 0-14 0c0 5.9 7 12 7 12z"></path><circle cx="12" cy="10" r="2.5"></circle>',
};
const icon = (name, size = 20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;
const PLAY = (size) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg>`;

let data = null;
let loading = true;
let liveState = null;
let showAllProgram = false;
let showAllSermons = false;
let tick = null;

// ---------- pieces ----------
function header(church) {
  const logo = church?.logo_url || 'img/vpd-logo.png';
  return `<header style="background:${NAVY}" class="px-5 py-3.5 flex items-center justify-between gap-3">
    <a href="welcome.html" class="bg-white rounded-xl px-2.5 py-1.5 flex items-center">
      <img src="${attr(logo)}" alt="${attr(church?.name || 'La Voix de la Puissance Divine')}" class="h-[34px] block" onerror="this.src='img/vpd-logo.png'">
    </a>
    <div class="flex items-center gap-2">
      <button type="button" data-action="lang" class="h-11 min-w-[44px] px-3 rounded-full border border-white/35 text-white text-[13px] font-semibold">${esc(tx('langSwitch'))}</button>
      <a href="index.html?signin=1" class="h-11 px-3.5 rounded-full bg-white/10 text-white text-[13px] font-semibold flex items-center">${esc(tx('signIn'))}</a>
    </div>
  </header>`;
}

function scheduleLine() {
  const sch = liveState?.schedule || [];
  if (!sch.length) return '';
  const tz = liveState.timezone || 'America/Toronto';
  // Next occurrence of each slot, in week order starting today.
  const now = new Date();
  const parts = sch.map((slot) => {
    const st = serviceState([slot], tz, now);
    const when = st.next || st.start;
    const online = slot.online_only ? (lang === 'fr' ? ' (en ligne)' : ' (online)') : '';
    return when ? { when, label: formatServiceTime(when, tz, lang) + online } : null;
  }).filter(Boolean).sort((a, b) => a.when - b.when);
  const list = parts.map((p) => p.label).join(' · ');
  return `<p class="m-0 text-xs text-center" style="color:#9FB0CC">${esc(tx('everyWeek', { list }))}</p>`;
}

function splitCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(total / 86400), h: Math.floor((total % 86400) / 3600), m: Math.floor((total % 3600) / 60), s: total % 60 };
}

function countdownBoxes(next) {
  const c = splitCountdown(next - Date.now());
  const pad = (n) => String(n).padStart(2, '0');
  const cells = c.d > 0
    ? [[c.d, tx('days')], [pad(c.h), tx('hours')], [pad(c.m), tx('min')]]
    : [[pad(c.h), tx('hours')], [pad(c.m), tx('min')], [pad(c.s), tx('sec')]];
  return cells.map(([v, l]) => `<div class="rounded-xl py-2.5 text-center" style="background:${NAVY}">
      <p class="m-0 text-[28px] font-bold text-white tabular-nums">${esc(v)}</p>
      <p class="m-0 text-[11px] tracking-wider" style="color:#9FB0CC">${esc(l)}</p>
    </div>`).join('');
}

function heroLiveCard() {
  if (!liveState?.configured) return '';
  const tz = liveState.timezone || 'America/Toronto';
  const st = serviceState(liveState.schedule, tz);
  const programToday = (data?.program || []).find((p) => st.next && p.date === new Date(st.next).toLocaleDateString('en-CA', { timeZone: tz }));
  if (st.state === 'starting') {
    return `<a href="live.html" class="rounded-[20px] p-[18px] flex flex-col gap-2 border border-white/10" style="background:#13294A">
      <span class="text-xs font-bold tracking-wider" style="color:${GOLD}">${icon('video', 16)} ${esc(tx('nextLive'))}</span>
      <p class="m-0 text-[19px] font-bold text-white">${esc(tx('starting'))}</p>
      <p class="m-0 text-sm" style="color:#C9D2E3">${esc(tx('startingSub'))}</p>
      <span class="mt-1 h-12 rounded-[14px] bg-white font-bold text-[15px] flex items-center justify-center" style="color:${NAVY}">${esc(tx('openLive'))}</span>
    </a>`;
  }
  if (!st.next) return '';
  return `<div class="rounded-[20px] p-[18px] flex flex-col gap-3.5 border border-white/10" style="background:#13294A">
    <div class="flex items-center justify-between">
      <span class="flex items-center gap-2 text-xs font-bold tracking-wider" style="color:${GOLD}">${icon('video', 16)} ${esc(tx('nextLive'))}</span>
      <span class="text-xs" style="color:#9FB0CC">YouTube</span>
    </div>
    <div class="flex flex-col gap-0.5">
      <p class="m-0 text-[19px] font-bold text-white first-letter:uppercase">${esc(formatServiceTime(st.next, tz, lang))}</p>
      ${placeLabel(slotFor(liveState.schedule, st.next, tz), data?.church?.address, lang) ? `<p class="m-0 text-sm font-semibold" style="color:${GOLD}">${esc(placeLabel(slotFor(liveState.schedule, st.next, tz), data?.church?.address, lang))}</p>` : ''}
      ${programToday ? `<p class="m-0 text-sm first-letter:uppercase" style="color:#C9D2E3">${esc(cap(programToday.title))}</p>` : ''}
    </div>
    <div data-el="countdown" class="grid grid-cols-3 gap-2">${countdownBoxes(st.next)}</div>
    <a href="live.html" class="h-12 rounded-[14px] bg-white font-bold text-[15px] flex items-center justify-center" style="color:${NAVY}">${esc(tx('openLive'))}</a>
    ${scheduleLine()}
  </div>`;
}

// Program titles are often typed in capitals: show them in sentence case.
function cap(s) {
  const v = String(s || '');
  if (v !== v.toUpperCase()) return v;
  const lower = v.toLocaleLowerCase(locale());
  return lower.charAt(0).toLocaleUpperCase(locale()) + lower.slice(1);
}

function hero(church) {
  if (liveState?.live && liveState.video_id) {
    return `<section class="px-5 pt-3 pb-6 flex flex-col gap-3.5" style="background:${NAVY}">
      <span class="self-start flex items-center gap-2 text-white rounded-full px-3 py-1.5 text-xs font-bold tracking-wider" style="background:${LIVE_RED}">
        <span class="relative inline-flex h-2 w-2"><span class="absolute inline-flex h-full w-full rounded-full bg-white opacity-75 animate-ping"></span><span class="relative inline-flex h-2 w-2 rounded-full bg-white"></span></span>
        ${esc(tx('liveBadge'))}
      </span>
      <h1 class="m-0 text-[30px] leading-tight text-white font-bold" style="font-family:Fraunces,Georgia,serif">${esc(tx('liveTitle'))}</h1>
      ${liveState.title ? `<p class="m-0 text-sm" style="color:#C9D2E3">${esc(liveState.title)}</p>` : ''}
      <a href="live.html" class="relative block rounded-[18px] overflow-hidden border-2" style="border-color:${LIVE_RED};background:#1B2B47;aspect-ratio:16/9">
        <img src="https://i.ytimg.com/vi/${encodeURIComponent(liveState.video_id)}/hqdefault.jpg" alt="${attr(tx('youtubePlayer'))}" class="absolute inset-0 w-full h-full object-cover" onerror="this.remove()">
        <span class="absolute inset-0 flex items-center justify-center"><span class="w-[68px] h-[68px] rounded-full text-white flex items-center justify-center" style="background:${LIVE_RED}">${PLAY(28)}</span></span>
      </a>
      <a href="live.html" class="h-[50px] rounded-[14px] text-white font-bold text-base flex items-center justify-center" style="background:${LIVE_RED}">${esc(tx('joinLive'))}</a>
    </section>`;
  }
  return `<section class="px-5 pt-3 pb-7 flex flex-col gap-[18px]" style="background:${NAVY}">
    <div class="flex flex-col gap-2.5">
      <p class="m-0 text-xs font-semibold tracking-[1.5px] uppercase" style="color:${GOLD}">${esc(church?.address || tx('kicker'))}</p>
      <h1 class="m-0 text-[36px] leading-[1.1] text-white font-bold" style="font-family:Fraunces,Georgia,serif">${esc(tx('title'))}</h1>
      <p class="m-0 text-[15px] leading-relaxed" style="color:#C9D2E3">${esc(tx('intro'))}</p>
    </div>
    <div data-el="live-card">${heroLiveCard()}</div>
  </section>`;
}

function mainActions() {
  return `<section class="px-5 pt-5 grid grid-cols-2 gap-2.5">
    <a href="guest-checkin.html?d=${todayLocal()}" class="h-[52px] rounded-[14px] font-bold text-[15px] flex items-center justify-center gap-2" style="background:${GOLD};color:${NAVY}">${icon('userPlus', 18)} ${esc(tx('newHere'))}</a>
    <a href="give.html" class="h-[52px] rounded-[14px] bg-white font-bold text-[15px] flex items-center justify-center gap-2 border-[1.5px]" style="border-color:${NAVY};color:${NAVY}">${icon('heart', 18)} ${esc(tx('give'))}</a>
  </section>`;
}

function helpCard(href, ic, title, sub) {
  return `<a href="${attr(href)}" class="bg-white border border-[#E6E1D6] rounded-2xl p-4 flex flex-col gap-2.5 hover:border-[#E0B654]">
    <span class="w-10 h-10 rounded-xl flex items-center justify-center" style="background:#EEF2F8;color:${NAVY}">${icon(ic)}</span>
    <span class="font-bold text-[15px] text-[#1B2433]">${esc(title)}</span>
    <span class="text-[13px] leading-snug text-[#5B6475]">${esc(sub)}</span>
  </a>`;
}

function sectionTitle(title, right = '') {
  return `<div class="flex items-baseline justify-between gap-3"><h2 class="m-0 text-[22px] font-semibold" style="font-family:Fraunces,Georgia,serif;color:${NAVY}">${esc(title)}</h2>${right}</div>`;
}

function helpGrid() {
  return `<section class="px-5 pt-7 flex flex-col gap-3">
    ${sectionTitle(tx('helpTitle'))}
    <div class="grid grid-cols-2 gap-2.5">
      ${helpCard('prayer.html', 'prayer', tx('prayer'), tx('prayerSub'))}
      ${helpCard('booking.html', 'calendar', tx('pastor'), tx('pastorSub'))}
      ${helpCard('register.html', 'pen', tx('member'), tx('memberSub'))}
      ${liveState?.configured ? helpCard('live.html', 'video', tx('watchLive'), tx('watchLiveSub')) : helpCard('index.html?signin=1', 'lock', tx('signIn'), tx('already'))}
    </div>
  </section>`;
}

function programSection() {
  const list = data?.program || [];
  if (!list.length) {
    return `<section class="px-5 pt-7 flex flex-col gap-3">${sectionTitle(tx('thisWeek'))}<p class="m-0 text-sm text-[#5B6475]">${esc(tx('noProgram'))}</p></section>`;
  }
  const soon = list.filter((p) => (new Date(`${p.date}T12:00:00`) - Date.now()) / 86400000 < 7);
  const shown = showAllProgram ? list : (soon.length ? soon : list.slice(0, 3));
  const toggle = list.length > shown.length || showAllProgram
    ? `<button type="button" data-action="program" class="text-sm font-semibold" style="color:${NAVY}">${esc(showAllProgram ? tx('lessProgram') : tx('allProgram'))}</button>` : '';
  const card = (p) => {
    const d = new Date(`${p.date}T12:00:00`);
    const wd = d.toLocaleDateString(locale(), { weekday: 'short' }).replace('.', '').toUpperCase();
    return `<div class="flex-none w-[230px] bg-white border border-[#E6E1D6] rounded-2xl p-3.5 flex gap-3 items-center ${p.date === todayLocal() ? 'ring-2 ring-[#E0B654]' : ''}">
      <div class="w-[52px] h-[58px] rounded-xl text-white flex flex-col items-center justify-center shrink-0" style="background:${NAVY}">
        <span class="text-[11px] font-semibold tracking-wider" style="color:${GOLD}">${esc(wd)}</span>
        <span class="text-[22px] font-bold leading-none">${d.getDate()}</span>
      </div>
      <div class="min-w-0 flex flex-col gap-0.5">
        <span class="font-bold text-sm text-[#1B2433] leading-snug">${esc(cap(p.title))}${p.is_special ? ` <span class="text-[11px] rounded-full bg-amber-100 text-amber-800 px-1.5 py-0.5 align-middle">${esc(tx('special'))}</span>` : ''}</span>
        ${p.description ? `<span class="text-[13px] text-[#5B6475] line-clamp-2">${esc(p.description)}</span>` : ''}
        ${p.flyer_url ? `<a href="${attr(p.flyer_url)}" target="_blank" rel="noopener" class="text-[13px] font-semibold underline" style="color:${NAVY}">${esc(tx('flyer'))}</a>` : ''}
      </div>
    </div>`;
  };
  return `<section class="pt-7 flex flex-col gap-3">
    <div class="px-5">${sectionTitle(tx('thisWeek'), toggle)}</div>
    <div class="${showAllProgram ? 'px-5 grid grid-cols-1 gap-2.5 [&>div]:w-auto' : 'flex gap-2.5 px-5 pb-1 overflow-x-auto snap-x'}">${shown.map(card).join('')}</div>
  </section>`;
}

function sermonSection() {
  const all = data?.sermons || [];
  if (!all.length) return '';
  const [first, ...rest] = all;
  const vid = youtubeId(first.video_url);
  const meta = [first.preacher, first.preached_on && new Date(`${first.preached_on}T12:00:00`).toLocaleDateString(locale(), { day: 'numeric', month: 'long' }), first.scripture].filter(Boolean).join(' · ');
  const buttons = (s, big) => `<div class="flex flex-wrap gap-2 ${big ? 'pt-2' : 'pt-1'}">
      ${s.video_url ? `<a href="${attr(s.video_url)}" target="_blank" rel="noopener" class="h-11 px-4 rounded-xl text-white text-sm font-semibold flex items-center gap-1.5" style="background:${NAVY}">${PLAY(14)} ${esc(tx('watch'))}</a>` : ''}
      ${s.audio_url ? `<a href="${attr(s.audio_url)}" target="_blank" rel="noopener" class="h-11 px-4 rounded-xl text-sm font-semibold flex items-center" style="background:#EEF2F8;color:${NAVY}">${esc(tx('listen'))}</a>` : ''}
      ${s.notes_url ? `<a href="${attr(s.notes_url)}" target="_blank" rel="noopener" class="h-11 px-4 rounded-xl text-sm font-semibold flex items-center" style="color:${NAVY}">${esc(tx('notes'))}</a>` : ''}
    </div>`;
  const toggle = rest.length ? `<button type="button" data-action="sermons" class="text-sm font-semibold" style="color:${NAVY}">${esc(showAllSermons ? tx('lessSermons') : tx('allSermons'))}</button>` : '';
  const others = showAllSermons ? rest.map((s) => `<div class="bg-white border border-[#E6E1D6] rounded-2xl p-4">
      <p class="m-0 font-bold text-[15px] text-[#1B2433]">${esc(s.title)}</p>
      <p class="m-0 text-[13px] text-[#5B6475]">${esc([s.preacher, s.preached_on && new Date(`${s.preached_on}T12:00:00`).toLocaleDateString(locale(), { day: 'numeric', month: 'long' })].filter(Boolean).join(' · '))}</p>
      ${buttons(s, false)}
    </div>`).join('') : '';
  return `<section class="px-5 pt-7 flex flex-col gap-3">
    ${sectionTitle(tx('latestSermon'), toggle)}
    <div class="bg-white border border-[#E6E1D6] rounded-[18px] overflow-hidden flex flex-col">
      ${vid ? `<a href="${attr(first.video_url)}" target="_blank" rel="noopener" class="relative block" style="background:#1B2B47;aspect-ratio:16/9">
        <img src="https://i.ytimg.com/vi/${encodeURIComponent(vid)}/hqdefault.jpg" alt="" class="absolute inset-0 w-full h-full object-cover" onerror="this.remove()">
        <span class="absolute inset-0 flex items-center justify-center"><span class="w-16 h-16 rounded-full bg-white/90 flex items-center justify-center" style="color:${NAVY}">${PLAY(26)}</span></span>
      </a>` : ''}
      <div class="p-4 flex flex-col gap-1.5">
        <p class="m-0 text-[17px] font-bold leading-snug text-[#1B2433]">${esc(first.title)}</p>
        ${meta ? `<p class="m-0 text-[13px] text-[#5B6475]">${esc(meta)}</p>` : ''}
        ${first.summary ? `<p class="m-0 text-sm text-[#5B6475]">${esc(first.summary)}</p>` : ''}
        ${buttons(first, true)}
      </div>
    </div>
    ${others}
  </section>`;
}

function eventsSection() {
  const list = data?.events || [];
  if (!list.length) return '';
  const fmt = (iso) => new Date(iso).toLocaleString(locale(), { weekday: 'short', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });
  const price = (c) => (c ? new Intl.NumberFormat(locale(), { style: 'currency', currency: 'CAD' }).format(c / 100) : tx('free'));
  return `<section class="px-5 pt-7 flex flex-col gap-3">
    ${sectionTitle(tx('events'))}
    ${list.map((e) => `<div class="bg-white border border-[#E6E1D6] rounded-2xl p-4 flex items-center justify-between gap-3">
      <div class="min-w-0 flex flex-col gap-0.5">
        <span class="font-bold text-[15px] text-[#1B2433]">${esc(e.title)}</span>
        <span class="text-[13px] text-[#5B6475] first-letter:uppercase">${esc([fmt(e.start_at), e.location, price(e.price_cents)].filter(Boolean).join(' · '))}</span>
      </div>
      <a href="event.html?event=${encodeURIComponent(e.id)}" class="shrink-0 h-11 px-4 rounded-xl text-white text-sm font-semibold flex items-center" style="background:${NAVY}">${esc(tx('register'))}</a>
    </div>`).join('')}
  </section>`;
}

function findUs(church) {
  const social = church?.social || {};
  const SOCIAL = [['facebook', 'Facebook'], ['youtube', 'YouTube'], ['instagram', 'Instagram'], ['tiktok', 'TikTok'], ['whatsapp', 'WhatsApp'], ['website', tx('website')]];
  const chips = SOCIAL.filter(([k]) => social[k]).map(([k, label]) => `<a href="${attr(social[k])}" target="_blank" rel="noopener" class="h-11 px-3.5 rounded-full bg-white border border-[#E6E1D6] text-sm font-semibold text-[#1B2433] flex items-center hover:border-[#E0B654]">${esc(label)}</a>`).join('');
  const contact = [church?.phone, church?.email].filter(Boolean).join(' · ');
  const tel = church?.phone ? church.phone.replace(/[^\d+]/g, '') : '';
  if (!church?.address && !contact && !chips) return '';
  return `<section class="px-5 pt-7 flex flex-col gap-3">
    ${sectionTitle(tx('findUs'))}
    ${church?.address || contact ? `<div class="bg-white border border-[#E6E1D6] rounded-2xl p-4 flex flex-col gap-3">
      <div class="flex flex-col gap-1">
        ${church?.address ? `<span class="font-bold text-[15px] text-[#1B2433]">${esc(church.address)}</span>` : ''}
        ${contact ? `<span class="text-sm text-[#5B6475]">${esc(contact)}</span>` : ''}
      </div>
      <div class="grid grid-cols-2 gap-2">
        ${church?.address ? `<a href="https://maps.google.com/?q=${encodeURIComponent(church.address)}" target="_blank" rel="noopener" class="h-11 rounded-xl text-white text-sm font-semibold flex items-center justify-center" style="background:${NAVY}">${esc(tx('directions'))}</a>` : ''}
        ${tel ? `<a href="tel:${attr(tel)}" class="h-11 rounded-xl text-sm font-semibold flex items-center justify-center" style="background:#EEF2F8;color:${NAVY}">${esc(tx('call'))}</a>`
          : church?.email ? `<a href="mailto:${attr(church.email)}" class="h-11 rounded-xl text-sm font-semibold flex items-center justify-center" style="background:#EEF2F8;color:${NAVY}">${esc(tx('email'))}</a>` : ''}
      </div>
    </div>` : ''}
    ${chips ? `<p class="mt-2 mb-0 text-[13px] font-semibold text-[#5B6475]">${esc(tx('follow'))}</p><div class="flex flex-wrap gap-2">${chips}</div>` : ''}
  </section>`;
}

function footer() {
  return `<footer class="mt-8 px-5 pt-6 pb-28 border-t border-[#E6E1D6] flex flex-col gap-2.5 items-center text-center">
    <p class="m-0 text-sm text-[#1B2433]">${esc(tx('already'))} <a href="index.html?signin=1" class="font-bold underline" style="color:${NAVY}">${esc(tx('signIn'))}</a> · <a href="index.html?signup=1" class="font-bold underline" style="color:${NAVY}">${esc(tx('createAccount'))}</a></p>
    <p class="m-0 text-xs text-[#5B6475] flex items-center gap-1.5">${icon('lock', 14)} ${esc(tx('privacy'))}</p>
  </footer>`;
}

function bottomBar() {
  const isLive = !!liveState?.live;
  const item = (href, ic, label, color, bold) => `<a href="${attr(href)}" class="h-[52px] rounded-xl flex flex-col items-center justify-center gap-1 text-xs ${bold ? 'font-bold' : 'font-semibold'}" style="color:${color}">${icon(ic, 22)}${esc(label)}</a>`;
  return `<nav aria-label="Raccourcis" class="fixed left-0 right-0 bottom-0 z-40 bg-white border-t border-[#E6E1D6] px-3 pt-2 pb-[max(14px,env(safe-area-inset-bottom))]">
    <div class="max-w-[480px] mx-auto grid grid-cols-3 gap-1.5">
      ${liveState?.configured ? item('live.html', 'video', tx('navLive'), isLive ? LIVE_RED : NAVY, isLive) : item(`guest-checkin.html?d=${todayLocal()}`, 'userPlus', tx('newHere'), NAVY, false)}
      ${item('give.html', 'heart', tx('navGive'), NAVY, false)}
      ${item('prayer.html', 'prayer', tx('navPrayer'), NAVY, false)}
    </div>
  </nav>`;
}

// ---------- render ----------
function render() {
  document.documentElement.lang = lang;
  const root = document.getElementById('welcome-root');
  const church = data?.church || { name: 'La Voix de la Puissance Divine' };
  let body = header(church) + hero(church) + mainActions() + helpGrid();
  if (data) {
    body += programSection() + sermonSection() + eventsSection() + findUs(church);
  } else {
    body += `<p class="px-5 pt-8 text-sm text-[#5B6475]">${loading ? '…' : esc(tx('error'))}</p>`;
  }
  body += footer();
  root.innerHTML = body;
  document.getElementById('welcome-bar').innerHTML = bottomBar();
  bind();
}

function bind() {
  const root = document.getElementById('welcome-root');
  root.querySelector('[data-action="lang"]')?.addEventListener('click', () => {
    lang = lang === 'fr' ? 'en' : 'fr';
    try { localStorage.setItem(LANG_KEY, lang); } catch { /* storage blocked */ }
    render();
  });
  root.querySelector('[data-action="program"]')?.addEventListener('click', () => { showAllProgram = !showAllProgram; render(); });
  root.querySelector('[data-action="sermons"]')?.addEventListener('click', () => { showAllSermons = !showAllSermons; render(); });
}

// The countdown ticks every second without re-rendering the page; the
// hero re-renders only when the phase changes (waiting -> starting -> live).
let lastPhase = null;
function phaseKey() {
  if (!liveState?.configured) return 'none';
  if (liveState.live) return `live:${liveState.video_id}`;
  const st = serviceState(liveState.schedule, liveState.timezone || 'America/Toronto');
  return `${st.state}:${st.next ? st.next.getTime() : ''}`;
}
function startTicking() {
  clearInterval(tick);
  lastPhase = phaseKey();
  tick = setInterval(() => {
    const key = phaseKey();
    if (key !== lastPhase) {
      const enteringStart = key.startsWith('starting') && !lastPhase.startsWith('starting');
      lastPhase = key;
      render();
      if (enteringStart) checkLive();
      return;
    }
    if (!liveState?.configured || liveState.live) return;
    const st = serviceState(liveState.schedule, liveState.timezone || 'America/Toronto');
    const el = document.querySelector('[data-el="countdown"]');
    if (el && st.next) el.innerHTML = countdownBoxes(st.next);
  }, 1000);
}

async function checkLive() {
  const next = await fetchLiveStatus();
  if (!next) return;
  const changed = JSON.stringify([liveState?.configured, liveState?.live, liveState?.video_id, liveState?.schedule]) !== JSON.stringify([next.configured, next.live, next.video_id, next.schedule]);
  liveState = next;
  if (changed) { render(); lastPhase = phaseKey(); }
}

async function main() {
  render();
  const portal = supabase.functions.invoke('public-portal', { body: {} })
    .then(({ data: result, error }) => { if (!error && result) data = result; })
    .catch(() => {});
  await Promise.all([portal, checkLive()]);
  loading = false;
  render();
  startTicking();
  setInterval(() => { if (document.visibilityState === 'visible') checkLive(); }, 60000);
  // Around service time, ask more often so "live now" appears quickly.
  setInterval(() => {
    if (document.visibilityState === 'visible' && liveState?.configured && !liveState.live
      && serviceState(liveState.schedule, liveState.timezone || 'America/Toronto').state === 'starting') checkLive();
  }, 20000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkLive(); });
}

main();
