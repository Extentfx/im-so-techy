import { describe, expect, it } from 'vitest';
import { isSameOrigin, normalizeFeedUrl } from './urlcheck';

describe('normalizeFeedUrl', () => {
  it('accepts public https and webcal feeds', () => {
    expect(normalizeFeedUrl('https://calendar.google.com/calendar/ical/x/basic.ics')?.host).toBe(
      'calendar.google.com',
    );
    expect(normalizeFeedUrl('webcal://outlook.office365.com/owa/x.ics')?.protocol).toBe('https:');
  });
  it.each([
    'http://example.com/a.ics',
    'https://localhost/a.ics',
    'https://intranet/a.ics',
    'https://127.0.0.1/a.ics',
    'https://169.254.169.254/latest',
    'https://[::1]/a.ics',
    'https://user:pw@example.com/a.ics',
    'https://printer.local/a.ics',
    'https://2130706433/a.ics',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'not a url',
  ])('rejects %s', (u) => {
    expect(normalizeFeedUrl(u)).toBeNull();
  });
});

describe('isSameOrigin', () => {
  const mk = (h: Record<string, string>) =>
    new Request('https://life.example.com/api/x', { method: 'POST', headers: h });
  it('trusts same-origin fetch metadata or a matching Origin', () => {
    expect(isSameOrigin(mk({ 'sec-fetch-site': 'same-origin' }))).toBe(true);
    expect(isSameOrigin(mk({ origin: 'https://life.example.com' }))).toBe(true);
  });
  it('rejects cross-site and header-less requests', () => {
    expect(isSameOrigin(mk({ 'sec-fetch-site': 'cross-site' }))).toBe(false);
    expect(isSameOrigin(mk({ origin: 'https://evil.example' }))).toBe(false);
    expect(isSameOrigin(mk({}))).toBe(false);
  });
});
