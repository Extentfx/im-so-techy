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
