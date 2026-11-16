// Discipleship tab (sql/saas_platform/154_discipleship_path.sql).
// Everyone sees "My journey": the church's growth steps and which ones they
// have completed (get_my_discipleship RPC, matched through members.profile_id).
// The pastoral team also sees how many people reached each step, who has
// stalled, records progress for anyone in the member database, and edits the
// steps. RLS enforces all of that -- the buttons here are convenience only.
import { getEffectiveSupabase } from './departments.js';
import { t, formatDate, getLang } from './i18n.js';

const STALL_DAYS = 90;

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function stepTitle(s) {
  return getLang() === 'fr' && s.title_fr ? s.title_fr : s.title_en;
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function renderDiscipleshipTab() {
  const supabase = getEffectiveSupabase();
  const container = document.querySelector('#discipleship-content');
  container.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { container.innerHTML = `<p class="text-slate-500">${t('scheduling.pleaseSignIn')}</p>`; return; }

  const [{ data: journey, error }, { data: isPastoral }] = await Promise.all([
    supabase.rpc('get_my_discipleship'),
    supabase.rpc('is_pastoral_team'),
  ]);
  if (error) { container.innerHTML = `<p class="text-slate-500">${t('discipleship.notInstalled')}</p>`; return; }

  container.innerHTML = `
    <section class="bg-white rounded-xl shadow p-4 sm:p-6 mb-6">
      <h2 class="text-lg font-bold mb-1">${t('discipleship.myJourney')}</h2>
      <p class="text-sm text-slate-500 mb-4">${t('discipleship.myJourneyIntro')}</p>
      <ol data-el="journey" class="space-y-3"></ol>
    </section>
    <div data-el="pastoral"></div>`;

  const journeyEl = container.querySelector('[data-el="journey"]');
  if (!journey.length) journeyEl.innerHTML = `<li class="text-sm text-slate-500">${t('discipleship.noSteps')}</li>`;
  else {
    journeyEl.innerHTML = journey.map((s, i) => {
      const done = !!s.completed_on;
      return `<li class="flex items-start gap-3">
        <span class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${done ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500 border border-slate-300'}">${done ? '✓' : i + 1}</span>
        <div>
          <p class="font-medium ${done ? '' : 'text-slate-600'}">${escapeHtml(stepTitle(s))}</p>
          <p class="text-xs ${done ? 'text-emerald-700' : 'text-slate-400'}">${done ? t('discipleship.completedOn', { date: formatDate(s.completed_on) }) : t('discipleship.notYet')}</p>
          ${s.description ? `<p class="text-xs text-slate-500 mt-0.5">${escapeHtml(s.description)}</p>` : ''}
        </div>
      </li>`;
    }).join('');
  }

  if (isPastoral) renderPastoral(container.querySelector('[data-el="pastoral"]'), supabase, user);
}

async function renderPastoral(root, supabase, user) {
  root.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;
  const [{ data: steps }, { data: progress }, { data: members }] = await Promise.all([
    supabase.from('discipleship_steps').select('*').is('archived_at', null).order('position').order('created_at'),
    supabase.from('discipleship_progress').select('id, member_id, step_id, completed_on'),
    supabase.from('members').select('id, full_name').order('full_name'),
  ]);
  const memberName = new Map((members || []).map((m) => [m.id, m.full_name]));
  const byMember = new Map();
  (progress || []).forEach((p) => {
    if (!byMember.has(p.member_id)) byMember.set(p.member_id, new Map());
    byMember.get(p.member_id).set(p.step_id, p);
  });

  // Stalled: the furthest step reached was completed more than STALL_DAYS
  // ago and there is a next step still to do.
  const cutoff = Date.now() - STALL_DAYS * 86400000;
  const stalled = [];
  byMember.forEach((done, memberId) => {
    let lastIdx = -1;
    steps.forEach((s, i) => { if (done.has(s.id)) lastIdx = i; });
    if (lastIdx < 0 || lastIdx === steps.length - 1) return;
    const last = done.get(steps[lastIdx].id);
    if (new Date(`${last.completed_on}T00:00:00`).getTime() < cutoff && memberName.has(memberId)) {
      stalled.push({ memberId, step: steps[lastIdx], next: steps[lastIdx + 1], since: last.completed_on });
    }
  });
  stalled.sort((a, b) => a.since.localeCompare(b.since));

  const total = (members || []).length || 1;
  root.innerHTML = `
    <section class="bg-white rounded-xl shadow p-4 sm:p-6 mb-6">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 class="text-lg font-bold">${t('discipleship.overview')}</h2>
        <button type="button" data-action="edit-steps" class="px-3 py-1.5 rounded-lg border border-slate-300 text-sm">${t('discipleship.editSteps')}</button>
      </div>
      <div data-el="steps-editor"></div>
      <div class="space-y-2">${steps.map((s) => {
        const n = (progress || []).filter((p) => p.step_id === s.id && memberName.has(p.member_id)).length;
        const pct = Math.round((n / total) * 100);
        return `<div>
          <div class="flex justify-between text-sm"><span>${escapeHtml(stepTitle(s))}</span><span class="text-slate-500">${n} · ${pct}%</span></div>
          <div class="h-2 rounded-full bg-slate-100 overflow-hidden"><div class="h-full bg-indigo-500" style="width:${pct}%"></div></div>
        </div>`;
      }).join('')}</div>
      <p class="text-xs text-slate-400 mt-2">${t('discipleship.ofMembers', { count: (members || []).length })}</p>
    </section>

    <section class="bg-white rounded-xl shadow p-4 sm:p-6 mb-6">
      <h2 class="text-lg font-bold mb-1">${t('discipleship.stalled')}</h2>
      <p class="text-sm text-slate-500 mb-3">${t('discipleship.stalledIntro', { days: STALL_DAYS })}</p>
      ${stalled.length ? `<ul class="divide-y divide-slate-100">${stalled.map((x) => `
        <li class="py-2 flex flex-wrap items-center justify-between gap-2">
          <button type="button" data-open="${x.memberId}" class="font-medium text-indigo-700 hover:underline text-left">${escapeHtml(memberName.get(x.memberId))}</button>
          <span class="text-xs text-slate-500">${escapeHtml(stepTitle(x.step))} (${formatDate(x.since)}) → ${t('discipleship.next')}: ${escapeHtml(stepTitle(x.next))}</span>
        </li>`).join('')}</ul>` : `<p class="text-sm text-slate-500">${t('discipleship.noneStalled')}</p>`}
    </section>

    <section class="bg-white rounded-xl shadow p-4 sm:p-6">
      <h2 class="text-lg font-bold mb-3">${t('discipleship.recordProgress')}</h2>
      <select data-el="member" class="w-full sm:w-96 border border-slate-300 rounded-lg px-3 py-2 text-sm">
        <option value="">${t('discipleship.choosePerson')}</option>
        ${(members || []).map((m) => `<option value="${m.id}">${escapeHtml(m.full_name)}</option>`).join('')}
      </select>
      ${(members || []).length ? '' : `<p class="text-sm text-slate-500 mt-2">${t('discipleship.noMembers')}</p>`}
      <div data-el="checklist" class="mt-4"></div>
    </section>`;

  const select = root.querySelector('[data-el="member"]');
  const checklist = root.querySelector('[data-el="checklist"]');

  function renderChecklist(memberId) {
    if (!memberId) { checklist.innerHTML = ''; return; }
    const done = byMember.get(memberId) || new Map();
    checklist.innerHTML = `<ul class="space-y-2">${steps.map((s) => {
      const p = done.get(s.id);
      return `<li class="flex flex-wrap items-center gap-3 border border-slate-200 rounded-lg px-3 py-2">
        <label class="flex items-center gap-2 flex-1 min-w-0 text-sm">
          <input type="checkbox" data-step="${s.id}" ${p ? 'checked' : ''} class="h-4 w-4">
          <span>${escapeHtml(stepTitle(s))}</span>
        </label>
        <input type="date" data-date="${s.id}" value="${p ? p.completed_on : todayIso()}" class="border border-slate-300 rounded-lg px-2 py-1 text-sm">
      </li>`;
    }).join('')}</ul><p data-el="msg" class="text-sm mt-2"></p>`;
    const msg = checklist.querySelector('[data-el="msg"]');
    const show = (text, ok) => { msg.textContent = text; msg.className = `text-sm mt-2 ${ok ? 'text-emerald-700' : 'text-rose-600'}`; };

    checklist.querySelectorAll('[data-step]').forEach((box) => box.addEventListener('change', async () => {
      const stepId = box.dataset.step;
      const date = checklist.querySelector(`[data-date="${stepId}"]`).value || todayIso();
      box.disabled = true;
      let res;
      if (box.checked) {
        res = await supabase.from('discipleship_progress')
          .upsert({ member_id: memberId, step_id: stepId, completed_on: date, recorded_by: user.id }, { onConflict: 'member_id,step_id' })
          .select('id, member_id, step_id, completed_on').single();
        if (!res.error) {
          if (!byMember.has(memberId)) byMember.set(memberId, new Map());
          byMember.get(memberId).set(stepId, res.data);
        }
      } else {
        res = await supabase.from('discipleship_progress').delete().eq('member_id', memberId).eq('step_id', stepId);
        if (!res.error) byMember.get(memberId)?.delete(stepId);
      }
      box.disabled = false;
      if (res.error) { box.checked = !box.checked; show(res.error.message, false); } else show(t('discipleship.saved'), true);
    }));
    checklist.querySelectorAll('[data-date]').forEach((input) => input.addEventListener('change', async () => {
      const stepId = input.dataset.date;
      const existing = byMember.get(memberId)?.get(stepId);
      if (!existing || !input.value) return;
      const { error } = await supabase.from('discipleship_progress').update({ completed_on: input.value }).eq('id', existing.id);
      if (error) show(error.message, false);
      else { existing.completed_on = input.value; show(t('discipleship.saved'), true); }
    }));
  }

  select.addEventListener('change', () => renderChecklist(select.value));
  root.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => {
    select.value = b.dataset.open;
    renderChecklist(select.value);
    select.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }));

  root.querySelector('[data-action="edit-steps"]').addEventListener('click', () => {
    renderStepsEditor(root.querySelector('[data-el="steps-editor"]'), supabase, steps, () => renderPastoral(root, supabase, user));
  });
}

