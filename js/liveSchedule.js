// Regular live-service times (church_branding.live_schedule, e.g.
// Wednesday 19:00, Friday 18:30, Sunday 10:30 in America/Toronto) and
// the countdown to the next one. Times are interpreted in the church's
// time zone, whatever the time zone of the phone looking at the page.

// How long after the scheduled start we keep saying "starting now"
// while waiting for YouTube to report the stream as live.
export const STARTING_WINDOW_MS = 45 * 60 * 1000;

function zoneParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { y: get('year'), m: get('month') - 1, d: get('day'), h: get('hour'), mi: get('minute'), s: get('second') };
}

function offsetMs(date, timeZone) {
  const p = zoneParts(date, timeZone);
  return Date.UTC(p.y, p.m, p.d, p.h, p.mi, p.s) - Math.floor(date.getTime() / 1000) * 1000;
}

// Wall-clock time in `timeZone` -> real instant.
function zonedTime(y, m, d, h, mi, timeZone) {
  const guess = Date.UTC(y, m, d, h, mi);
  let off = offsetMs(new Date(guess), timeZone);
  off = offsetMs(new Date(guess - off), timeZone);
  return new Date(guess - off);
}

// Every scheduled start from yesterday to 8 days ahead, sorted.
function upcomingStarts(schedule, timeZone, now) {
  const today = zoneParts(now, timeZone);
  const out = [];
  for (let k = -1; k <= 8; k += 1) {
    const weekday = new Date(Date.UTC(today.y, today.m, today.d + k)).getUTCDay();
    for (const slot of schedule || []) {
      if (Number(slot.day) !== weekday || !/^\d{1,2}:\d{2}$/.test(slot.time || '')) continue;
      const [h, mi] = slot.time.split(':').map(Number);
      out.push(zonedTime(today.y, today.m, today.d + k, h, mi, timeZone));
    }
  }
  return out.sort((a, b) => a - b);
}

// { state: 'starting', start } when a service began less than
// STARTING_WINDOW_MS ago; otherwise { state: 'waiting', next } (next may
// be null when no schedule is set).
export function serviceState(schedule, timeZone = 'America/Toronto', now = new Date()) {
  const starts = upcomingStarts(schedule, timeZone, now);
  const recent = starts.filter((s) => s <= now && now - s < STARTING_WINDOW_MS).pop();
  if (recent) return { state: 'starting', start: recent };
  return { state: 'waiting', next: starts.find((s) => s > now) || null };
}

// "2 d 03 h 15 min" / "3 h 05 min 09 s" / "4 min 30 s"
export function formatCountdown(ms, lang) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  const dl = lang === 'fr' ? 'j' : 'd';
  if (d > 0) return `${d} ${dl} ${pad(h)} h ${pad(m)} min`;
  if (h > 0) return `${h} h ${pad(m)} min ${pad(s)} s`;
  return `${m} min ${pad(s)} s`;
}

// "mercredi 19 h 00" / "Wednesday 7:00 PM", shown in the church's time zone.
export function formatServiceTime(date, timeZone, lang) {
  return date.toLocaleString(lang === 'fr' ? 'fr-CA' : 'en-CA', { timeZone, weekday: 'long', hour: 'numeric', minute: '2-digit' });
}
