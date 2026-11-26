/**
 * Read-only data access for chat. These functions are used both by Claude (as tools) and by the
 * built-in answer engine, so both see exactly the same facts. Nothing here writes, except
 * proposeEvent, which only creates a *proposal*.
 */
import {
  addDaysKey,
  atLocal,
  EXERCISE_BY_ID,
  EXERCISES,
  localDateKey,
  localParts,
  suggestSlots,
  type Muscle,
} from '@life/shared';
import type { Env } from './env';
import { createProposal, loadProfile } from './foundation';
import { isoNoMs } from './http';
import { loadBusy, loadHistory, toSched } from './plan';
import { recoveryMode } from './recovery';
import { totalsFor } from './food';

export interface ToolCtx {
  env: Env;
  now: () => number;
}

export const fmtLocal = (ms: number, tz: string): string =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(ms);
const fmtTime = (ms: number, tz: string): string =>
  new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(ms);

export async function getSchedule(c: ToolCtx, a: { date?: string; days?: number }) {
  const p = await loadProfile(c);
  const start =
    a.date && /^\d{4}-\d{2}-\d{2}$/.test(a.date) ? a.date : localDateKey(c.now(), p.timezone);
  const days = Math.min(14, Math.max(1, Math.round(a.days ?? 1)));
  const from = atLocal(start, '00:00', p.timezone);
  const to = atLocal(addDaysKey(start, days), '00:00', p.timezone);
  const ev = await c.env.DB.prepare(
    'SELECT title, start, end, all_day, kind FROM events WHERE start < ? AND end > ? ORDER BY start LIMIT 80',
  )
    .bind(isoNoMs(to), isoNoMs(from))
    .all<{ title: string; start: string; end: string; all_day: number; kind: string }>();
  const dash = await c.env.DB.prepare(
    'SELECT title, start, end, all_day FROM dashboard_events WHERE start < ? AND end > ? ORDER BY start LIMIT 40',
  )
    .bind(isoNoMs(to), isoNoMs(from))
    .all<{ title: string; start: string; end: string; all_day: number }>();
  const rows = [
    ...(ev.results ?? []),
    ...(dash.results ?? []).map((d) => ({ ...d, kind: 'dashboard' })),
  ].sort((x, y) => x.start.localeCompare(y.start));
  return {
    timezone: p.timezone,
    from: start,
    days,
    events: rows.map((r) =>
      r.all_day
        ? { title: r.title, when: `${r.start} (all day)`, kind: r.kind }
        : {
            title: r.title,
            when: `${fmtLocal(Date.parse(r.start), p.timezone)} to ${fmtTime(Date.parse(r.end), p.timezone)}`,
            kind: r.kind,
          },
    ),
  };
}

export async function getNutrition(c: ToolCtx, a: { date?: string }) {
  const p = await loadProfile(c);
  const date =
    a.date && /^\d{4}-\d{2}-\d{2}$/.test(a.date) ? a.date : localDateKey(c.now(), p.timezone);
  const t = await totalsFor(c.env, date);
  return {
    date,
    totals: t.totals,
    targets: { kcal: p.calorieTarget, protein: p.proteinTarget },
    items: t.entries.map((e) => `${e.slot}: ${e.name} (${Math.round(e.kcal)} kcal)`),
  };
}

export async function getSleepFacts(c: ToolCtx) {
  const p = await loadProfile(c);
  const rec = await recoveryMode(c.env, c.now());
  const last = await c.env.DB.prepare(
    'SELECT date, minutes FROM sleep_log ORDER BY date DESC LIMIT 1',
  ).first<{ date: string; minutes: number }>();
  return {
    lastNight: last ? { date: last.date, hours: Math.round((last.minutes / 60) * 10) / 10 } : null,
    targetHours: p.sleepHours,
    debtHours: rec.debtHours,
    light: rec.light,
    reason: rec.reason,
  };
}

export async function getWorkouts(c: ToolCtx, a: { limit?: number }) {
  const p = await loadProfile(c);
  const { results } = await c.env.DB.prepare(
    'SELECT id, started_at FROM workouts ORDER BY started_at DESC LIMIT ?',
  )
    .bind(Math.min(10, Math.max(1, a.limit ?? 5)))
    .all<{ id: string; started_at: string }>();
  const out = [];
  for (const w of results ?? []) {
    const sets = await c.env.DB.prepare(
      'SELECT exercise_id AS e, reps, weight_kg AS kg FROM sets WHERE workout_id = ? ORDER BY idx',
    )
      .bind(w.id)
      .all<{ e: string; reps: number; kg: number }>();
    out.push({
      when: fmtLocal(Date.parse(w.started_at), p.timezone),
      exercises: [
        ...new Set((sets.results ?? []).map((s) => EXERCISE_BY_ID.get(s.e)?.name ?? s.e)),
      ],
      sets: sets.results?.length ?? 0,
    });
  }
  return { workouts: out, plannedPerWeek: p.workoutsPerWeek };
}

