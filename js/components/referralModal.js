// Super Admin tool: shows the church's own referral code/link (shared as
// index.html?ref=<code>, forwarded by welcomePage.js's "Get Started" links
// to authScreen.js, which records it via record_referral() -- see
// sql/saas_platform/118_referral_program.sql) and the list of churches this
// one has referred so far, with status. Modeled on inviteLinkModal.js
// (closest existing analog: a shareable tenant-scoped code + link + copy
// button), but a separate component -- referring another church to the
// platform is a different concept from inviting a member into this one.
import { t } from '../i18n.js';
import { publicPageUrl } from '../utils/publicUrl.js';

const STATUS_BADGE = {
  pending: 'bg-slate-100 text-slate-500',
  qualified: 'bg-amber-50 text-amber-700',
  applied: 'bg-emerald-50 text-emerald-700',
};

export function createReferralModal({ supabase, referralCode }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${t('referral.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <div data-el="body"></div>
    </div>
  `;
  document.body.appendChild(root);

  const bodyEl = root.querySelector('[data-el="body"]');
  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });

  const referralUrl = referralCode ? publicPageUrl('index.html', { ref: referralCode }) : null;

  async function load() {
    bodyEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;
    const { data, error } = await supabase.rpc('list_my_referrals');
    render(error ? [] : (data || []));
  }

  function render(referrals) {
    const list = referrals.length
      ? referrals.map((r) => `
          <div class="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
            <span class="text-sm text-slate-700">${escapeHtml(r.referred_church_name)}</span>
            <span class="text-xs px-2 py-0.5 rounded-full ${STATUS_BADGE[r.status] || 'bg-slate-100 text-slate-500'}">${t(`referral.status.${r.status}`)}</span>
          </div>
        `).join('')
      : `<p class="text-sm text-slate-400">${t('referral.none')}</p>`;

    bodyEl.innerHTML = `
      <p class="text-sm text-slate-600 mb-2">${t('referral.intro')}</p>
      ${referralUrl ? `
        <div class="flex gap-2 mb-4">
          <input type="text" readonly value="${escapeHtml(referralUrl)}" data-el="referral-url-input"
                 class="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm bg-slate-50 text-slate-600" />
          <button type="button" data-action="copy" class="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">
            ${t('referral.copy')}
          </button>
        </div>
        <p data-el="copy-status" class="text-sm text-emerald-600 mb-4 hidden">${t('referral.copied')}</p>
      ` : `<p class="text-sm text-rose-600 mb-4">${t('referral.noCode')}</p>`}

      <div class="border-t border-slate-200 pt-4">
        <p class="text-sm font-medium text-slate-700 mb-2">${t('referral.yourReferrals')}</p>
        ${list}
      </div>
    `;

    const copyBtn = bodyEl.querySelector('[data-action="copy"]');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        const input = bodyEl.querySelector('[data-el="referral-url-input"]');
        input.select();
        try {
          await navigator.clipboard.writeText(referralUrl);
        } catch {
          document.execCommand('copy');
        }
        bodyEl.querySelector('[data-el="copy-status"]').classList.remove('hidden');
      });
    }
  }

  function open() {
    root.classList.remove('hidden');
    root.classList.add('flex');
    load();
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  return { open };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
