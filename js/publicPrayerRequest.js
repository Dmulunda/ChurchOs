// Entry point for prayer.html — the public, unauthenticated prayer
// request page (anyone, no account, reached via the link/QR code
// js/components/prayerLinkQrModal.js shows admins). Same shape as
// js/publicGuestCheckin.js: outside the normal app.js/index.html
// shell, no auth gate, no sidebar.
//
// sandbox2 is multi-tenant -- the link carries ?church=<tenant-slug>,
// same convention js/publicGuestCheckin.js/js/publicEvent.js already
// use (submit_public_prayer_request() resolves the tenant from it,
// see sql/saas_platform/125_public_prayer_link.sql).
//
// Anonymity is enforced server-side (the RPC never stores name/phone/
// email when is_anonymous is true, regardless of what's sent) -- the
// client-side toggle here is purely about which fields are SHOWN, not
// the actual privacy boundary.
import { supabase } from './supabaseClient.js';
import { loadLabelOverrides, applyStaticTranslations, t } from './i18n.js';

const MAX_LENGTH = 2000;

const COP_LOGO = 'img/church-on-point-icon.png';

async function main() {
  try {
    await loadLabelOverrides();
  } catch { /* fall through to built-in translations */ }
  applyStaticTranslations();

  const container = document.querySelector('#public-prayer-content');
  const params = new URLSearchParams(window.location.search);
  const tenantSlug = params.get('church');

  renderHeader(tenantSlug);
  renderForm(container, { tenantSlug });
}

async function renderHeader(tenantSlug) {
  const imgEl = document.querySelector('#prayer-header img');
  const nameEl = document.querySelector('#prayer-header h1');
  if (!tenantSlug) return; // no church context on the link -- keep the COP default already in the HTML

  const { data } = await supabase.rpc('get_public_church_info', { p_tenant_slug: tenantSlug });
  if (!data) return;
  imgEl.src = data.logo_url || COP_LOGO;
  if (data.name) nameEl.textContent = data.name;
}

function renderForm(container, { tenantSlug }) {
  container.innerHTML = `
    <form id="public-prayer-form" class="bg-white rounded-xl shadow p-4 sm:p-6 space-y-3">
      <div>
        <textarea name="request_text" rows="5" required maxlength="${MAX_LENGTH}" placeholder="${t('prayerRequest.textPlaceholder')}"
                  class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"></textarea>
        <p data-el="char-count" class="text-xs text-slate-400 text-right mt-0.5"></p>
      </div>

      <label class="flex items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" name="anonymous" checked class="rounded border-slate-300">
        ${t('prayerRequest.anonymousToggle')}
      </label>

      <div data-el="contact-fields" class="hidden space-y-2 border-t border-slate-100 pt-3">
        <input type="text" name="name" placeholder="${t('prayerRequest.namePlaceholder')}"
               class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        <div class="grid sm:grid-cols-2 gap-2">
          <input type="tel" name="phone" placeholder="${t('prayerRequest.phonePlaceholder')}"
                 class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          <input type="email" name="email" placeholder="${t('prayerRequest.emailPlaceholder')}"
                 class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <label class="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" name="wants_contact" class="rounded border-slate-300">
          ${t('prayerRequest.wantsContact')}
        </label>
      </div>

      <!-- Honeypot: left visually and from assistive tech, a real
           visitor never fills it; a filled value makes the RPC
           silently no-op. -->
      <div class="absolute -left-[9999px]" aria-hidden="true">
        <input type="text" name="website" tabindex="-1" autocomplete="off" />
      </div>

      <button type="submit" class="w-full py-2.5 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">${t('prayerRequest.submit')}</button>
      <p id="public-prayer-status" class="text-sm text-rose-600"></p>
    </form>
  `;

  const form = container.querySelector('#public-prayer-form');
  const statusEl = container.querySelector('#public-prayer-status');
  const textEl = form.querySelector('[name="request_text"]');
  const charCountEl = form.querySelector('[data-el="char-count"]');
  const anonymousEl = form.querySelector('[name="anonymous"]');
  const contactFieldsEl = form.querySelector('[data-el="contact-fields"]');

  const updateCharCount = () => { charCountEl.textContent = `${textEl.value.length}/${MAX_LENGTH}`; };
  updateCharCount();
  textEl.addEventListener('input', updateCharCount);

  const toggleContactFields = () => { contactFieldsEl.classList.toggle('hidden', anonymousEl.checked); };
  toggleContactFields();
  anonymousEl.addEventListener('change', toggleContactFields);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    statusEl.textContent = '';

    const fd = new FormData(form);
    const { error } = await supabase.rpc('submit_public_prayer_request', {
      p_tenant_slug: tenantSlug || null,
      p_request_text: fd.get('request_text'),
      p_is_anonymous: anonymousEl.checked,
      p_name: fd.get('name') || null,
      p_phone: fd.get('phone') || null,
      p_email: fd.get('email') || null,
      p_wants_contact: fd.get('wants_contact') === 'on',
      p_is_private: false,
      p_honeypot: fd.get('website') || null,
    });

    if (error) {
      submitBtn.disabled = false;
      statusEl.textContent = error.message;
      return;
    }

    container.innerHTML = `
      <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-4 sm:p-6 text-center">
        <p class="text-emerald-800 font-medium">${t('prayerRequest.thankYou')}</p>
      </div>
    `;
  });
}

main();
