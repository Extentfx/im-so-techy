import { describe, expect, it } from 'vitest';
import { resolveUser } from './auth';

const base = {
  ACCESS_TEAM_DOMAIN: 'https://t.cloudflareaccess.com',
  ACCESS_AUD: 'aud',
  ALLOWED_EMAIL: 'me@example.com',
};
const never = async () => null;
const always = async () => ({ email: 'me@example.com' });
const req = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers });

describe('resolveUser', () => {
  it('uses the verified Access identity in normal operation', async () => {
    expect(await resolveUser(req('https://life.example.com/api/x'), base, always)).toEqual({
      email: 'me@example.com',
    });
    expect(await resolveUser(req('https://life.example.com/api/x'), base, never)).toBeNull();
  });
  it('allows the local owner only when LOCAL_DEV=1 on localhost', async () => {
    const env = { ...base, LOCAL_DEV: '1' };
    expect(await resolveUser(req('http://localhost:8787/api/x'), env, never)).toEqual({
      email: 'local@localhost',
    });
    expect(await resolveUser(req('http://127.0.0.1:8787/api/x'), env, never)).toEqual({
      email: 'local@localhost',
    });
  });
  it('works with the local dev server, which adds cf-connecting-ip but never cf-ray', async () => {
    const env = { ...base, LOCAL_DEV: '1' };
    expect(
      await resolveUser(
        req('http://localhost:8787/api/x', { 'cf-connecting-ip': '::1' }),
        env,
        never,
      ),
    ).toEqual({ email: 'local@localhost' });
  });
  it('ignores the flag off localhost or when the Cloudflare edge header is present', async () => {
    const env = { ...base, LOCAL_DEV: '1' };
    expect(await resolveUser(req('https://life.example.com/api/x'), env, never)).toBeNull();
    expect(
      await resolveUser(req('http://localhost/api/x', { 'cf-ray': 'abc' }), env, never),
    ).toBeNull();
  });
  it('does nothing without the flag, even on localhost', async () => {
    expect(await resolveUser(req('http://localhost:8787/api/x'), base, never)).toBeNull();
    expect(
      await resolveUser(req('http://localhost:8787/api/x'), { ...base, LOCAL_DEV: '0' }, never),
    ).toBeNull();
  });
});
