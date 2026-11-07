// Standalone projection display (projector.html) — meant to be opened
// in its own window/tab and dragged onto whichever screen is
// connected to the physical projector, while the operator keeps
// working from the main app on their own screen. Pure BroadcastChannel
// listener — no auth, no DB reads, no network at all, just whatever
// the operator panel (js/components/projectionControl.js) last sent
// to this same browser. See js/utils/projection.js for the shared
// channel name/message shapes.
import { createProjectionChannel } from './utils/projection.js';
import { loadYouTubeIframeAPI } from './utils/youtube.js';

const backdropEl = document.getElementById('backdrop');
const linesEl = document.getElementById('lines');
const referenceEl = document.getElementById('reference');
const imageEl = document.getElementById('image-slide');
const videoContainerEl = document.getElementById('video-container');
const idleEl = document.getElementById('idle');
const exitFullscreenBtn = document.getElementById('exit-fullscreen-btn');
const countdownContainerEl = document.getElementById('countdown-container');
const countdownTextEl = document.getElementById('countdown-text');
const countdownClockEl = document.getElementById('countdown-clock');
const presentationSlideEl = document.getElementById('presentation-slide');

// Enters fullscreen immediately on load — no "click to enter" prompt,
// since that's one more distraction/manual step during a live
// service. Fullscreen normally requires a user gesture, but a window
// opened via window.open() from a genuine click (the operator's "Open
// Projector Screen" button) inherits that activation in every browser
// that matters here, so calling this straight from page load works.
//
// This used to try a multi-screen-specific `requestFullscreen({
// screen })` first and fall back to a plain call if that failed --
// but a window's one-shot transient activation is spent by the FIRST
// attempt regardless of whether it actually succeeds, so a failing
// first try (that overload isn't universally supported, and a second
// getScreenDetails() permission check in this fresh window could
// itself eat into the same short activation window) silently burned
// the only shot, leaving the "safe" fallback nothing to use. The
// result: stuck non-fullscreen, needing a manual click on the
// browser's own maximize/fullscreen control -- which, on Windows,
// still leaves the taskbar showing, since only true Fullscreen API
// mode actually covers it. Multi-screen placement is already handled
// by window.open()'s own left/top/width/height (see
// projectionControl.js's "open-screen" handler), so by the time this
// runs the window already sits on the right screen -- a plain
// requestFullscreen() (no `screen` option, one attempt) fullscreens
// exactly that screen.
async function enterFullscreen() {
  try {
    await document.documentElement.requestFullscreen();
  } catch {
    // Denied — leave it non-fullscreen rather than stuck with no content.
  }
}

enterFullscreen();
// Belt-and-suspenders: if the automatic attempt above still got denied
// for some browser/version-specific reason, the very first interaction
// with this window (dragging it onto the projector, or just clicking
// anywhere) carries its own fresh activation, so this quietly finishes
// the job without needing a dedicated "click here" control.
document.addEventListener('pointerdown', () => {
  if (!document.fullscreenElement) enterFullscreen();
}, { once: true });
exitFullscreenBtn.addEventListener('click', () => document.exitFullscreen?.());
document.addEventListener('fullscreenchange', () => {
  document.body.classList.toggle('is-fullscreen', !!document.fullscreenElement);
  showControlsBriefly();
});

// The exit button/cursor only auto-hide after the mouse has been
// still for a bit (video-player style) — never permanently, so
// there's always a way back out just by moving the mouse. Esc also
// exits fullscreen on its own (that's the browser's doing, not this
// page's), but not everyone remembers that, hence the visible button.
let controlsIdleTimer = null;
function showControlsBriefly() {
  document.body.classList.remove('controls-idle');
  clearTimeout(controlsIdleTimer);
  controlsIdleTimer = setTimeout(() => document.body.classList.add('controls-idle'), 3000);
}
document.addEventListener('mousemove', showControlsBriefly);
showControlsBriefly();

let youtubePlayer = null; // current YT.Player instance, if a YouTube video is loaded
let fileVideoEl = null; // current <video> element, if a local file video is loaded
let currentVideoKind = null; // 'youtube' | 'file' | null — which of the two is active
let currentVideoObjectUrl = null; // revoked whenever replaced, so a long service doesn't leak memory
let currentImageObjectUrl = null; // same idea, for image slides
let currentBackdropObjectUrl = null; // same idea, for the background
let countdownIntervalId = null;
let currentPresentationObjectUrl = null;

