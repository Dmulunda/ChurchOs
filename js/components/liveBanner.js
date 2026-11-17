// Red "we're live" bar at the top of the member app while the church's
// YouTube channel is streaming (live-status edge function, checked every
// 2 minutes while the app is open and visible). Tapping it opens
// live.html. Hidden again when the stream ends; members can close it
// for the current stream.
import { fetchLiveStatus } from '../liveStatus.js';
import { t, onLangChange } from '../i18n.js';

const DISMISS_KEY = 'vpd-live-banner-dismissed';
let started = false;
let state = null;
let bar = null;

function render() {
  const main = document.querySelector('main');
  const show = state && (state.live || state.upcoming) && state.video_id
    && (() => { try { return localStorage.getItem(DISMISS_KEY) !== state.video_id; } catch { return true; } })();
  if (!show) { bar?.remove(); bar = null; return; }
  if (!main) return;
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'mb-4';
    main.prepend(bar);
  }
  bar.innerHTML = `
    <div class="flex items-center gap-3 rounded-xl ${state.live ? 'bg-red-600' : 'bg-amber-500'} text-white px-4 py-3 shadow">
      <span class="relative flex h-3 w-3 shrink-0">${state.live ? '<span class="absolute inline-flex h-full w-full rounded-full bg-white opacity-75 animate-ping"></span>' : ''}<span class="relative inline-flex h-3 w-3 rounded-full bg-white"></span></span>
      <a href="live.html" class="min-w-0 flex-1">
        <span class="block font-semibold">${state.live ? t('live.bannerLive') : t('live.bannerSoon')}</span>
        <span class="block text-sm opacity-90 truncate"></span>
      </a>
      <a href="live.html" class="shrink-0 rounded-lg bg-white/20 px-3 py-1.5 text-sm font-semibold">${t('live.watch')}</a>
      <button type="button" aria-label="${t('live.close')}" class="shrink-0 text-xl leading-none opacity-80 hover:opacity-100">&times;</button>
    </div>`;
  bar.querySelector('.truncate').textContent = state.title || '';
  bar.querySelector('button').addEventListener('click', () => {
    try { localStorage.setItem(DISMISS_KEY, state.video_id); } catch { /* storage blocked */ }
    bar.remove(); bar = null;
  });
}

async function check() {
  const next = await fetchLiveStatus();
  if (!next) return;
  state = next;
  render();
}

export function initLiveBanner() {
  if (started) return;
  started = true;
  check();
  setInterval(() => { if (document.visibilityState === 'visible') check(); }, 120000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  onLangChange?.(() => render());
}
