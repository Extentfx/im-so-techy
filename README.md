# Life Dashboard

A private, calm dashboard that plans your week around work, school and family, and tracks gym, food and sleep. See `CLAUDE.md` for the rules, `DECISIONS.md` for the choices made, and `SECURITY.md` for the security review.

## Run it on your computer (localhost)

Needs Node 20 or newer.

```sh
git clone https://github.com/Extentfx/im-so-techy.git
cd im-so-techy
git checkout claude/artifact-reference-cdafhn
npm install
npm run local
```

Then open **http://localhost:5173**. That one command:

- creates `apps/worker/.dev.vars` on first run (fresh encryption key, owner set to you; gitignored, never deploy it),
- sets up a local database in `apps/worker/.wrangler` (your data stays in that folder),
- starts the Worker on :8787 and the web app on :5173, and refreshes calendar feeds every 15 minutes.

Stop with Ctrl+C. Delete `apps/worker/.wrangler` to start with an empty database.

Local mode skips the Cloudflare login, but only for requests to `localhost` when `LOCAL_DEV=1` is in `.dev.vars` and no Cloudflare edge header is present. Production never has that flag, so it still fails closed.

Optional extras for local use, added to `apps/worker/.dev.vars` (restart `npm run local` after):

```
ANTHROPIC_API_KEY=...   # Claude for open-ended chat and email labelling
FDC_API_KEY=...         # free USDA FoodData Central key for food search
CHAT_DAILY_CAP_USD=1    # stop Claude chat after this much spend per day
```

Other commands: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, `npm run loadcheck` (with the app running), `npm run audit:deps`.

## What is built

Use the round button in the bottom-right corner to switch pages.

| Page        | What it does                                                                                                                                                                                                                                                   |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Today**   | Live schedule, sleep and bedtime, calories ring, workouts-this-week ring, email digest, shift-change alerts, and a "waiting for your tap" list of suggestions.                                                                                                 |
| **Plan**    | Week view with a colour per calendar. Add work, school and family calendars by ICS/webcal link (stored encrypted). Refreshed every 15 minutes; a changed work shift raises an old-versus-new alert.                                                            |
| **Train**   | Exercise library, templates, set logging with a rest timer, PR detection, progressive-overload suggestions, bodyweight. "Plan my week" fits sessions around shifts, meals and bedtime and only adds them when you approve.                                     |
| **Fuel**    | Calories and macros against your targets, food search (Open Food Facts and USDA, via the server), barcode lookup and camera scan, saved foods and meals, one-tap school-lunch card.                                                                            |
| **Sleep**   | Log nights (manual, one-tap, or posted by a Shortcut), sleep debt, bedtime derived from tomorrow's first commitment. A rough night makes workout suggestions lighter and drains the backdrop colour.                                                           |
| **Home**    | Home Assistant bridge: device allowlist, buttons, scenes, optional wind-down and wake routines. Locks, garage doors and alarms always ask for confirmation and are rate limited.                                                                               |
| **Inbox**   | New email is categorised, summarised (numbers redacted, body never stored) and any dates become suggested events. It arrives by itself from a connected Gmail or Outlook account, or by pasting.                                                               |
| **Chat**    | Ask about your day. Built-in answers work with no setup; add a Claude key for open-ended questions. Read-only: anything it suggests needs your tap.                                                                                                            |
| **Connect** | One page for everything the app can connect to: Gmail and Outlook (read-only), Google and Outlook calendars, calendar links, Home Assistant, notifications, sleep import, and the server's Claude, food and backup settings. Also the last step of onboarding. |
| **You**     | Goals and limits, school lunch by weekday, phone notifications (ntfy), expiring read-only family link, JSON/CSV export, encrypted backup and restore, audit log, kill switch.                                                                                  |

Not built: reading shift rosters from a photo or PDF, web push (notifications use ntfy), and double-shift detection. Anything that talks to a real Google, Microsoft, Home Assistant or Claude account has only been tested against stand-ins. See "Tested how" below.

## Connect Gmail, Outlook and calendars

Open **Connect** (also the last step of onboarding) and press **Connect Google** or **Connect Microsoft**. You sign in on Google's or Microsoft's own page, so the app never sees your password. This needs a one-time app registration of your own, because every account's permissions belong to an app you control. It is free.

What you grant, and nothing more:

| Choice           | Google permission                                                                                                      | Microsoft permission                             |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Email, read-only | `gmail.readonly`                                                                                                       | `Mail.Read`                                      |
| Calendars        | `calendar.readonly`, plus `calendar.app.created` (can only touch a calendar this app creates, for the optional mirror) | `Calendars.Read`                                 |
| Always           | `openid`, `email`                                                                                                      | `openid`, `email`, `User.Read`, `offline_access` |

