// PWA support: service-worker registration (installable app + offline
// reading, see sw.js), the home-screen app-icon badge counter (client-side
// Badging API), and the offline banner.

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').catch((err) => {
    console.error('Service worker registration failed:', err);
  });
}

export function setAppBadgeCount(count) {
  if (!('setAppBadge' in navigator)) return;
  if (count > 0) {
    navigator.setAppBadge(count).catch(() => {});
  } else {
    navigator.clearAppBadge?.().catch(() => {});
  }
}

// Saved Supabase reads belong to whoever was signed in. Wipe them on sign-out
// and whenever a different person signs in on this device.
const LAST_USER_KEY = 'cop_offline_user';
export function clearOfflineData() {
  try { localStorage.removeItem(LAST_USER_KEY); } catch { /* storage blocked */ }
  if (!('caches' in window)) return;
  caches.delete('cop-data-v1').catch(() => {});
  navigator.serviceWorker?.controller?.postMessage({ type: 'clear-data' });
}
export function noteSignedInUser(userId) {
  let last = null;
  try { last = localStorage.getItem(LAST_USER_KEY); } catch { /* storage blocked */ }
  if (last && last !== userId) clearOfflineData();
  try { localStorage.setItem(LAST_USER_KEY, userId); } catch { /* storage blocked */ }
}

// A thin bar at the top while the device is offline. text: () => string
// (called on every change so the current language is used).
export function initOfflineBanner(text) {
  let bar = null;
  const update = () => {
    if (navigator.onLine) { bar?.remove(); bar = null; return; }
    if (!bar) {
      bar = document.createElement('div');
      bar.setAttribute('role', 'status');
      bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#f59e0b;color:#1f2937;font:500 13px/1.4 system-ui,sans-serif;padding:6px 12px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.2)';
      document.body.appendChild(bar);
    }
    bar.textContent = text();
  };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}
