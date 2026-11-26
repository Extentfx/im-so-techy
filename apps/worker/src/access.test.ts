import { describe, expect, it } from 'vitest';
import { verifyAccessJwt, type AccessConfig } from './access';

const cfg: AccessConfig = {
  teamDomain: 'https://team.cloudflareaccess.com',
  aud: 'aud-123',
  allowedEmail: 'me@example.com',
};
const now = 1_700_000_000;

const b64url = (data: ArrayBuffer | string): string => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
};

async function setup() {
  const pair = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const jwk = {
    ...(await crypto.subtle.exportKey('jwk', pair.publicKey)),
    kid: 'k1',
  } as unknown as JsonWebKey & { kid: string };
  const sign = async (claims: Record<string, unknown>, alg = 'RS256') => {
    const h = b64url(JSON.stringify({ alg, kid: 'k1' }));
    const p = b64url(JSON.stringify(claims));
    const sig = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      pair.privateKey,
      new TextEncoder().encode(`${h}.${p}`),
    );
    return `${h}.${p}.${b64url(sig)}`;
  };
  return { keys: async () => [jwk], sign };
}

const good = { aud: ['aud-123'], iss: cfg.teamDomain, exp: now + 300, email: 'ME@example.com' };

describe('verifyAccessJwt', () => {
  it('accepts a valid token for the owner', async () => {
    const { keys, sign } = await setup();
    expect(await verifyAccessJwt(await sign(good), cfg, keys, now)).toEqual({
      email: 'ME@example.com',
    });
  });

  it('rejects a missing token or empty config', async () => {
    const { keys, sign } = await setup();
    expect(await verifyAccessJwt(null, cfg, keys, now)).toBeNull();
    expect(await verifyAccessJwt(await sign(good), { ...cfg, aud: '' }, keys, now)).toBeNull();
  });

  it('rejects expired, wrong audience, wrong issuer and wrong email', async () => {
    const { keys, sign } = await setup();
    expect(await verifyAccessJwt(await sign({ ...good, exp: now - 1 }), cfg, keys, now)).toBeNull();
    expect(
      await verifyAccessJwt(await sign({ ...good, aud: ['other'] }), cfg, keys, now),
    ).toBeNull();
    expect(
      await verifyAccessJwt(await sign({ ...good, iss: 'https://evil.example' }), cfg, keys, now),
    ).toBeNull();
    expect(
      await verifyAccessJwt(await sign({ ...good, email: 'x@example.com' }), cfg, keys, now),
    ).toBeNull();
  });

  it('rejects a tampered payload and non-RS256 algorithms', async () => {
    const { keys, sign } = await setup();
    const [h, , s] = (await sign(good)).split('.');
    const forged = `${h}.${b64url(JSON.stringify({ ...good, email: 'x@example.com' }))}.${s}`;
    expect(await verifyAccessJwt(forged, cfg, keys, now)).toBeNull();
    expect(await verifyAccessJwt(await sign(good, 'none'), cfg, keys, now)).toBeNull();
  });
});

describe('service tokens', () => {
  const svc = {
    aud: ['aud-123'],
    iss: cfg.teamDomain,
    exp: now + 300,
    common_name: 'shortcut.access',
  };
  it('accepts only listed service tokens', async () => {
    const { keys, sign } = await setup();
    const tok = await sign(svc);
    expect(
      await verifyAccessJwt(tok, { ...cfg, serviceTokenIds: ['shortcut.access'] }, keys, now),
    ).toEqual({ email: 'service:shortcut.access', service: true });
    expect(await verifyAccessJwt(tok, cfg, keys, now)).toBeNull();
    expect(
      await verifyAccessJwt(tok, { ...cfg, serviceTokenIds: ['other.access'] }, keys, now),
    ).toBeNull();
  });
});