// Projection themes (js/components/projectionThemeModal.js) -- one
// per category (songs/bible/media), kept here as a small cache the
// control panel pushes over via its own 'theme' broadcast (same idea
// as the backdrop below: persists across many shows until explicitly
// changed, not part of each individual 'show' payload). An explicit
// backdrop image (set via the toolbar) always wins over a theme's own
// background -- that's a deliberate per-service choice the operator
// made on top of whatever the default theme is.
const themes = { songs: null, bible: null, media: null };
let currentCategory = null;

function categoryForKind(kind) {
  if (kind === 'song') return 'songs';
  if (kind === 'bible') return 'bible';
  return 'media'; // image, video, presentation, countdown
}

function applyBackdrop() {
  if (currentBackdropObjectUrl) {
    backdropEl.style.background = '';
    backdropEl.style.backgroundImage = `url("${currentBackdropObjectUrl}")`;
    return;
  }
  backdropEl.style.backgroundImage = '';
  const theme = themes[currentCategory];
  backdropEl.style.background = theme ? theme.background_value : '';
}

function applyTextTheme(el, category) {
  const theme = themes[category];
  el.style.color = theme ? theme.text_color : '';
}

// The slider/theme's chosen size is the CEILING, not a fixed value —
// fitLinesToContainer() below shrinks it further, per slide, whenever
// that slide's actual line count/length would otherwise overflow
// #lines' box (most commonly a full 4-line song slide, songSlides.js's
// cap). It never grows past what was chosen, only shrinks on demand,
// so a short one-line verse still renders at the full chosen size.
function fontSizeFor(scale) {
  return 4 * (scale || 1); // vw, before any shrink-to-fit adjustment
}

// Mirrors js/components/projectionThemeModal.js's own preview copy of
// this same loop (scaled to that preview box's width instead of the
// viewport) -- keep both in sync if this changes.
function fitLinesToContainer() {
  let vw = parseFloat(linesEl.style.fontSize);
  let guard = 0;
  while (linesEl.scrollHeight > linesEl.clientHeight && vw > 1 && guard < 40) {
    vw *= 0.95;
    linesEl.style.fontSize = `${vw}vw`;
    guard += 1;
  }
}

function stopVideo() {
  // Hiding the container isn't enough — an unpaused <video> or YT
  // player keeps playing (and its audio keeps going) even while
  // display:none, so switching away from a video has to actually tear
  // it down, not just visually hide it.
  youtubePlayer?.destroy?.();
  youtubePlayer = null;
  fileVideoEl?.pause();
  fileVideoEl = null;
  currentVideoKind = null;
  if (currentVideoObjectUrl) { URL.revokeObjectURL(currentVideoObjectUrl); currentVideoObjectUrl = null; }
  videoContainerEl.innerHTML = '';
}

function stopCountdown() {
  if (countdownIntervalId) { clearInterval(countdownIntervalId); countdownIntervalId = null; }
  countdownContainerEl.style.display = 'none';
}

function hideAllContent() {
  linesEl.innerHTML = '';
  referenceEl.textContent = '';
  imageEl.style.display = 'none';
  if (currentImageObjectUrl) { URL.revokeObjectURL(currentImageObjectUrl); currentImageObjectUrl = null; }
  imageEl.src = '';
  videoContainerEl.style.display = 'none';
  stopVideo();
  stopCountdown();
  presentationSlideEl.style.display = 'none';
  presentationSlideEl.style.backgroundColor = '';
  presentationSlideEl.innerHTML = '';
  if (currentPresentationObjectUrl) { URL.revokeObjectURL(currentPresentationObjectUrl); currentPresentationObjectUrl = null; }
}

// The background persists across many different verses/songs until
// explicitly changed — it's its own broadcast event (see below), not
// part of each individual 'show' payload.
function setBackdrop(blob) {
  if (currentBackdropObjectUrl) { URL.revokeObjectURL(currentBackdropObjectUrl); currentBackdropObjectUrl = null; }
  currentBackdropObjectUrl = blob ? URL.createObjectURL(blob) : null;
  applyBackdrop();
}

