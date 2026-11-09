// Member Exit Tracking (Feature 3 of 3): the exit-reason form, shared
// by every path that can end with someone leaving --
// exitReasonDialog() is a plain async dialog (mirrors
// reassignAdminDialog.js's shape) used directly by myProfileModal.js's
// self-service "Leave this church" (skippable) and userManager.js's
// admin "Remove from church" (not skippable); openMemberExitModal()
// is the Member Directory's own "Mark as left" row action, which
// calls record_member_exit() directly rather than going through
// remove_user_from_church() -- a member can have no linked login
// (profile_id is null), so there is no profiles.id to pass that RPC,
// and it's super-admin-only while the Directory is pastoral-team-
// gated (record_member_exit()'s own authorization already covers
// that, sql/136_member_exits.sql).
import { t } from '../i18n.js';
import { EXIT_REASONS, HOW_WE_KNOW } from './exitReasonFields.js';

export function exitReasonDialog({ skippable = false } = {}) {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4';
    root.innerHTML = `
      <div class="bg-white rounded-xl shadow-xl w-full max-w-md p-6 max-h-[85vh] overflow-y-auto">
        <h2 class="text-lg font-bold mb-4">${escapeHtml(t('memberExit.dialogTitle'))}</h2>
        <div class="space-y-3">
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">${escapeHtml(t('memberExit.mainReason'))}</label>
            <select data-el="main-reason" class="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
              <option value="">${escapeHtml(t('memberExit.selectReason'))}</option>
              ${EXIT_REASONS.map((r) => `<option value="${r}">${escapeHtml(t(`exitReasons.${r}`))}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">${escapeHtml(t('memberExit.otherReasons'))}</label>
            <div class="flex flex-wrap gap-2 text-xs text-slate-600">
              ${EXIT_REASONS.map((r) => `
                <label class="flex items-center gap-1 border border-slate-200 rounded px-1.5 py-1">
                  <input type="checkbox" data-el="other-reason" value="${r}" class="rounded border-slate-300" />
                  ${escapeHtml(t(`exitReasons.${r}`))}
                </label>
              `).join('')}
            </div>
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">${escapeHtml(t('memberExit.reasonTitle'))}</label>
            <input type="text" data-el="reason-title" maxlength="80" class="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">${escapeHtml(t('memberExit.notes'))}</label>
            <textarea data-el="notes" rows="2" class="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"></textarea>
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">${escapeHtml(t('memberExit.howWeKnow'))}</label>
            <select data-el="how-we-know" class="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
              <option value="">${escapeHtml(t('common.select'))}</option>
              ${HOW_WE_KNOW.map((h) => `<option value="${h}">${escapeHtml(t(`memberExit.howWeKnow.${h}`))}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">${escapeHtml(t('memberExit.joinedOtherChurch'))}</label>
            <select data-el="joined-other-church" class="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
              <option value="unknown">${escapeHtml(t('memberExit.joinedOtherChurch.unknown'))}</option>
              <option value="yes">${escapeHtml(t('memberExit.joinedOtherChurch.yes'))}</option>
              <option value="no">${escapeHtml(t('memberExit.joinedOtherChurch.no'))}</option>
            </select>
          </div>
          <label class="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" data-el="open-to-follow-up" class="rounded border-slate-300" />
            ${escapeHtml(t('memberExit.openToFollowUp'))}
          </label>
          <p data-el="error" class="text-sm text-rose-600 hidden"></p>
        </div>
        <div class="flex justify-end gap-2 mt-5">
          <button type="button" data-action="cancel" class="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100">${escapeHtml(t('common.cancel'))}</button>
          ${skippable ? `<button type="button" data-action="skip" class="px-4 py-2 rounded-lg text-slate-600 border border-slate-300 hover:bg-slate-50">${escapeHtml(t('memberExit.skip'))}</button>` : ''}
          <button type="button" data-action="submit" class="px-4 py-2 rounded-lg text-white font-medium bg-rose-600 hover:bg-rose-700">${escapeHtml(t('memberExit.submit'))}</button>
        </div>
      </div>
    `;
    document.body.appendChild(root);

    function finish(result) {
      document.removeEventListener('keydown', onKeydown);
      document.body.removeChild(root);
      resolve(result);
    }
    function onKeydown(e) { if (e.key === 'Escape') finish(null); }

    root.querySelector('[data-action="cancel"]').addEventListener('click', () => finish(null));
    root.querySelector('[data-action="skip"]')?.addEventListener('click', () => finish({
      main_reason: 'unknown', other_reasons: [], reason_title: null, notes: null,
      how_we_know: null, joined_other_church: null, open_to_follow_up: false,
    }));
    root.querySelector('[data-action="submit"]').addEventListener('click', () => {
      const mainReason = root.querySelector('[data-el="main-reason"]').value;
      const errorEl = root.querySelector('[data-el="error"]');
      if (!mainReason) {
        errorEl.textContent = t('memberExit.reasonRequired');
        errorEl.classList.remove('hidden');
        return;
      }
      const otherReasons = Array.from(root.querySelectorAll('[data-el="other-reason"]:checked')).map((cb) => cb.value);
      finish({
        main_reason: mainReason,
        other_reasons: otherReasons,
        reason_title: root.querySelector('[data-el="reason-title"]').value.trim() || null,
        notes: root.querySelector('[data-el="notes"]').value.trim() || null,
        how_we_know: root.querySelector('[data-el="how-we-know"]').value || null,
        joined_other_church: root.querySelector('[data-el="joined-other-church"]').value || null,
        open_to_follow_up: root.querySelector('[data-el="open-to-follow-up"]').checked,
      });
    });
    root.addEventListener('click', (e) => { if (e.target === root) finish(null); });
    document.addEventListener('keydown', onKeydown);
  });
}

export async function openMemberExitModal({ supabase, member, onDone }) {
  const reason = await exitReasonDialog({ skippable: false });
  if (!reason) return;

  const { error } = await supabase.rpc('record_member_exit', {
    p_member_id: member.id,
    p_main_reason: reason.main_reason,
    p_other_reasons: reason.other_reasons,
    p_reason_title: reason.reason_title,
    p_notes: reason.notes,
    p_how_we_know: reason.how_we_know,
    p_joined_other_church: reason.joined_other_church,
    p_open_to_follow_up: reason.open_to_follow_up,
  });
  if (error) {
    window.alert(t('memberExit.saveFailed', { message: error.message }));
    return;
  }
  onDone?.();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
