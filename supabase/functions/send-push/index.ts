// Sends Web Push notifications to a department's approved members, or
// to everyone (sql/078). Two request shapes:
//
//   Announcement-style (admin/secretary of the department, or global
//   reach): { department_id, title, body } or { global: true, title, body }
//   — title/body are sent as-is, caller supplies them.
//
//   Self-service: { kind: 'absence_report', dates: string[] } — any
//   signed-in member can trigger this one, but ONLY about their own
//   absence and ONLY to departments they're actually a member of; the
//   notification text and the recipient list are both derived
//   server-side from the caller's own identity, never from anything
//   the client sends, so this can't be used to push arbitrary text to
//   an arbitrary department the way the announcement path could.
//
//   Admin-triggered: { kind: 'disciplinary_letter', letter_id } — only
//   a Pastor Admin/Super Admin can trigger this, and only for a letter
//   that actually exists and is already 'sent' (sql/087's trigger has
//   already created the in-app notification by the time this runs —
//   this only adds the Web Push half, since a DB trigger can't call an
//   edge function directly). Title/body are derived server-side, never
//   client-supplied.
//
// Both paths re-derive the recipient list and re-check permission
// server-side — never trust a client-supplied user list — same
// pattern as every other sensitive action in this app.
//
// Deploy: Supabase Dashboard -> Edge Functions -> deploy this file as
// "send-push" (or `supabase functions deploy send-push`). Needs two
// secrets set manually — Dashboard -> Edge Functions -> send-push ->
// Secrets -> VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY. Generate a pair
// with `npx web-push generate-vapid-keys`; the public half must also
// be pasted into js/pushNotifications.js (VAPID_PUBLIC_KEY) — it's not
// a secret, it just has to match on both sides.
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are provided automatically.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GLOBAL_REACH_ROLES = ['super_admin', 'pastor_admin', 'church_secretary'];

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

