import { describe, expect, it } from 'vitest';
import type { CalEvent } from '@life/shared';
import { addDays, dayKey, dayKeysOf, groupByDay, isoNoMs, mondayOf, rangeOf } from './week';

const timed = (title: string, s: Date, e: Date, id = title): CalEvent => ({
  id,
  sourceId: 's',
  title,
  start: isoNoMs(s),
  end: isoNoMs(e),
  allDay: false,
  location: null,
  kind: 'work',
});

describe('week maths', () => {
  it('finds Monday for any day of the week, including Sunday', () => {
    expect(dayKey(mondayOf(new Date(2026, 2, 4)))).toBe('2026-03-02'); // Wed
    expect(dayKey(mondayOf(new Date(2026, 2, 8)))).toBe('2026-03-02'); // Sun
    expect(dayKey(mondayOf(new Date(2026, 2, 2)))).toBe('2026-03-02'); // Mon
  });
  it('builds a seven-day UTC range from local midnight', () => {
    const start = new Date(2026, 2, 2);
    const r = rangeOf(start, 7);
    expect(Date.parse(r.to) - Date.parse(r.from)).toBeGreaterThanOrEqual(
      7 * 86_400_000 - 3_600_000,
    );
    expect(r.from).toBe(isoNoMs(start));
  });
});

describe('dayKeysOf', () => {
  it('puts an overnight shift on both days', () => {
    const e = timed('Night', new Date(2026, 2, 2, 22), new Date(2026, 2, 3, 6));
    expect(dayKeysOf(e)).toEqual(['2026-03-02', '2026-03-03']);
  });
  it('does not spill onto the next day when a shift ends exactly at midnight', () => {
    const e = timed('Late', new Date(2026, 2, 2, 16), new Date(2026, 2, 3, 0));
    expect(dayKeysOf(e)).toEqual(['2026-03-02']);
  });
  it('treats all-day ends as exclusive dates', () => {
    expect(dayKeysOf({ allDay: true, start: '2026-07-04', end: '2026-07-06' })).toEqual([
      '2026-07-04',
      '2026-07-05',
    ]);
    expect(dayKeysOf({ allDay: true, start: '2026-07-04', end: '2026-07-04' })).toEqual([
      '2026-07-04',
    ]);
  });
});

describe('groupByDay', () => {
  it('lists all-day first then by start, and ignores days outside the week', () => {
    const mon = new Date(2026, 2, 2);
    const days = Array.from({ length: 7 }, (_, i) => addDays(mon, i));
    const lunch = timed('Lunch', new Date(2026, 2, 3, 12), new Date(2026, 2, 3, 13));
    const early = timed('Early', new Date(2026, 2, 3, 7), new Date(2026, 2, 3, 8));
    const holiday: CalEvent = {
      ...lunch,
      id: 'h',
      title: 'Holiday',
      allDay: true,
      start: '2026-03-03',
      end: '2026-03-04',
    };
    const outside = timed('Next week', new Date(2026, 2, 12, 9), new Date(2026, 2, 12, 10));
    const g = groupByDay([lunch, early, holiday, outside], days);
    expect(g.get('2026-03-03')!.map((e) => e.title)).toEqual(['Holiday', 'Early', 'Lunch']);
    expect(g.has('2026-03-12')).toBe(false);
  });
});
