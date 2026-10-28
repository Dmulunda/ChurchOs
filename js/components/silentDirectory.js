// Silent Directory: a dedicated roster of every Silent (is_silent=true)
// person, paired with the existing global User Directory
// (userManager.js). Modeled on that same table/action shape, with a
// much smaller field set and the shared User Status field
// (directory.userStatus.*, same enum as guestOnboardingHub.js's
// USER_STATUSES) driving the pipeline: a Silent person reaches Member
// status (whether graduated from a Guest Hub lead or set directly
// here), then can be promoted to a full Active account.
import { createGuestSilentDetailDrawer } from './guestSilentDetailDrawer.js';
import { extractFunctionErrorMessage } from '../utils/edgeFunctionError.js';
import { t } from '../i18n.js';

const USER_STATUSES = ['new_guest', 'visitor_other_church', 'out_of_city', 'member', 'lost_member'];

export function renderSilentDirectory(container, { supabase, currentUserId }) {
  const bodyEl = container;
  let detailDrawer = null;

  async function load() {
    bodyEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, full_name, phone, user_status, profile_emails ( email )')
      .eq('is_silent', true)
      .is('permanently_deleted_at', null)
      .order('full_name');

    if (error) {
      bodyEl.innerHTML = `<p class="text-sm text-rose-600">${t('silentDirectory.loadFailed', { message: error.message })}</p>`;
      return;
    }

    const profileIds = (profiles || []).map((p) => p.id);
    const { data: leads } = profileIds.length > 0
      ? await supabase.from('guest_follow_ups').select('id, user_id, assigned_department_id').in('user_id', profileIds).is('removed_at', null)
      : { data: [] };
    const leadByProfileId = new Map((leads || []).map((l) => [l.user_id, l]));

    bodyEl.innerHTML = '';

    if (!profiles || profiles.length === 0) {
      const emptyEl = document.createElement('p');
      emptyEl.className = 'text-sm text-slate-500';
      emptyEl.textContent = t('silentDirectory.none');
      bodyEl.appendChild(emptyEl);
      return;
    }

    const table = document.createElement('table');
    table.className = 'w-full text-sm';
    table.innerHTML = `
      <thead class="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
        <tr>
          <th class="text-left px-4 py-2">${t('silentDirectory.name')}</th>
          <th class="text-left px-4 py-2">${t('silentDirectory.contact')}</th>
          <th class="text-left px-4 py-2">${t('guestHub.userStatus')}</th>
          <th class="text-left px-4 py-2">${t('silentDirectory.guestLead')}</th>
          <th class="text-left px-4 py-2"></th>
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-100"></tbody>
    `;
    const tbody = table.querySelector('tbody');

    profiles.forEach((row) => {
      const lead = leadByProfileId.get(row.id) || null;
      const tr = document.createElement('tr');

      const nameCell = document.createElement('td');
      nameCell.className = 'px-4 py-2.5 font-medium whitespace-nowrap';
      const nameBtn = document.createElement('button');
      nameBtn.type = 'button';
      nameBtn.className = 'text-slate-800 hover:text-indigo-600 hover:underline';
      nameBtn.textContent = row.full_name;
      nameBtn.addEventListener('click', () => openDetail(row, lead));
      nameCell.appendChild(nameBtn);
      tr.appendChild(nameCell);

      const contactCell = document.createElement('td');
      contactCell.className = 'px-4 py-2.5 text-slate-500';
      const email = row.profile_emails?.email || '';
      const realEmail = email && !email.endsWith('@noemail.internal') ? email : '';
      contactCell.textContent = [row.phone, realEmail].filter(Boolean).join(' · ') || t('silentDirectory.noContact');
      tr.appendChild(contactCell);

      const statusCell = document.createElement('td');
      statusCell.className = 'px-4 py-2.5';
      const statusSelect = document.createElement('select');
      statusSelect.className = 'border border-slate-300 rounded-lg px-2 py-1 text-sm';
      statusSelect.innerHTML = USER_STATUSES.map((s) => `<option value="${s}" ${s === row.user_status ? 'selected' : ''}>${t(`directory.userStatus.${s}`)}</option>`).join('');
      statusSelect.addEventListener('change', () => updateUserStatus(row, statusSelect.value));
      statusCell.appendChild(statusSelect);
      tr.appendChild(statusCell);

      const leadCell = document.createElement('td');
      leadCell.className = 'px-4 py-2.5 text-slate-500 text-xs';
      leadCell.textContent = lead ? t('silentDirectory.fromGuestHub') : '—';
      tr.appendChild(leadCell);

      const actionsCell = document.createElement('td');
      actionsCell.className = 'px-4 py-2.5 whitespace-nowrap';
      const promoteBtn = document.createElement('button');
      promoteBtn.type = 'button';
      promoteBtn.className = row.user_status === 'member'
        ? 'text-xs font-medium text-indigo-600 hover:text-indigo-800'
        : 'text-xs font-medium text-slate-400 cursor-not-allowed';
      promoteBtn.textContent = t('silentDirectory.promoteToActive');
      promoteBtn.disabled = row.user_status !== 'member';
      promoteBtn.title = row.user_status !== 'member' ? t('silentDirectory.promoteDisabledHint') : '';
      promoteBtn.addEventListener('click', () => openPromoteRow(row, tr));
      actionsCell.appendChild(promoteBtn);
      tr.appendChild(actionsCell);

      tbody.appendChild(tr);
    });

    bodyEl.appendChild(table);
  }

  function openDetail(row, lead) {
    if (!detailDrawer) detailDrawer = createGuestSilentDetailDrawer({ supabase });
    detailDrawer.open({ profileId: row.id, guestFollowUpId: lead?.id || null, fullName: row.full_name });
  }

  async function updateUserStatus(row, newStatus) {
    const { error } = await supabase.from('profiles').update({ user_status: newStatus }).eq('id', row.id);
    if (error) {
      window.alert(t('silentDirectory.updateFailed', { message: error.message }));
      return;
    }
    load();
  }

  // Inline promote form (email + password, type-one-or-generate same
  // as userCreatorModal.js's own non-silent "Add User" path) rather
  // than an email-a-setup-link flow -- that's the separate Account
  // Claims pattern (silentUserClaims.js), not what a straightforward
  // admin-initiated upgrade needs.
  function openPromoteRow(row, afterRow) {
    const existing = afterRow.nextElementSibling;
    if (existing?.dataset?.promoteFormFor === row.id) { existing.remove(); return; }
    document.querySelectorAll('[data-promote-form-for]').forEach((el) => el.remove());

    const formRow = document.createElement('tr');
    formRow.dataset.promoteFormFor = row.id;
    formRow.innerHTML = `
      <td colspan="5" class="px-4 py-3 bg-slate-50">
        <div class="flex flex-wrap items-end gap-2">
          <div>
            <label class="block text-xs font-medium text-slate-500 mb-1">${t('silentDirectory.promoteEmail')}</label>
            <input type="email" data-el="promote-email" required class="border border-slate-300 rounded-lg px-2 py-1 text-sm" />
          </div>
          <div>
            <label class="block text-xs font-medium text-slate-500 mb-1">${t('userCreator.password')}</label>
            <div class="flex gap-1.5">
              <input type="text" data-el="promote-password" required minlength="6" class="border border-slate-300 rounded-lg px-2 py-1 text-sm" />
              <button type="button" data-action="generate-password" class="text-xs font-medium text-indigo-600 hover:text-indigo-800 whitespace-nowrap">${t('userCreator.generatePassword')}</button>
            </div>
          </div>
          <button type="button" data-action="confirm-promote" class="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">${t('silentDirectory.promoteToActive')}</button>
          <span data-el="promote-status" class="text-xs text-slate-500"></span>
        </div>
      </td>
    `;
    afterRow.insertAdjacentElement('afterend', formRow);

    const emailInput = formRow.querySelector('[data-el="promote-email"]');
    const passwordInput = formRow.querySelector('[data-el="promote-password"]');
    const statusEl = formRow.querySelector('[data-el="promote-status"]');

    formRow.querySelector('[data-action="generate-password"]').addEventListener('click', () => {
      const bytes = new Uint8Array(9);
      window.crypto.getRandomValues(bytes);
      passwordInput.value = btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '').slice(0, 12);
    });

    formRow.querySelector('[data-action="confirm-promote"]').addEventListener('click', async () => {
      const email = emailInput.value.trim();
      const password = passwordInput.value;
      if (!email || password.length < 6) {
        statusEl.className = 'text-xs text-rose-600';
        statusEl.textContent = t('silentDirectory.promoteValidation');
        return;
      }
      statusEl.className = 'text-xs text-slate-500';
      statusEl.textContent = t('common.saving');

      const { data, error } = await supabase.functions.invoke('upgrade-silent-user', {
        body: { silent_profile_id: row.id, email, password },
      });
      if (error || data?.error) {
        statusEl.className = 'text-xs text-rose-600';
        statusEl.textContent = error ? await extractFunctionErrorMessage(error) : data.error;
        return;
      }

      window.alert(t('silentDirectory.promoteSuccess', { name: row.full_name, email, password }));
      load();
    });
  }

  load();
}

export function createSilentDirectoryModal({ supabase, currentUserId, title }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[85vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${title}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <div data-el="body"></div>
    </div>
  `;
  document.body.appendChild(root);

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });

  function open() {
    root.classList.remove('hidden');
    root.classList.add('flex');
    renderSilentDirectory(root.querySelector('[data-el="body"]'), { supabase, currentUserId });
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  return { open, root };
}
