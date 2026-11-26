/**
 * Workout scheduler: pure functions only (no clock, no network, no database), so every rule is
 * unit-tested. All inputs are plain data; times are UTC milliseconds and local days are
 * `YYYY-MM-DD` keys interpreted in the profile's time zone.
 *
 * Rules (from the spec):
 *  1. Free time = the waking day minus all events, travel buffers, meals and a protected sleep window.
 *  2. Hard limits: no session ending within N hours of bedtime, none on a day with a shift above a set length.
 *  3. Score each free window by fit (length, usual time of day, rest days) and propose the top three.
 */
import { addDaysKey, atLocal, localParts } from './tz';

const MIN = 60_000;
const HOUR = 3_600_000;
const BUFFER = 15 * MIN;
const GRID = 15 * MIN;
const MEALS: [string, string][] = [
  ['12:00', '12:45'],
  ['18:00', '18:45'],
];

export interface Busy {
  start: number;
  end: number;
  allDay?: boolean;
  /** 'work' events count towards the long-shift rule. */
  kind?: string;
}

export interface SchedProfile {
  wakeTime: string;
  sleepHours: number;
  sessionMinutes: number;
  noTrainWithinBedtimeHours: number;
  noTrainOnShiftOverHours: number;
  trainTime: 'auto' | 'morning' | 'midday' | 'evening';
  timezone: string;
}

export interface History {
  /** Local start hours (0-24, fractional) of past workouts, used to learn your usual time. */
  hours: number[];
  /** Local date of the most recent workout, if any. */
  lastDay: string | null;
}

export interface Window {
  start: number;
  end: number;
}

export interface Slot {
  dateKey: string;
  start: number;
  end: number;
  score: number;
  reason: string;
}

export function dayBounds(dateKey: string, p: SchedProfile) {
  const wake = atLocal(dateKey, p.wakeTime, p.timezone);
  const bed = wake + (24 - p.sleepHours) * HOUR;
  return {
    wake,
    bed,
    trainStart: wake + 30 * MIN,
    trainEnd: bed - p.noTrainWithinBedtimeHours * HOUR,
  };
}

export function blockedByLongShift(dateKey: string, events: Busy[], p: SchedProfile): boolean {
  const dayStart = atLocal(dateKey, '00:00', p.timezone);
  const dayEnd = atLocal(addDaysKey(dateKey, 1), '00:00', p.timezone);
  return events.some(
    (e) =>
      e.kind === 'work' &&
      !e.allDay &&
      e.end > dayStart &&
      e.start < dayEnd &&
      e.end - e.start > p.noTrainOnShiftOverHours * HOUR,
  );
}

function merge(list: Window[]): Window[] {
  const sorted = [...list].sort((a, b) => a.start - b.start);
  const out: Window[] = [];
  for (const w of sorted) {
    const last = out[out.length - 1];
    if (last && w.start <= last.end) last.end = Math.max(last.end, w.end);
    else out.push({ ...w });
  }
  return out;
}

/** Waking, trainable time on a day with every conflict removed. Windows shorter than `minMinutes` are dropped. */
export function freeWindows(
  dateKey: string,
  events: Busy[],
  p: SchedProfile,
  minMinutes: number,
  notBefore = 0,
): Window[] {
  const b = dayBounds(dateKey, p);
  const start = Math.max(b.trainStart, Math.ceil(notBefore / GRID) * GRID);
  const end = b.trainEnd;
  if (end - start < minMinutes * MIN || blockedByLongShift(dateKey, events, p)) return [];

  const busy: Window[] = events
    .filter((e) => !e.allDay)
    .map((e) => ({ start: e.start - BUFFER, end: e.end + BUFFER }));
  for (const [a, z] of MEALS)
    busy.push({ start: atLocal(dateKey, a, p.timezone), end: atLocal(dateKey, z, p.timezone) });

  const free: Window[] = [];
  let cursor = start;
  for (const w of merge(busy)) {
    if (w.end <= cursor) continue;
    if (w.start >= end) break;
    if (w.start > cursor) free.push({ start: cursor, end: Math.min(w.start, end) });
    cursor = Math.max(cursor, w.end);
  }
  if (cursor < end) free.push({ start: cursor, end });
  return free.filter((w) => w.end - w.start >= minMinutes * MIN);
}

export function preferredHour(p: SchedProfile, h: History): number {
  if (p.trainTime === 'morning') return 7.5;
  if (p.trainTime === 'midday') return 12.5;
  if (p.trainTime === 'evening') return 18;
  if (h.hours.length >= 3) {
    const s = [...h.hours].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)]!;
  }
  return 17.5;
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number) as [number, number, number];
  const [by, bm, bd] = b.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

