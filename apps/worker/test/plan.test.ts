import { describe, expect, it } from 'vitest';
import { harness, type Harness } from './helpers';

const ics = (events: string[]) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events.join('\r\n')}\r\nEND:VCALENDAR\r\n`;
const vevent = (uid: string, startIso: string, endIso: string) =>
  `BEGIN:VEVENT\r\nUID:${uid}\r\nDTSTART:${startIso.replace(/[-:]/g, '')}\r\nDTEND:${endIso.replace(/[-:]/g, '')}\r\nSUMMARY:Shift\r\nEND:VEVENT`;

async function setup(): Promise<{ h: Harness; sourceId: string }> {
  const h = harness();
  await h.json('PUT', '/api/profile', {
    completed: true,
    timezone: 'America/New_York',
    workoutsPerWeek: 3,
    trainTime: 'evening',
  });
  // Tue Mar 3, 06:00-18:00 ET (11:00Z-23:00Z) is a 12 hour shift: no training that day.
  h.setFeed(ics([vevent('long', '2026-03-03T11:00:00Z', '2026-03-03T23:00:00Z')]));
  const r = await h.json<{ source: { id: string } }>('POST', '/api/sources', {
    name: 'Hospital',
    kind: 'work',
    url: 'https://cal.example.com/w.ics',
  });
  return { h, sourceId: r.source.id };
}

describe('scheduler API', () => {
  it('suggests three slots on a free day and none on a day with a long shift', async () => {
    const { h } = await setup();
    const free = await h.json<{ slots: { start: string; end: string }[] }>(
      'GET',
      '/api/plan/slots?date=2026-03-05',
    );
    expect(free.slots).toHaveLength(3);
    const blocked = await h.json<{ slots: unknown[]; blockedByShift: boolean }>(
      'GET',
      '/api/plan/slots?date=2026-03-03',
    );
    expect(blocked.slots).toEqual([]);
    expect(blocked.blockedByShift).toBe(true);
    expect((await h.json('GET', '/api/plan/slots?date=garbage'))._status).toBe(400);
  });

  it('proposes a week of sessions that avoid the long-shift day, and writes nothing until approved', async () => {
    const { h } = await setup();
    const r = await h.json<{ created: string[]; sessions: { dateKey: string }[] }>(
      'POST',
      '/api/plan/week',
      { start: '2026-03-02' },
    );
    expect(r.created).toHaveLength(3);
    expect(r.sessions.map((s) => s.dateKey)).not.toContain('2026-03-03');
    const again = await h.json<{ created: string[] }>('POST', '/api/plan/week', {
      start: '2026-03-02',
    });
    expect(again.created).toHaveLength(0); // no duplicates of pending proposals

    const range = '/api/events?from=2026-03-02T00:00:00Z&to=2026-03-09T00:00:00Z';
    const before = (await h.json<{ events: { kind: string }[] }>('GET', range)).events.filter(
      (e) => e.kind === 'dashboard',
    );
    expect(before).toHaveLength(0);
    await h.json('POST', `/api/proposals/${r.created[0]}/approve`);
    const after = (
      await h.json<{ events: { kind: string; title: string }[] }>('GET', range)
    ).events.filter((e) => e.kind === 'dashboard');
    expect(after).toHaveLength(1);
  });

  it('does not double-book an approved workout', async () => {
    const { h } = await setup();
    const slots = (
      await h.json<{ slots: { start: string; end: string }[] }>(
        'GET',
        '/api/plan/slots?date=2026-03-05',
      )
    ).slots;
    const { id } = await h.json<{ id: string }>('POST', '/api/plan/propose', {
      title: 'Workout',
      start: slots[0]!.start,
      end: slots[0]!.end,
    });
    await h.json('POST', `/api/proposals/${id}/approve`);
    const next = (
      await h.json<{ slots: { start: string; end: string }[] }>(
        'GET',
        '/api/plan/slots?date=2026-03-05',
      )
    ).slots;
    for (const s of next)
      expect(
        Date.parse(s.start) >= Date.parse(slots[0]!.end) + 15 * 60000 ||
          Date.parse(s.end) <= Date.parse(slots[0]!.start) - 15 * 60000,
      ).toBe(true);
  });

  it('re-plans automatically when a changed shift lands on a proposed workout', async () => {
    const { h, sourceId } = await setup();
    const week = await h.json<{ created: string[]; sessions: { start: string; end: string }[] }>(
      'POST',
      '/api/plan/week',
      { start: '2026-03-02' },
    );
    const victim = week.sessions[0]!;

    // The roster changes: a new 3-hour shift now covers the first proposed session.
    const s = Date.parse(victim.start) - 3_600_000;
    const e = Date.parse(victim.end) + 3_600_000;
    const stamp = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
    h.setFeed(
      ics([
        vevent('long', '2026-03-03T11:00:00Z', '2026-03-03T23:00:00Z'),
        vevent('new', stamp(s), stamp(e)),
      ]),
    );
    const sync = await h.json<{ sync: { changes: number } }>(
      'POST',
      `/api/sources/${sourceId}/sync`,
    );
    expect(sync.sync.changes).toBe(1);

    const pending = (
      await h.json<{ proposals: { summary: string; payload: { start: string; end: string } }[] }>(
        'GET',
        '/api/proposals',
      )
    ).proposals;
    expect(pending.find((p) => p.payload.start === victim.start)).toBeUndefined(); // expired
    expect(pending.some((p) => p.summary.startsWith('Re-planned'))).toBe(true);
    for (const p of pending) {
      const overlaps =
        Date.parse(p.payload.start) < e + 900_000 && Date.parse(p.payload.end) > s - 900_000;
      expect(overlaps).toBe(false);
    }
    expect(pending).toHaveLength(3); // the other two stay, one replacement joins
  });
});
