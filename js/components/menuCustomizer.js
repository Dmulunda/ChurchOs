// Super-Admin-only tool to rename any nav label, sidebar quick-action
// item, or department name — English and French both, so the app
// stays properly bilingual. Writes to menu_labels (sql/045); t() in
// i18n.js checks that table before falling back to the built-in
// dictionary, so every existing screen picks up the rename with no
// code changes anywhere else.
//
// Deliberately scoped to a fixed, curated list of keys (below) rather
// than every string in the app — the hundreds of button labels, error
// messages, and placeholders elsewhere stay fixed in code; this is
// specifically the navigation surface: top nav, the sidebar dropdown,
// and department names.
import { t, getBuiltInLabel, setLabelOverride } from '../i18n.js';
import { DEPARTMENT_KEYS } from '../departments.js';
import { getFontChoices, applyAppTheme } from '../theme.js';
import { getTenant, isActingAsExtension } from '../tenant.js';

const NAV_KEYS = ['nav.dashboard', 'nav.scheduling', 'nav.songbook', 'nav.voiceExercises', 'nav.members', 'nav.home', 'nav.training'];
const SIDEBAR_KEYS = ['sidebar.churchRules', 'sidebar.attendance', 'sidebar.appSuggestion', 'sidebar.reportAbsence', 'sidebar.departmentRules', 'sidebar.monthlyReport', 'sidebar.guestCases', 'sidebar.memberCases'];
// Seed departments as a stable baseline; open() below merges in any
// departments created later via Create Department (sql/059), so
// renaming one never needs a code change either.
let DEPARTMENT_LABEL_KEYS = DEPARTMENT_KEYS.map((key) => `department.${key}`);

const THEME_DEFAULTS = { primary_color: '#4f46e5', text_color: '#1e293b', background_color: '#f1f5f9', font_family: 'default' };

