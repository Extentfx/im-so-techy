/**
 * Cloudflare Access JWT verification (RS256) using WebCrypto only.
 * Fails closed: any missing config, bad signature, wrong audience/issuer,
 * expiry or unexpected email returns null.
 */

export interface AccessConfig {
  teamDomain: string; // https://<team>.cloudflareaccess.com
  aud: string;
  allowedEmail: string;
  /** Cloudflare Access service-token client IDs allowed to call /api/ingest/* (comma separated in env). */
  serviceTokenIds?: string[];
}

interface Jwk extends JsonWebKey {
  kid?: string;
}

const b64urlToBytes = (s: string): Uint8Array => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

const decodeJson = <T>(s: string): T => JSON.parse(new TextDecoder().decode(b64urlToBytes(s))) as T;

export type KeyFetcher = (teamDomain: string) => Promise<Jwk[]>;

export const fetchAccessKeys: KeyFetcher = async (teamDomain) => {
  const res = await fetch(`${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error('certs fetch failed');
  const body = (await res.json()) as { keys: Jwk[] };
  return body.keys;
};

export async function verifyAccessJwt(
  token: string | null,
  cfg: AccessConfig,
  getKeys: KeyFetcher = fetchAccessKeys,
  now: number = Math.floor(Date.now() / 1000),
): Promise<{ email: string; service?: boolean } | null> {
  try {
    if (!token || !cfg.teamDomain || !cfg.aud || !cfg.allowedEmail) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [h, p, sig] = parts as [string, string, string];

    const header = decodeJson<{ alg: string; kid?: string }>(h);
    if (header.alg !== 'RS256') return null;

    const keys = await getKeys(cfg.teamDomain);
    const jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk) return null;

    const key = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      b64urlToBytes(sig),
      new TextEncoder().encode(`${h}.${p}`),
    );
    if (!ok) return null;

    const claims = decodeJson<{
      aud?: string | string[];
      iss?: string;
      exp?: number;
      nbf?: number;
      email?: string;
      common_name?: string;
    }>(p);
    const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!auds.includes(cfg.aud)) return null;
    if (claims.iss !== cfg.teamDomain) return null;
    if (typeof claims.exp !== 'number' || claims.exp <= now) return null;
    if (typeof claims.nbf === 'number' && claims.nbf > now + 60) return null;
    if (claims.common_name && !claims.email) {
      // A service token (for example an iOS Shortcut). Only listed IDs, and the Worker restricts where they can go.
      return cfg.serviceTokenIds?.includes(claims.common_name)
        ? { email: `service:${claims.common_name}`, service: true }
        : null;
    }
    if (!claims.email || claims.email.toLowerCase() !== cfg.allowedEmail.toLowerCase()) return null;
    return { email: claims.email };
  } catch {
    return null;
  }
}
