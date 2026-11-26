import { beforeEach, describe, expect, it } from 'vitest';
import { handleApi } from '../src/api';
import type { Env } from '../src/env';
import { syncAll, type FeedFetcher } from '../src/sync';
import { makeD1 } from './d1';

const KEY = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const NOW = Date.parse('2026-03-02T08:00:00Z');

const ics = (events: string[]) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events.join('\r\n')}\r\nEND:VCALENDAR\r\n`;
const shift = (uid: string, day: string, from: string, to: string) =>
  `BEGIN:VEVENT\r\nUID:${uid}\r\nDTSTART:2026-03-${day}T${from}00Z\r\nDTEND:2026-03-${day}T${to}00Z\r\nSUMMARY:Shift\r\nEND:VEVENT`.replace(
    /2026-03-(\d\d)T/g,
    '202603$1T',
  );

let env: Env;
let raw: ReturnType<typeof makeD1>['raw'];
let feed = '';
const getFeed: FeedFetcher = async () => feed;

const call = (method: string, path: string, body?: unknown) =>
  handleApi(
    new Request(`https://life.example.com${path}`, {
      method,
      headers: { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }),
    env,
    getFeed,
    () => NOW,
  );

beforeEach(() => {
  const d = makeD1();
  raw = d.raw;
  env = { DB: d.db, TOKEN_KEY: KEY, ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '', ALLOWED_EMAIL: '' };
  feed = ics([shift('s1', '03', '1300', '2100'), shift('s2', '04', '1300', '2100')]);
});

describe('calendar API', () => {
  it('adds a source, syncs it and serves events in a range', async () => {
    const r = await call('POST', '/api/sources', {
      name: 'Hospital',
      kind: 'work',
      url: 'webcal://cal.example.com/me.ics?token=SECRET',
    });
    expect(r.status).toBe(201);
    const { source } = (await r.json()) as {
      source: { id: string; host: string; lastSyncedAt: string };
    };
    expect(source.host).toBe('cal.example.com');
    expect(source.lastSyncedAt).toBeTruthy();

    const ev = await call('GET', '/api/events?from=2026-03-01T00:00:00Z&to=2026-03-08T00:00:00Z');
    const { events } = (await ev.json()) as { events: { kind: string; start: string }[] };
    expect(events.map((e) => e.start)).toEqual(['2026-03-03T13:00:00Z', '2026-03-04T13:00:00Z']);
    expect(events.every((e) => e.kind === 'work')).toBe(true);
  });

  it('never returns or stores the feed URL in the clear', async () => {
    await call('POST', '/api/sources', {
      name: 'School',
      kind: 'school',
      url: 'https://cal.example.com/s.ics?token=TOPSECRET',
    });
    const list = await (await call('GET', '/api/sources')).text();
    expect(list).not.toContain('TOPSECRET');
    const stored = JSON.stringify(raw.prepare('SELECT * FROM calendar_sources').all());
    expect(stored).not.toContain('TOPSECRET');
    const audit = JSON.stringify(raw.prepare('SELECT * FROM audit_log').all());
    expect(audit).not.toContain('TOPSECRET');
    expect(audit).toContain('source.add');
  });

  it('rejects private hosts, bad kinds, cross-origin writes and bad ranges', async () => {
    expect(
      (
        await call('POST', '/api/sources', {
          name: 'x',
          kind: 'work',
          url: 'https://127.0.0.1/a.ics',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call('POST', '/api/sources', {
          name: 'x',
          kind: 'dashboard',
          url: 'https://a.example.com/a.ics',
        })
      ).status,
    ).toBe(400);
    const cross = await handleApi(
      new Request('https://life.example.com/api/sources', {
        method: 'POST',
        headers: { 'sec-fetch-site': 'cross-site' },
        body: '{}',
      }),
      env,
    );
    expect(cross.status).toBe(403);
    expect((await call('GET', '/api/events?from=nope&to=nope')).status).toBe(400);
    expect(
      (await call('GET', '/api/events?from=2026-01-01T00:00:00Z&to=2026-12-01T00:00:00Z')).status,
    ).toBe(400);
  });

  it('keeps a failing source visible with a safe error message', async () => {
    feed = 'this is not a calendar';
    const r = await call('POST', '/api/sources', {
      name: 'Broken',
      kind: 'family',
      url: 'https://cal.example.com/b.ics?token=ZZZ',
    });
    const body = (await r.json()) as { source: { lastError: string }; error: string };
    expect(r.status).toBe(201);
    expect(body.source.lastError).toMatch(/not a calendar feed/);
    expect(JSON.stringify(body)).not.toContain('ZZZ');
  });

  it('first sync raises no alerts; a changed work shift raises one; school calendars never do', async () => {
    const r = await call('POST', '/api/sources', {
      name: 'Hospital',
      kind: 'work',
      url: 'https://cal.example.com/me.ics',
    });
    const id = ((await r.json()) as { source: { id: string } }).source.id;
    expect(
      ((await (await call('GET', '/api/alerts')).json()) as { alerts: unknown[] }).alerts,
    ).toHaveLength(0);

    feed = ics([
      shift('s1', '03', '1500', '2300'),
      shift('s2', '04', '1300', '2100'),
      shift('s3', '05', '1300', '2100'),
    ]);
    await syncAll(env, NOW, getFeed);
    const { alerts } = (await (await call('GET', '/api/alerts')).json()) as {
      alerts: {
        id: number;
        type: string;
        sourceName: string;
        old: { start: string } | null;
        new: { start: string } | null;
      }[];
    };
    expect(alerts.map((a) => a.type).sort()).toEqual(['added', 'changed']);
    const changed = alerts.find((a) => a.type === 'changed')!;
    expect(changed.sourceName).toBe('Hospital');
    expect(changed.old!.start).toBe('2026-03-03T13:00:00Z');
    expect(changed.new!.start).toBe('2026-03-03T15:00:00Z');

    await call('POST', `/api/alerts/${changed.id}/ack`);
    expect(
      ((await (await call('GET', '/api/alerts')).json()) as { alerts: unknown[] }).alerts,
    ).toHaveLength(1);

    await call('DELETE', `/api/sources/${id}`);
    expect(raw.prepare('SELECT COUNT(*) AS n FROM events').get()).toEqual({ n: 0 });
    expect(raw.prepare('SELECT COUNT(*) AS n FROM shift_changes').get()).toEqual({ n: 0 });

    await call('POST', '/api/sources', {
      name: 'School',
      kind: 'school',
      url: 'https://cal.example.com/s.ics',
    });
    feed = ics([shift('z', '03', '0900', '1000')]);
    await syncAll(env, NOW, getFeed);
    expect(
      raw
        .prepare(
          "SELECT COUNT(*) AS n FROM shift_changes WHERE source_id IN (SELECT id FROM calendar_sources WHERE kind='school')",
        )
        .get(),
    ).toEqual({ n: 0 });
  });

  it('caps the number of sources', async () => {
    for (let i = 0; i < 10; i++) {
      expect(
        (
          await call('POST', '/api/sources', {
            name: `c${i}`,
            kind: 'family',
            url: `https://cal.example.com/${i}.ics`,
          })
        ).status,
      ).toBe(201);
    }
    expect(
      (
        await call('POST', '/api/sources', {
          name: 'one more',
          kind: 'family',
          url: 'https://cal.example.com/x.ics',
        })
      ).status,
    ).toBe(400);
  });
});
