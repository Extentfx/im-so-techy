# Life Dashboard

One private web app that plans the week around work, school and family, then tracks gym, food and sleep.
Spec and roadmap: the "Personal Life Dashboard: Spec and Roadmap" doc. Build one phase per branch and stop at each gate for review.

## Stack and layout

- `apps/web`: Vite, React 18, TypeScript, Tailwind v4, react-three-fiber. PWA via vite-plugin-pwa.
- `apps/worker`: one Cloudflare Worker (`/api/*`), D1 (SQLite) in `migrations/`.
- `packages/shared`: types shared by both.
- Hosting: Cloudflare Pages + Workers, login via Cloudflare Access.

## Commands

`npm run dev` · `npm run build` · `npm run typecheck` · `npm run lint` · `npm test` · `npm run format:check` · `npm run audit:deps`

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