async function sendToUsers(admin, userIds, title, body) {
  if (userIds.length === 0) return { sent: 0, failed: 0 };

  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .in('user_id', userIds);

  const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY');
  const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY');
  if (!vapidPublic || !vapidPrivate) throw new Error('VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY are not configured on this function');
  webpush.setVapidDetails('mailto:admin@eglisevpd.com', vapidPublic, vapidPrivate);

  const payload = JSON.stringify({ title, body: body ?? '', url: './' });

  let sent = 0;
  let failed = 0;
  const staleIds = [];

  for (const sub of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      );
      sent++;
    } catch (err) {
      failed++;
      // 404/410 means the browser dropped this subscription (uninstalled,
      // permission revoked, etc.) — stop trying to reach it.
      if (err?.statusCode === 404 || err?.statusCode === 410) staleIds.push(sub.id);
    }
  }

  if (staleIds.length > 0) await admin.from('push_subscriptions').delete().in('id', staleIds);

  return { sent, failed };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    // Cron path (sql/saas_platform/142_automatic_reminders.sql): the
    // notifications trigger asks for a Web Push for one stored reminder
    // row. Authenticated by the shared cron secret (the same one
    // send-notification-email checks), never a user JWT; the recipient
    // and the text come only from the stored row, nothing client-supplied.
    const cronSecret = Deno.env.get('CRON_SECRET');
    if (cronSecret && req.headers.get('x-cron-secret') === cronSecret) {
      const { kind, notification_id } = await req.json();
      if (kind !== 'notification' || !notification_id) return json({ error: 'kind "notification" and notification_id are required' }, 400);
      const cronAdmin = createClient(
        Deno.env.get('SUPABASE_URL'),
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
      );
      const { data: notification } = await cronAdmin
        .from('notifications')
        .select('recipient_id, title, body')
        .eq('id', notification_id)
        .maybeSingle();
      if (!notification) return json({ skipped: 'notification not found' });
      const { sent, failed } = await sendToUsers(cronAdmin, [notification.recipient_id], notification.title, notification.body);
      return json({ sent, failed });
    }

    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    if (!jwt) return json({ error: 'Missing authorization' }, 401);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    );

    const { data: { user: caller }, error: callerError } = await admin.auth.getUser(jwt);
    if (callerError || !caller) return json({ error: 'Invalid session' }, 401);

    // Fetched once up front -- this client is the service-role key,
    // which bypasses RLS entirely, so every branch below must re-scope
    // its own queries to the caller's own tenant explicitly. Missing
    // this anywhere lets an admin from one church notify/read another
    // church's members.
    const { data: callerProfile, error: callerProfileError } = await admin
      .from('profiles')
      .select('tenant_id, full_name, global_role, can_post_global_announcements')
      .eq('id', caller.id)
      .single();
    if (callerProfileError || !callerProfile) return json({ error: 'Profile not found' }, 404);
    const callerTenantId = callerProfile.tenant_id;

    const requestBody = await req.json();

    if (requestBody.kind === 'absence_report') {
      const dates = Array.isArray(requestBody.dates) ? requestBody.dates : [];
      if (dates.length === 0) return json({ error: 'dates is required' }, 400);

      const { data: memberships } = await admin
        .from('department_memberships')
        .select('department_id')
        .eq('user_id', caller.id)
        .eq('status', 'approved');

      const title = 'Absence Reported';
      const dateList = dates.length <= 3 ? dates.join(', ') : `${dates.slice(0, 3).join(', ')} +${dates.length - 3} more`;
      const body = `${callerProfile.full_name ?? 'A member'} won't be available: ${dateList}`;

      let totalSent = 0;
      let totalFailed = 0;
      for (const m of memberships ?? []) {
        const { data: deptMembers } = await admin
          .from('department_memberships')
          .select('user_id')
          .eq('department_id', m.department_id)
          .eq('status', 'approved')
          .eq('tenant_id', callerTenantId)
          .neq('user_id', caller.id); // no need to notify yourself of your own report
        const { sent, failed } = await sendToUsers(admin, (deptMembers ?? []).map((r) => r.user_id), title, body);
        totalSent += sent;
        totalFailed += failed;
      }
      return json({ sent: totalSent, failed: totalFailed });
    }

    if (requestBody.kind === 'disciplinary_letter') {
      const letterId = requestBody.letter_id;
      if (!letterId) return json({ error: 'letter_id is required' }, 400);

      const isPastorOrSuperAdmin = callerProfile.global_role === 'pastor_admin' || callerProfile.global_role === 'super_admin';
      if (!isPastorOrSuperAdmin) return json({ error: 'Only a Pastor Admin can send this notification' }, 403);

      const { data: letter } = await admin
        .from('disciplinary_letters')
        .select('member_id, type, status')
        .eq('id', letterId)
        .eq('tenant_id', callerTenantId)
        .single();
      if (!letter || letter.status !== 'sent') return json({ error: 'Letter not found or not sent' }, 404);

      const title = 'You have a new letter';
      const body = `You've been sent a ${letter.type} letter. Please review and sign it in the app.`;
      const { sent, failed } = await sendToUsers(admin, [letter.member_id], title, body);
      return json({ sent, failed });
    }

    const { department_id, global: isGlobal, title, body } = requestBody;
    if (!title) return json({ error: 'title is required' }, 400);

    const hasGlobalReach = GLOBAL_REACH_ROLES.includes(callerProfile.global_role) || !!callerProfile.can_post_global_announcements;

    let targetUserIds = [];

    if (department_id) {
      const { data: department } = await admin
        .from('departments')
        .select('id')
        .eq('id', department_id)
        .eq('tenant_id', callerTenantId)
        .maybeSingle();
      if (!department) return json({ error: 'Not allowed to notify this department' }, 403);

      const { data: callerMembership } = await admin
        .from('department_memberships')
        .select('role')
        .eq('department_id', department_id)
        .eq('user_id', caller.id)
        .eq('status', 'approved')
        .maybeSingle();
      const isDeptPoster = ['admin', 'secretary'].includes(callerMembership?.role);
      if (!isDeptPoster && !hasGlobalReach) return json({ error: 'Not allowed to notify this department' }, 403);

      const { data: members } = await admin
        .from('department_memberships')
        .select('user_id')
        .eq('department_id', department_id)
        .eq('status', 'approved')
        .eq('tenant_id', callerTenantId);
      targetUserIds = (members ?? []).map((m) => m.user_id);
    } else if (isGlobal) {
      if (!hasGlobalReach) return json({ error: 'Not allowed to send a church-wide notification' }, 403);
      const { data: everyone } = await admin
        .from('profiles')
        .select('id')
        .eq('tenant_id', callerTenantId)
        .is('removed_at', null);
      targetUserIds = (everyone ?? []).map((p) => p.id);
    } else {
      return json({ error: 'Specify department_id, global, or kind: "absence_report"' }, 400);
    }

    const { sent, failed } = await sendToUsers(admin, targetUserIds, title, body);
    return json({ sent, failed });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, 500);
  }
});
