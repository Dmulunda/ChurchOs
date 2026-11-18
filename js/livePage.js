// Entry point for live.html: the church's live service page. Shows the
// YouTube player as soon as the channel goes live (checked every 60
// seconds), the start time when a stream is scheduled, and otherwise
// the next program date and a link to past services. Public page, no
// account needed; nothing about members is read.
import { supabase } from './supabaseClient.js';
import { fetchLiveStatus, youtubeEmbedUrl, youtubeWatchUrl } from './liveStatus.js';
import { serviceState, formatCountdown, formatServiceTime, slotFor, placeLabel } from './liveSchedule.js';

const LANG_KEY = 'choir-hub-lang';
const TEXT = {
  en: {
    live: 'LIVE NOW', liveTitle: 'Join us live', upcoming: 'Starting soon', upcomingAt: 'Starts {time}',
    offline: "We're not live right now", offlineSub: 'This page updates by itself: leave it open and the service will appear as soon as we go live.',
    nextLive: 'Next live service', countdown: 'The live starts in', starting: 'The service is starting', startingSub: 'The live stream will appear here in a moment. No need to reload.',
    next: 'Next on the program', openYoutube: 'Open in YouTube', channel: 'Watch past services on YouTube',
    share: 'Share', copied: 'Link copied', back: '← Church home', backShort: 'Back', notSet: 'The live channel has not been set up yet.',
    langSwitch: 'FR',
  },
  fr: {
    live: 'EN DIRECT', liveTitle: 'Suivez-nous en direct', upcoming: 'Bientôt en direct', upcomingAt: 'Début {time}',
    offline: "Nous ne sommes pas en direct pour l'instant", offlineSub: "Cette page se met à jour toute seule : laissez-la ouverte, le culte apparaîtra dès le début du direct.",
    nextLive: 'Prochain direct', countdown: 'Le direct commence dans', starting: 'Le culte commence', startingSub: "Le direct va apparaître ici dans un instant. Inutile de recharger.",
    next: 'Prochainement au programme', openYoutube: 'Ouvrir dans YouTube', channel: 'Revoir les cultes sur YouTube',
    share: 'Partager', copied: 'Lien copié', back: "← Accueil de l'église", backShort: 'Retour', notSet: "La chaîne du direct n'est pas encore configurée.",
    langSwitch: 'EN',
  },
};
let lang = (() => {
  try { const v = localStorage.getItem(LANG_KEY); if (v === 'en' || v === 'fr') return v; } catch { /* storage blocked */ }
  return (navigator.language || '').toLowerCase().startsWith('en') ? 'en' : 'fr';
})();
const tx = (k, vars = {}) => (TEXT[lang][k] ?? TEXT.en[k]).replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? '');
const locale = () => (lang === 'fr' ? 'fr-CA' : 'en-CA');
function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
const attr = (s) => esc(s).replace(/"/g, '&quot;');

// Program titles are often typed in capitals: show them in sentence case.
function cap(v) {
  const t = String(v || '');
  if (t !== t.toUpperCase()) return t;
  const lower = t.toLocaleLowerCase(locale());
  return lower.charAt(0).toLocaleUpperCase(locale()) + lower.slice(1);
}

let status = null;
let nextProgram = null;
let churchAddress = null;
let shownVideo = null;

function player(videoId) {
  return `<div class="relative w-full overflow-hidden rounded-2xl bg-black shadow-2xl" style="padding-top:56.25%">
    <iframe class="absolute inset-0 w-full h-full" src="${attr(youtubeEmbedUrl(videoId))}" title="YouTube" frameborder="0"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>
  </div>`;
}

function render() {
  document.documentElement.lang = lang;
  const root = document.getElementById('live-root');
  const header = `<header class="flex items-center justify-between gap-3 py-3.5">
      <a href="welcome.html" data-action="back" class="h-11 px-3.5 rounded-full bg-white/10 hover:bg-white/20 text-white text-sm font-semibold inline-flex items-center gap-1.5">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"></path></svg>${esc(tx('backShort'))}
      </a>
      <div class="flex items-center gap-2">
        <a href="welcome.html" class="bg-white rounded-xl px-2 py-1"><img src="img/vpd-logo.png" alt="La Voix de la Puissance Divine" class="h-[30px] block" /></a>
        <button type="button" data-action="lang" class="h-11 min-w-[44px] px-3 rounded-full border border-white/35 text-[13px] font-semibold">${esc(tx('langSwitch'))}</button>
      </div>
    </header>`;

  let body;
  if (!status) {
    body = '<p class="text-slate-300">…</p>';
  } else if (!status.configured) {
    body = `<p class="text-slate-300">${esc(tx('notSet'))}</p>`;
  } else if (status.live && status.video_id) {
    const badge = status.live
      ? `<span class="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold tracking-wider" style="background:#C81E1E"><span class="h-2.5 w-2.5 rounded-full bg-white animate-pulse"></span>${esc(tx('live'))}</span>`
      : `<span class="inline-flex items-center rounded-full bg-amber-400 text-[#0B1F3A] px-3 py-1 text-sm font-bold">${esc(tx('upcoming'))}</span>`;
    const when = status.upcoming && status.starts_at
      ? `<p class="text-amber-200 mt-1">${esc(tx('upcomingAt', { time: new Date(status.starts_at).toLocaleString(locale(), { weekday: 'long', hour: '2-digit', minute: '2-digit' }) }))}</p>` : '';
    body = `${badge}
      <h1 class="text-[28px] leading-tight font-bold mt-3" style="font-family:Fraunces,Georgia,serif">${esc(status.title || tx('liveTitle'))}</h1>${when}
      <div class="mt-4">${player(status.video_id)}</div>
      <div class="flex flex-wrap gap-2 mt-4">
        <a href="${attr(youtubeWatchUrl(status.video_id))}" target="_blank" rel="noopener" class="h-11 px-4 rounded-xl bg-white text-[#0B1F3A] font-bold text-sm inline-flex items-center">${esc(tx('openYoutube'))}</a>
        <button type="button" data-action="share" class="h-11 px-4 rounded-xl border border-white/40 text-sm font-semibold">${esc(tx('share'))}</button>
        <span data-el="share-msg" class="text-sm text-emerald-300 self-center"></span>
      </div>`;
  } else {
    const tz = status.timezone || 'America/Toronto';
    const st = serviceState(status.schedule, tz);
    const top = st.state === 'starting'
      ? `<p class="text-5xl">⏳</p>
         <h1 class="text-[26px] leading-tight font-bold mt-2" style="font-family:Fraunces,Georgia,serif">${esc(tx('starting'))}</h1>
         <p class="text-sm text-slate-300 mt-2">${esc(tx('startingSub'))}</p>`
      : st.next
        ? `<p class="text-xs uppercase tracking-widest text-[#E0B654] font-semibold">${esc(tx('nextLive'))}</p>
           <p class="text-xl font-bold mt-1 first-letter:uppercase" style="font-family:Fraunces,Georgia,serif">${esc(formatServiceTime(st.next, tz, lang))}</p>
           ${placeLabel(slotFor(status.schedule, st.next, tz), churchAddress, lang) ? `<p class="text-sm text-[#E0B654] mt-1">${esc(placeLabel(slotFor(status.schedule, st.next, tz), churchAddress, lang))}</p>` : ''}
           <p class="text-sm text-slate-300 mt-4">${esc(tx('countdown'))}</p>
           <p data-el="countdown" class="text-4xl font-bold tabular-nums mt-1">${esc(formatCountdown(st.next - Date.now(), lang))}</p>
           <p class="text-xs text-slate-400 mt-4">${esc(tx('offlineSub'))}</p>`
        : `<p class="text-4xl">📺</p><h1 class="text-[24px] leading-tight font-bold mt-2" style="font-family:Fraunces,Georgia,serif">${esc(tx('offline'))}</h1><p class="text-sm text-slate-300 mt-2">${esc(tx('offlineSub'))}</p>`;
    const next = nextProgram ? `<div class="mt-6 rounded-2xl bg-white/10 p-4">
        <p class="text-xs uppercase tracking-widest text-[#E0B654] font-semibold">${esc(tx('next'))}</p>
        <p class="font-semibold mt-1">${esc(cap(nextProgram.title))}</p>
        <p class="text-sm text-slate-300 first-letter:uppercase">${esc(new Date(`${nextProgram.date}T12:00:00`).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' }))}${nextProgram.description ? ` · ${esc(nextProgram.description)}` : ''}</p>
      </div>` : '';
    body = `<div class="rounded-2xl bg-white/5 border border-white/10 p-6 text-center">
        ${top}
        <a href="${attr(status.channel_url || '#')}" target="_blank" rel="noopener" class="inline-flex items-center mt-5 h-11 px-4 rounded-xl bg-white text-[#0B1F3A] font-bold text-sm">${esc(tx('channel'))}</a>
      </div>${next}`;
  }
  root.innerHTML = header + body;
  shownVideo = status && status.live ? status.video_id : null;

  root.querySelector('[data-action="back"]').addEventListener('click', (e) => {
    try {
      if (document.referrer && new URL(document.referrer).origin === location.origin && history.length > 1) { e.preventDefault(); history.back(); }
    } catch { /* follow the link */ }
  });
  root.querySelector('[data-action="lang"]').addEventListener('click', () => {
    lang = lang === 'fr' ? 'en' : 'fr';
    try { localStorage.setItem(LANG_KEY, lang); } catch { /* storage blocked */ }
    render();
  });
  root.querySelector('[data-action="share"]')?.addEventListener('click', async () => {
    const url = location.origin + location.pathname;
    try {
      if (navigator.share) await navigator.share({ title: document.title, url });
      else { await navigator.clipboard.writeText(url); root.querySelector('[data-el="share-msg"]').textContent = tx('copied'); }
    } catch { /* share sheet closed */ }
  });
}

let lastPhase = null;
setInterval(() => {
  if (!status || !status.configured || status.live) return;
  const st = serviceState(status.schedule, status.timezone || 'America/Toronto');
  const phase = st.state + (st.next ? st.next.getTime() : '');
  if (phase !== lastPhase) {
    const wasStarting = lastPhase && lastPhase.startsWith('starting');
    lastPhase = phase;
    render();
    if (st.state === 'starting' && !wasStarting) refresh();
    return;
  }
  const el = document.querySelector('[data-el="countdown"]');
  if (el && st.next) el.textContent = formatCountdown(st.next - Date.now(), lang);
}, 1000);

async function refresh() {
  const next = await fetchLiveStatus();
  if (!next) return;
  const changed = !status || next.live !== status.live || next.upcoming !== status.upcoming || next.video_id !== shownVideo || next.configured !== status.configured;
  status = next;
  // Re-render only when something changed, so a playing video is never reloaded.
  if (changed) render();
}

async function main() {
  render();
  const portal = supabase.functions.invoke('public-portal', { body: {} }).then(({ data }) => { nextProgram = data?.program?.[0] || null; churchAddress = data?.church?.address || null; }).catch(() => {});
  await Promise.all([refresh(), portal]);
  render();
  setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 60000);
  // Around service time, ask more often so the stream appears quickly.
  setInterval(() => {
    if (document.visibilityState === 'visible' && status?.configured && !status.live
      && serviceState(status.schedule, status.timezone || 'America/Toronto').state === 'starting') refresh();
  }, 20000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
}

main();
