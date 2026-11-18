// Sermons tab (sql/saas_platform/158_sermon_library.sql).
// A sermon's video can be a full livestream: video_start_seconds /
// video_end_seconds (sql/166) say which part to show, and YouTube links
// play inside the page limited to that part (utils/videoClip.js).
// Everyone in the church searches and filters sermons, opens the video link,
// plays the audio and opens the notes (short-lived signed links from the
// private 'sermon-files' bucket). The pastoral team and the Media /
// Preaching departments add, edit and archive (can_manage_sermons()).
// RLS and storage policies enforce access -- the buttons are convenience only.
import { getEffectiveSupabase } from './departments.js';
import { t, formatDate } from './i18n.js';
import { attachAiWriter } from './components/aiWriter.js';
import { youtubeId, parseTime, formatTime, startFromLink, clipEmbedUrl, clipWatchUrl, loadYouTubeApi } from './utils/videoClip.js';

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

function clipLabel(s) {
  const a = s.video_start_seconds;
  const b = s.video_end_seconds;
  if (a == null && b == null) return '';
  const parts = [`${formatTime(a || 0)} → ${b != null ? formatTime(b) : t('sermons.clipToEnd')}`];
  if (b != null) parts.push(t('sermons.clipMinutes', { n: Math.max(1, Math.round((b - (a || 0)) / 60)) }));
  return parts.join(' · ');
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
          ${s.video_url ? (youtubeId(s.video_url)
            ? `<button type="button" data-watch="${s.id}" class="px-3 py-1.5 rounded-lg bg-rose-50 text-rose-700 text-sm font-medium">▶ ${t('sermons.watch')}${clipLabel(s) ? ` <span class="font-normal text-rose-600/80">(${escapeHtml(clipLabel(s))})</span>` : ''}</button>`
            : `<a href="${escapeHtml(s.video_url)}" target="_blank" rel="noopener noreferrer" class="px-3 py-1.5 rounded-lg bg-rose-50 text-rose-700 text-sm font-medium">▶ ${t('sermons.watch')}</a>`) : ''}
          ${s.audio_path ? `<button type="button" data-audio="${s.id}" class="px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 text-sm font-medium">🎧 ${t('sermons.listen')}</button>` : ''}
          ${s.notes_path ? `<button type="button" data-notes="${s.id}" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium">📄 ${t('sermons.notes')}</button>` : ''}
        </div>
        <div data-player="${s.id}" class="mt-2"></div>
      </article>`).join('');

    listEl.querySelectorAll('[data-watch]').forEach((b) => b.addEventListener('click', () => {
      const s = sermons.find((x) => x.id === b.dataset.watch);
      const slot = listEl.querySelector(`[data-player="${s.id}"]`);
      if (slot.dataset.showing === 'video') { slot.innerHTML = ''; slot.dataset.showing = ''; return; }
      slot.dataset.showing = 'video';
      slot.innerHTML = `
        <div class="relative w-full rounded-xl overflow-hidden bg-black" style="aspect-ratio:16/9">
          <iframe src="${escapeHtml(clipEmbedUrl(youtubeId(s.video_url), s.video_start_seconds, s.video_end_seconds))}" title="${escapeHtml(s.title)}"
            class="absolute inset-0 w-full h-full" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>
        </div>
        <a href="${escapeHtml(clipWatchUrl(s.video_url, s.video_start_seconds))}" target="_blank" rel="noopener noreferrer" class="inline-block mt-1.5 text-xs text-slate-500 underline">${t('sermons.openYoutube')}</a>`;
    }));
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
        <div class="sm:col-span-2 rounded-xl border border-[#E6E1D6] bg-[#FBF8F1] p-3">
          <p class="text-sm font-semibold text-slate-800">${t('sermons.clipTitle')}</p>
          <p class="text-xs text-slate-500 mt-0.5">${t('sermons.clipHint')}</p>
          <div class="flex flex-wrap items-end gap-2 mt-2">
            <label class="text-xs text-slate-600">${t('sermons.clipStart')}
              <input name="clip_start" value="${escapeHtml(s?.video_start_seconds != null ? formatTime(s.video_start_seconds) : '')}" placeholder="1:05:30" autocomplete="off" class="mt-0.5 block w-28 border border-slate-300 rounded-lg px-3 py-2 text-sm tabular-nums"></label>
            <label class="text-xs text-slate-600">${t('sermons.clipEnd')}
              <input name="clip_end" value="${escapeHtml(s?.video_end_seconds != null ? formatTime(s.video_end_seconds) : '')}" placeholder="1:52:00" autocomplete="off" class="mt-0.5 block w-28 border border-slate-300 rounded-lg px-3 py-2 text-sm tabular-nums"></label>
            <button type="button" data-action="preview" class="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium">▶ ${t('sermons.clipPreview')}</button>
            <span data-el="clip-info" class="text-xs text-slate-500 self-center"></span>
          </div>
          <div data-el="clip-preview" class="mt-3 hidden">
            <div class="relative w-full rounded-xl overflow-hidden bg-black" style="aspect-ratio:16/9"><div data-el="clip-player" class="absolute inset-0 w-full h-full"></div></div>
            <div class="flex flex-wrap gap-2 mt-2">
              <button type="button" data-action="mark-start" class="px-3 py-1.5 rounded-lg bg-[#0B1F3A] text-white text-xs font-medium">⏮ ${t('sermons.markStart')}</button>
              <button type="button" data-action="mark-end" class="px-3 py-1.5 rounded-lg bg-[#0B1F3A] text-white text-xs font-medium">⏭ ${t('sermons.markEnd')}</button>
              <button type="button" data-action="jump-end" class="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs">${t('sermons.jumpEnd')}</button>
            </div>
            <p class="text-xs text-slate-500 mt-1">${t('sermons.markHint')}</p>
          </div>
        </div>
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

    // ---- Sermon part of the video (start / end) ----
    const urlEl = form.elements.video_url;
    const startEl = form.elements.clip_start;
    const endEl = form.elements.clip_end;
    const infoEl = form.querySelector('[data-el="clip-info"]');
    const previewWrap = form.querySelector('[data-el="clip-preview"]');
    let player = null;
    let playerVideo = null;

    function readClip() {
      const a = parseTime(startEl.value);
      const b = parseTime(endEl.value);
      if (Number.isNaN(a) || Number.isNaN(b)) return { error: t('sermons.clipBad') };
      if (a != null && b != null && b <= a) return { error: t('sermons.clipOrder') };
      return { start: a, end: b };
    }
    function updateInfo() {
      const c = readClip();
      infoEl.className = `text-xs self-center ${c.error ? 'text-rose-600' : 'text-slate-500'}`;
      if (c.error) { infoEl.textContent = c.error; return; }
      const isYt = !!youtubeId(urlEl.value.trim());
      if ((c.start != null || c.end != null) && urlEl.value.trim() && !isYt) { infoEl.textContent = t('sermons.clipNotYoutube'); return; }
      infoEl.textContent = c.end != null ? t('sermons.clipMinutes', { n: Math.max(1, Math.round((c.end - (c.start || 0)) / 60)) }) : '';
    }
    startEl.addEventListener('input', updateInfo);
    endEl.addEventListener('input', updateInfo);
    startEl.addEventListener('change', () => { const v = parseTime(startEl.value); if (Number.isFinite(v)) startEl.value = formatTime(v); });
    endEl.addEventListener('change', () => { const v = parseTime(endEl.value); if (Number.isFinite(v)) endEl.value = formatTime(v); });
    // A link shared "at current time" (…&t=3930s) fills Start by itself.
    urlEl.addEventListener('change', () => {
      const from = startFromLink(urlEl.value.trim());
      if (from != null && !startEl.value.trim()) startEl.value = formatTime(from);
      updateInfo();
    });
    updateInfo();

    form.querySelector('[data-action="preview"]').addEventListener('click', async () => {
      const id = youtubeId(urlEl.value.trim());
      if (!id) { infoEl.className = 'text-xs self-center text-rose-600'; infoEl.textContent = t('sermons.clipNotYoutube'); return; }
      const c = readClip();
      previewWrap.classList.remove('hidden');
      const start = Number.isFinite(c.start) ? c.start : 0;
      try {
        const YT = await loadYouTubeApi();
        if (player && playerVideo === id) { player.seekTo(start, true); player.playVideo(); return; }
        player?.destroy?.();
        const holder = form.querySelector('[data-el="clip-player"]');
        holder.innerHTML = '<div></div>';
        playerVideo = id;
        player = new YT.Player(holder.firstChild, {
          videoId: id, width: '100%', height: '100%',
          playerVars: { start, rel: 0, playsinline: 1, modestbranding: 1 },
          events: { onReady: (ev) => ev.target.playVideo() },
        });
      } catch {
        // No IFrame API (blocked): plain player, marking by hand.
        player = null;
        form.querySelector('[data-el="clip-player"]').innerHTML = `<iframe src="${escapeHtml(clipEmbedUrl(id, c.start, c.end))}" class="w-full h-full" allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe>`;
      }
    });
    const mark = (el) => {
      const now = player?.getCurrentTime?.();
      if (!Number.isFinite(now)) return;
      el.value = formatTime(Math.floor(now));
      updateInfo();
    };
    form.querySelector('[data-action="mark-start"]').addEventListener('click', () => mark(startEl));
    form.querySelector('[data-action="mark-end"]').addEventListener('click', () => mark(endEl));
    form.querySelector('[data-action="jump-end"]').addEventListener('click', () => {
      const b = parseTime(endEl.value);
      if (player && Number.isFinite(b)) { player.seekTo(Math.max(0, b - 10), true); player.playVideo(); }
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = form.elements;
      const audio = f.audio.files[0];
      const notes = f.notes.files[0];
      if ((audio && audio.size > MAX_BYTES) || (notes && notes.size > MAX_BYTES)) { msg.textContent = t('sermons.tooBig'); return; }
      const clip = readClip();
      if (clip.error) { msg.className = 'text-sm text-rose-600'; msg.textContent = clip.error; startEl.focus(); return; }
      const row = {
        title: f.title.value.trim(),
        preacher: f.preacher.value.trim() || null,
        preached_on: f.preached_on.value,
        series: f.series.value.trim() || null,
        scripture: f.scripture.value.trim() || null,
        language: f.language.value,
        video_url: f.video_url.value.trim() || null,
        video_start_seconds: f.video_url.value.trim() && clip.start ? clip.start : null,
        video_end_seconds: f.video_url.value.trim() && clip.end != null ? clip.end : null,
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
