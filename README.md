# Life Dashboard

A private, calm dashboard that plans your week around work, school and family, and tracks gym, food and sleep. See `CLAUDE.md` for rules and `DECISIONS.md` for choices.

**Status:** Phase 0 (foundation) and the calendar-link half of Phase 1 are built. Cloudflare setup below is still manual. See "Phase 1 status" at the bottom.

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

To add a calendar, open the round button in the bottom-right corner, choose Plan, and paste an ICS link (Google Calendar: settings for the calendar, "Secret address in iCal format").

Manual pieces: `npm run dev` (web only), `npm run dev -w @life/worker` (Worker only).

## One-time Cloudflare setup (Phase 0 remaining)

1. `npx wrangler d1 create life-db`, paste the id into `apps/worker/wrangler.toml`, then `npx wrangler d1 migrations apply life-db --remote` (applies `0001` and `0002`).
2. Create a Cloudflare Pages project from this repo: build `npm run build`, output `apps/web/dist`.
3. Zero Trust > Access: create an application for your domain (passkey or email one-time code), allow only your email. Copy the AUD tag and team domain into `wrangler.toml`.
4. `npx wrangler deploy` from `apps/worker`, then route `yourdomain/api/*` to it.

Done when a logged-in phone shows the Today shell and a logged-out request gets nothing.

## Phase 1 status (calendars and work shifts)

Built and tested (42 worker tests run the real SQL against SQLite):

- Add calendars by **ICS / webcal link** (work, school, family). Links are stored AES-GCM encrypted and are never sent back to the browser. Only public https hosts are fetched; redirects are re-checked; feeds are capped at 2 MB.
- Worker cron refreshes every feed every 15 minutes, keeping 7 days back and 90 days ahead.
- Parser handles time zones (including daylight saving), all-day events, daily and weekly repeats, cancelled events and edited single occurrences. Monthly and yearly repeats show their first occurrence only, with a warning.
- Unified week view (Plan) with a colour per calendar type, today's schedule on Today.
- **Shift change alerts**: when a work calendar changes after its first sync, you get an old-versus-new alert until you tap "Got it". Edits that regenerate IDs are still recognised as one change.

Not built yet, and why:

- Google Calendar and Microsoft Graph sign-in (OAuth), and the dedicated "Dashboard" calendar the app writes to. These need your own Google / Microsoft app credentials, so they wait for you.
- Shift intake from schedule email or a photo/PDF roster read by Claude.
- Saving onboarding answers in D1 (they still live in the browser).
