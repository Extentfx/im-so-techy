import { describe, expect, it } from 'vitest';
import {
  dumpAll,
  familyView,
  makeBackup,
  restoreBackup,
  runNightlyBackup,
  runReminders,
  toCsv,
} from '../src/admin';
import { encrypt } from '../src/crypto';
import { harness, NOW, type Harness } from './helpers';

const ics = (events: string[]) => `BEGIN:VCALENDAR\r\n${events.join('\r\n')}\r\nEND:VCALENDAR\r\n`;
const ev = (uid: string, title: string, s: string, e: string, extra = '') =>
  `BEGIN:VEVENT\r\nUID:${uid}\r\nDTSTART:${s}\r\nDTEND:${e}\r\nSUMMARY:${title}\r\n${extra}END:VEVENT`;

/** Fill most tables with realistic data. */
async function populate(h: Harness) {
  await h.json('PUT', '/api/profile', {
    completed: true,
    name: 'Sam',
    timezone: 'America/New_York',
    calorieTarget: 2200,
  });
  await h.json('POST', '/api/workouts', {
    startedAt: '2026-03-01T22:00:00Z',
    endedAt: '2026-03-01T23:00:00Z',
    sets: [
      { exerciseId: 'bench-press', reps: 5, weightKg: 100 },
      { exerciseId: 'deadlift', reps: 3, weightKg: 140 },
    ],
  });
  await h.json('POST', '/api/bodyweight', { date: '2026-03-01', kg: 82.4 });
  await h.json('POST', '/api/food/log', {
    date: '2026-03-02',
    slot: 'lunch',
    name: 'Salad, "large"',
    kcal: 300,
    protein: 10,
  });
  await h.json('POST', '/api/foods', { name: 'Shake', kcal: 160, protein: 30 });
  await h.json('POST', '/api/meals', { name: 'Usual', items: [{ name: 'Oats', kcal: 150 }] });
  await h.json('PUT', '/api/lunch/rules', { rules: [{ weekday: 1, name: 'Pizza', kcal: 420 }] });
  await h.json('POST', '/api/sleep', {
    bedAt: '2026-03-01T04:00:00Z',
    wakeAt: '2026-03-01T11:30:00Z',
  });
  await h.json('POST', '/api/email/ingest', {
    from: 'a@b.com',
    subject: 'Party',
    body: 'Birthday party on March 20 at 2pm.',
  });
  await h.json('POST', '/api/templates', {
    name: 'Push',
    items: [{ exerciseId: 'bench-press', sets: 3, reps: 8 }],
  });
  h.setFeed(ics([ev('k', 'Assembly', '20260310T130000Z', '20260310T140000Z')]));
  await h.json('POST', '/api/sources', {
    name: 'School',
    kind: 'school',
    url: 'https://cal.example.com/s.ics?token=SECRETFEED',
  });
  const p = await h.json<{ id: string }>('POST', '/api/proposals', {
    kind: 'calendar_event',
    payload: { title: 'Dentist', start: '2026-03-05T15:00:00Z', end: '2026-03-05T16:00:00Z' },
  });
  await h.json('POST', `/api/proposals/${p.id}/approve`);
}

