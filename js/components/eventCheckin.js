// Event check-in at the door (sql/saas_platform/168): scan the QR code from
// the confirmation email with the phone camera, or find the name in the
// list. Uses the browser's BarcodeDetector when it has one (Chrome/Android)
// and the jsQR library otherwise (iPhone Safari). All checks happen in
// check_in_event_registration() -- organizing department members and the
// pastoral team only.
import { t, appLocale } from '../i18n.js';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function timeOf(iso) {
  return new Date(iso).toLocaleTimeString(appLocale(), { hour: '2-digit', minute: '2-digit' });
}

export async function renderEventCheckin(el, { supabase, event, onClose }) {
  let list = [];
  let stream = null;
  let scanning = false;
  let lastToken = '';
  let lastAt = 0;

  el.innerHTML = `
    <div class="border border-indigo-200 bg-indigo-50/40 rounded-xl p-3 sm:p-4 mb-4">
      <div class="flex items-center justify-between gap-2 mb-3">
        <p class="font-semibold text-slate-800">📷 ${t('eventCheckin.title')}</p>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
      </div>
      <p data-el="count" class="text-sm text-slate-700 mb-2"></p>
      <div class="flex flex-wrap gap-2 mb-2">
        <button type="button" data-action="camera" class="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium">${t('eventCheckin.startCamera')}</button>
      </div>
      <div data-el="video-wrap" class="hidden relative max-w-sm">
        <video data-el="video" playsinline muted class="w-full rounded-lg bg-black"></video>
        <div class="absolute inset-8 border-4 border-white/70 rounded-xl pointer-events-none"></div>
      </div>
      <div data-el="result" class="my-3"></div>
      <input data-el="q" type="search" placeholder="${t('eventCheckin.search')}" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-2">
      <ul data-el="list" class="divide-y divide-slate-100 bg-white rounded-lg max-h-96 overflow-y-auto"></ul>
    </div>`;

  const q = (s) => el.querySelector(s);
  const resultEl = q('[data-el="result"]');
  const video = q('[data-el="video"]');
  const canvas = document.createElement('canvas');

  function stopCamera() {
    scanning = false;
    stream?.getTracks().forEach((tr) => tr.stop());
    stream = null;
    q('[data-el="video-wrap"]').classList.add('hidden');
    q('[data-action="camera"]').textContent = t('eventCheckin.startCamera');
  }

  q('[data-action="close"]').addEventListener('click', () => { stopCamera(); el.innerHTML = ''; onClose?.(); });

  async function loadList() {
    const { data, error } = await supabase.rpc('get_event_checkin_list', { p_event_id: event.id });
    if (error) { q('[data-el="list"]').innerHTML = `<li class="p-3 text-sm text-rose-600">${escapeHtml(error.message)}</li>`; return; }
    list = data || [];
    renderList();
  }

  function renderCount() {
    const confirmed = list.filter((r) => r.status === 'confirmed');
    const people = confirmed.reduce((s, r) => s + (r.party_size || 1), 0);
    const inPeople = confirmed.filter((r) => r.checked_in_at).reduce((s, r) => s + (r.party_size || 1), 0);
    q('[data-el="count"]').textContent = t('eventCheckin.count', { in: inPeople, total: people });
  }

  function renderList() {
    renderCount();
    const term = q('[data-el="q"]').value.trim().toLowerCase();
    const shown = list.filter((r) => !term || r.full_name.toLowerCase().includes(term) || (r.additional_names || []).some((n) => n.toLowerCase().includes(term)));
    q('[data-el="list"]').innerHTML = shown.map((r) => `
      <li class="flex items-center justify-between gap-2 px-3 py-2">
        <div class="min-w-0">
          <p class="text-sm font-medium ${r.checked_in_at ? 'text-emerald-700' : 'text-slate-800'}">${r.checked_in_at ? '✓ ' : ''}${escapeHtml(r.full_name)}${r.party_size > 1 ? ` <span class="text-xs text-slate-500">(${r.party_size})</span>` : ''}</p>
          <p class="text-xs text-slate-500">${r.status === 'waitlisted' ? `${t('eventCheckin.waitlisted')} · ` : ''}${r.payment_status === 'pending' ? `<span class="text-amber-700">${t('eventCheckin.paymentPending')}</span> · ` : ''}${r.checked_in_at ? t('eventCheckin.inAt', { time: timeOf(r.checked_in_at) }) : ''}</p>
        </div>
        ${r.checked_in_at
          ? `<button type="button" data-undo="${r.id}" class="text-xs px-2 py-1 rounded border border-slate-300">${t('eventCheckin.undo')}</button>`
          : `<button type="button" data-in="${r.id}" class="text-xs px-3 py-1 rounded bg-emerald-600 text-white">${t('eventCheckin.checkIn')}</button>`}
      </li>`).join('') || `<li class="p-3 text-sm text-slate-500">${t('eventCheckin.noOne')}</li>`;
    q('[data-el="list"]').querySelectorAll('[data-in]').forEach((b) => b.addEventListener('click', () => checkIn({ registrationId: b.dataset.in })));
    q('[data-el="list"]').querySelectorAll('[data-undo]').forEach((b) => b.addEventListener('click', () => checkIn({ registrationId: b.dataset.undo, undo: true })));
  }

  function showResult(kind, html) {
    const cls = { ok: 'bg-emerald-50 border-emerald-300 text-emerald-900', warn: 'bg-amber-50 border-amber-300 text-amber-900', bad: 'bg-rose-50 border-rose-300 text-rose-900' }[kind];
    resultEl.innerHTML = `<div class="border-2 rounded-xl p-3 ${cls}">${html}</div>`;
    if (navigator.vibrate) navigator.vibrate(kind === 'ok' ? 80 : [60, 60, 60]);
  }

  async function checkIn({ token = null, registrationId = null, undo = false }) {
    const { data, error } = await supabase.rpc('check_in_event_registration', {
      p_event_id: event.id, p_token: token, p_registration_id: registrationId, p_undo: undo,
    });
    if (error) {
      const code = /NOT_FOUND/.test(error.message) ? 'notFound' : /CANCELLED/.test(error.message) ? 'cancelled' : /NOT_ALLOWED/.test(error.message) ? 'notAllowed' : null;
      showResult('bad', `<p class="font-semibold">✗ ${code ? t(`eventCheckin.${code}`) : escapeHtml(error.message)}</p>`);
      return;
    }
    if (!undo) {
      const people = data.party_size > 1 ? ` <span class="font-normal">(${t('eventCheckin.people', { count: data.party_size })})</span>` : '';
      const extras = [
        data.status === 'waitlisted' ? t('eventCheckin.waitlistedWarn') : '',
        data.payment_status === 'pending' ? t('eventCheckin.paymentPendingWarn') : '',
      ].filter(Boolean).map((x) => `<p class="text-sm mt-1">⚠ ${escapeHtml(x)}</p>`).join('');
      if (data.already_checked_in_at) {
        showResult('warn', `<p class="font-semibold">${escapeHtml(data.full_name)}${people}</p><p class="text-sm">${t('eventCheckin.already', { time: timeOf(data.already_checked_in_at) })}</p>${extras}`);
      } else {
        showResult(extras ? 'warn' : 'ok', `<p class="text-lg font-bold">✓ ${escapeHtml(data.full_name)}${people}</p>${extras}`);
      }
    } else {
      resultEl.innerHTML = '';
    }
    await loadList();
  }

  async function makeDecoder() {
    if ('BarcodeDetector' in window) {
      try {
        const formats = await window.BarcodeDetector.getSupportedFormats?.();
        if (!formats || formats.includes('qr_code')) {
          const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
          return async (source) => (await detector.detect(source))[0]?.rawValue || null;
        }
      } catch { /* fall back to jsQR */ }
    }
    const { default: jsQR } = await import('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/+esm');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    return async (source) => {
      const w = source.videoWidth;
      const h = source.videoHeight;
      if (!w || !h) return null;
      const scale = Math.min(1, 640 / Math.max(w, h));
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data || null;
    };
  }

  q('[data-action="camera"]').addEventListener('click', async () => {
    if (scanning) { stopCamera(); return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    } catch {
      showResult('bad', `<p>${t('eventCheckin.noCamera')}</p>`);
      return;
    }
    video.srcObject = stream;
    await video.play().catch(() => {});
    q('[data-el="video-wrap"]').classList.remove('hidden');
    q('[data-action="camera"]').textContent = t('eventCheckin.stopCamera');
    scanning = true;
    let decode;
    try { decode = await makeDecoder(); } catch {
      stopCamera();
      showResult('bad', `<p>${t('eventCheckin.noScanner')}</p>`);
      return;
    }
    const tick = async () => {
      if (!scanning || !el.isConnected) { stopCamera(); return; }
      try {
        const raw = await decode(video);
        const token = raw && (raw.match(UUID_RE) || [])[0];
        if (token && (token !== lastToken || Date.now() - lastAt > 4000)) {
          lastToken = token;
          lastAt = Date.now();
          await checkIn({ token });
        }
      } catch { /* a frame that failed to decode */ }
      setTimeout(tick, 250);
    };
    tick();
  });

  q('[data-el="q"]').addEventListener('input', renderList);
  await loadList();
}
