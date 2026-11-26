import { describe, expect, it } from 'vitest';
import { atLocal } from './tz';
import { recoveryFrom, sleepDebtHours, suggestBedtime } from './sleep';

const TZ = 'America/New_York';
const night = (date: string, h: number) => ({ date, minutes: h * 60 });

describe('sleep debt', () => {
  it('sums shortfall over the last seven logged nights and ignores surplus', () => {
    const nights = [
      night('2026-03-01', 6),
      night('2026-03-02', 9),
      night('2026-03-03', 7),
      night('2026-02-20', 2),
    ];
    // target 8h: short 2h + 0 + 1h = 3h; the old night is outside the 7 most recent only if there are 7+, so it counts here
    expect(sleepDebtHours(nights.slice(0, 3), 8)).toBe(3);
    const many = Array.from({ length: 9 }, (_, i) => night(`2026-03-0${i + 1}`, 7));
    expect(sleepDebtHours(many, 8)).toBe(7); // only the 7 latest nights
    expect(sleepDebtHours([], 8)).toBe(0);
  });
});

describe('recovery', () => {
  it('goes light after a rough night or a big weekly debt, otherwise not', () => {
    expect(recoveryFrom(300, 0)).toMatchObject({
      light: true,
      reason: 'You slept 5h 0m last night',
    });
    expect(recoveryFrom(450, 4)).toMatchObject({ light: true });
    expect(recoveryFrom(450, 3.9)).toEqual({ light: false, reason: null });
    expect(recoveryFrom(null, 0)).toEqual({ light: false, reason: null });
  });
});

describe('suggestBedtime', () => {
  const P = { wakeTime: '06:30', sleepHours: 8, timezone: TZ };
  const hhmm = (ms: number) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(ms);
  it("counts back from tomorrow's first commitment minus prep time", () => {
    const early = { start: atLocal('2026-03-05', '05:30', TZ), title: 'Early shift' };
    const r = suggestBedtime(
      '2026-03-04',
      [{ start: atLocal('2026-03-05', '09:00', TZ), title: 'Meeting' }, early],
      P,
    );
    expect(r.basedOn).toBe('Early shift');
    expect(hhmm(r.wake)).toBe('04:30');
    expect(hhmm(r.bedtime)).toBe('20:30'); // 8h before 04:30
  });
  it('falls back to the usual wake time and ignores commitments on other days', () => {
    const r = suggestBedtime(
      '2026-03-04',
      [{ start: atLocal('2026-03-04', '05:00', TZ), title: 'Today' }],
      P,
    );
    expect(r.basedOn).toBe('your usual wake time');
    expect(hhmm(r.bedtime)).toBe('22:30');
  });
  it('lets you sleep in for a late start, but only up to three hours past your usual wake time', () => {
    const r = suggestBedtime(
      '2026-03-04',
      [{ start: atLocal('2026-03-05', '13:00', TZ), title: 'Late start' }],
      P,
    );
    expect(hhmm(r.wake)).toBe('09:30');
  });
});
