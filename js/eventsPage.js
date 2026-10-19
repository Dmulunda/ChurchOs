// Events tab — Phase 1: event creation, registrant list, CSV export,
// "message registrants". Not department-scoped navigation the way
// most tabs are (same unconditional placement as Training/Service
// Program/Tax) -- every signed-in member can see the list, but only
// an event's organizing department's own admin (or a Super Admin) can
// create/edit/manage one, mirrored by can_write_department() on the
// DB side (sql/saas_platform/79_events.sql) so this page's own
// show/hide of buttons is a convenience, not the real gate.
//
// Public registration happens entirely on the separate event.html/
// js/publicEvent.js page (no login) -- this tab is admin/member-facing
// only. QR *generation* reuses the same qrcode CDN import
// js/components/memberIdCard.js already uses; QR *scanning*/check-in
// is Phase 2 (deliberately not built here yet).
import { getEffectiveSupabase, getGlobalRole } from './departments.js';
import { getTenant } from './tenant.js';
import { confirmDialog } from './components/confirmDialog.js';
import { activateTab, invalidateTabCache } from './app.js';
import { openFlyerForEvent } from './flyersPage.js';
import { t } from './i18n.js';
import { publicPageUrl } from './utils/publicUrl.js';

export async function renderEventsTab() {
  const supabase = getEffectiveSupabase();
  const container = document.querySelector('#events-content');
  container.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    container.innerHTML = `<p class="text-slate-500">${t('scheduling.pleaseSignIn')}</p>`;
    return;
  }

  const isSuperAdmin = getGlobalRole() === 'super_admin';
  const [{ data: departments }, { data: myAdminDepts }] = await Promise.all([
    supabase.from('departments').select('id, key, name').order('name'),
    supabase.from('department_memberships').select('department_id').eq('user_id', user.id).eq('role', 'admin').eq('status', 'approved'),
  ]);
  const myAdminDeptIds = new Set((myAdminDepts || []).map((m) => m.department_id));
  const writableDepartments = isSuperAdmin ? (departments || []) : (departments || []).filter((d) => myAdminDeptIds.has(d.id));

  container.innerHTML = `
    <div class="flex items-center justify-between mb-4">
      <p class="text-sm text-slate-500">${t('events.intro')}</p>
      ${writableDepartments.length > 0 ? `<button type="button" data-action="new-event" class="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 whitespace-nowrap">${t('events.createEvent')}</button>` : ''}
    </div>
    <div data-el="form-area" class="mb-4"></div>
    <div data-el="list-area"></div>
    <div data-el="detail-area"></div>
  `;

  const formAreaEl = container.querySelector('[data-el="form-area"]');
  const listAreaEl = container.querySelector('[data-el="list-area"]');
  const detailAreaEl = container.querySelector('[data-el="detail-area"]');

  container.querySelector('[data-action="new-event"]')?.addEventListener('click', () => {
    renderEventForm(formAreaEl, { supabase, departments: writableDepartments, onSaved: () => { formAreaEl.innerHTML = ''; loadList(); } });
  });

  async function loadList() {
    listAreaEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;
    detailAreaEl.innerHTML = '';

    const { data: events, error } = await supabase
      .from('events')
      .select('id, title, start_at, visibility, capacity, price_cents, status, organizing_department_id, department:departments!organizing_department_id ( name )')
      .order('start_at', { ascending: false });

    if (error) {
      listAreaEl.innerHTML = `<p class="text-sm text-rose-600">${t('events.loadFailed', { message: error.message })}</p>`;
      return;
    }

    if ((events || []).length === 0) {
      listAreaEl.innerHTML = `<p class="text-sm text-slate-400">${t('events.none')}</p>`;
      return;
    }

    // One extra query for registrant counts -- small enough tables
    // (one row per event) that a per-event N+1 isn't worth avoiding
    // with a view just for this. Summed by party_size, not row count
    // -- a registration can be for more than one person.
    const counts = await Promise.all(events.map(async (e) => {
      const { data } = await supabase.from('event_registrations').select('party_size').eq('event_id', e.id).eq('status', 'confirmed');
      return (data || []).reduce((sum, r) => sum + r.party_size, 0);
    }));

    listAreaEl.innerHTML = `
      <div class="overflow-x-auto border border-slate-200 rounded-lg">
        <table class="w-full text-sm">
          <thead class="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th class="text-left px-3 py-2">${t('events.colTitle')}</th>
              <th class="text-left px-3 py-2">${t('events.colDepartment')}</th>
              <th class="text-left px-3 py-2">${t('events.colWhen')}</th>
              <th class="text-left px-3 py-2">${t('events.colVisibility')}</th>
              <th class="text-left px-3 py-2">${t('events.colPrice')}</th>
              <th class="text-right px-3 py-2">${t('events.colRegistered')}</th>
              <th class="text-left px-3 py-2"></th>
            </tr>
          </thead>
          <tbody data-el="rows"></tbody>
        </table>
      </div>
    `;
    const rowsEl = listAreaEl.querySelector('[data-el="rows"]');
    rowsEl.innerHTML = events.map((ev, i) => {
      const canManage = isSuperAdmin || myAdminDeptIds.has(ev.organizing_department_id);
      const isCancelled = ev.status === 'cancelled';
      return `
        <tr class="border-b border-slate-100 cursor-pointer hover:bg-slate-50 ${isCancelled ? 'opacity-50' : ''}" data-event-id="${ev.id}">
          <td class="px-3 py-2 font-medium text-slate-800">${escapeHtml(ev.title)}${isCancelled ? ` <span class="text-xs text-rose-600">(${t('events.cancelled')})</span>` : ''}</td>
          <td class="px-3 py-2 text-slate-600">${escapeHtml(ev.department?.name || '')}</td>
          <td class="px-3 py-2 text-slate-600 whitespace-nowrap">${new Date(ev.start_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</td>
          <td class="px-3 py-2 text-slate-600">${t(`events.visibility.${ev.visibility}`)}</td>
          <td class="px-3 py-2 text-slate-600">${formatPriceCents(ev.price_cents)}</td>
          <td class="px-3 py-2 text-right">${counts[i]}${ev.capacity != null ? ` / ${ev.capacity}` : ''}</td>
          <td class="px-3 py-2 text-right">${canManage ? `<span class="text-xs text-indigo-600 font-medium">${t('events.manage')} →</span>` : ''}</td>
        </tr>
      `;
    }).join('');

    rowsEl.querySelectorAll('[data-event-id]').forEach((tr) => {
      tr.addEventListener('click', () => {
        const ev = events.find((e) => e.id === tr.dataset.eventId);
        const canManage = isSuperAdmin || myAdminDeptIds.has(ev.organizing_department_id);
        renderEventDetail(detailAreaEl, { supabase, event: ev, canManage, departments: writableDepartments, onChanged: loadList });
      });
    });
  }

  loadList();
}

