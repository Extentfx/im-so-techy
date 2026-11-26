import type { HealthResponse } from '@life/shared';
import { verifyAccessJwt } from './access';

export interface Env {
  DB: D1Database;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  ALLOWED_EMAIL: string;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

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
      return json(body);
    }
    return json({ error: 'not_found' }, 404);
  },
} satisfies ExportedHandler<Env>;
