import {
  addDaysKey,
  atLocal,
  freeWindows,
  localDateKey,
  localDayStart,
  localParts,
  planWeek,
  suggestSlots,
  type Busy,
  type History,
  type SchedProfile,
  type Slot,
} from '@life/shared';
import type { Env } from './env';
import { loadProfile, createProposal } from './foundation';
import { DATE, err, isoNoMs, json, readJson, str, type Ctx, type Handler } from './http';
import { recoveryMode } from './recovery';

const DAY = 86_400_000;

export async function loadBusy(env: Env, fromMs: number, toMs: number): Promise<Busy[]> {
  const from = isoNoMs(fromMs);
  const to = isoNoMs(toMs);
  const ev = await env.DB.prepare(
    'SELECT start, end, all_day, kind FROM events WHERE start < ? AND end > ?',
  )
    .bind(to, from)
    .all<{ start: string; end: string; all_day: number; kind: string }>();
  const dash = await env.DB.prepare(
    'SELECT start, end, all_day FROM dashboard_events WHERE start < ? AND end > ?',
  )
    .bind(to, from)
    .all<{ start: string; end: string; all_day: number }>();
  const rows: Busy[] = [];
  for (const r of ev.results ?? []) {
    if (r.all_day) continue; // all-day items (holidays, birthdays) don't block a workout
    rows.push({ start: Date.parse(r.start), end: Date.parse(r.end), kind: r.kind });
  }
  for (const r of dash.results ?? [])
    if (!r.all_day)
      rows.push({ start: Date.parse(r.start), end: Date.parse(r.end), kind: 'dashboard' });
  return rows;
}

export async function loadHistory(env: Env, tz: string, nowMs: number): Promise<History> {
  const since = isoNoMs(nowMs - 60 * DAY);
  const { results } = await env.DB.prepare(
    'SELECT started_at FROM workouts WHERE started_at >= ? ORDER BY started_at',
  )
    .bind(since)
    .all<{ started_at: string }>();
  const starts = (results ?? []).map((r) => Date.parse(r.started_at));
  const hours = starts.map((ms) => {
    const p = localParts(ms, tz);
    return p.h + p.mi / 60;
  });
  return { hours, lastDay: starts.length ? localDateKey(starts[starts.length - 1]!, tz) : null };
}

export const toSched = (p: Awaited<ReturnType<typeof loadProfile>>): SchedProfile => ({
  wakeTime: p.wakeTime,
  sleepHours: p.sleepHours,
  sessionMinutes: p.sessionMinutes,
  noTrainWithinBedtimeHours: p.noTrainWithinBedtimeHours,
  noTrainOnShiftOverHours: p.noTrainOnShiftOverHours,
  trainTime: p.trainTime,
  timezone: p.timezone,
});

const slotOut = (s: Slot) => ({
  dateKey: s.dateKey,
  start: isoNoMs(s.start),
  end: isoNoMs(s.end),
  score: s.score,
  reason: s.reason,
});

export function mondayKey(nowMs: number, tz: string): string {
  const p = localParts(nowMs, tz);
  const key = localDateKey(nowMs, tz);
  return addDaysKey(key, -((p.dow + 6) % 7));
}

/** Weekly plan for `weekStart` as proposals (never written to the calendar until approved). */
export async function proposeWeek(
  c: Pick<Ctx, 'env'> & { now: () => number },
  weekStart: string,
): Promise<{ created: string[]; sessions: ReturnType<typeof slotOut>[] }> {
  const profile = await loadProfile(c);
  const p = toSched(profile);
  const now = c.now();
  const rec = await recoveryMode(c.env, now);
  const from = atLocal(weekStart, '00:00', p.timezone) - DAY;
  const busy = await loadBusy(c.env, from, atLocal(addDaysKey(weekStart, 8), '00:00', p.timezone));
  const hist = await loadHistory(c.env, p.timezone, now);
  const byDay = (k: string) =>
    busy.filter(
      (e) =>
        e.end > atLocal(k, '00:00', p.timezone) &&
        e.start < atLocal(addDaysKey(k, 1), '00:00', p.timezone),
    );
  const sessions = planWeek(weekStart, 7, profile.workoutsPerWeek, byDay, p, hist, {
    light: rec.light,
    notBefore: now,
  });
  const existing = await c.env.DB.prepare(
    "SELECT payload FROM proposals WHERE status = 'pending' AND source = 'scheduler'",
  ).all<{ payload: string }>();
  const taken = new Set(
    (existing.results ?? []).map((r) => (JSON.parse(r.payload) as { start: string }).start),
  );
  const created: string[] = [];
  for (const s of sessions) {
    const o = slotOut(s);
    if (taken.has(o.start)) continue;
    created.push(
      await createProposal(c.env, {
        source: 'scheduler',
        kind: 'calendar_event',
        summary: `${s.title}: ${s.reason}`,
        payload: { title: s.title, start: o.start, end: o.end },
      }),
    );
  }
  return { created, sessions: sessions.map(slotOut) };
}

