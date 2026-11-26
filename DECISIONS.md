# Decisions

| Date       | Decision                                                                                        | Why                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 2026-11-26 | Wiped the previous golf-club landing page from the repo; it remains in git history (`d20f42c`). | Requested by owner. Recoverable with `git checkout d20f42c -- .`.                            |
| 2026-11-26 | npm workspaces monorepo (`apps/web`, `apps/worker`, `packages/shared`).                         | Matches the layout in the spec's handoff section.                                            |
| 2026-11-26 | React 18 + react-three-fiber 8, Tailwind v4, Vite 6.                                            | r3f 8 targets React 18; Tailwind v4 needs no config file.                                    |
| 2026-11-26 | Worker verifies the Access JWT itself with WebCrypto (no dependency).                           | Defense in depth; fewer packages to audit.                                                   |
| 2026-11-26 | Backdrop and 3D ring are lazy chunks; the body CSS gradient and an SVG ring are the fallbacks.  | Keeps first load ~50 kB gzip and works with reduced motion or no WebGL.                      |
| 2026-11-26 | Service worker precaches the shell only and never `/api/*`.                                     | API data is private and behind Access.                                                       |
| 2026-11-26 | Left 3 moderate npm audit findings (workbox-build -> glob/minimatch).                           | Build-time only, not shipped; `npm audit --omit=dev` is clean. Revisit when workbox updates. |
