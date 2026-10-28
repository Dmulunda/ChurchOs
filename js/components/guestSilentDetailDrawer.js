// Shared detail view opened from a Silent Directory row
// (silentDirectory.js) -- shows whatever's known about this person:
// profile basics, the shared User Status, intake form data (only
// present if this Silent profile originated from a Guest Onboarding
// Hub lead, via guest_follow_ups.user_id), Guest Notes
// (guest_follow_up_notes), and department-transfer history if any.
//
// Takes a profile_id and/or a guest_follow_up_id -- a Silent profile
// created via "Add User -> No login yet" or bulk import has no linked
// guest_follow_ups row at all, so the intake-fields/notes/history
// sections simply don't render when there's nothing to show.
import { t, departmentLabel } from '../i18n.js';

export function createGuestSilentDetailDrawer({ supabase }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold" data-el="title"></h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <div data-el="body" class="space-y-4 text-sm"></div>
    </div>
  `;
  document.body.appendChild(root);

  const titleEl = root.querySelector('[data-el="title"]');
  const bodyEl = root.querySelector('[data-el="body"]');

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });

  async function open({ profileId = null, guestFollowUpId = null, fullName = '', joinedAt = null }) {
    titleEl.textContent = fullName;
    bodyEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;
    root.classList.remove('hidden');
    root.classList.add('flex');

    let lead = null;
    if (guestFollowUpId) {
      const { data } = await supabase.from('guest_follow_ups')
        .select('id, phone, email, city, referral_source, referred_by_name, age_range, prayer_request, wants_pastor_meeting, home_church, notes, assigned_department_id, created_at')
        .eq('id', guestFollowUpId)
        .maybeSingle();
      lead = data;
    }

    const [{ data: notes }, { data: transfers }, { data: departments }] = lead
      ? await Promise.all([
          supabase.from('guest_follow_up_notes').select('author_id, note, created_at').eq('guest_follow_up_id', guestFollowUpId).order('created_at'),
          supabase.from('guest_follow_up_transfers').select('from_department_id, to_department_id, note, created_at').eq('guest_follow_up_id', guestFollowUpId).order('created_at'),
          supabase.from('departments').select('id, key'),
        ])
      : [{ data: [] }, { data: [] }, { data: [] }];

    const { data: profileNotes } = profileId
      ? await supabase.from('profile_notes').select('author_id, note, created_at').eq('profile_id', profileId).order('created_at')
      : { data: [] };

    bodyEl.innerHTML = '';

    if (joinedAt) {
      const joinedEl = document.createElement('div');
      joinedEl.innerHTML = `<span class="font-medium text-slate-700">${t('silentDirectory.joined')}:</span> ${escapeHtml(joinedAt)}`;
      bodyEl.appendChild(joinedEl);
    }

    const fields = lead ? [
      [t('guestHub.detail.phone'), lead.phone],
      [t('guestHub.detail.email'), lead.email],
      [t('guestHub.detail.city'), lead.city],
      [t('guestHub.detail.referral'), lead.referral_source ? t(`attendance.referral.${lead.referral_source}`) : null],
      [t('guestHub.detail.referredBy'), lead.referred_by_name],
      [t('guestHub.detail.ageRange'), lead.age_range ? t(`attendance.ageRange.${lead.age_range}`) : null],
      [t('guestHub.detail.prayerRequest'), lead.prayer_request],
      [t('guestHub.detail.wantsPastorMeeting'), lead.wants_pastor_meeting ? t('common.yes') : null],
      [t('guestHub.detail.homeChurch'), lead.home_church],
      [t('guestHub.detail.checkinNote'), lead.notes],
    ].filter(([, value]) => value) : [];

    if (fields.length > 0) {
      const fieldsEl = document.createElement('div');
      fieldsEl.innerHTML = `<div class="font-medium text-slate-700 mb-1">${t('silentDirectory.intakeInfo')}</div>` +
        fields.map(([label, value]) => `<div class="text-slate-600"><span class="font-medium text-slate-700">${escapeHtml(label)}:</span> ${escapeHtml(value)}</div>`).join('');
      bodyEl.appendChild(fieldsEl);
    } else if (!profileId) {
      bodyEl.innerHTML = `<p class="text-sm text-slate-500">${t('silentDirectory.noDetails')}</p>`;
    }

    if (lead) {
      const notesEl = document.createElement('div');
      notesEl.className = 'border-t border-slate-200 pt-3';
      notesEl.innerHTML = `<div class="font-medium text-slate-700 mb-1">${t('guestHub.notes.title')}</div>` +
        ((notes || []).length > 0
          ? notes.map((n) => `<div class="text-xs text-slate-500 mb-1">${escapeHtml(n.created_at.slice(0, 10))} — ${escapeHtml(n.note)}</div>`).join('')
          : `<p class="text-xs text-slate-400">${t('guestHub.notes.empty')}</p>`);
      bodyEl.appendChild(notesEl);

      if ((transfers || []).length > 0) {
        const historyEl = document.createElement('div');
        historyEl.className = 'border-t border-slate-200 pt-3';
        historyEl.innerHTML = `<div class="font-medium text-slate-700 mb-1">${t('guestHub.detail.history')}</div>` +
          transfers.map((h) => {
            const from = h.from_department_id ? departmentLabel(departments.find((d) => d.id === h.from_department_id)?.key) : t('guestHub.historyIntake');
            const to = departmentLabel(departments.find((d) => d.id === h.to_department_id)?.key);
            return `<div class="text-xs text-slate-500">${escapeHtml(h.created_at.slice(0, 10))} — ${escapeHtml(from)} → ${escapeHtml(to)}${h.note ? ` (${escapeHtml(h.note)})` : ''}</div>`;
          }).join('');
        bodyEl.appendChild(historyEl);
      }
    }

    // Always available (unlike the guest-case notes above, which only
    // exist when a linked guest_follow_ups row does) -- this is what a
    // bulk-imported or manually-added Silent profile (no guest case at
    // all) was missing entirely: nowhere to attach a note.
    if (profileId) {
      const profileNotesEl = document.createElement('div');
      profileNotesEl.className = 'border-t border-slate-200 pt-3';
      profileNotesEl.innerHTML = `
        <div class="font-medium text-slate-700 mb-1">${t('silentDirectory.notes.title')}</div>
        ${(profileNotes || []).length > 0
          ? profileNotes.map((n) => `<div class="text-xs text-slate-500 mb-1">${escapeHtml(n.created_at.slice(0, 10))} — ${escapeHtml(n.note)}</div>`).join('')
          : `<p class="text-xs text-slate-400 mb-1">${t('guestHub.notes.empty')}</p>`}
        <textarea data-el="new-profile-note" rows="2" placeholder="${t('guestHub.notes.placeholder')}" class="w-full border border-slate-300 rounded-lg px-2 py-1 text-sm mb-1.5"></textarea>
        <button type="button" data-action="add-profile-note" class="text-xs font-medium text-indigo-600 hover:text-indigo-800">${t('guestHub.notes.add')}</button>
      `;
      const newNoteTextarea = profileNotesEl.querySelector('[data-el="new-profile-note"]');
      profileNotesEl.querySelector('[data-action="add-profile-note"]').addEventListener('click', async () => {
        const note = newNoteTextarea.value.trim();
        if (!note) return;
        const { error } = await supabase.rpc('add_profile_note', { p_profile_id: profileId, p_note: note });
        if (error) { window.alert(error.message); return; }
        open({ profileId, guestFollowUpId, fullName, joinedAt });
      });
      bodyEl.appendChild(profileNotesEl);
    }
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  return { open, close, root };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
