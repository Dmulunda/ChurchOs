// Sunday School check-in (sql/saas_platform/152_child_checkin.sql).
// Drop-off: tap a child -> checkin_child() returns a 4-character pick-up
// code to give the parent (allergies/medical notes shown in red).
// Pick-up: "Check out" -> type the parent's code -> checkout_child()
// refuses a wrong code. Today's list shows who is still in the room.
import { getEffectiveSupabase } from './departments.js';
import { t, appLocale } from './i18n.js';

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

export async function renderChildCheckinTab() {
  const supabase = getEffectiveSupabase();
  const container = document.querySelector('#child-checkin-content');
  container.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(new Date());

  const [{ data: children, error }, { data: checkins }] = await Promise.all([
    supabase.from('ecodem_children').select('id, full_name, allergies, medical_notes, parent_name, parent_phone').order('full_name'),
    supabase.from('child_checkins').select('*').eq('checkin_date', today),
  ]);
  if (error || !checkins) { container.innerHTML = `<p class="text-slate-500">${t('childCheckin.notInstalled')}</p>`; return; }

  const byChild = new Map(checkins.map((c) => [c.child_id, c]));
  const inRoom = checkins.filter((c) => !c.checked_out_at).length;
  const fmtTime = (iso) => new Date(iso).toLocaleTimeString(appLocale(), { hour: '2-digit', minute: '2-digit' });

  container.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
      <p class="text-sm text-slate-600">${t('childCheckin.inRoom', { count: inRoom })}</p>
      <input data-el="search" type="search" placeholder="${t('common.search')}" class="border border-slate-300 rounded-lg px-3 py-2 text-sm w-full sm:w-64">
    </div>
    <div data-el="banner"></div>
    <div data-el="list" class="space-y-2">
      ${(children || []).length === 0 ? `<p class="text-sm text-slate-500">${t('childCheckin.noChildren')}</p>` : children.map((c) => {
        const ci = byChild.get(c.id);
        const state = !ci ? 'out' : (ci.checked_out_at ? 'gone' : 'in');
        const alert = [c.allergies, c.medical_notes].filter(Boolean).join(' · ');
        return `
        <div data-row data-name="${escapeHtml(c.full_name.toLowerCase())}" class="bg-white rounded-xl shadow p-3 flex flex-wrap items-center gap-3">
          <div class="flex-1 min-w-[12rem]">
            <p class="font-medium">${escapeHtml(c.full_name)}</p>
            ${alert ? `<p class="text-xs font-semibold text-rose-600">⚠️ ${escapeHtml(alert)}</p>` : ''}
            <p class="text-xs text-slate-500">${escapeHtml([c.parent_name, c.parent_phone].filter(Boolean).join(' · '))}</p>
          </div>
          ${state === 'out' ? `<button type="button" data-checkin="${c.id}" class="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium">${t('childCheckin.checkIn')}</button>` : ''}
          ${state === 'in' ? `<span class="text-xs text-slate-500">${t('childCheckin.inSince', { time: fmtTime(ci.checked_in_at) })}</span>
            <button type="button" data-checkout="${ci.id}" data-name="${escapeHtml(c.full_name)}" class="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium">${t('childCheckin.checkOut')}</button>` : ''}
          ${state === 'gone' ? `<span class="text-xs text-slate-500">${t('childCheckin.pickedUp', { time: fmtTime(ci.checked_out_at), who: ci.picked_up_by || '—' })}</span>
            <button type="button" data-checkin="${c.id}" class="px-3 py-1.5 rounded-lg border border-slate-300 text-xs">${t('childCheckin.checkInAgain')}</button>` : ''}
        </div>`;
      }).join('')}
    </div>`;

  const banner = container.querySelector('[data-el="banner"]');
  container.querySelector('[data-el="search"]').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    container.querySelectorAll('[data-row]').forEach((row) => row.classList.toggle('hidden', q && !row.dataset.name.includes(q)));
  });

  container.querySelectorAll('[data-checkin]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    const { data, error: ciError } = await supabase.rpc('checkin_child', { p_child_id: b.dataset.checkin });
    const row = Array.isArray(data) ? data[0] : data;
    if (ciError || !row) { banner.innerHTML = `<p class="mb-3 text-sm text-rose-600">${escapeHtml(ciError?.message || t('commHub.errorSend'))}</p>`; b.disabled = false; return; }
    const child = children.find((c) => c.id === b.dataset.checkin);
    await renderChildCheckinTab();
    container.querySelector('[data-el="banner"]').innerHTML = `
      <div class="mb-3 rounded-xl border-2 border-emerald-400 bg-emerald-50 p-4 text-center">
        <p class="text-sm text-emerald-800">${t('childCheckin.codeFor', { name: escapeHtml(child?.full_name || '') })}</p>
        <p class="text-5xl font-black tracking-[0.3em] text-emerald-900 my-2">${escapeHtml(row.security_code)}</p>
        <p class="text-xs text-emerald-700">${t('childCheckin.codeHint')}</p>
      </div>`;
  }));

  container.querySelectorAll('[data-checkout]').forEach((b) => b.addEventListener('click', () => {
    banner.innerHTML = `
      <form class="mb-3 bg-white rounded-xl shadow p-4 space-y-2 border-2 border-indigo-300">
        <p class="font-medium">${t('childCheckin.checkOutTitle', { name: b.dataset.name })}</p>
        <input name="code" required maxlength="4" autocomplete="off" placeholder="${t('childCheckin.codePlaceholder')}" class="w-full text-center text-2xl tracking-[0.3em] uppercase border border-slate-300 rounded-lg px-3 py-2">
        <input name="who" maxlength="120" placeholder="${t('childCheckin.whoPlaceholder')}" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
        <p data-el="msg" class="text-sm text-rose-600"></p>
        <div class="flex gap-2"><button type="submit" class="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium">${t('childCheckin.release')}</button>
          <button type="button" data-action="cancel" class="px-4 py-2 rounded-lg border border-slate-300 text-sm">${t('common.cancel')}</button></div>
      </form>`;
    const form = banner.querySelector('form');
    form.elements.code.focus();
    form.querySelector('[data-action="cancel"]').addEventListener('click', () => { banner.innerHTML = ''; });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const { error: coError } = await supabase.rpc('checkout_child', { p_checkin_id: b.dataset.checkout, p_code: form.elements.code.value, p_picked_up_by: form.elements.who.value });
      if (coError) {
        form.querySelector('[data-el="msg"]').textContent = coError.message.includes('WRONG_CODE') ? t('childCheckin.wrongCode') : coError.message;
        return;
      }
      renderChildCheckinTab();
    });
  }));
}
