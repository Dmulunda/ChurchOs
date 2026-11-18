// Song library: search + list, with a click-through to song detail.
import { renderSongDetail } from './songDetail.js';
import { createSongCreatorModal } from './songCreatorModal.js';
import { t } from '../i18n.js';

const SEARCH_DEBOUNCE_MS = 300;

export function renderSongLibrary(container, { supabase, isAdmin, viewerVoiceParts }) {
  let searchTerm = '';
  let debounceTimer = null;

  container.innerHTML = `
    <div class="flex flex-wrap items-center gap-3 mb-4">
      <input type="search" data-el="search" placeholder="${t('songbook.searchPlaceholder')}"
             class="flex-1 min-w-0 basis-56 border border-slate-300 rounded-lg px-3 py-2" />
      ${isAdmin ? `
        <button type="button" data-action="add-song"
                class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 whitespace-nowrap">
          ${t('songbook.addSong')}
        </button>
      ` : ''}
    </div>
    <div data-el="view"></div>
  `;

  const searchInput = container.querySelector('[data-el="search"]');
  const viewEl = container.querySelector('[data-el="view"]');

  const modal = isAdmin
    ? createSongCreatorModal({ supabase, onCreated: () => showList() })
    : null;

  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      searchTerm = searchInput.value.trim();
      showList();
    }, SEARCH_DEBOUNCE_MS);
  });

  if (isAdmin) {
    container.querySelector('[data-action="add-song"]').addEventListener('click', () => modal.open());
  }

  showList();

  async function showList() {
    viewEl.innerHTML = `<div class="bg-white rounded-xl shadow divide-y divide-slate-100"><p class="p-4 text-slate-500">${t('common.loading')}</p></div>`;

    let query = supabase.from('songs').select('*').order('title', { ascending: true });
    if (searchTerm) query = query.ilike('title', `%${searchTerm}%`);

    const { data, error } = await query;

    if (error) {
      viewEl.innerHTML = `<p class="text-rose-600">${t('songbook.failedToLoad', { message: error.message })}</p>`;
      return;
    }

    if (data.length === 0) {
      viewEl.innerHTML = `<p class="text-slate-500">${t('songbook.noSongsFound')}</p>`;
      return;
    }

    const listEl = document.createElement('div');
    listEl.className = 'bg-white rounded-xl shadow divide-y divide-slate-100';
    listEl.innerHTML = data.map((song) => `
      <button type="button" data-song-id="${song.id}"
              class="w-full text-left px-4 py-3 hover:bg-slate-50 flex items-center justify-between">
        <span class="font-medium text-slate-800">${escapeHtml(song.title)}</span>
        <span class="text-sm text-slate-400">${song.key ? escapeHtml(song.key) : ''}</span>
      </button>
    `).join('');

    listEl.querySelectorAll('[data-song-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const song = data.find((s) => s.id === btn.dataset.songId);
        renderSongDetail(viewEl, song, {
          supabase,
          isAdmin,
          onBack: showList,
          onDeleted: showList,
          onEdit: () => modal.open(song),
          viewerVoiceParts,
        });
      });
    });

    viewEl.innerHTML = '';
    viewEl.appendChild(listEl);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