const restScore = (daysSince: number | null) =>
  daysSince === null ? 1 : daysSince <= 0 ? 0.15 : daysSince === 1 ? 0.65 : 1;

export function scoreSlot(
  dateKey: string,
  start: number,
  end: number,
  windowLen: number,
  wantMin: number,
  p: SchedProfile,
  h: History,
  chosenDays: string[] = [],
): { score: number; reason: string } {
  const lp = localParts(start + (end - start) / 2, p.timezone);
  const centre = lp.h + lp.mi / 60;
  const pref = preferredHour(p, h);
  const time = Math.exp(-(((centre - pref) / 3.5) ** 2));
  const fit = Math.min(1, windowLen / (wantMin * MIN));

  // Rest: days since the latest workout before this day (history or already chosen this week).
  const prior = [h.lastDay, ...chosenDays].filter((d): d is string => !!d && d <= dateKey);
  const last = prior.length ? prior.sort().at(-1)! : null;
  const since = last === null ? null : daysBetween(last, dateKey);
  let rest = restScore(since);
  const adjacent = chosenDays.some((d) => Math.abs(daysBetween(d, dateKey)) === 1);
  if (adjacent) rest = Math.min(rest, 0.35);

  const score = Math.round((0.35 * fit + 0.4 * time + 0.25 * rest) * 1000) / 1000;
  const restText =
    since === null
      ? 'well rested'
      : since <= 0
        ? 'already trained today'
        : since === 1
          ? '1 rest day'
          : `${since} rest days`;
  const when = time > 0.7 ? 'near your usual time' : 'off your usual time';
  return { score, reason: `${restText}, ${when}${fit < 1 ? ', a tight fit' : ''}` };
}

export interface SuggestOpts {
  minutes?: number;
  notBefore?: number;
  chosenDays?: string[];
  count?: number;
}

/** Top slots for one day, best first, at least an hour apart. */
export function suggestSlots(
  dateKey: string,
  events: Busy[],
  p: SchedProfile,
  h: History,
  o: SuggestOpts = {},
): Slot[] {
  const want = o.minutes ?? p.sessionMinutes;
  const minAccept = Math.max(20, Math.round(want * 0.75));
  const windows = freeWindows(dateKey, events, p, minAccept, o.notBefore ?? 0);
  const candidates: Slot[] = [];
  for (const w of windows) {
    const len = Math.min(want * MIN, w.end - w.start);
    for (let s = w.start; s + len <= w.end; s += 2 * GRID) {
      const { score, reason } = scoreSlot(
        dateKey,
        s,
        s + len,
        w.end - w.start,
        want,
        p,
        h,
        o.chosenDays,
      );
      candidates.push({ dateKey, start: s, end: s + len, score, reason });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.start - b.start);
  const picked: Slot[] = [];
  for (const c of candidates) {
    if (picked.every((x) => Math.abs(x.start - c.start) >= HOUR)) picked.push(c);
    if (picked.length >= (o.count ?? 3)) break;
  }
  return picked;
}

export interface PlannedSession extends Slot {
  title: string;
}

/**
 * Pick `sessions` days in the week starting `weekStart`, preferring rest days between sessions and
 * well-scored slots. `light` shortens sessions (used when recently under-slept).
 */
export function planWeek(
  weekStart: string,
  days: number,
  sessions: number,
  eventsFor: (dateKey: string) => Busy[],
  p: SchedProfile,
  h: History,
  o: { light?: boolean; notBefore?: number } = {},
): PlannedSession[] {
  const minutes = o.light ? Math.min(35, p.sessionMinutes) : p.sessionMinutes;
  const keys = Array.from({ length: days }, (_, i) => addDaysKey(weekStart, i));
  const chosen: PlannedSession[] = [];
  for (let n = 0; n < sessions; n++) {
    const chosenDays = chosen.map((c) => c.dateKey);
    let best: Slot | null = null;
    for (const k of keys) {
      if (chosenDays.includes(k)) continue;
      const top = suggestSlots(k, eventsFor(k), p, h, {
        minutes,
        notBefore: o.notBefore,
        chosenDays,
        count: 1,
      })[0];
      if (top && (!best || top.score > best.score)) best = top;
    }
    if (!best) break;
    chosen.push({ ...best, title: o.light ? 'Light session' : 'Workout' });
  }
  return chosen.sort((a, b) => a.start - b.start);
}
