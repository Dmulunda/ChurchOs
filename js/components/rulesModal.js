// Rules & Regulations viewer/manager — one CURRENT PDF for the whole
// church (Super Admin managed) or one per department (that
// department's admins managed). Uploading a replacement keeps the
// previous version around (flagged is_current = false, sql/085)
// rather than deleting it — a worker's signature (rules_signatures)
// stays tied to the exact version they actually signed, so an old
// version can't just vanish out from under it.
// scope: { type: 'church', canAdminister } | { type: 'department', departmentId, departmentKey, canAdminister }
import { confirmDialog } from './confirmDialog.js';
import { t, appLocale } from '../i18n.js';

const SIGNED_URL_TTL_SECONDS = 300;

export function createRulesModal({ supabase, scope, currentUserId, title }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${title}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <div data-el="body"></div>
    </div>
  `;
  document.body.appendChild(root);

  const bodyEl = root.querySelector('[data-el="body"]');

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });

  function folderPath() {
    return scope.type === 'church' ? 'church' : `dept-${scope.departmentId}`;
  }

  async function load() {
    bodyEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    let query = supabase
      .from('rules_documents')
      .select('id, title, storage_path, file_name, uploaded_at, uploaded_by, version, uploader:profiles!uploaded_by ( full_name )')
      .eq('is_current', true)
      .limit(1);
    query = scope.type === 'church' ? query.is('department_id', null) : query.eq('department_id', scope.departmentId);

    const { data, error } = await query;
    if (error) {
      bodyEl.innerHTML = `<p class="text-sm text-rose-600">${t('rules.failedToLoad', { message: error.message })}</p>`;
      return;
    }

    render(data?.[0] || null);
  }

  function render(doc) {
    bodyEl.innerHTML = '';

    if (doc) {
      const info = document.createElement('div');
      info.className = 'bg-slate-50 rounded-lg p-4 mb-4';
      info.innerHTML = `
        <p class="font-medium text-slate-800 mb-1">${escapeHtml(doc.file_name)}</p>
        <p class="text-xs text-slate-500">${t('rules.uploadedInfo', { name: doc.uploader?.full_name || '—', date: new Date(doc.uploaded_at).toLocaleDateString(appLocale()) })}</p>
      `;
      bodyEl.appendChild(info);

      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'w-full mb-3 px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700';
      openBtn.textContent = t('rules.openDocument');
      openBtn.addEventListener('click', () => openDocument(doc, openBtn));
      bodyEl.appendChild(openBtn);
    } else {
      const empty = document.createElement('p');
      empty.className = 'text-sm text-slate-500 mb-4';
      empty.textContent = t('rules.noDocument');
      bodyEl.appendChild(empty);
    }

    if (scope.canAdminister) {
      const adminSection = document.createElement('div');
      adminSection.className = 'border-t border-slate-200 pt-4 mt-2';
      adminSection.innerHTML = `
        <label class="block text-sm font-medium text-slate-600 mb-1">${t(doc ? 'rules.replaceLabel' : 'rules.uploadLabel')}</label>
        <input type="file" data-el="file-input" accept="application/pdf" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-2" />
        <p data-el="upload-status" class="text-sm mb-2"></p>
        <button type="button" data-action="upload" class="w-full px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
          ${escapeHtml(t(doc ? 'rules.replaceButton' : 'rules.uploadButton'))}
        </button>
      `;
      bodyEl.appendChild(adminSection);

      const fileInput = adminSection.querySelector('[data-el="file-input"]');
      const uploadStatusEl = adminSection.querySelector('[data-el="upload-status"]');
      const uploadBtn = adminSection.querySelector('[data-action="upload"]');
      uploadBtn.addEventListener('click', () => uploadFile(doc, fileInput, uploadStatusEl, uploadBtn));

      if (doc) {
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'w-full mt-2 px-4 py-2 rounded-lg text-rose-600 font-medium hover:bg-rose-50';
        deleteBtn.textContent = t('rules.deleteButton');
        deleteBtn.addEventListener('click', () => deleteDocument(doc, deleteBtn));
        adminSection.appendChild(deleteBtn);
      }
    }
  }

  async function openDocument(doc, button) {
    button.disabled = true;
    const { data, error } = await supabase.storage.from('rules').createSignedUrl(doc.storage_path, SIGNED_URL_TTL_SECONDS);
    button.disabled = false;

    if (error || !data) {
      window.alert(t('rules.openFailed', { message: error?.message || '' }));
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener');
  }

  async function uploadFile(existingDoc, fileInput, statusEl, button) {
    const file = fileInput.files?.[0];
    if (!file) {
      statusEl.className = 'text-sm text-rose-600 mb-2';
      statusEl.textContent = t('rules.noFileSelected');
      return;
    }

    button.disabled = true;
    statusEl.className = 'text-sm text-slate-500 mb-2';
    statusEl.textContent = t('rules.uploading');

    // The old version is kept (not deleted) — a signature already
    // recorded against it (rules_signatures) must still be able to
    // point at a real, viewable document.
    if (existingDoc) {
      const { error: markOldError } = await supabase.from('rules_documents').update({ is_current: false }).eq('id', existingDoc.id);
      if (markOldError) {
        button.disabled = false;
        statusEl.className = 'text-sm text-rose-600 mb-2';
        statusEl.textContent = t('rules.uploadFailed', { message: markOldError.message });
        return;
      }
    }

    const path = `${folderPath()}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from('rules').upload(path, file, { contentType: 'application/pdf' });
    if (uploadError) {
      button.disabled = false;
      statusEl.className = 'text-sm text-rose-600 mb-2';
      statusEl.textContent = t('rules.uploadFailed', { message: uploadError.message });
      return;
    }

    const { error: insertError } = await supabase.from('rules_documents').insert({
      department_id: scope.type === 'church' ? null : scope.departmentId,
      title: title,
      storage_path: path,
      file_name: file.name,
      uploaded_by: currentUserId,
      version: (existingDoc?.version || 0) + 1,
      is_current: true,
    });

    button.disabled = false;
    if (insertError) {
      statusEl.className = 'text-sm text-rose-600 mb-2';
      statusEl.textContent = t('rules.uploadFailed', { message: insertError.message });
      return;
    }

    load();
  }

  async function deleteDocument(doc, button) {
    const confirmed = await confirmDialog({ message: t('rules.confirmDelete') });
    if (!confirmed) return;
    button.disabled = true;
    await supabase.storage.from('rules').remove([doc.storage_path]);
    const { error } = await supabase.from('rules_documents').delete().eq('id', doc.id);
    button.disabled = false;

    if (error) {
      window.alert(t('rules.deleteFailed', { message: error.message }));
      return;
    }
    load();
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
