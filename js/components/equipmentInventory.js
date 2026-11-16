// Equipment & inventory.
//   * Department "Equipment" tab: one department's items. Media & Tech only
//     until sql/saas_platform/166 is applied; then every department.
//   * Church-wide "Inventory" page (pastoral team, needs 166): every
//     department's items, totals, overdue loans, repairs, maintenance due,
//     CSV export.
// With 166 applied, items also carry quantity, serial number, purchase
// date/value, warranty end, next maintenance date, a borrower name for people
// without an account, and a maintenance log. Without it, the original basic
// fields (sql/saas_platform/84) are used. RLS enforces who may do what.
import { getEffectiveSupabase, getActiveDepartment } from '../departments.js';
import { t, formatDate, formatMoney, departmentLabel } from '../i18n.js';
import { confirmDialog } from './confirmDialog.js';

const CONDITIONS = ['working', 'needs_repair', 'missing'];
const CONDITION_CLASSES = {
  working: 'bg-emerald-50 text-emerald-700',
  needs_repair: 'bg-amber-50 text-amber-700',
  missing: 'bg-rose-50 text-rose-700',
};
const MAINT_KINDS = ['check', 'repair', 'cleaning', 'replacement', 'other'];

let extendedPromise = null;
// true once sql 166 is applied (the extended columns exist).
export function equipmentExtendedAvailable() {
  if (!extendedPromise) {
    extendedPromise = getEffectiveSupabase().from('equipment_items').select('quantity').limit(1)
      .then(({ error }) => !error).catch(() => false);
  }
  return extendedPromise;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function deptName(d) {
  if (!d) return '';
  const label = departmentLabel(d.key);
  return !label || label.startsWith('department.') ? d.name || d.key : label;
}

function centsFromInput(v) {
  const n = Number(String(v || '').replace(',', '.').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && String(v).trim() !== '' ? Math.round(n * 100) : null;
}

export async function renderEquipmentInventoryTab() {
  const active = getActiveDepartment();
  const container = document.querySelector('#dept-equipment-content');
  container.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;
  if (!active) return;
  await renderEquipment(container, {
    departmentId: active.id,
    canManage: active.role === 'admin' || active.role === 'super_admin',
    rerender: renderEquipmentInventoryTab,
  });
}

// Church-wide page (pastoral team).
export async function probeInventoryPage() {
  if (!(await equipmentExtendedAvailable())) return { error: 'not installed' };
  const { data } = await getEffectiveSupabase().rpc('is_pastoral_team');
  return data ? { error: null } : { error: 'hidden' };
}

export async function renderInventoryPage() {
  const container = document.querySelector('#inventory-content');
  container.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;
  await renderEquipment(container, { departmentId: null, canManage: true, rerender: renderInventoryPage });
}

async function renderEquipment(container, { departmentId, canManage, rerender }) {
  const supabase = getEffectiveSupabase();
  const extended = await equipmentExtendedAvailable();
  const churchWide = !departmentId;
  const { data: { user } } = await supabase.auth.getUser();

  let query = supabase.from('equipment_items').select('*, borrower:profiles!borrowed_by ( full_name )').order('name');
  if (departmentId) query = query.eq('department_id', departmentId);
  const [{ data: items, error }, { data: departments }, { data: maint }] = await Promise.all([
    query,
    churchWide ? supabase.from('departments').select('id, key, name').order('name') : Promise.resolve({ data: [] }),
    extended ? supabase.from('equipment_maintenance').select('*').order('done_on', { ascending: false }).limit(2000) : Promise.resolve({ data: [] }),
  ]);
  if (error) {
    container.innerHTML = `<p class="text-rose-600">${t('equipment.loadFailed', { message: escapeHtml(error.message) })}</p>`;
    return;
  }
  const deptById = new Map((departments || []).map((d) => [d.id, d]));
  const maintByItem = new Map();
  (maint || []).forEach((m) => { if (!maintByItem.has(m.item_id)) maintByItem.set(m.item_id, []); maintByItem.get(m.item_id).push(m); });

  const today = iso(new Date());
  const soon = iso(new Date(Date.now() + 14 * 86400000));
  const isOverdue = (i) => (i.borrowed_by || i.borrower_name) && i.due_back_at && i.due_back_at < today;
  const maintDue = (i) => extended && i.next_maintenance_on && i.next_maintenance_on <= soon;
  const categories = [...new Set(items.map((i) => i.category).filter(Boolean))].sort();

  const totalValue = items.reduce((s, i) => s + (i.value_cents || 0) * (i.quantity ?? 1), 0);
  const summary = churchWide ? `
    <div class="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
      ${[[t('inventory.items'), items.reduce((s, i) => s + (i.quantity ?? 1), 0)],
         [t('inventory.value'), formatMoney(totalValue / 100)],
         [t('inventory.onLoanOverdue'), items.filter(isOverdue).length],
         [t('inventory.needsRepair'), items.filter((i) => i.condition !== 'working').length],
         [t('inventory.maintenanceDue'), items.filter(maintDue).length]]
        .map(([label, value]) => `<div class="bg-white rounded-xl shadow p-3"><p class="text-xs text-slate-500">${escapeHtml(label)}</p><p class="text-xl font-bold">${escapeHtml(String(value))}</p></div>`).join('')}
    </div>` : '';

  container.innerHTML = `
    ${summary}
    <div class="flex flex-wrap items-center gap-2 mb-3">
      <input data-el="q" type="search" placeholder="${t('inventory.search')}" class="flex-1 min-w-[10rem] border border-slate-300 rounded-lg px-3 py-1.5 text-sm">
      ${churchWide ? `<select data-el="dept" class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm"><option value="">${t('inventory.allDepartments')}</option>
        ${[...new Set(items.map((i) => i.department_id))].map((id) => deptById.get(id)).filter(Boolean).map((d) => `<option value="${d.id}">${escapeHtml(deptName(d))}</option>`).join('')}</select>` : ''}
      ${categories.length ? `<select data-el="cat" class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm"><option value="">${t('inventory.allCategories')}</option>${categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}</select>` : ''}
      <select data-el="state" class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
        <option value="">${t('inventory.allStates')}</option>
        <option value="attention">${t('inventory.needsAttention')}</option>
        <option value="loan">${t('inventory.onLoan')}</option>
      </select>
      ${churchWide ? `<button type="button" data-action="csv" class="px-3 py-1.5 rounded-lg border border-slate-300 text-sm">⬇ CSV</button>` : ''}
      ${canManage && !churchWide ? `<button type="button" data-action="add-item" class="px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">${t('equipment.add')}</button>` : ''}
    </div>
    <div data-el="form"></div>
    <div data-el="list" class="space-y-2"></div>`;

  const listEl = container.querySelector('[data-el="list"]');
  const formEl = container.querySelector('[data-el="form"]');
  const qEl = container.querySelector('[data-el="q"]');
  const deptEl = container.querySelector('[data-el="dept"]');
  const catEl = container.querySelector('[data-el="cat"]');
  const stateEl = container.querySelector('[data-el="state"]');

  function filtered() {
    const q = qEl.value.trim().toLowerCase();
    return items.filter((i) => {
      if (deptEl?.value && i.department_id !== deptEl.value) return false;
      if (catEl?.value && i.category !== catEl.value) return false;
      if (stateEl.value === 'attention' && !(i.condition !== 'working' || isOverdue(i) || maintDue(i))) return false;
      if (stateEl.value === 'loan' && !(i.borrowed_by || i.borrower_name)) return false;
      if (!q) return true;
      return [i.name, i.category, i.storage_location, i.serial_number, i.notes, i.borrower_name, i.borrower?.full_name].some((v) => v && String(v).toLowerCase().includes(q));
    });
  }

  function renderList() {
    const shown = filtered();
    if (!shown.length) { listEl.innerHTML = `<p class="text-sm text-slate-400">${items.length ? t('inventory.noMatch') : t('equipment.none')}</p>`; return; }
    listEl.innerHTML = shown.map((item) => {
      const overdue = isOverdue(item);
      const borrower = item.borrower?.full_name || item.borrower_name;
      const meta = [
        churchWide ? deptName(deptById.get(item.department_id)) : '',
        item.storage_location,
        extended && (item.quantity ?? 1) !== 1 ? `× ${item.quantity}` : '',
        extended && item.serial_number ? `S/N ${item.serial_number}` : '',
        extended && item.value_cents != null ? formatMoney(item.value_cents / 100) : '',
      ].filter(Boolean).map(escapeHtml).join(' · ');
      return `
        <div class="bg-white border border-slate-200 rounded-lg p-3" data-item-id="${item.id}">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="text-sm font-medium text-slate-700">${escapeHtml(item.name)} ${item.category ? `<span class="text-xs text-slate-400">(${escapeHtml(item.category)})</span>` : ''}</p>
              <p class="text-xs text-slate-500">${meta}</p>
              ${maintDue(item) ? `<p class="text-xs text-amber-700 mt-0.5">🔧 ${t('inventory.maintenanceOn', { date: formatDate(item.next_maintenance_on) })}</p>` : ''}
              ${extended && item.warranty_until && item.warranty_until >= today ? `<p class="text-xs text-slate-400 mt-0.5">${t('inventory.warrantyUntil', { date: formatDate(item.warranty_until) })}</p>` : ''}
            </div>
            <span class="shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${CONDITION_CLASSES[item.condition] || ''}">${t(`equipment.condition.${item.condition}`)}</span>
          </div>
          ${borrower ? `<p class="text-xs mt-1 ${overdue ? 'text-rose-600 font-medium' : 'text-slate-500'}">
              ${t('equipment.borrowedBy', { name: escapeHtml(borrower) })}${item.due_back_at ? ' — ' + t('equipment.dueBack', { date: formatDate(item.due_back_at) }) : ''}${overdue ? ` (${t('equipment.overdue')})` : ''}</p>` : ''}
          ${canManage ? `
            <div class="flex flex-wrap items-center gap-2 mt-2">
              <select data-el="condition" class="border border-slate-300 rounded-lg px-2 py-1 text-xs">
                ${CONDITIONS.map((c) => `<option value="${c}" ${item.condition === c ? 'selected' : ''}>${t(`equipment.condition.${c}`)}</option>`).join('')}
              </select>
              ${borrower
                ? `<button type="button" data-action="check-in" class="text-xs text-indigo-600 hover:text-indigo-700">${t('equipment.checkIn')}</button>`
                : `<button type="button" data-action="check-out" class="text-xs text-indigo-600 hover:text-indigo-700">${t('equipment.checkOut')}</button>`}
              ${extended ? `<button type="button" data-action="edit" class="text-xs text-slate-600 hover:text-slate-800">${t('common.edit')}</button>
                <button type="button" data-action="maint" class="text-xs text-slate-600 hover:text-slate-800">🔧 ${t('inventory.maintenance')} (${(maintByItem.get(item.id) || []).length})</button>` : ''}
              <button type="button" data-action="delete" class="text-xs text-rose-600 hover:text-rose-700 ml-auto">${t('equipment.delete')}</button>
            </div>` : (extended && (maintByItem.get(item.id) || []).length ? `<button type="button" data-action="maint" class="mt-2 text-xs text-slate-600">🔧 ${t('inventory.maintenance')} (${maintByItem.get(item.id).length})</button>` : '')}
          <div data-el="slot"></div>
        </div>`;
    }).join('');

    listEl.querySelectorAll('[data-item-id]').forEach((card) => {
      const id = card.dataset.itemId;
      const item = items.find((i) => i.id === id);
      const slot = card.querySelector('[data-el="slot"]');
      card.querySelector('[data-el="condition"]')?.addEventListener('change', async (e) => {
        const { error: err } = await supabase.from('equipment_items').update({ condition: e.target.value, updated_at: new Date().toISOString() }).eq('id', id);
        if (err) alert(err.message); else item.condition = e.target.value;
      });
      card.querySelector('[data-action="check-out"]')?.addEventListener('click', () => {
        slot.innerHTML = `
          <form class="mt-2 border-t border-slate-100 pt-2 flex flex-wrap items-end gap-2">
            ${extended ? `<label class="text-xs text-slate-600">${t('inventory.borrower')}<input name="who" maxlength="160" placeholder="${t('inventory.borrowerHint')}" class="mt-1 block border border-slate-300 rounded-lg px-2 py-1 text-sm"></label>` : ''}
            <label class="text-xs text-slate-600">${t('inventory.dueBackLabel')}<input name="due" type="date" class="mt-1 block border border-slate-300 rounded-lg px-2 py-1 text-sm"></label>
            <button type="submit" class="px-3 py-1 rounded-lg bg-indigo-600 text-white text-xs">${t('equipment.checkOut')}</button>
          </form>`;
        slot.querySelector('form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const who = e.target.elements.who?.value.trim();
          const row = { borrowed_at: new Date().toISOString(), due_back_at: e.target.elements.due.value || null, updated_at: new Date().toISOString() };
          if (who) Object.assign(row, { borrower_name: who, borrowed_by: null }); else Object.assign(row, { borrowed_by: user.id });
          const { error: err } = await supabase.from('equipment_items').update(row).eq('id', id);
          if (err) alert(err.message); else rerender();
        });
      });
      card.querySelector('[data-action="check-in"]')?.addEventListener('click', async () => {
        const row = { borrowed_by: null, borrowed_at: null, due_back_at: null, updated_at: new Date().toISOString() };
        if (extended) row.borrower_name = null;
        const { error: err } = await supabase.from('equipment_items').update(row).eq('id', id);
        if (err) alert(err.message); else rerender();
      });
      card.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
        const ok = await confirmDialog({ message: t('equipment.confirmDelete', { name: item.name }), danger: true });
        if (!ok) return;
        const { error: err } = await supabase.from('equipment_items').delete().eq('id', id);
        if (err) alert(err.message); else rerender();
      });
      card.querySelector('[data-action="edit"]')?.addEventListener('click', () => renderItemForm(item));
      card.querySelector('[data-action="maint"]')?.addEventListener('click', () => renderMaintenance(item, slot));
    });
  }

  function renderItemForm(item) {
    const field = (name, label, type = 'text', value = '') => `<label class="text-xs text-slate-600">${label}<input name="${name}" type="${type}" value="${escapeHtml(value ?? '')}" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"></label>`;
    formEl.innerHTML = `
      <form class="mb-4 border border-slate-200 rounded-lg p-4 bg-slate-50 grid sm:grid-cols-2 gap-2">
        ${field('name', t('inventory.name'), 'text', item?.name)}
        ${field('category', t('inventory.category'), 'text', item?.category)}
        ${field('storage_location', t('inventory.location'), 'text', item?.storage_location)}
        ${extended ? `
          ${field('quantity', t('inventory.quantity'), 'number', item?.quantity ?? 1)}
          ${field('serial_number', t('inventory.serial'), 'text', item?.serial_number)}
          ${field('value', t('inventory.valueEach'), 'text', item?.value_cents != null ? (item.value_cents / 100).toFixed(2) : '')}
          ${field('purchased_on', t('inventory.purchasedOn'), 'date', item?.purchased_on)}
          ${field('warranty_until', t('inventory.warranty'), 'date', item?.warranty_until)}
          ${field('next_maintenance_on', t('inventory.nextMaintenance'), 'date', item?.next_maintenance_on)}
          <label class="text-xs text-slate-600 sm:col-span-2">${t('inventory.notes')}<textarea name="notes" rows="2" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm">${escapeHtml(item?.notes || '')}</textarea></label>` : ''}
        <div class="sm:col-span-2 flex gap-2 items-center">
          <button type="submit" class="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">${t('equipment.save')}</button>
          <button type="button" data-action="cancel" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">${t('common.cancel')}</button>
          <span data-el="msg" class="text-sm text-rose-600"></span>
        </div>
      </form>`;
    const form = formEl.querySelector('form');
    form.querySelector('[data-action="cancel"]').addEventListener('click', () => { formEl.innerHTML = ''; });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = form.elements;
      const name = f.name.value.trim();
      if (!name) return;
      const row = {
        name,
        category: f.category.value.trim() || null,
        storage_location: f.storage_location.value.trim() || null,
        updated_at: new Date().toISOString(),
      };
      if (extended) Object.assign(row, {
        quantity: Math.max(0, Number(f.quantity.value) || 0),
        serial_number: f.serial_number.value.trim() || null,
        value_cents: centsFromInput(f.value.value),
        purchased_on: f.purchased_on.value || null,
        warranty_until: f.warranty_until.value || null,
        next_maintenance_on: f.next_maintenance_on.value || null,
        notes: f.notes.value.trim() || null,
      });
      const { error: err } = item
        ? await supabase.from('equipment_items').update(row).eq('id', item.id)
        : await supabase.from('equipment_items').insert({ ...row, department_id: departmentId });
      if (err) { form.querySelector('[data-el="msg"]').textContent = err.message; return; }
      rerender();
    });
    formEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function renderMaintenance(item, slot) {
    if (slot.innerHTML) { slot.innerHTML = ''; return; }
    const rows = maintByItem.get(item.id) || [];
    slot.innerHTML = `
      <div class="mt-2 border-t border-slate-100 pt-2">
        <ul class="space-y-1 mb-2">${rows.map((m) => `<li class="text-xs text-slate-600">${formatDate(m.done_on)} · ${t(`inventory.maintKind.${m.kind}`)}${m.cost_cents != null ? ` · ${formatMoney(m.cost_cents / 100)}` : ''}${m.notes ? ` — ${escapeHtml(m.notes)}` : ''}</li>`).join('') || `<li class="text-xs text-slate-400">${t('inventory.noMaintenance')}</li>`}</ul>
        ${canManage ? `<form class="flex flex-wrap items-end gap-2">
          <input name="done_on" type="date" value="${iso(new Date())}" class="border border-slate-300 rounded-lg px-2 py-1 text-xs">
          <select name="kind" class="border border-slate-300 rounded-lg px-2 py-1 text-xs">${MAINT_KINDS.map((k) => `<option value="${k}">${t(`inventory.maintKind.${k}`)}</option>`).join('')}</select>
          <input name="cost" placeholder="${t('inventory.cost')}" class="w-24 border border-slate-300 rounded-lg px-2 py-1 text-xs">
          <input name="notes" placeholder="${t('inventory.notes')}" class="flex-1 min-w-[8rem] border border-slate-300 rounded-lg px-2 py-1 text-xs">
          <label class="text-xs text-slate-600">${t('inventory.nextMaintenance')}<input name="next" type="date" class="ml-1 border border-slate-300 rounded-lg px-2 py-1 text-xs"></label>
          <button type="submit" class="px-3 py-1 rounded-lg bg-indigo-600 text-white text-xs">${t('inventory.addMaintenance')}</button>
        </form>` : ''}
      </div>`;
    slot.querySelector('form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target.elements;
      const { error: err } = await supabase.from('equipment_maintenance').insert({
        item_id: item.id, done_on: f.done_on.value, kind: f.kind.value,
        cost_cents: centsFromInput(f.cost.value), notes: f.notes.value.trim() || null, created_by: user.id,
      });
      if (err) { alert(err.message); return; }
      const update = { updated_at: new Date().toISOString(), next_maintenance_on: f.next.value || null };
      if (f.kind.value === 'repair' && item.condition === 'needs_repair') update.condition = 'working';
      await supabase.from('equipment_items').update(update).eq('id', item.id);
      rerender();
    });
  }

  container.querySelector('[data-action="add-item"]')?.addEventListener('click', () => renderItemForm(null));
  container.querySelector('[data-action="csv"]')?.addEventListener('click', () => {
    const header = ['department', 'name', 'category', 'quantity', 'location', 'condition', 'serial_number', 'value_each', 'purchased_on', 'warranty_until', 'next_maintenance_on', 'borrower', 'due_back'];
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = filtered().map((i) => [deptName(deptById.get(i.department_id)), i.name, i.category, i.quantity ?? 1, i.storage_location, i.condition, i.serial_number,
      i.value_cents != null ? (i.value_cents / 100).toFixed(2) : '', i.purchased_on, i.warranty_until, i.next_maintenance_on, i.borrower?.full_name || i.borrower_name, i.due_back_at].map(cell).join(','));
    const blob = new Blob(['﻿' + [header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `inventory-${iso(new Date())}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  [qEl, deptEl, catEl, stateEl].forEach((el) => el?.addEventListener(el === qEl ? 'input' : 'change', renderList));
  renderList();
}
