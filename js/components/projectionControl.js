// Media & Tech's live projection operator panel — picks a Bible verse,
// a song's lyrics, a background image, or a video (YouTube or a local
// file) and pushes it to whichever browser window has projector.html
// open. Sync happens over a BroadcastChannel, not the network — the
// operator and the projector only ever work as two windows on the
// SAME computer in real use (one laptop, HDMI out to the projector),
// so there's no reason this needs the internet at all. See
// js/utils/projection.js.
//
// Image/video/background are local files, picked straight from this
// computer, never uploaded anywhere — no Supabase Storage, no cost,
// and it works with no internet connection. The real trade-off: they
// only exist for the current session (nothing persists after a
// reload, and there's no cross-device "Library" to reuse from), and
// they can't be pre-picked into the Schedule days in advance the way
// a Bible verse or song can, since a local file only exists in this
// tab's memory at the moment you pick it, not as a stable link.
//
// Verse/song advance is deliberately "live on click", not stage-then-
// go — Next/Previous immediately re-broadcast, matching how an
// operator actually runs a service (there's no useful distinction
// between "preview" and "live" for a single-projector setup). A grid
// of jump-anywhere targets (Bible's Preview button, Song's slide grid,
// Image/Video's Preview button) stages into the Preview box first
// instead, since those are easier to mis-click — only the shared
// "Send to Live" arrow (or a double-click on a song slide) actually
// puts it on screen.
import { t } from '../i18n.js';
import { createProjectionChannel } from '../utils/projection.js';
import { extractYouTubeId } from '../utils/youtube.js';
import { splitLyricsIntoSlides } from '../utils/songSlides.js';
import { createSongCreatorModal } from './songCreatorModal.js';
import { createProjectionThemeModal } from './projectionThemeModal.js';
import * as localMediaStore from '../utils/localMediaStore.js';
import { isSupported as voiceSupported, buildBookAliases, createVoiceVerseDetector } from '../utils/voiceVerseDetector.js';
import { parseReference } from '../utils/bibleReferenceParser.js';

// Lazy-loaded only when the Presentation panel's PDF import is
// actually used -- same version/CDN already proven elsewhere in this
// app (offeringsImport.js, preachingScheduleImport.js).
const PDFJS_VERSION = '4.0.379';
let pdfjsLibPromise = null;
function loadPdfJs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import(`https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.mjs`).then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;
      return lib;
    });
  }
  return pdfjsLibPromise;
}

// Each PDF page becomes one image-only slide -- a page is already a
// fixed, image-like layout, so this is solid with no fidelity caveats
// (unlike the PPTX import below).
async function extractPdfPagesAsSlides(file) {
  const pdfjsLib = await loadPdfJs();
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const slides = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    slides.push({ id: crypto.randomUUID(), text: '', backgroundColor: '#000000', backgroundBlob: blob });
  }
  return slides;
}

// Best-effort only -- there's no reliable client-side PPTX renderer
// that preserves real PowerPoint layouts/fonts/animations. A .pptx is
// a zip of XML; this reads each slide's plain text runs (<a:t>) and
// drops them onto a plain text-only slide, in slide order. Works for
// simple/text-heavy decks; does NOT reproduce images, positioning, or
// complex layouts -- the in-app help text next to the import button
// says this and recommends exporting to PDF from PowerPoint instead.
const JSZIP_VERSION = '3.10.1';
let jszipLibPromise = null;
function loadJSZip() {
  if (!jszipLibPromise) {
    jszipLibPromise = import(`https://cdn.jsdelivr.net/npm/jszip@${JSZIP_VERSION}/+esm`).then((m) => m.default);
  }
  return jszipLibPromise;
}

function decodeXmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

async function extractPptxSlideTexts(file) {
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(file);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/slide(\d+)\.xml/)[1]) - Number(b.match(/slide(\d+)\.xml/)[1]));
  const texts = [];
  for (const name of slideFiles) {
    const xml = await zip.files[name].async('text');
    const runs = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => decodeXmlEntities(m[1]));
    texts.push(runs.join('\n'));
  }
  return texts;
}

// Persists the OPERATOR panel's own idea of "what's going on" across a
// reload/re-mount (this component is torn down and rebuilt from
// scratch on every department switch, let alone a real page refresh --
// see js/deptProjection.js). The actual projector window is a separate
// window/BroadcastChannel listener and is completely unaffected by any
// of this -- it just keeps showing whatever it last received. This is
// purely about the operator's own panel not silently forgetting which
// tab/verse/song/font-scale/schedule-item was active, which otherwise
// looks exactly like "everything reset" even though the audience saw
// no interruption at all.
//
// Only DB-restorable descriptors are stored (translation/book/chapter/
// verse ids, songId/slideIndex) -- never a Blob (can't be serialized),
// which is why a local image/video can't be restored the same way; see
// the `kind === 'image' | 'video'` branch below.
const PROJECTION_STATE_KEY = 'choir-hub-projection-state';

function saveProjectionState(state) {
  try { localStorage.setItem(PROJECTION_STATE_KEY, JSON.stringify(state)); } catch { /* storage full/disabled -- just won't restore next time */ }
}

function readProjectionState() {
  try { return JSON.parse(localStorage.getItem(PROJECTION_STATE_KEY) || 'null'); } catch { return null; }
}

