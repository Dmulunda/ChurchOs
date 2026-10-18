// Entry point for guest-checkin.html — the public, unauthenticated
// guest self-check-in page (outsiders, no login, reached by scanning
// a Welcoming & Socialisation member's displayed QR code). Same shape
// as js/publicBooking.js/js/publicEvent.js: outside the normal
// app.js/index.html shell, no auth gate, no sidebar.
//
// sandbox2 is multi-tenant -- the link carries
// ?d=<today>&church=<tenant-slug>, same ?church= convention
// js/publicEvent.js already uses (submit_guest_checkin() resolves the
// tenant from it, see sql/saas_platform/92_guest_self_checkin.sql).
//
// The ?d= date is only a client-side freshness check (a stale/reused
// QR shows "ask for today's code" instead of the form) -- the RPC
// itself always inserts with service_date = current_date server-side
// regardless of what's in the URL, so this is a nicety, not a real
// security boundary.
import { supabase } from './supabaseClient.js';
import { loadLabelOverrides, applyStaticTranslations, t } from './i18n.js';

const SERVICE_TYPES = ['sunday_service', 'midweek_service', 'special_service'];

function todayLocalDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function defaultServiceType() {
  return new Date().getDay() === 0 ? 'sunday_service' : 'midweek_service';
}

async function main() {
  try {
    await loadLabelOverrides();
  } catch { /* fall through to built-in translations */ }
  applyStaticTranslations();

  const container = document.querySelector('#guest-checkin-content');
  const params = new URLSearchParams(window.location.search);
  const linkDate = params.get('d');
  const tenantSlug = params.get('church');

  if (!linkDate) {
    container.innerHTML = `<p class="text-rose-600 bg-white rounded-xl shadow p-4 sm:p-6">${t('events.invalidLink')}</p>`;
    return;
  }
  if (linkDate !== todayLocalDate()) {
    container.innerHTML = `<p class="text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-4 sm:p-6">${t('guestCheckin.expired')}</p>`;
    return;
  }

  renderForm(container, { tenantSlug });
}

function renderForm(container, { tenantSlug }) {
  container.innerHTML = `
    <form id="guest-checkin-form" class="bg-white rounded-xl shadow p-4 sm:p-6 space-y-3">
      <div>
        <label class="block text-sm font-medium text-slate-600 mb-1">${t('events.fullName')}</label>
        <input type="text" name="full_name" required class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      </div>
      <div>
        <label class="block text-sm font-medium text-slate-600 mb-1">${t('events.phone')}</label>
        <input type="tel" name="phone" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      </div>
      <div>
        <label class="block text-sm font-medium text-slate-600 mb-1">${t('events.email')}</label>
        <input type="email" name="email" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      </div>
      <div>
        <label class="block text-sm font-medium text-slate-600 mb-1">${t('attendance.serviceType')}</label>
        <select name="service_type" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
          ${SERVICE_TYPES.map((s) => `<option value="${s}" ${s === defaultServiceType() ? 'selected' : ''}>${t(`attendance.type.${s}`)}</option>`).join('')}
        </select>
      </div>
      <button type="submit" class="w-full py-2.5 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">${t('guestCheckin.submit')}</button>
      <p id="guest-checkin-status" class="text-sm text-rose-600"></p>
    </form>
  `;

  const form = container.querySelector('#guest-checkin-form');
  const statusEl = container.querySelector('#guest-checkin-status');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    statusEl.textContent = '';

    const fd = new FormData(form);
    const { error } = await supabase.rpc('submit_guest_checkin', {
      p_tenant_slug: tenantSlug || null,
      p_guest_name: fd.get('full_name'),
      p_service_type: fd.get('service_type'),
      p_guest_phone: fd.get('phone') || null,
      p_guest_email: fd.get('email') || null,
    });

    if (error) {
      submitBtn.disabled = false;
      statusEl.textContent = error.message;
      return;
    }

    container.innerHTML = `
      <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-4 sm:p-6 text-center">
        <p class="text-emerald-800 font-medium">${t('guestCheckin.success')}</p>
      </div>
    `;
  });
}

main();
