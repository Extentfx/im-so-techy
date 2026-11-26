import { addDaysKey, atLocal, localDateKey, suggestBedtime, type Commitment } from '@life/shared';
import type { Env } from './env';
import { loadProfile } from './foundation';
import { isoNoMs } from './http';

/** Tonight's bedtime and tomorrow's wake time, from tomorrow's first timed commitment. */
export async function suggestionFor(
  env: Env,
  now: number,
): Promise<{ bedtime: number; wake: number; basedOn: string; today: string; timezone: string }> {
  const profile = await loadProfile({ env });
  const tz = profile.timezone;
  const today = localDateKey(now, tz);
  const tomorrow = addDaysKey(today, 1);
  const from = isoNoMs(atLocal(tomorrow, '00:00', tz));
  const to = isoNoMs(atLocal(addDaysKey(tomorrow, 1), '00:00', tz));
  const ev = await env.DB.prepare(
    'SELECT title, start FROM events WHERE all_day = 0 AND start >= ? AND start < ? ORDER BY start LIMIT 1',
  )
    .bind(from, to)
    .all<{ title: string; start: string }>();
  const dash = await env.DB.prepare(
    'SELECT title, start FROM dashboard_events WHERE all_day = 0 AND start >= ? AND start < ? ORDER BY start LIMIT 1',
  )
    .bind(from, to)
    .all<{ title: string; start: string }>();
  const commitments: Commitment[] = [...(ev.results ?? []), ...(dash.results ?? [])].map((r) => ({
    title: r.title,
    start: Date.parse(r.start),
  }));
  return { ...suggestBedtime(today, commitments, profile), today, timezone: tz };
}