export function renderProjectionControl(container, { supabase }) {
  container.innerHTML = `
    <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-6">
      <div class="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 class="text-lg font-semibold">${t('projection.title')}</h2>
        <div class="flex items-center gap-2 flex-wrap">
          <button type="button" data-action="open-screen" class="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">
            ${t('projection.openScreen')}
          </button>
          <button type="button" data-action="blank" class="px-3 py-1.5 rounded-lg bg-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-300">
            ${t('projection.blankScreen')}
          </button>
          <button type="button" data-action="setup-local-folder" data-el="local-folder-btn" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">
            ${t('projection.setupLocalFolder')}
          </button>
          <button type="button" data-action="open-themes" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">
            ${t('projection.themes')}
          </button>
        </div>
      </div>

      <div class="mb-4 pb-4 border-b border-slate-100">
        <div class="flex flex-wrap items-center gap-4">
          <div class="flex items-center gap-2">
            <label class="text-sm text-slate-600">${t('projection.textSize')}</label>
            <input type="range" data-el="font-scale" min="50" max="600" step="10" value="100" class="w-32" />
            <span data-el="font-scale-value" class="text-sm text-slate-500 w-12">100%</span>
          </div>
          <div class="flex items-center gap-2">
            <label class="text-sm text-slate-600">${t('projection.background')}</label>
            <img data-el="backdrop-thumb" class="hidden w-10 h-10 object-cover rounded border border-slate-200" alt="" />
            <label class="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs font-medium hover:bg-slate-200 cursor-pointer">
              ${t('projection.uploadBackground')}
              <input type="file" accept="image/*" data-el="backdrop-input" class="hidden" />
            </label>
            <button type="button" data-action="clear-backdrop" data-el="clear-backdrop-btn" class="hidden px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs font-medium hover:bg-slate-200">
              ${t('projection.clearBackground')}
            </button>
          </div>
        </div>
      </div>

      <div class="flex gap-2 mb-4 border-b border-slate-200 flex-wrap">
        <button type="button" data-mode-tab="bible" class="px-3 py-2 text-sm font-medium border-b-2 border-indigo-600 text-indigo-700">${t('projection.bibleTab')}</button>
        <button type="button" data-mode-tab="song" class="px-3 py-2 text-sm font-medium border-b-2 border-transparent text-slate-500 hover:text-slate-700">${t('projection.songTab')}</button>
        <button type="button" data-mode-tab="media" class="px-3 py-2 text-sm font-medium border-b-2 border-transparent text-slate-500 hover:text-slate-700">${t('projection.mediaTab')}</button>
        <button type="button" data-mode-tab="schedule" class="px-3 py-2 text-sm font-medium border-b-2 border-transparent text-slate-500 hover:text-slate-700">${t('projection.scheduleTab')}</button>
      </div>

      <div data-el="bible-panel">
        <div data-el="voice-controls" class="hidden items-center gap-2 mb-2 flex-wrap">
          <button type="button" data-el="voice-toggle-btn" class="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs font-medium hover:bg-slate-200">
            🎤 ${t('projection.voiceListen')}
          </button>
          <select data-el="voice-lang-select" class="border border-slate-300 rounded-lg px-2 py-1 text-xs">
            <option value="fr-FR">${t('projection.voiceLangFrench')}</option>
            <option value="en-US">${t('projection.voiceLangEnglish')}</option>
          </select>
          <span data-el="voice-hint" class="text-xs text-slate-400">${t('projection.voiceHint')}</span>
        </div>
        <div data-el="voice-suggestion" class="hidden items-center justify-between gap-2 mb-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-sm">
          <span data-el="voice-suggestion-text" class="text-amber-800 font-medium"></span>
          <span class="flex gap-1.5 shrink-0">
            <button type="button" data-action="voice-show" class="px-2.5 py-1 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700">${t('projection.voiceShow')}</button>
            <button type="button" data-action="voice-dismiss" class="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs font-medium hover:bg-slate-200">${t('projection.voiceDismiss')}</button>
          </span>
        </div>
        <div class="relative mb-2">
          <input type="text" data-el="book-search" placeholder="${t('projection.bookSearchPlaceholder')}" autocomplete="off"
                 class="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
          <div data-el="book-suggestions" class="hidden absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto"></div>
          <p data-el="bible-search-status" class="hidden text-xs text-amber-600 mt-1"></p>
        </div>
        <div class="grid sm:grid-cols-4 gap-3 mb-3">
          <select data-el="translation-select" class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
            <option value="lsg">${t('projection.translationLsg')}</option>
            <option value="web">${t('projection.translationWeb')}</option>
          </select>
          <select data-el="book-select" class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm sm:col-span-2"></select>
          <select data-el="chapter-select" class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm"></select>
        </div>
        <div class="flex items-center gap-2 mb-3">
          <select data-el="verse-select" class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm flex-1"></select>
          <button type="button" data-action="project-verse" class="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
            ${t('projection.preview')}
          </button>
          <button type="button" data-action="schedule-verse" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 disabled:opacity-50">
            ${t('projection.addToSchedule')}
          </button>
        </div>
        <div class="flex items-center gap-2">
          <button type="button" data-action="prev-verse" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 disabled:opacity-50">&larr; ${t('projection.previous')}</button>
          <button type="button" data-action="next-verse" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 disabled:opacity-50">${t('projection.next')} &rarr;</button>
        </div>
      </div>

      <div data-el="song-panel" class="hidden">
        <div class="flex items-center gap-2 mb-2">
          <input type="text" data-el="song-search" placeholder="${t('projection.searchSongPlaceholder')}" class="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          <button type="button" data-action="new-song" class="px-3 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 whitespace-nowrap">
            ${t('projection.newSong')}
          </button>
        </div>
        <div data-el="song-list" class="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-44 overflow-y-auto mb-3"></div>
        <div class="flex items-center gap-2 mb-2">
          <p data-el="song-selected" class="text-sm text-slate-600 flex-1"></p>
          <button type="button" data-action="schedule-song" class="hidden px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">
            ${t('projection.addToSchedule')}
          </button>
        </div>
        <div data-el="slide-grid" class="flex flex-wrap gap-1.5 mb-3"></div>
        <div class="flex items-center gap-2">
          <button type="button" data-action="prev-slide" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 disabled:opacity-50" disabled>&larr; ${t('projection.previous')}</button>
          <button type="button" data-action="next-slide" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 disabled:opacity-50" disabled>${t('projection.next')} &rarr;</button>
          <span data-el="slide-position" class="text-sm text-slate-500"></span>
        </div>
      </div>

      <div data-el="media-panel" class="hidden">
        <div class="flex gap-1.5 mb-3 flex-wrap">
          <button type="button" data-media-kind="image" class="px-3 py-1.5 rounded-lg text-sm font-medium">${t('projection.kindImage')}</button>
          <button type="button" data-media-kind="video" class="px-3 py-1.5 rounded-lg text-sm font-medium">${t('projection.kindVideo')}</button>
          <button type="button" data-media-kind="presentation" class="px-3 py-1.5 rounded-lg text-sm font-medium">${t('projection.kindPresentation')}</button>
          <button type="button" data-media-kind="countdown" class="px-3 py-1.5 rounded-lg text-sm font-medium">${t('projection.kindCountdown')}</button>
        </div>

        <div data-el="image-kind-panel" class="hidden">
          <label class="inline-block px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 cursor-pointer mb-3">
            ${t('projection.uploadImage')}
            <input type="file" accept="image/*" multiple data-el="image-input" class="hidden" />
          </label>
          <p class="text-xs text-slate-400 mb-3" data-el="image-local-hint">${t('projection.localFileHint')}</p>
          <div data-el="image-library" class="hidden mb-3"></div>
          <div class="mb-3">
            <img data-el="image-preview" class="hidden max-h-40 rounded-lg border border-slate-200" alt="" />
          </div>
          <button type="button" data-action="project-image" class="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50" disabled>
            ${t('projection.preview')}
          </button>
        </div>

        <div data-el="video-kind-panel" class="hidden">
          <div class="flex items-center gap-2 mb-2">
            <input type="text" data-el="youtube-input" placeholder="${t('projection.youtubeUrlPlaceholder')}" class="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            <button type="button" data-action="load-youtube" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">
              ${t('projection.load')}
            </button>
          </div>
          <label class="inline-block px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 cursor-pointer mb-1">
            ${t('projection.uploadVideo')}
            <input type="file" accept="video/*" multiple data-el="video-input" class="hidden" />
          </label>
          <p class="text-xs text-slate-400 mb-3" data-el="video-local-hint">${t('projection.localFileHint')}</p>
          <div data-el="video-library" class="hidden mb-3"></div>
          <p data-el="video-selected" class="text-sm text-slate-600 mb-3"></p>
          <div class="flex items-center gap-2">
            <button type="button" data-action="project-video" class="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50" disabled>
              ${t('projection.preview')}
            </button>
            <button type="button" data-action="toggle-video" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 disabled:opacity-50" disabled>
              ${t('projection.pause')}
            </button>
          </div>
        </div>

        <div data-el="presentation-kind-panel" class="hidden">
          <div class="flex gap-1.5 mb-2 flex-wrap">
            <button type="button" data-action="add-slide" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">${t('projection.addSlide')}</button>
            <label class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 cursor-pointer">
              ${t('projection.importPdf')}
              <input type="file" accept=".pdf" data-el="pdf-input" class="hidden" />
            </label>
            <label class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 cursor-pointer">
              ${t('projection.importPptx')}
              <input type="file" accept=".pptx" data-el="pptx-input" class="hidden" />
            </label>
          </div>
          <p class="text-xs text-amber-600 mb-3">${t('projection.pptxCaveat')}</p>
          <div data-el="presentation-slide-grid" class="flex flex-wrap gap-1.5 mb-3"></div>
          <div data-el="presentation-editor" class="hidden border border-slate-200 rounded-lg p-3 mb-3">
            <label class="block text-xs font-medium text-slate-600 mb-1">${t('projection.slideText')}</label>
            <textarea data-el="slide-text-input" rows="2" class="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm mb-2"></textarea>
            <div class="flex items-center gap-2 flex-wrap">
              <label class="text-xs text-slate-600">${t('projection.slideBackground')}</label>
              <input type="color" data-el="slide-color-input" value="#000000" class="w-10 h-8 border border-slate-300 rounded cursor-pointer" />
              <label class="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs font-medium hover:bg-slate-200 cursor-pointer">
                ${t('projection.slideImage')}
                <input type="file" accept="image/*" data-el="slide-image-input" class="hidden" />
              </label>
              <button type="button" data-action="delete-slide" class="px-2.5 py-1 rounded-lg text-rose-600 hover:bg-rose-50 text-xs font-medium">${t('projection.deleteSlide')}</button>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <button type="button" data-action="prev-presentation-slide" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 disabled:opacity-50" disabled>&larr; ${t('projection.previous')}</button>
            <button type="button" data-action="next-presentation-slide" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 disabled:opacity-50" disabled>${t('projection.next')} &rarr;</button>
          </div>
        </div>

        <div data-el="countdown-kind-panel" class="hidden">
          <div class="grid sm:grid-cols-2 gap-3 mb-3">
            <div>
              <label class="block text-xs font-medium text-slate-600 mb-1">${t('projection.countdownText')}</label>
              <input type="text" data-el="countdown-text-input" placeholder="${t('projection.countdownTextPlaceholder')}" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label class="block text-xs font-medium text-slate-600 mb-1">${t('projection.countdownMinutes')}</label>
              <input type="number" min="1" step="1" value="5" data-el="countdown-minutes-input" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <button type="button" data-action="start-countdown" class="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">
            ${t('projection.startCountdown')}
          </button>
        </div>
      </div>

      <div data-el="schedule-panel" class="hidden">
        <div class="flex items-center gap-2 mb-3">
          <input type="date" data-el="schedule-date" class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
        </div>
        <p class="text-xs text-slate-400 mb-3">${t('projection.scheduleLocalHint')}</p>
        <div data-el="schedule-list" class="space-y-1.5"></div>
      </div>

      <div class="mt-4 pt-3 border-t border-slate-100">
        <div class="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-3 items-center">
          <div>
            <p class="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">${t('projection.preview')}</p>
            <div data-el="preview-box" class="rounded-lg bg-slate-600 text-white p-4 min-h-[4.5rem] flex flex-col items-center justify-center text-center">
              <p class="text-slate-300 text-sm">${t('projection.nothingStaged')}</p>
            </div>
          </div>
          <button type="button" data-action="send-staged" title="${t('projection.sendToLive')}"
                  class="justify-self-center shrink-0 w-10 h-10 rounded-full bg-indigo-600 text-white text-lg font-bold hover:bg-indigo-700 disabled:opacity-40 flex items-center justify-center" disabled>
            &rarr;
          </button>
          <div>
            <p class="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">${t('projection.nowShowing')}</p>
            <div data-el="now-showing" class="rounded-lg bg-slate-900 text-white p-4 min-h-[4.5rem] flex flex-col items-center justify-center text-center">
              <p class="text-slate-400 text-sm">${t('projection.nothingLive')}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  const translationSelectEl = container.querySelector('[data-el="translation-select"]');
  const voiceControlsEl = container.querySelector('[data-el="voice-controls"]');
  const voiceToggleBtn = container.querySelector('[data-el="voice-toggle-btn"]');
  const voiceLangSelectEl = container.querySelector('[data-el="voice-lang-select"]');
  const voiceSuggestionEl = container.querySelector('[data-el="voice-suggestion"]');
  const voiceSuggestionTextEl = container.querySelector('[data-el="voice-suggestion-text"]');
  const voiceShowBtn = container.querySelector('[data-action="voice-show"]');
  const voiceDismissBtn = container.querySelector('[data-action="voice-dismiss"]');
  const bookSearchEl = container.querySelector('[data-el="book-search"]');
  const bookSuggestionsEl = container.querySelector('[data-el="book-suggestions"]');
  const bibleSearchStatusEl = container.querySelector('[data-el="bible-search-status"]');
  const bookSelectEl = container.querySelector('[data-el="book-select"]');
  const chapterSelectEl = container.querySelector('[data-el="chapter-select"]');
  const verseSelectEl = container.querySelector('[data-el="verse-select"]');
  const prevVerseBtn = container.querySelector('[data-action="prev-verse"]');
  const nextVerseBtn = container.querySelector('[data-action="next-verse"]');
  const projectVerseBtn = container.querySelector('[data-action="project-verse"]');
  const scheduleVerseBtn = container.querySelector('[data-action="schedule-verse"]');

  const songSearchEl = container.querySelector('[data-el="song-search"]');
  const songListEl = container.querySelector('[data-el="song-list"]');
  const songSelectedEl = container.querySelector('[data-el="song-selected"]');
  const scheduleSongBtn = container.querySelector('[data-action="schedule-song"]');
  const slideGridEl = container.querySelector('[data-el="slide-grid"]');
  const prevSlideBtn = container.querySelector('[data-action="prev-slide"]');
  const nextSlideBtn = container.querySelector('[data-action="next-slide"]');
  const slidePositionEl = container.querySelector('[data-el="slide-position"]');

  const imageInputEl = container.querySelector('[data-el="image-input"]');
  const imagePreviewEl = container.querySelector('[data-el="image-preview"]');
  const projectImageBtn = container.querySelector('[data-action="project-image"]');
  const imageLibraryEl = container.querySelector('[data-el="image-library"]');
  const imageLocalHintEl = container.querySelector('[data-el="image-local-hint"]');

  const youtubeInputEl = container.querySelector('[data-el="youtube-input"]');
  const videoInputEl = container.querySelector('[data-el="video-input"]');
  const videoSelectedEl = container.querySelector('[data-el="video-selected"]');
  const projectVideoBtn = container.querySelector('[data-action="project-video"]');
  const toggleVideoBtn = container.querySelector('[data-action="toggle-video"]');
  const videoLibraryEl = container.querySelector('[data-el="video-library"]');
  const videoLocalHintEl = container.querySelector('[data-el="video-local-hint"]');

  const mediaKindBtns = container.querySelectorAll('[data-media-kind]');
  const mediaKindPanels = {
    image: container.querySelector('[data-el="image-kind-panel"]'),
    video: container.querySelector('[data-el="video-kind-panel"]'),
    presentation: container.querySelector('[data-el="presentation-kind-panel"]'),
    countdown: container.querySelector('[data-el="countdown-kind-panel"]'),
  };
  const presentationSlideGridEl = container.querySelector('[data-el="presentation-slide-grid"]');
  const presentationEditorEl = container.querySelector('[data-el="presentation-editor"]');
  const slideTextInputEl = container.querySelector('[data-el="slide-text-input"]');
  const slideColorInputEl = container.querySelector('[data-el="slide-color-input"]');
  const slideImageInputEl = container.querySelector('[data-el="slide-image-input"]');
  const pdfInputEl = container.querySelector('[data-el="pdf-input"]');
  const pptxInputEl = container.querySelector('[data-el="pptx-input"]');
  const prevPresentationSlideBtn = container.querySelector('[data-action="prev-presentation-slide"]');
  const nextPresentationSlideBtn = container.querySelector('[data-action="next-presentation-slide"]');
  const countdownTextInputEl = container.querySelector('[data-el="countdown-text-input"]');
  const countdownMinutesInputEl = container.querySelector('[data-el="countdown-minutes-input"]');

  const scheduleDateEl = container.querySelector('[data-el="schedule-date"]');
  const scheduleListEl = container.querySelector('[data-el="schedule-list"]');

  const localFolderBtnEl = container.querySelector('[data-el="local-folder-btn"]');

  const fontScaleEl = container.querySelector('[data-el="font-scale"]');
  const fontScaleValueEl = container.querySelector('[data-el="font-scale-value"]');
  const backdropThumbEl = container.querySelector('[data-el="backdrop-thumb"]');
  const backdropInputEl = container.querySelector('[data-el="backdrop-input"]');
  const clearBackdropBtn = container.querySelector('[data-el="clear-backdrop-btn"]');

  const nowShowingEl = container.querySelector('[data-el="now-showing"]');
  const previewBoxEl = container.querySelector('[data-el="preview-box"]');
  const sendStagedBtn = container.querySelector('[data-action="send-staged"]');
  const modeTabs = container.querySelectorAll('[data-mode-tab]');
  const panels = {
    bible: container.querySelector('[data-el="bible-panel"]'),
    song: container.querySelector('[data-el="song-panel"]'),
    media: container.querySelector('[data-el="media-panel"]'),
    schedule: container.querySelector('[data-el="schedule-panel"]'),
  };

  let books = [];
  let bookVerses = []; // [{chapter, verse, text}] for the selected book+translation, ordered
  let verseIndex = -1;

  let voiceAliases = []; // buildBookAliases(books) output, rebuilt once books loads
  let voiceDetector = null;
  let voiceSuggestion = null; // { bookNumber, chapter, verse } awaiting the operator's tap

  let allSongs = []; // [{id, title}], loaded once
  let songSlides = []; // [[line, line, ...], ...]
  let songTitle = '';
  let selectedSongId = null;
  let currentSongLyrics = ''; // raw text, only so it can be cached locally once shown — see cacheCurrentSongIfPossible()
  let slideIndex = -1; // which slide is actually LIVE

  // Shared across all four tabs — only one thing can be "next in line"
  // at a time, matching the single shared Preview box/arrow.
  let stagedKind = null; // 'bible' | 'song' | 'image' | 'video' | 'presentation' | null
  let stagedPayload = null; // exactly what gets sent, plus whatever contentPreviewHtml needs to render it
  let stagedBibleIndex = -1; // into bookVerses, when stagedKind === 'bible'
  let stagedSlideIndex = -1; // into songSlides, when stagedKind === 'song'
  let stagedPresentationSlideIndex = -1; // into presentationSlides, when stagedKind === 'presentation'

  let pendingImageBlob = null;
  let pendingImageObjectUrl = null; // this tab's own preview only — never sent over the channel

  let pendingVideo = null; // { source: 'youtube', videoId } or { source: 'file' } (the file itself is pendingVideoBlob)
  let pendingVideoBlob = null;
  let videoLoaded = false;
  let videoPlaying = false;

  let mediaKind = 'image'; // which of Image/Video/Presentation/Countdown is showing within the Media tab

  // Presentation: a hand-built or PDF/PPTX-imported slide deck, same
  // click-to-stage/double-click-to-go-live pattern as Songs. Each
  // slide: { text, backgroundColor, backgroundBlob }. Local-only, like
  // Image/Video — never persisted, nothing to restore after a reload.
  let presentationSlides = [];
  let presentationSlideIndex = -1; // which slide is actually LIVE
  let presentationEditIndex = -1; // which slide the editor box below the grid is currently editing

  let currentFontScale = 1;
  let currentBackdropBlob = null;
  let currentBackdropObjectUrl = null; // this tab's own toolbar thumbnail only

  let currentPayload = null;
  let projectorWindowRef = null;
  let liveScheduleItemId = null; // which schedule item (if any) is currently live — for the LIVE/NEXT badges

  let currentMode = 'bible';
  // What's actually live, as a restorable descriptor (ids, not the
  // rendered text) -- kept in sync alongside currentPayload at every
  // real send() call site, and written to localStorage so a reload
  // can rebuild the operator's own view of reality. See
  // saveProjectionState()/readProjectionState() above.
  let lastLiveDescriptor = null;

  function saveState() {
    saveProjectionState({ mode: currentMode, fontScale: currentFontScale, live: lastLiveDescriptor, liveScheduleItemId });
  }

  // Updates the operator's own "Now Showing" box from a restored
  // descriptor WITHOUT broadcasting anything -- the projector window
  // already has whatever it had before this panel reloaded; this is
  // only about this panel catching back up to that reality.
  function restoreNowShowing(payload) {
    currentPayload = payload;
    renderNowShowing(payload);
  }

  // --- Local folder storage (File System Access API) ---
  // Chromium-only -- the button itself is hidden entirely on
  // Firefox/Safari rather than shown-but-broken, and every other call
  // site below checks `localFolderHandle` before using it, falling
  // back to exactly today's in-memory-only behavior when it's null.
  let localFolderHandle = null;
  // True when a folder WAS set up before but the browser needs a
  // fresh click to re-confirm access (typically after the browser
  // itself restarted, not just a page reload) -- shown as "Reconnect"
  // rather than "Set Up" so it's obvious this isn't starting over.
  // Without this, a silently-refused permission check looked exactly
  // like "never configured", and Image/Video/Presentation fell back
  // to session-only (gone on the next reload) even though a real
  // folder was already on file.
  let needsFolderReconnect = false;

  if (!localMediaStore.isSupported()) {
    localFolderBtnEl.classList.add('hidden');
  } else {
    localMediaStore.getFolderHandle().then(async (handle) => {
      if (handle) {
        localFolderHandle = handle;
      } else {
        needsFolderReconnect = await localMediaStore.hasStoredFolderHandle();
      }
      onLocalFolderChanged();
    });
    localFolderBtnEl.addEventListener('click', async () => {
      const handle = needsFolderReconnect
        ? await localMediaStore.reconnectFolderAccess()
        : await localMediaStore.requestFolderAccess();
      if (handle) { localFolderHandle = handle; needsFolderReconnect = false; }
      onLocalFolderChanged();
    });
  }

  function onLocalFolderChanged() {
    localFolderBtnEl.textContent = localFolderHandle
      ? t('projection.localFolderConnected')
      : needsFolderReconnect ? t('projection.reconnectLocalFolder') : t('projection.setupLocalFolder');
    localFolderBtnEl.className = `px-3 py-1.5 rounded-lg text-sm font-medium ${
      localFolderHandle ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
      : needsFolderReconnect ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
    }`;
    imageLocalHintEl.textContent = localFolderHandle ? t('projection.localFolderHint') : t('projection.localFileHint');
    videoLocalHintEl.textContent = localFolderHandle ? t('projection.localFolderHint') : t('projection.localFileHint');
    renderImageLibrary();
    renderVideoLibrary();
    restorePresentationState();
  }

  // Always a multi-item library, with or without a local folder set
  // up -- folder-backed items persist across a reload (read from disk
  // via listFiles()); without a folder, items just live in these two
  // plain arrays for the rest of this session (same "local file,
  // nothing persists without a folder" tradeoff the local-file-hint
  // text already explains). Either way, every item picked stays
  // available for reselection and can be individually deleted --
  // adding a new one never silently discards the previous ones.
  let memoryImageItems = []; // [{name, blob}]
  let memoryVideoItems = []; // [{name, blob}]

  // Generic renderer for either library -- `items` is whatever the
  // caller already resolved (folder listing or the in-memory array),
  // `resolveBlob` loads each one's actual content (read from disk, or
  // just the already-in-memory blob) so a real thumbnail can be shown
  // instead of a plain filename -- picking the right one out of a
  // library of several images/videos by name alone meant opening each
  // in turn to check. `onPick` receives the already-loaded blob
  // (no second read); `onDelete` does the source-specific removal
  // (deleteFile() vs. an array splice). `thumbnailUrls` is the
  // caller's own array of object URLs from the PREVIOUS render, so
  // they can be revoked before new ones are minted.
  // projection-presentation.json and its per-slide background images
  // (presentation-*) live in the same folder as the Image/Video
  // library, but aren't meant to be pickable AS an image/video
  // themselves -- see savePresentationDeck()/restorePresentationDeck()
  // below.
  function isPresentationFile(name) {
    return name === 'projection-presentation.json' || name.startsWith('presentation-');
  }

  async function renderMediaLibrary(listEl, items, resolveBlob, onPick, onDelete, thumbnailUrls) {
    thumbnailUrls.splice(0).forEach((url) => URL.revokeObjectURL(url));
    if (items.length === 0) {
      listEl.classList.add('hidden');
      listEl.innerHTML = '';
      return;
    }
    listEl.classList.remove('hidden');
    listEl.innerHTML = `<p class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">${t('projection.library')}</p>
      <div class="flex flex-wrap gap-2" data-el="library-grid"></div>`;
    const gridEl = listEl.querySelector('[data-el="library-grid"]');

    const blobs = await Promise.all(items.map((item) => resolveBlob(item)));
    gridEl.innerHTML = items.map((item, idx) => {
      const url = URL.createObjectURL(blobs[idx]);
      thumbnailUrls.push(url);
      const isVideo = (blobs[idx].type || '').startsWith('video/');
      const thumb = isVideo
        ? `<video src="${escapeAttr(url)}" class="w-16 h-16 object-cover rounded-lg bg-black" muted playsinline preload="auto"></video>`
        : `<img src="${escapeAttr(url)}" class="w-16 h-16 object-cover rounded-lg border border-slate-200" alt="" />`;
      return `
        <div class="relative">
          <button type="button" data-library-pick="${idx}" title="${escapeAttr(item.name)}" class="block">${thumb}</button>
          <button type="button" data-library-delete="${idx}" title="${t('projection.deleteMedia')}"
                  class="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-slate-700 text-white text-xs leading-none hover:bg-rose-600">&times;</button>
        </div>
      `;
    }).join('');

    gridEl.querySelectorAll('[data-library-pick]').forEach((btn) => {
      const idx = Number(btn.dataset.libraryPick);
      btn.addEventListener('click', () => onPick(blobs[idx], items[idx]));
    });
    gridEl.querySelectorAll('[data-library-delete]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await onDelete(items[Number(btn.dataset.libraryDelete)]);
      });
    });
  }

  function selectImageFile(file) {
    if (pendingImageObjectUrl) URL.revokeObjectURL(pendingImageObjectUrl);
    pendingImageBlob = file;
    pendingImageObjectUrl = URL.createObjectURL(file);
    imagePreviewEl.src = pendingImageObjectUrl;
    imagePreviewEl.classList.remove('hidden');
    projectImageBtn.disabled = false;
  }

  let imageThumbnailUrls = [];
  async function renderImageLibrary() {
    if (localFolderHandle) {
      const files = await localMediaStore.listFiles(localFolderHandle);
      const items = files.filter((f) => f.name !== 'projection-songs-cache.json' && !isPresentationFile(f.name));
      await renderMediaLibrary(imageLibraryEl, items, (item) => localMediaStore.readFile(localFolderHandle, item.name), (blob) => selectImageFile(blob), async (item) => {
        await localMediaStore.deleteFile(localFolderHandle, item.name);
        renderImageLibrary();
      }, imageThumbnailUrls);
    } else {
      await renderMediaLibrary(imageLibraryEl, memoryImageItems, (item) => item.blob, (blob) => selectImageFile(blob), (item) => {
        memoryImageItems = memoryImageItems.filter((i) => i !== item);
        renderImageLibrary();
      }, imageThumbnailUrls);
    }
  }

  function selectVideoFile(file) {
    pendingVideo = { source: 'file' };
    pendingVideoBlob = file;
    videoSelectedEl.textContent = `${t('projection.videoReady')} (${file.name})`;
    projectVideoBtn.disabled = false;
  }

  let videoThumbnailUrls = [];
  async function renderVideoLibrary() {
    if (localFolderHandle) {
      const files = await localMediaStore.listFiles(localFolderHandle);
      const items = files.filter((f) => f.name !== 'projection-songs-cache.json' && !isPresentationFile(f.name));
      await renderMediaLibrary(videoLibraryEl, items, (item) => localMediaStore.readFile(localFolderHandle, item.name), (blob) => selectVideoFile(blob), async (item) => {
        await localMediaStore.deleteFile(localFolderHandle, item.name);
        renderVideoLibrary();
      }, videoThumbnailUrls);
    } else {
      await renderMediaLibrary(videoLibraryEl, memoryVideoItems, (item) => item.blob, (blob) => selectVideoFile(blob), (item) => {
        memoryVideoItems = memoryVideoItems.filter((i) => i !== item);
        renderVideoLibrary();
      }, videoThumbnailUrls);
    }
  }

  // BroadcastChannel, not Supabase Realtime — see js/utils/projection.js.
  // Works only between windows on this same computer/browser, which is
  // exactly the real setup (laptop -> HDMI -> projector), and means
  // none of this needs an internet connection once the page has loaded.
  const channel = createProjectionChannel();
  channel.onmessage = (e) => {
    if (e.data?.event !== 'hello') return;
    // The projector just (re)connected — resend what's live, the
    // current backdrop, and every category's active theme, since it
    // has no other way to know any of them.
    channel.postMessage({ event: 'show', payload: currentPayload || { kind: 'blank' } });
    channel.postMessage({ event: 'backdrop', blob: currentBackdropBlob });
    Object.entries(activeThemes).forEach(([category, theme]) => {
      if (theme) channel.postMessage({ event: 'theme', category, theme });
    });
  };

  container.querySelector('[data-action="open-screen"]').addEventListener('click', () => {
    // Opened synchronously, directly inside this click, with nothing
    // awaited first -- that's what actually lets the new window's own
    // on-load requestFullscreen() (projectorPage.js) succeed. An
    // `await window.getScreenDetails()` (even just to check how many
    // screens exist) *before* this call was tested for real and found
    // to drop the one-shot "transient activation" window.open()/
    // requestFullscreen() need, leaving the projector window stuck
    // without a usable gesture -- regardless of single- or multi-
    // screen setups, since getScreenDetails() is async either way.
    projectorWindowRef = window.open('projector.html', '_blank');

    // Multi-monitor placement is layered on top, after the fact, via
    // moveTo/resizeTo (neither needs activation) -- so it never has to
    // gate the open/fullscreen above. The Window Management API only
    // exists in Chromium; everywhere else this just leaves the window
    // where it opened, same as before.
    if ('getScreenDetails' in window && window.isSecureContext) {
      window.getScreenDetails()
        .then((screenDetails) => {
          if (screenDetails.screens.length <= 1) return;
          pickScreen(screenDetails.screens, (chosen) => {
            projectorWindowRef?.moveTo(chosen.left, chosen.top);
            projectorWindowRef?.resizeTo(chosen.width, chosen.height);
          });
        })
        .catch(() => { /* permission denied — leave the window where it opened */ });
    }
  });

  container.querySelector('[data-action="blank"]').addEventListener('click', () => {
    videoPlaying = false;
    videoLoaded = false;
    toggleVideoBtn.disabled = true;
    toggleVideoBtn.textContent = t('projection.pause');
    lastLiveDescriptor = { kind: 'blank' };
    send({ kind: 'blank' });
  });

  modeTabs.forEach((tab) => tab.addEventListener('click', () => { setMode(tab.dataset.modeTab); saveState(); }));

  function setMode(mode) {
    currentMode = mode;
    Object.entries(panels).forEach(([key, el]) => el.classList.toggle('hidden', key !== mode));
    modeTabs.forEach((tab) => {
      const active = tab.dataset.modeTab === mode;
      tab.className = `px-3 py-2 text-sm font-medium border-b-2 ${active ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`;
    });
  }

  function setMediaKind(kind) {
    mediaKind = kind;
    Object.entries(mediaKindPanels).forEach(([key, el]) => el.classList.toggle('hidden', key !== kind));
    mediaKindBtns.forEach((btn) => {
      const active = btn.dataset.mediaKind === kind;
      btn.className = `px-3 py-1.5 rounded-lg text-sm font-medium ${active ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`;
    });
  }
  mediaKindBtns.forEach((btn) => btn.addEventListener('click', () => setMediaKind(btn.dataset.mediaKind)));
  setMediaKind('image');

  function send(payload) {
    if (payload.kind === 'bible' || payload.kind === 'song') {
      payload = { ...payload, fontScale: currentFontScale };
    }
    currentPayload = payload;
    channel.postMessage({ event: 'show', payload });
    renderNowShowing(payload);

    // Cleared by default on every send(); runScheduleItem re-marks
    // itself live right after this returns (send() is synchronous), so
    // a plain Bible/Song/Image/Video action outside the schedule
    // correctly un-highlights whatever schedule item was live before.
    if (liveScheduleItemId !== null) {
      liveScheduleItemId = null;
      renderScheduleList();
    }
    saveState();
  }

  // "Now Showing" — a preview of the actual live content right in the
  // operator panel, since the operator can't always see the physical
  // projector screen from where they're running the laptop.
  function contentPreviewHtml(payload, staged) {
    if (payload.kind === 'bible' || payload.kind === 'song') {
      return `
        <p class="text-sm leading-snug">${payload.lines.map((l) => escapeHtml(l)).join('<br>')}</p>
        ${payload.reference ? `<p class="text-xs text-slate-300 mt-2">${escapeHtml(payload.reference)}</p>` : ''}
      `;
    }
    if (payload.kind === 'image') {
      // Fine to mint a fresh object URL per render here — this tab's
      // own preview only, images are shown far less often than
      // verses/songs, and it's all released anyway the moment this
      // page reloads or closes.
      return `<img src="${escapeAttr(URL.createObjectURL(payload.blob))}" class="max-h-24 rounded" alt="" />`;
    }
    if (payload.kind === 'video') {
      // A staged video hasn't actually started playing yet — only the
      // live "Now Showing" copy of this reflects real playback state.
      const state = staged ? t('projection.videoStagedLabel') : (payload.action === 'pause' ? t('projection.videoPaused') : t('projection.videoPlaying'));
      return `<p class="text-sm">🎬 ${escapeHtml(state)}</p>`;
    }
    if (payload.kind === 'presentation') {
      if (payload.backgroundBlob) {
        return `<img src="${escapeAttr(URL.createObjectURL(payload.backgroundBlob))}" class="max-h-24 rounded" alt="" />`;
      }
      return `<div class="rounded p-3 text-sm" style="background:${escapeAttr(payload.backgroundColor || '#000')};color:#fff;">${escapeHtml(payload.text || '')}</div>`;
    }
    if (payload.kind === 'countdown') {
      return `<p class="text-sm">⏱ ${escapeHtml(payload.text || '')} — ${t('projection.countdownRunning')}</p>`;
    }
    return '';
  }

  function renderNowShowing(payload) {
    nowShowingEl.innerHTML = (!payload || payload.kind === 'blank')
      ? `<p class="text-slate-400 text-sm">${t('projection.nothingLive')}</p>`
      : contentPreviewHtml(payload, false);
  }

  function renderStagePreview(payload) {
    previewBoxEl.innerHTML = !payload
      ? `<p class="text-slate-300 text-sm">${t('projection.nothingStaged')}</p>`
      : contentPreviewHtml(payload, true);
    sendStagedBtn.disabled = !payload;
  }

  // --- Text size / backdrop ---

  fontScaleEl.addEventListener('input', () => {
    currentFontScale = Number(fontScaleEl.value) / 100;
    fontScaleValueEl.textContent = `${fontScaleEl.value}%`;
    if (currentPayload?.kind === 'bible' || currentPayload?.kind === 'song') send(currentPayload); // also saves state
    else saveState();
  });

  // A local file, picked straight from this computer — never uploaded
  // anywhere. Applies immediately (own toolbar thumbnail + sent to the
  // projector right away) and lasts for this session only; nothing
  // persists across a reload, unlike the old cloud-backed backdrop.
  function setBackdropBlob(blob) {
    if (currentBackdropObjectUrl) URL.revokeObjectURL(currentBackdropObjectUrl);
    currentBackdropBlob = blob;
    currentBackdropObjectUrl = blob ? URL.createObjectURL(blob) : null;
    backdropThumbEl.classList.toggle('hidden', !currentBackdropObjectUrl);
    clearBackdropBtn.classList.toggle('hidden', !currentBackdropBlob);
    if (currentBackdropObjectUrl) backdropThumbEl.src = currentBackdropObjectUrl;
    channel.postMessage({ event: 'backdrop', blob: currentBackdropBlob });
  }

  backdropInputEl.addEventListener('change', () => {
    const file = backdropInputEl.files[0];
    if (file) setBackdropBlob(file);
  });

  clearBackdropBtn.addEventListener('click', () => setBackdropBlob(null));

  // --- Bible panel ---

  async function loadBooks() {
    const { data } = await supabase.from('bible_books').select('number, name_en, name_fr').order('number');
    books = data || [];
    voiceAliases = buildBookAliases(books);
    renderBookOptions();
  }

  function renderBookOptions() {
    const isFrench = translationSelectEl.value === 'lsg';
    bookSelectEl.innerHTML = books.map((b) => `<option value="${b.number}">${escapeHtml(isFrench ? b.name_fr : b.name_en)}</option>`).join('');
  }

  // Smart search: type a whole reference in one line ("Mal 3 10",
  // "Malachie 3:10", "mal 3.10") and see it resolve as you go --
  // js/utils/bibleReferenceParser.js does the actual book/chapter/
  // verse splitting; this just renders suggestions/status and commits
  // the final selection the same way the three dropdowns already do
  // (reuses loadBook()/renderVerseOptions()/stageSelectedVerse() as-is,
  // so Preview/Add to Schedule/Next/Previous all keep working
  // unchanged afterward).
  const RECENT_SEARCHES_KEY = 'choir-hub-bible-recent-searches';
  const MAX_RECENT_SEARCHES = 8;
  let pendingNavigation = null; // { bookNumber, chapter, verse } once the typed reference is fully valid
  let smartSearchLoadedBook = null; // which book loadBook() last loaded, so retyping digits doesn't refetch
  let smartSearchRequestSeq = 0; // race guard: a later keystroke's fetch always wins over an earlier one

  function loadRecentSearches() {
    try {
      const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  function saveRecentSearch(entry) {
    try {
      const existing = loadRecentSearches().filter((r) => !(r.bookNumber === entry.bookNumber && r.chapter === entry.chapter && r.verse === entry.verse));
      existing.unshift(entry);
      localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(existing.slice(0, MAX_RECENT_SEARCHES)));
    } catch { /* localStorage full/unavailable -- recent list is a convenience, not critical */ }
  }

  function currentBookLabel(bookNumber) {
    const b = books.find((x) => x.number === bookNumber);
    if (!b) return `#${bookNumber}`;
    return translationSelectEl.value === 'lsg' ? b.name_fr : b.name_en;
  }

  function renderSuggestionRows(rows) {
    if (rows.length === 0) {
      bookSuggestionsEl.classList.add('hidden');
      bookSuggestionsEl.innerHTML = '';
      return;
    }
    bookSuggestionsEl.classList.remove('hidden');
    bookSuggestionsEl.innerHTML = rows.map((r, i) => `<button type="button" data-row-index="${i}" class="block w-full text-left px-3 py-2 text-sm hover:bg-slate-50">${r.label}</button>`).join('');
    bookSuggestionsEl.querySelectorAll('[data-row-index]').forEach((btn) => {
      btn.addEventListener('click', () => rows[Number(btn.dataset.rowIndex)].onPick());
    });
  }

  function showSmartSearchStatus(message) {
    if (!message) {
      bibleSearchStatusEl.classList.add('hidden');
      bibleSearchStatusEl.textContent = '';
      return;
    }
    bibleSearchStatusEl.classList.remove('hidden');
    bibleSearchStatusEl.textContent = message;
  }

  // Tapping a still-ambiguous book suggestion fills in that book's
  // name and leaves focus in the field for the chapter/verse to
  // continue being typed, rather than jumping anywhere yet -- there's
  // no chapter typed at this point.
  function pickBookForContinuedTyping(book) {
    bookSearchEl.value = `${currentBookLabel(book.number)} `;
    bookSearchEl.focus();
    handleSmartSearchInput();
  }

  async function handleSmartSearchInput() {
    const raw = bookSearchEl.value;
    pendingNavigation = null;

    if (!raw.trim()) {
      showSmartSearchStatus('');
      const recents = loadRecentSearches();
      renderSuggestionRows(recents.map((r) => ({
        label: escapeHtml(r.label),
        onPick: () => commitNavigation(r),
      })));
      return;
    }

    const isFrench = translationSelectEl.value === 'lsg';
    const { matches, book, chapter, verse } = parseReference(books, raw, isFrench);

    if (!book) {
      showSmartSearchStatus('');
      renderSuggestionRows(matches.map((b) => ({
        label: escapeHtml(isFrench ? b.name_fr : b.name_en),
        onPick: () => pickBookForContinuedTyping(b),
      })));
      return;
    }

    const mySeq = ++smartSearchRequestSeq;
    if (smartSearchLoadedBook !== book.number) {
      showSmartSearchStatus(t('common.loading'));
      renderSuggestionRows([]);
      bookSelectEl.value = String(book.number);
      await loadBook();
      if (mySeq !== smartSearchRequestSeq) return; // superseded by a newer keystroke
      smartSearchLoadedBook = book.number;
    }

    const chapters = [...new Set(bookVerses.map((v) => v.chapter))];
    const maxChapter = chapters.length ? Math.max(...chapters) : 0;

    if (chapter === null) {
      showSmartSearchStatus('');
      renderSuggestionRows([{
        label: `&rarr; ${escapeHtml(currentBookLabel(book.number))}`,
        onPick: () => commitNavigation({ bookNumber: book.number, chapter: 1, verse: null, label: currentBookLabel(book.number) }),
      }]);
      return;
    }

    if (chapter > maxChapter) {
      showSmartSearchStatus(t('projection.smartSearchChapterOutOfRange', { book: currentBookLabel(book.number), max: maxChapter }));
      renderSuggestionRows([]);
      return;
    }

    const versesInChapter = bookVerses.filter((v) => v.chapter === chapter).map((v) => v.verse);
    const maxVerse = versesInChapter.length ? Math.max(...versesInChapter) : 0;

    if (verse === null) {
      showSmartSearchStatus('');
      renderSuggestionRows([{
        label: `&rarr; ${escapeHtml(currentBookLabel(book.number))} ${chapter}`,
        onPick: () => commitNavigation({ bookNumber: book.number, chapter, verse: null, label: `${currentBookLabel(book.number)} ${chapter}` }),
      }]);
      return;
    }

    if (!versesInChapter.includes(verse)) {
      showSmartSearchStatus(t('projection.smartSearchVerseOutOfRange', { book: currentBookLabel(book.number), chapter, max: maxVerse }));
      renderSuggestionRows([]);
      return;
    }

    showSmartSearchStatus('');
    const label = `${currentBookLabel(book.number)} ${chapter}:${verse}`;
    pendingNavigation = { bookNumber: book.number, chapter, verse, label };
    renderSuggestionRows([{ label: `&rarr; ${escapeHtml(label)}`, onPick: () => commitNavigation(pendingNavigation) }]);
  }

  async function commitNavigation({ bookNumber, chapter, verse, label }) {
    bookSelectEl.value = String(bookNumber);
    if (smartSearchLoadedBook !== bookNumber) {
      await loadBook();
      smartSearchLoadedBook = bookNumber;
    }
    const chapters = [...new Set(bookVerses.map((v) => v.chapter))];
    const resolvedChapter = chapter && chapters.includes(chapter) ? chapter : chapters[0];
    chapterSelectEl.value = String(resolvedChapter);
    renderVerseOptions();
    const versesInChapter = bookVerses.filter((v) => v.chapter === resolvedChapter).map((v) => v.verse);
    const resolvedVerse = verse && versesInChapter.includes(verse) ? verse : versesInChapter[0];
    verseSelectEl.value = String(resolvedVerse);
    stageSelectedVerse();

    saveRecentSearch({
      bookNumber, chapter: resolvedChapter, verse: resolvedVerse,
      label: label || `${currentBookLabel(bookNumber)} ${resolvedChapter}:${resolvedVerse}`,
    });

    bookSearchEl.value = '';
    pendingNavigation = null;
    showSmartSearchStatus('');
    bookSuggestionsEl.classList.add('hidden');
  }

  bookSearchEl.addEventListener('input', () => { handleSmartSearchInput(); });
  bookSearchEl.addEventListener('focus', () => handleSmartSearchInput());
  bookSearchEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (pendingNavigation) commitNavigation(pendingNavigation);
  });
  // On document, not just the input, so clicking anywhere outside
  // closes the suggestion list — removed again in destroy() below, so
  // repeated visits to this panel (it's rebuilt fresh every time) don't
  // stack up one of these forever.
  function closeSuggestionsOnOutsideClick(e) {
    if (!bookSearchEl.contains(e.target) && !bookSuggestionsEl.contains(e.target)) bookSuggestionsEl.classList.add('hidden');
  }
  document.addEventListener('click', closeSuggestionsOnOutsideClick);

  async function loadBook() {
    const bookNumber = Number(bookSelectEl.value);
    if (!bookNumber) return;
    verseSelectEl.disabled = true;
    projectVerseBtn.disabled = true;

    // Supabase's default PostgREST row cap (1000) would otherwise
    // silently truncate any book past that many verses -- Psalms
    // (2461-2527 verses depending on translation) is the only book big
    // enough to hit this, cutting it off right around chapter 66-67.
    // Paginate the same way bibleImportTool.js's own
    // fetchBookVerseCounts() already does for the same reason.
    const pageSize = 1000;
    let data = [];
    let error = null;
    for (let from = 0; ; from += pageSize) {
      const { data: page, error: pageError } = await supabase
        .from('bible_verses')
        .select('chapter, verse, text')
        .eq('translation', translationSelectEl.value)
        .eq('book_number', bookNumber)
        .order('chapter')
        .order('verse')
        .range(from, from + pageSize - 1);
      if (pageError) { error = pageError; break; }
      data = data.concat(page || []);
      if (!page || page.length < pageSize) break;
    }

    if (error || !data || data.length === 0) {
      bookVerses = [];
      chapterSelectEl.innerHTML = '';
      verseSelectEl.innerHTML = `<option>${t('projection.bibleNotImported')}</option>`;
      return;
    }

    bookVerses = data;
    const chapters = [...new Set(bookVerses.map((v) => v.chapter))];
    chapterSelectEl.innerHTML = chapters.map((c) => `<option value="${c}">${t('projection.chapterN', { n: c })}</option>`).join('');
    renderVerseOptions();
    projectVerseBtn.disabled = false;
  }

  function renderVerseOptions() {
    const chapter = Number(chapterSelectEl.value);
    const verses = bookVerses.filter((v) => v.chapter === chapter);
    verseSelectEl.disabled = false;
    verseSelectEl.innerHTML = verses.map((v) => `<option value="${v.verse}">${t('projection.verseN', { n: v.verse })}</option>`).join('');
  }

  // "Project" now stages, same as everywhere else — Next/Previous stay
  // immediate, since they're a deliberate step through an already-live
  // passage, not a fresh jump.
  function stageSelectedVerse() {
    const chapter = Number(chapterSelectEl.value);
    const verse = Number(verseSelectEl.value);
    const idx = bookVerses.findIndex((v) => v.chapter === chapter && v.verse === verse);
    if (idx === -1) return;
    const v = bookVerses[idx];
    const bookLabel = bookSelectEl.options[bookSelectEl.selectedIndex]?.textContent || '';
    stagedKind = 'bible';
    stagedBibleIndex = idx;
    stagedPayload = { kind: 'bible', reference: `${bookLabel} ${v.chapter}:${v.verse}`, lines: [v.text] };
    renderStagePreview(stagedPayload);
  }

  function projectVerseAt(idx) {
    if (idx < 0 || idx >= bookVerses.length) return;
    verseIndex = idx;
    const v = bookVerses[idx];
    chapterSelectEl.value = String(v.chapter);
    renderVerseOptions();
    verseSelectEl.value = String(v.verse);
    const bookLabel = bookSelectEl.options[bookSelectEl.selectedIndex]?.textContent || '';
    lastLiveDescriptor = { kind: 'bible', translation: translationSelectEl.value, bookNumber: Number(bookSelectEl.value), chapter: v.chapter, verse: v.verse };
    send({ kind: 'bible', reference: `${bookLabel} ${v.chapter}:${v.verse}`, lines: [v.text] });
  }

  translationSelectEl.addEventListener('change', () => { renderBookOptions(); loadBook(); });
  bookSelectEl.addEventListener('change', loadBook);
  chapterSelectEl.addEventListener('change', renderVerseOptions);
  projectVerseBtn.addEventListener('click', stageSelectedVerse);
  prevVerseBtn.addEventListener('click', () => projectVerseAt(verseIndex - 1));
  nextVerseBtn.addEventListener('click', () => projectVerseAt(verseIndex + 1));

  // Jumps the Bible panel's own selection to an arbitrary reference
  // (not necessarily the book already loaded) and sends it live --
  // used by the voice-detected suggestion's "Show" button below.
  async function goLiveToBibleVerse(bookNumber, chapter, verse) {
    bookSelectEl.value = String(bookNumber);
    await loadBook();
    const idx = bookVerses.findIndex((v) => v.chapter === chapter && v.verse === verse);
    if (idx === -1) { window.alert(t('projection.voiceNotFound')); return; }
    projectVerseAt(idx);
  }

  // --- Voice-detected verse suggestions ---
  // Opt-in only (see utils/voiceVerseDetector.js) -- listening never
  // starts on its own, and a detected reference only ever raises a
  // one-tap suggestion here, never broadcasts by itself. Hidden
  // entirely on unsupported browsers (Firefox/Safari), same pattern
  // as the local-folder button.
  if (voiceSupported()) {
    voiceControlsEl.classList.remove('hidden');
    voiceControlsEl.classList.add('flex');
    voiceLangSelectEl.value = translationSelectEl.value === 'web' ? 'en-US' : 'fr-FR';

    const renderVoiceSuggestion = () => {
      if (!voiceSuggestion) {
        voiceSuggestionEl.classList.add('hidden');
        voiceSuggestionEl.classList.remove('flex');
        return;
      }
      const isFrench = translationSelectEl.value === 'lsg';
      const book = books.find((b) => b.number === voiceSuggestion.bookNumber);
      const bookLabel = book ? (isFrench ? book.name_fr : book.name_en) : `#${voiceSuggestion.bookNumber}`;
      voiceSuggestionTextEl.textContent = t('projection.voiceDetected', { reference: `${bookLabel} ${voiceSuggestion.chapter}:${voiceSuggestion.verse}` });
      voiceSuggestionEl.classList.remove('hidden');
      voiceSuggestionEl.classList.add('flex');
    };

    const setListeningButtonState = (listening) => {
      voiceToggleBtn.textContent = `🎤 ${listening ? t('projection.voiceListening') : t('projection.voiceListen')}`;
      voiceToggleBtn.classList.toggle('bg-red-600', listening);
      voiceToggleBtn.classList.toggle('text-white', listening);
      voiceToggleBtn.classList.toggle('bg-slate-100', !listening);
      voiceToggleBtn.classList.toggle('text-slate-700', !listening);
    };

    const startVoiceListening = () => {
      voiceDetector = createVoiceVerseDetector({
        lang: voiceLangSelectEl.value,
        aliases: voiceAliases,
        onDetect: (match) => { voiceSuggestion = match; renderVoiceSuggestion(); },
        onError: () => { setListeningButtonState(false); window.alert(t('projection.voiceMicDenied')); },
      });
      voiceDetector.start();
      setListeningButtonState(true);
    };

    const stopVoiceListening = () => {
      voiceDetector?.stop();
      setListeningButtonState(false);
    };

    voiceToggleBtn.addEventListener('click', () => {
      if (voiceDetector?.isListening()) stopVoiceListening();
      else startVoiceListening();
    });

    // Switching language while live just restarts recognition with
    // the new one -- there's no in-place way to change Chrome's
    // SpeechRecognition.lang on a running session.
    voiceLangSelectEl.addEventListener('change', () => {
      if (voiceDetector?.isListening()) { stopVoiceListening(); startVoiceListening(); }
    });

    voiceShowBtn.addEventListener('click', async () => {
      if (!voiceSuggestion) return;
      const { bookNumber, chapter, verse } = voiceSuggestion;
      voiceSuggestion = null;
      renderVoiceSuggestion();
      await goLiveToBibleVerse(bookNumber, chapter, verse);
    });

    voiceDismissBtn.addEventListener('click', () => { voiceSuggestion = null; renderVoiceSuggestion(); });
  }

  // --- Song panel ---
  // Full list loaded once and filtered client-side (rather than a
  // search-only results dropdown) so the whole repertoire is always
  // browsable, and every stanza renders as its own jump-to button (not
  // just Next/Previous) so the operator can snap straight back to
  // verse 1 when the choir repeats it, without stepping through
  // everything in between.

  async function loadSongList() {
    const { data } = await supabase.from('songs').select('id, title').order('title');
    allSongs = data || [];
    renderSongList(allSongs);
  }

  function renderSongList(rows) {
    if (rows.length === 0) {
      songListEl.innerHTML = `<p class="text-sm text-slate-400 px-3 py-2">${t('projection.noSongsYet')}</p>`;
      return;
    }
    songListEl.innerHTML = rows.map((r) => `<button type="button" data-song-id="${r.id}" class="block w-full text-left px-3 py-2 text-sm hover:bg-slate-50">${escapeHtml(r.title)}</button>`).join('');
    songListEl.querySelectorAll('[data-song-id]').forEach((btn) => {
      btn.addEventListener('click', () => selectSong(btn.dataset.songId, rows.find((r) => r.id === btn.dataset.songId).title));
    });
  }

  songSearchEl.addEventListener('input', () => {
    const query = songSearchEl.value.trim().toLowerCase();
    renderSongList(query ? allSongs.filter((s) => s.title.toLowerCase().includes(query)) : allSongs);
  });

  // Opens the exact same admin editor Choir's own song library uses
  // (js/components/songCreatorModal.js) -- not a separate, lighter
  // "quick add" -- a song created here is a real `songs` row,
  // immediately usable from Choir's side too. Saving re-loads the
  // list and jumps straight to the new song so the operator can start
  // projecting it without a second trip through search.
  const songCreatorModal = createSongCreatorModal({
    supabase,
    onCreated: async (song) => {
      await loadSongList();
      selectSong(song.id, song.title);
    },
  });
  container.querySelector('[data-action="new-song"]').addEventListener('click', () => songCreatorModal.open());

  // --- Themes ---
  // Cloud-stored (unlike local-only Image/Video/Presentation) -- tiny
  // rows, same for every operator/computer on this tenant. "Use" sets
  // the active theme for the rest of THIS session (broadcast right
  // away); "Set as default" additionally persists it so future
  // sessions start with it already active.
  let activeThemes = { songs: null, bible: null, media: null };

  function broadcastTheme(category, theme) {
    activeThemes[category] = theme;
    channel.postMessage({ event: 'theme', category, theme });

    // A theme now carries its own text size -- applying one (Use/Set
    // default, or the initial default load) moves the shared
    // font-scale slider to match, same as if the operator had dragged
    // it there themselves. Only Bible/Song actually render through
    // that slider (fontSizeFor()) today -- Media's countdown/
    // presentation text isn't scale-driven yet.
    const kindForCategory = category === 'songs' ? 'song' : category === 'bible' ? 'bible' : null;
    if (kindForCategory && theme.font_scale) {
      currentFontScale = theme.font_scale;
      fontScaleEl.value = String(Math.round(theme.font_scale * 100));
      fontScaleValueEl.textContent = `${fontScaleEl.value}%`;
      if (currentPayload?.kind === kindForCategory) send(currentPayload);
      else saveState();
    }
  }

  const themeModal = createProjectionThemeModal({
    supabase,
    onThemeChanged: (category, theme) => broadcastTheme(category, theme),
  });
  container.querySelector('[data-action="open-themes"]').addEventListener('click', () => themeModal.open());

  themeModal.getDefaultThemes().then((defaults) => {
    Object.entries(defaults).forEach(([category, theme]) => broadcastTheme(category, theme));
  });

  async function selectSong(songId, title) {
    let lyrics = null;
    try {
      const { data, error } = await supabase.from('songs').select('lyrics').eq('id', songId).single();
      if (error) throw error;
      lyrics = data?.lyrics;
    } catch {
      // No connectivity (or some other fetch failure) -- fall back to
      // whatever was cached locally the last time this song was shown.
      // See cacheCurrentSongIfPossible() below for how it got there.
      if (localFolderHandle) {
        const cache = await localMediaStore.readSongsCache(localFolderHandle);
        lyrics = cache[songId]?.lyrics ?? null;
      }
    }
    songTitle = title;
    selectedSongId = songId;
    currentSongLyrics = lyrics || '';
    songSlides = splitLyricsIntoSlides(lyrics);

    songSelectedEl.textContent = t('projection.selectedSong', { title });
    scheduleSongBtn.classList.remove('hidden');
    slideIndex = -1;
    // A stanza staged from the previous song no longer means anything
    // once the song itself changes.
    if (stagedKind === 'song') clearStaged();
    renderSlideGrid();

    const hasSlides = songSlides.length > 0;
    prevSlideBtn.disabled = true;
    nextSlideBtn.disabled = !hasSlides;
    slidePositionEl.textContent = hasSlides ? '' : t('projection.songHasNoLyrics');
  }

  // A grid of jump-anywhere targets is easy to mis-click mid-service —
  // a single click only STAGES a slide into the Preview box (so you
  // can read it before it's in front of the congregation); it only
  // goes live via the "Send to Live" button, or a double-click as a
  // one-step shortcut once you trust the click. Next/Previous stay
  // immediate — they're a much more deliberate, linear action.
  function renderSlideGrid() {
    slideGridEl.innerHTML = songSlides.map((lines, idx) => `
      <button type="button" data-slide-idx="${idx}" title="${escapeHtml(lines[0] || '')}"
              class="w-9 h-9 rounded-lg text-sm font-medium border ${
                idx === slideIndex ? 'bg-emerald-600 text-white border-emerald-600'
                : idx === stagedSlideIndex ? 'bg-indigo-100 text-indigo-700 border-indigo-400'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }">
        ${idx + 1}
      </button>
    `).join('');
    slideGridEl.querySelectorAll('[data-slide-idx]').forEach((btn) => {
      const idx = Number(btn.dataset.slideIdx);
      btn.addEventListener('click', () => stageSlideAt(idx));
      btn.addEventListener('dblclick', () => { stageSlideAt(idx); sendStaged(); });
    });
  }

  function clearStaged() {
    stagedKind = null;
    stagedPayload = null;
    stagedBibleIndex = -1;
    stagedSlideIndex = -1;
    stagedPresentationSlideIndex = -1;
    renderStagePreview(null);
  }

  function stageSlideAt(idx) {
    if (idx < 0 || idx >= songSlides.length) return;
    stagedKind = 'song';
    stagedSlideIndex = idx;
    stagedPayload = { kind: 'song', reference: songTitle, lines: songSlides[idx] };
    renderSlideGrid();
    renderStagePreview(stagedPayload);
  }

  // The one action behind the arrow between Preview and Now Showing —
  // routes to whichever tab actually staged something, since Bible and
  // Song need their own dropdowns/grid re-synced (not just a broadcast),
  // while Image/Video go out close to as-is.
  function sendStaged() {
    if (!stagedPayload) return;

    if (stagedKind === 'bible') {
      projectVerseAt(stagedBibleIndex);
    } else if (stagedKind === 'song') {
      projectSlideAt(stagedSlideIndex);
    } else if (stagedKind === 'image') {
      lastLiveDescriptor = { kind: 'image' };
      send({ kind: 'image', blob: stagedPayload.blob });
    } else if (stagedKind === 'video') {
      videoLoaded = true;
      videoPlaying = true;
      projectVideoBtn.disabled = false;
      toggleVideoBtn.disabled = false;
      toggleVideoBtn.textContent = t('projection.pause');
      lastLiveDescriptor = { kind: 'video' };
      send(buildVideoPlayPayload());
    } else if (stagedKind === 'presentation') {
      projectPresentationSlideAt(stagedPresentationSlideIndex);
    }

    clearStaged();
    renderSlideGrid();
  }

  sendStagedBtn.addEventListener('click', sendStaged);

  function projectSlideAt(idx) {
    if (idx < 0 || idx >= songSlides.length) return;
    slideIndex = idx;
    renderSlideGrid();
    prevSlideBtn.disabled = idx === 0;
    nextSlideBtn.disabled = idx === songSlides.length - 1;
    slidePositionEl.textContent = t('projection.slideOf', { current: idx + 1, total: songSlides.length });
    lastLiveDescriptor = { kind: 'song', songId: selectedSongId, songTitle, slideIndex: idx };
    send({ kind: 'song', reference: songTitle, lines: songSlides[idx] });
    cacheCurrentSongIfPossible();
  }

  // Any song (Choir-added or added here via "+ New Song") gets cached
  // to the local folder the first time it's actually sent live, not
  // just selected -- a read-through cache so a later service with no
  // connectivity can still pull up a previously-shown song from disk
  // instead of Supabase. No-op when no local folder is set up.
  function cacheCurrentSongIfPossible() {
    if (!localFolderHandle || !selectedSongId || !currentSongLyrics) return;
    localMediaStore.cacheSong(localFolderHandle, { id: selectedSongId, title: songTitle, lyrics: currentSongLyrics });
  }

  prevSlideBtn.addEventListener('click', () => projectSlideAt(slideIndex - 1));
  nextSlideBtn.addEventListener('click', () => projectSlideAt(slideIndex + 1));

  // --- Image panel ---
  // A local file, read straight from this computer — never uploaded.
  // Sent to the projector as the actual file (a Blob, structured-
  // cloned over the BroadcastChannel), which mints its own local
  // preview from it; nothing here ever becomes a URL on any server.

  // Every file picked gets ADDED to the library (folder-backed or
  // in-memory, see renderImageLibrary above) -- picking a new one
  // never discards the previous ones, only the live preview/staged
  // pick moves to whichever was picked last.
  imageInputEl.addEventListener('change', async () => {
    const files = Array.from(imageInputEl.files || []);
    if (files.length === 0) return;
    for (const file of files) {
      if (localFolderHandle) {
        await localMediaStore.saveFile(localFolderHandle, file);
      } else {
        memoryImageItems = memoryImageItems.filter((i) => i.name !== file.name);
        memoryImageItems.push({ name: file.name, blob: file });
      }
    }
    selectImageFile(files[files.length - 1]);
    imageInputEl.value = ''; // so picking the same filename again later still fires 'change'
    renderImageLibrary();
  });

  projectImageBtn.addEventListener('click', () => {
    if (!pendingImageBlob) return;
    stagedKind = 'image';
    stagedPayload = { kind: 'image', blob: pendingImageBlob };
    renderStagePreview(stagedPayload);
  });

  // --- Video panel ---

  container.querySelector('[data-action="load-youtube"]').addEventListener('click', () => {
    const videoId = extractYouTubeId(youtubeInputEl.value.trim());
    if (!videoId) { window.alert(t('projection.invalidYoutubeUrl')); return; }
    pendingVideo = { source: 'youtube', videoId };
    pendingVideoBlob = null;
    videoSelectedEl.textContent = t('projection.videoReady');
    projectVideoBtn.disabled = false;
  });

  // Same "add, never replace" behavior as the image input above.
  videoInputEl.addEventListener('change', async () => {
    const files = Array.from(videoInputEl.files || []);
    if (files.length === 0) return;
    for (const file of files) {
      if (localFolderHandle) {
        await localMediaStore.saveFile(localFolderHandle, file);
      } else {
        memoryVideoItems = memoryVideoItems.filter((i) => i.name !== file.name);
        memoryVideoItems.push({ name: file.name, blob: file });
      }
    }
    selectVideoFile(files[files.length - 1]);
    videoInputEl.value = '';
    renderVideoLibrary();
  });

  function buildVideoPlayPayload() {
    if (pendingVideo.source === 'youtube') return { kind: 'video', action: 'play', source: 'youtube', videoId: pendingVideo.videoId };
    return { kind: 'video', action: 'play', source: 'file', blob: pendingVideoBlob };
  }

  projectVideoBtn.addEventListener('click', () => {
    if (!pendingVideo) return;
    stagedKind = 'video';
    stagedPayload = buildVideoPlayPayload();
    renderStagePreview(stagedPayload);
  });

  toggleVideoBtn.addEventListener('click', () => {
    if (!videoLoaded) return;
    videoPlaying = !videoPlaying;
    toggleVideoBtn.textContent = videoPlaying ? t('projection.pause') : t('projection.resume');
    // No blob needed here — the projector already has the video
    // loaded locally, a pause/resume is just an instruction, not new
    // content to hand over.
    send({ kind: 'video', action: videoPlaying ? 'resume' : 'pause', source: pendingVideo.source, videoId: pendingVideo.videoId });
  });

  // --- Presentation panel ---
  // Same click-to-stage/double-click-to-go-live grid pattern as Songs
  // (renderSlideGrid), generalized to a hand-built/imported slide deck
  // instead of a lyrics split. Persisted to the local folder (if one's
  // connected) the same way Image/Video are -- see
  // savePresentationState()/restorePresentationState() below.

  function newSlideId() {
    return (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  }

  // Writes the whole deck to disk: each slide's own background image
  // (if any) as its own file named by the slide's stable id (so
  // re-saving after an edit overwrites it in place rather than piling
  // up a new file every time), plus a JSON manifest referencing those
  // filenames (a Blob itself can't go in JSON). No-op without a
  // connected folder -- same "local file, nothing persists without a
  // folder" tradeoff as Image/Video.
  async function savePresentationState() {
    if (!localFolderHandle) return;
    const manifest = [];
    for (const slide of presentationSlides) {
      let backgroundImageName = null;
      if (slide.backgroundBlob) {
        const ext = slide.backgroundBlob.type === 'image/jpeg' ? 'jpg' : 'png';
        backgroundImageName = `presentation-${slide.id}.${ext}`;
        await localMediaStore.saveFile(localFolderHandle, new File([slide.backgroundBlob], backgroundImageName, { type: slide.backgroundBlob.type || 'image/png' }));
      }
      manifest.push({ id: slide.id, text: slide.text, backgroundColor: slide.backgroundColor, backgroundImageName });
    }
    await localMediaStore.savePresentationDeck(localFolderHandle, manifest);
  }

  async function restorePresentationState() {
    if (!localFolderHandle) return;
    const manifest = await localMediaStore.readPresentationDeck(localFolderHandle);
    if (!manifest) return;
    presentationSlides = [];
    for (const entry of manifest) {
      let backgroundBlob = null;
      if (entry.backgroundImageName) {
        try { backgroundBlob = await localMediaStore.readFile(localFolderHandle, entry.backgroundImageName); } catch { backgroundBlob = null; }
      }
      presentationSlides.push({ id: entry.id || newSlideId(), text: entry.text, backgroundColor: entry.backgroundColor, backgroundBlob });
    }
    renderPresentationSlideGrid();
  }

  function renderPresentationSlideGrid() {
    presentationSlideGridEl.innerHTML = presentationSlides.map((slide, idx) => `
      <button type="button" data-pres-slide-idx="${idx}" title="${escapeAttr((slide.text || '').slice(0, 60))}"
              class="w-9 h-9 rounded-lg text-sm font-medium border ${
                idx === presentationSlideIndex ? 'bg-emerald-600 text-white border-emerald-600'
                : idx === stagedPresentationSlideIndex ? 'bg-indigo-100 text-indigo-700 border-indigo-400'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }">
        ${idx + 1}
      </button>
    `).join('');
    presentationSlideGridEl.querySelectorAll('[data-pres-slide-idx]').forEach((btn) => {
      const idx = Number(btn.dataset.presSlideIdx);
      btn.addEventListener('click', () => { stagePresentationSlideAt(idx); openPresentationEditor(idx); });
      btn.addEventListener('dblclick', () => { stagePresentationSlideAt(idx); sendStaged(); });
    });
    prevPresentationSlideBtn.disabled = presentationSlideIndex <= 0;
    nextPresentationSlideBtn.disabled = presentationSlideIndex === -1 || presentationSlideIndex >= presentationSlides.length - 1;
  }

  function stagePresentationSlideAt(idx) {
    if (idx < 0 || idx >= presentationSlides.length) return;
    stagedKind = 'presentation';
    stagedPresentationSlideIndex = idx;
    const slide = presentationSlides[idx];
    stagedPayload = { kind: 'presentation', text: slide.text, backgroundColor: slide.backgroundColor, backgroundBlob: slide.backgroundBlob };
    renderPresentationSlideGrid();
    renderStagePreview(stagedPayload);
  }

  function projectPresentationSlideAt(idx) {
    if (idx < 0 || idx >= presentationSlides.length) return;
    presentationSlideIndex = idx;
    const slide = presentationSlides[idx];
    // Not DB-restorable (may carry a local Blob) -- same "local media
    // lost on reload" notice as Image/Video, see the restore block below.
    lastLiveDescriptor = { kind: 'presentation' };
    renderPresentationSlideGrid();
    send({ kind: 'presentation', text: slide.text, backgroundColor: slide.backgroundColor, backgroundBlob: slide.backgroundBlob });
  }

  function openPresentationEditor(idx) {
    presentationEditIndex = idx;
    const slide = presentationSlides[idx];
    presentationEditorEl.classList.remove('hidden');
    slideTextInputEl.value = slide.text || '';
    slideColorInputEl.value = slide.backgroundColor || '#000000';
  }

  function refreshStagedPresentationPreview() {
    if (stagedPresentationSlideIndex !== presentationEditIndex) return;
    stagePresentationSlideAt(presentationEditIndex);
  }

  slideTextInputEl.addEventListener('input', () => {
    if (presentationEditIndex === -1) return;
    presentationSlides[presentationEditIndex].text = slideTextInputEl.value;
    refreshStagedPresentationPreview();
    savePresentationState();
  });

  slideColorInputEl.addEventListener('input', () => {
    if (presentationEditIndex === -1) return;
    presentationSlides[presentationEditIndex].backgroundColor = slideColorInputEl.value;
    refreshStagedPresentationPreview();
    savePresentationState();
  });

  slideImageInputEl.addEventListener('change', () => {
    if (presentationEditIndex === -1) return;
    const file = slideImageInputEl.files[0];
    if (!file) return;
    presentationSlides[presentationEditIndex].backgroundBlob = file;
    slideImageInputEl.value = '';
    refreshStagedPresentationPreview();
    savePresentationState();
  });

  container.querySelector('[data-action="delete-slide"]').addEventListener('click', async () => {
    if (presentationEditIndex === -1) return;
    const [removed] = presentationSlides.splice(presentationEditIndex, 1);
    presentationEditIndex = -1;
    presentationEditorEl.classList.add('hidden');
    if (stagedPresentationSlideIndex >= presentationSlides.length) stagedPresentationSlideIndex = -1;
    if (presentationSlideIndex >= presentationSlides.length) presentationSlideIndex = presentationSlides.length - 1;
    renderPresentationSlideGrid();
    await savePresentationState();
    // Clean up the orphaned background file (if any) now that the
    // manifest no longer references it -- otherwise the folder just
    // accumulates dead files every time a slide with an image is removed.
    if (removed?.backgroundBlob && localFolderHandle) {
      const ext = removed.backgroundBlob.type === 'image/jpeg' ? 'jpg' : 'png';
      await localMediaStore.deleteFile(localFolderHandle, `presentation-${removed.id}.${ext}`).catch(() => {});
    }
  });

  container.querySelector('[data-action="add-slide"]').addEventListener('click', () => {
    presentationSlides.push({ id: newSlideId(), text: '', backgroundColor: '#000000', backgroundBlob: null });
    renderPresentationSlideGrid();
    openPresentationEditor(presentationSlides.length - 1);
    savePresentationState();
  });

  pdfInputEl.addEventListener('change', async () => {
    const file = pdfInputEl.files[0];
    if (!file) return;
    pdfInputEl.value = '';
    const slides = await extractPdfPagesAsSlides(file);
    presentationSlides.push(...slides);
    renderPresentationSlideGrid();
    await savePresentationState();
  });

  pptxInputEl.addEventListener('change', async () => {
    const file = pptxInputEl.files[0];
    if (!file) return;
    pptxInputEl.value = '';
    const texts = await extractPptxSlideTexts(file);
    texts.forEach((text) => presentationSlides.push({ id: newSlideId(), text, backgroundColor: '#000000', backgroundBlob: null }));
    renderPresentationSlideGrid();
    await savePresentationState();
  });

  prevPresentationSlideBtn.addEventListener('click', () => projectPresentationSlideAt(presentationSlideIndex - 1));
  nextPresentationSlideBtn.addEventListener('click', () => projectPresentationSlideAt(presentationSlideIndex + 1));

  renderPresentationSlideGrid();

  // --- Countdown panel ---
  // Broadcasts an absolute end timestamp, not a relative "seconds
  // left" counter, so projectorPage.js can recompute the remaining
  // time from endsAt - Date.now() on every tick -- naturally immune
  // to a projector-side reload (its own `hello` reconnect resends
  // this same payload verbatim) with no special-cased recovery.

  container.querySelector('[data-action="start-countdown"]').addEventListener('click', () => {
    const text = countdownTextInputEl.value.trim();
    const minutes = Number(countdownMinutesInputEl.value);
    if (!minutes || minutes <= 0) return;
    const endsAt = new Date(Date.now() + minutes * 60000).toISOString();
    lastLiveDescriptor = { kind: 'countdown', text, endsAt };
    send({ kind: 'countdown', text, endsAt });
  });

  // --- Schedule ---
  // Plan a service's Bible verses/songs in advance (via each tab's "+
  // Add to Schedule" button), then during the live service just click
  // down the list. Image/Video aren't schedulable — a local file only
  // exists in this tab's memory at the moment it's picked, so there's
  // no stable link to store days ahead the way a verse reference or a
  // song id is. One schedule per calendar date (sql/077); nothing is
  // saved to the DB until the first item is actually added, so just
  // browsing dates doesn't litter the table with empty rows.

  let currentScheduleId = null;
  let scheduleItems = []; // [{id, position, kind, label, payload}], ordered

  function todayLocalDate() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  scheduleDateEl.value = todayLocalDate();
  scheduleDateEl.addEventListener('change', () => loadSchedule(scheduleDateEl.value));

  async function loadSchedule(date) {
    scheduleListEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const { data: existing } = await supabase.from('projection_schedules').select('id').eq('service_date', date).maybeSingle();
    if (!existing) {
      currentScheduleId = null;
      scheduleItems = [];
      renderScheduleList();
      return;
    }

    currentScheduleId = existing.id;
    const { data } = await supabase.from('projection_schedule_items').select('id, position, kind, label, payload').eq('schedule_id', existing.id).order('position');
    scheduleItems = data || [];
    renderScheduleList();
  }

  async function ensureScheduleId() {
    if (currentScheduleId) return currentScheduleId;
    const { data, error } = await supabase.from('projection_schedules')
      .upsert({ service_date: scheduleDateEl.value, updated_at: new Date().toISOString() }, { onConflict: 'tenant_id,service_date' })
      .select('id')
      .single();
    if (error) { window.alert(t('projection.scheduleSaveFailed', { message: error.message })); return null; }
    currentScheduleId = data.id;
    return currentScheduleId;
  }

  async function addToSchedule(kind, label, payload) {
    const scheduleId = await ensureScheduleId();
    if (!scheduleId) return;
    const position = scheduleItems.length > 0 ? Math.max(...scheduleItems.map((i) => i.position)) + 1 : 0;
    const { data, error } = await supabase.from('projection_schedule_items')
      .insert({ schedule_id: scheduleId, position, kind, label, payload })
      .select('id, position, kind, label, payload')
      .single();
    if (error) { window.alert(t('projection.scheduleSaveFailed', { message: error.message })); return; }
    scheduleItems.push(data);
    renderScheduleList();
  }

  async function removeScheduleItem(id) {
    const { error } = await supabase.from('projection_schedule_items').delete().eq('id', id);
    if (error) { window.alert(t('projection.scheduleSaveFailed', { message: error.message })); return; }
    scheduleItems = scheduleItems.filter((i) => i.id !== id);
    renderScheduleList();
  }

  async function moveScheduleItem(id, direction) {
    const idx = scheduleItems.findIndex((i) => i.id === id);
    const swapIdx = idx + direction;
    if (idx === -1 || swapIdx < 0 || swapIdx >= scheduleItems.length) return;

    const a = scheduleItems[idx];
    const b = scheduleItems[swapIdx];
    const [aPos, bPos] = [a.position, b.position];

    const [{ error: err1 }, { error: err2 }] = await Promise.all([
      supabase.from('projection_schedule_items').update({ position: bPos }).eq('id', a.id),
      supabase.from('projection_schedule_items').update({ position: aPos }).eq('id', b.id),
    ]);
    if (err1 || err2) { window.alert(t('projection.scheduleSaveFailed', { message: (err1 || err2).message })); return; }

    a.position = bPos;
    b.position = aPos;
    scheduleItems.sort((x, y) => x.position - y.position);
    renderScheduleList();
  }

  const SCHEDULE_ICONS = { bible: '📖', song: '🎵' };

  function renderScheduleList() {
    if (scheduleItems.length === 0) {
      scheduleListEl.innerHTML = `<p class="text-sm text-slate-400">${t('projection.scheduleEmpty')}</p>`;
      return;
    }
    const liveIdx = scheduleItems.findIndex((i) => i.id === liveScheduleItemId);
    scheduleListEl.innerHTML = scheduleItems.map((item, idx) => `
      <div class="flex items-center gap-2 border rounded-lg px-3 py-2 ${idx === liveIdx ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200'}" data-item-id="${item.id}">
        <button type="button" data-action="run-item" class="flex-1 text-left text-sm hover:text-indigo-700">
          ${SCHEDULE_ICONS[item.kind] || ''} ${escapeHtml(item.label)}
          ${idx === liveIdx ? `<span class="ml-2 text-xs font-semibold text-emerald-700">${t('projection.live')}</span>` : ''}
          ${idx === liveIdx + 1 ? `<span class="ml-2 text-xs font-semibold text-indigo-500">${t('projection.next')}</span>` : ''}
        </button>
        <button type="button" data-action="move-up" class="text-slate-400 hover:text-slate-700 disabled:opacity-30" ${idx === 0 ? 'disabled' : ''}>&uarr;</button>
        <button type="button" data-action="move-down" class="text-slate-400 hover:text-slate-700 disabled:opacity-30" ${idx === scheduleItems.length - 1 ? 'disabled' : ''}>&darr;</button>
        <button type="button" data-action="remove-item" class="text-rose-400 hover:text-rose-600">&times;</button>
      </div>
    `).join('');

    scheduleListEl.querySelectorAll('[data-item-id]').forEach((row) => {
      const id = row.dataset.itemId;
      const item = scheduleItems.find((i) => i.id === id);
      row.querySelector('[data-action="run-item"]').addEventListener('click', () => runScheduleItem(item));
      row.querySelector('[data-action="move-up"]').addEventListener('click', () => moveScheduleItem(id, -1));
      row.querySelector('[data-action="move-down"]').addEventListener('click', () => moveScheduleItem(id, 1));
      row.querySelector('[data-action="remove-item"]').addEventListener('click', () => removeScheduleItem(id));
    });
  }

  async function runScheduleItem(item) {
    if (item.kind === 'bible') {
      setMode('bible');
      const p = item.payload;
      if (translationSelectEl.value !== p.translation || Number(bookSelectEl.value) !== p.bookNumber) {
        translationSelectEl.value = p.translation;
        renderBookOptions();
        bookSelectEl.value = String(p.bookNumber);
        await loadBook();
      }
      const idx = bookVerses.findIndex((v) => v.chapter === p.chapter && v.verse === p.verse);
      if (idx !== -1) projectVerseAt(idx);
    } else if (item.kind === 'song') {
      setMode('song');
      await selectSong(item.payload.songId, item.label);
      if (songSlides.length > 0) projectSlideAt(0);
    }

    // send() (called above, synchronously, however we got here)
    // always clears this first — re-mark it live now that we know the
    // schedule item actually is what went out, so the list can show
    // LIVE/NEXT badges.
    liveScheduleItemId = item.id;
    renderScheduleList();
    saveState(); // send() already saved once, but with liveScheduleItemId still null at that point
  }

  scheduleVerseBtn.addEventListener('click', async () => {
    const chapter = Number(chapterSelectEl.value);
    const verse = Number(verseSelectEl.value);
    if (!chapter || !verse) return;
    const bookLabel = bookSelectEl.options[bookSelectEl.selectedIndex]?.textContent || '';
    await addToSchedule('bible', `${bookLabel} ${chapter}:${verse}`, {
      translation: translationSelectEl.value,
      bookNumber: Number(bookSelectEl.value),
      chapter,
      verse,
    });
  });

  scheduleSongBtn.addEventListener('click', async () => {
    if (!selectedSongId) return;
    await addToSchedule('song', songTitle, { songId: selectedSongId });
  });

  // Restore the panel's own view of reality after a reload/re-mount --
  // see PROJECTION_STATE_KEY's header comment. The projector window
  // itself needs nothing here; this never broadcasts.
  const savedState = readProjectionState();
  if (savedState?.mode) setMode(savedState.mode);
  if (savedState?.fontScale) {
    currentFontScale = savedState.fontScale;
    fontScaleEl.value = String(Math.round(savedState.fontScale * 100));
    fontScaleValueEl.textContent = `${fontScaleEl.value}%`;
  }
  const restoreLive = savedState?.live;
  lastLiveDescriptor = restoreLive || null;

  loadBooks().then(async () => {
    if (restoreLive?.kind !== 'bible') { await loadBook(); return; }
    translationSelectEl.value = restoreLive.translation;
    renderBookOptions();
    bookSelectEl.value = String(restoreLive.bookNumber);
    await loadBook();
    const idx = bookVerses.findIndex((v) => v.chapter === restoreLive.chapter && v.verse === restoreLive.verse);
    if (idx === -1) return;
    verseIndex = idx;
    chapterSelectEl.value = String(restoreLive.chapter);
    renderVerseOptions();
    verseSelectEl.value = String(restoreLive.verse);
    prevVerseBtn.disabled = idx === 0;
    nextVerseBtn.disabled = idx === bookVerses.length - 1;
    const bookLabel = bookSelectEl.options[bookSelectEl.selectedIndex]?.textContent || '';
    restoreNowShowing({ kind: 'bible', reference: `${bookLabel} ${restoreLive.chapter}:${restoreLive.verse}`, lines: [bookVerses[idx].text], fontScale: currentFontScale });
  });

  loadSongList().then(async () => {
    if (restoreLive?.kind !== 'song') return;
    await selectSong(restoreLive.songId, restoreLive.songTitle);
    const idx = restoreLive.slideIndex;
    if (idx < 0 || idx >= songSlides.length) return;
    slideIndex = idx;
    renderSlideGrid();
    prevSlideBtn.disabled = idx === 0;
    nextSlideBtn.disabled = idx === songSlides.length - 1;
    slidePositionEl.textContent = t('projection.slideOf', { current: idx + 1, total: songSlides.length });
    restoreNowShowing({ kind: 'song', reference: songTitle, lines: songSlides[idx], fontScale: currentFontScale });
  });

  // A countdown is just text + an absolute timestamp -- fully
  // restorable, no Blob involved -- so unlike Image/Video/Presentation
  // below, re-show it in "Now Showing" (not re-broadcast: the
  // projector window already independently ticks its own copy from
  // the same endsAt, see projectorPage.js's showCountdown()).
  if (restoreLive?.kind === 'countdown' && new Date(restoreLive.endsAt).getTime() > Date.now()) {
    restoreNowShowing({ kind: 'countdown', text: restoreLive.text, endsAt: restoreLive.endsAt });
  }

  // A local image/video/presentation Blob only ever lived in the
  // previous mount's JS heap -- there's nothing to read back after a
  // reload. Say so, rather than silently showing "nothing live" while
  // something might still actually be on the real screen.
  if (restoreLive?.kind === 'image' || restoreLive?.kind === 'video' || restoreLive?.kind === 'presentation') {
    nowShowingEl.innerHTML = `<p class="text-amber-300 text-sm">${t('projection.localMediaLostOnReload')}</p>`;
  }

  liveScheduleItemId = savedState?.liveScheduleItemId ?? null;
  loadSchedule(scheduleDateEl.value);

  return {
    destroy() {
      channel.close();
      voiceDetector?.stop();
      document.removeEventListener('click', closeSuggestionsOnOutsideClick);
      if (pendingImageObjectUrl) URL.revokeObjectURL(pendingImageObjectUrl);
      if (currentBackdropObjectUrl) URL.revokeObjectURL(currentBackdropObjectUrl);
      imageThumbnailUrls.forEach((url) => URL.revokeObjectURL(url));
      videoThumbnailUrls.forEach((url) => URL.revokeObjectURL(url));
      songCreatorModal.root.remove(); // appended to document.body, independent of `container`
      themeModal.root.remove();
    },
    // "Live" for the leave-guard means either actual content is on
    // screen, or the projector window itself is still open — an
    // operator who's set a background and gone fullscreen but hasn't
    // clicked Project on anything yet still considers that "a
    // projection" and shouldn't get silently switched away from it.
    isLive() {
      return !!(currentPayload && currentPayload.kind !== 'blank') || !!(projectorWindowRef && !projectorWindowRef.closed);
    },
  };
}

