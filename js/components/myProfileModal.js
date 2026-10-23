// Self-service "My Profile" — upload/replace your own photo, set your
// address/sex/parish/birth country+city, and draw your own signature
// (sql/083, sql/084) for the Member ID Card (memberIdCard.js).
// Deliberately does NOT include member_title ("Fonction" on the card,
// e.g. "Pasteur Principal") — that's an official designation set by an
// admin (userEditModal.js), not something a member self-declares. Same
// createXModal({...}) => { open } shape as changePasswordModal.js,
// reached from the same sidebar Tools menu.
import { t } from '../i18n.js';
import { renderMemberIdCard } from './memberIdCard.js';
import { createSignaturePad } from './signaturePad.js';
import { hasFeature } from '../entitlements.js';
import { confirmDialog } from './confirmDialog.js';

// Member Card is a plan-gated feature (sql/saas_platform/86_pricing_v2.sql)
// -- its own data is just ordinary profile columns used elsewhere too,
// so this is a UI-level gate, not a table-level RESTRICTIVE policy.
function renderMemberIdCardGated(container, opts) {
  if (hasFeature('member_card')) {
    renderMemberIdCard(container, opts);
  } else {
    container.innerHTML = `<p class="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3">${t('entitlements.memberCardLocked')}</p>`;
  }
}

