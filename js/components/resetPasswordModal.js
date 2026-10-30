// Super-Admin-only "reset this member's password" tool — the Active
// Directory-style flow: pick a member, optionally type a new password
// (or leave it blank for a random one), and hand the result to them
// directly, instead of relying on them clicking a reset-link email.
// Calls the admin-reset-password Edge Function (supabase/functions/)
// since setting another user's password needs the service-role key,
// which never ships to the browser.
//
// functionName lets siteAdminPage.js reuse this exact same UI for its
// own cross-tenant version (site-admin-reset-password/index.ts) --
// deliberately a separate Edge Function with its own Site-Admin-only
// gate and audit log, not a bypass flag on this one; see that
// function's own header comment for why.
import { t } from '../i18n.js';

export function createResetPasswordModal({ supabase, functionName = 'admin-reset-password' }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${t('users.resetPasswordTitle')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <p data-el="intro" class="text-sm text-slate-500 mb-4"></p>
      <form data-el="form">
        <label class="block text-sm font-medium text-slate-600 mb-1">${t('users.newPasswordOptional')}</label>
        <input type="text" name="password" minlength="6" placeholder="${t('users.newPasswordPlaceholder')}"
               class="w-full border border-slate-300 rounded-lg px-3 py-2 mb-3" />
        <div class="flex items-center gap-3">
          <button type="submit" data-el="submit-btn"
                  class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
            ${t('users.resetPasswordAction')}
          </button>
          <span data-el="status" class="text-sm text-slate-500"></span>
        </div>
      </form>
      <div data-el="result" class="hidden mt-4 pt-4 border-t border-slate-200">
        <label class="block text-sm font-medium text-slate-600 mb-1">${t('users.newPasswordResultLabel')}</label>
        <div class="flex items-center gap-2">
          <input type="text" data-el="result-input" readonly
                 class="flex-1 border border-slate-300 rounded-lg px-3 py-2 font-mono bg-slate-50" />
          <button type="button" data-el="copy-btn"
                  class="px-3 py-2 rounded-lg bg-slate-700 text-white text-sm font-medium hover:bg-slate-800 whitespace-nowrap">
            ${t('users.copy')}
          </button>
        </div>
        <p class="text-xs text-slate-400 mt-2">${t('users.newPasswordHint')}</p>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const introEl = root.querySelector('[data-el="intro"]');
  const form = root.querySelector('[data-el="form"]');
  const submitBtn = root.querySelector('[data-el="submit-btn"]');
  const statusEl = root.querySelector('[data-el="status"]');
  const resultEl = root.querySelector('[data-el="result"]');
  const resultInput = root.querySelector('[data-el="result-input"]');
  const copyBtn = root.querySelector('[data-el="copy-btn"]');

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  form.addEventListener('submit', handleSubmit);
  copyBtn.addEventListener('click', handleCopy);

  let targetUserId = null;

  function open(row) {
    targetUserId = row.id;
    introEl.textContent = t('users.resetPasswordIntro', { name: row.full_name });
    form.reset();
    form.classList.remove('hidden');
    resultEl.classList.add('hidden');
    statusEl.textContent = '';
    root.classList.remove('hidden');
    root.classList.add('flex');
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const newPassword = form.elements.password.value.trim();

    submitBtn.disabled = true;
    statusEl.className = 'text-sm text-slate-500';
    statusEl.textContent = t('common.loading');

    const { data, error } = await supabase.functions.invoke(functionName, {
      body: { target_user_id: targetUserId, new_password: newPassword || undefined },
    });

    submitBtn.disabled = false;

    if (error || data?.error) {
      statusEl.className = 'text-sm text-rose-600';
      statusEl.textContent = t('users.resetPasswordFailed', { message: data?.error || error.message });
      return;
    }

    statusEl.textContent = '';
    form.classList.add('hidden');
    resultEl.classList.remove('hidden');
    resultInput.value = data.password;
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(resultInput.value);
      copyBtn.textContent = t('users.copied');
      setTimeout(() => { copyBtn.textContent = t('users.copy'); }, 1500);
    } catch {
      resultInput.select();
    }
  }

  return { open, root };
}
