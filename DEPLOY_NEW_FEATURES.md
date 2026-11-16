# New features: what each one needs before it goes live

Built one by one on the `sandbox2` branch. Nothing here has been applied
to the live database or deployed yet. For each feature, in order:

1. Run its SQL files on Supabase project `towlqbxvhftzjfrtepsy` (SQL editor), in number order.
2. Deploy the edge functions listed.
3. Set any secrets listed (only needed for features that cost money).
4. Push the code (`git push saas sandbox2:main`).

The screens for a feature stay hidden until its SQL has been applied, so
pushing code early does not break anything.

---

## 1. Automatic reminders

Reminds people 2 days before they serve (department shifts and choir),
the day before a confirmed pastor meeting (member and pastor), and the day
before an event they registered for. In-app + email + phone push.
Runs every day at 8:00 AM Toronto time.

- **SQL:** `142_automatic_reminders.sql`, `143_automatic_reminders_kb.sql`
- **Edge functions to redeploy:** `send-push` (new cron path for reminders)
- **Secrets:** none new (uses the existing `CRON_SECRET`, `RESEND_API_KEY`, VAPID keys)
- **Cost:** none beyond your existing email (Resend) plan
- **Members can turn it off:** bell icon → notification settings

---

## 2. Online giving  💰 needs your decision

Members (Tax / Impôts → **Give now**) and anyone with the church's giving
link or QR code can give by card. The money goes **directly to each
church's own Stripe account** (Stripe Connect); ChurchOnPoint holds nothing
and takes no fee. Paid gifts appear automatically in Offerings (payment
method "Online") and, when the giver was signed in, on their tax receipt.
Interac e-Transfer and mobile money are shown as instructions (recorded by
Finance as today), at no cost.

Each church switches it on in **Offerings → Online giving**: Connect Stripe,
fill in the optional Interac email / mobile money text, turn it on, share
the link.

- **SQL:** `144_online_giving.sql`, `145_online_giving_kb.sql`
- **New pages/files:** `give.html`, `js/publicGiving.js`, `js/components/onlineGivingSettings.js`
- **Edge functions to deploy (new):**
  - `online-giving` → `supabase functions deploy online-giving --no-verify-jwt`
  - `online-giving-webhook` → `supabase functions deploy online-giving-webhook --no-verify-jwt`
- **In Stripe (your platform account):**
  1. Turn on **Connect** (Settings → Connect), choose Standard accounts.
  2. Developers → Webhooks → Add endpoint → *Events on connected accounts* →
     `https://towlqbxvhftzjfrtepsy.supabase.co/functions/v1/online-giving-webhook`
     with events `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
     `checkout.session.expired`, `checkout.session.async_payment_failed`, `account.updated`.
- **Secrets:** `STRIPE_CONNECT_WEBHOOK_SECRET` (from step 2), on `online-giving-webhook`.
  `STRIPE_SECRET_KEY` already exists. Optional `GIVING_RETURN_ORIGINS`
  (default `https://www.churchonpoint.com`).
- **Cost:** no monthly cost. Stripe's normal card fee is paid by each church on
  its own gifts. **Your decision:** whether ChurchOnPoint should take a small
  platform fee per gift (not built; easy to add), and which mobile money
  provider to integrate later for automatic M-Pesa/Orange/Airtel payments
  (these require a paid provider account).

---

## 3. Communication hub  💰 SMS/WhatsApp need your decision

**Tools → Communication hub** (also in the sidebar Tools menu under
*Ministry & care*): one message to the whole church (pastoral team) or to
chosen departments (their admins/secretaries), sent in the app, as a phone
notification, by email and — once activated — by SMS and WhatsApp.
A History tab shows every message and how many people each channel reached.

- **SQL:** `146_communication_hub.sql`, `147_communication_hub_kb.sql`
- **Edge function to deploy (new):** `broadcast` → `supabase functions deploy broadcast`
- **Secrets:** app, push and email work with what you already have
  (`RESEND_API_KEY`, `BOOKING_EMAIL_FROM`, VAPID keys — set them on `broadcast` too).
