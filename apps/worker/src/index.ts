import type { HealthResponse } from '@life/shared';
import { resolveUser } from './auth';
import { handleApi } from './api';
import type { Env } from './env';
import { allHandlers } from './modules';
import { runRoutines } from './home';
import { syncAll } from './sync';

export type { Env };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Defense in depth: even if a route is misconfigured outside Access, we fail closed here.
    const user = await resolveUser(request, env);
    if (!user) return new Response(null, { status: 401 });
    // Service tokens exist only so a phone Shortcut can post data; they reach nothing else.
    if (user.service && !new URL(request.url).pathname.startsWith('/api/ingest/'))
      return new Response(null, { status: 403 });

    const url = new URL(request.url);
    if (url.pathname === '/api/health' && request.method === 'GET') {
      const body: HealthResponse = { ok: true, user: user.email };
      return new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      });
    }
    try {
      return await handleApi(request, env, undefined, undefined, undefined, allHandlers);
    } catch {
      // Never leak internals (or feed URLs) in error bodies.
      return new Response(JSON.stringify({ error: 'server_error' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }
  },

  /** Every 15 minutes: refresh all calendar feeds and record shift changes. */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        await syncAll(env);
        await runRoutines({ env, now: Date.now, fetchImpl: (i, init) => fetch(i, init) }).catch(
          () => 0,
        );
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
