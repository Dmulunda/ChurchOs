// The flyer editor -- a real Fabric.js canvas with Canva-style tools:
// text (fonts, outline, shadow, spacing), photos (filters, flip, crop
// to a shape, remove a colour, AI background removal), shapes, layers,
// alignment, undo/redo, page format changes, solid/gradient/image
// backgrounds, and "edit an old flyer": import a JPG/PNG/PDF as the
// page background, then (beta) read its words with OCR so each line
// becomes an editable text box over a patch in the matching colour.
//
// Heavy libraries load on demand only (Fabric when the tab opens;
// pdf.js, Tesseract and the background-removal model only when their
// button is used). PNG export is Fabric's own toDataURL(); PDF export
// reuses window.jspdf, already loaded for memberIdCard.js.
import { t } from '../i18n.js';
import { FLYER_SIZES } from '../flyerTemplates.js';
import { registerUnsavedWork, unregisterUnsavedWork } from '../utils/unsavedWorkGuard.js';
import { confirmDialog } from './confirmDialog.js';

let fabricPromise = null;
function loadFabric() {
  if (!fabricPromise) fabricPromise = import('https://cdn.jsdelivr.net/npm/fabric@6/+esm');
  return fabricPromise;
}

const PDFJS_VERSION = '4.0.379';
let pdfjsPromise = null;
function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(`https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.mjs`).then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;
      return lib;
    });
  }
  return pdfjsPromise;
}

let tesseractPromise = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!tesseractPromise) {
    tesseractPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      s.onload = () => (window.Tesseract ? resolve(window.Tesseract) : reject(new Error('Tesseract not available')));
      s.onerror = () => { tesseractPromise = null; reject(new Error('Could not load the text reader')); };
      document.head.appendChild(s);
    });
  }
  return tesseractPromise;
}

let bgRemovalPromise = null;
function loadBackgroundRemoval() {
  if (!bgRemovalPromise) {
    bgRemovalPromise = import('https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.4.5/+esm')
      .catch(() => import('https://esm.sh/@imgly/background-removal@1.4.5'))
      .catch((err) => { bgRemovalPromise = null; throw err; });
  }
  return bgRemovalPromise;
}

// Safety net against a reload wiping out an in-progress flyer. Saved
// every few seconds while the editor is open and cleared once the real
// DB row is saved (or the editor is left via Back).
const DRAFT_STORAGE_KEY = 'choir-hub-flyer-draft';
const DRAFT_SAVE_INTERVAL_MS = 5000;

export function loadFlyerDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearFlyerDraft() {
  try { localStorage.removeItem(DRAFT_STORAGE_KEY); } catch { /* best effort */ }
}

let activeDraftInterval = null;
let activeKeyHandler = null;
let activeResizeHandler = null;

// Custom and lock properties kept in the saved JSON (Fabric 6's
// toObject() drops anything not listed).
const EXTRA_PROPS = ['flyerRole', 'flyerFx', 'flyerLocked', 'selectable', 'evented',
  'lockMovementX', 'lockMovementY', 'lockScalingX', 'lockScalingY', 'lockRotation', 'hasControls'];

// Google Fonts offered in the font menu, grouped like Canva's list.
// Loaded once with a single stylesheet when the editor opens.
const FONT_GROUPS = [
  { key: 'modern', fonts: ['Montserrat', 'Poppins', 'Inter', 'Raleway', 'Lato', 'Roboto'] },
  { key: 'display', fonts: ['Bebas Neue', 'Anton', 'Oswald', 'Archivo Black'] },
  { key: 'serif', fonts: ['Playfair Display', 'Fraunces', 'Merriweather', 'Cinzel'] },
  { key: 'script', fonts: ['Great Vibes', 'Dancing Script', 'Pacifico', 'Lobster'] },
  { key: 'classic', fonts: ['Arial', 'Georgia', 'Verdana', 'Courier New'] },
];
const GOOGLE_FONTS = ['Montserrat:wght@400;600;800', 'Poppins:wght@400;600;800', 'Raleway:wght@400;700', 'Lato:wght@400;700',
  'Roboto:wght@400;700', 'Bebas+Neue', 'Anton', 'Oswald:wght@400;700', 'Archivo+Black', 'Playfair+Display:ital,wght@0,400;0,700;1,400',
  'Merriweather:wght@400;700', 'Cinzel:wght@400;700', 'Great+Vibes', 'Dancing+Script:wght@400;700', 'Pacifico', 'Lobster'];
const FONT_LINK_ID = 'flyer-editor-fonts';

