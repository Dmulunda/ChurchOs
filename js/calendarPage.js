// Church calendar tab (sql/saas_platform/150_church_calendar.sql).
// One month at a time, as an agenda grouped by day: calendar items
// (meetings, room bookings), events, department schedules, choir services
// and weekly small-group meetings, all from get_church_calendar().
// Leaders add items and book rooms (the database refuses a room that is
// already taken). The pastoral team manages rooms and the private
// Google/Outlook/Apple subscription link.
import { getEffectiveSupabase } from './departments.js';
import { SUPABASE_URL } from './supabaseClient.js';
import { t, appLocale } from './i18n.js';

const KIND_STYLE = {
  item: 'bg-indigo-100 text-indigo-800',
  event: 'bg-amber-100 text-amber-800',
  shift: 'bg-sky-100 text-sky-800',
  choir: 'bg-fuchsia-100 text-fuchsia-800',
  group: 'bg-emerald-100 text-emerald-800',
};

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

let monthCursor = null;

export async function renderCalendarTab() {
  const supabase = getEffectiveSupabase();
  const container = document.querySelector('#calendar-content');
  if (!monthCursor) { const n = new Date(); monthCursor = new Date(n.getFullYear(), n.getMonth(), 1); }
  container.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { container.innerHTML = `<p class="text-slate-500">${t('scheduling.pleaseSignIn')}</p>`; return; }

  const first = monthCursor;
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  const [{ data: items, error }, { data: isLeader }, { data: isPastoral }, { data: rooms }] = await Promise.all([
    supabase.rpc('get_church_calendar', { p_from: ymd(first), p_to: ymd(last) }),
    supabase.rpc('is_church_leader'),
    supabase.rpc('is_pastoral_team'),
    supabase.from('rooms').select('id, name, capacity').is('archived_at', null).order('name'),
  ]);
  if (error) { container.innerHTML = `<p class="text-slate-500">${t('calendar.notInstalled')}</p>`; return; }

  const monthLabel = first.toLocaleDateString(appLocale(), { month: 'long', year: 'numeric' });
  const byDay = new Map();
  (items || []).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at)).forEach((it) => {
    const key = it.all_day ? String(it.starts_at).slice(0, 10) : ymd(new Date(it.starts_at));
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(it);
  });
  const todayKey = ymd(new Date());

  container.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
      <div class="flex items-center gap-2">
        <button type="button" data-action="prev" class="px-3 py-1.5 rounded-lg border border-slate-300 bg-white">‹</button>
        <h2 class="text-lg font-semibold capitalize min-w-[10rem] text-center">${escapeHtml(monthLabel)}</h2>
        <button type="button" data-action="next" class="px-3 py-1.5 rounded-lg border border-slate-300 bg-white">›</button>
        <button type="button" data-action="today" class="px-3 py-1.5 rounded-lg text-sm text-indigo-700 hover:bg-indigo-50">${t('calendar.today')}</button>
      </div>
      <div class="flex flex-wrap gap-2">
        ${isLeader ? `<button type="button" data-action="add" class="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium">${t('calendar.add')}</button>` : ''}
        ${isPastoral ? `<button type="button" data-action="rooms" class="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm">${t('calendar.rooms')}</button>
        <button type="button" data-action="subscribe" class="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm">${t('calendar.subscribe')}</button>` : ''}
      </div>
    </div>
    <div data-el="panel"></div>
    <div class="flex flex-wrap gap-2 mb-3 text-[11px]">${Object.keys(KIND_STYLE).map((k) => `<span class="rounded-full px-2 py-0.5 ${KIND_STYLE[k]}">${t(`calendar.kind.${k}`)}</span>`).join('')}</div>
    <div class="space-y-2">
      ${byDay.size === 0 ? `<p class="text-sm text-slate-500 bg-white rounded-xl shadow p-4">${t('calendar.empty')}</p>` : [...byDay.entries()].map(([day, list]) => {
        const d = new Date(`${day}T12:00:00`);
        return `
        <div class="bg-white rounded-xl shadow p-3 ${day === todayKey ? 'ring-2 ring-indigo-300' : ''}">
          <p class="text-sm font-semibold text-slate-700 first-letter:uppercase mb-1">${escapeHtml(d.toLocaleDateString(appLocale(), { weekday: 'long', day: 'numeric', month: 'long' }))}</p>
          <div class="space-y-1">${list.map((it) => `
            <div class="flex items-start gap-2 text-sm">
              <span class="shrink-0 w-14 text-xs text-slate-500 pt-0.5">${it.all_day ? t('calendar.allDay') : escapeHtml(new Date(it.starts_at).toLocaleTimeString(appLocale(), { hour: '2-digit', minute: '2-digit' }))}</span>
              <span class="shrink-0 rounded-full px-2 py-0.5 text-[11px] ${KIND_STYLE[it.kind] || ''}">${t(`calendar.kind.${it.kind}`)}</span>
              <span class="min-w-0 flex-1">${escapeHtml(it.title)}${it.location ? ` <span class="text-slate-400">· ${escapeHtml(it.location)}</span>` : ''}${it.visibility === 'leaders' ? ` <span class="text-[11px] text-slate-400">(${t('calendar.leadersOnly')})</span>` : ''}</span>
              ${it.kind === 'item' && (isPastoral || it.created_by === user.id) ? `<button type="button" data-delete="${it.ref_id}" class="text-slate-400 hover:text-rose-600 text-xs">${t('calendar.delete')}</button>` : ''}
            </div>`).join('')}</div>
        </div>`;
      }).join('')}
    </div>`;

  const panel = container.querySelector('[data-el="panel"]');
  const shift = (m) => { monthCursor = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + m, 1); renderCalendarTab(); };
  container.querySelector('[data-action="prev"]').addEventListener('click', () => shift(-1));
  container.querySelector('[data-action="next"]').addEventListener('click', () => shift(1));
  container.querySelector('[data-action="today"]').addEventListener('click', () => { monthCursor = null; renderCalendarTab(); });
  container.querySelectorAll('[data-delete]').forEach((b) => b.addEventListener('click', async () => {
    if (!window.confirm(t('calendar.deleteConfirm'))) return;
    await supabase.from('calendar_items').delete().eq('id', b.dataset.delete);
    renderCalendarTab();
  }));

  container.querySelector('[data-action="add"]')?.addEventListener('click', () => {
    const today = ymd(new Date());
    panel.innerHTML = `
      <form class="bg-white rounded-xl shadow p-4 mb-4 grid sm:grid-cols-2 gap-3">
        <input name="title" required maxlength="150" placeholder="${t('calendar.itemTitle')}" class="sm:col-span-2 border border-slate-300 rounded-lg px-3 py-2 text-sm">
        <label class="text-sm">${t('calendar.date')}<input name="date" type="date" required value="${today}" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-sm"></label>
        <div class="grid grid-cols-2 gap-2">
          <label class="text-sm">${t('calendar.start')}<input name="start" type="time" required value="18:00" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-sm"></label>
          <label class="text-sm">${t('calendar.end')}<input name="end" type="time" required value="20:00" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-sm"></label>
        </div>
        <label class="text-sm">${t('calendar.room')}<select name="room_id" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-sm"><option value="">${t('calendar.noRoom')}</option>${(rooms || []).map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('')}</select></label>
        <label class="text-sm">${t('calendar.visibility')}<select name="visibility" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-sm"><option value="church">${t('calendar.everyone')}</option><option value="leaders">${t('calendar.leadersOnly')}</option></select></label>
        <textarea name="description" rows="2" placeholder="${t('smallGroups.description')}" class="sm:col-span-2 border border-slate-300 rounded-lg px-3 py-2 text-sm"></textarea>
        <div class="sm:col-span-2 flex items-center gap-2"><button type="submit" class="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium">${t('givingAdmin.save')}</button>
          <button type="button" data-action="cancel" class="px-4 py-2 rounded-lg border border-slate-300 text-sm">${t('common.cancel')}</button><span data-el="msg" class="text-sm text-rose-600"></span></div>
      </form>`;
    const form = panel.querySelector('form');
    form.querySelector('[data-action="cancel"]').addEventListener('click', () => { panel.innerHTML = ''; });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = form.elements;
      const startsAt = new Date(`${f.date.value}T${f.start.value}`);
      const endsAt = new Date(`${f.date.value}T${f.end.value}`);
      const msg = form.querySelector('[data-el="msg"]');
      if (endsAt <= startsAt) { msg.textContent = t('calendar.errorTimes'); return; }
      const { error: saveError } = await supabase.from('calendar_items').insert({
        title: f.title.value.trim(), description: f.description.value.trim() || null,
        starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(),
        room_id: f.room_id.value || null, visibility: f.visibility.value, created_by: user.id,
      });
      if (saveError) { msg.textContent = saveError.message.includes('ROOM_BOOKED') ? t('calendar.roomTaken', { title: saveError.message.split('ROOM_BOOKED:')[1]?.trim() || '' }) : saveError.message; return; }
      monthCursor = new Date(startsAt.getFullYear(), startsAt.getMonth(), 1);
      renderCalendarTab();
    });
  });

  container.querySelector('[data-action="rooms"]')?.addEventListener('click', () => {
    panel.innerHTML = `
      <div class="bg-white rounded-xl shadow p-4 mb-4 space-y-3">
        <p class="font-semibold text-sm">${t('calendar.rooms')}</p>
        <div class="flex flex-wrap gap-2">${(rooms || []).map((r) => `<span class="inline-flex items-center gap-1 text-sm bg-slate-100 rounded-full px-3 py-1">${escapeHtml(r.name)}${r.capacity ? ` (${r.capacity})` : ''}<button type="button" data-archive-room="${r.id}" class="text-slate-400 hover:text-rose-600">×</button></span>`).join('') || `<span class="text-sm text-slate-500">${t('calendar.noRooms')}</span>`}</div>
        <form class="flex flex-wrap gap-2"><input name="name" required maxlength="80" placeholder="${t('calendar.roomName')}" class="flex-1 min-w-0 border border-slate-300 rounded-lg px-3 py-2 text-sm">
          <input name="capacity" type="number" min="1" placeholder="${t('calendar.capacity')}" class="w-28 border border-slate-300 rounded-lg px-2 py-2 text-sm">
          <button type="submit" class="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm">${t('calendar.addRoom')}</button></form>
      </div>`;
    panel.querySelectorAll('[data-archive-room]').forEach((b) => b.addEventListener('click', async () => {
      await supabase.from('rooms').update({ archived_at: new Date().toISOString() }).eq('id', b.dataset.archiveRoom);
      renderCalendarTab();
    }));
    panel.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target.elements;
      const { error: roomError } = await supabase.from('rooms').insert({ name: f.name.value.trim(), capacity: f.capacity.value ? Number(f.capacity.value) : null });
      if (roomError) { window.alert(roomError.message); return; }
      renderCalendarTab();
    });
  });

  container.querySelector('[data-action="subscribe"]')?.addEventListener('click', async () => {
    let { data: tok } = await supabase.from('calendar_feed_tokens').select('token').maybeSingle();
    if (!tok) {
      const { data: created } = await supabase.from('calendar_feed_tokens').insert({ created_by: user.id }).select('token').single();
      tok = created;
    }
    const url = `${SUPABASE_URL}/functions/v1/calendar-feed?token=${tok?.token || ''}`;
    panel.innerHTML = `
      <div class="bg-white rounded-xl shadow p-4 mb-4 space-y-2">
        <p class="font-semibold text-sm">${t('calendar.subscribe')}</p>
        <p class="text-sm text-slate-600">${t('calendar.subscribeHelp')}</p>
        <div class="flex gap-2"><input readonly value="${escapeHtml(url)}" class="flex-1 min-w-0 border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-slate-50">
          <button type="button" data-action="copy" class="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs">${t('guestCheckinQr.copyLink')}</button></div>
        <button type="button" data-action="reset" class="text-xs text-rose-600 hover:underline">${t('calendar.resetLink')}</button>
      </div>`;
    panel.querySelector('[data-action="copy"]').addEventListener('click', () => navigator.clipboard?.writeText(url));
    panel.querySelector('[data-action="reset"]').addEventListener('click', async () => {
      if (!window.confirm(t('calendar.resetConfirm'))) return;
      await supabase.from('calendar_feed_tokens').delete().not('tenant_id', 'is', null);
      container.querySelector('[data-action="subscribe"]').click();
    });
  });
}