function showText(payload) {
  hideAllContent();
  idleEl.style.display = 'none';
  currentCategory = categoryForKind(payload.kind);
  linesEl.style.fontSize = `${fontSizeFor(payload.fontScale)}vw`;
  linesEl.innerHTML = payload.lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('');
  referenceEl.textContent = payload.reference || '';
  applyTextTheme(linesEl, currentCategory);
  applyBackdrop();
  // Always make the chosen size fit -- a full 4-line slide (or a long
  // Bible verse) that would overflow at the requested size gets
  // shrunk back down until it does, rather than clipping.
  fitLinesToContainer();
}

function showImage(payload) {
  hideAllContent();
  idleEl.style.display = 'none';
  currentCategory = 'media';
  currentImageObjectUrl = URL.createObjectURL(payload.blob);
  imageEl.src = currentImageObjectUrl;
  imageEl.style.display = 'block';
  applyBackdrop();
}

async function handleVideo(payload) {
  // A pause/resume with nothing actually loaded means this page just
  // (re)connected with no player to pause/resume — a fresh reconnect
  // can't recover local-file video (the file itself only ever lived in
  // the operator's memory, and pause/resume messages don't carry it),
  // so this just goes idle instead of erroring; YouTube can still
  // reload itself from the videoId alone.
  const nothingLoaded = currentVideoKind === null;

  if (payload.action === 'pause' && !nothingLoaded) {
    if (currentVideoKind === 'youtube') youtubePlayer?.pauseVideo();
    else if (currentVideoKind === 'file') fileVideoEl?.pause();
    return;
  }
  if (payload.action === 'resume' && !nothingLoaded) {
    if (currentVideoKind === 'youtube') youtubePlayer?.playVideo();
    else if (currentVideoKind === 'file') fileVideoEl?.play();
    return;
  }
  if ((payload.action === 'pause' || payload.action === 'resume') && nothingLoaded) {
    if (payload.source === 'youtube') payload = { ...payload, action: 'play' };
    else return; // nothing we can do for a local file with no blob attached
  }

  // action === 'play' — load fresh.
  hideAllContent();
  idleEl.style.display = 'none';
  currentCategory = 'media';
  videoContainerEl.style.display = 'block';
  videoContainerEl.innerHTML = '';
  youtubePlayer = null;
  fileVideoEl = null;
  applyBackdrop();

  if (payload.source === 'youtube') {
    currentVideoKind = 'youtube';
    const mount = document.createElement('div');
    mount.id = 'yt-projector-player';
    videoContainerEl.appendChild(mount);
    const YT = await loadYouTubeIframeAPI();
    youtubePlayer = new YT.Player('yt-projector-player', {
      videoId: payload.videoId,
      playerVars: { autoplay: 1, rel: 0, controls: 0 },
      events: { onReady: (e) => e.target.playVideo() },
    });
  } else {
    currentVideoKind = 'file';
    currentVideoObjectUrl = URL.createObjectURL(payload.blob);
    fileVideoEl = document.createElement('video');
    fileVideoEl.src = currentVideoObjectUrl;
    fileVideoEl.autoplay = true;
    fileVideoEl.controls = false;
    videoContainerEl.appendChild(fileVideoEl);
  }
}

// endsAt is an absolute ISO timestamp, not a relative "seconds left"
// counter -- specifically so this is naturally correct even if THIS
// window reloads mid-countdown (the control panel's own `hello`
// reconnect handshake resends the same payload, same endsAt, and this
// just recomputes the remaining time from it rather than needing any
// special-cased recovery).
// The Media theme's font_scale sizes the countdown too, same "pick a
// size, it stays that size" idea as Bible/Song's slider -- clamp()'s
// three numbers (min/preferred/max) all scale together so a big
// font_scale genuinely reads bigger instead of hitting today's fixed
// ceiling. Still shrinks back down (same "always make it fit"
// principle as fitLinesToContainer) if an extreme scale would
// otherwise push the clock/text past the edges of the screen -- there's
// no bounded parent box here (unlike #lines' max-height), so this
// checks against the actual viewport instead.
function applyCountdownSizeTheme() {
  const scale = themes.media?.font_scale || 1;
  let factor = 1;
  function apply() {
    const f = scale * factor;
    countdownTextEl.style.fontSize = `clamp(${1.2 * f}rem, ${4 * f}vw, ${3 * f}rem)`;
    countdownClockEl.style.fontSize = `clamp(${3 * f}rem, ${14 * f}vw, ${10 * f}rem)`;
  }
  apply();
  let guard = 0;
  while ((countdownContainerEl.scrollWidth > window.innerWidth * 0.92 || countdownContainerEl.scrollHeight > window.innerHeight * 0.85) && factor > 0.1 && guard < 40) {
    factor *= 0.95;
    apply();
    guard += 1;
  }
}