describe('backup and restore', () => {
  it('round-trips every table into a brand-new database, including encrypted secrets', async () => {
    const a = harness();
    await populate(a);
    const blob = await makeBackup(a.env, NOW);
    expect(blob).not.toContain('SECRETFEED');

    const b = harness({ TOKEN_KEY: a.env.TOKEN_KEY });
    const r = await restoreBackup(b.env, blob);
    expect(r.restored.sets).toBe(2);
    expect(await dumpAll(b.env, { secrets: true })).toEqual(
      await dumpAll(a.env, { secrets: true }),
    );

    // the restored encrypted feed URL still works with the same key
    b.setFeed(ics([ev('k', 'Assembly', '20260310T130000Z', '20260310T140000Z')]));
    const src = (await b.json<{ sources: { id: string }[] }>('GET', '/api/sources')).sources[0]!;
    expect((await b.json('POST', `/api/sources/${src.id}/sync`))._status).toBe(200);
  });

  it('restoring replaces whatever is there now', async () => {
    const a = harness();
    await populate(a);
    const blob = await makeBackup(a.env, NOW);
    await a.json('POST', '/api/food/log', {
      date: '2026-03-03',
      slot: 'dinner',
      name: 'Extra',
      kcal: 999,
    });
    await a.json('POST', '/api/foods', { name: 'Late addition', kcal: 5 });
    const res = await a.json<{ restored: Record<string, number> }>('POST', '/api/admin/restore', {
      blob,
      confirm: 'RESTORE',
    });
    expect(res._status).toBe(200);
    expect(
      (await a.json<{ totals: { kcal: number } }>('GET', '/api/food/log?date=2026-03-03')).totals
        .kcal,
    ).toBe(0);
    expect((await a.json<{ foods: unknown[] }>('GET', '/api/foods')).foods.length).toBe(1);
  });

  it('refuses a wrong key, tampering, unconfirmed requests and crafted payloads', async () => {
    const a = harness();
    await populate(a);
    const blob = await makeBackup(a.env, NOW);
    const other = harness();
    await expect(restoreBackup(other.env, blob)).rejects.toThrow('backup_unreadable');
    const parts = blob.split('.');
    await expect(
      restoreBackup(a.env, `${parts[0]}.${parts[1]}.${parts[2]!.slice(0, -4)}AAAA`),
    ).rejects.toThrow('backup_unreadable');
    expect((await a.json('POST', '/api/admin/restore', { blob }))._status).toBe(400);
    expect(
      (await a.json('POST', '/api/admin/restore', { blob: 'garbage', confirm: 'RESTORE' }))._status,
    ).toBe(400);

    // a validly encrypted payload that tries to smuggle SQL through column names is rejected before anything is deleted
    const evil = await encrypt(
      JSON.stringify({
        version: 1,
        tables: { foods: [{ 'id) VALUES (1); DROP TABLE settings;--': 'x' }] },
      }),
      a.env.TOKEN_KEY,
    );
    await expect(restoreBackup(a.env, evil)).rejects.toThrow('backup_has_unknown_columns');
    const evil2 = await encrypt(
      JSON.stringify({ version: 1, tables: { foods: 'nope' } }),
      a.env.TOKEN_KEY,
    );
    await expect(restoreBackup(a.env, evil2)).rejects.toThrow('backup_unreadable');
    expect((await a.json<{ foods: unknown[] }>('GET', '/api/foods')).foods.length).toBe(1); // nothing was wiped
    expect((await a.json<{ exists: boolean }>('GET', '/api/profile')).exists).toBe(true);
  });

  it('downloads an encrypted backup through the API, and keeps a rolling two weeks in R2', async () => {
    const a = harness();
    await populate(a);
    const r = await a.call('POST', '/api/admin/backup');
    expect(r.headers.get('content-disposition')).toMatch(/life-backup-2026-03-02\.enc/);
    expect(await r.text()).toMatch(/^v1\./);

    const store = new Map<string, string>();
    const bucket = {
      put: async (k: string, v: string) => void store.set(k, v),
      list: async () => ({ objects: [...store.keys()].map((key) => ({ key })) }),
      delete: async (k: string) => void store.delete(k),
    };
    const env = { ...a.env, BACKUPS: bucket as unknown as R2Bucket };
    for (let d = 0; d < 20; d++)
      expect(await runNightlyBackup(env, Date.parse('2026-02-01T03:00:00Z') + d * 86_400_000)).toBe(
        true,
      );
    expect(await runNightlyBackup(env, Date.parse('2026-02-20T09:00:00Z'))).toBe(false); // already done that day
    expect(store.size).toBe(14);
    expect([...store.keys()].sort()[0]).toBe('backup-2026-02-07.enc');
    expect(await runNightlyBackup(a.env, NOW)).toBe(false); // no bucket bound: skipped quietly
  });
});

describe('export', () => {
  it('exports your data without any secrets, and CSV that cannot trigger spreadsheet formulas', async () => {
    const h = harness();
    await populate(h);
    await h.json('PUT', '/api/home/config', {
      url: 'https://ha.example.com',
      token: 'x'.repeat(30),
    }); // fails (no network) but must not leak
    const r = await h.call('GET', '/api/admin/export');
    const text = await r.text();
    expect(r.headers.get('content-disposition')).toMatch(/attachment/);
    expect(text).not.toContain('SECRETFEED');
    expect(text).not.toContain('url_enc');
    expect(text).not.toContain('xxxxxxxxxx');
    expect(JSON.parse(text).tables.food_log[0].name).toBe('Salad, "large"');

    const csv = await (await h.call('GET', '/api/admin/export?format=csv&table=food_log')).text();
    expect(csv.split('\n')[0]).toContain('name');
    expect(csv).toContain('"Salad, ""large"""');
    expect(toCsv([{ a: '=HYPERLINK("x")', b: '+1', c: 'fine' }])).toBe(
      'a,b,c\n"\'=HYPERLINK(""x"")",\'+1,fine\n',
    );
    expect((await h.call('GET', '/api/admin/export?format=csv&table=audit_log')).status).toBe(400);
    expect((await h.call('GET', '/api/admin/export?format=csv&table=settings')).status).toBe(400);
    expect((await h.call('GET', '/api/admin/export?format=csv&table=sqlite_master')).status).toBe(
      400,
    );
  });
});

