// Sermon video clips (sql/166): a sermon can point at a full livestream
// and say where the sermon starts and ends inside it. YouTube's embedded
// player honours both (?start=…&end=…), so members only see that part.
// Other links (Facebook, Vimeo…) open as they are.

// The video id of a YouTube link, or null. Handles watch?v=, youtu.be/,
// /live/, /embed/ and /shorts/ links.
export function youtubeId(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\.|^m\./, '');
    if (host === 'youtu.be') return clean(u.pathname.slice(1));
    if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'music.youtube.com') {
      if (u.searchParams.get('v')) return clean(u.searchParams.get('v'));
      const m = /^\/(?:live|embed|shorts|v)\/([^/?#]+)/.exec(u.pathname);
      if (m) return clean(m[1]);
    }
  } catch { /* not a URL */ }
  return null;
}
function clean(id) {
  return /^[A-Za-z0-9_-]{6,20}$/.test(id || '') ? id : null;
}

// "1:05:30", "65:30", "3930", "1h05m30s", "1h5", "65m" -> seconds, or
// null when empty, or NaN when it can't be read.
export function parseTime(text) {
  const v = String(text || '').trim().toLowerCase().replace(/\s+/g, '');
  if (!v) return null;
  if (/^\d+$/.test(v)) return Number(v);
  if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(v)) {
    return v.split(':').map(Number).reduce((acc, n) => acc * 60 + n, 0);
  }
  const m = /^(?:(\d+)h)?(?:(\d+)m(?:in)?)?(?:(\d+)s?)?$/.exec(v);
  if (m && (m[1] || m[2] || m[3])) {
    // "1h5" means 1 h 05 min; a lone trailing number after h is minutes.
    const h = Number(m[1] || 0);
    let mi = Number(m[2] || 0);
    let s = Number(m[3] || 0);
    if (m[1] && !m[2] && m[3] && !v.endsWith('s')) { mi = s; s = 0; }
    return h * 3600 + mi * 60 + s;
  }
  return NaN;
}

// 3930 -> "1:05:30", 930 -> "15:30"
export function formatTime(sec) {
  if (sec == null || Number.isNaN(sec)) return '';
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(r)}` : `${m}:${p(r)}`;
}

// Start time already written in a pasted link (?t=3930, &t=1h5m30s,
// ?start=3930), so pasting "share at current time" fills Start for you.
export function startFromLink(url) {
  try {
    const u = new URL(url);
    const t = u.searchParams.get('t') || u.searchParams.get('start');
    if (!t) return null;
    const sec = parseTime(t);
    return Number.isFinite(sec) ? sec : null;
  } catch { return null; }
}

// Embedded player limited to the sermon.
export function clipEmbedUrl(id, start, end, { autoplay = true } = {}) {
  const q = new URLSearchParams({ rel: '0', playsinline: '1', modestbranding: '1' });
  if (Number.isFinite(start) && start > 0) q.set('start', String(start));
  if (Number.isFinite(end) && end > 0) q.set('end', String(end));
  if (autoplay) q.set('autoplay', '1');
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?${q}`;
}

// Link for "open on YouTube": jumps to the sermon start (YouTube's own
// page can't stop at the end, the embedded player above can).
export function clipWatchUrl(url, start) {
  const id = youtubeId(url);
  if (!id) return url;
  return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}${Number.isFinite(start) && start > 0 ? `&t=${start}s` : ''}`;
}

// Loads YouTube's IFrame API once (used by the editor's "mark start /
// mark end here" buttons, which need the player's current time).
let ytApi = null;
export function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (ytApi) return ytApi;
  ytApi = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT); };
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.onerror = () => { ytApi = null; reject(new Error('YouTube unavailable')); };
    document.head.appendChild(tag);
    setTimeout(() => { if (!window.YT?.Player) { ytApi = null; reject(new Error('YouTube unavailable')); } }, 10000);
  });
  return ytApi;
}

// Full-page player for people outside the app (guest page): the embed
// page itself, which also stops at the end.
export function clipPageUrl(url, start, end) {
  const id = youtubeId(url);
  if (!id) return url;
  return clipEmbedUrl(id, start, end).replace('youtube-nocookie.com', 'youtube.com');
}