Nothing can send, delete, label or edit your mail, or change any of your existing calendars. **Verify these scope names in each provider's current documentation when you register, since providers rename them.**

**Google** (about 10 minutes):

1. At console.cloud.google.com create a project, then turn on the **Gmail API** and **Google Calendar API**.
2. Under Google Auth Platform (OAuth consent screen), choose External, add yourself as a test user, and add the scopes above.
3. Create an **OAuth client ID** of type **Web application**. Add the redirect address shown on the Connect page (for local use `http://localhost:5173/api/oauth/callback/google`).
4. Put the client ID and secret in `apps/worker/.dev.vars` as `GOOGLE_CLIENT_ID=` and `GOOGLE_CLIENT_SECRET=` (or `npx wrangler secret put` when deployed), restart, and press Connect Google.
5. Google ends sign-ins after about 7 days while an app is in "Testing". To avoid reconnecting weekly, publish the app to production for your own use (you will see an "unverified app" warning once, only for you).

**Microsoft:**

1. At entra.microsoft.com choose App registrations, New registration, with "Accounts in any organizational directory and personal Microsoft accounts".
2. Add a **Web** redirect (for local use `http://localhost:5173/api/oauth/callback/microsoft`), and create a **client secret**.
3. Put the Application (client) ID and secret in `.dev.vars` as `MS_CLIENT_ID=` and `MS_CLIENT_SECRET=`. Work or school accounts may need an admin to approve mail access.

When deployed, also set `PUBLIC_URL` (for example `https://life.example.com`) so the redirect address is exact, and add the same address in each provider's console.

What happens after you connect:

- **Email:** every 15 minutes the server reads new inbox messages from the last two days (first run), runs each through the same tool-less reader as pasted email, files it, and turns dates into suggestions on Today and Inbox. Each message is read once. Only a short summary with numbers hidden is stored, never the message. Switch it off per account, or press "Check now".
- **Calendars:** choose which calendars to import and whether each is work, school or family. They appear on Plan with a colour per type, and a changed work shift raises the same old-versus-new alert.
- **Optional Google mirror:** tick "keep a Life Dashboard calendar in Google" and events you approve are also written to a calendar the app creates. It never touches your other calendars.
- **If Google or Microsoft signs you out** (password change, revoked access), the account shows "Sign in again" instead of failing quietly.

## Deploy to Cloudflare (when you want it on your phone everywhere)

1. `npx wrangler d1 create life-db`, paste the id into `apps/worker/wrangler.toml`, then `npx wrangler d1 migrations apply life-db --remote` (applies `0001` to `0011`).
2. Secrets from the `wrangler.toml` comments: at least `TOKEN_KEY`. For Gmail, Outlook and calendars also `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET` (whichever you use), and set the `PUBLIC_URL` variable.
3. Cloudflare Pages project from this repo: build `npm run build`, output `apps/web/dist`.
4. Zero Trust > Access: one application for your domain (passkey or email one-time code), allow only your email. Copy the AUD tag and team domain into `wrangler.toml`, then `npx wrangler deploy` from `apps/worker` and route `yourdomain/api/*` to it.
5. Optional: R2 bucket for nightly backups (uncomment the binding in `wrangler.toml`).
6. Optional, for the family link: add an Access **Bypass** policy for exactly these paths so the shared page can load without a login: `/family`, `/assets/*`, `/fonts/*`, `/icon.svg`, and `/api/family/view`. The Worker protects that one API route with its own unguessable, expiring token.
7. Optional, for sleep from a phone Shortcut: create an Access **service token**, put its client ID in `ALLOWED_SERVICE_TOKENS`, and have the Shortcut `POST /api/ingest/sleep` with `CF-Access-Client-Id` / `CF-Access-Client-Secret` and `{"bedAt": "...Z", "wakeAt": "...Z"}`.

## Tested how

- `npm test`: 200 automated tests (scheduler, sleep, email, gym, ICS, Access login, food parsing, every API route against real SQL, backup and restore round trip, sign-in and token handling, automatic email checking, and the database upgrade with existing data).
- An end-to-end browser run (Playwright) over the real running stack: onboarding, every page, real calendar feed, real food and barcode lookups, backup and restore, family link, kill switch, accessibility scan (no serious or critical issues), phone and desktop layouts.
- A stand-in Home Assistant server, faked Claude streams, and a stand-in Google and Microsoft (sign-in, calendar and mail) are used where no real account exists. Those integrations follow the documented APIs but have not met the real services.
- Not yet run against a real Cloudflare Access login or a deployed Worker.