describe('kill switch', () => {
  it('needs an explicit word and then revokes every connection at once, keeping your data', async () => {
    const h = harness();
    await populate(h);
    await h.json('PUT', '/api/notify/config', { topic: 'my-private-topic-1234' });
    await h.json('POST', '/api/family/link', { days: 7 });
    expect((await h.json('POST', '/api/admin/kill', {}))._status).toBe(400);
    expect((await h.json('POST', '/api/admin/kill', { confirm: 'revoke' }))._status).toBe(400);
    const r = await h.json<{ revoked: { calendars: number } }>('POST', '/api/admin/kill', {
      confirm: 'REVOKE',
    });
    expect(r.revoked.calendars).toBe(1);
    expect((await h.json<{ sources: unknown[] }>('GET', '/api/sources')).sources).toHaveLength(0);
    expect((await h.json<{ configured: boolean }>('GET', '/api/notify/config')).configured).toBe(
      false,
    );
    expect((await h.json<{ links: unknown[] }>('GET', '/api/family/links')).links).toHaveLength(0);
    expect(h.raw.prepare('SELECT COUNT(*) n FROM events').get()).toEqual({ n: 0 });
    expect(h.raw.prepare('SELECT COUNT(*) n FROM workouts').get()).toEqual({ n: 1 }); // your own data stays
    expect(
      (await h.json<{ audit: { action: string }[] }>('GET', '/api/audit')).audit[0]!.action,
    ).toBe('kill_switch');
  });
});

describe('notifications', () => {
  it('stores the topic encrypted, validates it, and sends through ntfy from the Worker only', async () => {
    const h = harness();
    const calls: { url: string; title: string | null; body: string }[] = [];
    h.setFetch(
      async (u, init) => (
        calls.push({
          url: String(u),
          title: new Headers(init?.headers).get('title'),
          body: String(init?.body),
        }),
        new Response('ok')
      ),
    );
    expect((await h.json('PUT', '/api/notify/config', { topic: 'short' }))._status).toBe(400);
    expect((await h.json('PUT', '/api/notify/config', { topic: '../../x y' }))._status).toBe(400);
    expect((await h.json('POST', '/api/notify/test'))._status).toBe(502); // not configured
    await h.json('PUT', '/api/notify/config', { topic: 'my-private-topic-1234' });
    expect(JSON.stringify(h.raw.prepare('SELECT * FROM settings').all())).not.toContain(
      'my-private-topic-1234',
    );
    expect((await h.json('POST', '/api/notify/test'))._status).toBe(200);
    expect(calls[0]).toMatchObject({
      url: 'https://ntfy.sh/my-private-topic-1234',
      title: 'Life Dashboard',
    });
  });

  it('notifies when a work shift changes', async () => {
    const h = harness();
    await h.json('PUT', '/api/profile', { completed: true, timezone: 'America/New_York' });
    const calls: string[] = [];
    h.setFetch(async (u, init) => (calls.push(`${u} ${init?.body}`), new Response('ok')));
    await h.json('PUT', '/api/notify/config', { topic: 'my-private-topic-1234' });
    h.setFeed(ics([ev('s1', 'Shift', '20260303T130000Z', '20260303T210000Z')]));
    const { source } = await h.json<{ source: { id: string } }>('POST', '/api/sources', {
      name: 'Hospital',
      kind: 'work',
      url: 'https://cal.example.com/w.ics',
    });
    expect(calls).toEqual([]); // first sync never alerts
    h.setFeed(ics([ev('s1', 'Shift', '20260303T150000Z', '20260303T230000Z')]));
    await h.json('POST', `/api/sources/${source.id}/sync`);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/ntfy\.sh\/my-private-topic-1234 Hospital: changed Shift/);
  });

  it('sends the bedtime reminder once, only if enabled and in its window', async () => {
    const h = harness();
    await h.json('PUT', '/api/profile', {
      completed: true,
      timezone: 'America/New_York',
      wakeTime: '06:30',
      sleepHours: 8,
    });
    const calls: string[] = [];
    h.setFetch(async (u) => (calls.push(String(u)), new Response('ok')));
    await h.json('PUT', '/api/notify/config', { topic: 'my-private-topic-1234' });
    const c = (ms: number) => ({
      env: h.env,
      now: () => ms,
      fetchImpl: ((u: RequestInfo | URL) => (
        calls.push(String(u)),
        Promise.resolve(new Response('ok'))
      )) as typeof fetch,
    });
    const bed = Date.parse('2026-03-03T03:30:00Z'); // 22:30 EST on Mar 2
    expect(await runReminders(c(bed - 25 * 60_000))).toBe(0); // reminder not enabled yet
    await h.json('PUT', '/api/notify/config', { bedtimeReminder: true });
    expect(await runReminders(c(bed - 40 * 60_000))).toBe(0); // too early
    expect(await runReminders(c(bed - 25 * 60_000))).toBe(1);
    expect(await runReminders(c(bed - 20 * 60_000))).toBe(0); // once a day
    expect(calls.filter((x) => x.includes('ntfy.sh'))).toHaveLength(1);
  });
});

