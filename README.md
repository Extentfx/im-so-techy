# Life Dashboard

A private, calm dashboard that plans your week around work, school and family, and tracks gym, food and sleep. See `CLAUDE.md` for rules and `DECISIONS.md` for choices.

**Status:** Phase 0 (foundation) code is in place. Cloudflare setup below is still manual.

## Run locally

```sh
npm install
npm run dev            # web on :5173, proxies /api to :8787
npm run dev -w @life/worker   # Worker (needs apps/worker/.dev.vars, see below)
```

`apps/worker/.dev.vars` (never committed): `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `ALLOWED_EMAIL`.

## One-time Cloudflare setup (Phase 0 remaining)

1. `npx wrangler d1 create life-db`, paste the id into `apps/worker/wrangler.toml`, then `npx wrangler d1 migrations apply life-db --remote`.
2. Create a Cloudflare Pages project from this repo: build `npm run build`, output `apps/web/dist`.
3. Zero Trust > Access: create an application for your domain (passkey or email one-time code), allow only your email. Copy the AUD tag and team domain into `wrangler.toml`.
4. `npx wrangler deploy` from `apps/worker`, then route `yourdomain/api/*` to it.

Done when a logged-in phone shows the Today shell and a logged-out request gets nothing.
