import type { HealthResponse } from '@life/shared';
import { verifyAccessJwt } from './access';
import { handleApi } from './api';
import type { Env } from './env';
import { syncAll } from './sync';

export type { Env };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Defense in depth: even if a route is misconfigured outside Access, we fail closed here.
    const user = await verifyAccessJwt(request.headers.get('cf-access-jwt-assertion'), {
      teamDomain: env.ACCESS_TEAM_DOMAIN,
      aud: env.ACCESS_AUD,
      allowedEmail: env.ALLOWED_EMAIL,
    });
    if (!user) return new Response(null, { status: 401 });

    const url = new URL(request.url);
    if (url.pathname === '/api/health' && request.method === 'GET') {
      const body: HealthResponse = { ok: true, user: user.email };
      return new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      });
    }
    try {
      return await handleApi(request, env);
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
    ctx.waitUntil(syncAll(env));
  },
} satisfies ExportedHandler<Env>;
