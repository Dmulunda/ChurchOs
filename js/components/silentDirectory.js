// Silent Directory: a dedicated roster of every Silent (is_silent=true)
// person, paired with the existing global User Directory
// (userManager.js). Modeled on that same table/action shape, with a
// much smaller field set and the shared User Status field
// (directory.userStatus.*, same enum as guestOnboardingHub.js's
// USER_STATUSES) driving the pipeline: a Silent person reaches Member
// status (whether graduated from a Guest Hub lead or set directly
// here), then can be promoted to a full Active account.
import { createGuestSilentDetailDrawer } from './guestSilentDetailDrawer.js';
import { createUserEditModal } from './userEditModal.js';
import { extractFunctionErrorMessage } from '../utils/edgeFunctionError.js';
import { t } from '../i18n.js';

const USER_STATUSES = ['new_guest', 'visitor_other_church', 'out_of_city', 'member', 'lost_member'];

// Same column set userManager.js's own global-scope query selects --
// userEditModal.js's open(user) expects exactly this shape, since it's
// the identical "Edit" modal the User Directory already uses.
const PROFILE_COLUMNS = 'id, full_name, phone, address, photo_path, member_title, parish, sex, birth_date, birth_country, birth_city, card_revoked_at, signature_data, global_role, joined_at, user_status, is_silent, can_view_all_departments, can_manage_pastoral_cases, can_post_global_announcements, can_message_any_member, can_approve_any_membership, profile_emails ( email )';

