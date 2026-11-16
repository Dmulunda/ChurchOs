// Uniform schedule (Choir + Ushers): what to wear on a given date, with
// an optional photo. One entry per date (sql/058) — admins upsert by
// date, same pattern Preaching used before it needed multiple entries
// per day. The photo lives in a private "uniform-photos" bucket and is
// only ever fetched as a signed URL, on demand, when someone actually
// clicks to view it — the Dashboard week view shows the text
// description inline but deliberately not the photo itself.
import { t, formatDate } from '../i18n.js';
import { confirmDialog } from './confirmDialog.js';
import { todayLocal } from '../utils/date.js';
import { getGlobalRole } from '../departments.js';

export function renderUniformSchedule(container, { supabase, departmentId, canAdminister }) {
  const dateMinAttr = getGlobalRole() === 'super_admin' ? '' : `min="${todayLocal()}"`;

  container.innerHTML = `
    ${canAdminister ? `
      <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-6">
        <h2 class="text-lg font-semibold mb-4">${t('uniform.formTitle')}</h2>
        <form data-el="form" class="grid sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('requests.date')}</label>
            <input type="date" name="date" required ${dateMinAttr} class="w-full border border-slate-300 rounded-lg px-3 py-2" />
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('uniform.photo')}</label>
            <input type="file" accept="image/*" data-el="photo-input" class="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
          </div>
          <div class="sm:col-span-2">
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('uniform.description')}</label>
            <input type="text" name="description" placeholder="${t('uniform.descriptionPlaceholder')}"
                   class="w-full border border-slate-300 rounded-lg px-3 py-2" />
          </div>
          <div class="sm:col-span-2 flex items-center gap-3">
            <button type="submit" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">
              ${t('uniform.save')}
            </button>
            <span data-el="form-status" class="text-sm text-slate-500"></span>
          </div>
        </form>
      </div>
    ` : ''}
    <div class="bg-white rounded-xl shadow p-4 sm:p-6">
      <h2 class="text-lg font-semibold mb-4">${t('uniform.upcoming')}</h2>
      <div data-el="list" class="space-y-3"></div>
    </div>
  `;

  const form = container.querySelector('[data-el="form"]');
  const formStatusEl = container.querySelector('[data-el="form-status"]');
  const listEl = container.querySelector('[data-el="list"]');

  if (form) {
    loadPrefill();
    form.elements.date.addEventListener('change', loadPrefill);
    form.addEventListener('submit', handleSubmit);
  }

  load();

  async function loadPrefill() {
    const dateStr = form.elements.date.value;
    if (!dateStr) return;
    const { data } = await supabase.from('department_uniforms').select('description').eq('department_id', departmentId).eq('date', dateStr).maybeSingle();
    form.elements.description.value = data?.description || '';
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const date = form.elements.date.value;
    if (!date) return;

    formStatusEl.className = 'text-sm text-slate-500';
    formStatusEl.textContent = t('common.saving');

    const { data: { user } } = await supabase.auth.getUser();

    let imagePath;
    const file = form.elements['photo-input']?.files?.[0];
    if (file) {
      const path = `${departmentId}/${date}-${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage.from('uniform-photos').upload(path, file);
      if (uploadError) {
        formStatusEl.className = 'text-sm text-rose-600';
        formStatusEl.textContent = t('uniform.saveFailed', { message: uploadError.message });
        return;
      }
      imagePath = path;
    }

    const payload = {
      department_id: departmentId,
      date,
      description: form.elements.description.value.trim() || null,
      created_by: user.id,
      ...(imagePath ? { image_path: imagePath } : {}),
    };

    const { error } = await supabase.from('department_uniforms').upsert(payload, { onConflict: 'department_id,date' });

    if (error) {
      formStatusEl.className = 'text-sm text-rose-600';
      formStatusEl.textContent = t('uniform.saveFailed', { message: error.message });
      return;
    }

    form.reset();
    formStatusEl.textContent = '';
    load();
  }

  async function load() {
    listEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    // Past entries are hidden once they're gone by, except for Super
    // Admin, who still needs to find and correct an already-past one.
    let listQuery = supabase
      .from('department_uniforms')
      .select('id, date, description, image_path')
      .eq('department_id', departmentId);
    if (getGlobalRole() !== 'super_admin') listQuery = listQuery.gte('date', todayLocal());
    const { data, error } = await listQuery.order('date', { ascending: true });

    if (error) {
      listEl.innerHTML = `<p class="text-sm text-rose-600">${t('uniform.loadFailed', { message: error.message })}</p>`;
      return;
    }

    if (data.length === 0) {
      listEl.innerHTML = `<p class="text-sm text-slate-500">${t('uniform.none')}</p>`;
      return;
    }

    listEl.innerHTML = '';
    data.forEach((row) => listEl.appendChild(renderRow(row)));
  }

  function renderRow(row) {
    const el = document.createElement('div');
    el.className = 'border border-slate-200 rounded-lg p-3';
    el.innerHTML = `
      <div class="flex items-center justify-between gap-3">
        <div>
          <div class="font-medium text-slate-800">${row.description ? escapeHtml(row.description) : `<span class="text-slate-400">${t('uniform.noDescription')}</span>`}</div>
          <div class="text-sm text-slate-500">${escapeHtml(formatDate(row.date))}</div>
        </div>
        <div class="flex items-center gap-3 shrink-0">
          ${row.image_path ? `<button type="button" data-action="view-photo" class="text-xs font-medium text-indigo-600 hover:text-indigo-800 whitespace-nowrap">${t('uniform.viewPhoto')}</button>` : ''}
          ${canAdminister ? `<button type="button" data-action="delete" class="text-xs font-medium text-rose-600 hover:text-rose-800 whitespace-nowrap">${t('moderation.delete')}</button>` : ''}
        </div>
      </div>
      <div data-el="photo-preview" class="hidden mt-3"></div>
    `;

    if (row.image_path) {
      el.querySelector('[data-action="view-photo"]').addEventListener('click', async () => {
        const previewEl = el.querySelector('[data-el="photo-preview"]');
        if (!previewEl.classList.contains('hidden')) { previewEl.classList.add('hidden'); return; }
        previewEl.innerHTML = `<p class="text-slate-500 text-sm">${t('common.loading')}</p>`;
        previewEl.classList.remove('hidden');
        const { data, error } = await supabase.storage.from('uniform-photos').createSignedUrl(row.image_path, 3600);
        if (error || !data) {
          previewEl.innerHTML = `<p class="text-rose-600 text-sm">${t('uniform.photoLoadFailed')}</p>`;
          return;
        }
        previewEl.innerHTML = `<img src="${escapeAttr(data.signedUrl)}" class="max-w-full max-h-96 rounded-lg border border-slate-200" alt="" />`;
      });
    }

    if (canAdminister) {
      el.querySelector('[data-action="delete"]').addEventListener('click', async () => {
        if (!(await confirmDialog({ message: t('uniform.confirmDelete', { date: row.date }) }))) return;
        if (row.image_path) await supabase.storage.from('uniform-photos').remove([row.image_path]);
        const { error } = await supabase.from('department_uniforms').delete().eq('id', row.id);
        if (error) { window.alert(t('uniform.deleteFailed', { message: error.message })); return; }
        load();
      });
    }

    return el;
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(str).replaceAll('"', '&quot;');
}
