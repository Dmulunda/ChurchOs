// Entry point for event.html — the public, unauthenticated event
// registration page (outsiders, no login, reached via a shared link/
// QR/flyer). Same shape as js/publicBooking.js: outside the normal
// app.js/index.html shell, no auth gate, no sidebar.
//
// sandbox2 is multi-tenant -- an anonymous visitor has no session to
// resolve which church they mean, so the link must carry
// ?event=<id>&church=<tenant-slug> (an already-signed-in member
// doesn't need ?church, their own session resolves it -- see
// get_public_event_for_registration()'s own auth.uid()-or-slug logic,
// sql/saas_platform/79_events.sql).
import { supabase } from './supabaseClient.js';
import { loadLabelOverrides, applyStaticTranslations, t, appLocale, formatMoney } from './i18n.js';

async function main() {
  try {
    await loadLabelOverrides();
  } catch { /* fall through to built-in translations */ }
  applyStaticTranslations();

  const container = document.querySelector('#event-content');
  const params = new URLSearchParams(window.location.search);
  const eventId = params.get('event');
  const tenantSlug = params.get('church');

  if (!eventId) {
    container.innerHTML = `<p class="text-rose-600 bg-white rounded-xl shadow p-4 sm:p-6">${t('events.invalidLink')}</p>`;
    return;
  }

  const { data: event, error } = await supabase.rpc('get_public_event_for_registration', {
    p_event_id: eventId,
    p_tenant_slug: tenantSlug || null,
  });

  if (error || !event) {
    container.innerHTML = `<p class="text-rose-600 bg-white rounded-xl shadow p-4 sm:p-6">${escapeHtml(error?.message || t('events.notFound'))}</p>`;
    return;
  }

  renderEvent(container, event, { supabase, eventId, tenantSlug });
}

function renderEvent(container, event, { supabase: sb, eventId, tenantSlug }) {
  const when = new Date(event.startAt).toLocaleString(appLocale(), { dateStyle: 'full', timeStyle: 'short' });
  const whereLine = event.onlineLink
    ? `<p class="text-sm text-slate-600"><strong>${t('events.online')}:</strong> <a href="${escapeAttr(event.onlineLink)}" class="text-indigo-600 hover:underline">${escapeHtml(event.onlineLink)}</a></p>`
    : event.location ? `<p class="text-sm text-slate-600"><strong>${t('events.location')}:</strong> ${escapeHtml(event.location)}</p>` : '';

  const isFull = event.capacity != null && event.placesRemaining === 0 && !event.waitlistEnabled;
  const willWaitlist = event.capacity != null && event.placesRemaining === 0 && event.waitlistEnabled;

  container.innerHTML = `
    <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-4">
      ${event.coverImagePath ? `<img src="${escapeAttr(event.coverImagePath)}" alt="" class="w-full h-48 object-cover rounded-lg mb-4" />` : ''}
      <h2 class="text-2xl font-bold text-slate-800 mb-1">${escapeHtml(event.title)}</h2>
      <p class="text-xs text-slate-400 mb-3">${escapeHtml(event.departmentName)}</p>
      ${event.description ? `<p class="text-sm text-slate-600 whitespace-pre-wrap mb-3">${escapeHtml(event.description)}</p>` : ''}
      <p class="text-sm text-slate-600"><strong>${t('events.when')}:</strong> ${escapeHtml(when)}</p>
      ${whereLine}
      <p class="text-sm text-slate-600"><strong>${t('events.price')}:</strong> ${event.priceCents ? formatPriceCents(event.priceCents) : t('events.free')}</p>
      ${event.capacity != null ? `<p class="text-sm text-slate-500 mt-2">${t('events.placesRemaining', { count: event.placesRemaining })}</p>` : ''}
    </div>
    <div id="event-form-area"></div>
  `;

  const formArea = container.querySelector('#event-form-area');

  if (!event.registrationOpen) {
    formArea.innerHTML = `<p class="text-slate-500 bg-white rounded-xl shadow p-4 sm:p-6">${t('events.registrationClosed')}</p>`;
    return;
  }
  if (isFull) {
    formArea.innerHTML = `<p class="text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-4 sm:p-6">${t('events.eventFull')}</p>`;
    return;
  }

  renderForm(formArea, event, { supabase: sb, eventId, tenantSlug, willWaitlist });
}

