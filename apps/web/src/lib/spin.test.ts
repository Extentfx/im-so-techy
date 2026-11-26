import { describe, expect, it } from 'vitest';
import {
  ANGLE_END,
  ANGLE_START,
  angleDelta,
  angleOf,
  fadeOf,
  posToReveal,
  settleTarget,
  slotOf,
  VISIBLE,
} from './spin';

const N = 7;

describe('spin maths', () => {
  it('shows exactly four items at rest, at distinct angles inside the quarter', () => {
    for (let pos = -3; pos <= 10; pos++) {
      const shown = Array.from({ length: N }, (_, i) => slotOf(i, pos, N)).filter(
        (s) => fadeOf(s) === 1,
      );
      expect(shown).toHaveLength(VISIBLE);
      for (const s of shown) {
        expect(angleOf(s)).toBeGreaterThanOrEqual(ANGLE_START);
        expect(angleOf(s)).toBeLessThanOrEqual(ANGLE_END);
      }
    }
  });
  it('loops: every item gets its turn on screen as the dial spins', () => {
    const seen = new Set<number>();
    for (let pos = 0; pos < N; pos++)
      for (let i = 0; i < N; i++) if (fadeOf(slotOf(i, pos, N)) === 1) seen.add(i);
    expect(seen.size).toBe(N);
  });
  it('fades items out beyond the window ends', () => {
    expect(fadeOf(-0.75)).toBe(0);
    expect(fadeOf(VISIBLE - 1 + 0.75)).toBe(0);
    expect(fadeOf(-0.3)).toBeGreaterThan(0);
    expect(fadeOf(-0.3)).toBeLessThan(1);
  });
  it('reveals a hidden item with the smallest whole-number turn', () => {
    for (let item = 0; item < N; item++) {
      const p = posToReveal(item, 0, N);
      expect(Number.isInteger(p)).toBe(true);
      expect(fadeOf(slotOf(item, p, N))).toBe(1);
    }
    expect(posToReveal(1, 0, N)).toBe(0); // already visible: no movement
  });
  it('settles to a whole position and caps fling distance', () => {
    expect(Number.isInteger(settleTarget(2.4, 0))).toBe(true);
    expect(settleTarget(0, 0.001)).toBe(0);
    expect(settleTarget(0, 10)).toBe(2);
    expect(settleTarget(0, -10)).toBe(-2);
  });
  it('takes the short way round for angle deltas', () => {
    expect(angleDelta(350, 10)).toBe(20);
    expect(angleDelta(10, 350)).toBe(-20);
  });
});
