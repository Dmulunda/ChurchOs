// Asks the live-status edge function whether the church's YouTube
// channel is streaming. Shared by live.html, welcome.html and the
// member app's live banner. Returns null on any failure.
import { supabase } from './supabaseClient.js';

export async function fetchLiveStatus() {
  try {
    const { data, error } = await supabase.functions.invoke('live-status', { body: {} });
    return error ? null : data;
  } catch {
    return null;
  }
}

export function youtubeEmbedUrl(videoId) {
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?rel=0&playsinline=1`;
}

export function youtubeWatchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}