const MUSCLES: readonly Muscle[] = ['legs', 'chest', 'back', 'shoulders', 'arms', 'core'];
const RECOVERY_DAYS: Record<Muscle, number> = {
  legs: 2,
  back: 2,
  chest: 1,
  shoulders: 1,
  arms: 1,
  core: 1,
};

export async function canFitWorkout(c: ToolCtx, a: { muscle?: string; date?: string }) {
  const p = await loadProfile(c);
  const tz = p.timezone;
  const now = c.now();
  const today = localDateKey(now, tz);
  const date = a.date && /^\d{4}-\d{2}-\d{2}$/.test(a.date) ? a.date : today;
  const muscle = MUSCLES.find((m) => m === a.muscle) ?? null;
  const ids = (muscle ? EXERCISES.filter((e) => e.muscle === muscle) : EXERCISES).map((e) => e.id);
  const last = await c.env.DB.prepare(
    `SELECT w.started_at AS at FROM sets s JOIN workouts w ON w.id = s.workout_id WHERE s.exercise_id IN (${ids.map(() => '?').join(',')}) ORDER BY w.started_at DESC LIMIT 1`,
  )
    .bind(...ids)
    .first<{ at: string }>();
  const lastDay = last ? localDateKey(Date.parse(last.at), tz) : null;
  const daysSince = lastDay
    ? Math.round(
        (Date.parse(`${date}T12:00:00Z`) - Date.parse(`${lastDay}T12:00:00Z`)) / 86_400_000,
      )
    : null;
  const need = muscle ? RECOVERY_DAYS[muscle] : 1;
  const rec = await recoveryMode(c.env, now);
  const sp = toSched(p);
  const busy = await loadBusy(
    c.env,
    atLocal(date, '00:00', tz) - 86_400_000,
    atLocal(addDaysKey(date, 1), '00:00', tz) + 86_400_000,
  );
  const hist = await loadHistory(c.env, tz, now);
  const minutes = rec.light ? Math.min(35, p.sessionMinutes) : p.sessionMinutes;
  const slots = suggestSlots(date, busy, sp, hist, { minutes, notBefore: now, count: 3 });
  const longShift = busy.some(
    (b) =>
      b.kind === 'work' &&
      b.end - b.start > p.noTrainOnShiftOverHours * 3_600_000 &&
      b.end > atLocal(date, '00:00', tz) &&
      b.start < atLocal(addDaysKey(date, 1), '00:00', tz),
  );
  return {
    date,
    muscle: muscle ?? 'any',
    daysSinceLastTrained: daysSince,
    recoveryNeededDays: need,
    rested: daysSince === null || daysSince >= need,
    longShiftThatDay: longShift,
    lightRecommended: rec.light,
    lightReason: rec.reason,
    slots: slots.map((s) => ({
      start: isoNoMs(s.start),
      end: isoNoMs(s.end),
      label: `${fmtTime(s.start, tz)} to ${fmtTime(s.end, tz)}`,
      why: s.reason,
    })),
  };
}

export async function proposeEvent(
  c: ToolCtx,
  a: { title?: unknown; start?: unknown; end?: unknown },
) {
  const title = typeof a.title === 'string' ? a.title.trim().slice(0, 80) : '';
  const start = typeof a.start === 'string' ? a.start : '';
  const end = typeof a.end === 'string' ? a.end : '';
  if (
    !title ||
    Number.isNaN(Date.parse(start)) ||
    Number.isNaN(Date.parse(end)) ||
    Date.parse(end) <= Date.parse(start)
  )
    return { error: 'invalid event' };
  const id = await createProposal(c.env, {
    source: 'chat',
    kind: 'calendar_event',
    summary: `Suggested in chat: ${title}`,
    payload: { title, start: isoNoMs(Date.parse(start)), end: isoNoMs(Date.parse(end)) },
  });
  return {
    proposalId: id,
    status: 'pending',
    note: 'This is only a suggestion. The user must approve it before it appears on the calendar.',
    title,
    start,
    end,
  };
}

export async function emailThisWeek(c: ToolCtx, a: { category?: string }) {
  const since = isoNoMs(c.now() - 7 * 86_400_000);
  const cat = ['school', 'work', 'family', 'bills', 'other'].includes(a.category ?? '')
    ? a.category
    : null;
  const q = cat
    ? "SELECT subject, category, summary FROM email_digest WHERE received_at >= ? AND category = ? AND status != 'dismissed' ORDER BY received_at DESC LIMIT 10"
    : "SELECT subject, category, summary FROM email_digest WHERE received_at >= ? AND status != 'dismissed' ORDER BY received_at DESC LIMIT 10";
  const { results } = await (
    cat ? c.env.DB.prepare(q).bind(since, cat) : c.env.DB.prepare(q).bind(since)
  ).all<{ subject: string; category: string; summary: string }>();
  return { emails: results ?? [] };
}

export const localTime = (ms: number, tz: string): string => fmtTime(ms, tz);
export const parts = localParts;
