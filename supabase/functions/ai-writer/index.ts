// AI writing helper for leaders (sql/saas_platform/162_ai_writer.sql).
//
// POST { task, text, locale }  (JWT required)
//   task 'ping'       -> { allowed } (no AI call; lets the UI decide to show the button)
//   task 'translate'  -> French <-> English (direction detected), same tone
//   task 'polish'     -> clearer, warmer announcement, same language, same facts
//   task 'minutes'    -> rough notes -> { notes, decisions, action_items }
//   task 'summary'    -> 3-5 sentence summary (e.g. of sermon notes)
// Replies { text } or, for 'minutes', { notes, decisions, action_items }.
//
// Who: the pastoral team and department admins/secretaries
// (is_church_leader(), checked with the caller's own JWT). Limit: 40 requests
// per person per 24 hours, logged in ai_usage_log with token counts.
// The model only sees the text the person sends; it has no database access.
//
// Deploy: `supabase functions deploy ai-writer`.
// Secrets: ANTHROPIC_API_KEY (already set for ai-assistant), optional
// ANTHROPIC_WORKSPACE_ID, optional AI_WRITER_MODEL (default claude-haiku-5-5).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const TASKS = ['ping', 'translate', 'polish', 'minutes', 'summary'];
const DAILY_LIMIT = 40;
const MAX_TEXT = 12000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

function systemPrompt(task: string, locale: string) {
  const lang = locale === 'fr' ? 'French' : 'English';
  const common = 'You help a church staff member with their writing. Work only with the text they give you. Never invent facts, names, dates, amounts or Bible references that are not in the text. Reply with the result only — no preamble, no quotation marks, no explanation.';
  switch (task) {
    case 'translate':
      return `${common} Translate the text: if it is in French, into English; otherwise into French (Canadian usage is welcome). Keep the meaning, tone, line breaks, names and Bible references. Use the usual name of each Bible book in the target language.`;
    case 'polish':
      return `${common} Rewrite the text as a clear, warm church announcement in the same language as the text. Keep every fact. Keep it about the same length or shorter. Plain text, no markdown headings.`;
    case 'summary':
      return `${common} Summarise the text in 3 to 5 sentences, in the same language as the text, for church members who missed it.`;
    case 'minutes':
      return `${common} Turn rough meeting notes into tidy minutes, in the same language as the notes (if unclear, ${lang}). Return ONLY a JSON object with three string fields: "notes" (a clean summary of the discussion, short paragraphs or "- " bullet lines), "decisions" (one decision per line, "- " bullets, empty string if none), "action_items" (one per line as "- who – what – by when", leaving out parts that are not in the notes; empty string if none).`;
    default:
      return common;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    if (!jwt) return json({ error: 'Missing authorization' }, 401);
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: { user }, error: userError } = await admin.auth.getUser(jwt);
    if (userError || !user) return json({ error: 'Invalid session' }, 401);

    const callerClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: isLeader, error: leaderError } = await callerClient.rpc('is_church_leader');
    const allowed = !leaderError && isLeader === true;

    const body = await req.json().catch(() => ({}));
    const task = String(body.task || '');
    if (!TASKS.includes(task)) return json({ error: 'Unknown task' }, 400);
    if (task === 'ping') return json({ allowed: allowed && !!Deno.env.get('ANTHROPIC_API_KEY') });
    if (!allowed) return json({ error: 'NOT_ALLOWED' }, 403);

    const text = String(body.text || '').trim().slice(0, MAX_TEXT);
    if (!text) return json({ error: 'text is required' }, 400);
    const locale = body.locale === 'fr' ? 'fr' : 'en';

    const { data: profile } = await admin.from('profiles').select('tenant_id').eq('id', user.id).single();
    if (!profile?.tenant_id) return json({ error: 'Profile not found' }, 404);

    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count } = await admin.from('ai_usage_log').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).gte('created_at', since);
    if ((count ?? 0) >= DAILY_LIMIT) return json({ error: 'DAILY_LIMIT' }, 429);

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY is not configured' }, 500);
    const workspaceId = Deno.env.get('ANTHROPIC_WORKSPACE_ID');

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        ...(workspaceId ? { 'anthropic-workspace-id': workspaceId } : {}),
      },
      body: JSON.stringify({
        model: Deno.env.get('AI_WRITER_MODEL') || 'claude-haiku-5-5',
        max_tokens: 2048,
        system: systemPrompt(task, locale),
        messages: [{ role: 'user', content: text }],
      }),
    });
    if (!res.ok) {
      console.error(`ai-writer Anthropic error ${res.status}: ${await res.text()}`);
      return json({ error: 'AI_FAILED' }, 502);
    }
    const out = await res.json();
    const reply = (out.content || []).filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('').trim();

    await admin.from('ai_usage_log').insert({
      tenant_id: profile.tenant_id,
      user_id: user.id,
      task,
      input_tokens: out.usage?.input_tokens ?? null,
      output_tokens: out.usage?.output_tokens ?? null,
    });

    if (task === 'minutes') {
      const match = reply.match(/\{[\s\S]*\}/);
      try {
        const parsed = JSON.parse(match ? match[0] : reply);
        return json({
          notes: String(parsed.notes || ''),
          decisions: String(parsed.decisions || ''),
          action_items: String(parsed.action_items || ''),
        });
      } catch {
        return json({ notes: reply, decisions: '', action_items: '' });
      }
    }
    return json({ text: reply });
  } catch (err) {
    console.error('ai-writer unexpected error:', err);
    return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, 500);
  }
});
