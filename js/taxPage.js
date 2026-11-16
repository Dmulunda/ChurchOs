// Tax / Impôts tab entry point — every signed-in member's running
// donation totals and, once Finance finalizes a year, their official
// receipt. Not tied to the active department switcher, same as
// training.js/serviceProgram.js, since this is about the member
// themselves, not any one department.
import { getEffectiveSupabase } from './departments.js';
import { renderTaxReceiptsMemberBoard } from './components/taxReceiptsMemberBoard.js';
import { t } from './i18n.js';
import { getTenant } from './tenant.js';
import { publicPageUrl } from './utils/publicUrl.js';

export async function renderTaxTab() {
  const supabase = getEffectiveSupabase();
  const container = document.querySelector('#tax-content');
  container.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    container.innerHTML = `<p class="text-slate-500">${t('scheduling.pleaseSignIn')}</p>`;
    return;
  }

  // "Give online" banner when the church has switched online giving on
  // (sql/saas_platform/144). Any error (feature not installed yet, no
  // settings row) simply means no banner.
  container.innerHTML = '<div data-el="give-online"></div><div data-el="tax-board"></div>';
  renderTaxReceiptsMemberBoard(container.querySelector('[data-el="tax-board"]'), { supabase, userId: user.id });
  const tenant = getTenant();
  if (tenant) {
    supabase.from('giving_settings').select('enabled').eq('tenant_id', tenant.id).maybeSingle().then(({ data, error }) => {
      if (error || !data?.enabled) return;
      const url = publicPageUrl('give.html', { church: tenant.slug });
      container.querySelector('[data-el="give-online"]').innerHTML = `
        <div class="bg-indigo-50 border border-indigo-200 rounded-xl p-4 mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p class="font-semibold text-indigo-900">💳 ${t('giving.inAppTitle')}</p>
            <p class="text-sm text-indigo-800">${t('giving.inAppText')}</p>
          </div>
          <a href="${url}" class="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">${t('giving.inAppButton')}</a>
        </div>`;
    });
  }
}