/**
 * Re-plan after events or shifts change: any pending scheduler proposal that no longer fits a free
 * window is expired, and a replacement for the same day is proposed when one exists.
 */
export async function replan(
  env: Env,
  nowMs: number,
): Promise<{ expired: number; created: number }> {
  const profile = await loadProfile({ env });
  const p = toSched(profile);
  const { results } = await env.DB.prepare(
    "SELECT id, payload FROM proposals WHERE status = 'pending' AND source = 'scheduler' AND kind = 'calendar_event'",
  ).all<{ id: string; payload: string }>();
  let expired = 0;
  let created = 0;
  const hist = await loadHistory(env, p.timezone, nowMs);
  for (const r of results ?? []) {
    const pl = JSON.parse(r.payload) as { title: string; start: string; end: string };
    const s = Date.parse(pl.start);
    const e = Date.parse(pl.end);
    if (s <= nowMs) {
      await env.DB.prepare(
        "UPDATE proposals SET status = 'expired', decided_at = datetime('now') WHERE id = ?",
      )
        .bind(r.id)
        .run();
      expired++;
      continue;
    }
    const day = localDateKey(s, p.timezone);
    const busy = await loadBusy(
      env,
      atLocal(day, '00:00', p.timezone) - DAY,
      atLocal(addDaysKey(day, 1), '00:00', p.timezone) + DAY,
    );
    const minutes = Math.max(20, Math.round((e - s) / 60_000));
    const fits = freeWindows(day, busy, p, minutes).some((w) => w.start <= s && w.end >= e);
    if (fits) continue;
    await env.DB.prepare(
      "UPDATE proposals SET status = 'expired', decided_at = datetime('now') WHERE id = ?",
    )
      .bind(r.id)
      .run();
    expired++;
    const next = suggestSlots(day, busy, p, hist, { minutes, notBefore: nowMs, count: 1 })[0];
    if (next) {
      const o = slotOut(next);
      await createProposal(env, {
        source: 'scheduler',
        kind: 'calendar_event',
        summary: `Re-planned ${pl.title}: ${next.reason}`,
        payload: { title: pl.title, start: o.start, end: o.end },
      });
      created++;
    }
  }
  return { expired, created };
}

export const plan: Handler = async (c) => {
  const { env, path, method, req } = c;
  const profile = await loadProfile(c);
  const p = toSched(profile);

  if (path === '/api/plan/slots' && method === 'GET') {
    const date = c.url.searchParams.get('date') ?? '';
    if (!DATE.test(date)) return err(400, 'bad_date');
    const now = c.now();
    const rec = await recoveryMode(env, now);
    const busy = await loadBusy(
      env,
      atLocal(date, '00:00', p.timezone) - DAY,
      atLocal(addDaysKey(date, 1), '00:00', p.timezone) + DAY,
    );
    const hist = await loadHistory(env, p.timezone, now);
    const minutes = rec.light ? Math.min(35, p.sessionMinutes) : p.sessionMinutes;
    const slots = suggestSlots(date, busy, p, hist, { minutes, notBefore: now });
    return json({
      slots: slots.map(slotOut),
      light: rec.light,
      reason: rec.reason,
      blockedByShift:
        slots.length === 0 &&
        busy.some(
          (b) => b.kind === 'work' && b.end - b.start > p.noTrainOnShiftOverHours * 3_600_000,
        ),
    });
  }
  if (path === '/api/plan/propose' && method === 'POST') {
    const b = await readJson(req);
    const title = str(b?.title, 80) ?? 'Workout';
    const start = typeof b?.start === 'string' ? b.start : '';
    const end = typeof b?.end === 'string' ? b.end : '';
    if (
      Number.isNaN(Date.parse(start)) ||
      Number.isNaN(Date.parse(end)) ||
      Date.parse(end) <= Date.parse(start)
    )
      return err(400, 'bad_slot');
    const id = await createProposal(env, {
      source: 'scheduler',
      kind: 'calendar_event',
      summary: str(b?.summary, 160) ?? title,
      payload: { title, start, end },
    });
    return json({ id }, 201);
  }
  if (path === '/api/plan/week' && method === 'POST') {
    const b = await readJson(req);
    const start =
      typeof b?.start === 'string' && DATE.test(b.start) ? b.start : mondayKey(c.now(), p.timezone);
    return json(await proposeWeek(c, start), 201);
  }
  void localDayStart;
  return null;
};
