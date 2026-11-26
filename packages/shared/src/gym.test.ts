import { describe, expect, it } from 'vitest';
import { detectPrs, e1rm, kgToLb, lbToKg, suggestNext } from './gym';

describe('gym maths', () => {
  it('estimates a one-rep max (Epley) and treats singles as their own max', () => {
    expect(e1rm(100, 1)).toBe(100);
    expect(e1rm(100, 5)).toBeCloseTo(116.67, 1);
  });
  it('flags no PRs the first time an exercise is logged', () => {
    expect(detectPrs([], [{ weightKg: 100, reps: 5 }])).toEqual([]);
  });
  it('detects e1RM, weight and rep PRs', () => {
    const hist = [
      { weightKg: 100, reps: 5 },
      { weightKg: 80, reps: 10 },
    ];
    expect(detectPrs(hist, [{ weightKg: 102.5, reps: 5 }])[0]).toMatchObject({
      index: 0,
      kind: 'e1rm',
    });
    expect(detectPrs(hist, [{ weightKg: 100, reps: 4 }])).toEqual([]);
    expect(detectPrs(hist, [{ weightKg: 80, reps: 11 }])[0]?.kind).toBe('reps');
    expect(detectPrs([{ weightKg: 60, reps: 12 }], [{ weightKg: 60, reps: 13 }])[0]?.kind).toBe(
      'e1rm',
    );
  });
  it('counts earlier sets in the same workout as the new baseline', () => {
    const prs = detectPrs(
      [{ weightKg: 100, reps: 5 }],
      [
        { weightKg: 105, reps: 5 },
        { weightKg: 105, reps: 5 },
      ],
    );
    expect(prs.map((p) => p.index)).toEqual([0]);
  });
  it('uses double progression for suggestions', () => {
    expect(suggestNext([])).toBeNull();
    expect(
      suggestNext([
        { weightKg: 60, reps: 12 },
        { weightKg: 60, reps: 12 },
      ]),
    ).toMatchObject({ weightKg: 62.5, reps: 8 });
    expect(
      suggestNext([
        { weightKg: 60, reps: 10 },
        { weightKg: 60, reps: 9 },
      ]),
    ).toMatchObject({ weightKg: 60, reps: 10 });
  });
  it('converts units both ways', () => {
    expect(kgToLb(100)).toBeCloseTo(220.5, 1);
    expect(lbToKg(kgToLb(80))).toBeCloseTo(80, 0);
  });
});
