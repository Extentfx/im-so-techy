import { describe, expect, it } from 'vitest';
import { harness, NOW } from './helpers';

// NOW = Mon 2026-03-02 08:00Z = 03:00 in New York.
async function setup() {
  const h = harness();
  await h.json('PUT', '/api/profile', {
    completed: true,
    timezone: 'America/New_York',
    sleepHours: 8,
    wakeTime: '06:30',
  });
  return h;
}

describe('sleep', () => {
  it('records a night from manual times, keyed by the local wake date, and upserts', async () => {
    const h = await setup();
    const r = await h.json<{ date: string; minutes: number }>('POST', '/api/sleep', {
      bedAt: '2026-03-02T03:00:00Z',
      wakeAt: '2026-03-02T10:30:00Z',
    }); // wait: in the future? NOW is 08:00Z
    expect(r._status).toBe(400); // wake time is after "now"
    const ok = await h.json<{ date: string; minutes: number }>('POST', '/api/sleep', {
      bedAt: '2026-03-01T04:00:00Z',
      wakeAt: '2026-03-01T11:30:00Z',
    });
    expect(ok).toMatchObject({ date: '2026-03-01', minutes: 450 });
    await h.json('POST', '/api/sleep', {
      bedAt: '2026-03-01T05:00:00Z',
      wakeAt: '2026-03-01T11:30:00Z',
    });
    const g = await h.json<{ nights: { date: string; minutes: number }[] }>('GET', '/api/sleep');
    expect(g.nights).toEqual([{ date: '2026-03-01', minutes: 390 }]);
  });

  it('rejects impossible durations and malformed times', async () => {
    const h = await setup();
    expect(
      (
        await h.json('POST', '/api/sleep', {
          bedAt: '2026-03-01T04:00:00Z',
          wakeAt: '2026-03-01T04:30:00Z',
        })
      )._status,
    ).toBe(400);
    expect(
      (
        await h.json('POST', '/api/sleep', {
          bedAt: '2026-02-28T04:00:00Z',
          wakeAt: '2026-03-01T11:30:00Z',
        })
      )._status,
    ).toBe(400);
    expect((await h.json('POST', '/api/sleep', { bedAt: 'x', wakeAt: 'y' }))._status).toBe(400);
  });

  it('supports one-tap bed and wake', async () => {
    const h = await setup();
    expect((await h.json('POST', '/api/sleep/wake'))._status).toBe(409);
    h.setNow(Date.parse('2026-03-01T03:00:00Z'));
    await h.json('POST', '/api/sleep/bed');
    expect((await h.json<{ open: string }>('GET', '/api/sleep')).open).toBe('2026-03-01T03:00:00Z');
    h.setNow(Date.parse('2026-03-01T10:15:00Z'));
    const w = await h.json<{ minutes: number }>('POST', '/api/sleep/wake');
    expect(w.minutes).toBe(435);
    expect((await h.json<{ open: string | null }>('GET', '/api/sleep')).open).toBeNull();
  });

  it('computes debt and makes the scheduler propose light sessions after a bad night', async () => {
    const h = await setup();
    // 5h last night (woke Mar 2 local), target 8h
    h.setNow(NOW + 3_600_000);
    await h.json('POST', '/api/sleep', {
      bedAt: '2026-03-02T03:00:00Z',
      wakeAt: '2026-03-02T08:00:00Z',
    });
    const g = await h.json<{ debtHours: number; recovery: { light: boolean; reason: string } }>(
      'GET',
      '/api/sleep',
    );
    expect(g.debtHours).toBe(3);
    expect(g.recovery).toMatchObject({ light: true });
    expect(g.recovery.reason).toMatch(/slept 5h/);
    const slots = await h.json<{ light: boolean; slots: { start: string; end: string }[] }>(
      'GET',
      '/api/plan/slots?date=2026-03-04',
    );
    expect(slots.light).toBe(true);
    expect(Date.parse(slots.slots[0]!.end) - Date.parse(slots.slots[0]!.start)).toBe(35 * 60_000);
    const week = await h.json<{ sessions: unknown[] }>('POST', '/api/plan/week', {
      start: '2026-03-02',
    });
    expect(week.sessions.length).toBeGreaterThan(0);
    const props = await h.json<{ proposals: { payload: { title: string } }[] }>(
      'GET',
      '/api/proposals',
    );
    expect(props.proposals.every((p) => p.payload.title === 'Light session')).toBe(true);
  });

  it("suggests a bedtime from tomorrow's first commitment", async () => {
    const h = await setup();
    h.setFeed(
      'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:e\r\nDTSTART:20260303T110000Z\r\nDTEND:20260303T190000Z\r\nSUMMARY:Early shift\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n',
    );
    await h.json('POST', '/api/sources', {
      name: 'Work',
      kind: 'work',
      url: 'https://cal.example.com/w.ics',
    });
    const g = await h.json<{ suggestion: { basedOn: string; bedtime: string; wake: string } }>(
      'GET',
      '/api/sleep',
    );
    // 2026-03-03 11:00Z is 06:00 ET, so wake 05:00 ET = 10:00Z, bed 8h earlier = 02:00Z... on the 3rd
    expect(g.suggestion).toMatchObject({ basedOn: 'Early shift', wake: '2026-03-03T10:00:00Z' });
    expect(Date.parse(g.suggestion.wake) - Date.parse(g.suggestion.bedtime)).toBe(8 * 3_600_000);
  });
});
