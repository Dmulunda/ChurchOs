// Communication hub (sql/saas_platform/146_communication_hub.sql): one
// composer to message the whole church or chosen departments by app,
// phone push, email, SMS and WhatsApp. All sending and all permission
// checks happen in the broadcast edge function; this modal only shows
// the channels the server reports as set up (SMS/WhatsApp stay greyed
// out until Twilio is configured) and the audiences the caller may use.
import { t, departmentLabel, appLocale } from '../i18n.js';
import { attachAiWriter } from './aiWriter.js';

const CHANNELS = ['in_app', 'push', 'email', 'sms', 'whatsapp'];

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

export function createCommunicationHubModal({ supabase }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-start sm:items-center justify-center bg-black/50 p-4 overflow-y-auto';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-lg my-8">
      <div class="flex items-center justify-between px-5 pt-5">
        <h2 class="text-xl font-bold">📣 ${t('commHub.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <div class="flex gap-1 px-5 mt-3 border-b border-slate-100">
        <button type="button" data-tab="compose" class="px-3 py-2 text-sm font-medium border-b-2">${t('commHub.compose')}</button>
        <button type="button" data-tab="history" class="px-3 py-2 text-sm font-medium border-b-2">${t('commHub.history')}</button>
      </div>
      <div data-el="body" class="p-5"></div>
    </div>`;
  document.body.appendChild(root);
  const bodyEl = root.querySelector('[data-el="body"]');

  root.querySelector('[data-action="close"]').addEventListener('click', close);
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

  function setTabStyles(name) {
    root.querySelectorAll('[data-tab]').forEach((b) => {
      const on = b.dataset.tab === name;
      b.classList.toggle('border-indigo-600', on);
      b.classList.toggle('text-indigo-700', on);
      b.classList.toggle('border-transparent', !on);
      b.classList.toggle('text-slate-500', !on);
    });
  }

  async function showTab(name) {
    setTabStyles(name);
    if (name === 'history') return renderHistory();
    return renderCompose();
  }

  async function renderCompose() {
    bodyEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;
    const [{ data: caps, error: capsError }, { data: departments }] = await Promise.all([
      supabase.functions.invoke('broadcast', { body: { action: 'capabilities' } }),
      supabase.from('departments').select('id, key, name').order('name'),
    ]);
    if (capsError || !caps) {
      bodyEl.innerHTML = `<p class="text-sm text-slate-600">${t('commHub.notInstalled')}</p>`;
      return;
    }
    const allowedDeptIds = new Set(caps.department_ids || []);
    const deptOptions = (departments || []).filter((d) => caps.church_wide || allowedDeptIds.has(d.id));
    if (!caps.church_wide && deptOptions.length === 0) {
      bodyEl.innerHTML = `<p class="text-sm text-slate-600">${t('commHub.noAudience')}</p>`;
      return;
    }

    bodyEl.innerHTML = `
      <form class="space-y-4">
        <div>
          <p class="text-sm font-medium text-slate-700 mb-1">${t('commHub.to')}</p>
          ${caps.church_wide ? `
          <label class="flex items-center gap-2 text-sm"><input type="radio" name="audience" value="church" checked> ${t('commHub.wholeChurch')}</label>
          <label class="flex items-center gap-2 text-sm"><input type="radio" name="audience" value="departments"> ${t('commHub.someDepartments')}</label>` : '<input type="hidden" name="audience" value="departments">'}
          <div data-el="dept-list" class="${caps.church_wide ? 'hidden' : ''} mt-2 grid grid-cols-2 gap-1 max-h-40 overflow-y-auto border border-slate-200 rounded-lg p-2">
            ${deptOptions.map((d) => `<label class="flex items-center gap-2 text-sm"><input type="checkbox" name="dept" value="${d.id}"> ${escapeHtml(departmentLabel(d.key) || d.name)}</label>`).join('')}
          </div>
        </div>
        <div class="space-y-2">
          <input name="title" maxlength="150" required placeholder="${t('commHub.titlePlaceholder')}" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
          <textarea name="body" rows="5" maxlength="2000" required placeholder="${t('commHub.bodyPlaceholder')}" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"></textarea>
          <p class="text-xs text-slate-400">${t('commHub.bilingualHint')}</p>
        </div>
        <div>
          <p class="text-sm font-medium text-slate-700 mb-1">${t('commHub.channels')}</p>
          <div class="grid grid-cols-2 gap-1">
            ${CHANNELS.map((c) => `
              <label class="flex items-center gap-2 text-sm ${caps.channels[c] ? '' : 'text-slate-400'}">
                <input type="checkbox" name="channel" value="${c}" ${caps.channels[c] ? '' : 'disabled'} ${c === 'in_app' ? 'checked' : ''}>
                ${t(`commHub.channel.${c}`)}${caps.channels[c] ? '' : ` <span class="text-[11px]">(${t('commHub.notSetUp')})</span>`}
              </label>`).join('')}
          </div>
          ${!caps.channels.sms || !caps.channels.whatsapp ? `<p class="text-xs text-slate-400 mt-1">${t('commHub.smsHint')}</p>` : ''}
        </div>
        <p data-el="msg" class="hidden text-sm"></p>
        <button type="submit" class="w-full py-2.5 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">${t('commHub.send')}</button>
      </form>`;

    const form = bodyEl.querySelector('form');
    attachAiWriter(form.elements.body, ['translate', 'polish']);
    const deptListEl = form.querySelector('[data-el="dept-list"]');
    form.querySelectorAll('input[name="audience"]').forEach((r) => r.addEventListener('change', () => {
      deptListEl.classList.toggle('hidden', form.elements.audience.value !== 'departments');
    }));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msgEl = form.querySelector('[data-el="msg"]');
      const audience = form.elements.audience.value;
      const department_ids = [...form.querySelectorAll('input[name="dept"]:checked')].map((i) => i.value);
      const channels = [...form.querySelectorAll('input[name="channel"]:checked')].map((i) => i.value);
      const showMsg = (text, ok) => { msgEl.textContent = text; msgEl.className = `text-sm ${ok ? 'text-emerald-600' : 'text-rose-600'}`; };
      if (audience === 'departments' && department_ids.length === 0) return showMsg(t('commHub.errorDept'), false);
      if (channels.length === 0) return showMsg(t('commHub.errorChannel'), false);
      const audienceText = audience === 'church' ? t('commHub.wholeChurch') : t('commHub.departmentsCount', { count: department_ids.length });
      if (!window.confirm(t('commHub.confirm', { audience: audienceText }))) return;

      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      const { data, error } = await supabase.functions.invoke('broadcast', {
        body: { action: 'send', audience, department_ids, channels, title: form.elements.title.value, body: form.elements.body.value },
      });
      btn.disabled = false;
      if (error || !data || data.error) return showMsg(t('commHub.errorSend'), false);
      showMsg(t('commHub.sent', { count: data.recipients }), true);
      form.elements.title.value = '';
      form.elements.body.value = '';
    });
  }

  async function renderHistory() {
    bodyEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;
    const { data, error } = await supabase.from('broadcasts')
      .select('id, title, body, audience, channels, recipient_count, results, created_at, sender:profiles!broadcasts_created_by_fkey ( full_name )')
      .order('created_at', { ascending: false }).limit(50);
    if (error) { bodyEl.innerHTML = `<p class="text-sm text-slate-600">${t('commHub.notInstalled')}</p>`; return; }
    if (!data.length) { bodyEl.innerHTML = `<p class="text-sm text-slate-500">${t('commHub.noHistory')}</p>`; return; }
    bodyEl.innerHTML = `<div class="space-y-3">${data.map((b) => `
      <div class="border border-slate-200 rounded-lg p-3">
        <div class="flex justify-between gap-2">
          <p class="font-medium text-sm">${escapeHtml(b.title)}</p>
          <span class="text-xs text-slate-400 whitespace-nowrap">${escapeHtml(new Date(b.created_at).toLocaleString(appLocale(), { dateStyle: 'medium', timeStyle: 'short' }))}</span>
        </div>
        <p class="text-xs text-slate-500 mt-0.5">${escapeHtml(b.sender?.full_name || '')} · ${b.audience === 'church' ? t('commHub.wholeChurch') : t('commHub.someDepartments')} · ${t('commHub.recipients', { count: b.recipient_count })}</p>
        <p class="text-sm text-slate-600 mt-1 whitespace-pre-line line-clamp-3">${escapeHtml(b.body)}</p>
        <p class="text-xs text-slate-500 mt-1">${b.channels.map((c) => `${t(`commHub.channel.${c}`)}: ${b.results?.[c]?.sent ?? 0}`).join(' · ')}</p>
      </div>`).join('')}</div>`;
  }

  function open() {
    root.classList.remove('hidden');
    root.classList.add('flex');
    showTab('compose');
  }
  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }
  return { open, close, root };
}
