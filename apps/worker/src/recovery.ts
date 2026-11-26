import {
  addDaysKey,
  localDateKey,
  recoveryFrom,
  sleepDebtHours,
  type Night,
  type Recovery,
} from '@life/shared';
import type { Env } from './env';
import { loadProfile } from './foundation';

export async function recentNights(env: Env, tz: string, now: number): Promise<Night[]> {
  const since = addDaysKey(localDateKey(now, tz), -9);
  const { results } = await env.DB.prepare(
    'SELECT date, minutes FROM sleep_log WHERE date >= ? ORDER BY date DESC LIMIT 14',
  )
    .bind(since)
    .all<Night>();
  return results ?? [];
}

/** Whether the next sessions should be light: from last night's sleep and this week's debt. */
export async function recoveryMode(
  env: Env,
  now: number,
): Promise<Recovery & { debtHours: number }> {
  const profile = await loadProfile({ env });
  const nights = await recentNights(env, profile.timezone, now);
  const today = localDateKey(now, profile.timezone);
  const yesterday = addDaysKey(today, -1);
  const last =
    nights.find((n) => n.date === today) ?? nights.find((n) => n.date === yesterday) ?? null;
  const debt = sleepDebtHours(nights, profile.sleepHours);
  return { ...recoveryFrom(last?.minutes ?? null, debt), debtHours: debt };
}