function renderForm(formArea, event, { supabase: sb, eventId, tenantSlug, willWaitlist }) {
  formArea.innerHTML = `
    <form id="event-register-form" class="bg-white rounded-xl shadow p-4 sm:p-6 space-y-3">
      ${willWaitlist ? `<p class="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">${t('events.willWaitlist')}</p>` : ''}
      ${event.priceCents ? `<p class="text-sm text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2">${t('events.priceNotice', { price: formatPriceCents(event.priceCents) })}</p>` : ''}
      <div>
        <label class="block text-sm font-medium text-slate-600 mb-1">${t('events.fullName')}</label>
        <input type="text" name="full_name" required class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      </div>
      <div>
        <label class="block text-sm font-medium text-slate-600 mb-1">${t('events.email')}</label>
        <input type="email" name="email" required class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      </div>
      <div>
        <label class="block text-sm font-medium text-slate-600 mb-1">${t('events.phone')}</label>
        <input type="tel" name="phone" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      </div>
      ${event.capacity != null ? `
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('events.partySize')}</label>
          <input type="number" name="party_size" min="1" value="1" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          <p class="text-xs text-slate-400 mt-1">${t('events.partySizeHint')}</p>
        </div>
        <div data-el="additional-names"></div>
      ` : ''}
      ${event.questions.map((q) => `
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${escapeHtml(q.question)}${q.required ? ' *' : ''}</label>
          <input type="text" name="q_${q.id}" ${q.required ? 'required' : ''} class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
      `).join('')}
      <button type="submit" class="w-full py-2.5 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">${t('events.register')}</button>
      <p id="event-form-status" class="text-sm text-rose-600"></p>
    </form>
  `;

  const form = formArea.querySelector('#event-register-form');
  const statusEl = formArea.querySelector('#event-form-status');
  const partySizeInput = form.querySelector('input[name="party_size"]');
  const additionalNamesEl = formArea.querySelector('[data-el="additional-names"]');

  // Additional-name inputs re-render to match whatever party size was
  // just typed -- e.g. going from 1 to 3 adds 2 name fields for "who
  // else is coming," not counting the registrant themselves (already
  // collected above as the full_name field).
  function renderAdditionalNames() {
    if (!additionalNamesEl) return;
    const count = Math.max(1, Number(partySizeInput.value) || 1) - 1;
    additionalNamesEl.innerHTML = count > 0
      ? `<label class="block text-sm font-medium text-slate-600 mb-1">${t('events.additionalNames')}</label>` +
        Array.from({ length: count }, (_, i) => `<input type="text" name="additional_name_${i}" placeholder="${t('events.additionalNamePlaceholder', { n: i + 2 })}" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-1.5" />`).join('')
      : '';
  }
  partySizeInput?.addEventListener('input', renderAdditionalNames);
  renderAdditionalNames();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    statusEl.textContent = '';

    const fd = new FormData(form);
    const answers = event.questions.map((q) => ({ question_id: q.id, answer: fd.get(`q_${q.id}`) || '' }));
    const partySize = partySizeInput ? Math.max(1, Number(fd.get('party_size')) || 1) : 1;
    const additionalNames = Array.from({ length: partySize - 1 }, (_, i) => (fd.get(`additional_name_${i}`) || '').trim()).filter(Boolean);

    const { data, error } = await sb.rpc('register_for_event', {
      p_event_id: eventId,
      p_tenant_slug: tenantSlug || null,
      p_full_name: fd.get('full_name'),
      p_email: fd.get('email'),
      p_phone: fd.get('phone'),
      p_answers: answers,
      p_party_size: partySize,
      p_additional_names: additionalNames,
    });

    if (error) {
      submitBtn.disabled = false;
      statusEl.textContent = error.message;
      return;
    }

    formArea.innerHTML = `
      <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-4 sm:p-6 text-center">
        <p class="text-emerald-800 font-medium">${data.status === 'waitlisted' ? t('events.waitlistedConfirmation') : t('events.registeredConfirmation')}</p>
        <p class="text-sm text-emerald-700 mt-1">${t('events.checkEmail')}</p>
      </div>
    `;
  });
}

function formatPriceCents(cents) {
  return `${formatMoney(cents / 100)}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
function escapeAttr(str) {
  return escapeHtml(str).replaceAll('"', '&quot;');
}

main();
