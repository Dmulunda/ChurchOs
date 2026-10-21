// Admin review queue for a self-serve signup that name-matched a
// Silent user but couldn't be corroborated by email/phone (see
// authScreen.js's silent-match flow and
// supabase/functions/upgrade-silent-user). Approve links the claimed
// email to the existing Silent profile (same row, same id, history
// intact) via review-silent-user-claim; reject creates an ordinary
// brand-new account instead. Either way the person gets a
// password-setup email once a decision is made -- nobody's password
// is ever handled here.
import { confirmDialog } from './confirmDialog.js';
import { extractFunctionErrorMessage } from '../utils/edgeFunctionError.js';
import { t } from '../i18n.js';

export function renderSilentUserClaims(container, { supabase }) {
  container.innerHTML = `<div data-el="list" class="space-y-2"></div>`;
  const listEl = container.querySelector('[data-el="list"]');
  load();

  async function load() {
    listEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const { data, error } = await supabase
      .from('silent_user_claims')
      .select('id, claimed_full_name, claimed_email, claimed_phone, created_at, silent_profile:profiles!silent_profile_id ( full_name )')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    if (error) {
      listEl.innerHTML = `<p class="text-sm text-rose-600">${t('silentClaims.loadFailed', { message: error.message })}</p>`;
      return;
    }

    if (!data || data.length === 0) {
      listEl.innerHTML = `<p class="text-sm text-slate-500">${t('silentClaims.none')}</p>`;
      return;
    }

    listEl.innerHTML = '';
    data.forEach((row) => listEl.appendChild(buildRow(row)));
  }

  function buildRow(row) {
    const el = document.createElement('div');
    el.className = 'border border-slate-200 rounded-lg p-3';
    el.innerHTML = `
      <div class="text-sm">
        <span class="font-medium text-slate-800">${escapeHtml(row.claimed_full_name)}</span>
        <span class="text-slate-400">${t('silentClaims.mightBe', { name: escapeHtml(row.silent_profile?.full_name || '—') })}</span>
      </div>
      <div class="text-xs text-slate-500 mt-1">
        ${escapeHtml(row.claimed_email || '—')}${row.claimed_phone ? ` · ${escapeHtml(row.claimed_phone)}` : ''}
      </div>
      <div class="flex items-center gap-2 mt-2">
        <button type="button" data-action="approve" class="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700">
          ${t('silentClaims.approve')}
        </button>
        <button type="button" data-action="reject" class="px-3 py-1.5 rounded-lg bg-rose-100 text-rose-700 text-xs font-medium hover:bg-rose-200">
          ${t('silentClaims.reject')}
        </button>
        <span data-el="row-status" class="text-xs text-slate-500"></span>
      </div>
    `;

    el.querySelector('[data-action="approve"]').addEventListener('click', () => decide(row, 'approve', el));
    el.querySelector('[data-action="reject"]').addEventListener('click', () => decide(row, 'reject', el));
    return el;
  }

  async function decide(row, decision, el) {
    const confirmed = await confirmDialog({
      message: decision === 'approve'
        ? t('silentClaims.confirmApprove', { claimed: row.claimed_full_name, existing: row.silent_profile?.full_name || '—' })
        : t('silentClaims.confirmReject', { claimed: row.claimed_full_name }),
      confirmLabel: decision === 'approve' ? t('silentClaims.approve') : t('silentClaims.reject'),
      danger: decision === 'reject',
    });
    if (!confirmed) return;

    const statusEl = el.querySelector('[data-el="row-status"]');
    statusEl.className = 'text-xs text-slate-500';
    statusEl.textContent = t('common.saving');

    const { error } = await supabase.functions.invoke('review-silent-user-claim', {
      body: { claim_id: row.id, decision },
    });

    if (error) {
      statusEl.className = 'text-xs text-rose-600';
      statusEl.textContent = await extractFunctionErrorMessage(error);
      return;
    }

    load();
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