export function createMyProfileModal({ supabase, userId }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${t('myProfile.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>

      <div class="mb-4">
        <div data-el="card-container"></div>
      </div>

      <!-- Collapsed by default once a profile already looks complete
           (open() below decides based on what's already filled in) --
           the card above is what most people actually came here for;
           the form is an edit action, not the primary view. -->
      <button type="button" data-action="toggle-form"
              class="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 mb-3">
        <span>${t('myProfile.editInfo')}</span>
        <svg data-el="toggle-arrow" xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <form data-el="form" class="hidden space-y-3">
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('myProfile.photo')}</label>
          <input type="file" accept="image/*" data-el="photo-input" class="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('myProfile.legalName')}</label>
          <input type="text" name="legal_name" class="w-full border border-slate-300 rounded-lg px-3 py-2" />
          <p class="text-xs text-slate-400 mt-1">${t('myProfile.legalNameHint')}</p>
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('myProfile.address')}</label>
          <input type="text" name="address" class="w-full border border-slate-300 rounded-lg px-3 py-2" />
        </div>
        <div class="grid sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('memberCard.sex')}</label>
            <select name="sex" class="w-full border border-slate-300 rounded-lg px-3 py-2">
              <option value="">—</option>
              <option value="M">${t('memberCard.male')}</option>
              <option value="F">${t('memberCard.female')}</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('memberCard.parish')}</label>
            <input type="text" name="parish" class="w-full border border-slate-300 rounded-lg px-3 py-2" />
          </div>
        </div>
        <div class="grid sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('myProfile.birthCountry')}</label>
            <input type="text" name="birth_country" class="w-full border border-slate-300 rounded-lg px-3 py-2" />
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('myProfile.birthCity')}</label>
            <input type="text" name="birth_city" class="w-full border border-slate-300 rounded-lg px-3 py-2" />
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('myProfile.birthDate')}</label>
          <input type="date" name="birth_date" class="w-full border border-slate-300 rounded-lg px-3 py-2" />
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('myProfile.signature')}</label>
          <p class="text-xs text-slate-400 mb-1">${t('myProfile.signatureHint')}</p>
          <canvas data-el="signature-pad" width="360" height="120" class="w-full border border-slate-300 rounded-lg bg-white touch-none" style="max-width:360px;height:120px;"></canvas>
          <button type="button" data-action="clear-signature" class="mt-1 text-xs text-slate-500 hover:text-slate-700 underline">${t('myProfile.clearSignature')}</button>
        </div>
        <div class="flex items-center gap-3">
          <button type="submit" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">${t('myProfile.save')}</button>
          <span data-el="form-status" class="text-sm text-slate-500"></span>
        </div>
      </form>

      <div class="border-t border-rose-100 mt-6 pt-4">
        <h3 class="text-sm font-semibold text-rose-700 mb-1">${t('account.dangerZone')}</h3>
        <p class="text-xs text-slate-500 mb-2">${t('account.leaveChurchHint')}</p>
        <button type="button" data-action="leave-church" class="text-sm text-rose-600 hover:text-rose-700 font-medium">${t('account.leaveChurch')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const form = root.querySelector('[data-el="form"]');
  const formStatusEl = root.querySelector('[data-el="form-status"]');
  const cardContainer = root.querySelector('[data-el="card-container"]');
  const toggleBtn = root.querySelector('[data-action="toggle-form"]');
  const toggleArrow = root.querySelector('[data-el="toggle-arrow"]');
  const signaturePad = createSignaturePad(root.querySelector('[data-el="signature-pad"]'));

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  root.querySelector('[data-action="clear-signature"]').addEventListener('click', () => signaturePad.clear());
  root.querySelector('[data-action="leave-church"]').addEventListener('click', handleLeaveChurch);
  form.addEventListener('submit', handleSubmit);

  function setFormExpanded(expanded) {
    form.classList.toggle('hidden', !expanded);
    toggleArrow.classList.toggle('rotate-180', expanded);
  }
  toggleBtn.addEventListener('click', () => setFormExpanded(form.classList.contains('hidden')));

  async function open() {
    formStatusEl.textContent = '';
    form.reset();
    root.classList.remove('hidden');
    root.classList.add('flex');

    const { data: profile } = await supabase.from('profiles').select('legal_name, address, sex, parish, birth_date, birth_country, birth_city, signature_data').eq('id', userId).single();
    form.elements.legal_name.value = profile?.legal_name || '';
    form.elements.address.value = profile?.address || '';
    form.elements.sex.value = profile?.sex || '';
    form.elements.parish.value = profile?.parish || '';
    form.elements.birth_date.value = profile?.birth_date || '';
    form.elements.birth_country.value = profile?.birth_country || '';
    form.elements.birth_city.value = profile?.birth_city || '';
    signaturePad.clear();
    signaturePad.loadFromDataUrl(profile?.signature_data);

    // Collapsed by default once the essentials are already filled in --
    // an incomplete profile opens with the form already showing, so a
    // new member isn't left staring at just a half-empty card with no
    // obvious way to finish it.
    const looksComplete = !!(profile?.address && profile?.signature_data);
    setFormExpanded(!looksComplete);

    renderMemberIdCardGated(cardContainer, { supabase, userId });
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    formStatusEl.className = 'text-sm text-slate-500';
    formStatusEl.textContent = t('common.saving');

    const update = {
      legal_name: form.elements.legal_name.value.trim() || null,
      address: form.elements.address.value.trim() || null,
      sex: form.elements.sex.value || null,
      parish: form.elements.parish.value.trim() || null,
      birth_date: form.elements.birth_date.value || null,
      birth_country: form.elements.birth_country.value.trim() || null,
      birth_city: form.elements.birth_city.value.trim() || null,
      signature_data: signaturePad.isEmpty() ? null : signaturePad.toDataUrl(),
    };

    const file = form.querySelector('[data-el="photo-input"]')?.files?.[0];
    if (file) {
      const path = `${userId}/${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage.from('member-photos').upload(path, file);
      if (uploadError) {
        formStatusEl.className = 'text-sm text-rose-600';
        formStatusEl.textContent = t('myProfile.saveFailed', { message: uploadError.message });
        return;
      }
      update.photo_path = path;
    }

    const { error } = await supabase.from('profiles').update(update).eq('id', userId);
    if (error) {
      formStatusEl.className = 'text-sm text-rose-600';
      formStatusEl.textContent = t('myProfile.saveFailed', { message: error.message });
      return;
    }

    formStatusEl.className = 'text-sm text-emerald-600';
    formStatusEl.textContent = t('myProfile.saved');
    form.querySelector('[data-el="photo-input"]').value = '';
    renderMemberIdCardGated(cardContainer, { supabase, userId });
  }

  async function handleLeaveChurch() {
    const ok = await confirmDialog({ message: t('account.confirmLeaveChurch'), danger: true });
    if (!ok) return;

    const { error } = await supabase.rpc('leave_church');
    if (error) {
      window.alert(t('account.leaveChurchFailed', { message: error.message }));
      return;
    }

    close();
    window.alert(t('account.leftChurch'));
    await supabase.auth.signOut({ scope: 'global' });
  }

  return { open, root };
}
