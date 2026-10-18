// "Show Today's QR Code" -- lets any approved Welcoming &
// Socialisation member (js/deptDashboard.js gates where this opens
// from, not this file) pull up a QR code for guests to scan and
// check themselves in without an account (guest-checkin.html,
// js/publicGuestCheckin.js, submit_guest_checkin() RPC). Regenerated
// fresh every time it opens, so it always encodes today's date --
// no stored/rotated code, no cron job. Same qrcode CDN import
// (toDataURL) already used in js/eventsPage.js/memberIdCard.js, and
// the same copy-link UI eventsPage.js's own public-link share uses.
import { t } from '../i18n.js';
import { getTenant } from '../tenant.js';

function todayLocalDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function createGuestCheckinQrModal() {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-bold">${t('guestCheckinQr.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <div data-el="qr-area" class="flex items-center justify-center mb-4"></div>
      <p class="text-xs text-slate-400 mb-3">${t('guestCheckinQr.hint')}</p>
      <div class="flex items-center gap-2">
        <input type="text" data-el="link-input" readonly class="flex-1 min-w-0 border border-slate-300 rounded-lg px-2 py-1.5 text-xs text-slate-600 bg-slate-50" />
        <button type="button" data-action="copy-link" class="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 whitespace-nowrap">${t('guestCheckinQr.copyLink')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const qrAreaEl = root.querySelector('[data-el="qr-area"]');
  const linkInputEl = root.querySelector('[data-el="link-input"]');

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  root.querySelector('[data-action="copy-link"]').addEventListener('click', () => {
    navigator.clipboard?.writeText(linkInputEl.value);
  });

  async function open() {
    root.classList.remove('hidden');
    root.classList.add('flex');

    const url = `${window.location.origin}/guest-checkin.html?d=${todayLocalDate()}&church=${encodeURIComponent(getTenant()?.slug || '')}`;
    linkInputEl.value = url;
    qrAreaEl.innerHTML = `<p class="text-xs text-slate-400">${t('common.loading')}</p>`;

    try {
      const { toDataURL } = await import('https://cdn.jsdelivr.net/npm/qrcode@1.5.3/+esm');
      const dataUrl = await toDataURL(url, { width: 240, margin: 1 });
      qrAreaEl.innerHTML = `<img src="${dataUrl}" alt="" class="rounded-lg border border-slate-200" />`;
    } catch {
      qrAreaEl.innerHTML = `<p class="text-xs text-rose-500">${t('guestCheckinQr.qrFailed')}</p>`;
    }
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  return { open };
}