export function createMenuCustomizerModal({ supabase, currentUserId }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${t('menuCustomizer.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <p class="text-sm text-slate-500 mb-3">${t('menuCustomizer.intro')}</p>
      <div data-el="editing-banner" class="mb-4"></div>
      <div data-el="body"></div>
      <div class="flex items-center gap-3 mt-4 pt-4 border-t border-slate-200">
        <button type="button" data-action="save-all" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">
          ${t('menuCustomizer.saveAll')}
        </button>
        <span data-el="status" class="text-sm text-slate-500"></span>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const bodyEl = root.querySelector('[data-el="body"]');
  const editingBannerEl = root.querySelector('[data-el="editing-banner"]');
  const statusEl = root.querySelector('[data-el="status"]');
  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  root.querySelector('[data-action="save-all"]').addEventListener('click', saveAll);

  let overridesByKey = new Map();
  let currentTheme = { ...THEME_DEFAULTS };
  let iconByKey = new Map();
  let savedAnything = false;

  async function open() {
    savedAnything = false;
    root.classList.remove('hidden');
    root.classList.add('flex');
    bodyEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;
    statusEl.textContent = '';
    renderEditingBanner();

    const [{ data, error }, { data: themeRow, error: themeError }, { data: deptRows }] = await Promise.all([
      supabase.from('menu_labels').select('key, label_en, label_fr'),
      supabase.from('app_theme').select('primary_color, text_color, background_color, font_family').maybeSingle(),
      supabase.from('departments').select('key, icon').order('key'),
    ]);
    if (error) {
      bodyEl.innerHTML = `<p class="text-sm text-rose-600">${t('menuCustomizer.loadFailed', { message: error.message })}</p>`;
      return;
    }
    overridesByKey = new Map((data || []).map((r) => [r.key, r]));
    currentTheme = themeError || !themeRow ? { ...THEME_DEFAULTS } : themeRow;
    iconByKey = new Map((deptRows || []).map((d) => [d.key, d.icon || '']));
    if (deptRows?.length) {
      const keys = new Set([...DEPARTMENT_KEYS, ...deptRows.map((d) => d.key)]);
      DEPARTMENT_LABEL_KEYS = Array.from(keys).sort().map((key) => `department.${key}`);
    }

    bodyEl.innerHTML = `
      ${renderAppearanceSection()}
      ${renderSection(t('menuCustomizer.sectionNav'), NAV_KEYS)}
      ${renderSection(t('menuCustomizer.sectionSidebar'), SIDEBAR_KEYS)}
      ${renderSection(t('menuCustomizer.sectionDepartments'), DEPARTMENT_LABEL_KEYS, { withIcon: true })}
    `;

    bodyEl.querySelectorAll('[data-action="reset-row"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.key;
        const builtIn = getBuiltInLabel(key);
        bodyEl.querySelector(`[data-el="en-${cssEscape(key)}"]`).value = builtIn.en;
        bodyEl.querySelector(`[data-el="fr-${cssEscape(key)}"]`).value = builtIn.fr;
      });
    });

    ['theme-primary', 'theme-text', 'theme-bg'].forEach((el) => {
      bodyEl.querySelector(`[data-el="${el}"]`).addEventListener('input', previewTheme);
    });
    bodyEl.querySelector('[data-el="theme-font"]').addEventListener('change', previewTheme);
    bodyEl.querySelector('[data-action="reset-appearance"]').addEventListener('click', () => {
      bodyEl.querySelector('[data-el="theme-primary"]').value = THEME_DEFAULTS.primary_color;
      bodyEl.querySelector('[data-el="theme-text"]').value = THEME_DEFAULTS.text_color;
      bodyEl.querySelector('[data-el="theme-bg"]').value = THEME_DEFAULTS.background_color;
      bodyEl.querySelector('[data-el="theme-font"]').value = THEME_DEFAULTS.font_family;
      previewTheme();
    });
  }

  // Every change here is saved scoped to exactly one tenant (verified
  // at the RLS/current_tenant_id() level — see sql/saas_platform's
  // tenant_isolation policy on menu_labels/app_theme) -- this banner
  // exists purely so a Global Super Admin can SEE which one before
  // saving, since "acting as" a different Church Extension (see
  // tenant.js/denominationExtensions.js) is a real, deliberate way for
  // that tenant to change, and it's easy to forget you're still acting
  // as one from an earlier visit.
  function renderEditingBanner() {
    const tenant = getTenant();
    const acting = isActingAsExtension();
    editingBannerEl.innerHTML = `
      <div class="flex items-center gap-2 text-sm rounded-lg px-3 py-2 ${acting ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-slate-50 text-slate-600 border border-slate-200'}">
        <span>${acting ? '⚠️' : '🏷️'}</span>
        <span>${t(acting ? 'menuCustomizer.editingActingAs' : 'menuCustomizer.editingTenant', { name: tenant?.name || '' })}</span>
      </div>
    `;
  }

  function previewTheme() {
    applyAppTheme({
      primary_color: bodyEl.querySelector('[data-el="theme-primary"]').value,
      text_color: bodyEl.querySelector('[data-el="theme-text"]').value,
      background_color: bodyEl.querySelector('[data-el="theme-bg"]').value,
      font_family: bodyEl.querySelector('[data-el="theme-font"]').value,
    });
  }

  function renderAppearanceSection() {
    const fontOptions = getFontChoices()
      .map((f) => `<option value="${escapeAttr(f.value)}" ${f.value === currentTheme.font_family ? 'selected' : ''}>${escapeHtml(f.label)}</option>`)
      .join('');
    return `
      <div class="mb-5">
        <div class="flex items-center justify-between mb-2">
          <h3 class="text-sm font-semibold text-slate-700">${t('menuCustomizer.sectionAppearance')}</h3>
          <button type="button" data-action="reset-appearance" class="text-xs text-slate-400 hover:text-slate-600">${t('menuCustomizer.resetAppearance')}</button>
        </div>
        <div class="grid sm:grid-cols-2 gap-3 border border-slate-200 rounded-lg p-3">
          <div>
            <label class="block text-xs font-medium text-slate-500 mb-1">${t('menuCustomizer.primaryColor')}</label>
            <input type="color" data-el="theme-primary" value="${escapeAttr(currentTheme.primary_color)}" class="w-full h-9 border border-slate-300 rounded-lg" />
          </div>
          <div>
            <label class="block text-xs font-medium text-slate-500 mb-1">${t('menuCustomizer.textColor')}</label>
            <input type="color" data-el="theme-text" value="${escapeAttr(currentTheme.text_color)}" class="w-full h-9 border border-slate-300 rounded-lg" />
          </div>
          <div>
            <label class="block text-xs font-medium text-slate-500 mb-1">${t('menuCustomizer.backgroundColor')}</label>
            <input type="color" data-el="theme-bg" value="${escapeAttr(currentTheme.background_color)}" class="w-full h-9 border border-slate-300 rounded-lg" />
          </div>
          <div>
            <label class="block text-xs font-medium text-slate-500 mb-1">${t('menuCustomizer.fontFamily')}</label>
            <select data-el="theme-font" class="w-full h-9 border border-slate-300 rounded-lg px-2 text-sm">${fontOptions}</select>
          </div>
        </div>
      </div>
    `;
  }

  function renderSection(title, keys, { withIcon = false } = {}) {
    return `
      <div class="mb-5">
        <h3 class="text-sm font-semibold text-slate-700 mb-2">${escapeHtml(title)}</h3>
        <div class="space-y-3">
          ${keys.map((key) => renderRow(key, withIcon)).join('')}
        </div>
      </div>
    `;
  }

  function renderRow(key, withIcon = false) {
    const builtIn = getBuiltInLabel(key);
    const existing = overridesByKey.get(key);
    const currentEn = existing?.label_en ?? builtIn.en;
    const currentFr = existing?.label_fr ?? builtIn.fr;
    // Department rows only -- the department.<key>'s key, after the
    // "department." prefix, maps straight onto departments.icon's key.
    const deptKey = withIcon ? key.replace(/^department\./, '') : null;
    const currentIcon = withIcon ? (iconByKey.get(deptKey) ?? '') : '';
    return `
      <div class="grid sm:grid-cols-2 gap-2 border border-slate-200 rounded-lg p-3" data-row="${escapeAttr(key)}">
        <div>
          <label class="block text-xs font-medium text-slate-500 mb-1">${t('menuCustomizer.english')}</label>
          <input type="text" data-el="en-${cssEscape(key)}" value="${escapeAttr(currentEn)}" class="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label class="block text-xs font-medium text-slate-500 mb-1">${t('menuCustomizer.french')}</label>
          <div class="flex gap-2">
            <input type="text" data-el="fr-${cssEscape(key)}" value="${escapeAttr(currentFr)}" class="flex-1 border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
            <button type="button" data-action="reset-row" data-key="${escapeAttr(key)}" class="text-xs text-slate-400 hover:text-slate-600 whitespace-nowrap">${t('menuCustomizer.resetRow')}</button>
          </div>
        </div>
        ${withIcon ? `
        <div>
          <label class="block text-xs font-medium text-slate-500 mb-1">${t('menuCustomizer.icon')}</label>
          <input type="text" data-el="icon-${cssEscape(deptKey)}" data-dept-key="${escapeAttr(deptKey)}" value="${escapeAttr(currentIcon)}" maxlength="8"
                 class="w-20 border border-slate-300 rounded-lg px-2 py-1.5 text-sm text-center" />
        </div>` : ''}
      </div>
    `;
  }

  async function saveAll() {
    statusEl.className = 'text-sm text-slate-500';
    statusEl.textContent = t('common.saving');

    const allKeys = [...NAV_KEYS, ...SIDEBAR_KEYS, ...DEPARTMENT_LABEL_KEYS];
    const rows = allKeys.map((key) => ({
      key,
      label_en: bodyEl.querySelector(`[data-el="en-${cssEscape(key)}"]`).value.trim(),
      label_fr: bodyEl.querySelector(`[data-el="fr-${cssEscape(key)}"]`).value.trim(),
      updated_by: currentUserId,
      updated_at: new Date().toISOString(),
    }));
    const theme = {
      primary_color: bodyEl.querySelector('[data-el="theme-primary"]').value,
      text_color: bodyEl.querySelector('[data-el="theme-text"]').value,
      background_color: bodyEl.querySelector('[data-el="theme-bg"]').value,
      font_family: bodyEl.querySelector('[data-el="theme-font"]').value,
      updated_by: currentUserId,
      updated_at: new Date().toISOString(),
    };

    // Icons live on departments.icon itself (sql/saas_platform/121), not
    // menu_labels, since they're not translatable text -- only the
    // rows whose value actually changed get written, each scoped to
    // this tenant by the same "department admins update their
    // department" RLS policy a Super Admin always satisfies.
    const iconUpdates = [];
    bodyEl.querySelectorAll('[data-dept-key]').forEach((input) => {
      const deptKey = input.dataset.deptKey;
      const newIcon = input.value.trim();
      if (newIcon !== (iconByKey.get(deptKey) ?? '')) iconUpdates.push({ deptKey, icon: newIcon || null });
    });

    const [{ error }, { error: themeError }, iconResults] = await Promise.all([
      supabase.from('menu_labels').upsert(rows, { onConflict: 'tenant_id,key' }),
      supabase.from('app_theme').upsert(theme, { onConflict: 'tenant_id' }),
      Promise.all(iconUpdates.map((u) => supabase.from('departments').update({ icon: u.icon }).eq('key', u.deptKey))),
    ]);
    const iconError = iconResults.find((r) => r.error)?.error;
    if (error || themeError || iconError) {
      statusEl.className = 'text-sm text-rose-600';
      statusEl.textContent = t('menuCustomizer.saveFailed', { message: (error || themeError || iconError).message });
      return;
    }

    rows.forEach((r) => setLabelOverride(r.key, r.label_en, r.label_fr));
    iconUpdates.forEach((u) => iconByKey.set(u.deptKey, u.icon || ''));
    applyAppTheme(theme);
    savedAnything = true;
    statusEl.className = 'text-sm text-emerald-600';
    statusEl.textContent = t('menuCustomizer.savedReload');
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
    // Every already-open nav/sidebar element was built with the
    // pre-rename text — simplest reliable way to refresh everything at
    // once rather than threading a refresh callback through every
    // module that renders a label. Also covers reverting any live
    // color/font preview that was never actually saved.
    if (savedAnything) window.location.reload();
    else applyAppTheme(currentTheme);
  }

  return { open, root };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(str).replaceAll('"', '&quot;');
}

function cssEscape(str) {
  return str.replace(/[^a-zA-Z0-9_-]/g, '_');
}
