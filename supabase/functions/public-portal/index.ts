// public-portal: everything the guest welcome page (welcome.html) shows,
// in one call, for visitors who are not signed in.
//
// Privacy: this function runs with the service role, so it returns ONLY
// a fixed list of public fields. No people, no member data, no internal
// events. What is public:
//   * church name, logo, address/email/phone and social links from church_branding
//   * the church program for the next 8 weeks (title, description, date,
//     special flag, flyer)
//   * events with visibility 'public' that are not cancelled and not over
//   * the 12 most recent sermons (not archived), with short-lived signed
//     links for audio and notes, and the sermon's start/end inside the
//     video (sql/166) so a full livestream link plays only the sermon
// Called with the anon key (verify_jwt stays on).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};
const CHURCH_NAME = 'La Voix de la Puissance Divine';
const LINK_SECONDS = 6 * 3600;

function ymd(d: Date) { return d.toISOString().slice(0, 10); }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const now = new Date();
  const until = new Date(now.getTime() + 56 * 86400000);

  const [branding, dates, events, sermons] = await Promise.all([
    admin.from('church_branding').select('logo_url, address, email, phone, website_url, facebook_url, youtube_url, instagram_url, tiktok_url, whatsapp_url').eq('id', true).maybeSingle(),
    admin.from('church_program_dates')
      .select('date, program:church_programs!program_id ( title, description, is_special, flyer_storage_path )')
      .gte('date', ymd(now)).lte('date', ymd(until)).order('date').limit(60),
    admin.from('events')
      .select('id, title, description, location, start_at, end_at, price_cents')
      .eq('visibility', 'public').neq('status', 'cancelled')
      .gte('start_at', new Date(now.getTime() - 6 * 3600000).toISOString())
      .order('start_at').limit(12),
    admin.from('sermons')
      .select('title, preacher, preached_on, series, scripture, language, summary, video_url, video_start_seconds, video_end_seconds, audio_path, notes_path')
      .is('archived_at', null).order('preached_on', { ascending: false }).limit(12),
  ]);

  const sign = async (bucket: string, path: string | null) => {
    if (!path) return null;
    const { data } = await admin.storage.from(bucket).createSignedUrl(path, LINK_SECONDS);
    return data?.signedUrl || null;
  };

  const program = await Promise.all((dates.data || []).filter((d: any) => d.program).map(async (d: any) => ({
    date: d.date,
    title: d.program.title,
    description: d.program.description,
    is_special: !!d.program.is_special,
    flyer_url: await sign('church-program-flyers', d.program.flyer_storage_path),
  })));

  const sermonList = await Promise.all((sermons.data || []).map(async (s: any) => ({
    title: s.title, preacher: s.preacher, preached_on: s.preached_on, series: s.series, scripture: s.scripture,
    language: s.language, summary: s.summary,
    video_url: /^https:\/\//.test(s.video_url || '') ? s.video_url : null,
    video_start_seconds: Number.isInteger(s.video_start_seconds) ? s.video_start_seconds : null,
    video_end_seconds: Number.isInteger(s.video_end_seconds) ? s.video_end_seconds : null,
    audio_url: await sign('sermon-files', s.audio_path),
    notes_url: await sign('sermon-files', s.notes_path),
  })));

  const body = {
    church: {
      name: CHURCH_NAME,
      logo_url: branding.data?.logo_url || null,
      address: branding.data?.address || null,
      email: branding.data?.email || null,
      phone: branding.data?.phone || null,
      social: Object.fromEntries(['website', 'facebook', 'youtube', 'instagram', 'tiktok', 'whatsapp']
        .map((k) => [k, (branding.data as any)?.[`${k}_url`]])
        .filter(([, v]) => typeof v === 'string' && /^https:\/\/\S+$/.test(v))),
    },
    program,
    events: (events.data || []).map((e: any) => ({
      id: e.id, title: e.title, description: e.description, location: e.location,
      start_at: e.start_at, end_at: e.end_at, price_cents: e.price_cents,
    })),
    sermons: sermonList,
  };
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
  });
});
