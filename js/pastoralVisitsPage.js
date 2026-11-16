// Pastoral Visits tab (sql/saas_platform/164_pastoral_visits.sql).
// The pastoral team plans visits (home, hospital, phone, office), assigns a
// visitor, records the outcome with confidential notes and a follow-up date,
// and sees who has not been visited for a long time. A person a visit is
// assigned to sees only their own visits and can mark them done.
// RLS + a trigger enforce all of that -- the buttons are convenience only.
import { getEffectiveSupabase } from './departments.js';
import { t, formatDate } from './i18n.js';

const TYPES = ['home', 'hospital', 'phone', 'office', 'other'];
const TYPE_ICON = { home: '🏠', hospital: '🏥', phone: '📞', office: '🏢', other: '🤝' };
const LONG_DAYS = 180;

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const todayIso = () => iso(new Date());

// Sidebar probe: show the button to the pastoral team and to anyone with a
// visit assigned to them.
export async function probePastoralVisits() {
  const supabase = getEffectiveSupabase();
  const { data, error } = await supabase.from('pastoral_visits').select('id').limit(1);
  if (error) return { error };
  if (data.length) return { error: null };
  const { data: isPastoral } = await supabase.rpc('is_pastoral_team');
  return isPastoral ? { error: null } : { error: 'hidden' };
}

