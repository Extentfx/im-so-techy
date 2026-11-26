import type {
  CalendarProvider,
  HomeSystem,
  LunchFor,
  Profile,
  SleepTracker,
  Units,
} from '@life/shared';

const KEY = 'life.profile.v1';

export const DEFAULT_PROFILE: Profile = {
  completed: false,
  name: '',
  units: 'lb',
  calorieTarget: null,
  workoutsPerWeek: 3,
  calendars: [],
  shiftsChange: true,
  lunchFor: 'none',
  sleepTracker: 'phone',
  sleepHours: 8,
  wakeTime: '06:30',
  homeSystems: [],
};

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

const manyOf = <T extends string>(v: unknown, allowed: readonly T[]): T[] =>
  Array.isArray(v) ? allowed.filter((a) => v.includes(a)) : [];

const num = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

export const CALENDARS: readonly CalendarProvider[] = ['google', 'outlook', 'apple', 'ics'];
export const LUNCH: readonly LunchFor[] = ['me', 'kids', 'both', 'none'];
export const TRACKERS: readonly SleepTracker[] = [
  'phone',
  'oura',
  'fitbit',
  'apple-watch',
  'garmin',
  'whoop',
  'none',
];
export const HOMES: readonly HomeSystem[] = [
  'home-assistant',
  'hue',
  'homekit',
  'google-home',
  'alexa',
  'smartthings',
  'none',
];
export const UNITS: readonly Units[] = ['lb', 'kg'];

/** Never trust stored data: coerce anything unknown into a valid Profile. */
export function sanitizeProfile(raw: unknown): Profile {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_PROFILE;
  const wake = typeof r.wakeTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(r.wakeTime);
  return {
    completed: r.completed === true,
    name: typeof r.name === 'string' ? r.name.trim().slice(0, 40) : d.name,
    units: oneOf(r.units, UNITS, d.units),
    calorieTarget:
      r.calorieTarget === null || r.calorieTarget === undefined
        ? null
        : Math.round(num(r.calorieTarget, 800, 6000, 2000)),
    workoutsPerWeek: Math.round(num(r.workoutsPerWeek, 0, 14, d.workoutsPerWeek)),
    calendars: manyOf(r.calendars, CALENDARS),
    shiftsChange: typeof r.shiftsChange === 'boolean' ? r.shiftsChange : d.shiftsChange,
    lunchFor: oneOf(r.lunchFor, LUNCH, d.lunchFor),
    sleepTracker: oneOf(r.sleepTracker, TRACKERS, d.sleepTracker),
    sleepHours: num(r.sleepHours, 4, 12, d.sleepHours),
    wakeTime: wake ? (r.wakeTime as string) : d.wakeTime,
    homeSystems: manyOf(r.homeSystems, HOMES),
  };
}

export function loadProfile(): Profile {
  try {
    const s = localStorage.getItem(KEY);
    return s ? sanitizeProfile(JSON.parse(s)) : DEFAULT_PROFILE;
  } catch {
    return DEFAULT_PROFILE;
  }
}

export function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable (private mode): the session still works, it just won't persist */
  }
}
