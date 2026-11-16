// Small Groups tab (sql/saas_platform/148_small_groups.sql).
// Everyone sees the church's groups (name, leader, day/time/place) and
// their own group's members and meetings. The pastoral team creates,
// edits and archives groups; a group's leader/co-leader manages its
// members and logs each meeting (attendance, guests, a short report).
// RLS enforces all of that -- the buttons shown here are convenience only.
import { getEffectiveSupabase } from './departments.js';
import { t, formatDate } from './i18n.js';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function scheduleText(g) {
  const parts = [];
  if (g.meeting_day !== null && g.meeting_day !== undefined) parts.push(t(`smallGroups.day.${DAY_KEYS[g.meeting_day]}`));
  if (g.meeting_time) parts.push(String(g.meeting_time).slice(0, 5));
  if (g.location) parts.push(g.location);
  return parts.join(' · ');
}

export async function renderSmallGroupsTab() {
  const supabase = getEffectiveSupabase();
  const container = document.querySelector('#small-groups-content');
  container.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { container.innerHTML = `<p class="text-slate-500">${t('scheduling.pleaseSignIn')}</p>`; return; }

  const [{ data: isPastoral }, { data: groups, error }, { data: myMemberships }, { data: people }] = await Promise.all([
    supabase.rpc('is_pastoral_team'),
    supabase.from('small_groups').select('*').is('archived_at', null).order('name'),
    supabase.from('small_group_members').select('group_id').eq('user_id', user.id),
    supabase.from('profiles').select('id, full_name').is('removed_at', null).order('full_name'),
  ]);
  if (error) { container.innerHTML = `<p class="text-slate-500">${t('smallGroups.notInstalled')}</p>`; return; }

  const nameById = new Map((people || []).map((p) => [p.id, p.full_name]));
  const myGroupIds = new Set((myMemberships || []).map((m) => m.group_id));
  const canManage = (g) => isPastoral || user.id === g.leader_id || user.id === g.co_leader_id;

  container.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
      <p class="text-sm text-slate-500">${t('smallGroups.intro')}</p>
      ${isPastoral ? `<button type="button" data-action="new" class="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">${t('smallGroups.newGroup')}</button>` : ''}
    </div>
    <div data-el="form"></div>
    <div data-el="list" class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3"></div>
    <div data-el="detail" class="mt-6"></div>`;

  const formEl = container.querySelector('[data-el="form"]');
  const listEl = container.querySelector('[data-el="list"]');
  const detailEl = container.querySelector('[data-el="detail"]');

  if (!groups.length) listEl.innerHTML = `<p class="text-sm text-slate-500">${t('smallGroups.none')}</p>`;
  else {
    listEl.innerHTML = groups.map((g) => `
      <button type="button" data-group="${g.id}" class="text-left bg-white rounded-xl shadow p-4 hover:ring-2 hover:ring-indigo-200 ${myGroupIds.has(g.id) ? 'ring-2 ring-emerald-300' : ''}">
        <div class="flex items-start justify-between gap-2">
          <p class="font-semibold">${escapeHtml(g.name)}</p>
          ${myGroupIds.has(g.id) ? `<span class="text-[11px] font-medium text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5">${t('smallGroups.myGroup')}</span>` : ''}
        </div>
        <p class="text-sm text-slate-600 mt-1">${t('smallGroups.leader')}: ${escapeHtml(nameById.get(g.leader_id) || '—')}</p>
        <p class="text-xs text-slate-500 mt-1">${escapeHtml(scheduleText(g))}</p>
      </button>`).join('');
  }

  container.querySelector('[data-action="new"]')?.addEventListener('click', () => renderGroupForm(null));
  listEl.querySelectorAll('[data-group]').forEach((b) => b.addEventListener('click', () => {
    const g = groups.find((x) => x.id === b.dataset.group);
    renderDetail(g);
    detailEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));

  function peopleOptions(selected) {
    return `<option value="">—</option>` + (people || []).map((p) => `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${escapeHtml(p.full_name)}</option>`).join('');
  }

  function renderGroupForm(g) {
    formEl.innerHTML = `
      <form class="bg-white rounded-xl shadow p-4 mb-4 grid sm:grid-cols-2 gap-3">
        <input name="name" required maxlength="120" value="${escapeHtml(g?.name || '')}" placeholder="${t('smallGroups.name')}" class="border border-slate-300 rounded-lg px-3 py-2 text-sm sm:col-span-2">
        <label class="text-sm text-slate-700">${t('smallGroups.leader')}<select name="leader_id" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-sm">${peopleOptions(g?.leader_id)}</select></label>
        <label class="text-sm text-slate-700">${t('smallGroups.coLeader')}<select name="co_leader_id" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-sm">${peopleOptions(g?.co_leader_id)}</select></label>
        <label class="text-sm text-slate-700">${t('smallGroups.dayLabel')}<select name="meeting_day" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-sm">
          <option value="">—</option>${DAY_KEYS.map((k, i) => `<option value="${i}" ${g?.meeting_day === i ? 'selected' : ''}>${t(`smallGroups.day.${k}`)}</option>`).join('')}</select></label>
        <label class="text-sm text-slate-700">${t('smallGroups.time')}<input name="meeting_time" type="time" value="${escapeHtml(g?.meeting_time ? String(g.meeting_time).slice(0, 5) : '')}" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-sm"></label>
        <input name="location" maxlength="200" value="${escapeHtml(g?.location || '')}" placeholder="${t('smallGroups.location')}" class="border border-slate-300 rounded-lg px-3 py-2 text-sm sm:col-span-2">
        <textarea name="description" rows="2" placeholder="${t('smallGroups.description')}" class="border border-slate-300 rounded-lg px-3 py-2 text-sm sm:col-span-2">${escapeHtml(g?.description || '')}</textarea>
        <div class="sm:col-span-2 flex gap-2 items-center">
          <button type="submit" class="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium">${t('givingAdmin.save')}</button>
          <button type="button" data-action="cancel" class="px-4 py-2 rounded-lg border border-slate-300 text-sm">${t('common.cancel')}</button>
          <span data-el="msg" class="text-sm text-rose-600"></span>
        </div>
      </form>`;
    const form = formEl.querySelector('form');
    form.querySelector('[data-action="cancel"]').addEventListener('click', () => { formEl.innerHTML = ''; });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = form.elements;
      const row = {
        name: f.name.value.trim(),
        leader_id: f.leader_id.value || null,
        co_leader_id: f.co_leader_id.value || null,
        meeting_day: f.meeting_day.value === '' ? null : Number(f.meeting_day.value),
        meeting_time: f.meeting_time.value || null,
        location: f.location.value.trim() || null,
        description: f.description.value.trim() || null,
      };
      const q = g ? supabase.from('small_groups').update(row).eq('id', g.id) : supabase.from('small_groups').insert({ ...row, created_by: user.id });
      const { error: saveError } = await q;
      if (saveError) { form.querySelector('[data-el="msg"]').textContent = saveError.message; return; }
      renderSmallGroupsTab();
    });
  }

  async function renderDetail(g) {
    detailEl.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;
    const manage = canManage(g);
    const [{ data: members }, { data: meetings }] = await Promise.all([
      supabase.from('small_group_members').select('user_id').eq('group_id', g.id),
      supabase.from('small_group_meetings').select('*').eq('group_id', g.id).order('meeting_date', { ascending: false }).limit(30),
    ]);
    const memberIds = (members || []).map((m) => m.user_id);
    const visible = manage || myGroupIds.has(g.id);

    detailEl.innerHTML = `
      <div class="bg-white rounded-xl shadow p-4 sm:p-6 space-y-5">
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 class="text-lg font-bold">${escapeHtml(g.name)}</h2>
            <p class="text-sm text-slate-600">${escapeHtml(scheduleText(g))}</p>
            ${g.description ? `<p class="text-sm text-slate-500 mt-1 whitespace-pre-line">${escapeHtml(g.description)}</p>` : ''}
            <p class="text-sm text-slate-600 mt-1">${t('smallGroups.leader')}: ${escapeHtml(nameById.get(g.leader_id) || '—')}${g.co_leader_id ? ` · ${t('smallGroups.coLeader')}: ${escapeHtml(nameById.get(g.co_leader_id) || '—')}` : ''}</p>
          </div>
          ${isPastoral ? `<div class="flex gap-2"><button type="button" data-action="edit" class="px-3 py-1.5 rounded-lg border border-slate-300 text-sm">${t('common.edit')}</button>
            <button type="button" data-action="archive" class="px-3 py-1.5 rounded-lg border border-rose-200 text-rose-700 text-sm">${t('smallGroups.archive')}</button></div>` : ''}
        </div>
        ${visible ? `
        <div>
          <h3 class="font-semibold text-sm mb-2">${t('smallGroups.members')} (${memberIds.length})</h3>
          <div class="flex flex-wrap gap-2">${memberIds.map((id) => `<span class="inline-flex items-center gap-1 text-sm bg-slate-100 rounded-full px-3 py-1">${escapeHtml(nameById.get(id) || '—')}${manage ? `<button type="button" data-remove="${id}" class="text-slate-400 hover:text-rose-600" aria-label="remove">×</button>` : ''}</span>`).join('') || `<span class="text-sm text-slate-500">${t('smallGroups.noMembers')}</span>`}</div>
          ${manage ? `<div class="flex gap-2 mt-2"><select data-el="add-member" class="flex-1 min-w-0 border border-slate-300 rounded-lg px-2 py-1.5 text-sm"><option value="">${t('smallGroups.addMember')}</option>${(people || []).filter((p) => !memberIds.includes(p.id)).map((p) => `<option value="${p.id}">${escapeHtml(p.full_name)}</option>`).join('')}</select></div>` : ''}
        </div>
        ${manage ? `
        <form data-el="meeting-form" class="border border-slate-200 rounded-lg p-3 space-y-2">
          <h3 class="font-semibold text-sm">${t('smallGroups.logMeeting')}</h3>
          <div class="flex flex-wrap gap-2">
            <input type="date" name="meeting_date" required value="${new Date().toISOString().slice(0, 10)}" class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
            <label class="text-sm text-slate-700 flex items-center gap-1">${t('smallGroups.guests')}<input type="number" name="guest_count" min="0" max="500" value="0" class="w-20 border border-slate-300 rounded-lg px-2 py-1.5 text-sm"></label>
          </div>
          <div class="grid grid-cols-2 gap-1">${memberIds.map((id) => `<label class="flex items-center gap-2 text-sm"><input type="checkbox" name="present" value="${id}" checked> ${escapeHtml(nameById.get(id) || '—')}</label>`).join('')}</div>
          <textarea name="report" rows="2" placeholder="${t('smallGroups.reportPlaceholder')}" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"></textarea>
          <div class="flex items-center gap-2"><button type="submit" class="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium">${t('givingAdmin.save')}</button><span data-el="msg" class="text-sm"></span></div>
        </form>` : ''}
        <div>
          <h3 class="font-semibold text-sm mb-2">${t('smallGroups.meetings')}</h3>
          ${(meetings || []).length ? `<div class="space-y-2">${meetings.map((m) => `
            <div class="border-l-4 border-indigo-200 pl-3">
              <p class="text-sm font-medium">${escapeHtml(formatDate(m.meeting_date))} · ${t('smallGroups.attendance', { present: m.attendee_ids.length, total: memberIds.length, guests: m.guest_count })}</p>
              ${m.report ? `<p class="text-sm text-slate-600 whitespace-pre-line">${escapeHtml(m.report)}</p>` : ''}
            </div>`).join('')}</div>` : `<p class="text-sm text-slate-500">${t('smallGroups.noMeetings')}</p>`}
        </div>` : `<p class="text-sm text-slate-500">${t('smallGroups.askLeader')}</p>`}
      </div>`;

    detailEl.querySelector('[data-action="edit"]')?.addEventListener('click', () => { renderGroupForm(g); formEl.scrollIntoView({ behavior: 'smooth' }); });
    detailEl.querySelector('[data-action="archive"]')?.addEventListener('click', async () => {
      if (!window.confirm(t('smallGroups.archiveConfirm', { name: g.name }))) return;
      await supabase.from('small_groups').update({ archived_at: new Date().toISOString() }).eq('id', g.id);
      renderSmallGroupsTab();
    });
    detailEl.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', async () => {
      await supabase.from('small_group_members').delete().eq('group_id', g.id).eq('user_id', b.dataset.remove);
      renderDetail(g);
    }));
    detailEl.querySelector('[data-el="add-member"]')?.addEventListener('change', async (e) => {
      if (!e.target.value) return;
      await supabase.from('small_group_members').insert({ group_id: g.id, user_id: e.target.value });
      renderDetail(g);
    });
    detailEl.querySelector('[data-el="meeting-form"]')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const row = {
        group_id: g.id,
        meeting_date: f.meeting_date.value,
        guest_count: Number(f.guest_count.value) || 0,
        attendee_ids: [...f.querySelectorAll('input[name="present"]:checked')].map((i) => i.value),
        report: f.report.value.trim() || null,
        created_by: user.id,
      };
      const { error: saveError } = await supabase.from('small_group_meetings').upsert(row, { onConflict: 'group_id,meeting_date' });
      const msg = f.querySelector('[data-el="msg"]');
      msg.className = saveError ? 'text-sm text-rose-600' : 'text-sm text-emerald-600';
      msg.textContent = saveError ? saveError.message : t('givingAdmin.saved');
      if (!saveError) renderDetail(g);
    });
  }
}
