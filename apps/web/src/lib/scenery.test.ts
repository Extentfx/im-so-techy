import { describe, expect, it } from 'vitest';
import { H, ridgePath, ridgeY, SCENES, starField, trees } from './scenery';

describe('scenery', () => {
  it('is deterministic for a seed and differs across seeds', () => {
    expect(ridgePath(1, 500, 50)).toBe(ridgePath(1, 500, 50));
    expect(ridgePath(1, 500, 50)).not.toBe(ridgePath(2, 500, 50));
  });
  it('keeps ridges within amplitude of the base', () => {
    for (let x = 0; x <= 1200; x += 50) {
      expect(Math.abs(ridgeY(3, 500, 50, x) - 500)).toBeLessThanOrEqual(50 * 1.84);
    }
  });
  it('places stars in the upper half and trees on the ridge', () => {
    expect(starField(4, 50).every((s) => s.y <= H * 0.5)).toBe(true);
    const t = trees(5, 9, 700, 30, 10);
    expect(t).toHaveLength(10);
    expect(t.every((p) => Math.abs(p.y - 706 - (ridgeY(9, 700, 30, p.x) - 700)) < 0.001)).toBe(
      true,
    );
  });
  it('defines every scene with at least one ridge', () => {
    for (const s of Object.values(SCENES)) expect(s.ridges.length).toBeGreaterThan(0);
  });
});
