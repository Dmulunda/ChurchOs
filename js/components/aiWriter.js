// "✨ AI" writing helper next to a textarea (feature 12, edge function
// supabase/functions/ai-writer). Offers translate FR<->EN, polish, summary,
// or notes -> minutes, depending on `tasks`. Shown only when the server says
// this person may use it (one 'ping' per page load, cached). The result is
// never applied silently: it replaces the text only after the person clicks
// "Use this", and "Undo" puts the original back.
import { getEffectiveSupabase } from '../departments.js';
import { t, getLang } from '../i18n.js';

let allowedPromise = null;
function isAllowed() {
  if (!allowedPromise) {
    allowedPromise = getEffectiveSupabase().functions.invoke('ai-writer', { body: { task: 'ping' } })
      .then(({ data, error }) => !error && data?.allowed === true)
      .catch(() => false);
  }
  return allowedPromise;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

async function run(task, text) {
  const { data, error } = await getEffectiveSupabase().functions.invoke('ai-writer', { body: { task, text, locale: getLang() } });
  if (error) {
    let code = '';
    try { code = (await error.context?.json?.())?.error || ''; } catch { /* not JSON */ }
    throw new Error(code === 'DAILY_LIMIT' ? t('aiWriter.limit') : t('aiWriter.failed'));
  }
  return data;
}

// textarea: the field to read/replace. tasks: e.g. ['translate', 'polish'].
// For 'minutes', pass minutesTargets: { decisions: el, action_items: el } —
// the notes go back into `textarea`.
export async function attachAiWriter(textarea, tasks, { minutesTargets } = {}) {
  if (!textarea || !(await isAllowed())) return;
  const bar = document.createElement('div');
  bar.className = 'flex flex-wrap items-center gap-1 mt-1';
  bar.innerHTML = `<span class="text-xs text-slate-500">✨ ${t('aiWriter.label')}</span>
    ${tasks.map((k) => `<button type="button" data-ai="${k}" class="text-xs px-2 py-0.5 rounded-full border border-violet-200 text-violet-700 hover:bg-violet-50">${t(`aiWriter.task.${k}`)}</button>`).join('')}
    <span data-el="status" class="text-xs text-slate-500"></span>`;
  textarea.insertAdjacentElement('afterend', bar);
  const status = bar.querySelector('[data-el="status"]');
  const preview = document.createElement('div');
  bar.insertAdjacentElement('afterend', preview);

  bar.querySelectorAll('[data-ai]').forEach((btn) => btn.addEventListener('click', async () => {
    const text = textarea.value.trim();
    if (!text) { status.textContent = t('aiWriter.empty'); return; }
    bar.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    status.textContent = t('aiWriter.working');
    preview.innerHTML = '';
    try {
      const task = btn.dataset.ai;
      const data = await run(task, text);
      status.textContent = '';
      const shown = task === 'minutes'
        ? [data.notes, data.decisions && `${t('documents.decisions')}:\n${data.decisions}`, data.action_items && `${t('documents.actionItems')}:\n${data.action_items}`].filter(Boolean).join('\n\n')
        : data.text;
      preview.innerHTML = `<div class="mt-2 border border-violet-200 bg-violet-50 rounded-lg p-3">
        <p class="text-sm whitespace-pre-line">${escapeHtml(shown)}</p>
        <div class="flex gap-2 mt-2">
          <button type="button" data-use class="text-xs px-3 py-1 rounded-lg bg-violet-600 text-white">${t('aiWriter.use')}</button>
          <button type="button" data-discard class="text-xs px-3 py-1 rounded-lg border border-slate-300">${t('aiWriter.discard')}</button>
        </div>
        <p class="text-[11px] text-slate-500 mt-1">${t('aiWriter.check')}</p>
      </div>`;
      preview.querySelector('[data-discard]').addEventListener('click', () => { preview.innerHTML = ''; });
      preview.querySelector('[data-use]').addEventListener('click', () => {
        const before = { main: textarea.value, d: minutesTargets?.decisions?.value, a: minutesTargets?.action_items?.value };
        if (task === 'minutes') {
          textarea.value = data.notes;
          if (minutesTargets?.decisions && data.decisions) minutesTargets.decisions.value = data.decisions;
          if (minutesTargets?.action_items && data.action_items) minutesTargets.action_items.value = data.action_items;
        } else {
          textarea.value = data.text;
        }
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        preview.innerHTML = `<button type="button" data-undo class="mt-1 text-xs text-violet-700 underline">${t('aiWriter.undo')}</button>`;
        preview.querySelector('[data-undo]').addEventListener('click', () => {
          textarea.value = before.main;
          if (minutesTargets?.decisions) minutesTargets.decisions.value = before.d ?? '';
          if (minutesTargets?.action_items) minutesTargets.action_items.value = before.a ?? '';
          preview.innerHTML = '';
        });
      });
    } catch (e) {
      status.textContent = e.message;
    } finally {
      bar.querySelectorAll('button').forEach((b) => { b.disabled = false; });
    }
  }));
}
