# New features: what each one needs before it goes live

Built one by one on the `sandbox2` branch. Nothing here has been applied
to the live database or deployed yet. For each feature, in order:

1. Run its SQL files on Supabase project `towlqbxvhftzjfrtepsy` (SQL editor), in number order.
2. Deploy the edge functions listed.
3. Set any secrets listed (only needed for features that cost money).
4. Push the code (`git push saas sandbox2:main`).

The screens for a feature stay hidden until its SQL has been applied, so
pushing code early does not break anything.

## At a glance — what needs your decision

| # | Feature | Free to switch on? | Your decision |
|---|---------|--------------------|---------------|
| 1 | Automatic reminders | Yes | — |
| 2 | Online giving | Yes (no monthly fee) | Each church connects its own Stripe account; Stripe's card fee (~2.9% + 30¢) is paid per gift by the church |
| 3 | Communication hub | Yes (in-app, push, email) | SMS / WhatsApp through Twilio cost per message — leave the Twilio secrets unset until you decide |
| 4 | Small groups | Yes | — |
| 5 | Calendar & room booking | Yes | — |
| 6 | Children's check-in | Yes | (Printed name tags would need a label printer — not built) |
| 7 | Discipleship path | Yes | — |
| 8 | Leadership insights | Yes | — |
| 9 | Sermon library | Yes | Storage for audio files (Supabase Pro includes 100 GB) |
| 10 | Documents & minutes | Yes | Storage (usually small) |
| 11 | Offline reading (installable app) | Yes | App Store / Play Store listing: US$99/year + US$25 once — not built |
| 12 | AI writing help | — | Anthropic API usage (low-cost model, a few dollars a month) |
| 13 | Pastoral visits | Yes | — |
| 14 | Equipment & inventory | Yes | — |
| 15 | Paid events + QR check-in | Check-in yes | Online event payment uses the church's Stripe account (same fee as giving) |

Apply the SQL files in number order, 142 → 169. Files 142 and 164 start
with an `alter type … add value` line: run each of those files as a whole
(the line must run before its transaction). Every file was tested on a copy
of the live data inside a transaction that was rolled back.

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

---

## 14. Equipment & inventory for every department

The Equipment tab (until now Media & Tech only) becomes available to **every
department**, and items gain quantity, serial number, value, purchase date,
warranty end, next-maintenance date, loans to any name (not only to yourself),
and a maintenance log. A new church-wide **Inventory** page (pastoral team)
shows all departments' items with totals (count, total value, overdue loans,
repairs, maintenance due), filters and a CSV download for insurance.
Before 166 is applied, Media & Tech keeps exactly the old tab.

- **SQL:** `166_equipment_inventory.sql` (new columns, per-department policies
  replacing the Media-&-Tech-only ones, maintenance log), `167_equipment_inventory_kb.sql`
- **Edge functions / secrets:** none
- **Cost:** none

---

## 15. Paid events + QR check-in

**Check-in at the door (free):** Events → event → "📷 Check-in". The phone
camera scans the QR code already in every confirmation email (works on
Android and iPhone); green / orange / red result, people count, and a name
list for people without their ticket, with Undo. Allowed for members of the
organizing department and the pastoral team. Registrant list shows who came.

**Online payment for priced events:** after registering, or from a new "Pay
online" link in the confirmation email, people pay by card on Stripe's page.
Money goes to the **church's own Stripe account — the same one set up for
online giving (section 2)**; ChurchOnPoint takes nothing. The webhook marks the
registration paid automatically. Organizers can also set Paid (cash) or
Waived. If the church has no Stripe account connected, nothing changes for
visitors except the wording.

- **SQL:** `168_event_payments_checkin.sql`, `169_event_payments_checkin_kb.sql`
- **Edge functions:** `supabase functions deploy event-payment --no-verify-jwt`,
  redeploy `online-giving-webhook` (now also marks event payments) and
  `event-emails` (pay link in the confirmation email)
- **Secrets:** none new (uses STRIPE_SECRET_KEY, STRIPE_CONNECT_WEBHOOK_SECRET,
  GIVING_RETURN_ORIGINS from section 2)
- **Cost — your decision:** same as online giving: Stripe's card fee
  (about 2.9% + 30¢ in Canada) is paid by the church on each payment; no
  monthly fee. Check-in itself costs nothing.

## Main port (November 2026): everything Main gained since the 15 features, except the AI writer

Brought over from Main commits 2f35ef6 to 2fa6891 (29 commits, replayed with `git am -3`), then adapted for many churches:
- Public guest pages: `welcome.html?church=<slug>` (each church's link is shown in Settings -> Church logo & info, with a Copy button), `live.html`, shared navy look for prayer/booking/give/register/event/guest check-in (`js/publicTheme.js`). `js/churchContext.js` remembers the church slug for the tab and adds `?church=` to links between public pages. Church name/logo come from the church, never VPD. The app itself still opens on `app.html` (no redirect to the welcome page, since a visitor without a link has no church).
- Edge functions `public-portal` and `live-status` (deployed to Saas-platform, verify_jwt on): the church comes from `body.church` (slug) or the signed-in caller's church (`_shared/resolveTenant.ts`). Live cache per church.
- Settings -> Church logo & info (`tenantLogoModal.js`): social links, YouTube channel, live-service times with "online only", time zone, public page link.
- Member app redesign (navy/gold, new Home, ministry pages, line icons, bottom bar), Home "my next service" + to-do card, calendar with church program and daily/weekly/monthly repeat, menu by role (Events, Flyers, Projection, Equipment for Media & Tech admins; Supplies and Inventory for every department admin), sermon clip start/end, projection console redesign + reliable verse listening + songs for the Media team + big countdown text, Flyers Canva-style editor with automatic picture shrinking, safe file names for uploads, update bar instead of the pop-up.
- Plan gating kept: Projection, Flyers and COP Academy still follow the church's plan.

SQL (sql/saas_platform):
- `170_privacy_live_social.sql` (applied): member privacy (guests see only themselves; `get_profiles_private`, `get_card_pastor_signature`), small groups for members only, tenants social/live columns, `live_status_cache` per church, `get_church_calendar` with the church program, `sermons.video_start_seconds/_end_seconds`, Media & Tech can read/edit songs, supplies per department.
- `171_home_my_services.sql` (applied): `get_my_upcoming_services`, `confirm_my_service`.
- `172_profile_private_columns.sql` (NOT applied yet): locks address, birth place, legal name and signature columns. Apply only after this app version is live on churchonpoint.com, otherwise the old app version cannot read profiles.
- `173_flyers_bucket_25mb.sql` (applied).
- Not ported on purpose: the monthly deletion of schedules older than one month (Main 165). The SaaS keeps past schedules (sql/saas_platform/32); deleting other churches' history is a decision for each church.
