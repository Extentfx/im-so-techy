/** Pure gym maths: estimated one-rep max, PR detection and progressive-overload suggestions. */

export interface SetLike {
  weightKg: number;
  reps: number;
}

/** Epley estimate. Singles are their own max. */
export const e1rm = (weightKg: number, reps: number): number =>
  reps <= 1 ? weightKg : Math.round(weightKg * (1 + reps / 30) * 100) / 100;

export interface Pr {
  index: number;
  kind: 'e1rm' | 'weight' | 'reps';
  value: number;
}

/**
 * Compare new sets of one exercise with its prior history. A set is a PR when it beats the best
 * estimated 1RM, the heaviest weight, or the most reps at the same weight. Nothing is a PR the
 * very first time an exercise is logged (there is nothing to beat). Sets within the same workout
 * count towards each other's baseline.
 */
export function detectPrs(history: SetLike[], next: SetLike[]): Pr[] {
  if (!history.length) return [];
  const prs: Pr[] = [];
  let bestE = Math.max(...history.map((s) => e1rm(s.weightKg, s.reps)));
  let bestW = Math.max(...history.map((s) => s.weightKg));
  const repsAt = new Map<number, number>();
  for (const s of history) repsAt.set(s.weightKg, Math.max(repsAt.get(s.weightKg) ?? 0, s.reps));

  next.forEach((s, index) => {
    if (s.reps <= 0 || s.weightKg < 0) return;
    const est = e1rm(s.weightKg, s.reps);
    let kind: Pr['kind'] | null = null;
    if (est > bestE + 0.001) kind = 'e1rm';
    else if (s.weightKg > bestW) kind = 'weight';
    else if (s.reps > (repsAt.get(s.weightKg) ?? Infinity)) kind = 'reps';
    if (kind)
      prs.push({
        index,
        kind,
        value: kind === 'e1rm' ? est : kind === 'weight' ? s.weightKg : s.reps,
      });
    bestE = Math.max(bestE, est);
    bestW = Math.max(bestW, s.weightKg);
    repsAt.set(s.weightKg, Math.max(repsAt.get(s.weightKg) ?? 0, s.reps));
  });
  return prs;
}

/** Double progression: hit the top of the rep range on every set -> add weight, else add a rep. */
export function suggestNext(
  last: SetLike[],
  opts: { repMin?: number; repMax?: number; incrementKg?: number } = {},
): { weightKg: number; reps: number; reason: string } | null {
  const { repMin = 8, repMax = 12, incrementKg = 2.5 } = opts;
  if (!last.length) return null;
  const top = Math.max(...last.map((s) => s.weightKg));
  const atTop = last.filter((s) => s.weightKg === top);
  if (atTop.every((s) => s.reps >= repMax)) {
    return {
      weightKg: top + incrementKg,
      reps: repMin,
      reason: `You hit ${repMax} reps on every set, so add ${incrementKg} kg`,
    };
  }
  const lowest = Math.min(...atTop.map((s) => s.reps));
  return {
    weightKg: top,
    reps: Math.min(repMax, lowest + 1),
    reason: `Same weight, aim for ${Math.min(repMax, lowest + 1)} reps`,
  };
}

export const LB_PER_KG = 2.2046226218;
export const kgToLb = (kg: number): number => Math.round(kg * LB_PER_KG * 10) / 10;
export const lbToKg = (lb: number): number => Math.round((lb / LB_PER_KG) * 100) / 100;