// One-off screen picker for the "Open Projector Screen" button --
// not reused elsewhere, so it's a plain function rather than a
// separate component module. Resolves once dismissed (chosen or
// cancelled), but repositioning the already-open projector window
// happens through onChoose, called synchronously from inside the
// picked button's own click handler.
function pickScreen(screens, onChoose) {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4';
    root.innerHTML = `
      <div class="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
        <h2 class="text-lg font-bold mb-4">${t('projection.chooseScreen')}</h2>
        <div class="space-y-2">
          ${screens.map((s, i) => `
            <button type="button" data-screen-idx="${i}" class="block w-full text-left px-4 py-3 rounded-lg border border-slate-200 hover:bg-slate-50">
              ${escapeHtml(s.label || t('projection.screenN', { n: i + 1, width: s.width, height: s.height }))}${s.isPrimary ? ` — ${t('projection.thisScreen')}` : ''}
            </button>
          `).join('')}
        </div>
      </div>
    `;
    document.body.appendChild(root);

    function finish(result) {
      document.body.removeChild(root);
      resolve(result);
    }

    root.querySelectorAll('[data-screen-idx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const chosen = screens[Number(btn.dataset.screenIdx)];
        onChoose(chosen);
        finish(chosen);
      });
    });
    root.addEventListener('click', (e) => { if (e.target === root) finish(null); });
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;');
}
