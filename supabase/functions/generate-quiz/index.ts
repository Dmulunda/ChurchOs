// Auto-generates a lesson quiz (7 multiple-choice + 3 true/false,
// matching lessonEditorModal.js's fixed spec exactly) from pasted
// source text, via the Claude API. Must run server-side: the
// Anthropic API key is a secret that can never ship to the browser.
//
// Streams Anthropic's response straight through to the browser
// (rather than buffering the whole thing and returning JSON at the
// end) so lessonEditorModal.js can show real generation progress —
// this function does no parsing/validation of the output itself
// anymore, that all happens client-side once the stream ends.
//
// Deploy: Supabase Dashboard -> Edge Functions -> deploy this file as
// "generate-quiz" (or `supabase functions deploy generate-quiz`).
// Needs two secrets set manually — Dashboard -> Edge Functions ->
// generate-quiz -> Secrets:
//   ANTHROPIC_API_KEY (from console.anthropic.com)
//   ANTHROPIC_WORKSPACE_ID — only required if that key is an
//     identity-linked key (tied to your account across workspaces
//     rather than to one workspace); Anthropic returns
//     "anthropic-workspace-id is required..." if it's missing and
//     needed. Find it in console.anthropic.com -> Settings -> Workspaces
//     (looks like "wrkspc_...").
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are already provided
// automatically to every function.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MC_COUNT = 7;
const TF_COUNT = 3;

const SYSTEM_PROMPT = `You are a quiz-writing assistant for a church training course. Given source text, write a quiz based ONLY on facts and ideas actually present in that text.

Produce exactly ${MC_COUNT} multiple-choice questions, each with exactly 4 answer options where exactly one is correct, followed by exactly ${TF_COUNT} true/false questions.

Respond with ONLY a JSON object — no markdown fences, no commentary before or after — matching exactly this shape:
{"questions": [
  {"type": "multiple_choice", "question_text": "...", "options": ["...", "...", "...", "..."], "correct_answer": "<the exact text of the correct option, copied verbatim from options>"},
  ... ${MC_COUNT} of these ...
  {"type": "true_false", "question_text": "...", "correct_answer": "true"},
  ... ${TF_COUNT} of these ...
]}`;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    if (!jwt) return json({ error: 'Missing authorization' }, 401);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    );

    const { data: { user: caller }, error: callerError } = await admin.auth.getUser(jwt);
    if (callerError || !caller) return json({ error: 'Invalid session' }, 401);

    const { data: callerProfile, error: profileError } = await admin
      .from('profiles')
      .select('is_school_admin, global_role')
      .eq('id', caller.id)
      .single();
    if (profileError || !(callerProfile?.is_school_admin || callerProfile?.global_role === 'super_admin')) {
      return json({ error: 'Only a School Admin can generate a quiz' }, 403);
    }

    const { source_text } = await req.json();
    if (!source_text || !source_text.trim()) return json({ error: 'source_text is required' }, 400);

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
        model: 'claude-sonnet-5-5',
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: source_text.slice(0, 20000) }],
        stream: true,
      }),
    });

    if (!anthropicRes.ok) {
      const errBody = await anthropicRes.text();
      console.error(`Anthropic API error (HTTP ${anthropicRes.status}): ${errBody}`);
      return json({ error: `Quiz generation failed: ${errBody}` }, 502);
    }

    // anthropicRes.ok only confirms the stream started, not that
    // Anthropic won't send an error event partway through — the
    // client is responsible for handling that once it's reading the
    // stream (see lessonEditorModal.js).
    return new Response(anthropicRes.body, {
      headers: { ...CORS_HEADERS, 'Content-Type': 'text/event-stream' },
    });
  } catch (err) {
    console.error('generate-quiz unexpected error:', err);
    return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, 500);
  }
});
