// live-status: is the church's YouTube channel streaming right now?
//
// Reads the YouTube link saved in church_branding.youtube_url (Super
// Admin Home -> Change Info), finds the channel, and checks the
// channel's /live page. Returns
//   { configured, live, upcoming, video_id, title, starts_at, channel_url,
//     schedule: [{ day: 0-6 (Sunday = 0), time: 'HH:MM' }], timezone }
// The answer is cached for 60 seconds in live_status_cache, so many
// visitors cause at most one YouTube check per minute.
// Public on purpose (called with the anon key): it only says whether
// the public channel is live.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};
const CACHE_SECONDS = 60;
const YT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cookie': 'CONSENT=YES+cb; SOCS=CAI',
};

function json(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' } });
}

async function fetchText(url: string) {
  const res = await fetch(url, { headers: YT_HEADERS, redirect: 'follow' });
  return res.ok ? await res.text() : '';
}

async function resolveChannelId(url: string): Promise<string | null> {
  const direct = url.match(/youtube\.com\/channel\/(UC[\w-]{22})/);
  if (direct) return direct[1];
  if (!/^https:\/\/(www\.|m\.)?youtube\.com\//.test(url)) return null;
  const html = await fetchText(url);
  const m = html.match(/<meta itemprop="identifier" content="(UC[\w-]{22})"/)
    || html.match(/"externalId":"(UC[\w-]{22})"/)
    || html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/)
    || html.match(/"channelId":"(UC[\w-]{22})"/);
  return m ? m[1] : null;
}

function unescapeJson(v: string) {
  try { return JSON.parse(`"${v}"`); } catch { return v; }
}

async function checkLive(channelId: string) {
  const none = { live: false, upcoming: false, video_id: null, title: null, starts_at: null };
  const html = await fetchText(`https://www.youtube.com/channel/${channelId}/live`);
  // When the channel is live (or has a scheduled stream), /live serves a
  // watch page. Otherwise it serves the channel page (no watch data).
  const primary = html.match(/"videoPrimaryInfoRenderer":\{"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/);
  if (!primary || !html.includes(`"channelId":"${channelId}"`)) return none;
  const current = html.match(/"currentVideoEndpoint":\{[\s\S]{0,800}?"videoId":"([\w-]{11})"/)
    || html.match(/"videoDetails":\{"videoId":"([\w-]{11})"/);
  if (!current) return none;
  const titleMatch = primary;
  // Accept-Language is en-US, so YouTube's labels are English. A stream
  // that is really on air shows "N watching now" / "Started streaming";
  // a scheduled or abandoned waiting room shows "N waiting" /
  // "Scheduled for ..." and must NOT count as live.
  const viewCount = html.match(/"videoViewCountRenderer":\{"viewCount":\{"runs":\[([\s\S]{0,300}?)\]\}/);
  const dateText = html.match(/"dateText":\{"simpleText":"([^"]*)"/);
  const isLive = (!!viewCount && /watching now/.test(viewCount[1])) || (!!dateText && /^Started streaming/.test(dateText[1]));
  return {
    live: isLive,
    upcoming: false,
    video_id: isLive ? current[1] : null,
    title: isLive && titleMatch ? unescapeJson(titleMatch[1]) : null,
    starts_at: null,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: branding } = await admin.from('church_branding').select('youtube_url, live_schedule, live_timezone').eq('id', true).maybeSingle();
  const sourceUrl = (branding?.youtube_url || '').trim();
  const schedule = { schedule: Array.isArray(branding?.live_schedule) ? branding.live_schedule : [], timezone: branding?.live_timezone || 'America/Toronto' };
  if (!sourceUrl) return json({ configured: false, live: false, ...schedule });

  const { data: cache } = await admin.from('live_status_cache').select('*').eq('id', true).maybeSingle();
  const fresh = cache && cache.source_url === sourceUrl && Date.now() - new Date(cache.checked_at).getTime() < CACHE_SECONDS * 1000;
  if (fresh) return json({ ...cache.payload, ...schedule });

  let channelId = cache && cache.source_url === sourceUrl ? cache.channel_id : null;
  let payload: Record<string, unknown>;
  try {
    if (!channelId) channelId = await resolveChannelId(sourceUrl);
    const channelUrl = channelId ? `https://www.youtube.com/channel/${channelId}` : sourceUrl;
    payload = channelId
      ? { configured: true, channel_url: channelUrl, ...(await checkLive(channelId)) }
      : { configured: true, channel_url: sourceUrl, live: false, error: 'channel_not_found' };
  } catch (_e) {
    payload = cache?.payload && cache.source_url === sourceUrl ? cache.payload : { configured: true, channel_url: sourceUrl, live: false, error: 'check_failed' };
  }
  await admin.from('live_status_cache').upsert({ id: true, source_url: sourceUrl, channel_id: channelId, payload, checked_at: new Date().toISOString() });
  return json({ ...payload, ...schedule });
});
