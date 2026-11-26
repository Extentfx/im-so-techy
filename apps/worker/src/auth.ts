import { verifyAccessJwt, type AccessConfig } from './access';
import type { Env } from './env';

/**
 * Who is calling? Normally the verified Cloudflare Access identity.
 *
 * Local development only: when `LOCAL_DEV=1` is set (in `.dev.vars`, never in wrangler.toml or
 * deployed secrets) the request is treated as the owner, but ONLY if it arrives on localhost
 * and does not carry the `cf-ray` header Cloudflare's edge always adds. Anything else fails closed.
 */
export async function resolveUser(
  request: Request,
  env: Pick<Env, 'ACCESS_TEAM_DOMAIN' | 'ACCESS_AUD' | 'ALLOWED_EMAIL'> & {
    LOCAL_DEV?: string;
    ALLOWED_SERVICE_TOKENS?: string;
  },
  verify: typeof verifyAccessJwt = verifyAccessJwt,
): Promise<{ email: string; service?: boolean } | null> {
  if (env.LOCAL_DEV === '1' && isLocalRequest(request)) return { email: 'local@localhost' };
  const cfg: AccessConfig = {
    teamDomain: env.ACCESS_TEAM_DOMAIN,
    aud: env.ACCESS_AUD,
    allowedEmail: env.ALLOWED_EMAIL,
    serviceTokenIds: (env.ALLOWED_SERVICE_TOKENS ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  };
  return verify(request.headers.get('cf-access-jwt-assertion'), cfg);
}

export function isLocalRequest(request: Request): boolean {
  const host = new URL(request.url).hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') return false;
  // Cloudflare's edge always adds `cf-ray`; the local dev server never does.
  return !request.headers.has('cf-ray');
}
