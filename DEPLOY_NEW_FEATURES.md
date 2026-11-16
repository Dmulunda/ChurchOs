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
