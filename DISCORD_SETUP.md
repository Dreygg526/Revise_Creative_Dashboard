# Discord reports: setup

Approved by the boss 2026-10-13 (`Downloads/Revise dashboard - Discord reports proposal v2.pdf`).
The code is in the dashboard. Four things switch it on, in this order. Nothing posts until step 3.

Built on the suggested answer to each of the proposal's six decisions: KPI = **NC ROAS**; **Founder + Media Buyer**
set it; potential ad = **$1,000 within 5 days** at or above KPI (+ $500 Watching); daily report = **final 2 days
ago + early read of yesterday**; hit rate **every other Monday** (first one **Mon 19 Oct 2026**); channels
**#daily-report, #creative-leads, #ask-ai**.

---

## 1. Run the SQL (Supabase, 2 min)

1. Open Supabase → the dashboard project → **SQL Editor** → **New query**.
2. Paste all of `discord_reports_schema.sql` → **Run**.
3. The last result should show three rows, `monthly_kpi`, `daily_figures_log`, `discord_ask_log`, each `rls_on = true`.

This creates the Monthly KPI table (October starts at the current rule, NC ROAS ≥ 0.95 on ≥ $500), the log
that measures how fast the data settles, and the /ask log.

Then in the dashboard: **Settings → Monthly KPI → Oct 2026 → Edit**, and pick the Goal (Profit / Scale).
Only a Founder or Media Buyer sees the Edit button.

## 2. Discord channels + webhooks (Discord admin, 5 min)

Someone with **Manage Server** / **Manage Webhooks** on the team's Discord:

1. Create three **private** channels: `#daily-report`, `#creative-leads`, `#ask-ai` (plus `#report-test` for the test week).
   Channel → ⚙️ Edit Channel → **Permissions** → turn on **Private Channel** → add the people who should see it.
2. In `#daily-report`: ⚙️ Edit Channel → **Integrations** → **Webhooks** → **New Webhook** → name it
   `Standard Creative Dashboard` → **Copy Webhook URL**. Send it to Roan privately (not in a channel).
3. Same in `#creative-leads`, and in `#report-test`.

## 3. Vercel environment variables (Roan, 5 min)

Vercel → project → **Settings → Environment Variables** → add each one for **Production**:

| Name | Value |
|---|---|
| `DISCORD_WEBHOOK_TEST` | the `#report-test` webhook URL (**set this first**: while it's set, every report goes there instead) |
| `DISCORD_WEBHOOK_DAILY_REPORT` | the `#daily-report` webhook URL |
| `DISCORD_WEBHOOK_CREATIVE_LEADS` | the `#creative-leads` webhook URL |

Then **Deployments → ⋯ on the latest → Redeploy** so the new values load.

The cron (`vercel.json`) runs **daily at 00:00 UTC = 8:00 AM PH**. To send one right now instead of waiting:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "https://revise-creative-dashboard.vercel.app/api/cron/discord?kind=daily"
# kind=hitrate for the hit rate; add &dry=1 to see the message as JSON without posting
```

**Test week:** leave `DISCORD_WEBHOOK_TEST` set for 7 days. Each run writes the two days it read into
`daily_figures_log`; after the week, compare a day's `early` row with its `final` row the next morning to see how
much it moved. If it barely moves, the final section can switch to yesterday. **Go live:** delete
`DISCORD_WEBHOOK_TEST` → Redeploy.

## 4. /ask bot (Discord admin 10 min, then Roan)

Discord admin:

1. https://discord.com/developers/applications → **New Application** → name `Standard Creative Dashboard` → Create.
2. **General Information**: copy the **Application ID** and the **Public Key** → send to Roan.
3. **Bot** → **Reset Token** → copy the token → send to Roan privately. (Leave "Message Content Intent" **off**; not needed.)
4. **Installation** (or OAuth2 → URL Generator): scopes **`bot`** + **`applications.commands`**, bot permission
   **Send Messages** → open the generated link → add it to the team's server.
5. In Discord, **User Settings → Advanced → Developer Mode** on. Right-click the server icon → **Copy Server ID**;
   right-click `#ask-ai` → **Copy Channel ID**. Send both to Roan.
6. In `#ask-ai` → ⚙️ → Permissions → add the bot's role with **View Channel** + **Send Messages** (it's a private channel).

Roan:

1. Vercel → Environment Variables (Production):

   | Name | Value |
   |---|---|
   | `DISCORD_PUBLIC_KEY` | the Public Key (64 hex characters) |
   | `DISCORD_GUILD_IDS` | the Server ID |
   | `DISCORD_ASK_CHANNEL_IDS` | the `#ask-ai` Channel ID (comma-separate to allow more) |
   | `DISCORD_ASK_DAILY_CAP` | optional, questions per person per 24h, default 25 |

   → **Redeploy**.
2. Back in the Developer Portal → **General Information** → **Interactions Endpoint URL** →
   `https://revise-creative-dashboard.vercel.app/api/discord/interactions` → **Save**. Discord tests it on save;
   if it says it couldn't verify, the Public Key in Vercel is wrong or the redeploy hasn't finished.
3. Register the command once (bot token stays on your machine, never in Vercel):

   ```bash
   DISCORD_APP_ID=... DISCORD_BOT_TOKEN=... DISCORD_GUILD_ID=... node scripts/discord-register-commands.mjs
   ```
   `200` = done. Type `/ask` in `#ask-ai`.

/ask is read-only (no edit tool at all) and costs ~$0.05–0.15 per question, logged in `discord_ask_log` (Founder-readable).
