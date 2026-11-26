import { describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE, sanitizeProfile } from './profile';

describe('sanitizeProfile', () => {
  it('returns defaults for junk input', () => {
    expect(sanitizeProfile(null)).toEqual(DEFAULT_PROFILE);
    expect(sanitizeProfile('x')).toEqual(DEFAULT_PROFILE);
    expect(sanitizeProfile({ units: 'stone', calendars: 'google' })).toEqual(DEFAULT_PROFILE);
  });
  it('keeps valid values and clamps numbers', () => {
    const p = sanitizeProfile({
      completed: true,
      name: '  Sam  ',
      units: 'kg',
      calorieTarget: 99999,
      workoutsPerWeek: -3,
      calendars: ['google', 'bogus', 'ics'],
      sleepHours: 7.5,
      wakeTime: '05:45',
      homeSystems: ['hue', 'nope'],
    });
    expect(p).toMatchObject({
      completed: true,
      name: 'Sam',
      units: 'kg',
      calorieTarget: 6000,
      workoutsPerWeek: 0,
      calendars: ['google', 'ics'],
      sleepHours: 7.5,
      wakeTime: '05:45',
      homeSystems: ['hue'],
    });
  });
  it('rejects malformed wake times', () => {
    expect(sanitizeProfile({ wakeTime: '25:99' }).wakeTime).toBe(DEFAULT_PROFILE.wakeTime);
  });
});
