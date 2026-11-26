import { isValidTz } from './tz';

export type Units = 'lb' | 'kg';
export type CalendarProvider = 'google' | 'outlook' | 'apple' | 'ics';
export type LunchFor = 'me' | 'kids' | 'both' | 'none';
export type SleepTracker =
  'phone' | 'oura' | 'fitbit' | 'apple-watch' | 'garmin' | 'whoop' | 'none';
export type HomeSystem =
  'home-assistant' | 'hue' | 'homekit' | 'google-home' | 'alexa' | 'smartthings' | 'none';
export type TrainTime = 'auto' | 'morning' | 'midday' | 'evening';

/** Answers from onboarding plus planning preferences. One owner; stored server-side in D1. */
export interface Profile {
  completed: boolean;
  name: string;
  units: Units;
  calorieTarget: number | null;
  proteinTarget: number | null;
  workoutsPerWeek: number;
  calendars: CalendarProvider[];
  shiftsChange: boolean;
  lunchFor: LunchFor;
  sleepTracker: SleepTracker;
  sleepHours: number;
  wakeTime: string; // HH:MM
  homeSystems: HomeSystem[];
  sessionMinutes: number;
  /** No workout may end within this many hours of bedtime. */
  noTrainWithinBedtimeHours: number;
  /** No workout on a day with a work shift longer than this many hours. */
  noTrainOnShiftOverHours: number;
  trainTime: TrainTime;
  /** IANA zone, set from the browser when onboarding finishes. */
  timezone: string;
}

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
export const TRAIN_TIMES: readonly TrainTime[] = ['auto', 'morning', 'midday', 'evening'];

export const DEFAULT_PROFILE: Profile = {
  completed: false,
  name: '',
  units: 'lb',
  calorieTarget: null,
  proteinTarget: null,
  workoutsPerWeek: 3,
  calendars: [],
  shiftsChange: true,
  lunchFor: 'none',
  sleepTracker: 'phone',
  sleepHours: 8,
  wakeTime: '06:30',
  homeSystems: [],
  sessionMinutes: 60,
  noTrainWithinBedtimeHours: 2,
  noTrainOnShiftOverHours: 10,
  trainTime: 'auto',
  timezone: 'UTC',
};

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
const manyOf = <T extends string>(v: unknown, allowed: readonly T[]): T[] =>
  Array.isArray(v) ? allowed.filter((a) => v.includes(a)) : [];
const num = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const optNum = (v: unknown, min: number, max: number): number | null =>
  v === null || v === undefined ? null : Math.round(num(v, min, max, min));

/** Never trust stored or posted data: coerce anything unknown into a valid Profile. */
export function sanitizeProfile(raw: unknown): Profile {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_PROFILE;
  const wake = typeof r.wakeTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(r.wakeTime);
  return {
    completed: r.completed === true,
    name: typeof r.name === 'string' ? r.name.trim().slice(0, 40) : d.name,
    units: oneOf(r.units, UNITS, d.units),
    calorieTarget: optNum(r.calorieTarget, 800, 6000),
    proteinTarget: optNum(r.proteinTarget, 20, 400),
    workoutsPerWeek: Math.round(num(r.workoutsPerWeek, 0, 14, d.workoutsPerWeek)),
    calendars: manyOf(r.calendars, CALENDARS),
    shiftsChange: typeof r.shiftsChange === 'boolean' ? r.shiftsChange : d.shiftsChange,
    lunchFor: oneOf(r.lunchFor, LUNCH, d.lunchFor),
    sleepTracker: oneOf(r.sleepTracker, TRACKERS, d.sleepTracker),
    sleepHours: num(r.sleepHours, 4, 12, d.sleepHours),
    wakeTime: wake ? (r.wakeTime as string) : d.wakeTime,
    homeSystems: manyOf(r.homeSystems, HOMES),
    sessionMinutes: Math.round(num(r.sessionMinutes, 20, 180, d.sessionMinutes)),
    noTrainWithinBedtimeHours: num(r.noTrainWithinBedtimeHours, 0, 6, d.noTrainWithinBedtimeHours),
    noTrainOnShiftOverHours: num(r.noTrainOnShiftOverHours, 4, 24, d.noTrainOnShiftOverHours),
    trainTime: oneOf(r.trainTime, TRAIN_TIMES, d.trainTime),
    timezone: typeof r.timezone === 'string' && isValidTz(r.timezone) ? r.timezone : d.timezone,
  };
}
