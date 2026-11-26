import { describe, expect, it } from 'vitest';
import { clamp01, paletteForHour } from './timeOfDay';

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
