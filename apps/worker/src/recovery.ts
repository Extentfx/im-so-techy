import type { Env } from './env';

/** Whether the next sessions should be light. Phase 4 (sleep) decides this from sleep debt. */
export async function recoveryMode(
  _env: Env,
  _now: number,
): Promise<{ light: boolean; reason: string | null }> {
  return { light: false, reason: null };
}
