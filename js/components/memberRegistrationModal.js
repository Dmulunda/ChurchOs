// In-app version of the Member Database self-registration form
// (Feature 2 of 3) -- same fields/RPC as the public register.html
// (js/publicMemberRegistration.js), reusing memberRegistrationFields.js
// so the form exists in exactly one place. Pre-fills from the member's
// own `members` row if one is already linked (richer data -- marital
// status, skills, etc. that don't exist on `profiles` at all), else
// falls back to a light prefill from profiles/profile_emails.
import { t } from '../i18n.js';
import { renderMemberFormFields, readMemberFormFields } from './memberRegistrationFields.js';

export function createMemberRegistrationModal({ supabase, currentUserId }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[85vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${t('memberRegistration.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <div data-el="body"><p class="text-sm text-slate-500">${t('common.loading')}</p></div>
    </div>
  `;
  document.body.appendChild(root);

  const bodyEl = root.querySelector('[data-el="body"]');

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });

  async function open() {
    root.classList.remove('hidden');
    root.classList.add('flex');
    bodyEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const values = await loadPrefill();
    renderForm(values);
  }

  async function loadPrefill() {
    const { data: member } = await supabase
      .from('members')
      .select('full_name, gender, marital_status, address_street, address_city, address_province, address_postal, age_group, career, phone, email, skills, skills_other')
      .eq('profile_id', currentUserId)
      .maybeSingle();
    if (member) return member;

    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, sex, phone, profile_emails ( email )')
      .eq('id', currentUserId)
      .maybeSingle();
    return {
      full_name: profile?.full_name || '',
      gender: profile?.sex || '',
      phone: profile?.phone || '',
      email: profile?.profile_emails?.email || '',
    };
  }

  function renderForm(values) {
    bodyEl.innerHTML = `
      <form data-el="form" class="space-y-3">
        ${renderMemberFormFields({ values })}

        <label class="flex items-start gap-2 text-sm text-slate-600 pt-2 border-t border-slate-100">
          <input type="checkbox" name="consent" required class="rounded border-slate-300 mt-0.5">
          ${t('memberRegistration.consentLabel')}
        </label>

        <div class="flex items-center gap-3">
          <button type="submit" data-el="submit-btn"
                  class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
            ${t('memberRegistration.submit')}
          </button>
          <span data-el="form-status" class="text-sm text-slate-500"></span>
        </div>
      </form>
    `;

    const form = bodyEl.querySelector('[data-el="form"]');
    const submitBtn = bodyEl.querySelector('[data-el="submit-btn"]');
    const statusEl = bodyEl.querySelector('[data-el="form-status"]');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      submitBtn.disabled = true;
      statusEl.className = 'text-sm text-slate-500';
      statusEl.textContent = t('common.saving');

      const fields = readMemberFormFields(form);
      const { error } = await supabase.rpc('submit_member_registration', {
        p_tenant_slug: null,
        ...fields,
        p_consent: form.elements.consent.checked,
        p_profile_id: currentUserId,
        p_honeypot: null,
      });

      submitBtn.disabled = false;
      if (error) {
        statusEl.className = 'text-sm text-rose-600';
        statusEl.textContent = t('common.saveFailed', { message: error.message });
        return;
      }

      statusEl.className = 'text-sm text-emerald-600';
      statusEl.textContent = t('common.saved');
    });
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  return { open, root };
}