function showCountdown(payload) {
  hideAllContent();
  idleEl.style.display = 'none';
  currentCategory = 'media';
  countdownContainerEl.style.display = 'block';
  countdownTextEl.textContent = payload.text || '';
  applyTextTheme(countdownTextEl, 'media');
  applyTextTheme(countdownClockEl, 'media');
  applyBackdrop();

  const endsAt = new Date(payload.endsAt).getTime();
  function tick() {
    const remainingMs = Math.max(0, endsAt - Date.now());
    const totalSeconds = Math.ceil(remainingMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    // Real digits in place (not "00:00") before the fit check below
    // ever runs, so it measures the clock's actual width, not an
    // empty/placeholder one.
    countdownClockEl.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    if (remainingMs <= 0) { clearInterval(countdownIntervalId); countdownIntervalId = null; }
  }
  tick();
  applyCountdownSizeTheme();
  countdownIntervalId = setInterval(tick, 250);
}

// A hand-authored or PDF-imported slide (js/components/projectionControl.js's
// Presentation kind) -- either a background image (PDF-page import,
// or a picture chosen for the slide) or plain text on a background
// color, same local-Blob-over-BroadcastChannel pattern as the Image
// kind already uses.
function showPresentation(payload) {
  hideAllContent();
  idleEl.style.display = 'none';
  currentCategory = 'media';
  presentationSlideEl.style.display = 'flex';
  applyBackdrop();

  if (payload.backgroundBlob) {
    currentPresentationObjectUrl = URL.createObjectURL(payload.backgroundBlob);
    presentationSlideEl.innerHTML = `<img src="${currentPresentationObjectUrl}" alt="" />`;
  } else {
    // The slide's own chosen background is a deliberate per-slide
    // authoring choice -- it wins over the category's theme, same as
    // an explicit backdrop image wins over a theme's background.
    presentationSlideEl.style.backgroundColor = payload.backgroundColor || '#000';
    presentationSlideEl.innerHTML = payload.text ? `<p>${escapeHtml(payload.text)}</p>` : '';
    applyTextTheme(presentationSlideEl, 'media');
  }
}

function show(payload) {
  if (!payload || payload.kind === 'blank') {
    hideAllContent();
    idleEl.style.display = 'block';
    return;
  }

  if (payload.kind === 'bible' || payload.kind === 'song') showText(payload);
  else if (payload.kind === 'image') showImage(payload);
  else if (payload.kind === 'video') handleVideo(payload);
  else if (payload.kind === 'countdown') showCountdown(payload);
  else if (payload.kind === 'presentation') showPresentation(payload);
}

show(null);

const channel = createProjectionChannel();
channel.onmessage = (e) => {
  const data = e.data;
  if (!data) return;
  if (data.event === 'show') show(data.payload);
  else if (data.event === 'backdrop') setBackdrop(data.blob);
  else if (data.event === 'theme') {
    themes[data.category] = data.theme;
    // Take effect immediately if that category is what's currently on
    // screen -- an operator changing the active theme mid-service
    // shouldn't need to re-show the same content for it to apply.
    if (data.category === currentCategory) {
      applyBackdrop();
      if (currentCategory === 'songs' || currentCategory === 'bible') applyTextTheme(linesEl, currentCategory);
      else {
        applyTextTheme(countdownTextEl, 'media');
        applyTextTheme(countdownClockEl, 'media');
        if (countdownContainerEl.style.display === 'block') applyCountdownSizeTheme();
        if (!presentationSlideEl.querySelector('img')) applyTextTheme(presentationSlideEl, 'media');
      }
    }
  }
};
// Ask whoever's operating the panel to resend whatever's currently
// live (and the current backdrop) — this page may have just opened,
// or reconnected after the laptop went to sleep mid-service.
channel.postMessage({ event: 'hello' });

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
