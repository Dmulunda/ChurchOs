// Sermons tab (sql/saas_platform/158_sermon_library.sql).
// Everyone in the church searches and filters sermons, opens the video link,
// plays the audio and opens the notes (short-lived signed links from the
// private 'sermon-files' bucket). The pastoral team and the Media /
// Preaching departments add, edit and archive (can_manage_sermons()).
// RLS and storage policies enforce access -- the buttons are convenience only.
import { getEffectiveSupabase } from './departments.js';
import { t, formatDate } from './i18n.js';
import { attachAiWriter } from './components/aiWriter.js';

const BUCKET = 'sermon-files';
const LANGS = ['fr', 'en', 'both', 'other'];
const MAX_BYTES = 200 * 1024 * 1024;

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fileExt(file) {
  const m = /\.([a-z0-9]{2,5})$/i.exec(file.name || '');
  return m ? m[1].toLowerCase() : 'bin';
}

export async function renderSermonsTab() {
  const supabase = getEffectiveSupabase();
  const container = document.querySelector('#sermons-content');
  container.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;

  const [{ data: sermons, error }, { data: canManage }] = await Promise.all([
    supabase.from('sermons').select('*').is('archived_at', null).order('preached_on', { ascending: false }).limit(500),
    supabase.rpc('can_manage_sermons'),
  ]);
  if (error) { container.innerHTML = `<p class="text-slate-500">${t('sermons.notInstalled')}</p>`; return; }

  const seriesList = [...new Set(sermons.map((s) => s.series).filter(Boolean))].sort();

  container.innerHTML = `
    <div class="flex flex-wrap items-center gap-2 mb-4">
      <input data-el="q" type="search" placeholder="${t('sermons.search')}" class="flex-1 min-w-[12rem] border border-slate-300 rounded-lg px-3 py-2 text-sm">
      <select data-el="series" class="border border-slate-300 rounded-lg px-2 py-2 text-sm">
        <option value="">${t('sermons.allSeries')}</option>
        ${seriesList.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('')}
      </select>
      <select data-el="lang" class="border border-slate-300 rounded-lg px-2 py-2 text-sm">
        <option value="">${t('sermons.allLanguages')}</option>
        ${LANGS.map((l) => `<option value="${l}">${t(`sermons.lang.${l}`)}</option>`).join('')}
      </select>
      ${canManage ? `<button type="button" data-action="new" class="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">${t('sermons.add')}</button>` : ''}
    </div>
    <div data-el="form"></div>
    <div data-el="list" class="space-y-3"></div>`;

  const formEl = container.querySelector('[data-el="form"]');
  const listEl = container.querySelector('[data-el="list"]');
  const qEl = container.querySelector('[data-el="q"]');
  const seriesEl = container.querySelector('[data-el="series"]');
  const langEl = container.querySelector('[data-el="lang"]');

  function renderList() {
    const q = qEl.value.trim().toLowerCase();
    const shown = sermons.filter((s) => {
      if (seriesEl.value && s.series !== seriesEl.value) return false;
      if (langEl.value && s.language !== langEl.value) return false;
      if (!q) return true;
      return [s.title, s.preacher, s.series, s.scripture, s.summary].some((v) => v && v.toLowerCase().includes(q));
    });
    if (!shown.length) { listEl.innerHTML = `<p class="text-sm text-slate-500">${sermons.length ? t('sermons.noMatch') : t('sermons.none')}</p>`; return; }
    listEl.innerHTML = shown.map((s) => `
      <article class="bg-white rounded-xl shadow p-4" data-sermon="${s.id}">
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div class="min-w-0">
            <h3 class="font-semibold">${escapeHtml(s.title)}</h3>
            <p class="text-sm text-slate-600">${[s.preacher, formatDate(s.preached_on), s.scripture].filter(Boolean).map(escapeHtml).join(' · ')}</p>
            <p class="text-xs text-slate-500 mt-0.5">${s.series ? `${t('sermons.series')}: ${escapeHtml(s.series)} · ` : ''}${t(`sermons.lang.${s.language}`)}</p>
          </div>
          ${canManage ? `<div class="flex gap-2"><button type="button" data-edit="${s.id}" class="px-3 py-1 rounded-lg border border-slate-300 text-xs">${t('common.edit')}</button>
            <button type="button" data-archive="${s.id}" class="px-3 py-1 rounded-lg border border-rose-200 text-rose-700 text-xs">${t('sermons.archive')}</button></div>` : ''}
        </div>
        ${s.summary ? `<p class="text-sm text-slate-700 mt-2 whitespace-pre-line">${escapeHtml(s.summary)}</p>` : ''}
        <div class="flex flex-wrap gap-2 mt-3">
          ${s.video_url ? `<a href="${escapeHtml(s.video_url)}" target="_blank" rel="noopener noreferrer" class="px-3 py-1.5 rounded-lg bg-rose-50 text-rose-700 text-sm font-medium">▶ ${t('sermons.watch')}</a>` : ''}
          ${s.audio_path ? `<button type="button" data-audio="${s.id}" class="px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 text-sm font-medium">🎧 ${t('sermons.listen')}</button>` : ''}
          ${s.notes_path ? `<button type="button" data-notes="${s.id}" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium">📄 ${t('sermons.notes')}</button>` : ''}
        </div>
        <div data-player="${s.id}" class="mt-2"></div>
      </article>`).join('');

    listEl.querySelectorAll('[data-audio]').forEach((b) => b.addEventListener('click', async () => {
      const s = sermons.find((x) => x.id === b.dataset.audio);
      const { data, error: e } = await supabase.storage.from(BUCKET).createSignedUrl(s.audio_path, 3 * 3600);
      const slot = listEl.querySelector(`[data-player="${s.id}"]`);
      if (e) { slot.innerHTML = `<p class="text-sm text-rose-600">${escapeHtml(e.message)}</p>`; return; }
      slot.innerHTML = `<audio controls autoplay preload="metadata" class="w-full" src="${escapeHtml(data.signedUrl)}"></audio>`;
    }));
    listEl.querySelectorAll('[data-notes]').forEach((b) => b.addEventListener('click', async () => {
      const s = sermons.find((x) => x.id === b.dataset.notes);
      const win = window.open('', '_blank');
      const { data, error: e } = await supabase.storage.from(BUCKET).createSignedUrl(s.notes_path, 3600);
      if (e) { win?.close(); alert(e.message); return; }
      if (win) win.location = data.signedUrl; else window.location.href = data.signedUrl;
    }));
    listEl.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
      renderForm(sermons.find((x) => x.id === b.dataset.edit));
      formEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    listEl.querySelectorAll('[data-archive]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm(t('sermons.archiveConfirm'))) return;
      const { error: e } = await supabase.from('sermons').update({ archived_at: new Date().toISOString() }).eq('id', b.dataset.archive);
      if (e) alert(e.message); else renderSermonsTab();
    }));
  }

  function renderForm(s) {
    formEl.innerHTML = `
      <form class="bg-white rounded-xl shadow p-4 mb-4 grid sm:grid-cols-2 gap-3">
        <input name="title" required maxlength="200" value="${escapeHtml(s?.title || '')}" placeholder="${t('sermons.title_')}" class="border border-slate-300 rounded-lg px-3 py-2 text-sm sm:col-span-2">
        <input name="preacher" maxlength="120" value="${escapeHtml(s?.preacher || '')}" placeholder="${t('sermons.preacher')}" class="border border-slate-300 rounded-lg px-3 py-2 text-sm">
        <input name="preached_on" type="date" required value="${escapeHtml(s?.preached_on || todayIso())}" class="border border-slate-300 rounded-lg px-3 py-2 text-sm">
        <input name="series" maxlength="120" list="sermon-series-list" value="${escapeHtml(s?.series || '')}" placeholder="${t('sermons.series')}" class="border border-slate-300 rounded-lg px-3 py-2 text-sm">
        <datalist id="sermon-series-list">${seriesList.map((x) => `<option value="${escapeHtml(x)}">`).join('')}</datalist>
        <input name="scripture" maxlength="200" value="${escapeHtml(s?.scripture || '')}" placeholder="${t('sermons.scripture')}" class="border border-slate-300 rounded-lg px-3 py-2 text-sm">
        <label class="text-sm text-slate-700">${t('sermons.language')}
          <select name="language" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-sm">${LANGS.map((l) => `<option value="${l}" ${(s?.language || 'fr') === l ? 'selected' : ''}>${t(`sermons.lang.${l}`)}</option>`).join('')}</select>
        </label>
        <input name="video_url" type="url" pattern="https://.*" value="${escapeHtml(s?.video_url || '')}" placeholder="${t('sermons.videoUrl')}" class="border border-slate-300 rounded-lg px-3 py-2 text-sm self-end">
        <textarea name="summary" rows="3" placeholder="${t('sermons.summary')}" class="border border-slate-300 rounded-lg px-3 py-2 text-sm sm:col-span-2">${escapeHtml(s?.summary || '')}</textarea>
        <label class="text-sm text-slate-700">${t('sermons.audioFile')}${s?.audio_path ? ` <span class="text-xs text-emerald-700">(${t('sermons.fileKept')})</span>` : ''}
          <input name="audio" type="file" accept="audio/*" class="mt-1 block w-full text-sm"></label>
        <label class="text-sm text-slate-700">${t('sermons.notesFile')}${s?.notes_path ? ` <span class="text-xs text-emerald-700">(${t('sermons.fileKept')})</span>` : ''}
          <input name="notes" type="file" accept="application/pdf" class="mt-1 block w-full text-sm"></label>
        <div class="sm:col-span-2 flex flex-wrap gap-2 items-center">
          <button type="submit" class="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium">${t('givingAdmin.save')}</button>
          <button type="button" data-action="cancel" class="px-4 py-2 rounded-lg border border-slate-300 text-sm">${t('common.cancel')}</button>
          <span data-el="msg" class="text-sm text-slate-600"></span>
        </div>
      </form>`;
    const form = formEl.querySelector('form');
    const msg = form.querySelector('[data-el="msg"]');
    form.querySelector('[data-action="cancel"]').addEventListener('click', () => { formEl.innerHTML = ''; });
    attachAiWriter(form.elements.summary, ['summary', 'translate']);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = form.elements;
      const audio = f.audio.files[0];
      const notes = f.notes.files[0];
      if ((audio && audio.size > MAX_BYTES) || (notes && notes.size > MAX_BYTES)) { msg.textContent = t('sermons.tooBig'); return; }
      const row = {
        title: f.title.value.trim(),
        preacher: f.preacher.value.trim() || null,
        preached_on: f.preached_on.value,
        series: f.series.value.trim() || null,
        scripture: f.scripture.value.trim() || null,
        language: f.language.value,
        video_url: f.video_url.value.trim() || null,
        summary: f.summary.value.trim() || null,
      };
      form.querySelector('[type="submit"]').disabled = true;
      msg.className = 'text-sm text-slate-600';
      msg.textContent = t('sermons.saving');
      const { data: saved, error: saveError } = s
        ? await supabase.from('sermons').update(row).eq('id', s.id).select('id, tenant_id').single()
        : await supabase.from('sermons').insert(row).select('id, tenant_id').single();
      const fail = (m) => { msg.className = 'text-sm text-rose-600'; msg.textContent = m; form.querySelector('[type="submit"]').disabled = false; };
      if (saveError) { fail(saveError.message); return; }

      const paths = {};
      for (const [key, file] of [['audio_path', audio], ['notes_path', notes]]) {
        if (!file) continue;
        msg.textContent = t('sermons.uploading', { name: file.name });
        const path = `${saved.tenant_id}/${saved.id}/${key === 'audio_path' ? 'audio' : 'notes'}-${Date.now()}.${fileExt(file)}`;
        const { error: upError } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
        if (upError) { fail(upError.message); return; }
        if (s?.[key]) await supabase.storage.from(BUCKET).remove([s[key]]);
        paths[key] = path;
      }
      if (Object.keys(paths).length) {
        const { error: pathError } = await supabase.from('sermons').update(paths).eq('id', saved.id);
        if (pathError) { fail(pathError.message); return; }
      }
      renderSermonsTab();
    });
  }

  qEl.addEventListener('input', renderList);
  seriesEl.addEventListener('change', renderList);
  langEl.addEventListener('change', renderList);
  container.querySelector('[data-action="new"]')?.addEventListener('click', () => renderForm(null));
  renderList();
}
