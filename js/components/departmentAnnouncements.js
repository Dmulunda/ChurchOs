// Announcements feed for a department — read by anyone with access to
// that department; posting is gated by `canPost` (department
// admin/secretary, or a church-wide role). A `canPost` poster who also
// holds a church-wide role (`isGlobalPoster`) gets a "Post to" checklist
// above the compose form and can target several departments — or every
// department — at once; the row is simply duplicated once per selected
// department, reusing the existing single-department schema rather than
// adding a join table.
import { confirmDialog } from './confirmDialog.js';
import { notifyDepartment } from '../utils/notifyDepartment.js';
import { t, departmentLabel, formatDate } from '../i18n.js';

const CHIP_OFF = 'bg-white border-slate-200 text-slate-600 hover:border-indigo-200';
const CHIP_ON = 'bg-indigo-50 border-indigo-200 text-indigo-700';

export function renderAnnouncements(container, { supabase, departmentId, canPost, isGlobalPoster, canManage, currentUserId }) {
  container.innerHTML = `
    <h2 class="text-[13px] font-bold text-slate-900 mb-3">📣 ${t('announcements.title')}</h2>
    ${canPost ? `
      <form data-el="form" class="space-y-2.5 mb-4 pb-4 border-b border-slate-100">
        ${isGlobalPoster ? `
          <div>
            <label class="block text-[11px] font-bold text-slate-500 mb-1.5">${t('announcements.postTo')}</label>
            <div data-el="targets" class="flex flex-wrap gap-1.5 mb-1"></div>
          </div>
        ` : ''}
        <input type="text" name="title" required placeholder="${t('announcements.titlePlaceholder')}"
               class="w-full border border-slate-200 rounded-lg px-3 py-2 text-[12.5px]" />
        <textarea name="body" rows="3" placeholder="${t('announcements.bodyPlaceholder')}"
                  class="w-full border border-slate-200 rounded-lg px-3 py-2 text-[12.5px]"></textarea>
        <div class="flex items-center gap-3">
          <button type="submit" class="px-3.5 py-2 rounded-lg bg-indigo-600 text-white text-[12.5px] font-semibold hover:bg-indigo-700">
            ${t('announcements.post')}
          </button>
          <span data-el="form-status" class="text-[11.5px] text-slate-500"></span>
        </div>
      </form>
    ` : ''}
    <div data-el="list" class="space-y-2.5"></div>
  `;

  const listEl = container.querySelector('[data-el="list"]');
  const form = container.querySelector('[data-el="form"]');
  const formStatusEl = container.querySelector('[data-el="form-status"]');
  const targetsEl = container.querySelector('[data-el="targets"]');

  if (targetsEl) loadTargets();

  // Chip-picker replacing a checkbox per department -- "All" toggling
  // dims (but doesn't hide) the individual chips, same as the old
  // all-checkbox disabling them, since a poster might still want to
  // see which departments exist even while targeting all of them.
  // Each chip tracks its own state via data-on (read/written directly,
  // not parsed back out of className) so toggling is unambiguous.
  async function loadTargets() {
    const { data } = await supabase.from('departments').select('id, key, name').order('name');
    const departments = data || [];

    targetsEl.innerHTML = `
      <button type="button" data-el="all-departments" data-on="false" class="chip-target font-bold">${t('announcements.allDepartments')}</button>
      ${departments.map((d) => `
        <button type="button" data-el="dept-target" data-id="${d.id}" data-on="${d.id === departmentId}" class="chip-target">${escapeHtml(departmentLabel(d.key))}</button>
      `).join('')}
    `;

    const allBtn = targetsEl.querySelector('[data-el="all-departments"]');
    const deptBtns = targetsEl.querySelectorAll('[data-el="dept-target"]');
    [allBtn, ...deptBtns].forEach(paintChip);

    allBtn.addEventListener('click', () => {
      const nowOn = allBtn.dataset.on !== 'true';
      allBtn.dataset.on = String(nowOn);
      paintChip(allBtn);
      deptBtns.forEach((btn) => { btn.disabled = nowOn; paintChip(btn); });
    });
    deptBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        btn.dataset.on = String(btn.dataset.on !== 'true');
        paintChip(btn);
      });
    });
  }

  function paintChip(btn) {
    const on = btn.dataset.on === 'true';
    btn.className = `chip-target ${btn === targetsEl.querySelector('[data-el="all-departments"]') ? 'font-bold' : ''} ${on ? CHIP_ON : CHIP_OFF}`;
    btn.style.cssText = `font-size:11px; padding:4px 11px; border-radius:999px; border-width:1px; cursor:pointer; transition:all .12s; opacity:${btn.disabled ? '0.4' : '1'};`;
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = form.elements.title.value.trim();
      const body = form.elements.body.value.trim() || null;
      if (!title) return;

      if (!(await confirmDialog({ message: t('announcements.confirmPost'), confirmLabel: t('announcements.post'), danger: false }))) return;

      const { data: { user } } = await supabase.auth.getUser();

      let targetDeptIds;
      if (targetsEl) {
        const allOn = targetsEl.querySelector('[data-el="all-departments"]').dataset.on === 'true';
        if (allOn) {
          const { data: allDepts } = await supabase.from('departments').select('id');
          targetDeptIds = (allDepts || []).map((d) => d.id);
        } else {
          targetDeptIds = Array.from(targetsEl.querySelectorAll('[data-el="dept-target"]'))
            .filter((btn) => btn.dataset.on === 'true')
            .map((btn) => btn.dataset.id);
        }
      } else {
        targetDeptIds = [departmentId];
      }

      if (targetDeptIds.length === 0) {
        formStatusEl.className = 'text-sm text-rose-600';
        formStatusEl.textContent = t('announcements.noTargets');
        return;
      }

      formStatusEl.className = 'text-sm text-slate-500';
      formStatusEl.textContent = t('common.saving');

      const rows = targetDeptIds.map((id) => ({ department_id: id, title, body, created_by: user.id }));
      const { error } = await supabase.from('department_announcements').insert(rows);

      if (error) {
        formStatusEl.className = 'text-sm text-rose-600';
        formStatusEl.textContent = t('announcements.postFailed', { message: error.message });
        return;
      }

      form.reset();
      formStatusEl.textContent = '';
      load();

      targetDeptIds.forEach((id) => notifyDepartment(supabase, id, title, body));
    });
  }

  load();

  async function load() {
    listEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const { data, error } = await supabase
      .from('department_announcements')
      .select('id, title, body, created_at, created_by, author:profiles!created_by ( full_name )')
      .eq('department_id', departmentId)
      .order('created_at', { ascending: false });

    if (error) {
      listEl.innerHTML = `<p class="text-sm text-rose-600">${t('announcements.loadFailed', { message: error.message })}</p>`;
      return;
    }

    if (data.length === 0) {
      listEl.innerHTML = `
        <div class="flex items-start gap-2 py-0.5">
          <span class="text-lg opacity-50">📣</span>
          <span class="text-[11.5px] text-slate-400 leading-snug pt-0.5">${t('announcements.none')}</span>
        </div>
      `;
      return;
    }

    listEl.innerHTML = '';
    data.forEach((a) => {
      const canDelete = canManage || a.created_by === currentUserId;
      const row = document.createElement('div');
      row.className = 'border-l-2 border-indigo-600 pl-3 py-0.5';
      row.innerHTML = `
        <div class="flex items-start justify-between gap-2">
          <div class="text-[12px] font-semibold text-slate-800">${escapeHtml(a.title)}</div>
          ${canDelete ? `<button type="button" data-action="delete" class="text-[10.5px] font-semibold text-rose-600 hover:text-rose-800 whitespace-nowrap">${t('moderation.delete')}</button>` : ''}
        </div>
        ${a.body ? `<p class="text-[11px] text-slate-500 mt-0.5 whitespace-pre-wrap">${escapeHtml(a.body)}</p>` : ''}
        <div class="text-[9.5px] text-slate-400 mt-1">${escapeHtml(a.author?.full_name || '')} · ${escapeHtml(formatDate(a.created_at))}</div>
      `;
      if (canDelete) {
        row.querySelector('[data-action="delete"]').addEventListener('click', async () => {
          const confirmed = await confirmDialog({ message: t('moderation.confirmDeleteAnnouncement') });
          if (!confirmed) return;
          const { error: deleteError } = await supabase.from('department_announcements').delete().eq('id', a.id);
          if (deleteError) {
            window.alert(t('moderation.deleteFailed', { message: deleteError.message }));
            return;
          }
          load();
        });
      }
      listEl.appendChild(row);
    });
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
