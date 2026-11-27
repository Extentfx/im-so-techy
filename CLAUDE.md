# Life Dashboard

One private web app that plans the week around work, school and family, then tracks gym, food and sleep.
Spec and roadmap: the "Personal Life Dashboard: Spec and Roadmap" doc. All phases (0 to 8) are built; see `README.md` for what each page does and `SECURITY.md` for the review.

## Stack and layout

- `apps/web`: Vite, React 18, TypeScript, Tailwind v4, react-three-fiber. PWA via vite-plugin-pwa.
- `apps/worker`: one Cloudflare Worker (`/api/*`), D1 (SQLite) in `migrations/`. Each feature is a route module in `src/` registered in `src/modules.ts`; tests in `test/` run the real migrations on SQLite.
- `packages/shared`: types and pure logic shared by both (profile validation, scheduler, sleep, email reading, gym maths, time zones). New rules belong here as pure, tested functions.
- Hosting: Cloudflare Pages + Workers, login via Cloudflare Access.

## Commands

`npm run local` (whole app on localhost) · `npm run dev` · `npm run build` · `npm run typecheck` · `npm run lint` · `npm test` · `npm run format:check` · `npm run audit:deps`

## Non-negotiable rules

1. Never commit secrets. Secrets live in Worker secrets / `.dev.vars` (gitignored).
2. The browser never calls third parties. All integrations go through the Worker, which verifies the Cloudflare Access JWT on every request and fails closed.
3. Anything that writes to a calendar or a device is a **proposal** until the user approves. Every write is recorded in `audit_log` with its source (user, chat, scheduler).
4. Email is untrusted input. The model that reads email gets no tools; its output is shown as a proposal only. Store summaries, not bodies.
5. Least privilege: Gmail read-only; calendars write only to the dedicated "Dashboard" calendar; smart home uses an explicit device allowlist; locks/garage/alarm need confirmation.
6. No third-party scripts or analytics. Fonts are self-hosted. Keep the strict CSP in `apps/web/public/_headers`.
7. Scheduler logic is pure functions with unit tests.
8. Visuals: lazy-load three.js, cap DPR at 1.5, pause when the tab is hidden, honor `prefers-reduced-motion`, keep the CSS-gradient fallback.
9. Record choices in `DECISIONS.md`.
10. A route that skips the Access login must be listed in `SECURITY.md` with its reason (today: only `GET /api/family/view`, token-protected). Service-token callers may reach `/api/ingest/*` only.
11. Anything that talks to a device goes through `executeAction` in `home.ts`; anything that proposes a calendar change goes through `createProposal`. Don't add a second path.
12. Never store message bodies, prompts or chat history. Summaries only, redacted.
13. Account tokens are read and refreshed only through `tokens.ts` (`withToken`). Mail access stays read-only: no scope that can send, modify or delete, and no provider call other than GET (the one exception is creating and deleting events in the app-created Google calendar, after approval).
14. Every email, pasted or fetched, goes through `ingestMessage` in `email.ts`. Don't add a second path.