function renderStepsEditor(el, supabase, steps, onDone) {
  const row = (s, i) => `
    <div class="grid grid-cols-12 gap-2 items-center" data-row="${s?.id || 'new'}">
      <input name="position" type="number" min="0" max="99" value="${s ? s.position : i + 1}" class="col-span-2 sm:col-span-1 border border-slate-300 rounded-lg px-2 py-1.5 text-sm" aria-label="#">
      <input name="title_en" maxlength="120" value="${escapeHtml(s?.title_en || '')}" placeholder="${t('discipleship.titleEn')}" class="col-span-10 sm:col-span-5 border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
      <input name="title_fr" maxlength="120" value="${escapeHtml(s?.title_fr || '')}" placeholder="${t('discipleship.titleFr')}" class="col-span-10 sm:col-span-5 border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
      ${s ? `<button type="button" data-archive="${s.id}" class="col-span-2 sm:col-span-1 text-sm text-rose-600 hover:underline">${t('discipleship.archive')}</button>` : '<span></span>'}
    </div>`;
  el.innerHTML = `
    <form class="border border-slate-200 rounded-lg p-3 mb-4 space-y-2">
      ${steps.map((s, i) => row(s, i)).join('')}
      ${row(null, steps.length)}
      <p class="text-xs text-slate-500">${t('discipleship.newStepHint')}</p>
      <div class="flex gap-2 items-center">
        <button type="submit" class="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium">${t('givingAdmin.save')}</button>
        <button type="button" data-action="cancel" class="px-4 py-2 rounded-lg border border-slate-300 text-sm">${t('common.cancel')}</button>
        <span data-el="msg" class="text-sm text-rose-600"></span>
      </div>
    </form>`;
  const form = el.querySelector('form');
  const msg = form.querySelector('[data-el="msg"]');
  form.querySelector('[data-action="cancel"]').addEventListener('click', () => { el.innerHTML = ''; });
  form.querySelectorAll('[data-archive]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(t('discipleship.archiveConfirm'))) return;
    const { error } = await supabase.from('discipleship_steps').update({ archived_at: new Date().toISOString() }).eq('id', b.dataset.archive);
    if (error) msg.textContent = error.message; else onDone();
  }));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    for (const r of form.querySelectorAll('[data-row]')) {
      const vals = {
        position: Number(r.querySelector('[name="position"]').value) || 0,
        title_en: r.querySelector('[name="title_en"]').value.trim(),
        title_fr: r.querySelector('[name="title_fr"]').value.trim() || null,
      };
      const id = r.dataset.row;
      if (id === 'new') {
        if (!vals.title_en) continue;
        const { error } = await supabase.from('discipleship_steps').insert(vals);
        if (error) { msg.textContent = error.message; return; }
      } else {
        const old = steps.find((s) => s.id === id);
        if (!vals.title_en) { msg.textContent = t('discipleship.titleRequired'); return; }
        if (old.position === vals.position && old.title_en === vals.title_en && (old.title_fr || null) === vals.title_fr) continue;
        const { error } = await supabase.from('discipleship_steps').update(vals).eq('id', id);
        if (error) { msg.textContent = error.message; return; }
      }
    }
    onDone();
  });
}
