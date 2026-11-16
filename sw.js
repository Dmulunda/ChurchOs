// Service worker: installable app + offline reading (feature 11).
//
// Strategy is NETWORK-FIRST everywhere, so a new deploy is never hidden
// behind a stale cache: when the network answers, that answer is used and
// saved; only when the network fails (offline, dead Wi-Fi in the church
// basement) is the last saved copy served. Writes are never cached or
// replayed -- offline, saving fails with an error and the offline banner
// (js/pwa.js) tells people why.
//
// What is saved:
//   * this site's own files (pages, JS, CSS, images) -- SHELL cache
//   * the CDN libraries the app loads (Tailwind, supabase-js, ...) -- SHELL
//   * the signed-in person's Supabase reads -- DATA cache: GET /rest/v1/...,
//     GET /auth/v1/user, and POST /rest/v1/rpc/<name> only for read-only
//     helper functions (is_*, can_*, get_* -- never *create*, *claim*,
//     *issue*). The DATA cache is wiped on sign-out and when a different
//     person signs in on the same device (js/pwa.js -> 'clear-data').
//
// Not intercepted at all (browser handles natively, as before): every other
// cross-origin request, including direct-to-R2 video uploads whose XHR
// progress events break if a service worker sits in the middle.

const SHELL = 'cop-shell-v1';
const DATA = 'cop-data-v1';
const PRECACHE = ['app.html', 'offline.html', 'manifest.json', 'img/icons/icon-192.png'];
const CDN_HOSTS = new Set(['cdn.tailwindcss.com', 'cdn.jsdelivr.net']);
const READ_RPC = /^(is|can|get)_[a-z0-9_]+$/;
const UNSAFE_RPC = /(create|claim|issue|generate|record|send|checkin|checkout)/;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('cop-') && k !== SHELL && k !== DATA).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'clear-data') event.waitUntil(caches.delete(DATA));
});

function isSupabase(url) {
  return url.hostname.endsWith('.supabase.co');
}

async function networkFirst(request, cacheName, cacheKey) {
  const key = cacheKey || request;
  try {
    const response = await fetch(request);
    if (response && (response.ok || response.type === 'opaque')) {
      const copy = response.clone();
      caches.open(cacheName).then((c) => c.put(key, copy)).catch(() => {});
    }
    return response;
  } catch (err) {
    const cached = await caches.match(key, { cacheName });
    if (cached) return cached;
    if (request.mode === 'navigate') {
      return (await caches.match('app.html', { cacheName: SHELL, ignoreSearch: true }))
        || (await caches.match('offline.html', { cacheName: SHELL }))
        || Response.error();
    }
    throw err;
  }
}

async function rpcKey(request) {
  const body = await request.clone().text();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return new Request(`${request.url}?__body=${hash}`);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.headers.has('range')) return;

  if (url.origin === self.location.origin) {
    if (request.method !== 'GET') return;
    if (url.pathname.endsWith('/version.txt')) return; // versionCheck must always see the network
    event.respondWith(networkFirst(request, SHELL));
    return;
  }

  if (request.method === 'GET' && CDN_HOSTS.has(url.hostname)) {
    event.respondWith(networkFirst(request, SHELL));
    return;
  }

  if (isSupabase(url)) {
    if (request.method === 'GET' && (url.pathname.startsWith('/rest/v1/') || url.pathname === '/auth/v1/user')) {
      event.respondWith(networkFirst(request, DATA));
      return;
    }
    const rpc = /^\/rest\/v1\/rpc\/([a-z0-9_]+)$/.exec(url.pathname);
    if (request.method === 'POST' && rpc && READ_RPC.test(rpc[1]) && !UNSAFE_RPC.test(rpc[1])) {
      event.respondWith(rpcKey(request).then((key) => networkFirst(request, DATA, key)));
    }
  }
});

// Web Push — see js/pushNotifications.js (subscribe) and
// supabase/functions/send-push (send). Displays whatever the payload says.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* non-JSON payload — show with defaults */ }

  event.waitUntil(self.registration.showNotification(data.title || 'ChurchOnPoint', {
    body: data.body || '',
    icon: 'img/icons/icon-192.png',
    badge: 'img/icons/icon-192.png',
    data: { url: data.url || './' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || './';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsList) => {
      for (const client of clientsList) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});
