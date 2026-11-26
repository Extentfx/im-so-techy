export type Palette = { a: string; b: string; c: string };

/** Pure: backdrop orb colors by hour (0-23). Sleep modifies saturation later (Phase 4). */
export function paletteForHour(hour: number): Palette {
  const h = ((hour % 24) + 24) % 24;
  if (h < 5) return { a: '#3a4cff', b: '#7a3cff', c: '#1b2a6b' }; // night
  if (h < 9) return { a: '#ffb36b', b: '#ff7fa8', c: '#7fb0ff' }; // morning
  if (h < 17) return { a: '#6ba8ff', b: '#9b8cff', c: '#7fe0ff' }; // day
  if (h < 21) return { a: '#ff8a5c', b: '#c26bff', c: '#5c7cff' }; // evening
  return { a: '#3a4cff', b: '#7a3cff', c: '#1b2a6b' };
}

export const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

const hex = (n: number) =>
  Math.round(Math.min(255, Math.max(0, n)))
    .toString(16)
    .padStart(2, '0');

/** Drain colour towards grey as sleep quality (0..1, 1 = hit your target) drops. */
export function tintForSleep(color: string, quality: number): string {
  const q = clamp01(quality);
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  const grey = 0.3 * r + 0.59 * g + 0.11 * b;
  const k = 0.55 * (1 - q); // at most 55% towards grey
  return `#${hex(r + (grey - r) * k)}${hex(g + (grey - g) * k)}${hex(b + (grey - b) * k)}`;
}

/** Last night's sleep as a 0..1 quality figure, or 1 (no change) when there is no data. */
export function sleepQuality(minutes: number | null, targetHours: number): number {
  return minutes === null ? 1 : clamp01(minutes / (targetHours * 60));
}
