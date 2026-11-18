// Documents tab (sql/saas_platform/160_shared_documents.sql).
// Files, links and meeting minutes for the whole church or one department,
// each visible to everyone, that department, or leaders only. The pastoral
// team manages everything; department admins manage their department's
// items; leaders can add church-wide items. RLS and storage policies
// enforce access -- the buttons shown here are convenience only.
import { getEffectiveSupabase, getMyDepartments } from './departments.js';
import { t, formatDate, departmentLabel } from './i18n.js';
import { attachAiWriter } from './components/aiWriter.js';

const BUCKET = 'church-documents';
const KINDS = ['minutes', 'file', 'link'];
const KIND_ICON = { minutes: '📝', file: '📄', link: '🔗' };
const VISIBILITIES = ['everyone', 'department', 'leaders'];
const MAX_BYTES = 50 * 1024 * 1024;

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function deptName(d) {
  if (!d) return '';
  const label = departmentLabel(d.key);
  return !label || label.startsWith('department.') ? d.name || d.key : label;
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function safeFileName(name) {
  return (name || 'file').normalize('NFKD').replace(/[^\w.\-]+/g, '_').slice(-120);
}

export async function renderDocumentsTab() {
  const supabase = getEffectiveSupabase();
  const container = document.querySelector('#documents-content');
  container.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { container.innerHTML = `<p class="text-slate-500">${t('scheduling.pleaseSignIn')}</p>`; return; }

  const [{ data: docs, error }, { data: departments }, { data: isPastoral }, { data: isLeader }] = await Promise.all([
    supabase.from('church_documents').select('*').is('archived_at', null).order('created_at', { ascending: false }).limit(1000),
    supabase.from('departments').select('id, key, name').order('name'),
    supabase.rpc('is_pastoral_team'),
    supabase.rpc('is_church_leader'),
  ]);
  if (error) { container.innerHTML = `<p class="text-slate-500">${t('documents.notInstalled')}</p>`; return; }

  const deptById = new Map((departments || []).map((d) => [d.id, d]));
  const myAdminDeptIds = new Set(getMyDepartments().filter((d) => d.role && d.role !== 'member').map((d) => d.id));
  const canManage = (deptId) => isPastoral || (deptId ? myAdminDeptIds.has(deptId) : isLeader);
  const manageableDepts = (departments || []).filter((d) => isPastoral || myAdminDeptIds.has(d.id));
  const canAddAnything = isPastoral || isLeader || manageableDepts.length > 0;
  const usedDeptIds = new Set(docs.map((d) => d.department_id).filter(Boolean));

  container.innerHTML = `
    <div class="flex flex-wrap items-center gap-2 mb-4">
      <input data-el="q" type="search" placeholder="${t('documents.search')}" class="flex-1 min-w-[12rem] border border-slate-300 rounded-lg px-3 py-2 text-sm">
      <select data-el="scope" class="border border-slate-300 rounded-lg px-2 py-2 text-sm">
        <option value="">${t('documents.allPlaces')}</option>
        <option value="church">${t('documents.churchWide')}</option>
        ${[...usedDeptIds].map((id) => deptById.get(id)).filter(Boolean).map((d) => `<option value="${d.id}">${escapeHtml(deptName(d))}</option>`).join('')}
      </select>
      <select data-el="kind" class="border border-slate-300 rounded-lg px-2 py-2 text-sm">
        <option value="">${t('documents.allKinds')}</option>
        ${KINDS.map((k) => `<option value="${k}">${t(`documents.kind.${k}`)}</option>`).join('')}
      </select>
      ${canAddAnything ? `<button type="button" data-action="new" class="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">${t('documents.add')}</button>` : ''}
    </div>
    <div data-el="form"></div>
    <div data-el="list" class="space-y-2"></div>`;

  const formEl = container.querySelector('[data-el="form"]');
  const listEl = container.querySelector('[data-el="list"]');
  const qEl = container.querySelector('[data-el="q"]');
  const scopeEl = container.querySelector('[data-el="scope"]');
  const kindEl = container.querySelector('[data-el="kind"]');

  function badge(doc) {
    const where = doc.department_id ? deptName(deptById.get(doc.department_id)) : t('documents.churchWide');
    const vis = t(`documents.visibility.${doc.visibility}`);
    return `<span class="text-[11px] bg-slate-100 text-slate-600 rounded-full px-2 py-0.5">${escapeHtml(where)}</span>
            <span class="text-[11px] ${doc.visibility === 'leaders' ? 'bg-amber-50 text-amber-700' : 'bg-slate-50 text-slate-500'} rounded-full px-2 py-0.5">${escapeHtml(vis)}</span>`;
  }

  function renderList() {
    const q = qEl.value.trim().toLowerCase();
    const shown = docs.filter((d) => {
      if (kindEl.value && d.kind !== kindEl.value) return false;
      if (scopeEl.value === 'church' && d.department_id) return false;
      if (scopeEl.value && scopeEl.value !== 'church' && d.department_id !== scopeEl.value) return false;
      if (!q) return true;
      return [d.title, d.description, d.folder, d.body, d.decisions, d.action_items, d.attendees, d.file_name].some((v) => v && v.toLowerCase().includes(q));
    });
    if (!shown.length) { listEl.innerHTML = `<p class="text-sm text-slate-500">${docs.length ? t('documents.noMatch') : t('documents.none')}</p>`; return; }

    // Group by folder (items without a folder last).
    const groups = new Map();
    shown.forEach((d) => {
      const key = d.folder || '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(d);
    });
    const keys = [...groups.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
    listEl.innerHTML = keys.map((k) => `
      ${k ? `<h3 class="text-sm font-semibold text-slate-600 mt-4 mb-1">📁 ${escapeHtml(k)}</h3>` : (keys.length > 1 ? `<h3 class="text-sm font-semibold text-slate-600 mt-4 mb-1">${t('documents.otherItems')}</h3>` : '')}
      ${groups.get(k).map((d) => `
        <article class="bg-white rounded-xl shadow p-3" data-doc="${d.id}">
          <div class="flex flex-wrap items-start justify-between gap-2">
            <button type="button" data-open="${d.id}" class="text-left min-w-0 grow basis-56">
              <p class="font-medium">${KIND_ICON[d.kind]} ${escapeHtml(d.title)}</p>
              <p class="text-xs text-slate-500 mt-0.5">${d.kind === 'minutes' && d.meeting_date ? `${t('documents.meetingOn', { date: formatDate(d.meeting_date) })} · ` : ''}${t('documents.updated', { date: formatDate(d.updated_at) })}</p>
            </button>
            <div class="flex flex-wrap items-center gap-1">${badge(d)}
              ${canManage(d.department_id) ? `<button type="button" data-edit="${d.id}" class="ml-1 px-2 py-0.5 rounded border border-slate-300 text-xs">${t('common.edit')}</button>
              <button type="button" data-archive="${d.id}" class="px-2 py-0.5 rounded border border-rose-200 text-rose-700 text-xs">${t('documents.archive')}</button>` : ''}
            </div>
          </div>
          <div data-detail="${d.id}"></div>
        </article>`).join('')}`).join('');

    listEl.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openDoc(docs.find((x) => x.id === b.dataset.open))));
    listEl.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
      renderForm(docs.find((x) => x.id === b.dataset.edit));
      formEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    listEl.querySelectorAll('[data-archive]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm(t('documents.archiveConfirm'))) return;
      const { error: e } = await supabase.from('church_documents').update({ archived_at: new Date().toISOString() }).eq('id', b.dataset.archive);
      if (e) alert(e.message); else renderDocumentsTab();
    }));
  }

  async function openDoc(d) {
    const slot = listEl.querySelector(`[data-detail="${d.id}"]`);
    if (slot.innerHTML) { slot.innerHTML = ''; return; }
    const section = (label, text) => (text ? `<div><p class="text-xs font-semibold text-slate-500 uppercase tracking-wide">${label}</p><p class="text-sm whitespace-pre-line">${escapeHtml(text)}</p></div>` : '');
    let action = '';
    if (d.kind === 'link' && d.url) action = `<a href="${escapeHtml(d.url)}" target="_blank" rel="noopener noreferrer" class="inline-block px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 text-sm font-medium">🔗 ${t('documents.openLink')}</a>`;
    if (d.kind === 'file' && d.file_path) action = `<button type="button" data-download class="px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 text-sm font-medium">⬇ ${escapeHtml(d.file_name || t('documents.download'))}</button>`;
    slot.innerHTML = `<div class="mt-3 border-t border-slate-100 pt-3 space-y-3">
      ${section(t('documents.description'), d.description)}
      ${d.kind === 'minutes' ? `${section(t('documents.attendees'), d.attendees)}${section(t('documents.notes'), d.body)}${section(t('documents.decisions'), d.decisions)}${section(t('documents.actionItems'), d.action_items)}` : ''}
      ${action}
    </div>`;
    slot.querySelector('[data-download]')?.addEventListener('click', async () => {
      const { data, error: e } = await supabase.storage.from(BUCKET).createSignedUrl(d.file_path, 600, { download: d.file_name || true });
      if (e) { alert(e.message); return; }
      window.location.href = data.signedUrl;
    });
  }

  function renderForm(doc) {
    const kind = doc?.kind || 'minutes';
    const deptOptions = manageableDepts.map((d) => `<option value="${d.id}" ${doc?.department_id === d.id ? 'selected' : ''}>${escapeHtml(deptName(d))}</option>`).join('');
    const folders = [...new Set(docs.map((d) => d.folder).filter(Boolean))].sort();
    formEl.innerHTML = `
      <form class="bg-white rounded-xl shadow p-4 mb-4 grid sm:grid-cols-2 gap-3">
        <label class="text-sm text-slate-700">${t('documents.kindLabel')}
          <select name="kind" ${doc ? 'disabled' : ''} class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-sm">${KINDS.map((k) => `<option value="${k}" ${k === kind ? 'selected' : ''}>${t(`documents.kind.${k}`)}</option>`).join('')}</select></label>
        <input name="title" required maxlength="200" value="${escapeHtml(doc?.title || '')}" placeholder="${t('documents.title_')}" class="border border-slate-300 rounded-lg px-3 py-2 text-sm self-end">
        <label class="text-sm text-slate-700">${t('documents.where')}
          <select name="department_id" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-sm">
            ${isPastoral || isLeader ? `<option value="">${t('documents.churchWide')}</option>` : ''}${deptOptions}
          </select></label>
        <label class="text-sm text-slate-700">${t('documents.whoSees')}
          <select name="visibility" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-sm">
            ${VISIBILITIES.map((v) => `<option value="${v}" ${(doc?.visibility || 'everyone') === v ? 'selected' : ''}>${t(`documents.visibility.${v}`)}</option>`).join('')}
          </select></label>
        <input name="folder" maxlength="80" list="doc-folder-list" value="${escapeHtml(doc?.folder || '')}" placeholder="${t('documents.folder')}" class="border border-slate-300 rounded-lg px-3 py-2 text-sm">
        <datalist id="doc-folder-list">${folders.map((f) => `<option value="${escapeHtml(f)}">`).join('')}</datalist>
        <textarea name="description" rows="1" placeholder="${t('documents.description')}" class="border border-slate-300 rounded-lg px-3 py-2 text-sm">${escapeHtml(doc?.description || '')}</textarea>
        <div data-kind="minutes" class="sm:col-span-2 grid sm:grid-cols-2 gap-3">
          <label class="text-sm text-slate-700">${t('documents.meetingDate')}<input name="meeting_date" type="date" value="${escapeHtml(doc?.meeting_date || todayIso())}" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-sm"></label>
          <input name="attendees" value="${escapeHtml(doc?.attendees || '')}" placeholder="${t('documents.attendees')}" class="border border-slate-300 rounded-lg px-3 py-2 text-sm self-end">
          <textarea name="body" rows="5" placeholder="${t('documents.notes')}" class="border border-slate-300 rounded-lg px-3 py-2 text-sm sm:col-span-2">${escapeHtml(doc?.body || '')}</textarea>
          <textarea name="decisions" rows="3" placeholder="${t('documents.decisions')}" class="border border-slate-300 rounded-lg px-3 py-2 text-sm">${escapeHtml(doc?.decisions || '')}</textarea>
          <textarea name="action_items" rows="3" placeholder="${t('documents.actionItemsHint')}" class="border border-slate-300 rounded-lg px-3 py-2 text-sm">${escapeHtml(doc?.action_items || '')}</textarea>
        </div>
        <div data-kind="file" class="sm:col-span-2">
          <label class="text-sm text-slate-700">${t('documents.fileLabel')}${doc?.file_path ? ` <span class="text-xs text-emerald-700">(${escapeHtml(doc.file_name || '')} — ${t('documents.fileKept')})</span>` : ''}
            <input name="file" type="file" class="mt-1 block w-full text-sm"></label>
        </div>
        <div data-kind="link" class="sm:col-span-2">
          <input name="url" type="url" pattern="https://.*" value="${escapeHtml(doc?.url || '')}" placeholder="${t('documents.url')}" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
        </div>
        <div class="sm:col-span-2 flex flex-wrap gap-2 items-center">
          <button type="submit" class="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium">${t('givingAdmin.save')}</button>
          <button type="button" data-action="cancel" class="px-4 py-2 rounded-lg border border-slate-300 text-sm">${t('common.cancel')}</button>
          <span data-el="msg" class="text-sm text-slate-600"></span>
        </div>
      </form>`;
    const form = formEl.querySelector('form');
    const msg = form.querySelector('[data-el="msg"]');
    const showKind = () => {
      const k = form.elements.kind.value;
      form.querySelectorAll('[data-kind]').forEach((el) => el.classList.toggle('hidden', el.dataset.kind !== k));
    };
    form.elements.kind.addEventListener('change', showKind);
    attachAiWriter(form.elements.body, ['minutes', 'translate'], { minutesTargets: { decisions: form.elements.decisions, action_items: form.elements.action_items } });
    showKind();
    form.querySelector('[data-action="cancel"]').addEventListener('click', () => { formEl.innerHTML = ''; });
    const fail = (m) => { msg.className = 'text-sm text-rose-600'; msg.textContent = m; form.querySelector('[type="submit"]').disabled = false; };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = form.elements;
      const k = f.kind.value;
      const deptId = f.department_id.value || null;
      if (f.visibility.value === 'department' && !deptId) { fail(t('documents.needDept')); return; }
      const file = k === 'file' ? f.file.files[0] : null;
      if (k === 'file' && !file && !doc?.file_path) { fail(t('documents.needFile')); return; }
      if (file && file.size > MAX_BYTES) { fail(t('documents.tooBig')); return; }
      if (k === 'link' && !f.url.value.trim()) { fail(t('documents.needUrl')); return; }
      const row = {
        title: f.title.value.trim(),
        department_id: deptId,
        visibility: f.visibility.value,
        folder: f.folder.value.trim() || null,
        description: f.description.value.trim() || null,
      };
      if (k === 'minutes') Object.assign(row, {
        meeting_date: f.meeting_date.value || null,
        attendees: f.attendees.value.trim() || null,
        body: f.body.value.trim() || null,
        decisions: f.decisions.value.trim() || null,
        action_items: f.action_items.value.trim() || null,
      });
      if (k === 'link') row.url = f.url.value.trim();
      form.querySelector('[type="submit"]').disabled = true;
      msg.className = 'text-sm text-slate-600';
      msg.textContent = t('documents.saving');
      const { data: saved, error: saveError } = doc
        ? await supabase.from('church_documents').update(row).eq('id', doc.id).select('id, tenant_id').single()
        : await supabase.from('church_documents').insert({ ...row, kind: k, created_by: user.id }).select('id, tenant_id').single();
      if (saveError) { fail(saveError.message); return; }
      if (file) {
        msg.textContent = t('documents.uploading', { name: file.name });
        const path = `${saved.tenant_id}/${saved.id}/${Date.now()}-${safeFileName(file.name)}`;
        const { error: upError } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined });
        if (upError) {
          if (!doc) await supabase.from('church_documents').delete().eq('id', saved.id);
          fail(upError.message);
          return;
        }
        if (doc?.file_path) await supabase.storage.from(BUCKET).remove([doc.file_path]);
        const { error: pathError } = await supabase.from('church_documents').update({ file_path: path, file_name: file.name.slice(0, 200) }).eq('id', saved.id);
        if (pathError) { fail(pathError.message); return; }
      }
      renderDocumentsTab();
    });
  }

  qEl.addEventListener('input', renderList);
  scopeEl.addEventListener('change', renderList);
  kindEl.addEventListener('change', renderList);
  container.querySelector('[data-action="new"]')?.addEventListener('click', () => renderForm(null));
  renderList();
}