export async function renderPastoralVisitsTab() {
  const supabase = getEffectiveSupabase();
  const container = document.querySelector('#visits-content');
  container.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { container.innerHTML = `<p class="text-slate-500">${t('scheduling.pleaseSignIn')}</p>`; return; }

  const [{ data: visits, error }, { data: isPastoral }] = await Promise.all([
    supabase.from('pastoral_visits').select('*').order('planned_on', { ascending: true, nullsFirst: false }).limit(1000),
    supabase.rpc('is_pastoral_team'),
  ]);
  if (error) { container.innerHTML = `<p class="text-slate-500">${t('visits.notInstalled')}</p>`; return; }

  const [{ data: people }, { data: members }] = isPastoral ? await Promise.all([
    supabase.from('profiles').select('id, full_name').is('removed_at', null).order('full_name'),
    supabase.from('members').select('id, full_name').order('full_name'),
  ]) : [{ data: [] }, { data: [] }];
  const nameById = new Map((people || []).map((p) => [p.id, p.full_name]));
  const today = todayIso();

  const planned = visits.filter((v) => v.status === 'planned' && (isPastoral || v.assigned_to === user.id));
  const done = visits.filter((v) => v.status === 'done').sort((a, b) => (b.visited_on || '').localeCompare(a.visited_on || ''));
  const lastDoneByMember = new Map();
  done.forEach((v) => { if (v.member_id && !lastDoneByMember.has(v.member_id)) lastDoneByMember.set(v.member_id, v.visited_on); });
  const plannedMemberIds = new Set(planned.map((v) => v.member_id).filter(Boolean));
  const soon = iso(new Date(Date.now() + 7 * 86400000));
  const followUps = isPastoral ? done.filter((v) => v.follow_up_on && v.follow_up_on <= soon
    && !(v.member_id && plannedMemberIds.has(v.member_id))
    && !(v.member_id && lastDoneByMember.get(v.member_id) > v.visited_on)) : [];
  const cutoff = iso(new Date(Date.now() - LONG_DAYS * 86400000));
  const notVisited = isPastoral ? (members || []).filter((m) => !plannedMemberIds.has(m.id) && !(lastDoneByMember.get(m.id) >= cutoff)) : [];

  container.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
      <p class="text-sm text-slate-500">${isPastoral ? t('visits.intro') : t('visits.introVisitor')}</p>
      ${isPastoral ? `<button type="button" data-action="new" class="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">${t('visits.new')}</button>` : ''}
    </div>
    <div data-el="form"></div>
    <section class="mb-6">
      <h2 class="font-semibold mb-2">${t('visits.planned')} (${planned.length})</h2>
      <div data-el="planned" class="space-y-2"></div>
    </section>
    ${isPastoral ? `
    <section class="mb-6">
      <h2 class="font-semibold mb-2">${t('visits.followUps')} (${followUps.length})</h2>
      <div data-el="followups" class="space-y-2"></div>
    </section>
    <section class="mb-6">
      <details class="bg-white rounded-xl shadow p-4">
        <summary class="font-semibold cursor-pointer">${t('visits.notVisited', { count: notVisited.length, months: Math.round(LONG_DAYS / 30) })}</summary>
        <ul class="mt-3 divide-y divide-slate-100">${notVisited.slice(0, 200).map((m) => `
          <li class="py-1.5 flex items-center justify-between gap-2 text-sm">
            <span>${escapeHtml(m.full_name)} <span class="text-xs text-slate-400">${lastDoneByMember.has(m.id) ? t('visits.lastVisit', { date: formatDate(lastDoneByMember.get(m.id)) }) : t('visits.neverVisited')}</span></span>
            <button type="button" data-plan-member="${m.id}" class="text-xs px-2 py-0.5 rounded border border-indigo-200 text-indigo-700">${t('visits.plan')}</button>
          </li>`).join('') || `<li class="text-sm text-slate-500 py-1">${t('visits.everyoneVisited')}</li>`}</ul>
      </details>
    </section>` : ''}
    <section>
      <h2 class="font-semibold mb-2">${t('visits.history')}</h2>
      <div data-el="history" class="space-y-2"></div>
    </section>`;

  const formEl = container.querySelector('[data-el="form"]');

  function card(v, { actions = true } = {}) {
    const overdue = v.status === 'planned' && v.planned_on && v.planned_on < today;
    const mine = v.assigned_to === user.id;
    const when = v.status === 'done'
      ? t('visits.visitedOn', { date: formatDate(v.visited_on) })
      : v.planned_on ? `${formatDate(v.planned_on)}${v.planned_time ? ` · ${String(v.planned_time).slice(0, 5)}` : ''}` : t('visits.noDate');
    return `<article class="bg-white rounded-xl shadow p-3 ${overdue ? 'ring-2 ring-rose-200' : ''}" data-visit="${v.id}">
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div class="min-w-0">
          <p class="font-medium">${TYPE_ICON[v.visit_type] || ''} ${escapeHtml(v.person_name)} <span class="text-xs font-normal text-slate-500">· ${t(`visits.type.${v.visit_type}`)}</span></p>
          <p class="text-xs ${overdue ? 'text-rose-600 font-medium' : 'text-slate-500'}">${escapeHtml(when)}${overdue ? ` · ${t('visits.overdue')}` : ''}${v.location ? ` · ${escapeHtml(v.location)}` : ''}</p>
          ${v.reason ? `<p class="text-sm text-slate-700 mt-1">${escapeHtml(v.reason)}</p>` : ''}
          ${isPastoral ? `<p class="text-xs text-slate-500 mt-1">${t('visits.visitor')}: ${escapeHtml(nameById.get(v.assigned_to) || t('visits.unassigned'))}</p>` : ''}
          ${v.status === 'done' && v.notes ? `<p class="text-sm mt-2 whitespace-pre-line bg-slate-50 rounded p-2">🔒 ${escapeHtml(v.notes)}</p>` : ''}
          ${v.follow_up_on ? `<p class="text-xs text-amber-700 mt-1">${t('visits.followUpOn', { date: formatDate(v.follow_up_on) })}</p>` : ''}
        </div>
        ${actions ? `<div class="flex flex-wrap gap-1">
          ${v.status === 'planned' && (isPastoral || mine) ? `<button type="button" data-done="${v.id}" class="px-2 py-1 rounded-lg bg-emerald-600 text-white text-xs">${t('visits.markDone')}</button>` : ''}
          ${isPastoral && v.status === 'planned' ? `<button type="button" data-edit="${v.id}" class="px-2 py-1 rounded-lg border border-slate-300 text-xs">${t('common.edit')}</button>
            <button type="button" data-cancel="${v.id}" class="px-2 py-1 rounded-lg border border-rose-200 text-rose-700 text-xs">${t('visits.cancelVisit')}</button>` : ''}
          ${isPastoral && v.status === 'done' && v.follow_up_on ? `<button type="button" data-followup="${v.id}" class="px-2 py-1 rounded-lg border border-indigo-200 text-indigo-700 text-xs">${t('visits.planFollowUp')}</button>` : ''}
        </div>` : ''}
      </div>
      <div data-slot="${v.id}"></div>
    </article>`;
  }

  container.querySelector('[data-el="planned"]').innerHTML = planned.map((v) => card(v)).join('') || `<p class="text-sm text-slate-500">${t('visits.nonePlanned')}</p>`;
  const followEl = container.querySelector('[data-el="followups"]');
  if (followEl) followEl.innerHTML = followUps.map((v) => card(v)).join('') || `<p class="text-sm text-slate-500">${t('visits.noFollowUps')}</p>`;
  const historyRows = done.filter((v) => isPastoral || v.assigned_to === user.id).slice(0, 50);
  container.querySelector('[data-el="history"]').innerHTML = historyRows.map((v) => card(v, { actions: isPastoral && !!v.follow_up_on })).join('') || `<p class="text-sm text-slate-500">${t('visits.noHistory')}</p>`;

  const byId = (id) => visits.find((v) => v.id === id);

  function renderForm(v, preset = {}) {
    const memberOptions = `<option value="">${t('visits.notInDatabase')}</option>` + (members || []).map((m) => `<option value="${m.id}" ${(v?.member_id || preset.member_id) === m.id ? 'selected' : ''}>${escapeHtml(m.full_name)}</option>`).join('');
    const peopleOptions = `<option value="">${t('visits.unassigned')}</option>` + (people || []).map((p) => `<option value="${p.id}" ${v?.assigned_to === p.id ? 'selected' : ''}>${escapeHtml(p.full_name)}</option>`).join('');
    formEl.innerHTML = `
      <form class="bg-white rounded-xl shadow p-4 mb-6 grid sm:grid-cols-2 gap-3">
        <label class="text-sm text-slate-700">${t('visits.member')}<select name="member_id" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-sm">${memberOptions}</select></label>
        <label class="text-sm text-slate-700">${t('visits.personName')}<input name="person_name" required maxlength="160" value="${escapeHtml(v?.person_name || preset.person_name || '')}" class="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"></label>
        <label class="text-sm text-slate-700">${t('visits.typeLabel')}<select name="visit_type" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-sm">${TYPES.map((k) => `<option value="${k}" ${(v?.visit_type || 'home') === k ? 'selected' : ''}>${TYPE_ICON[k]} ${t(`visits.type.${k}`)}</option>`).join('')}</select></label>
        <label class="text-sm text-slate-700">${t('visits.visitor')}<select name="assigned_to" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-sm">${peopleOptions}</select></label>
        <label class="text-sm text-slate-700">${t('visits.date')}<input name="planned_on" type="date" value="${escapeHtml(v?.planned_on || preset.planned_on || '')}" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-sm"></label>
        <label class="text-sm text-slate-700">${t('visits.time')}<input name="planned_time" type="time" value="${escapeHtml(v?.planned_time ? String(v.planned_time).slice(0, 5) : '')}" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-sm"></label>
        <input name="location" maxlength="200" value="${escapeHtml(v?.location || '')}" placeholder="${t('visits.location')}" class="border border-slate-300 rounded-lg px-3 py-2 text-sm">
        <input name="reason" maxlength="300" value="${escapeHtml(v?.reason || preset.reason || '')}" placeholder="${t('visits.reason')}" class="border border-slate-300 rounded-lg px-3 py-2 text-sm">
        <div class="sm:col-span-2 flex flex-wrap gap-2 items-center">
          <button type="submit" class="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium">${t('givingAdmin.save')}</button>
          <button type="button" data-action="cancel" class="px-4 py-2 rounded-lg border border-slate-300 text-sm">${t('common.cancel')}</button>
          <span data-el="msg" class="text-sm text-rose-600"></span>
        </div>
      </form>`;
    const form = formEl.querySelector('form');
    form.elements.member_id.addEventListener('change', () => {
      const m = (members || []).find((x) => x.id === form.elements.member_id.value);
      if (m) form.elements.person_name.value = m.full_name;
    });
    form.querySelector('[data-action="cancel"]').addEventListener('click', () => { formEl.innerHTML = ''; });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = form.elements;
      const row = {
        member_id: f.member_id.value || null,
        person_name: f.person_name.value.trim(),
        visit_type: f.visit_type.value,
        assigned_to: f.assigned_to.value || null,
        planned_on: f.planned_on.value || null,
        planned_time: f.planned_time.value || null,
        location: f.location.value.trim() || null,
        reason: f.reason.value.trim() || null,
      };
      const { error: saveError } = v
        ? await supabase.from('pastoral_visits').update(row).eq('id', v.id)
        : await supabase.from('pastoral_visits').insert({ ...row, created_by: user.id });
      if (saveError) { form.querySelector('[data-el="msg"]').textContent = saveError.message; return; }
      renderPastoralVisitsTab();
    });
    formEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderDoneForm(v) {
    const slot = container.querySelector(`[data-slot="${v.id}"]`);
    slot.innerHTML = `
      <form class="mt-3 border-t border-slate-100 pt-3 grid sm:grid-cols-2 gap-2">
        <label class="text-sm text-slate-700">${t('visits.visitedOnLabel')}<input name="visited_on" type="date" required value="${escapeHtml(v.planned_on && v.planned_on <= today ? v.planned_on : today)}" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"></label>
        <label class="text-sm text-slate-700">${t('visits.followUpLabel')}<input name="follow_up_on" type="date" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"></label>
        <textarea name="notes" rows="3" placeholder="${t('visits.notesPlaceholder')}" class="sm:col-span-2 border border-slate-300 rounded-lg px-3 py-2 text-sm"></textarea>
        <div class="sm:col-span-2 flex gap-2 items-center">
          <button type="submit" class="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm">${t('visits.saveOutcome')}</button>
          <span data-el="msg" class="text-sm text-rose-600"></span>
        </div>
      </form>`;
    const form = slot.querySelector('form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = form.elements;
      const { error: saveError } = await supabase.from('pastoral_visits').update({
        status: 'done',
        visited_on: f.visited_on.value,
        follow_up_on: f.follow_up_on.value || null,
        notes: f.notes.value.trim() || null,
      }).eq('id', v.id);
      if (saveError) { form.querySelector('[data-el="msg"]').textContent = saveError.message; return; }
      renderPastoralVisitsTab();
    });
  }

  container.querySelector('[data-action="new"]')?.addEventListener('click', () => renderForm(null));
  container.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => renderForm(byId(b.dataset.edit))));
  container.querySelectorAll('[data-done]').forEach((b) => b.addEventListener('click', () => renderDoneForm(byId(b.dataset.done))));
  container.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(t('visits.cancelConfirm'))) return;
    const { error: e } = await supabase.from('pastoral_visits').update({ status: 'cancelled' }).eq('id', b.dataset.cancel);
    if (e) alert(e.message); else renderPastoralVisitsTab();
  }));
  container.querySelectorAll('[data-followup]').forEach((b) => b.addEventListener('click', () => {
    const v = byId(b.dataset.followup);
    renderForm(null, { member_id: v.member_id, person_name: v.person_name, planned_on: v.follow_up_on, reason: t('visits.followUpReason') });
  }));
  container.querySelectorAll('[data-plan-member]').forEach((b) => b.addEventListener('click', () => {
    const m = (members || []).find((x) => x.id === b.dataset.planMember);
    renderForm(null, { member_id: m.id, person_name: m.full_name });
  }));
}
