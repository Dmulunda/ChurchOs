// In-app "how do I use this" chat assistant -- replaces the old
// PDF-upload Help modal. One continuous conversation per user,
// reloaded on open so a refresh doesn't lose it. Streams the reply
// using the exact same fetch+reader+SSE-line-parse pattern
// lessonEditorModal.js's generateQuiz() already established
// (supabase.functions.invoke() can't expose a streaming body), just
// appending each delta straight into the newest bubble instead of
// tracking a progress percentage.
import { t, getLang } from '../i18n.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../supabaseClient.js';
import { confirmDialog } from './confirmDialog.js';

export function createAssistantModal({ supabase, currentUserId }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-lg h-[80vh] flex flex-col">
      <div class="flex items-center justify-between p-4 border-b border-slate-200">
        <h2 class="text-lg font-bold">${t('assistant.title')}</h2>
        <div class="flex items-center gap-3">
          <button type="button" data-action="clear" class="text-xs text-slate-400 hover:text-rose-600">${t('assistant.clear')}</button>
          <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
        </div>
      </div>
      <div data-el="messages" class="flex-1 overflow-y-auto p-4 space-y-3"></div>
      <form data-el="form" class="p-3 border-t border-slate-200 flex gap-2">
        <textarea data-el="input" rows="1" placeholder="${t('assistant.placeholder')}"
                  class="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300"></textarea>
        <button type="submit" data-el="send-btn" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
          ${t('assistant.send')}
        </button>
      </form>
    </div>
  `;
  document.body.appendChild(root);

  const messagesEl = root.querySelector('[data-el="messages"]');
  const form = root.querySelector('[data-el="form"]');
  const inputEl = root.querySelector('[data-el="input"]');
  const sendBtn = root.querySelector('[data-el="send-btn"]');

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  root.querySelector('[data-action="clear"]').addEventListener('click', handleClear);
  form.addEventListener('submit', handleSubmit);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  function renderEmptyState() {
    messagesEl.innerHTML = `<p class="text-sm text-slate-400 text-center mt-4">${t('assistant.emptyState')}</p>`;
  }

  function appendBubble(role, text) {
    const emptyState = messagesEl.querySelector('p');
    if (emptyState) messagesEl.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = `flex ${role === 'user' ? 'justify-end' : 'justify-start'}`;
    const bubble = document.createElement('div');
    bubble.className = `max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${role === 'user' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-800'}`;
    bubble.textContent = text;
    wrap.appendChild(bubble);
    messagesEl.appendChild(wrap);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return bubble;
  }

  async function loadHistory() {
    messagesEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;
    const { data: convo } = await supabase.from('assistant_conversations').select('id').eq('user_id', currentUserId).maybeSingle();
    if (!convo) { renderEmptyState(); return; }
    const { data: msgs } = await supabase.from('assistant_messages').select('role, content').eq('conversation_id', convo.id).order('created_at', { ascending: true });
    if (!msgs || msgs.length === 0) { renderEmptyState(); return; }
    messagesEl.innerHTML = '';
    msgs.forEach((m) => appendBubble(m.role, m.content));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = '';
    inputEl.disabled = true;
    sendBtn.disabled = true;

    appendBubble('user', text);
    const assistantBubble = appendBubble('assistant', t('assistant.thinking'));
    assistantBubble.classList.add('text-slate-400');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch(`${SUPABASE_URL}/functions/v1/ai-assistant`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: text, locale: getLang() }),
      });

      if (!response.ok) {
        let message = `HTTP ${response.status}`;
        try { message = (await response.json())?.error || message; } catch { /* body wasn't JSON */ }
        assistantBubble.classList.remove('text-slate-400');
        assistantBubble.classList.add('text-rose-600');
        assistantBubble.textContent = t('assistant.failed', { message });
        return;
      }

      let firstChunk = true;
      let streamError = null;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // last line may be incomplete -- carried into the next chunk
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let event;
          try { event = JSON.parse(line.slice(6)); } catch { continue; }
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            if (firstChunk) {
              assistantBubble.classList.remove('text-slate-400');
              assistantBubble.textContent = '';
              firstChunk = false;
            }
            assistantBubble.textContent += event.delta.text;
            messagesEl.scrollTop = messagesEl.scrollHeight;
          } else if (event.type === 'error') {
            streamError = event.error?.message || 'Unknown streaming error';
          }
        }
      }
      if (streamError) {
        assistantBubble.classList.add('text-rose-600');
        assistantBubble.textContent = t('assistant.failed', { message: streamError });
      }
    } catch (err) {
      assistantBubble.classList.remove('text-slate-400');
      assistantBubble.classList.add('text-rose-600');
      assistantBubble.textContent = t('assistant.failed', { message: err.message });
    } finally {
      inputEl.disabled = false;
      sendBtn.disabled = false;
      inputEl.focus();
    }
  }

  async function handleClear() {
    if (!(await confirmDialog({ message: t('assistant.confirmClear'), danger: true }))) return;
    const { data: { session } } = await supabase.auth.getSession();
    await fetch(`${SUPABASE_URL}/functions/v1/ai-assistant`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ clear: true }),
    });
    renderEmptyState();
  }

  function open() {
    root.classList.remove('hidden');
    root.classList.add('flex');
    loadHistory();
    inputEl.focus();
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  return { open, root };
}
