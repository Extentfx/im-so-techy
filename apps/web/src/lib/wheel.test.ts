import { describe, expect, it } from 'vitest';
import { R_INNER, R_OUTER, VIEW, wheelSectors } from './wheel';

describe('wheelSectors', () => {
  const s = wheelSectors(7);
  it('makes one sector per item, ordered from the top of the right edge downward', () => {
    expect(s).toHaveLength(7);
    for (let i = 1; i < s.length; i++) expect(s[i]!.angle).toBeLessThan(s[i - 1]!.angle);
  });
  it('keeps every label inside the viewBox and between the two radii', () => {
    for (const { label } of s) {
      expect(label.x).toBeGreaterThan(0);
      expect(label.x).toBeLessThanOrEqual(VIEW);
      expect(label.y).toBeGreaterThan(0);
      expect(label.y).toBeLessThanOrEqual(VIEW);
      const r = Math.hypot(VIEW - label.x, VIEW - label.y);
      expect(r).toBeGreaterThan(R_INNER);
      expect(r).toBeLessThan(R_OUTER + 10);
    }
  });
  it('fills the quarter: first wedge hugs the right edge, last hugs the bottom edge', () => {
    expect(s[0]!.angle).toBeGreaterThan(80);
    expect(s[6]!.angle).toBeLessThan(10);
  });
  it('emits closed arc paths', () => {
    for (const { path } of s) expect(path).toMatch(/^M.*A.*L.*A.*Z$/);
  });
});
