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

const SYSTEM_PROMPT = `You extract a list of people from raw text pulled from a church roster PDF. The text is labeled by page ("=== PDF PAGE n ===") and each page's lines are reconstructed from the PDF's actual layout (left-to-right, top-to-bottom), so indentation and column order within a page are meaningful, not noise.

IMPORTANT -- this PDF is very often a wide spreadsheet (e.g. a Microsoft Forms response export) that was printed without "fit to page width". When that happens, ONE row of real data gets split across SEVERAL consecutive pages: e.g. page 1 might hold a batch of rows' Id/Start time/Email, page 2 the SAME rows' Name/City (in the same top-to-bottom order), page 3 the SAME rows' Phone/Age, and so on -- then the whole pattern may repeat for the next batch of rows, or even repeat for the ENTIRE dataset again later in the document (e.g. a second, differently-grouped printout of the same underlying sheet). When you see this pattern:
- Correlate rows ACROSS consecutive pages by their POSITION within each page's list (1st row on one page pairs with the 1st row on the next page-chunk, 2nd with 2nd, etc.) -- use an explicit "Id" column as your anchor whenever one is present, since it's the only true per-row key.
- If the same person's data clearly appears more than once (same name, matching other fields, likely from a repeated page group), output them only ONCE -- merge whatever fields each occurrence supplied rather than duplicating the row.
- A page of mostly blank/empty cells padding out a table (e.g. a short "Yes/No" column with many empty rows beneath it) is normal for this kind of export -- don't let it shift your row alignment for the following page.

Respond with ONLY a JSON array -- no markdown fences, no commentary before or after -- matching exactly this shape:
[{"full_name": "...", "email": "..." or null, "phone": "..." or null}, ...]

Skip anything that is clearly not a person's name (page numbers, column headers, church name, dates, stray wrapped text). If a row has no clear full name, omit it entirely. One entry per unique person, in the order they first appear.`;

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
        max_tokens: 16384,
        system: SYSTEM_PROMPT,
        // Matches PDF_TEXT_LIMIT in js/components/peopleImportModal.js --
        // this is a second cap, not the primary one (the client already
        // truncates to the same length), kept here as defense-in-depth
        // against a direct call to this function bypassing the client.
        messages: [{ role: 'user', content: text.slice(0, 120000) }],
        stream: false,
      }),
    });

    if (!anthropicRes.ok) {
      const errBody = await anthropicRes.text();
      console.error(`Anthropic API error (HTTP ${anthropicRes.status}): ${errBody}`);
      return json({ error: `PDF parsing failed: ${errBody}` }, 502);
    }

    const anthropicData = await anthropicRes.json();
    // content[0] isn't reliably the text block -- Sonnet 5 can return a
    // thinking block first, which has no .text field at all, leaving
    // content[0].text silently empty. Find the actual text block instead.
    const rawText = anthropicData?.content?.find((b) => b.type === 'text')?.text ?? '';

    let rows;
    try {
      // Strip an accidental ```json fence, and any preamble/trailing text
      // outside the [ ], in case the model adds either despite the "no
      // markdown, no commentary" instruction -- same defensive parse
      // lessonEditorModal.js's quiz generator already uses client-side.
      let cleaned = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
      const firstBracket = cleaned.indexOf('[');
      const lastBracket = cleaned.lastIndexOf(']');
      if (firstBracket !== -1 && lastBracket !== -1) cleaned = cleaned.slice(firstBracket, lastBracket + 1);
      rows = JSON.parse(cleaned);
    } catch {
      console.error('parse-roster-pdf: Claude returned non-JSON:', rawText);
      return json({
        error: 'Could not read a people list from this PDF',
        debug_stop_reason: anthropicData?.stop_reason,
        debug_snippet: rawText.slice(0, 2000),
      }, 502);
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
