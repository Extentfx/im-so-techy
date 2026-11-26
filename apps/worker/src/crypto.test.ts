import { describe, expect, it } from 'vitest';
import { decrypt, encrypt } from './crypto';

const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const other = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));

describe('crypto', () => {
  it('round-trips and never repeats ciphertext', async () => {
    const a = await encrypt('https://cal.example/feed?token=s3cret', key);
    const b = await encrypt('https://cal.example/feed?token=s3cret', key);
    expect(a).not.toBe(b);
    expect(a).not.toContain('s3cret');
    expect(await decrypt(a, key)).toBe('https://cal.example/feed?token=s3cret');
  });
  it('rejects a wrong key, tampering and bad key length', async () => {
    const a = await encrypt('hello', key);
    await expect(decrypt(a, other)).rejects.toThrow();
    const parts = a.split('.');
    const flipped = `${parts[0]}.${parts[1]}.${parts[2]!.slice(0, -4)}AAAA`;
    await expect(decrypt(flipped, key)).rejects.toThrow();
    await expect(encrypt('x', btoa('short'))).rejects.toThrow();
  });
});