function renderEventForm(container, { supabase, departments, onSaved, existing }) {
  const isEdit = !!existing;
  container.innerHTML = `
    <div class="border border-slate-200 rounded-lg p-4 bg-slate-50 space-y-3">
      <div class="grid sm:grid-cols-2 gap-3">
        <div class="sm:col-span-2">
          <label class="block text-xs font-medium text-slate-600 mb-1">${t('events.fieldTitle')}</label>
          <input type="text" data-el="title" value="${escapeAttr(existing?.title || '')}" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div class="sm:col-span-2">
          <label class="block text-xs font-medium text-slate-600 mb-1">${t('events.fieldDescription')}</label>
          <textarea data-el="description" rows="3" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">${escapeHtml(existing?.description || '')}</textarea>
        </div>
        <div>
          <label class="block text-xs font-medium text-slate-600 mb-1">${t('events.fieldStart')}</label>
          <input type="datetime-local" data-el="start-at" value="${existing ? toLocalInputValue(existing.start_at) : ''}" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label class="block text-xs font-medium text-slate-600 mb-1">${t('events.fieldEnd')}</label>
          <input type="datetime-local" data-el="end-at" value="${existing?.end_at ? toLocalInputValue(existing.end_at) : ''}" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label class="block text-xs font-medium text-slate-600 mb-1">${t('events.fieldLocation')}</label>
          <input type="text" data-el="location" value="${escapeAttr(existing?.location || '')}" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label class="block text-xs font-medium text-slate-600 mb-1">${t('events.fieldOnlineLink')}</label>
          <input type="url" data-el="online-link" value="${escapeAttr(existing?.online_link || '')}" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label class="block text-xs font-medium text-slate-600 mb-1">${t('events.fieldDepartment')}</label>
          <select data-el="department" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            ${departments.map((d) => `<option value="${d.id}" ${existing?.organizing_department_id === d.id ? 'selected' : ''}>${escapeHtml(d.name)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="block text-xs font-medium text-slate-600 mb-1">${t('events.fieldVisibility')}</label>
          <select data-el="visibility" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="public" ${existing?.visibility === 'public' || !existing ? 'selected' : ''}>${t('events.visibility.public')}</option>
            <option value="members" ${existing?.visibility === 'members' ? 'selected' : ''}>${t('events.visibility.members')}</option>
          </select>
        </div>
        <div>
          <label class="block text-xs font-medium text-slate-600 mb-1">${t('events.fieldCapacity')}</label>
          <input type="number" min="1" data-el="capacity" value="${existing?.capacity ?? ''}" placeholder="${t('events.unlimited')}" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label class="block text-xs font-medium text-slate-600 mb-1">${t('events.fieldPrice')}</label>
          <input type="number" min="0" step="0.01" data-el="price" value="${existing?.price_cents ? (existing.price_cents / 100).toFixed(2) : ''}" placeholder="${t('events.free')}" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          <p class="text-xs text-slate-400 mt-1">${t('events.priceHint')}</p>
        </div>
        <div class="flex items-center gap-2 mt-5">
          <input type="checkbox" data-el="waitlist" ${existing?.waitlist_enabled ? 'checked' : ''} />
          <label class="text-sm text-slate-600">${t('events.fieldWaitlist')}</label>
        </div>
        <div class="sm:col-span-2">
          <label class="block text-xs font-medium text-slate-600 mb-1">${t('events.fieldDeadline')}</label>
          <input type="datetime-local" data-el="deadline" value="${existing?.registration_deadline ? toLocalInputValue(existing.registration_deadline) : ''}" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>

      <div>
        <label class="block text-xs font-medium text-slate-600 mb-1">${t('events.fieldQuestions')}</label>
        <p class="text-xs text-slate-400 mb-2">${t('events.fieldQuestionsHint')}</p>
        <div data-el="questions-list" class="space-y-1.5 mb-2"></div>
        <button type="button" data-action="add-question" class="text-xs text-indigo-600 hover:text-indigo-700 font-medium">${t('events.addQuestion')}</button>
      </div>

      <div class="flex items-center gap-2 pt-2">
        <button type="button" data-action="save" class="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">${isEdit ? t('events.saveChanges') : t('events.createEvent')}</button>
        <button type="button" data-action="cancel" class="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">${t('common.cancel')}</button>
        <span data-el="status" class="text-sm"></span>
      </div>
    </div>
  `;

  const questionsListEl = container.querySelector('[data-el="questions-list"]');
  let questions = (existing?.questions || []).map((q) => ({ ...q }));

  function renderQuestions() {
    questionsListEl.innerHTML = questions.map((q, i) => `
      <div class="flex items-center gap-2">
        <input type="text" data-question-index="${i}" value="${escapeAttr(q.question)}" placeholder="${t('events.questionPlaceholder')}" class="flex-1 border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
        <label class="flex items-center gap-1 text-xs text-slate-500 whitespace-nowrap">
          <input type="checkbox" data-question-required="${i}" ${q.required ? 'checked' : ''} /> ${t('events.required')}
        </label>
        <button type="button" data-remove-question="${i}" class="text-rose-500 hover:text-rose-700 text-sm">&times;</button>
      </div>
    `).join('');
    questionsListEl.querySelectorAll('[data-question-index]').forEach((input) => {
      input.addEventListener('input', () => { questions[Number(input.dataset.questionIndex)].question = input.value; });
    });
    questionsListEl.querySelectorAll('[data-question-required]').forEach((input) => {
      input.addEventListener('change', () => { questions[Number(input.dataset.questionRequired)].required = input.checked; });
    });
    questionsListEl.querySelectorAll('[data-remove-question]').forEach((btn) => {
      btn.addEventListener('click', () => { questions.splice(Number(btn.dataset.removeQuestion), 1); renderQuestions(); });
    });
  }
  renderQuestions();

  container.querySelector('[data-action="add-question"]').addEventListener('click', () => {
    questions.push({ question: '', required: false });
    renderQuestions();
  });
  container.querySelector('[data-action="cancel"]').addEventListener('click', () => { container.innerHTML = ''; });

  container.querySelector('[data-action="save"]').addEventListener('click', async () => {
    const statusEl = container.querySelector('[data-el="status"]');
    const title = container.querySelector('[data-el="title"]').value.trim();
    const startAtRaw = container.querySelector('[data-el="start-at"]').value;
    const departmentId = container.querySelector('[data-el="department"]').value;
    if (!title || !startAtRaw || !departmentId) {
      statusEl.className = 'text-sm text-rose-600';
      statusEl.textContent = t('events.titleStartDeptRequired');
      return;
    }

    const payload = {
      title,
      description: container.querySelector('[data-el="description"]').value.trim() || null,
      start_at: new Date(startAtRaw).toISOString(),
      end_at: toIsoOrNull(container.querySelector('[data-el="end-at"]').value),
      location: container.querySelector('[data-el="location"]').value.trim() || null,
      online_link: container.querySelector('[data-el="online-link"]').value.trim() || null,
      organizing_department_id: departmentId,
      visibility: container.querySelector('[data-el="visibility"]').value,
      capacity: container.querySelector('[data-el="capacity"]').value ? Number(container.querySelector('[data-el="capacity"]').value) : null,
      price_cents: container.querySelector('[data-el="price"]').value ? Math.round(Number(container.querySelector('[data-el="price"]').value) * 100) : null,
      waitlist_enabled: container.querySelector('[data-el="waitlist"]').checked,
      registration_deadline: toIsoOrNull(container.querySelector('[data-el="deadline"]').value),
    };

    statusEl.className = 'text-sm text-slate-500';
    statusEl.textContent = t('common.saving');

    let eventId = existing?.id;
    const { data: savedEvent, error } = eventId
      ? await supabase.from('events').update(payload).eq('id', eventId).select().single()
      : await supabase.from('events').insert(payload).select().single();

    if (error) {
      statusEl.className = 'text-sm text-rose-600';
      statusEl.textContent = t('events.saveFailed', { message: error.message });
      return;
    }
    eventId = savedEvent.id;

    // Simplest-correct question sync: delete whatever the event had,
    // insert the current list fresh -- a handful of rows per event, no
    // real cost to not diffing them individually.
    await supabase.from('event_questions').delete().eq('event_id', eventId);
    const validQuestions = questions.filter((q) => q.question.trim());
    if (validQuestions.length > 0) {
      await supabase.from('event_questions').insert(
        validQuestions.map((q, i) => ({ event_id: eventId, question: q.question.trim(), required: q.required, position: i }))
      );
    }

    onSaved();
  });
}

async function renderEventDetail(container, { supabase, event, canManage, departments, onChanged }) {
  container.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

  const [{ data: fullEvent }, { data: questions }, { data: registrations }] = await Promise.all([
    supabase.from('events').select('*').eq('id', event.id).single(),
    supabase.from('event_questions').select('id, question, required, position').eq('event_id', event.id).order('position'),
    supabase.from('event_registrations').select('id, full_name, email, phone, status, payment_status, party_size, additional_names, created_at').eq('event_id', event.id).order('created_at'),
  ]);

  const publicUrl = publicPageUrl('event.html', { event: event.id, church: getTenant()?.slug || '' });
  // Summed by party_size -- a registration can be for more than one
  // person, same reasoning as the capacity check in register_for_event().
  const confirmedCount = (registrations || []).filter((r) => r.status === 'confirmed').reduce((sum, r) => sum + r.party_size, 0);
  const waitlistedCount = (registrations || []).filter((r) => r.status === 'waitlisted').reduce((sum, r) => sum + r.party_size, 0);
  const isPriced = !!fullEvent.price_cents;
  const hasPartySizes = (registrations || []).some((r) => r.party_size > 1);

  container.innerHTML = `
    <div class="border-t border-slate-200 pt-4 mt-2">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-lg font-bold text-slate-800">${escapeHtml(fullEvent.title)}</h3>
        <button type="button" data-action="close-detail" class="text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
      </div>
      <div class="flex items-center gap-2 mb-3 flex-wrap">
        <input type="text" readonly value="${escapeAttr(publicUrl)}" class="flex-1 min-w-[200px] border border-slate-300 rounded-lg px-2 py-1.5 text-xs text-slate-600 bg-slate-50" />
        <button type="button" data-action="copy-link" class="px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-medium hover:bg-slate-200">${t('events.copyLink')}</button>
        ${canManage ? `
          <button type="button" data-action="edit" class="px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-medium hover:bg-slate-200">${t('events.edit')}</button>
          <button type="button" data-action="create-flyer" class="px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-medium hover:bg-slate-200">${t('events.createFlyer')}</button>
          ${fullEvent.status === 'active' ? `<button type="button" data-action="cancel-event" class="px-2.5 py-1.5 rounded-lg bg-rose-100 text-rose-700 text-xs font-medium hover:bg-rose-200">${t('events.cancelEvent')}</button>` : ''}
        ` : ''}
      </div>
      <p class="text-sm text-slate-600 mb-1">${t('events.summaryLine', { confirmed: confirmedCount, capacity: fullEvent.capacity ?? '∞', waitlisted: waitlistedCount })}</p>
      <p class="text-sm text-slate-600 mb-3">${t('events.priceLine', { price: formatPriceCents(fullEvent.price_cents) })}${isPriced ? ` — ${t('events.paymentNotCollectedYet')}` : ''}</p>
      <div data-el="edit-area" class="mb-3"></div>
      ${canManage ? `
        <div class="border border-slate-200 rounded-lg p-3 mb-4">
          <p class="text-sm font-semibold text-slate-700 mb-2">${t('events.messageRegistrants')}</p>
          <input type="text" data-el="message-subject" placeholder="${t('events.messageSubjectPlaceholder')}" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-2" />
          <textarea data-el="message-body" rows="3" placeholder="${t('events.messageBodyPlaceholder')}" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-2"></textarea>
          <div class="flex items-center gap-2">
            <button type="button" data-action="send-message" class="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">${t('events.send')}</button>
            <span data-el="message-status" class="text-sm"></span>
          </div>
        </div>
      ` : ''}
      ${canManage ? `<button type="button" data-action="export-csv" class="mb-3 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">${t('events.exportCsv')}</button>` : ''}
      <div class="overflow-x-auto border border-slate-200 rounded-lg">
        <table class="w-full text-sm">
          <thead class="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th class="text-left px-3 py-2">${t('events.colName')}</th>
              <th class="text-left px-3 py-2">${t('events.colEmail')}</th>
              <th class="text-left px-3 py-2">${t('events.colPhone')}</th>
              ${hasPartySizes ? `<th class="text-right px-3 py-2">${t('events.colPeople')}</th>` : ''}
              <th class="text-left px-3 py-2">${t('events.colStatus')}</th>
              ${isPriced ? `<th class="text-left px-3 py-2">${t('events.colPayment')}</th>` : ''}
              <th class="text-left px-3 py-2">${t('events.colRegisteredAt')}</th>
            </tr>
          </thead>
          <tbody>
            ${(registrations || []).length === 0 ? `<tr><td colspan="7" class="px-3 py-4 text-center text-slate-400">${t('events.noRegistrants')}</td></tr>` : (registrations || []).map((r) => `
              <tr class="border-b border-slate-100">
                <td class="px-3 py-2 font-medium text-slate-800">
                  ${escapeHtml(r.full_name)}
                  ${r.additional_names?.length ? `<div class="text-xs text-slate-400 font-normal">${t('events.plusGuests', { names: r.additional_names.map(escapeHtml).join(', ') })}</div>` : ''}
                </td>
                <td class="px-3 py-2 text-slate-600">${escapeHtml(r.email)}</td>
                <td class="px-3 py-2 text-slate-600">${escapeHtml(r.phone || '')}</td>
                ${hasPartySizes ? `<td class="px-3 py-2 text-right">${r.party_size}</td>` : ''}
                <td class="px-3 py-2">${t(`events.regStatus.${r.status}`)}</td>
                ${isPriced ? `<td class="px-3 py-2">${t(`events.paymentStatus.${r.payment_status}`)}</td>` : ''}
                <td class="px-3 py-2 text-slate-500">${new Date(r.created_at).toLocaleDateString()}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  container.querySelector('[data-action="close-detail"]').addEventListener('click', () => { container.innerHTML = ''; });
  container.querySelector('[data-action="copy-link"]').addEventListener('click', () => {
    navigator.clipboard?.writeText(publicUrl);
  });

  if (canManage) {
    container.querySelector('[data-action="edit"]').addEventListener('click', () => {
      renderEventForm(container.querySelector('[data-el="edit-area"]'), {
        supabase, departments, existing: { ...fullEvent, questions },
        onSaved: () => { onChanged(); },
      });
    });

    container.querySelector('[data-action="create-flyer"]').addEventListener('click', async () => {
      const createFlyerBtn = container.querySelector('[data-action="create-flyer"]');
      createFlyerBtn.disabled = true;
      const when = new Date(fullEvent.start_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
      const infoLine = [when, fullEvent.location].filter(Boolean).join(' · ');
      let qrDataUrl = null;
      try {
        const { toDataURL } = await import('https://cdn.jsdelivr.net/npm/qrcode@1.5.3/+esm');
        qrDataUrl = await toDataURL(publicUrl, { width: 240, margin: 1 });
      } catch { /* QR generation failed (offline, CDN blocked) -- flyer still opens without it */ }
      openFlyerForEvent({ eventId: event.id, category: null, title: fullEvent.title, infoLine, qrDataUrl });
      invalidateTabCache('flyers');
      activateTab('flyers');
    });

    const cancelBtn = container.querySelector('[data-action="cancel-event"]');
    cancelBtn?.addEventListener('click', async () => {
      const ok = await confirmDialog({ message: t('events.confirmCancel', { title: fullEvent.title }), danger: true });
      if (!ok) return;
      await supabase.from('events').update({ status: 'cancelled' }).eq('id', event.id);
      onChanged();
    });

    container.querySelector('[data-action="export-csv"]').addEventListener('click', () => {
      const rows = (registrations || []).map((r) => ({
        [t('events.colName')]: r.full_name,
        [t('events.colEmail')]: r.email,
        [t('events.colPhone')]: r.phone || '',
        ...(hasPartySizes ? { [t('events.colPeople')]: r.party_size, [t('events.colGuestNames')]: (r.additional_names || []).join(', ') } : {}),
        [t('events.colStatus')]: t(`events.regStatus.${r.status}`),
        ...(isPriced ? { [t('events.colPayment')]: t(`events.paymentStatus.${r.payment_status}`) } : {}),
        [t('events.colRegisteredAt')]: new Date(r.created_at).toLocaleString(),
      }));
      const ws = window.XLSX.utils.json_to_sheet(rows);
      const wb = window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(wb, ws, 'Registrants');
      window.XLSX.writeFile(wb, `${fullEvent.title.replace(/[^a-z0-9]+/gi, '-')}-registrants.xlsx`);
    });

    container.querySelector('[data-action="send-message"]').addEventListener('click', async () => {
      const statusEl = container.querySelector('[data-el="message-status"]');
      const subject = container.querySelector('[data-el="message-subject"]').value.trim();
      const message = container.querySelector('[data-el="message-body"]').value.trim();
      if (!subject || !message) {
        statusEl.className = 'text-sm text-rose-600';
        statusEl.textContent = t('events.subjectBodyRequired');
        return;
      }
      statusEl.className = 'text-sm text-slate-500';
      statusEl.textContent = t('common.saving');
      const { data, error } = await supabase.functions.invoke('event-emails', {
        body: { action: 'send_update', event_id: event.id, subject, message },
      });
      if (error || data?.error) {
        statusEl.className = 'text-sm text-rose-600';
        statusEl.textContent = data?.error || error?.message || '';
        return;
      }
      statusEl.className = 'text-sm text-emerald-600';
      statusEl.textContent = t('events.messageSent', { count: data.sent });
    });
  }
}

function formatPriceCents(cents) {
  return cents ? `$${(cents / 100).toFixed(2)}` : t('events.free');
}

function toLocalInputValue(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function toIsoOrNull(localValue) {
  return localValue ? new Date(localValue).toISOString() : null;
}
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
function escapeAttr(str) {
  return escapeHtml(str).replaceAll('"', '&quot;');
}
