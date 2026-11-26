/** Pure sleep maths: debt, recovery decision and a bedtime derived from tomorrow's first commitment. */
import { addDaysKey, atLocal } from './tz';

export interface Night {
  date: string; // local date you woke up
  minutes: number;
}

/** Hours short of the target over the logged nights in the last seven. Surplus does not repay debt. */
export function sleepDebtHours(nights: Night[], targetHours: number): number {
  const recent = [...nights].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7);
  const short = recent.reduce((a, n) => a + Math.max(0, targetHours * 60 - n.minutes), 0);
  return Math.round((short / 60) * 10) / 10;
}

export interface Recovery {
  light: boolean;
  reason: string | null;
}

/** A hard session swaps for a light one after a rough night or a large weekly debt. */
export function recoveryFrom(lastNightMinutes: number | null, debtHours: number): Recovery {
  if (lastNightMinutes !== null && lastNightMinutes < 330) {
    return {
      light: true,
      reason: `You slept ${Math.floor(lastNightMinutes / 60)}h ${lastNightMinutes % 60}m last night`,
    };
  }
  if (debtHours >= 4)
    return { light: true, reason: `You are ${debtHours} hours short on sleep this week` };
  return { light: false, reason: null };
}

export interface Commitment {
  start: number;
  title: string;
}

/**
 * Bedtime from tomorrow's first timed commitment: be up `prepMinutes` before it, then count back the
 * hours you aim to sleep. With no commitments it uses your usual wake time.
 */
export function suggestBedtime(
  today: string,
  commitments: Commitment[],
  p: { wakeTime: string; sleepHours: number; timezone: string },
  prepMinutes = 60,
): { bedtime: number; wake: number; basedOn: string } {
  const tomorrow = addDaysKey(today, 1);
  const dayStart = atLocal(tomorrow, '00:00', p.timezone);
  const dayEnd = atLocal(addDaysKey(tomorrow, 1), '00:00', p.timezone);
  const first = commitments
    .filter((c) => c.start >= dayStart && c.start < dayEnd)
    .sort((a, b) => a.start - b.start)[0];
  const usual = atLocal(tomorrow, p.wakeTime, p.timezone);
  // A late first commitment lets you sleep in, but never later than three hours past your usual wake time.
  const wake = first ? Math.min(first.start - prepMinutes * 60_000, usual + 3 * 3_600_000) : usual;
  return {
    bedtime: wake - p.sleepHours * 3_600_000,
    wake,
    basedOn: first ? first.title : 'your usual wake time',
  };
}
