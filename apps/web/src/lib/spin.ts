/**
 * Maths for a spinnable corner dial. Items sit on a quarter arc around the
 * bottom-right screen corner; only VISIBLE of them show at once and the rest
 * loop round as the dial turns. `pos` is the dial position in item units.
 */

export const VISIBLE = 4;
/** Fully visible items span these angles, leaving room for dots and labels near the screen edges. */
export const ANGLE_START = 16;
export const ANGLE_END = 74;
export const STEP_DEG = (ANGLE_END - ANGLE_START) / (VISIBLE - 1);
/** How far (in item slots) an item takes to fade out beyond either end of the window. */
export const FADE = 0.75;

export const mod = (x: number, n: number): number => ((x % n) + n) % n;
export const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** Slot of item i for a dial at `pos`, in [-1.5, n-1.5). Slots 0..VISIBLE-1 are fully on screen. */
export function slotOf(i: number, pos: number, n: number): number {
  return mod(i - pos + 1.5, n) - 1.5;
}

/** Screen angle: 0 runs left along the bottom edge, 90 runs up the right edge. */
export function angleOf(slot: number): number {
  return ANGLE_START + slot * STEP_DEG;
}

export function fadeOf(slot: number): number {
  if (slot < 0) return clamp01(1 + slot / FADE);
  if (slot > VISIBLE - 1) return clamp01(1 - (slot - (VISIBLE - 1)) / FADE);
  return 1;
}

/** Whole-number dial position that puts `item` on screen, moving as little as possible from `pos`. */
export function posToReveal(item: number, pos: number, n: number): number {
  const p0 = Math.round(pos);
  const s = Math.round(slotOf(item, p0, n));
  if (s < 0) return p0 + s;
  if (s > VISIBLE - 1) return p0 + (s - (VISIBLE - 1));
  return p0;
}

/** Where to settle after a release: nearest whole position, nudged along by fling velocity (items/ms). */
export function settleTarget(pos: number, velocity: number): number {
  const fling = Math.max(-2, Math.min(2, velocity * 150));
  return Math.round(pos + fling);
}

/** Shortest signed difference between two angles in degrees. */
export function angleDelta(from: number, to: number): number {
  return mod(to - from + 180, 360) - 180;
}