export function renderSilentDirectory(container, { supabase, currentUserId }) {
  const bodyEl = container;
  let detailDrawer = null;
  let editModal = null;

  async function load() {
    bodyEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const { data: profiles, error } = await supabase
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('is_silent', true)
      .is('permanently_deleted_at', null)
      .order('full_name');

    if (error) {
      bodyEl.innerHTML = `<p class="text-sm text-rose-600">${t('silentDirectory.loadFailed', { message: error.message })}</p>`;
      return;
    }

    const profileIds = (profiles || []).map((p) => p.id);
    const { data: leads } = profileIds.length > 0
      ? await supabase.from('guest_follow_ups').select('id, user_id, assigned_department_id, prayer_request, wants_pastor_meeting, home_church, notes, city, referral_source, referred_by_name, age_range').in('user_id', profileIds).is('removed_at', null)
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
          <th class="text-left px-4 py-2">${t('silentDirectory.joined')}</th>
          <th class="text-left px-4 py-2">${t('silentDirectory.flags')}</th>
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
      const nameEditBtn = document.createElement('button');
      nameEditBtn.type = 'button';
      nameEditBtn.className = 'ml-1.5 text-xs font-medium text-slate-400 hover:text-slate-600';
      nameEditBtn.textContent = t('silentDirectory.edit');
      nameEditBtn.addEventListener('click', () => openEdit(row));
      nameCell.appendChild(nameEditBtn);
      tr.appendChild(nameCell);

      const contactCell = document.createElement('td');
      contactCell.className = 'px-4 py-2.5 text-slate-500';
      const email = row.profile_emails?.email || '';
      const realEmail = email && !email.endsWith('@noemail.internal') ? email : '';
      contactCell.textContent = [row.phone, realEmail].filter(Boolean).join(' · ') || t('silentDirectory.noContact');
      tr.appendChild(contactCell);

      const joinedCell = document.createElement('td');
      joinedCell.className = 'px-4 py-2.5 text-slate-500 whitespace-nowrap';
      joinedCell.textContent = row.joined_at || '—';
      tr.appendChild(joinedCell);

      // Pulled straight from the guest-intake form (attendanceManager.js's
      // check-in: prayer request / home church / pastor meeting) -- only
      // ever present when this Silent profile came from a guest lead
      // (peopleImportModal.js/manually-added Silent profiles have none
      // of this to show).
      const flagsCell = document.createElement('td');
      flagsCell.className = 'px-4 py-2.5';
      // title= puts the actual written text one hover away -- a flag
      // alone ("Prayer request") doesn't help if nobody noticed it was
      // there at check-in time; this way the content itself is right
      // here without opening the detail drawer.
      // Home church and pastor meeting show BOTH states (not just when
      // true) -- a badge that only ever appears for one answer makes
      // "no badge" ambiguous between "no" and "no data at all". Prayer
      // request and the check-in note stay show-only-if-present since
      // they're free text, where blank unambiguously means "none".
      const flags = [];
      if (lead) {
        flags.push(lead.home_church
          ? { label: t('silentDirectory.flagHasHomeChurch'), cls: 'bg-emerald-50 text-emerald-700', title: lead.home_church }
          : { label: t('silentDirectory.flagNoHomeChurch'), cls: 'bg-amber-50 text-amber-700', title: '' });
        flags.push(lead.wants_pastor_meeting
          ? { label: t('silentDirectory.flagWantsPastor'), cls: 'bg-sky-50 text-sky-600', title: '' }
          : { label: t('silentDirectory.flagNoPastorNeeded'), cls: 'bg-slate-100 text-slate-500', title: '' });
      }
      if (lead?.prayer_request) flags.push({ label: t('silentDirectory.flagPrayerRequest'), cls: 'bg-violet-50 text-violet-600', title: lead.prayer_request });
      if (lead?.notes) flags.push({ label: t('silentDirectory.flagHasNote'), cls: 'bg-rose-50 text-rose-600', title: lead.notes });
      // Plain informational tags (not "needs attention" like the ones
      // above) -- neutral gray so they read differently at a glance.
      if (lead?.city) flags.push({ label: lead.city, cls: 'bg-slate-100 text-slate-600', title: '' });
      if (lead?.referral_source) {
        flags.push({ label: t(`attendance.referral.${lead.referral_source}`), cls: 'bg-slate-100 text-slate-600', title: lead.referred_by_name || '' });
      }
      if (lead?.age_range) flags.push({ label: t(`attendance.ageRange.${lead.age_range}`), cls: 'bg-slate-100 text-slate-600', title: '' });
      flagsCell.innerHTML = flags.map((f) => `<span class="inline-block px-1.5 py-0.5 rounded text-xs font-medium ${f.cls} mr-1 mb-1" ${f.title ? `title="${escapeAttr(f.title)}"` : ''}>${escapeHtml(f.label)}</span>`).join('') || '—';
      tr.appendChild(flagsCell);

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
      actionsCell.className = 'px-4 py-2.5 whitespace-nowrap space-x-2';

      if (!realEmail) {
        const setEmailBtn = document.createElement('button');
        setEmailBtn.type = 'button';
        setEmailBtn.className = 'text-xs font-medium text-slate-600 hover:text-slate-800';
        setEmailBtn.textContent = t('silentDirectory.setEmail');
        setEmailBtn.addEventListener('click', () => openSetEmailRow(row, tr));
        actionsCell.appendChild(setEmailBtn);
      }

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
    detailDrawer.open({ profileId: row.id, guestFollowUpId: lead?.id || null, fullName: row.full_name, joinedAt: row.joined_at });
  }

  // Same "Edit" modal the User Directory already uses (userManager.js)
  // -- full profile fields, department memberships, member card -- not
  // a second, parallel edit UI just for Silent profiles.
  function openEdit(row) {
    if (!editModal) editModal = createUserEditModal({ supabase, currentUserId, onSaved: load });
    editModal.open(row);
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
  function closeInlineForms() {
    document.querySelectorAll('[data-promote-form-for], [data-email-form-for]').forEach((el) => el.remove());
  }

  function openPromoteRow(row, afterRow) {
    const existing = afterRow.nextElementSibling;
    if (existing?.dataset?.promoteFormFor === row.id) { existing.remove(); return; }
    closeInlineForms();

    const formRow = document.createElement('tr');
    formRow.dataset.promoteFormFor = row.id;
    formRow.innerHTML = `
      <td colspan="7" class="px-4 py-3 bg-slate-50">
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

  // A fresh Silent profile usually starts on a @noemail.internal
  // placeholder -- this lets an admin set the real contact email
  // without making the account live (upgrade-silent-user's
  // email_only mode, the same one taxReceiptsAdminBoard.js's Silent
  // Members section already uses), distinct from Promote to Active.
  function openSetEmailRow(row, afterRow) {
    const existing = afterRow.nextElementSibling;
    if (existing?.dataset?.emailFormFor === row.id) { existing.remove(); return; }
    closeInlineForms();

    const formRow = document.createElement('tr');
    formRow.dataset.emailFormFor = row.id;
    formRow.innerHTML = `
      <td colspan="7" class="px-4 py-3 bg-slate-50">
        <div class="flex flex-wrap items-end gap-2">
          <div>
            <label class="block text-xs font-medium text-slate-500 mb-1">${t('silentDirectory.promoteEmail')}</label>
            <input type="email" data-el="set-email" required class="border border-slate-300 rounded-lg px-2 py-1 text-sm" />
          </div>
          <button type="button" data-action="confirm-set-email" class="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">${t('silentDirectory.setEmail')}</button>
          <span data-el="set-email-status" class="text-xs text-slate-500"></span>
        </div>
      </td>
    `;
    afterRow.insertAdjacentElement('afterend', formRow);

    const emailInput = formRow.querySelector('[data-el="set-email"]');
    const statusEl = formRow.querySelector('[data-el="set-email-status"]');

    formRow.querySelector('[data-action="confirm-set-email"]').addEventListener('click', async () => {
      const email = emailInput.value.trim();
      if (!email) return;
      statusEl.className = 'text-xs text-slate-500';
      statusEl.textContent = t('common.saving');

      const { data, error } = await supabase.functions.invoke('upgrade-silent-user', {
        body: { silent_profile_id: row.id, email, email_only: true },
      });
      if (error || data?.error) {
        statusEl.className = 'text-xs text-rose-600';
        statusEl.textContent = error ? await extractFunctionErrorMessage(error) : data.error;
        return;
      }
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

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(str).replaceAll('"', '&quot;');
}
