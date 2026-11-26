import { describe, expect, it } from 'vitest';
import { atLocal } from './tz';
import {
  blockedByLongShift,
  freeWindows,
  planWeek,
  scoreSlot,
  suggestSlots,
  type Busy,
  type History,
  type SchedProfile,
} from './scheduler';

const TZ = 'America/New_York';
const P: SchedProfile = {
  wakeTime: '06:30',
  sleepHours: 8, // bed 22:30
  sessionMinutes: 60,
  noTrainWithinBedtimeHours: 2, // last session must end by 20:30
  noTrainOnShiftOverHours: 10,
  trainTime: 'evening',
  timezone: TZ,
};
const H: History = { hours: [], lastDay: null };
const at = (day: string, hhmm: string) => atLocal(day, hhmm, TZ);
const ev = (day: string, a: string, b: string, kind = 'family'): Busy => ({
  start: at(day, a),
  end: at(day, b),
  kind,
});
const hhmm = (ms: number) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(ms);
const DAY = '2026-03-04'; // Wednesday

describe('freeWindows', () => {
  it('is the waking day minus meals, from 07:00 to two hours before bed', () => {
    const w = freeWindows(DAY, [], P, 45);
    expect(w.map((x) => [hhmm(x.start), hhmm(x.end)])).toEqual([
      ['07:00', '12:00'],
      ['12:45', '18:00'],
      ['18:45', '20:30'],
    ]);
  });
  it('removes events with a 15 minute travel buffer on both sides', () => {
    const w = freeWindows(DAY, [ev(DAY, '09:00', '10:00')], P, 45);
    expect(w.map((x) => [hhmm(x.start), hhmm(x.end)])).toEqual([
      ['07:00', '08:45'],
      ['10:15', '12:00'],
      ['12:45', '18:00'],
      ['18:45', '20:30'],
    ]);
  });
  it('drops windows shorter than the session minimum', () => {
    const w = freeWindows(DAY, [ev(DAY, '07:20', '11:30')], P, 45);
    expect(w.map((x) => hhmm(x.start))).not.toContain('07:00');
  });
  it('allows nothing on a day with a long work shift, but not for short ones', () => {
    const long: Busy = { start: at(DAY, '07:00'), end: at(DAY, '19:00'), kind: 'work' };
    expect(blockedByLongShift(DAY, [long], P)).toBe(true);
    expect(freeWindows(DAY, [long], P, 45)).toEqual([]);
    const short: Busy = { start: at(DAY, '09:00'), end: at(DAY, '17:00'), kind: 'work' };
    expect(blockedByLongShift(DAY, [short], P)).toBe(false);
    expect(freeWindows(DAY, [short], P, 45).length).toBeGreaterThan(0);
  });
  it('treats an overnight shift ending this morning as busy time', () => {
    const night: Busy = { start: at('2026-03-03', '22:00'), end: at(DAY, '07:00'), kind: 'work' };
    const w = freeWindows(DAY, [night], P, 45);
    expect(hhmm(w[0]!.start)).toBe('07:15');
  });
  it('honours notBefore so the past is never proposed', () => {
    const w = freeWindows(DAY, [], P, 45, at(DAY, '13:10'));
    expect(hhmm(w[0]!.start)).toBe('13:15');
  });
});

describe('suggestSlots', () => {
  it('returns up to three slots, best first, never overlapping the 20:30 cutoff', () => {
    const s = suggestSlots(DAY, [], P, H);
    expect(s).toHaveLength(3);
    expect(s[0]!.score).toBeGreaterThanOrEqual(s[1]!.score);
    expect(s[1]!.score).toBeGreaterThanOrEqual(s[2]!.score);
    for (const x of s) expect(x.end).toBeLessThanOrEqual(at(DAY, '20:30'));
    // evening preference: best slot is in the evening window
    expect(Number(hhmm(s[0]!.start).slice(0, 2))).toBeGreaterThanOrEqual(16);
  });
  it('follows a morning preference and learns your usual hour from history', () => {
    const morning = suggestSlots(DAY, [], { ...P, trainTime: 'morning' }, H)[0]!;
    expect(Number(hhmm(morning.start).slice(0, 2))).toBeLessThan(10);
    const learned = suggestSlots(
      DAY,
      [],
      { ...P, trainTime: 'auto' },
      { hours: [7, 7.5, 8], lastDay: null },
    )[0]!;
    expect(Number(hhmm(learned.start).slice(0, 2))).toBeLessThan(10);
  });
  it('returns nothing when the day is blocked or full', () => {
    expect(
      suggestSlots(DAY, [{ start: at(DAY, '06:00'), end: at(DAY, '23:00'), kind: 'family' }], P, H),
    ).toEqual([]);
  });
  it('prefers a rested day over training two days in a row', () => {
    const fresh = scoreSlot(DAY, at(DAY, '18:45'), at(DAY, '19:45'), 105 * 60000, 60, P, {
      hours: [],
      lastDay: '2026-03-01',
    });
    const tired = scoreSlot(DAY, at(DAY, '18:45'), at(DAY, '19:45'), 105 * 60000, 60, P, {
      hours: [],
      lastDay: '2026-03-03',
    });
    expect(fresh.score).toBeGreaterThan(tired.score);
    expect(tired.reason).toMatch(/1 rest day/);
  });
});

describe('planWeek', () => {
  const MON = '2026-03-02';
  const none = () => [] as Busy[];
  it('plans the requested number of sessions on different days with a rest day between when possible', () => {
    const plan = planWeek(MON, 7, 3, none, P, H);
    expect(plan).toHaveLength(3);
    const days = plan.map((s) => s.dateKey);
    expect(new Set(days).size).toBe(3);
    for (let i = 1; i < days.length; i++) {
      const gap = (Date.parse(days[i]!) - Date.parse(days[i - 1]!)) / 86_400_000;
      expect(gap).toBeGreaterThanOrEqual(2);
    }
  });
  it('plans around long shifts', () => {
    const shifts = (k: string): Busy[] =>
      ['2026-03-02', '2026-03-03', '2026-03-04'].includes(k)
        ? [{ start: at(k, '06:00'), end: at(k, '18:00'), kind: 'work' }]
        : [];
    const plan = planWeek(MON, 7, 3, shifts, P, H);
    for (const s of plan)
      expect(['2026-03-02', '2026-03-03', '2026-03-04']).not.toContain(s.dateKey);
  });
  it('shortens sessions in light mode and returns fewer when there is no room', () => {
    const light = planWeek(MON, 7, 2, none, P, H, { light: true });
    expect(light.every((s) => s.title === 'Light session' && s.end - s.start === 35 * 60000)).toBe(
      true,
    );
    const full: Busy[] = [{ start: at(MON, '00:00'), end: at(MON, '23:59'), kind: 'work' }];
    expect(planWeek(MON, 1, 3, () => full, P, H)).toEqual([]);
  });
});
