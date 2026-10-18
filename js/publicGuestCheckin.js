// Entry point for guest-checkin.html — the public, unauthenticated
// guest self-check-in page (outsiders, no login, reached by scanning
// a Welcoming & Socialisation member's displayed QR code). Same shape
// as js/publicBooking.js/js/publicEvent.js: outside the normal
// app.js/index.html shell, no auth gate, no sidebar.
//
// sandbox2 is multi-tenant -- the link carries
// ?d=<today>&church=<tenant-slug>, same ?church= convention
// js/publicEvent.js already uses (submit_guest_checkin() resolves the
// tenant from it, see sql/saas_platform/92_93_guest_self_checkin*.sql).
//
// The ?d= date is only a client-side freshness check (a stale/reused
// QR shows "ask for today's code" instead of the form) -- the RPC
// itself always inserts with service_date = current_date server-side
// regardless of what's in the URL, so this is a nicety, not a real
// security boundary.
//
// Full guest-intake fields (city, referral source, age range, prayer
// request, pastor-meeting request, home church) mirror the staff-side
// form exactly (js/components/attendanceManager.js) -- same fields,
// same optional-by-default shape, same reveal-on-checkbox behavior
// for the prayer-request/home-church text fields, reusing its exact
// i18n keys so a guest filling this in themselves sees the identical
// wording a staff member would have asked them in person.
import { supabase } from './supabaseClient.js';
import { loadLabelOverrides, applyStaticTranslations, t } from './i18n.js';

const SERVICE_TYPES = ['sunday_service', 'midweek_service', 'special_service'];
const REFERRAL_SOURCES = ['social_media', 'vpd_elsewhere', 'word_of_mouth'];
const AGE_RANGES = ['under_18', '18_29', '30_40', '40_50', '50_plus'];

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
        <label class="block text-sm font-medium text-slate-600 mb-1">${t('attendance.serviceType')}</label>
        <select name="service_type" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
          ${SERVICE_TYPES.map((s) => `<option value="${s}" ${s === defaultServiceType() ? 'selected' : ''}>${t(`attendance.type.${s}`)}</option>`).join('')}
        </select>
      </div>

      <p class="text-sm font-semibold text-slate-700 pt-1">${t('attendance.guestName')}</p>

      <input type="text" name="guest_name" required placeholder="${t('attendance.guestNamePlaceholder')}"
             class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />

      <div class="grid sm:grid-cols-2 gap-2">
        <input type="tel" name="phone" placeholder="${t('attendance.guestPhonePlaceholder')}"
               class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        <input type="email" name="email" placeholder="${t('attendance.guestEmailPlaceholder')}"
               class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      </div>

      <input type="text" name="city" placeholder="${t('attendance.guestCityPlaceholder')}"
             class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />

      <select name="referral_source" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
        <option value="">${t('attendance.guestReferralPlaceholder')}</option>
        ${REFERRAL_SOURCES.map((r) => `<option value="${r}">${t(`attendance.referral.${r}`)}</option>`).join('')}
      </select>

      <input type="text" name="referred_by" placeholder="${t('attendance.guestReferredByPlaceholder')}"
             class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />

      <select name="age_range" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
        <option value="">${t('attendance.guestAgeRangePlaceholder')}</option>
        ${AGE_RANGES.map((a) => `<option value="${a}">${t(`attendance.ageRange.${a}`)}</option>`).join('')}
      </select>

      <label class="flex items-center gap-1.5 text-sm text-slate-600">
        <input type="checkbox" name="has_prayer_request" /> ${t('attendance.guestPrayerRequestCheckbox')}
      </label>
      <textarea name="prayer_request" rows="2" placeholder="${t('attendance.guestPrayerRequestPlaceholder')}"
                class="hidden w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"></textarea>

      <label class="flex items-center gap-1.5 text-sm text-slate-600">
        <input type="checkbox" name="wants_pastor_meeting" /> ${t('attendance.guestWantsPastorMeeting')}
      </label>

      <label class="flex items-center gap-1.5 text-sm text-slate-600">
        <input type="checkbox" name="has_home_church" /> ${t('attendance.guestHasHomeChurchCheckbox')}
      </label>
      <input type="text" name="home_church" placeholder="${t('attendance.guestHomeChurchPlaceholder')}"
             class="hidden w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />

      <button type="submit" class="w-full py-2.5 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">${t('guestCheckin.submit')}</button>
      <p id="guest-checkin-status" class="text-sm text-rose-600"></p>
    </form>
  `;

  const form = container.querySelector('#guest-checkin-form');
  const statusEl = container.querySelector('#guest-checkin-status');
  const hasPrayerRequestEl = form.querySelector('[name="has_prayer_request"]');
  const prayerRequestEl = form.querySelector('[name="prayer_request"]');
  const hasHomeChurchEl = form.querySelector('[name="has_home_church"]');
  const homeChurchEl = form.querySelector('[name="home_church"]');

  hasPrayerRequestEl.addEventListener('change', () => {
    prayerRequestEl.classList.toggle('hidden', !hasPrayerRequestEl.checked);
  });
  hasHomeChurchEl.addEventListener('change', () => {
    homeChurchEl.classList.toggle('hidden', !hasHomeChurchEl.checked);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    statusEl.textContent = '';

    const fd = new FormData(form);
    const { error } = await supabase.rpc('submit_guest_checkin', {
      p_tenant_slug: tenantSlug || null,
      p_guest_name: fd.get('guest_name'),
      p_service_type: fd.get('service_type'),
      p_guest_phone: fd.get('phone') || null,
      p_guest_email: fd.get('email') || null,
      p_guest_city: fd.get('city') || null,
      p_guest_referral_source: fd.get('referral_source') || null,
      p_guest_referred_by_name: fd.get('referred_by') || null,
      p_guest_age_range: fd.get('age_range') || null,
      p_guest_prayer_request: hasPrayerRequestEl.checked ? (fd.get('prayer_request') || null) : null,
      p_guest_wants_pastor_meeting: fd.get('wants_pastor_meeting') === 'on',
      p_guest_home_church: hasHomeChurchEl.checked ? (fd.get('home_church') || null) : null,
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
