import { describe, expect, it } from 'vitest';
import type { Env } from './env';
import {
  buildAuthUrl,
  extractGmailText,
  gmailToMessage,
  htmlToText,
  mapGoogleEvent,
  mapMsEvent,
  msToMessage,
  scopesFor,
} from './providers';

const b64 = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('scopes (least privilege)', () => {
  it('asks only for what each feature needs, and never for anything that can send, delete or modify', () => {
    const all = [
      ...scopesFor('google', ['mail', 'calendar']),
      ...scopesFor('microsoft', ['mail', 'calendar']),
    ].join(' ');
    expect(scopesFor('google', ['mail'])).toEqual([
      'openid',
      'email',
      'https://www.googleapis.com/auth/gmail.readonly',
    ]);
    expect(scopesFor('google', ['calendar'])).toEqual([
      'openid',
      'email',
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/calendar.app.created',
    ]);
    expect(scopesFor('microsoft', ['mail'])).toEqual([
      'offline_access',
      'openid',
      'email',
      'User.Read',
      'Mail.Read',
    ]);
    expect(scopesFor('microsoft', ['calendar'])).toContain('Calendars.Read');
    for (const bad of [
      'gmail.modify',
      'gmail.send',
      'gmail.compose',
      'mail.send',
      'mail.readwrite',
      'calendars.readwrite',
      'auth/calendar ',
      'auth/calendar.events',
    ]) {
      expect(all.toLowerCase()).not.toContain(bad.toLowerCase());
    }
  });

  it('builds a sign-in link with PKCE, offline access for Google, and no client secret', () => {
    const env = {
      GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'sekrit',
    } as Env;
    const u = new URL(
      buildAuthUrl(env, 'google', {
        redirectUri: 'https://life.example.com/api/oauth/callback/google',
        state: 'st',
        challenge: 'ch',
        features: ['mail'],
      }),
    );
    expect(u.host).toBe('accounts.google.com');
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      client_id: 'cid.apps.googleusercontent.com',
      response_type: 'code',
      code_challenge: 'ch',
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent',
      state: 'st',
    });
    expect(u.toString()).not.toContain('sekrit');
    const ms = new URL(
      buildAuthUrl(
        { MS_CLIENT_ID: 'm', MS_CLIENT_SECRET: 's', MS_TENANT: 'contoso' } as Env,
        'microsoft',
        { redirectUri: 'r', state: 's', challenge: 'c', features: ['calendar'] },
      ),
    );
    expect(ms.pathname).toBe('/contoso/oauth2/v2.0/authorize');
    expect(ms.searchParams.get('access_type')).toBeNull();
  });
});

describe('Google events', () => {
  it('converts offsets to UTC, keeps all-day dates, and drops cancelled or malformed items', () => {
    expect(
      mapGoogleEvent({
        id: 'a',
        summary: 'Shift',
        start: { dateTime: '2026-03-02T09:00:00-05:00' },
        end: { dateTime: '2026-03-02T17:30:00-05:00' },
        location: ' Ward 4 ',
      }),
    ).toEqual({
      key: 'a',
      title: 'Shift',
      start: '2026-03-02T14:00:00Z',
      end: '2026-03-02T22:30:00Z',
      allDay: false,
      location: 'Ward 4',
    });
    expect(
      mapGoogleEvent({
        id: 'b',
        summary: 'Holiday',
        start: { date: '2026-07-04' },
        end: { date: '2026-07-05' },
      }),
    ).toMatchObject({ allDay: true, start: '2026-07-04', end: '2026-07-05' });
    expect(
      mapGoogleEvent({
        id: 'c',
        status: 'cancelled',
        start: { date: '2026-07-04' },
        end: { date: '2026-07-05' },
      }),
    ).toBeNull();
    expect(
      mapGoogleEvent({ id: 'd', start: { dateTime: 'garbage' }, end: { dateTime: 'x' } }),
    ).toBeNull();
    expect(
      mapGoogleEvent({
        summary: 'no id',
        start: { date: '2026-07-04' },
        end: { date: '2026-07-05' },
      }),
    ).toBeNull();
    expect(
      mapGoogleEvent({ id: 'e', start: { date: '2026-07-04' }, end: { date: '2026-07-05' } })!
        .title,
    ).toBe('(no title)');
  });
});