- **SMS / WhatsApp (cost per message, left OFF):** create a Twilio account, then set on
  `broadcast`: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_SMS_FROM` (SMS number)
  and/or `TWILIO_WHATSAPP_FROM` (approved WhatsApp sender). Optional
  `DEFAULT_PHONE_COUNTRY_CODE` (default `1`). Until set, those two channels show
  "not set up". **Your decision:** turn them on, and whether to include them in a plan
  (the `sms_notifications` plan feature already exists, unassigned).
- **Cost:** none for app/push/email beyond your Resend plan.

---

## 4. Small groups (cell groups)

New **Small Groups** item in the sidebar. The pastoral team creates groups
(leader, co-leader, day, time, place). Leaders manage members and log each
meeting: who came, number of guests, short report for the pastors. Members
see their own group and its history.

- **SQL:** `148_small_groups.sql`, `149_small_groups_kb.sql` (reuses your existing `is_pastoral_team()`)
- **Edge functions / secrets:** none
- **Cost:** none

---

## 5. Church calendar and room booking

New **Calendar** item in the sidebar: one month view with events, department
schedules, choir services, weekly small-group meetings and new items
(meetings, rehearsals, room bookings). Leaders add items; a room can't be
booked twice at the same time. The pastoral team manages rooms and gets a
private link to subscribe in Google Calendar, Outlook or Apple Calendar.

- **SQL:** `150_church_calendar.sql`, `151_church_calendar_kb.sql` (apply after 148)
- **Edge function to deploy (new):** `calendar-feed` → `supabase functions deploy calendar-feed --no-verify-jwt`
- **Secrets:** none
- **Cost:** none
- Note: weekly small-group times are read as Toronto time.

---

## 6. Children's check-in (Sunday School)

Sunday School gets a **Check-in** tab (like Supplies for Cleaning). At
drop-off a volunteer taps the child: the app shows a 4-character pick-up code
for the parent and any allergy/medical alert in red. At pick-up the child is
released only with the right code; who picked them up is recorded. Builds on
your existing Sunday School children list (parents, allergies).

- **SQL:** `152_child_checkin.sql`, `153_child_checkin_kb.sql`
- **Edge functions / secrets:** none
- **Cost:** none. (Printed name tags would need a label printer — not built.)

---

## 7. Discipleship path

New **Discipleship** page in the sidebar. Every member sees "My journey":
the church's growth steps and the ones they completed, with dates. The
pastoral team also sees how many people reached each step, a "Who has
stalled" list (last step more than 90 days ago, next step not reached), ticks
steps for anyone in the member database, and edits the steps (EN/FR titles).
Seven starter steps are created for each church: first visit, gave their life
to Christ, membership class, baptism, small group, serving, leadership
training.

- **SQL:** `154_discipleship_path.sql`, `155_discipleship_path_kb.sql`
- **Edge functions / secrets:** none
- **Cost:** none

---

## 8. Leadership insights

New **Leadership Insights** page (pastoral team only; the sidebar button
appears only for them). Week-by-week mini charts for Sunday headcount
(Ushers), children (Sunday School), people checked in, new guests, volunteers
who served and giving (giving only for people who already see every
offering), with a trend arrow; plus period totals (new members, people who
left, guests waiting, open prayer requests, small-group attendance). No new
tables — one read-only function.

- **SQL:** `156_leadership_insights.sql`, `157_leadership_insights_kb.sql`
- **Edge functions / secrets:** none
- **Cost:** none

---

## 9. Sermon & media library

New **Sermons** page for everyone: search by any word, filter by series or
language, watch the video link (YouTube/Facebook), play the audio in the page,
open the notes (PDF). The pastoral team and the Media / Preaching departments
add, edit and archive sermons and upload files. Files go to a new **private**
storage bucket `sermon-files` (one folder per church, signed links that expire).

- **SQL:** `158_sermon_library.sql` (creates the bucket and its policies), `159_sermon_library_kb.sql`
- **Edge functions / secrets:** none
- **Check:** Supabase → Project Settings → Storage → *Upload file size limit*
  must be at least the size of your audio files (the bucket allows up to 200 MB;
  the project-wide limit wins if it is lower — it is 50 MB on the Free plan).
- **Cost — your decision:** storage. Supabase Pro includes 100 GB; beyond that
  about US$0.021 per GB per month. A 45-minute MP3 at 64 kbps is ~22 MB, so
  ~4,500 sermons fit in 100 GB. Posting video as a YouTube link costs nothing.

---

## 10. Shared documents & meeting minutes

New **Documents** page. Meeting minutes written in the app (date, who was
there, notes, decisions, action items), files (up to 50 MB) and links, each
belonging to the whole church or one department and visible to everyone, that
department only, or leaders only. Optional folders, search, filters. Department
admins manage their department's items; leaders can add church-wide items; the
pastoral team manages everything. Files go to a new **private** bucket
`church-documents`; a file is readable only by people who can see its
document.

- **SQL:** `160_shared_documents.sql` (bucket + policies), `161_shared_documents_kb.sql`
- **Edge functions / secrets:** none
- **Cost:** storage only (same Supabase allowance as sermons); usually small.

---

## 11. Mobile app — offline reading

The installable app (Add to Home Screen) now keeps working with a bad or no
connection. Everything is **network-first**: when the internet answers, fresh
data is used (so deploys are never hidden behind an old copy); only when it
fails does the app show the last saved copy of the pages and of the data the
person already opened (schedule, calendar, sermons list, documents list…). An
orange bar says "You are offline…" and saving is impossible until reconnected
— nothing is queued or replayed. Saved data is wiped on sign-out and when a
different person signs in on the same phone. A small bilingual `offline.html`
shows if the app was never opened on that device.

- **Files:** `sw.js`, `offline.html`, `js/pwa.js`, `js/app.js`, `manifest.json`
- **SQL / edge functions / secrets:** none
- **After deploy:** nothing — phones pick up the new service worker on their
  next visit.
- **Cost:** none.
- **Your decision (not built):** putting ChurchOnPoint in the Apple App Store
  and Google Play as a "real" app (a Capacitor wrapper around this same site)
  costs US$99/year (Apple developer account) + US$25 once (Google), plus
  review time. The installable web app above already gives an icon, full
  screen, push notifications and offline reading without the stores.

---

## 12. AI writing help (extends the AI assistant)

Leaders get a "✨ AI help" row under text boxes: **Translate FR ⇄ EN** and
**Improve wording** in the Communication hub, **Turn notes into minutes**
(fills Notes, Decisions and Action items) and **Translate** in Documents,
**Summarise** and **Translate** in Sermons. The suggestion is shown first and
only replaces the text when the person clicks "Use this" (with Undo). Members
never see it. Limit: 40 uses per person per day, logged in `ai_usage_log`.

- **SQL:** `162_ai_writer.sql`, `163_ai_writer_kb.sql`
- **Edge function:** `supabase functions deploy ai-writer`
- **Secrets:** reuses `ANTHROPIC_API_KEY` (and `ANTHROPIC_WORKSPACE_ID` if set)
  from the existing assistant. Optional `AI_WRITER_MODEL` (default
  `claude-haiku-5-5`, the low-cost model).
- **Cost — your decision:** billed by Anthropic per use. With the default
  model a typical translation or set of minutes is a few tenths of a cent;
  even 40 uses × 20 leaders every day stays around a few dollars a month. If
  the function is not deployed, the buttons simply don't appear.

---

## 13. Pastoral visits

New **Pastoral Visits** page (pastoral team, plus anyone who has a visit
assigned to them — they see only their own). Plan home / hospital / phone /
church visits, assign a visitor, mark done with confidential notes and a
follow-up date. Lists: planned (overdue in red), follow-ups due, and members
not visited for 6 months with a one-click "Plan". The visitor gets an in-app
notification (and email/push through the existing pipeline) when assigned and
the day before (daily job at 08:05 Toronto time). A visitor can only change
the outcome of their own visit, never who or why.

- **SQL:** `164_pastoral_visits.sql` (adds notification type
  `pastoral_visit` and the cron job `send-pastoral-visit-reminders`),
  `165_pastoral_visits_kb.sql`. Run 164 as a whole file — its first line
  (`alter type … add value`) must run before the transaction.
- **Edge functions / secrets:** none
- **Cost:** none
