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