describe('family link', () => {
  const view = (h: Harness, token: string, now = NOW) =>
    familyView(new Request(`https://life.example.com/api/family/view?t=${token}`), h.env, now);

  it('shows a read-only week of school, family and Dashboard events, never work, locations or health', async () => {
    const h = harness();
    await populate(h);
    h.setFeed(
      ics([ev('w', 'Secret shift', '20260303T130000Z', '20260303T210000Z', 'LOCATION:Ward 9\r\n')]),
    );
    await h.json('POST', '/api/sources', {
      name: 'Hospital',
      kind: 'work',
      url: 'https://cal.example.com/w.ics',
    });
    h.setFeed(
      ics([
        ev(
          'f',
          'Dinner at Gran',
          '20260304T230000Z',
          '20260305T010000Z',
          'LOCATION:12 Rose St\r\n',
        ),
      ]),
    );
    await h.json('POST', '/api/sources', {
      name: 'Family',
      kind: 'family',
      url: 'https://cal.example.com/f.ics',
    });

    const link = await h.json<{ token: string; expiresAt: string }>('POST', '/api/family/link', {
      days: 3,
    });
    expect(link.token).toHaveLength(43);
    expect(JSON.stringify(h.raw.prepare('SELECT * FROM family_links').all())).not.toContain(
      link.token,
    ); // only a hash is stored

    const r = await view(h, link.token);
    const body = await r.text();
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const j = JSON.parse(body) as { name: string; events: { title: string }[] };
    expect(j.name).toBe("Sam's week");
    // 'Assembly' is on Mar 10, outside this 7-day window
    expect(j.events.map((e) => e.title).sort()).toEqual(['Dentist', 'Dinner at Gran']);
    for (const secret of ['Secret shift', 'Ward 9', '12 Rose St', 'kcal', 'Birthday'])
      expect(body).not.toContain(secret);
  });

  it('answers every bad, expired or revoked token with the same 404', async () => {
    const h = harness();
    await h.json('PUT', '/api/profile', { completed: true });
    const { token } = await h.json<{ token: string }>('POST', '/api/family/link', { days: 1 });
    expect((await view(h, token)).status).toBe(200);
    expect((await view(h, token, NOW + 2 * 86_400_000)).status).toBe(404); // expired
    expect((await view(h, 'x'.repeat(43))).status).toBe(404);
    expect((await view(h, 'short')).status).toBe(404);
    expect((await view(h, '')).status).toBe(404);
    expect((await view(h, `${token}extra`)).status).toBe(404);
    expect((await h.json<{ links: unknown[] }>('GET', '/api/family/links')).links).toHaveLength(1);
    await h.json('DELETE', '/api/family/links');
    expect((await view(h, token)).status).toBe(404); // revoked
  });

  it('caps link lifetime at 30 days', async () => {
    const h = harness();
    const r = await h.json<{ expiresAt: string }>('POST', '/api/family/link', { days: 9999 });
    expect(Date.parse(r.expiresAt) - NOW).toBe(30 * 86_400_000);
  });
});
