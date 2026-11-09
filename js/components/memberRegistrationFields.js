// Shared field set for the Member Database self-registration form
// (Feature 2 of 3) -- used by BOTH the public, unauthenticated
// register.html (js/publicMemberRegistration.js) and the in-app
// pre-filled version for a logged-in member (memberRegistrationModal.js),
// so the ~9 fields exist in exactly one place rather than two
// near-identical copies.
//
// age_group reuses attendance.ageRange.* labels -- same bucket set
// already used by attendance/guest intake (under_18/18_29/30_40/
// 40_50/50_plus), one consistent scheme app-wide rather than a second
// one just for this form.
import { t } from '../i18n.js';

export const GENDERS = ['M', 'F'];
export const MARITAL_STATUSES = ['single', 'married', 'widowed', 'divorced', 'separated'];
export const AGE_GROUPS = ['under_18', '18_29', '30_40', '40_50', '50_plus'];
export const SKILLS = ['music', 'singing', 'media_video', 'it', 'teaching', 'cooking', 'driving', 'accounting', 'construction'];

export function renderMemberFormFields({ values = {} } = {}) {
  const v = values;
  return `
    <div>
      <label class="block text-sm font-medium text-slate-600 mb-1">${t('memberRegistration.fullName')}</label>
      <input type="text" name="full_name" required value="${escapeAttr(v.full_name)}"
             class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
    </div>

    <div class="grid sm:grid-cols-2 gap-2">
      <div>
        <label class="block text-sm font-medium text-slate-600 mb-1">${t('memberRegistration.gender')}</label>
        <select name="gender" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
          <option value="">${t('common.select')}</option>
          ${GENDERS.map((g) => `<option value="${g}" ${v.gender === g ? 'selected' : ''}>${t(g === 'M' ? 'memberCard.male' : 'memberCard.female')}</option>`).join('')}
        </select>
      </div>
      <div>
        <label class="block text-sm font-medium text-slate-600 mb-1">${t('memberRegistration.maritalStatus')}</label>
        <select name="marital_status" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
          <option value="">${t('common.select')}</option>
          ${MARITAL_STATUSES.map((m) => `<option value="${m}" ${v.marital_status === m ? 'selected' : ''}>${t(`memberRegistration.maritalStatus.${m}`)}</option>`).join('')}
        </select>
      </div>
    </div>

    <div>
      <label class="block text-sm font-medium text-slate-600 mb-1">${t('memberRegistration.address')}</label>
      <input type="text" name="address_street" value="${escapeAttr(v.address_street)}" placeholder="${t('memberRegistration.addressStreetPlaceholder')}"
             class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-1.5" />
      <div class="grid grid-cols-2 gap-2">
        <input type="text" name="address_city" value="${escapeAttr(v.address_city)}" placeholder="${t('memberRegistration.addressCityPlaceholder')}"
               class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        <input type="text" name="address_province" value="${escapeAttr(v.address_province)}" placeholder="${t('memberRegistration.addressProvincePlaceholder')}"
               class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      </div>
      <input type="text" name="address_postal" value="${escapeAttr(v.address_postal)}" placeholder="${t('memberRegistration.addressPostalPlaceholder')}"
             class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mt-1.5" />
    </div>

    <div class="grid sm:grid-cols-2 gap-2">
      <div>
        <label class="block text-sm font-medium text-slate-600 mb-1">${t('memberRegistration.ageGroup')}</label>
        <select name="age_group" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
          <option value="">${t('common.select')}</option>
          ${AGE_GROUPS.map((a) => `<option value="${a}" ${v.age_group === a ? 'selected' : ''}>${t(`attendance.ageRange.${a}`)}</option>`).join('')}
        </select>
      </div>
      <div>
        <label class="block text-sm font-medium text-slate-600 mb-1">${t('memberRegistration.career')}</label>
        <input type="text" name="career" value="${escapeAttr(v.career)}" placeholder="${t('memberRegistration.careerPlaceholder')}"
               class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      </div>
    </div>

    <div class="grid sm:grid-cols-2 gap-2">
      <input type="tel" name="phone" value="${escapeAttr(v.phone)}" placeholder="${t('memberRegistration.phonePlaceholder')}"
             class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      <input type="email" name="email" value="${escapeAttr(v.email)}" placeholder="${t('memberRegistration.emailPlaceholder')}"
             class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
    </div>

    <div>
      <label class="block text-sm font-medium text-slate-600 mb-1">${t('memberRegistration.skills')}</label>
      <div class="grid grid-cols-2 gap-1.5 text-sm text-slate-600">
        ${SKILLS.map((s) => `
          <label class="flex items-center gap-1.5">
            <input type="checkbox" name="skills" value="${s}" ${(v.skills || []).includes(s) ? 'checked' : ''} class="rounded border-slate-300">
            ${t(`memberRegistration.skill.${s}`)}
          </label>
        `).join('')}
      </div>
      <input type="text" name="skills_other" value="${escapeAttr(v.skills_other)}" placeholder="${t('memberRegistration.skillsOtherPlaceholder')}"
             class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mt-1.5" />
    </div>
  `;
}

export function readMemberFormFields(form) {
  const fd = new FormData(form);
  return {
    p_full_name: fd.get('full_name'),
    p_gender: fd.get('gender') || null,
    p_marital_status: fd.get('marital_status') || null,
    p_address_street: fd.get('address_street') || null,
    p_address_city: fd.get('address_city') || null,
    p_address_province: fd.get('address_province') || null,
    p_address_postal: fd.get('address_postal') || null,
    p_age_group: fd.get('age_group') || null,
    p_career: fd.get('career') || null,
    p_phone: fd.get('phone') || null,
    p_email: fd.get('email') || null,
    p_skills: fd.getAll('skills').length > 0 ? fd.getAll('skills') : null,
    p_skills_other: fd.get('skills_other') || null,
  };
}

function escapeAttr(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML.replace(/"/g, '&quot;');
}
