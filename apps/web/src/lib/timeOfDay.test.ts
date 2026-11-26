import { describe, expect, it } from 'vitest';
import { clamp01, paletteForHour, sleepQuality, tintForSleep } from './timeOfDay';

describe('paletteForHour', () => {
  it('wraps hours and returns distinct night and day palettes', () => {
    expect(paletteForHour(25)).toEqual(paletteForHour(1));
    expect(paletteForHour(2)).not.toEqual(paletteForHour(12));
  });
});
describe('clamp01', () => {
  it('clamps', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(0.4)).toBe(0.4);
  });
});

describe('sleep tint', () => {
  it('leaves colours alone at full quality and greys them as sleep drops', () => {
    expect(tintForSleep('#3a4cff', 1)).toBe('#3a4cff');
    const tired = tintForSleep('#3a4cff', 0);
    expect(tired).not.toBe('#3a4cff');
    expect(tired).toMatch(/^#[0-9a-f]{6}$/);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(tired.slice(i, i + 2), 16));
    const [r0, g0, b0] = [0x3a, 0x4c, 0xff];
    expect(Math.abs(r! - g!)).toBeLessThan(Math.abs(r0 - g0) + 1); // less saturated
    expect(b!).toBeLessThan(b0);
  });
  it('scores sleep against the target', () => {
    expect(sleepQuality(null, 8)).toBe(1);
    expect(sleepQuality(240, 8)).toBe(0.5);
    expect(sleepQuality(700, 8)).toBe(1);
  });
});
