// Detects when a newer deploy has landed on the server while this tab
// is still open. sw.js is deliberately network-only (no caching), so
// there's no stale service-worker cache to blame — the tab just keeps
// running whatever JS it already loaded until something tells it to
// reload. version.txt is now a small JSON payload (see
// parseVersionInfo() below) that gets rewritten on every push to
// main; this polls it periodically and reacts the moment it changes
// from what this tab started with.
//
// A critical/security deploy (critical:true) behaves exactly as
// before -- a brief toast, then an automatic reload, no choice offered
// (this matters: some churches would otherwise keep running a broken
// or unsafe version indefinitely). A normal feature deploy instead
// shows a small pop-up explaining what's new, with Update Now / Later
// / Refuse -- the latter two both just mean "not now" (there's no way
// to actually stay pinned to an old version in this single-static-
// site model; a later reload for any reason picks it up anyway), and
// only stop nagging for that exact version for the rest of this tab's
// session, not forever.
//
// Deliberately NOT also checked on visibilitychange (an earlier
// version re-checked the instant the tab regained focus) — switching
// away to another tab/app and back must never itself trigger a
// reload, even if a deploy happened while you were gone; the regular
// interval still catches it, just not timed to the exact moment you
// return mid-task.
import { t, getLang } from './i18n.js';
import { isProjectionPanelMounted } from './utils/projectionGuard.js';
import { hasUnsavedWork } from './utils/unsavedWorkGuard.js';

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const VERSION_URL = 'version.txt';

let loadedVersion = null;
let reloading = false;
let modalOpen = false;
let lastDismissedVersion = null;

export async function initVersionCheck() {
  const info = await fetchVersionInfo();
  if (info === null) return; // couldn't determine a baseline — don't false-positive later
  loadedVersion = info.version;

  setInterval(checkForUpdate, POLL_INTERVAL_MS);
}

async function fetchVersionInfo() {
  try {
    const res = await fetch(`${VERSION_URL}?_=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return parseVersionInfo((await res.text()).trim());
  } catch {
    return null;
  }
}

// A deploy before this format change wrote a bare ISO timestamp with
// no structure at all -- treated as critical with no notes. Fail-safe
// on purpose: a deploy script that was never updated to the new JSON
// shape must never silently stop updating people.
function parseVersionInfo(text) {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.version === 'string') {
      return { version: parsed.version, critical: !!parsed.critical, notes: parsed.notes || {} };
    }
  } catch {
    // Not JSON -- an old plain-timestamp deploy. Fall through below.
  }
  return { version: text, critical: true, notes: {} };
}

async function checkForUpdate() {
  if (reloading || modalOpen) return;
  // Never yank the Projection page, or any other open editor with
  // live/unsaved work (e.g. the Flyer editor), out from under whoever's
  // using it — a forced reload loses whatever's only in memory. Just
  // keep checking; the moment they leave, the next poll (at most
  // POLL_INTERVAL_MS later) picks the update back up.
  if (isProjectionPanelMounted() || hasUnsavedWork()) return;

  const info = await fetchVersionInfo();
  if (info === null || info.version === loadedVersion) return;

  if (info.critical) {
    reloading = true;
    showUpdateToastThenReload();
    return;
  }

  if (info.version === lastDismissedVersion) return;
  showUpdateModal(info);
}

function showUpdateToastThenReload() {
  const toast = document.createElement('div');
  toast.className = 'fixed bottom-4 left-1/2 -translate-x-1/2 z-[200] bg-slate-900 text-white text-sm px-4 py-2.5 rounded-lg shadow-lg';
  toast.textContent = t('app.updatingNotice');
  document.body.appendChild(toast);
  setTimeout(() => window.location.reload(), 2000);
}

function showUpdateModal(info) {
  modalOpen = true;
  const notes = info.notes[getLang()] || info.notes.en || [];

  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
      <h2 class="text-lg font-bold text-slate-800 mb-2">${t('app.updateAvailableTitle')}</h2>
      ${notes.length ? `<ul class="text-sm text-slate-600 mb-4 space-y-1 list-disc pl-5">${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul>` : ''}
      <div class="flex items-center gap-2 flex-wrap">
        <button type="button" data-action="now" class="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">${t('app.updateNow')}</button>
        <button type="button" data-action="later" class="px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">${t('app.updateLater')}</button>
        <button type="button" data-action="refuse" class="px-3 py-2 rounded-lg text-sm font-medium text-slate-400 hover:bg-slate-100">${t('app.updateRefuse')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  root.querySelector('[data-action="now"]').addEventListener('click', () => {
    reloading = true;
    window.location.reload();
  });

  const dismiss = () => {
    lastDismissedVersion = info.version;
    modalOpen = false;
    root.remove();
  };
  root.querySelector('[data-action="later"]').addEventListener('click', dismiss);
  root.querySelector('[data-action="refuse"]').addEventListener('click', dismiss);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
