// In-app "how do I use this" chat assistant, replacing the old PDF
// Help system. Role-awareness and data privacy are enforced
// STRUCTURALLY, not by prompting: this function has no database query
// tool at all -- its only inputs are (a) assistant_knowledge_base rows
// pre-filtered to the caller's own permission tiers (computed by
// get_my_assistant_audience_tiers(), which reuses the same
// is_pastoral_team()/is_church_admin()/can_manage_finance()/
// is_super_admin() helpers every RLS policy in this schema already
// relies on) and (b) the conversation itself. It cannot leak a case's
// contents because it's never given any way to fetch one, and it
// cannot describe an admin-only feature to a member because that
// knowledge row was excluded before the request was even built.
//
// Streams Anthropic's reply straight through to the browser (same
// generate-quiz/index.ts pattern: raw fetch, stream: true, SSE piped
// through unmodified) while ALSO tee-ing the stream through a
// TransformStream to accumulate the full reply text, so the complete
// assistant message can be saved to assistant_messages once the
// stream ends -- the client never has to report back what it
// received.
//
// Deploy: `supabase functions deploy ai-assistant`.
// Needs ANTHROPIC_API_KEY (and optionally ANTHROPIC_WORKSPACE_ID),
// same as generate-quiz. SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are
// provided automatically.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const HISTORY_LIMIT = 20;
const MAX_MESSAGE_LENGTH = 4000;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function buildSystemPrompt(knowledgeRows, locale) {
  const contentKey = locale === 'fr' ? 'content_fr' : 'content_en';
  const knowledgeBlock = knowledgeRows.length > 0
    ? knowledgeRows.map((r) => `## ${r.topic}\n${r[contentKey]}`).join('\n\n')
    : '(No reference material is available yet.)';
  const languageName = locale === 'fr' ? 'French' : 'English';
  return `You are the in-app help assistant for this church management app. You ONLY answer questions about how to use the app, based strictly on the reference material below -- it describes exactly the features available to this person; never mention or speculate about anything outside it, even if asked directly, since they may not have access to it. If asked anything unrelated to using this app, politely say you can only help with using the app, and nothing else. Keep answers short and practical. Always reply in ${languageName}.

# Reference material

${knowledgeBlock}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    if (!jwt) return json({ error: 'Missing authorization' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));

    const { data: { user: caller }, error: callerError } = await admin.auth.getUser(jwt);
    if (callerError || !caller) return json({ error: 'Invalid session' }, 401);

    // Scoped to the CALLER's own JWT (not service-role) so auth.uid()
    // resolves correctly inside get_my_assistant_audience_tiers()'s
    // reused permission helpers.
    const callerClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });

    const { data: callerProfile, error: profileError } = await admin.from('profiles').select('tenant_id').eq('id', caller.id).single();
    if (profileError || !callerProfile) return json({ error: 'Profile not found' }, 404);

    const body = await req.json();

    // Explicit tenant_id -- the column's own `default
    // current_tenant_id()` resolves off session/JWT claims, which the
    // service-role client has none of.
    const { data: conversation, error: conversationError } = await admin
      .from('assistant_conversations')
      .upsert({ user_id: caller.id, tenant_id: callerProfile.tenant_id }, { onConflict: 'user_id,tenant_id' })
      .select('id')
      .single();
    if (conversationError || !conversation) return json({ error: conversationError?.message || 'Could not open conversation' }, 500);

    if (body.clear) {
      const { error: clearError } = await admin.from('assistant_messages').delete().eq('conversation_id', conversation.id);
      if (clearError) return json({ error: clearError.message }, 500);
      return json({ status: 'cleared' });
    }

    const message = (body.message || '').trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!message) return json({ error: 'message is required' }, 400);
    const locale = body.locale === 'fr' ? 'fr' : 'en';

    const { data: tiers } = await callerClient.rpc('get_my_assistant_audience_tiers');
    const audienceTiers = Array.isArray(tiers) && tiers.length > 0 ? tiers : ['everyone'];

    const { error: insertUserError } = await admin.from('assistant_messages').insert({
      conversation_id: conversation.id,
      role: 'user',
      content: message,
    });
    if (insertUserError) return json({ error: insertUserError.message }, 500);

    // Service-role bypasses RLS entirely, including the restrictive
    // tenant_isolation policy -- tenant_id has to be filtered
    // explicitly here or this would return every tenant's knowledge
    // base rows.
    const [{ data: knowledgeRows }, { data: historyRows }] = await Promise.all([
      admin.from('assistant_knowledge_base').select('topic, content_en, content_fr').eq('tenant_id', callerProfile.tenant_id).in('audience', audienceTiers),
      admin.from('assistant_messages').select('role, content').eq('conversation_id', conversation.id).order('created_at', { ascending: false }).limit(HISTORY_LIMIT),
    ]);

    const messages = (historyRows || []).reverse().map((m) => ({ role: m.role, content: m.content }));

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY is not configured on this function' }, 500);
    const workspaceId = Deno.env.get('ANTHROPIC_WORKSPACE_ID');

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        ...(workspaceId ? { 'anthropic-workspace-id': workspaceId } : {}),
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 2048,
        system: buildSystemPrompt(knowledgeRows || [], locale),
        messages,
        stream: true,
      }),
    });

    if (!anthropicRes.ok) {
      const errBody = await anthropicRes.text();
      console.error(`Anthropic API error (HTTP ${anthropicRes.status}): ${errBody}`);
      return json({ error: `Assistant request failed: ${errBody}` }, 502);
    }

    // Pass each chunk straight through to the client (same SSE the
    // browser already knows how to read from lessonEditorModal.js's
    // quiz-generation flow) while also accumulating the full reply
    // text, so the complete message can be saved once the stream ends
    // -- the client never has to report back what it received.
    let buffer = '';
    let fullText = '';
    const decoder = new TextDecoder();
    const transform = new TransformStream({
      transform(chunk, controller) {
        controller.enqueue(chunk);
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
              fullText += event.delta.text;
            }
          } catch { /* partial/control line, ignore */ }
        }
      },
      async flush() {
        if (fullText.trim()) {
          await admin.from('assistant_messages').insert({
            conversation_id: conversation.id,
            role: 'assistant',
            content: fullText.trim(),
          });
        }
      },
    });

    anthropicRes.body.pipeTo(transform.writable);

    return new Response(transform.readable, {
      headers: { ...CORS_HEADERS, 'Content-Type': 'text/event-stream' },
    });
  } catch (err) {
    console.error('ai-assistant unexpected error:', err);
    return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, 500);
  }
});