describe('Microsoft events', () => {
  it('reads UTC times without a Z, all-day events, and skips cancelled ones', () => {
    expect(
      mapMsEvent({
        id: 'x',
        subject: 'Class',
        start: { dateTime: '2026-03-02T14:00:00.0000000' },
        end: { dateTime: '2026-03-02T15:00:00.0000000' },
        location: { displayName: 'Room 2' },
      }),
    ).toEqual({
      key: 'x',
      title: 'Class',
      start: '2026-03-02T14:00:00Z',
      end: '2026-03-02T15:00:00Z',
      allDay: false,
      location: 'Room 2',
    });
    expect(
      mapMsEvent({
        id: 'y',
        subject: 'Trip',
        isAllDay: true,
        start: { dateTime: '2026-03-02T00:00:00.0000000' },
        end: { dateTime: '2026-03-04T00:00:00.0000000' },
      }),
    ).toMatchObject({ allDay: true, start: '2026-03-02', end: '2026-03-04' });
    expect(
      mapMsEvent({
        id: 'z',
        isCancelled: true,
        start: { dateTime: '2026-03-02T00:00:00' },
        end: { dateTime: '2026-03-02T01:00:00' },
      }),
    ).toBeNull();
  });
});

describe('reading message bodies', () => {
  it('prefers plain text, falls back to HTML, and walks nested multipart messages', () => {
    expect(extractGmailText({ mimeType: 'text/plain', body: { data: b64('Hello there') } })).toBe(
      'Hello there',
    );
    const nested = {
      mimeType: 'multipart/mixed',
      parts: [
        {
          mimeType: 'multipart/alternative',
          parts: [
            { mimeType: 'text/plain', body: { data: b64('Plain wins') } },
            { mimeType: 'text/html', body: { data: b64('<p>HTML loses</p>') } },
          ],
        },
        { mimeType: 'application/pdf', body: {} },
      ],
    };
    expect(extractGmailText(nested)).toBe('Plain wins');
    expect(
      extractGmailText({
        mimeType: 'text/html',
        body: { data: b64('<div>Picnic on <b>March 20</b></div><script>evil()</script>') },
      }),
    ).toBe('Picnic on March 20');
    expect(extractGmailText(undefined)).toBe('');
    expect(
      extractGmailText({ mimeType: 'text/plain', body: { data: b64('x'.repeat(20000)) } }),
    ).toHaveLength(8000);
  });

  it('turns provider messages into the shape the reader takes, and skips empty ones', () => {
    const g = gmailToMessage({
      id: 'm1',
      payload: {
        mimeType: 'text/plain',
        headers: [
          { name: 'FROM', value: 'a@b.com' },
          { name: 'subject', value: 'Hi' },
        ],
        body: { data: b64('Body') },
      },
    });
    expect(g).toEqual({ id: 'm1', from: 'a@b.com', subject: 'Hi', body: 'Body' });
    expect(
      gmailToMessage({ id: 'm2', payload: { mimeType: 'text/plain', body: { data: b64('   ') } } }),
    ).toBeNull();
    expect(
      msToMessage({
        id: 'x',
        subject: 'S',
        from: { emailAddress: { address: 'f@g.com' } },
        body: { contentType: 'html', content: '<p>Hi<br>there</p>' },
      }),
    ).toEqual({ id: 'x', from: 'f@g.com', subject: 'S', body: 'Hi\nthere' });
    expect(msToMessage({ id: 'y', body: { content: '' } })).toBeNull();
  });

  it('strips markup and entities', () => {
    expect(
      htmlToText(
        '<style>a{}</style><p>Tom &amp; Jerry&nbsp;&lt;3</p><ul><li>One</li><li>Two</li></ul>',
      ),
    ).toBe('Tom & Jerry <3\nOne\nTwo');
  });
});
