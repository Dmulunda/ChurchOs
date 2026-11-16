// Offerings tab entry point — the Church Offering Registration page.
// Only ever reachable by someone with hasFinanceOversight() (see
// departments.js) — js/app.js doesn't even construct the nav
// button/tab otherwise, mirrors can_manage_finance() server-side.
import { getEffectiveSupabase, canDeleteOfferings, getGlobalRole } from './departments.js';
import { renderOnlineGivingSettings } from './components/onlineGivingSettings.js';
import { renderOfferingsBoard } from './components/offeringsBoard.js';
import { t } from './i18n.js';

export async function renderOfferingsPageTab() {
  const supabase = getEffectiveSupabase();
  const container = document.querySelector('#offerings-content');
  container.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    container.innerHTML = `<p class="text-slate-500">${t('scheduling.pleaseSignIn')}</p>`;
    return;
  }

  // Online giving settings (sql/saas_platform/144) sit above the board,
  // only for those allowed to change them; the card hides itself until
  // that migration is applied.
  container.innerHTML = '<div data-el="online-giving"></div><div data-el="offerings-board"></div>';
  const boardEl = container.querySelector('[data-el="offerings-board"]');
  if (getGlobalRole() === 'super_admin' || canDeleteOfferings()) {
    renderOnlineGivingSettings(container.querySelector('[data-el="online-giving"]'), { supabase }).catch(() => {});
  }
  renderOfferingsBoard(boardEl, { supabase, currentUserId: user.id });
}
