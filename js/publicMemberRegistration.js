// Entry point for register.html — the public, unauthenticated member
// self-registration page (Feature 2 of 3). Same shape as
// js/publicPrayerRequest.js: outside the normal app.js/index.html
// shell, no auth gate. Logged-in members get the same form pre-filled
// inside the app instead -- see js/components/memberRegistrationModal.js,
// which calls the exact same submit_member_registration() RPC with
// their own profile_id attached.
//
// sandbox2 is multi-tenant -- the link carries ?church=<tenant-slug>,
// same convention js/publicPrayerRequest.js already uses.
import { supabase } from './supabaseClient.js';
import { loadLabelOverrides, applyStaticTranslations, t } from './i18n.js';
import { AGE_GROUPS, MARITAL_STATUSES, SKILLS, renderMemberFormFields, readMemberFormFields } from './components/memberRegistrationFields.js';

const COP_LOGO = 'img/church-on-point-icon.png';

async function main() {
  try {
    await loadLabelOverrides();
  } catch { /* fall through to built-in translations */ }
  applyStaticTranslations();

  const container = document.querySelector('#register-content');
  const params = new URLSearchParams(window.location.search);
  const tenantSlug = params.get('church');

  renderHeader(tenantSlug);
  renderForm(container, { tenantSlug });
}

async function renderHeader(tenantSlug) {
  const imgEl = document.querySelector('#register-header img');
  const nameEl = document.querySelector('#register-header h1');
  if (!tenantSlug) return;

  const { data } = await supabase.rpc('get_public_church_info', { p_tenant_slug: tenantSlug });
  if (!data) return;
  imgEl.src = data.logo_url || COP_LOGO;
  if (data.name) nameEl.textContent = data.name;
}

function renderForm(container, { tenantSlug }) {
  container.innerHTML = `
    <form id="register-form" class="bg-white rounded-xl shadow p-4 sm:p-6 space-y-3">
      ${renderMemberFormFields()}

      <label class="flex items-start gap-2 text-sm text-slate-600 pt-2 border-t border-slate-100">
        <input type="checkbox" name="consent" required class="rounded border-slate-300 mt-0.5">
        ${t('memberRegistration.consentLabel')}
      </label>

      <!-- Honeypot: left visually and from assistive tech, a real
           visitor never fills it; a filled value makes the RPC
           silently no-op. -->
      <div class="absolute -left-[9999px]" aria-hidden="true">
        <input type="text" name="website" tabindex="-1" autocomplete="off" />
      </div>

      <button type="submit" class="w-full py-2.5 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">${t('memberRegistration.submit')}</button>
      <p id="register-status" class="text-sm text-rose-600"></p>
    </form>
  `;

  const form = container.querySelector('#register-form');
  const statusEl = container.querySelector('#register-status');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    statusEl.textContent = '';

    const fields = readMemberFormFields(form);
    const { error } = await supabase.rpc('submit_member_registration', {
      p_tenant_slug: tenantSlug || null,
      ...fields,
      p_consent: form.elements.consent.checked,
      p_profile_id: null,
      p_honeypot: form.elements.website.value || null,
    });

    if (error) {
      submitBtn.disabled = false;
      statusEl.textContent = error.message;
      return;
    }

    container.innerHTML = `
      <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-4 sm:p-6 text-center">
        <p class="text-emerald-800 font-medium">${t('memberRegistration.thankYou')}</p>
      </div>
    `;
  });
}

main();
