// Super-Admin-only "Create Department" tool (sql/059) — adds a new
// department with the generic announcements + duty-shift board
// (sql/016) that every "no bespoke tooling" department already
// shares, straight from the app. Also seeds its department.<key>
// menu_labels row (sql/045) with the given name so it displays
// correctly right away, in both languages, without a trip through
// Customize Menu afterward.
import { t, loadLabelOverrides } from '../i18n.js';

export function createDepartmentModal({ supabase, currentUserId, onCreated }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${t('superHome.createDepartmentTitle')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <p class="text-sm text-slate-500 mb-4">${t('createDepartment.intro')}</p>
      <form data-el="form">
        <label class="block text-sm font-medium text-slate-600 mb-1">${t('createDepartment.name')}</label>
        <input type="text" name="name" required placeholder="${t('createDepartment.namePlaceholder')}"
               class="w-full border border-slate-300 rounded-lg px-3 py-2 mb-3" />
        <label class="block text-sm font-medium text-slate-600 mb-1">${t('createDepartment.icon')}</label>
        <input type="text" name="icon" maxlength="8" placeholder="${t('createDepartment.iconPlaceholder')}"
               class="w-24 border border-slate-300 rounded-lg px-3 py-2 mb-3 text-center text-lg" />
        <div class="flex items-center gap-3">
          <button type="submit" data-el="submit-btn"
                  class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
            ${t('createDepartment.create')}
          </button>
          <span data-el="status" class="text-sm text-slate-500"></span>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(root);

  const form = root.querySelector('[data-el="form"]');
  const submitBtn = root.querySelector('[data-el="submit-btn"]');
  const statusEl = root.querySelector('[data-el="status"]');

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  form.addEventListener('submit', handleSubmit);

  function open() {
    form.reset();
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

    const name = form.elements.name.value.trim();
    if (!name) {
      statusEl.className = 'text-sm text-rose-600';
      statusEl.textContent = t('createDepartment.missingName');
      return;
    }

    const key = slugify(name);
    const icon = form.elements.icon.value.trim() || null;

    submitBtn.disabled = true;
    statusEl.className = 'text-sm text-slate-500';
    statusEl.textContent = t('createDepartment.creating');

    try {
      const { error: insertError } = await supabase
        .from('departments')
        .insert({ key, name, kind: 'lightweight', icon });
      if (insertError) {
        if (insertError.code === '23505') throw new Error(t('createDepartment.duplicateKey'));
        throw insertError;
      }

      const { error: labelError } = await supabase
        .from('menu_labels')
        .upsert({ key: `department.${key}`, label_en: name, label_fr: name, updated_by: currentUserId }, { onConflict: 'tenant_id,key' });
      if (labelError) throw labelError;

      await loadLabelOverrides();

      statusEl.className = 'text-sm text-emerald-600';
      statusEl.textContent = t('createDepartment.created', { name });
      form.reset();
      onCreated?.();
    } catch (error) {
      statusEl.className = 'text-sm text-rose-600';
      statusEl.textContent = t('createDepartment.failed', { message: error.message });
    } finally {
      submitBtn.disabled = false;
    }
  }

  return { open, root };
}

function slugify(name) {
  const slug = name
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents left behind by NFD
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return /^[a-z]/.test(slug) ? slug : `dept_${slug}`;
}