function ensureFontStylesheet() {
  if (document.getElementById(FONT_LINK_ID)) return;
  const link = document.createElement('link');
  link.id = FONT_LINK_ID;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?${GOOGLE_FONTS.map((f) => `family=${f}`).join('&')}&display=swap`;
  document.head.appendChild(link);
}

function familyName(fontFamily) {
  return String(fontFamily || 'Arial').split(',')[0].replace(/["']/g, '').trim();
}

async function loadFonts(families, fabric) {
  const unique = [...new Set(families.map(familyName))];
  await Promise.all(unique.map(async (fam) => {
    try {
      await Promise.all([document.fonts.load(`400 40px "${fam}"`), document.fonts.load(`700 40px "${fam}"`)]);
      fabric?.cache?.clearFontCache?.(fam);
    } catch { /* system font or offline -- the browser falls back */ }
  }));
}

const SWATCHES = ['#0B1F3A', '#E0B654', '#F6F4EF', '#FFFFFF', '#111827', '#7C3AED', '#DC2626', '#059669', '#2563EB', '#F97316'];
const GRADIENT_PRESETS = [
  ['#0B1F3A', '#1E3A8A'], ['#0B1F3A', '#E0B654'], ['#7C3AED', '#EC4899'],
  ['#F97316', '#FACC15'], ['#0EA5E9', '#22C55E'], ['#111827', '#4B5563'],
];

const ICONS = {
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  text: '<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  shape: '<rect x="3" y="3" width="8" height="8" rx="1"/><circle cx="17" cy="17" r="4"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  page: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  front: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/>',
  forward: '<path d="m18 15-6-6-6 6"/>',
  backward: '<path d="m6 9 6 6 6-6"/>',
  back: '<rect x="4" y="4" width="12" height="12" rx="2"/><path d="M20 8v10a2 2 0 0 1-2 2H8"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
  alignLeft: '<path d="M4 3v18"/><rect x="8" y="6" width="12" height="4" rx="1"/><rect x="8" y="14" width="7" height="4" rx="1"/>',
  alignCenter: '<path d="M12 3v18"/><rect x="5" y="6" width="14" height="4" rx="1"/><rect x="8" y="14" width="8" height="4" rx="1"/>',
  alignRight: '<path d="M20 3v18"/><rect x="4" y="6" width="12" height="4" rx="1"/><rect x="9" y="14" width="7" height="4" rx="1"/>',
  alignTop: '<path d="M3 4h18"/><rect x="6" y="8" width="4" height="12" rx="1"/><rect x="14" y="8" width="4" height="7" rx="1"/>',
  alignMiddle: '<path d="M3 12h18"/><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="8" width="4" height="8" rx="1"/>',
  alignBottom: '<path d="M3 20h18"/><rect x="6" y="4" width="4" height="12" rx="1"/><rect x="14" y="9" width="4" height="7" rx="1"/>',
  flipH: '<path d="M12 3v18"/><path d="M8 7 3 12l5 5V7z"/><path d="M16 7l5 5-5 5V7z"/>',
  flipV: '<path d="M3 12h18"/><path d="M7 8l5-5 5 5H7z"/><path d="M7 16l5 5 5-5H7z"/>',
  wand: '<path d="m15 4-1 2-2 1 2 1 1 2 1-2 2-1-2-1z"/><path d="M3 21 14 10"/>',
  eyedrop: '<path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3z"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/>',
};
function icon(name, size = 16) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

// Template elements are fractions of the canvas (0-1) so one template
// works at every size preset.
function applyTemplate(fabric, canvas, template, size) {
  canvas.backgroundColor = template?.background || '#ffffff';
  (template?.elements || []).forEach((el) => {
    if (el.type === 'rect') {
      canvas.add(new fabric.Rect({
        left: el.left * size.width,
        top: el.top * size.height,
        width: el.width * size.width,
        height: (el.height || 0.1) * size.height,
        fill: el.fill,
      }));
    } else if (el.type === 'text') {
      const textbox = new fabric.Textbox(el.text, {
        left: el.left * size.width,
        top: el.top * size.height,
        width: el.width * size.width,
        fontSize: Math.max(8, Math.round(el.fontSize * size.height)),
        fontFamily: el.fontFamily,
        fill: el.fill,
        fontWeight: el.fontWeight || 'normal',
        textAlign: el.textAlign || 'left',
      });
      textbox.flyerRole = el.role || null;
      canvas.add(textbox);
    }
  });
  canvas.renderAll();
}

function applyEventPrefill(canvas, prefill) {
  if (!prefill) return;
  canvas.getObjects().forEach((obj) => {
    if (obj.flyerRole === 'title' && prefill.title) obj.set('text', prefill.title);
    if (obj.flyerRole === 'info' && prefill.infoLine) obj.set('text', prefill.infoLine);
  });
  canvas.renderAll();
}

async function addImageCorner(fabric, canvas, url, size, { corner, widthFraction }) {
  try {
    const img = await fabric.FabricImage.fromURL(url, { crossOrigin: 'anonymous' });
    const targetWidth = size.width * widthFraction;
    const scale = targetWidth / img.width;
    const margin = size.width * 0.02;
    const left = corner.includes('right') ? size.width - targetWidth - margin : margin;
    const top = corner.includes('bottom') ? size.height - (img.height * scale) - margin : margin;
    img.set({ left, top, scaleX: scale, scaleY: scale });
    canvas.add(img);
  } catch {
    // Logo/QR failed to load -- not worth blocking flyer creation over.
  }
}

// Every picture is re-encoded in the browser before upload so it always
// fits the storage limit, whatever comes in: 20 MB phone photos, huge
// PNG scans, WebP/GIF, iPhone HEIC (where the browser can open it).
// Transparent pictures stay PNG (logos, cut-outs); everything else
// becomes a JPEG. If the result is still too big, the size steps down.
const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;

async function decodeImage(file) {
  try {
    return await createImageBitmap(file);
  } catch {
    // Some browsers only decode certain formats (e.g. HEIC on Safari)
    // through an <img> element.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function hasTransparency(source, w, h) {
  try {
    const c = document.createElement('canvas');
    c.width = Math.min(64, w);
    c.height = Math.min(64, h);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
  } catch { /* ignore */ }
  return false;
}

async function prepareImage(file, maxSide = 2400) {
  let source;
  try {
    source = await decodeImage(file);
  } catch {
    const err = new Error(t('flyers.imageUnreadable'));
    err.userFacing = true;
    throw err;
  }
  const w0 = source.width || source.naturalWidth;
  const h0 = source.height || source.naturalHeight;
  const keepAlpha = (file.type === 'image/png' || file.type === 'image/webp' || file.type === 'image/gif') && hasTransparency(source, w0, h0);
  let side = Math.min(maxSide, Math.max(w0, h0));
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const scale = side / Math.max(w0, h0);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w0 * scale));
    c.height = Math.max(1, Math.round(h0 * scale));
    const ctx = c.getContext('2d');
    if (!keepAlpha) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height); }
    ctx.drawImage(source, 0, 0, c.width, c.height);
    const type = keepAlpha ? 'image/png' : 'image/jpeg';
    const blob = await new Promise((resolve) => c.toBlob(resolve, type, 0.86));
    if (blob && blob.size <= MAX_UPLOAD_BYTES) return blob;
    side = Math.round(side * 0.75);
  }
  const err = new Error(t('flyers.imageTooBig'));
  err.userFacing = true;
  throw err;
}

async function pdfFirstPageToBlob(file) {
  const pdfjs = await loadPdfJs();
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const page = await pdf.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(3, 2000 / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const c = document.createElement('canvas');
  c.width = Math.round(viewport.width);
  c.height = Math.round(viewport.height);
  await page.render({ canvasContext: c.getContext('2d'), viewport }).promise;
  const png = await new Promise((resolve) => c.toBlob(resolve, 'image/png'));
  return prepareImage(new File([png], 'flyer.png', { type: 'image/png' }), 2400);
}

function colorDistance(a, b) {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}
function rgbToHex([r, g, b]) {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}
function medianColor(pixels) {
  if (!pixels.length) return [255, 255, 255];
  const pick = (i) => { const arr = pixels.map((p) => p[i]).sort((x, y) => x - y); return arr[Math.floor(arr.length / 2)]; };
  return [pick(0), pick(1), pick(2)];
}
// Background colour = median of the pixels just around a word box; text
// colour = average of the inside pixels that differ most from it.
function sampleColors(ctx, box, imgW, imgH) {
  const pad = 4;
  const x0 = Math.max(0, Math.floor(box.x0 - pad));
  const y0 = Math.max(0, Math.floor(box.y0 - pad));
  const x1 = Math.min(imgW - 1, Math.ceil(box.x1 + pad));
  const y1 = Math.min(imgH - 1, Math.ceil(box.y1 + pad));
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  if (w < 2 || h < 2) return { bg: '#ffffff', fg: '#000000' };
  const data = ctx.getImageData(x0, y0, w, h).data;
  const at = (x, y) => { const i = (y * w + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
  const edge = [];
  for (let x = 0; x < w; x += 1) { edge.push(at(x, 0), at(x, h - 1)); }
  for (let y = 0; y < h; y += 1) { edge.push(at(0, y), at(w - 1, y)); }
  const bg = medianColor(edge);
  const inside = [];
  for (let y = pad; y < h - pad; y += 1) {
    for (let x = pad; x < w - pad; x += 1) inside.push(at(x, y));
  }
  const far = inside.map((p) => ({ p, d: colorDistance(p, bg) })).sort((a, b) => b.d - a.d);
  const top = far.slice(0, Math.max(1, Math.floor(far.length * 0.15))).map((x) => x.p);
  const fg = top.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0]).map((v) => v / top.length);
  return { bg: rgbToHex(bg), fg: rgbToHex(fg) };
}

export async function renderFlyerEditor(container, {
  supabase, tenantId, currentUserId, canManage,
  flyerId, template, sizeKey, logoUrl, eventPrefill, resumeDraft,
  onBack, onSaved,
}) {
  if (activeDraftInterval) { clearInterval(activeDraftInterval); activeDraftInterval = null; }
  if (activeKeyHandler) { document.removeEventListener('keydown', activeKeyHandler); activeKeyHandler = null; }
  if (activeResizeHandler) { window.removeEventListener('resize', activeResizeHandler); activeResizeHandler = null; }
  unregisterUnsavedWork('flyer-editor');

  container.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;
  ensureFontStylesheet();
  const fabric = await loadFabric();

  const workingFlyerId = resumeDraft?.workingFlyerId || flyerId || crypto.randomUUID();
  const tenantPrefix = tenantId ? `${tenantId}/` : '';
  let existingCategory = resumeDraft ? resumeDraft.category : (template?.category || null);
  let existingEventId = resumeDraft ? resumeDraft.eventId : (eventPrefill?.eventId || null);
  let size = resumeDraft ? { width: resumeDraft.canvasWidth, height: resumeDraft.canvasHeight } : (sizeKey ? FLYER_SIZES[sizeKey] : null);
  let existingFlyer = null;

  if (flyerId && !resumeDraft) {
    const { data } = await supabase.from('flyers').select('*').eq('id', flyerId).single();
    existingFlyer = data;
    size = { width: data.canvas_width, height: data.canvas_height };
    existingCategory = data.category;
    existingEventId = data.event_id;
  }
  if (!size) size = FLYER_SIZES.instagram_square;
  size = { width: size.width, height: size.height };

  const sizeOptions = () => {
    const match = Object.entries(FLYER_SIZES).find(([, s]) => s.width === size.width && s.height === size.height);
    return `
      ${match ? '' : `<option value="" selected>${t('flyers.format.current', { w: size.width, h: size.height })}</option>`}
      ${Object.entries(FLYER_SIZES).map(([key, s]) => `<option value="${key}" ${match && match[0] === key ? 'selected' : ''}>${t(s.labelKey)} · ${s.width}×${s.height}</option>`).join('')}
      <option value="custom">${t('flyers.format.custom')}</option>`;
  };

  const btn = (action, label, iconName, extra = '') => `<button type="button" data-action="${action}" class="fly-btn ${extra}" title="${escapeAttr(label)}">${iconName ? icon(iconName) : ''}<span>${escapeHtml(label)}</span></button>`;
  const iconBtn = (action, label, iconName, extra = '') => `<button type="button" data-action="${action}" class="fly-icon-btn ${extra}" title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}">${icon(iconName)}</button>`;

  container.innerHTML = `
    <div class="fly-editor">
      <div class="fly-top">
        <button type="button" data-action="back" class="fly-link">&larr; ${t('flyers.backToList')}</button>
        <input type="text" data-el="flyer-title" value="${escapeAttr((resumeDraft ? resumeDraft.title : existingFlyer?.title) || '')}" placeholder="${t('flyers.titlePlaceholder')}"
               class="fly-title" ${canManage ? '' : 'readonly'} />
        <div class="fly-top-actions">
          ${canManage ? `
            ${iconBtn('undo', t('flyers.undo'), 'undo')}
            ${iconBtn('redo', t('flyers.redo'), 'redo')}
            <label class="fly-format" title="${escapeAttr(t('flyers.format.label'))}">
              ${icon('page')}
              <select data-el="format-select" aria-label="${escapeAttr(t('flyers.format.label'))}">${sizeOptions()}</select>
            </label>` : ''}
          ${btn('export-png', t('flyers.exportPng'), 'download')}
          ${btn('export-pdf', t('flyers.exportPdf'), '')}
          ${canManage ? `<button type="button" data-action="save" class="fly-btn fly-btn--primary">${t('flyers.save')}</button>` : ''}
        </div>
      </div>
      ${canManage ? `
        <div class="fly-tools">
          ${btn('add-heading', t('flyers.addHeading'), 'text')}
          ${btn('add-text', t('flyers.addText'), '')}
          <label class="fly-btn" title="${escapeAttr(t('flyers.addPhoto'))}">${icon('image')}<span>${t('flyers.addPhoto')}</span>
            <input type="file" accept="image/*" data-el="photo-input" class="hidden" />
          </label>
          <div class="fly-menu">
            <button type="button" data-action="toggle-shapes" class="fly-btn">${icon('shape')}<span>${t('flyers.addShape')}</span></button>
            <div data-el="shape-menu" class="fly-menu-list hidden">
              <button type="button" data-shape="rect">${t('flyers.shape.rect')}</button>
              <button type="button" data-shape="rounded">${t('flyers.shape.rounded')}</button>
              <button type="button" data-shape="circle">${t('flyers.shape.circle')}</button>
              <button type="button" data-shape="triangle">${t('flyers.shape.triangle')}</button>
              <button type="button" data-shape="line">${t('flyers.shape.line')}</button>
            </div>
          </div>
          <span class="fly-sep"></span>
          <label class="fly-btn fly-btn--gold" title="${escapeAttr(t('flyers.importOldHint'))}">${icon('upload')}<span>${t('flyers.importOld')}</span>
            <input type="file" accept="image/*,application/pdf" data-el="import-input" class="hidden" />
          </label>
          ${btn('show-page', t('flyers.pageAndBackground'), 'page')}
        </div>
      ` : ''}
      <div class="fly-body">
        <div data-el="canvas-wrap" class="fly-stage">
          <canvas data-el="fabric-canvas"></canvas>
        </div>
        ${canManage ? '<aside data-el="properties-panel" class="fly-panel"></aside>' : ''}
      </div>
      <p data-el="status" class="fly-status"></p>
    </div>
  `;

  const canvasEl = container.querySelector('[data-el="fabric-canvas"]');
  const titleInput = container.querySelector('[data-el="flyer-title"]');
  const statusEl = container.querySelector('[data-el="status"]');
  const panelEl = container.querySelector('[data-el="properties-panel"]');
  const wrapEl = container.querySelector('[data-el="canvas-wrap"]');

  function setStatus(message, tone = 'muted') {
    statusEl.className = `fly-status fly-status--${tone}`;
    statusEl.textContent = message || '';
  }

  container.querySelector('[data-action="back"]').addEventListener('click', () => {
    teardown();
    clearFlyerDraft();
    onBack();
  });

  function teardown() {
    if (activeDraftInterval) { clearInterval(activeDraftInterval); activeDraftInterval = null; }
    if (activeKeyHandler) { document.removeEventListener('keydown', activeKeyHandler); activeKeyHandler = null; }
    if (activeResizeHandler) { window.removeEventListener('resize', activeResizeHandler); activeResizeHandler = null; }
    unregisterUnsavedWork('flyer-editor');
  }

  const canvas = new fabric.Canvas(canvasEl, {
    width: size.width, height: size.height, backgroundColor: '#ffffff', preserveObjectStacking: true,
  });
  canvas.selection = canManage;

  function fitToScreen() {
    const maxW = Math.max(200, wrapEl.clientWidth - 32);
    const maxH = Math.min(window.innerHeight * 0.7, 760);
    const scale = Math.min(maxW / size.width, maxH / size.height, 1);
    canvas.setDimensions({ width: size.width * scale, height: size.height * scale });
    canvas.setZoom(scale);
    canvas.requestRenderAll();
  }

  async function loadJson(json) {
    const fams = [];
    (json?.objects || []).forEach((o) => { if (o.fontFamily) fams.push(o.fontFamily); });
    await loadFonts(fams, fabric);
    await canvas.loadFromJSON(json);
    canvas.getObjects().forEach((o) => { if (o.flyerRole === 'background') lockAsBackground(o); });
    canvas.renderAll();
  }

  if (resumeDraft) {
    await loadJson(resumeDraft.canvasJson);
  } else if (existingFlyer) {
    await loadJson(existingFlyer.canvas_json);
  } else {
    await loadFonts((template?.elements || []).map((e) => e.fontFamily).filter(Boolean), fabric);
    applyTemplate(fabric, canvas, template, size);
    applyEventPrefill(canvas, eventPrefill);
    if (logoUrl) await addImageCorner(fabric, canvas, logoUrl, size, { corner: 'top-right', widthFraction: 0.18 });
    if (eventPrefill?.qrDataUrl) await addImageCorner(fabric, canvas, eventPrefill.qrDataUrl, size, { corner: 'bottom-right', widthFraction: 0.16 });
  }

  if (!canManage) {
    canvas.forEachObject((o) => { o.selectable = false; o.evented = false; });
  }

  fitToScreen();
  activeResizeHandler = fitToScreen;
  window.addEventListener('resize', fitToScreen);

  wireExports();
  if (!canManage) return;

  // ---------- history (undo / redo) ----------
  const history = [];
  let historyIndex = -1;
  let restoring = false;
  let historyTimer = null;
  function snapshot() {
    return JSON.stringify({ w: size.width, h: size.height, json: canvas.toObject(EXTRA_PROPS) });
  }
  function pushHistoryNow() {
    if (restoring) return;
    const snap = snapshot();
    if (history[historyIndex] === snap) return;
    history.splice(historyIndex + 1);
    history.push(snap);
    if (history.length > 50) history.shift();
    historyIndex = history.length - 1;
    updateHistoryButtons();
  }
  function pushHistory() {
    if (restoring) return;
    clearTimeout(historyTimer);
    historyTimer = setTimeout(pushHistoryNow, 300);
  }
  async function restore(index) {
    if (index < 0 || index >= history.length) return;
    clearTimeout(historyTimer);
    restoring = true;
    try {
      const { w, h, json } = JSON.parse(history[index]);
      size = { width: w, height: h };
      canvas.discardActiveObject();
      await loadJson(json);
      historyIndex = index;
      fitToScreen();
      refreshFormatSelect();
      renderPanel();
    } finally {
      restoring = false;
      updateHistoryButtons();
    }
  }
  const undoBtn = container.querySelector('[data-action="undo"]');
  const redoBtn = container.querySelector('[data-action="redo"]');
  function updateHistoryButtons() {
    undoBtn.disabled = historyIndex <= 0;
    redoBtn.disabled = historyIndex >= history.length - 1;
  }
  undoBtn.addEventListener('click', () => restore(historyIndex - 1));
  redoBtn.addEventListener('click', () => restore(historyIndex + 1));
  canvas.on('object:added', pushHistory);
  canvas.on('object:removed', pushHistory);
  canvas.on('object:modified', () => { pushHistory(); renderPanel(); });
  canvas.on('text:changed', pushHistory);
  pushHistoryNow();

  // ---------- draft safety net ----------
  registerUnsavedWork('flyer-editor');
  function saveDraft() {
    if (!container.isConnected) { teardown(); return; }
    try {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({
        workingFlyerId,
        flyerId: flyerId || null,
        title: titleInput.value,
        category: existingCategory,
        eventId: existingEventId,
        canvasWidth: size.width,
        canvasHeight: size.height,
        canvasJson: canvas.toObject(EXTRA_PROPS),
        savedAt: Date.now(),
      }));
    } catch { /* localStorage full/unavailable -- draft is a safety net */ }
  }
  activeDraftInterval = setInterval(saveDraft, DRAFT_SAVE_INTERVAL_MS);

  // ---------- helpers ----------
  async function uploadAsset(blob, name) {
    const ext = blob.type === 'image/png' ? 'png' : 'jpg';
    const safe = `${String(name || 'image').replace(/\.[a-z0-9]+$/i, '').replace(/[^\w-]+/g, '_').slice(-40)}.${ext}`;
    const path = `${tenantPrefix}${workingFlyerId}/photos/${Date.now()}-${safe}`;
    const { error } = await supabase.storage.from('flyers').upload(path, blob, { contentType: blob.type || 'image/png' });
    if (error) throw error;
    return supabase.storage.from('flyers').getPublicUrl(path).data.publicUrl;
  }

  function lockAsBackground(o) {
    o.set({ selectable: false, evented: false, flyerRole: 'background' });
  }

  function coverObject(o, sz = size) {
    const w = o.width || 1;
    const h = o.height || 1;
    const scale = Math.max(sz.width / w, sz.height / h);
    o.set({ scaleX: scale, scaleY: scale, left: (sz.width - w * scale) / 2, top: (sz.height - h * scale) / 2, angle: 0 });
    o.setCoords();
  }

  function backgroundImage() {
    return canvas.getObjects().find((o) => o.flyerRole === 'background') || null;
  }

  function place(o, select = true) {
    canvas.add(o);
    if (select) canvas.setActiveObject(o);
    canvas.requestRenderAll();
  }

  function isImage(o) { return o instanceof fabric.FabricImage; }
  function isText(o) { return o instanceof fabric.IText; }
  function isMulti(o) { return o instanceof fabric.ActiveSelection; }

  function refreshFormatSelect() {
    const sel = container.querySelector('[data-el="format-select"]');
    if (sel) sel.innerHTML = sizeOptions();
  }

  // ---------- format ----------
  function changeFormat(newSize) {
    const old = { ...size };
    if (old.width === newSize.width && old.height === newSize.height) return;
    const s = Math.min(newSize.width / old.width, newSize.height / old.height);
    const dx = (newSize.width - old.width * s) / 2;
    const dy = (newSize.height - old.height * s) / 2;
    canvas.discardActiveObject();
    canvas.getObjects().forEach((o) => {
      if (o.flyerRole === 'background') { coverObject(o, newSize); return; }
      const props = { left: o.left * s + dx, top: o.top * s + dy };
      if (isText(o)) {
        Object.assign(props, { fontSize: o.fontSize * s, width: o.width * s, strokeWidth: (o.strokeWidth || 0) * s });
      } else {
        Object.assign(props, { scaleX: o.scaleX * s, scaleY: o.scaleY * s });
      }
      o.set(props);
      o.setCoords();
    });
    size = { width: newSize.width, height: newSize.height };
    const bg = readBackground();
    if (bg.mode === 'gradient') setBackground(bg);
    fitToScreen();
    refreshFormatSelect();
    pushHistory();
    renderPanel();
  }

  container.querySelector('[data-el="format-select"]').addEventListener('change', (e) => {
    const value = e.target.value;
    if (value === 'custom') {
      const raw = window.prompt(t('flyers.format.customPrompt'), `${size.width}x${size.height}`);
      const m = String(raw || '').match(/(\d{2,4})\s*[x×*,]\s*(\d{2,4})/i);
      if (m) {
        const w = Math.min(4000, Math.max(100, Number(m[1])));
        const h = Math.min(4000, Math.max(100, Number(m[2])));
        changeFormat({ width: w, height: h });
      } else refreshFormatSelect();
      return;
    }
    if (FLYER_SIZES[value]) changeFormat(FLYER_SIZES[value]);
  });

  // ---------- background ----------
  function readBackground() {
    const bgc = canvas.backgroundColor;
    if (bgc && typeof bgc === 'object' && Array.isArray(bgc.colorStops)) {
      const stops = [...bgc.colorStops].sort((a, b) => a.offset - b.offset);
      const c = bgc.coords || {};
      const dir = c.x2 > 0 && c.y2 > 0 ? 'diagonal' : (c.x2 > 0 ? 'horizontal' : 'vertical');
      return { mode: 'gradient', c1: toHexColor(stops[0]?.color, '#0B1F3A'), c2: toHexColor(stops[stops.length - 1]?.color, '#1E3A8A'), dir };
    }
    return { mode: 'solid', c1: toHexColor(bgc, '#ffffff'), c2: '#1E3A8A', dir: 'vertical' };
  }

  function setBackground({ mode, c1, c2, dir }) {
    if (mode === 'gradient') {
      const coords = { x1: 0, y1: 0, x2: 0, y2: size.height };
      if (dir === 'horizontal') Object.assign(coords, { x2: size.width, y2: 0 });
      if (dir === 'diagonal') Object.assign(coords, { x2: size.width, y2: size.height });
      canvas.backgroundColor = new fabric.Gradient({
        type: 'linear', gradientUnits: 'pixels', coords,
        colorStops: [{ offset: 0, color: c1 }, { offset: 1, color: c2 }],
      });
    } else {
      canvas.backgroundColor = c1;
    }
    canvas.requestRenderAll();
    pushHistory();
  }

  async function setBackgroundImage(url) {
    const img = await fabric.FabricImage.fromURL(url, { crossOrigin: 'anonymous' });
    const existing = backgroundImage();
    if (existing) canvas.remove(existing);
    coverObject(img);
    lockAsBackground(img);
    canvas.add(img);
    canvas.sendObjectToBack(img);
    canvas.requestRenderAll();
    pushHistory();
    return img;
  }

  // ---------- old flyer import ----------
  async function fileToImageBlob(file) {
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return pdfFirstPageToBlob(file);
    return prepareImage(file, 2400);
  }

  container.querySelector('[data-el="import-input"]').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const hasContent = canvas.getObjects().some((o) => o.flyerRole !== 'background');
    let clearFirst = false;
    if (hasContent) {
      clearFirst = await confirmDialog({
        title: t('flyers.importOld'),
        message: t('flyers.importClearConfirm'),
        confirmLabel: t('flyers.importClearYes'),
        cancelLabel: t('flyers.importKeep'),
        danger: false,
      });
    }
    try {
      setStatus(t('flyers.importing'));
      const blob = await fileToImageBlob(file);
      const bitmap = await createImageBitmap(blob);
      const url = await uploadAsset(blob, file.name.replace(/\.pdf$/i, '.png'));
      if (clearFirst) canvas.getObjects().slice().forEach((o) => canvas.remove(o));
      // Match the page to the old flyer's shape, longest side ~1350 px.
      const longest = 1350;
      const ratio = bitmap.width / bitmap.height;
      const newSize = ratio >= 1
        ? { width: longest, height: Math.round(longest / ratio) }
        : { width: Math.round(longest * ratio), height: longest };
      changeFormat(newSize);
      await setBackgroundImage(url);
      canvas.discardActiveObject();
      renderPanel();
      setStatus(t('flyers.importDone'), 'ok');
    } catch (err) {
      setStatus(t('flyers.importFailed', { message: err?.message || String(err) }), 'error');
    }
  });

  async function detectText() {
    const bg = backgroundImage();
    if (!bg) return;
    try {
      setStatus(t('flyers.ocrLoading'));
      const Tesseract = await loadTesseract();
      const src = bg._originalElement || bg.getElement();
      const imgW = src.naturalWidth || src.width;
      const imgH = src.naturalHeight || src.height;
      const off = document.createElement('canvas');
      off.width = imgW;
      off.height = imgH;
      const ctx = off.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(src, 0, 0, imgW, imgH);
      const { data } = await Tesseract.recognize(off, 'fra+eng', {
        logger: (m) => { if (m.status === 'recognizing text') setStatus(t('flyers.ocrProgress', { pct: Math.round((m.progress || 0) * 100) })); },
      });
      const lines = (data?.lines || []).filter((l) => (l.confidence || 0) >= 55 && (l.text || '').trim().length >= 2);
      if (!lines.length) { setStatus(t('flyers.ocrNone'), 'error'); return; }
      const sx = bg.scaleX;
      const sy = bg.scaleY;
      const added = [];
      lines.forEach((line) => {
        const box = line.bbox;
        const { bg: patchColor, fg } = sampleColors(ctx, box, imgW, imgH);
        const left = bg.left + box.x0 * sx;
        const top = bg.top + box.y0 * sy;
        const w = (box.x1 - box.x0) * sx;
        const h = (box.y1 - box.y0) * sy;
        const pad = Math.max(2, h * 0.12);
        const patch = new fabric.Rect({ left: left - pad, top: top - pad, width: w + pad * 2, height: h + pad * 2, fill: patchColor });
        patch.flyerRole = 'patch';
        const tb = new fabric.Textbox(line.text.trim().replace(/\s+/g, ' '), {
          left, top: top - h * 0.05, width: Math.max(w * 1.08, 40), fontSize: Math.max(8, h * 0.95),
          fontFamily: 'Montserrat', fontWeight: '600', fill: fg, lineHeight: 1,
        });
        added.push(patch, tb);
      });
      await loadFonts(['Montserrat'], fabric);
      restoring = true;
      added.forEach((o) => canvas.add(o));
      restoring = false;
      canvas.requestRenderAll();
      pushHistoryNow();
      setStatus(t('flyers.ocrDone', { count: lines.length }), 'ok');
    } catch (err) {
      restoring = false;
      setStatus(t('flyers.ocrFailed', { message: err?.message || String(err) }), 'error');
    }
  }

  // ---------- adding things ----------
  async function addTextbox(kind) {
    const heading = kind === 'heading';
    const fontFamily = heading ? 'Bebas Neue' : 'Montserrat';
    await loadFonts([fontFamily], fabric);
    const tb = new fabric.Textbox(heading ? t('flyers.newHeadingPlaceholder') : t('flyers.newTextPlaceholder'), {
      left: size.width * 0.1, top: size.height * (heading ? 0.12 : 0.4), width: size.width * 0.8,
      fontSize: Math.round(size.height * (heading ? 0.09 : 0.035)), fontFamily,
      fill: readBackground().mode === 'solid' && isDark(readBackground().c1) ? '#ffffff' : '#0B1F3A',
      textAlign: 'center', fontWeight: heading ? 'normal' : '400',
    });
    place(tb);
  }
  container.querySelector('[data-action="add-heading"]').addEventListener('click', () => addTextbox('heading'));
  container.querySelector('[data-action="add-text"]').addEventListener('click', () => addTextbox('body'));

  const shapeMenu = container.querySelector('[data-el="shape-menu"]');
  container.querySelector('[data-action="toggle-shapes"]').addEventListener('click', (e) => {
    e.stopPropagation();
    shapeMenu.classList.toggle('hidden');
  });
  document.addEventListener('click', function closeMenu() {
    if (!container.isConnected) { document.removeEventListener('click', closeMenu); return; }
    shapeMenu.classList.add('hidden');
  });
  shapeMenu.querySelectorAll('[data-shape]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.shape;
    const base = Math.min(size.width, size.height);
    const common = { left: size.width * 0.3, top: size.height * 0.3, fill: '#E0B654' };
    let shape;
    if (k === 'circle') shape = new fabric.Circle({ ...common, radius: base * 0.15 });
    else if (k === 'triangle') shape = new fabric.Triangle({ ...common, width: base * 0.3, height: base * 0.26 });
    else if (k === 'line') shape = new fabric.Line([0, 0, base * 0.5, 0], { left: size.width * 0.25, top: size.height * 0.5, stroke: '#0B1F3A', strokeWidth: Math.max(2, base * 0.008) });
    else shape = new fabric.Rect({ ...common, width: base * 0.4, height: base * 0.2, rx: k === 'rounded' ? base * 0.03 : 0, ry: k === 'rounded' ? base * 0.03 : 0 });
    shapeMenu.classList.add('hidden');
    place(shape);
  }));

  async function addPhotoFromFile(file) {
    if (!file || !(file.type.startsWith('image/') || /\.(heic|heif)$/i.test(file.name))) return;
    setStatus(t('common.saving'));
    try {
      const blob = await prepareImage(file, 2400);
      const url = await uploadAsset(blob, file.name);
      const img = await fabric.FabricImage.fromURL(url, { crossOrigin: 'anonymous' });
      const maxWidth = size.width * 0.6;
      const maxHeight = size.height * 0.6;
      const scale = Math.min(1, maxWidth / img.width, maxHeight / img.height);
      img.set({ scaleX: scale, scaleY: scale, left: (size.width - img.width * scale) / 2, top: (size.height - img.height * scale) / 2 });
      place(img);
      setStatus('');
    } catch (err) {
      setStatus(t('flyers.photoUploadFailed', { message: err?.message || String(err) }), 'error');
    }
  }
  container.querySelector('[data-el="photo-input"]').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    addPhotoFromFile(file);
  });
  // Drag a photo from the desktop straight onto the page.
  wrapEl.addEventListener('dragover', (e) => { e.preventDefault(); wrapEl.classList.add('is-drop'); });
  wrapEl.addEventListener('dragleave', () => wrapEl.classList.remove('is-drop'));
  wrapEl.addEventListener('drop', (e) => {
    e.preventDefault();
    wrapEl.classList.remove('is-drop');
    const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
    if (file) addPhotoFromFile(file);
  });

  container.querySelector('[data-action="show-page"]').addEventListener('click', () => {
    canvas.discardActiveObject();
    canvas.requestRenderAll();
    renderPanel();
    panelEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  // ---------- arrange / align / lock ----------
  function arrange(how) {
    const obj = canvas.getActiveObject();
    if (!obj) return;
    const minIndex = backgroundImage() ? 1 : 0;
    if (how === 'front') canvas.bringObjectToFront(obj);
    if (how === 'forward') canvas.bringObjectForward(obj);
    if (how === 'backward') { if (canvas.getObjects().indexOf(obj) > minIndex) canvas.sendObjectBackwards(obj); }
    if (how === 'back') {
      canvas.sendObjectToBack(obj);
      const bg = backgroundImage();
      if (bg && bg !== obj) canvas.sendObjectToBack(bg);
    }
    canvas.requestRenderAll();
    pushHistory();
  }

  function align(how) {
    const obj = canvas.getActiveObject();
    if (!obj) return;
    const w = obj.getScaledWidth();
    const h = obj.getScaledHeight();
    const updates = {};
    if (how === 'left') updates.left = 0;
    if (how === 'center') updates.left = (size.width - w) / 2;
    if (how === 'right') updates.left = size.width - w;
    if (how === 'top') updates.top = 0;
    if (how === 'middle') updates.top = (size.height - h) / 2;
    if (how === 'bottom') updates.top = size.height - h;
    // Fabric positions by the object's own origin; template objects use
    // left/top, so these values apply directly.
    obj.set(updates);
    obj.setCoords();
    canvas.requestRenderAll();
    pushHistory();
  }

  function setLocked(obj, locked) {
    obj.set({
      flyerLocked: locked, lockMovementX: locked, lockMovementY: locked,
      lockScalingX: locked, lockScalingY: locked, lockRotation: locked, hasControls: !locked,
    });
    canvas.requestRenderAll();
    pushHistory();
  }

  async function duplicateActive() {
    const obj = canvas.getActiveObject();
    if (!obj || isMulti(obj)) return;
    const cloned = await obj.clone(EXTRA_PROPS);
    cloned.set({ left: (obj.left || 0) + 24, top: (obj.top || 0) + 24 });
    if (cloned.flyerRole === 'background') cloned.flyerRole = null;
    place(cloned);
  }

  function deleteActive() {
    const objs = canvas.getActiveObjects();
    if (!objs.length) return;
    objs.forEach((o) => canvas.remove(o));
    canvas.discardActiveObject();
    canvas.requestRenderAll();
  }

  // ---------- image tools ----------
  const FX_DEFAULTS = { brightness: 0, contrast: 0, saturation: 0, blur: 0, grayscale: false, removeColor: null, removeDistance: 0.15 };
  function readFx(img) { return { ...FX_DEFAULTS, ...(img.flyerFx || {}) }; }
  function applyFx(img, fx) {
    const F = fabric.filters;
    const list = [];
    if (fx.removeColor) list.push(new F.RemoveColor({ color: fx.removeColor, distance: fx.removeDistance }));
    if (fx.brightness) list.push(new F.Brightness({ brightness: fx.brightness }));
    if (fx.contrast) list.push(new F.Contrast({ contrast: fx.contrast }));
    if (fx.saturation) list.push(new F.Saturation({ saturation: fx.saturation }));
    if (fx.grayscale) list.push(new F.Grayscale());
    if (fx.blur) list.push(new F.Blur({ blur: fx.blur }));
    img.filters = list;
    img.flyerFx = fx;
    img.applyFilters();
    canvas.requestRenderAll();
    pushHistory();
  }

  async function replaceImage(img, file) {
    if (!file) return;
    setStatus(t('common.saving'));
    try {
      const blob = await prepareImage(file, 2400);
      const url = await uploadAsset(blob, file.name);
      const shownW = img.getScaledWidth();
      await img.setSrc(url, { crossOrigin: 'anonymous' });
      const scale = img.flyerRole === 'background' ? null : shownW / img.width;
      if (scale) img.set({ scaleX: scale, scaleY: scale });
      else coverObject(img);
      img.applyFilters();
      img.setCoords();
      canvas.requestRenderAll();
      pushHistory();
      setStatus('');
    } catch (err) {
      setStatus(t('flyers.photoUploadFailed', { message: err?.message || String(err) }), 'error');
    }
  }

  async function removeImageBackground(img) {
    try {
      setStatus(t('flyers.bgRemoveLoading'));
      const mod = await loadBackgroundRemoval();
      const removeBackground = mod.removeBackground || mod.default;
      const source = await (await fetch(img.getSrc(), { mode: 'cors' })).blob();
      const result = await removeBackground(source, {
        progress: (key, current, total) => {
          if (total) setStatus(t('flyers.bgRemoveProgress', { pct: Math.round((current / total) * 100) }));
        },
      });
      setStatus(t('common.saving'));
      const url = await uploadAsset(result, 'cutout.png');
      const shownW = img.getScaledWidth();
      await img.setSrc(url, { crossOrigin: 'anonymous' });
      const scale = shownW / img.width;
      img.set({ scaleX: scale, scaleY: scale });
      img.applyFilters();
      img.setCoords();
      canvas.requestRenderAll();
      pushHistory();
      setStatus(t('flyers.bgRemoveDone'), 'ok');
    } catch (err) {
      setStatus(t('flyers.bgRemoveFailed', { message: err?.message || String(err) }), 'error');
    }
  }

  function cornerColor(img) {
    try {
      const el = img._originalElement || img.getElement();
      const c = document.createElement('canvas');
      c.width = 1; c.height = 1;
      const ctx = c.getContext('2d');
      ctx.drawImage(el, 0, 0, 1, 1, 0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return rgbToHex([d[0], d[1], d[2]]);
    } catch {
      return '#ffffff';
    }
  }

  function cropShape(img, shape) {
    if (shape === 'none') { img.clipPath = undefined; }
    else {
      const w = img.width;
      const h = img.height;
      const r = Math.min(w, h) / 2;
      img.clipPath = shape === 'circle'
        ? new fabric.Circle({ radius: r, originX: 'center', originY: 'center' })
        : new fabric.Rect({ width: w, height: h, rx: r * 0.25, ry: r * 0.25, originX: 'center', originY: 'center' });
    }
    img.dirty = true;
    canvas.requestRenderAll();
    pushHistory();
  }

  // ---------- properties panel ----------
  const range = (el, label, min, max, step, value, fmt = (v) => v) => `
    <label class="fly-field">
      <span class="fly-field-label">${escapeHtml(label)} <em data-out="${el}">${escapeHtml(fmt(value))}</em></span>
      <input type="range" data-el="${el}" min="${min}" max="${max}" step="${step}" value="${value}" />
    </label>`;
  const colorField = (el, label, value) => `
    <label class="fly-field fly-field--color">
      <span class="fly-field-label">${escapeHtml(label)}</span>
      <span class="fly-color">
        <input type="color" data-el="${el}" value="${toHexColor(value, '#000000')}" />
        ${window.EyeDropper ? `<button type="button" class="fly-icon-btn fly-icon-btn--sm" data-eyedrop="${el}" title="${escapeAttr(t('flyers.pickColor'))}" aria-label="${escapeAttr(t('flyers.pickColor'))}">${icon('eyedrop', 14)}</button>` : ''}
      </span>
    </label>`;
  const section = (title, body) => `<section class="fly-sec"><h4>${escapeHtml(title)}</h4>${body}</section>`;
  const seg = (name, options, current) => `<div class="fly-seg">${options.map(([v, label]) => `<button type="button" data-seg="${name}" data-value="${v}" class="${String(current) === String(v) ? 'is-on' : ''}">${label}</button>`).join('')}</div>`;

  function arrangeSection(obj) {
    const locked = !!obj.flyerLocked;
    return section(t('flyers.arrange'), `
      <div class="fly-icon-row">
        ${iconBtn('arr-front', t('flyers.bringToFront'), 'front')}
        ${iconBtn('arr-forward', t('flyers.forward'), 'forward')}
        ${iconBtn('arr-backward', t('flyers.backward'), 'backward')}
        ${iconBtn('arr-back', t('flyers.sendToBack'), 'back')}
      </div>
      <div class="fly-icon-row">
        ${iconBtn('al-left', t('flyers.align.left'), 'alignLeft')}
        ${iconBtn('al-center', t('flyers.align.center'), 'alignCenter')}
        ${iconBtn('al-right', t('flyers.align.right'), 'alignRight')}
        ${iconBtn('al-top', t('flyers.align.top'), 'alignTop')}
        ${iconBtn('al-middle', t('flyers.align.middle'), 'alignMiddle')}
        ${iconBtn('al-bottom', t('flyers.align.bottom'), 'alignBottom')}
      </div>
      ${range('opacity', t('flyers.opacity'), 0, 1, 0.05, obj.opacity ?? 1, (v) => `${Math.round(v * 100)}%`)}
      <div class="fly-row">
        ${isMulti(obj) ? '' : `<button type="button" data-action="p-lock" class="fly-btn fly-btn--sm">${icon(locked ? 'unlock' : 'lock', 14)}<span>${locked ? t('flyers.unlock') : t('flyers.lock')}</span></button>`}
        ${isMulti(obj) ? '' : `<button type="button" data-action="p-duplicate" class="fly-btn fly-btn--sm">${icon('copy', 14)}<span>${t('flyers.duplicate')}</span></button>`}
        <button type="button" data-action="p-delete" class="fly-btn fly-btn--sm fly-btn--danger">${icon('trash', 14)}<span>${t('flyers.delete')}</span></button>
      </div>`);
  }

  function textSections(obj) {
    const fam = familyName(obj.fontFamily);
    const known = FONT_GROUPS.some((g) => g.fonts.includes(fam));
    const shadowOn = !!obj.shadow;
    const highlight = obj.backgroundColor && obj.backgroundColor !== 'transparent';
    return [
      section(t('flyers.textContent'), `
        <textarea data-el="t-text" rows="3" class="fly-input">${escapeHtml(obj.text || '')}</textarea>
        <label class="fly-field">
          <span class="fly-field-label">${t('flyers.font')}</span>
          <select data-el="t-font" class="fly-input">
            ${known ? '' : `<option value="${escapeAttr(obj.fontFamily)}" selected>${escapeHtml(fam)}</option>`}
            ${FONT_GROUPS.map((g) => `<optgroup label="${escapeAttr(t(`flyers.fontGroup.${g.key}`))}">${g.fonts.map((f) => `<option value="${escapeAttr(f)}" style="font-family:'${escapeAttr(f)}'" ${known && fam === f ? 'selected' : ''}>${escapeHtml(f)}</option>`).join('')}</optgroup>`).join('')}
          </select>
        </label>
        <div class="fly-row">
          <label class="fly-field fly-field--grow"><span class="fly-field-label">${t('flyers.fontSize')}</span>
            <input type="number" data-el="t-size" min="6" max="600" value="${Math.round(obj.fontSize || 20)}" class="fly-input" /></label>
          ${colorField('t-color', t('flyers.textColor'), obj.fill)}
        </div>
        <div class="fly-icon-row">
          <button type="button" data-toggle="bold" class="fly-icon-btn ${['bold', '700', '800', '900', 700, 800, 900].includes(obj.fontWeight) ? 'is-on' : ''}" title="${escapeAttr(t('flyers.bold'))}"><b>B</b></button>
          <button type="button" data-toggle="italic" class="fly-icon-btn ${obj.fontStyle === 'italic' ? 'is-on' : ''}" title="${escapeAttr(t('flyers.italic'))}"><i>I</i></button>
          <button type="button" data-toggle="underline" class="fly-icon-btn ${obj.underline ? 'is-on' : ''}" title="${escapeAttr(t('flyers.underline'))}"><u>U</u></button>
          <button type="button" data-toggle="upper" class="fly-icon-btn" title="${escapeAttr(t('flyers.uppercase'))}">AA</button>
          <button type="button" data-toggle="lower" class="fly-icon-btn" title="${escapeAttr(t('flyers.lowercase'))}">aa</button>
        </div>
        ${seg('t-align', [['left', icon('alignLeft', 14)], ['center', icon('alignCenter', 14)], ['right', icon('alignRight', 14)], ['justify', '≡']], obj.textAlign || 'left')}
      `),
      section(t('flyers.textEffects'), `
        ${range('t-spacing', t('flyers.letterSpacing'), -100, 800, 10, obj.charSpacing || 0)}
        ${range('t-line', t('flyers.lineHeight'), 0.7, 2.5, 0.05, obj.lineHeight || 1.16)}
        <div class="fly-row">
          ${colorField('t-stroke-color', t('flyers.outline'), obj.stroke || '#000000')}
          <div class="fly-field--grow">${range('t-stroke', t('flyers.outlineWidth'), 0, 20, 0.5, obj.strokeWidth && obj.stroke ? obj.strokeWidth : 0)}</div>
        </div>
        <label class="fly-check"><input type="checkbox" data-el="t-shadow" ${shadowOn ? 'checked' : ''} /> ${t('flyers.shadow')}</label>
        ${shadowOn ? range('t-shadow-blur', t('flyers.shadowBlur'), 0, 60, 1, obj.shadow.blur || 0) : ''}
        <div class="fly-row">
          <label class="fly-check"><input type="checkbox" data-el="t-highlight" ${highlight ? 'checked' : ''} /> ${t('flyers.highlight')}</label>
          ${highlight ? colorField('t-highlight-color', '', obj.backgroundColor) : ''}
        </div>
      `),
    ].join('');
  }

  function shapeSections(obj) {
    const isLine = obj instanceof fabric.Line;
    return section(t('flyers.shapeStyle'), `
      ${isLine ? '' : colorField('s-fill', t('flyers.shapeColor'), obj.fill)}
      <div class="fly-swatches">${SWATCHES.map((c) => `<button type="button" data-swatch="${c}" style="background:${c}" title="${c}"></button>`).join('')}</div>
      <div class="fly-row">
        ${colorField('s-stroke-color', isLine ? t('flyers.shapeColor') : t('flyers.outline'), obj.stroke || '#000000')}
        <div class="fly-field--grow">${range('s-stroke', t('flyers.outlineWidth'), 0, 40, 1, obj.stroke ? (obj.strokeWidth || 0) : 0)}</div>
      </div>
      ${obj instanceof fabric.Rect ? range('s-radius', t('flyers.cornerRadius'), 0, Math.round(Math.min(obj.width, obj.height) / 2), 1, obj.rx || 0) : ''}
    `);
  }

  function imageSections(obj) {
    const fx = readFx(obj);
    const isBg = obj.flyerRole === 'background';
    return [
      section(isBg ? t('flyers.backgroundImage') : t('flyers.photo'), `
        <div class="fly-row">
          <label class="fly-btn fly-btn--sm">${icon('upload', 14)}<span>${t('flyers.replaceImage')}</span><input type="file" accept="image/*" data-el="i-replace" class="hidden" /></label>
          ${isBg
            ? `<button type="button" data-action="i-lockbg" class="fly-btn fly-btn--sm">${icon('lock', 14)}<span>${t('flyers.lockBackground')}</span></button>`
            : `<button type="button" data-action="i-makebg" class="fly-btn fly-btn--sm">${icon('page', 14)}<span>${t('flyers.useAsBackground')}</span></button>`}
        </div>
        <button type="button" data-action="i-cutout" class="fly-btn fly-btn--sm fly-btn--gold fly-btn--block">${icon('wand', 14)}<span>${t('flyers.removeBg')}</span><span class="fly-beta">beta</span></button>
        <div class="fly-icon-row">
          ${iconBtn('i-flipx', t('flyers.flipH'), 'flipH')}
          ${iconBtn('i-flipy', t('flyers.flipV'), 'flipV')}
        </div>
        ${isBg ? '' : `<span class="fly-field-label">${t('flyers.cropShape')}</span>
        ${seg('i-crop', [['none', t('flyers.crop.none')], ['circle', t('flyers.crop.circle')], ['rounded', t('flyers.crop.rounded')]], obj.clipPath ? (obj.clipPath instanceof fabric.Circle ? 'circle' : 'rounded') : 'none')}`}
      `),
      section(t('flyers.adjust'), `
        ${range('fx-brightness', t('flyers.fx.brightness'), -0.6, 0.6, 0.02, fx.brightness, pct)}
        ${range('fx-contrast', t('flyers.fx.contrast'), -0.6, 0.6, 0.02, fx.contrast, pct)}
        ${range('fx-saturation', t('flyers.fx.saturation'), -1, 1, 0.05, fx.saturation, pct)}
        ${range('fx-blur', t('flyers.fx.blur'), 0, 0.5, 0.01, fx.blur, pct)}
        <label class="fly-check"><input type="checkbox" data-el="fx-gray" ${fx.grayscale ? 'checked' : ''} /> ${t('flyers.fx.grayscale')}</label>
        <button type="button" data-action="fx-reset" class="fly-link fly-link--sm">${t('flyers.fx.reset')}</button>
      `),
      section(t('flyers.removeColor'), `
        <p class="fly-hint">${t('flyers.removeColorHint')}</p>
        <label class="fly-check"><input type="checkbox" data-el="fx-remove" ${fx.removeColor ? 'checked' : ''} /> ${t('flyers.removeColorOn')}</label>
        ${fx.removeColor ? `${colorField('fx-remove-color', t('flyers.colorToRemove'), fx.removeColor)}
        ${range('fx-remove-dist', t('flyers.tolerance'), 0.02, 0.6, 0.01, fx.removeDistance, pct)}` : ''}
      `),
    ].join('');
  }

  function pageSections() {
    const bg = readBackground();
    const bgImg = backgroundImage();
    return [
      section(t('flyers.background'), `
        ${seg('bg-mode', [['solid', t('flyers.bg.solid')], ['gradient', t('flyers.bg.gradient')]], bg.mode)}
        <div class="fly-row">
          ${colorField('bg-c1', bg.mode === 'gradient' ? t('flyers.bg.from') : t('flyers.bg.color'), bg.c1)}
          ${bg.mode === 'gradient' ? colorField('bg-c2', t('flyers.bg.to'), bg.c2) : ''}
        </div>
        ${bg.mode === 'gradient'
          ? `${seg('bg-dir', [['vertical', '↓'], ['horizontal', '→'], ['diagonal', '↘']], bg.dir)}
             <div class="fly-swatches">${GRADIENT_PRESETS.map(([a, b]) => `<button type="button" data-gradient="${a},${b}" style="background:linear-gradient(135deg,${a},${b})"></button>`).join('')}</div>`
          : `<div class="fly-swatches">${SWATCHES.map((c) => `<button type="button" data-bgswatch="${c}" style="background:${c}" title="${c}"></button>`).join('')}</div>`}
      `),
      section(t('flyers.backgroundImage'), `
        ${bgImg ? `
          <div class="fly-row">
            <button type="button" data-action="bg-edit" class="fly-btn fly-btn--sm">${icon('unlock', 14)}<span>${t('flyers.editBackground')}</span></button>
            <button type="button" data-action="bg-remove" class="fly-btn fly-btn--sm fly-btn--danger">${icon('trash', 14)}<span>${t('flyers.removeBackgroundImage')}</span></button>
          </div>
          <button type="button" data-action="bg-ocr" class="fly-btn fly-btn--sm fly-btn--gold fly-btn--block">${icon('scan', 14)}<span>${t('flyers.ocr')}</span><span class="fly-beta">beta</span></button>
          <p class="fly-hint">${t('flyers.ocrHint')}</p>
        ` : `
          <label class="fly-btn fly-btn--sm fly-btn--block">${icon('image', 14)}<span>${t('flyers.addBackgroundImage')}</span><input type="file" accept="image/*" data-el="bg-image-input" class="hidden" /></label>
          <p class="fly-hint">${t('flyers.oldFlyerHint')}</p>
        `}
      `),
      section(t('flyers.tips'), `<ul class="fly-tips">
        <li>${t('flyers.tip.dblclick')}</li>
        <li>${t('flyers.tip.drag')}</li>
        <li>${t('flyers.tip.keys')}</li>
      </ul>`),
    ].join('');
  }

  function renderPanel() {
    if (!panelEl) return;
    const obj = canvas.getActiveObject();
    if (!obj) {
      panelEl.innerHTML = `<div class="fly-panel-head">${t('flyers.pageAndBackground')}</div>${pageSections()}`;
      wirePagePanel();
      return;
    }
    let head = t('flyers.selection');
    let body = '';
    if (isMulti(obj)) head = t('flyers.multiSelected', { count: obj.getObjects().length });
    else if (isText(obj)) { head = t('flyers.textHead'); body = textSections(obj); }
    else if (isImage(obj)) { head = obj.flyerRole === 'background' ? t('flyers.backgroundImage') : t('flyers.photo'); body = imageSections(obj); }
    else { head = t('flyers.shapeHead'); body = shapeSections(obj); }
    panelEl.innerHTML = `<div class="fly-panel-head">${escapeHtml(head)}</div>${body}${arrangeSection(obj)}`;
    wireObjectPanel(obj);
  }

  function on(sel, evt, fn) {
    panelEl.querySelectorAll(sel).forEach((el) => el.addEventListener(evt, fn));
  }
  function bindRange(el, fn) {
    on(`[data-el="${el}"]`, 'input', (e) => {
      const v = Number(e.target.value);
      const out = panelEl.querySelector(`[data-out="${el}"]`);
      if (out) out.textContent = formatRange(el, v);
      fn(v);
    });
  }
  function wireEyedroppers() {
    panelEl.querySelectorAll('[data-eyedrop]').forEach((b) => b.addEventListener('click', async () => {
      try {
        const { sRGBHex } = await new window.EyeDropper().open();
        const input = panelEl.querySelector(`[data-el="${b.dataset.eyedrop}"]`);
        input.value = sRGBHex;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      } catch { /* cancelled */ }
    }));
  }

  function setProp(obj, props) {
    obj.set(props);
    if (isText(obj)) { obj.initDimensions?.(); }
    obj.setCoords();
    canvas.requestRenderAll();
    pushHistory();
  }

  function wireObjectPanel(obj) {
    wireEyedroppers();
    // arrange & common
    on('[data-action="arr-front"]', 'click', () => arrange('front'));
    on('[data-action="arr-forward"]', 'click', () => arrange('forward'));
    on('[data-action="arr-backward"]', 'click', () => arrange('backward'));
    on('[data-action="arr-back"]', 'click', () => arrange('back'));
    ['left', 'center', 'right', 'top', 'middle', 'bottom'].forEach((k) => on(`[data-action="al-${k}"]`, 'click', () => align(k)));
    bindRange('opacity', (v) => setProp(obj, { opacity: v }));
    on('[data-action="p-lock"]', 'click', () => { setLocked(obj, !obj.flyerLocked); renderPanel(); });
    on('[data-action="p-duplicate"]', 'click', duplicateActive);
    on('[data-action="p-delete"]', 'click', deleteActive);

    if (isText(obj)) {
      on('[data-el="t-text"]', 'input', (e) => setProp(obj, { text: e.target.value }));
      on('[data-el="t-font"]', 'change', async (e) => {
        const fam = e.target.value;
        await loadFonts([fam], fabric);
        setProp(obj, { fontFamily: fam });
      });
      on('[data-el="t-size"]', 'input', (e) => setProp(obj, { fontSize: Math.max(6, Number(e.target.value) || 6) }));
      on('[data-el="t-color"]', 'input', (e) => setProp(obj, { fill: e.target.value }));
      on('[data-toggle]', 'click', async (e) => {
        const k = e.currentTarget.dataset.toggle;
        if (k === 'bold') {
          const bold = ['bold', '700', '800', '900', 700, 800, 900].includes(obj.fontWeight);
          setProp(obj, { fontWeight: bold ? 'normal' : 'bold' });
        }
        if (k === 'italic') setProp(obj, { fontStyle: obj.fontStyle === 'italic' ? 'normal' : 'italic' });
        if (k === 'underline') setProp(obj, { underline: !obj.underline });
        if (k === 'upper') setProp(obj, { text: (obj.text || '').toLocaleUpperCase() });
        if (k === 'lower') setProp(obj, { text: (obj.text || '').toLocaleLowerCase() });
        renderPanel();
      });
      on('[data-seg="t-align"]', 'click', (e) => { setProp(obj, { textAlign: e.currentTarget.dataset.value }); renderPanel(); });
      bindRange('t-spacing', (v) => setProp(obj, { charSpacing: v }));
      bindRange('t-line', (v) => setProp(obj, { lineHeight: v }));
      on('[data-el="t-stroke-color"]', 'input', (e) => setProp(obj, { stroke: e.target.value, strokeWidth: obj.strokeWidth || 2, paintFirst: 'stroke' }));
      bindRange('t-stroke', (v) => setProp(obj, v > 0
        ? { stroke: obj.stroke || panelEl.querySelector('[data-el="t-stroke-color"]').value, strokeWidth: v, paintFirst: 'stroke', strokeLineJoin: 'round' }
        : { stroke: null, strokeWidth: 0 }));
      on('[data-el="t-shadow"]', 'change', (e) => {
        setProp(obj, { shadow: e.target.checked ? new fabric.Shadow({ color: 'rgba(0,0,0,0.45)', blur: Math.round(obj.fontSize * 0.25), offsetX: 2, offsetY: Math.max(2, obj.fontSize * 0.05) }) : null });
        renderPanel();
      });
      bindRange('t-shadow-blur', (v) => { if (obj.shadow) { obj.shadow.blur = v; obj.dirty = true; canvas.requestRenderAll(); pushHistory(); } });
      on('[data-el="t-highlight"]', 'change', (e) => { setProp(obj, { backgroundColor: e.target.checked ? '#E0B654' : '' }); renderPanel(); });
      on('[data-el="t-highlight-color"]', 'input', (e) => setProp(obj, { backgroundColor: e.target.value }));
      return;
    }

    if (isImage(obj)) {
      const fx = readFx(obj);
      on('[data-el="i-replace"]', 'change', (e) => { const f = e.target.files[0]; e.target.value = ''; replaceImage(obj, f); });
      on('[data-action="i-makebg"]', 'click', () => {
        const existing = backgroundImage();
        if (existing && existing !== obj) canvas.remove(existing);
        obj.clipPath = undefined;
        coverObject(obj);
        canvas.sendObjectToBack(obj);
        lockAsBackground(obj);
        canvas.discardActiveObject();
        canvas.requestRenderAll();
        pushHistory();
        renderPanel();
      });
      on('[data-action="i-lockbg"]', 'click', () => {
        lockAsBackground(obj);
        canvas.sendObjectToBack(obj);
        canvas.discardActiveObject();
        canvas.requestRenderAll();
        pushHistory();
        renderPanel();
      });
      on('[data-action="i-cutout"]', 'click', () => removeImageBackground(obj));
      on('[data-action="i-flipx"]', 'click', () => setProp(obj, { flipX: !obj.flipX }));
      on('[data-action="i-flipy"]', 'click', () => setProp(obj, { flipY: !obj.flipY }));
      on('[data-seg="i-crop"]', 'click', (e) => { cropShape(obj, e.currentTarget.dataset.value); renderPanel(); });
      bindRange('fx-brightness', (v) => applyFx(obj, { ...readFx(obj), brightness: v }));
      bindRange('fx-contrast', (v) => applyFx(obj, { ...readFx(obj), contrast: v }));
      bindRange('fx-saturation', (v) => applyFx(obj, { ...readFx(obj), saturation: v }));
      bindRange('fx-blur', (v) => applyFx(obj, { ...readFx(obj), blur: v }));
      on('[data-el="fx-gray"]', 'change', (e) => applyFx(obj, { ...readFx(obj), grayscale: e.target.checked }));
      on('[data-action="fx-reset"]', 'click', () => { applyFx(obj, { ...FX_DEFAULTS }); renderPanel(); });
      on('[data-el="fx-remove"]', 'change', (e) => {
        applyFx(obj, { ...readFx(obj), removeColor: e.target.checked ? (fx.removeColor || cornerColor(obj)) : null });
        renderPanel();
      });
      on('[data-el="fx-remove-color"]', 'input', (e) => applyFx(obj, { ...readFx(obj), removeColor: e.target.value }));
      bindRange('fx-remove-dist', (v) => applyFx(obj, { ...readFx(obj), removeDistance: v }));
      return;
    }

    if (!isMulti(obj)) {
      on('[data-el="s-fill"]', 'input', (e) => setProp(obj, { fill: e.target.value }));
      on('[data-swatch]', 'click', (e) => {
        const c = e.currentTarget.dataset.swatch;
        setProp(obj, obj instanceof fabric.Line ? { stroke: c } : { fill: c });
        renderPanel();
      });
      on('[data-el="s-stroke-color"]', 'input', (e) => setProp(obj, { stroke: e.target.value, strokeWidth: obj.strokeWidth || 2 }));
      bindRange('s-stroke', (v) => setProp(obj, obj instanceof fabric.Line
        ? { strokeWidth: Math.max(1, v) }
        : (v > 0 ? { stroke: obj.stroke || panelEl.querySelector('[data-el="s-stroke-color"]').value, strokeWidth: v } : { stroke: null, strokeWidth: 0 })));
      bindRange('s-radius', (v) => setProp(obj, { rx: v, ry: v }));
    }
  }

  function wirePagePanel() {
    wireEyedroppers();
    const bg = readBackground();
    on('[data-seg="bg-mode"]', 'click', (e) => { setBackground({ ...bg, mode: e.currentTarget.dataset.value }); renderPanel(); });
    on('[data-seg="bg-dir"]', 'click', (e) => { setBackground({ ...readBackground(), dir: e.currentTarget.dataset.value }); renderPanel(); });
    on('[data-el="bg-c1"]', 'input', (e) => setBackground({ ...readBackground(), c1: e.target.value }));
    on('[data-el="bg-c2"]', 'input', (e) => setBackground({ ...readBackground(), c2: e.target.value }));
    on('[data-bgswatch]', 'click', (e) => { setBackground({ ...readBackground(), mode: 'solid', c1: e.currentTarget.dataset.bgswatch }); renderPanel(); });
    on('[data-gradient]', 'click', (e) => {
      const [c1, c2] = e.currentTarget.dataset.gradient.split(',');
      setBackground({ ...readBackground(), mode: 'gradient', c1, c2 });
      renderPanel();
    });
    on('[data-el="bg-image-input"]', 'change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        setStatus(t('common.saving'));
        const blob = await prepareImage(file, 2400);
        const url = await uploadAsset(blob, file.name);
        await setBackgroundImage(url);
        setStatus('');
        renderPanel();
      } catch (err) {
        setStatus(t('flyers.photoUploadFailed', { message: err?.message || String(err) }), 'error');
      }
    });
    on('[data-action="bg-edit"]', 'click', () => {
      const img = backgroundImage();
      if (!img) return;
      img.set({ selectable: true, evented: true });
      canvas.setActiveObject(img);
      canvas.requestRenderAll();
      renderPanel();
    });
    on('[data-action="bg-remove"]', 'click', () => {
      const img = backgroundImage();
      if (img) canvas.remove(img);
      canvas.requestRenderAll();
      renderPanel();
    });
    on('[data-action="bg-ocr"]', 'click', detectText);
  }

  canvas.on('selection:created', renderPanel);
  canvas.on('selection:updated', renderPanel);
  canvas.on('selection:cleared', () => {
    // A background image unlocked for editing goes back to being locked
    // once the user clicks away.
    const bg = backgroundImage();
    if (bg && bg.selectable) lockAsBackground(bg);
    renderPanel();
  });
  renderPanel();

  // ---------- keyboard ----------
  activeKeyHandler = function onKeyDown(e) {
    if (!container.isConnected) { teardown(); return; }
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable) return;
    const active = canvas.getActiveObject();
    if (active?.isEditing) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === 'z') { e.preventDefault(); restore(e.shiftKey ? historyIndex + 1 : historyIndex - 1); return; }
    if (mod && key === 'y') { e.preventDefault(); restore(historyIndex + 1); return; }
    if (mod && key === 'd') { e.preventDefault(); duplicateActive(); return; }
    if (!active) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteActive(); return; }
    const step = e.shiftKey ? 10 : 1;
    const moves = { ArrowLeft: ['left', -step], ArrowRight: ['left', step], ArrowUp: ['top', -step], ArrowDown: ['top', step] };
    if (moves[e.key] && !active.lockMovementX) {
      e.preventDefault();
      const [prop, d] = moves[e.key];
      active.set(prop, (active[prop] || 0) + d);
      active.setCoords();
      canvas.requestRenderAll();
      pushHistory();
    }
  };
  document.addEventListener('keydown', activeKeyHandler);

  // ---------- save ----------
  container.querySelector('[data-action="save"]').addEventListener('click', async () => {
    const title = titleInput.value.trim();
    if (!title) {
      setStatus(t('flyers.titleRequired'), 'error');
      titleInput.focus();
      return;
    }
    setStatus(t('common.saving'));
    canvas.discardActiveObject();
    canvas.renderAll();

    const thumbMultiplier = Math.min(1, 300 / size.width);
    const thumbDataUrl = exportDataUrl(thumbMultiplier);
    const thumbBlob = await (await fetch(thumbDataUrl)).blob();
    const thumbPath = `${tenantPrefix}${workingFlyerId}/thumbnail.png`;
    await supabase.storage.from('flyers').upload(thumbPath, thumbBlob, { upsert: true, contentType: 'image/png' });

    const payload = {
      id: workingFlyerId,
      title,
      category: existingCategory,
      canvas_json: canvas.toObject(EXTRA_PROPS),
      canvas_width: size.width,
      canvas_height: size.height,
      thumbnail_path: thumbPath,
      event_id: existingEventId,
      created_by: currentUserId,
      updated_at: new Date().toISOString(),
    };
    if (tenantId) payload.tenant_id = tenantId;

    const { error } = await supabase.from('flyers').upsert(payload);
    if (error) {
      setStatus(t('flyers.saveFailed', { message: error.message }), 'error');
      return;
    }
    setStatus(t('flyers.saved'), 'ok');
    clearFlyerDraft();
    onSaved?.(workingFlyerId);
  });

  // ---------- export (also for read-only viewers) ----------
  function exportDataUrl(multiplier) {
    // Export at the real page size, whatever the on-screen zoom is.
    const zoom = canvas.getZoom();
    const w = canvas.getWidth();
    const h = canvas.getHeight();
    canvas.setZoom(1);
    canvas.setDimensions({ width: size.width, height: size.height });
    const url = canvas.toDataURL({ format: 'png', multiplier });
    canvas.setDimensions({ width: w, height: h });
    canvas.setZoom(zoom);
    canvas.requestRenderAll();
    return url;
  }

  function wireExports() {
    container.querySelector('[data-action="export-png"]').addEventListener('click', () => {
      canvas.discardActiveObject();
      downloadDataUrl(exportDataUrl(2), `${titleInput.value.trim() || 'flyer'}.png`);
    });
    container.querySelector('[data-action="export-pdf"]').addEventListener('click', () => {
      if (!window.jspdf) { setStatus(t('flyers.exportUnavailable'), 'error'); return; }
      canvas.discardActiveObject();
      const dataUrl = exportDataUrl(2);
      const w = size.width * 2;
      const h = size.height * 2;
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: w > h ? 'landscape' : 'portrait', unit: 'px', format: [w, h] });
      doc.addImage(dataUrl, 'PNG', 0, 0, w, h);
      doc.save(`${titleInput.value.trim() || 'flyer'}.pdf`);
    });
  }
}

function formatRange(el, v) {
  if (el === 'opacity') return `${Math.round(v * 100)}%`;
  if (el.startsWith('fx-')) return pct(v);
  return String(Math.round(v * 100) / 100);
}

function pct(v) {
  const n = Math.round(Number(v) * 100);
  return `${n > 0 ? '+' : ''}${n}%`;
}

function isDark(hex) {
  const h = toHexColor(hex, '#ffffff').slice(1);
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 < 140;
}

function toHexColor(fill, fallback = '#000000') {
  if (typeof fill !== 'string') return fallback;
  const s = fill.trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) return `#${s.slice(1).split('').map((c) => c + c).join('')}`.toLowerCase();
  const m = s.match(/^rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (m) return rgbToHex([Number(m[1]), Number(m[2]), Number(m[3])]);
  if (s === 'white') return '#ffffff';
  if (s === 'black') return '#000000';
  return fallback;
}

function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
function escapeAttr(str) {
  return escapeHtml(str).replaceAll('"', '&quot;');
}
