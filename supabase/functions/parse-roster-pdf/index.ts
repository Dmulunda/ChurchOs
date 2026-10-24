// Extracts a structured list of people from a church roster PDF's raw
// text, via the Claude API, for js/components/peopleImportModal.js's PDF
// import path. The browser extracts the raw text client-side (pdf.js) --
// this function only turns that unstructured text into {full_name, email,
// phone} rows, the same shape peopleImportModal.js already gets from an
// .xlsx/.csv file, so every step after this one (preview, matching,
// import) is identical regardless of source format.
//
// Unlike generate-quiz/ai-assistant, this does NOT stream -- the client
// needs one complete, parseable JSON array, not a token stream to render
// live.
//
// Deploy: `supabase functions deploy parse-roster-pdf`. Reuses the same
// ANTHROPIC_API_KEY / ANTHROPIC_WORKSPACE_ID secrets already configured
// for the ai-assistant/generate-quiz functions on this project.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SYSTEM_PROMPT = `You extract a list of people from raw text pulled from a church roster PDF. The text may be messy (columns run together, inconsistent spacing, headers/footers mixed in) -- use your judgment to identify actual people vs. noise.

Respond with ONLY a JSON array -- no markdown fences, no commentary before or after -- matching exactly this shape:
[{"full_name": "...", "email": "..." or null, "phone": "..." or null}, ...]

Skip anything that is clearly not a person's name (page numbers, headers, church name, dates). If a row has no clear full name, omit it entirely.`;

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
      .select('global_role')
      .eq('id', caller.id)
      .single();
    if (profileError || callerProfile?.global_role !== 'super_admin') {
      return json({ error: 'Only a Super Admin can import a roster PDF' }, 403);
    }

    const { text } = await req.json();
    if (!text || !text.trim()) return json({ error: 'text is required' }, 400);

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
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: text.slice(0, 15000) }],
        stream: false,
      }),
    });

    if (!anthropicRes.ok) {
      const errBody = await anthropicRes.text();
      console.error(`Anthropic API error (HTTP ${anthropicRes.status}): ${errBody}`);
      return json({ error: `PDF parsing failed: ${errBody}` }, 502);
    }

    const anthropicData = await anthropicRes.json();
    const rawText = anthropicData?.content?.[0]?.text ?? '';

    let rows;
    try {
      rows = JSON.parse(rawText);
    } catch {
      console.error('parse-roster-pdf: Claude returned non-JSON:', rawText);
      return json({ error: 'Could not read a people list from this PDF' }, 502);
    }
    if (!Array.isArray(rows)) return json({ error: 'Could not read a people list from this PDF' }, 502);

    const cleanRows = rows
      .filter((r) => r && typeof r.full_name === 'string' && r.full_name.trim())
      .map((r) => ({
        full_name: r.full_name.trim(),
        email: typeof r.email === 'string' && r.email.trim() ? r.email.trim() : null,
        phone: typeof r.phone === 'string' && r.phone.trim() ? r.phone.trim() : null,
      }));

    return json({ rows: cleanRows });
  } catch (err) {
    console.error('parse-roster-pdf unexpected error:', err);
    return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, 500);
  }
});
