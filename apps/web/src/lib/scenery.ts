/** Procedural scenic landscapes: pure, seeded, so they are tiny, self-hosted and testable. */

export const W = 1200;
export const H = 800;
/** Landscapes are lifted so the horizon stays visible above the onboarding card on phones. */
export const LIFT = 150;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ridge height at x: three summed sine octaves with seeded phases. */
export function ridgeY(seed: number, base: number, amp: number, x: number): number {
  const r = mulberry32(seed);
  let y = base;
  for (let k = 1; k <= 3; k++) {
    const phase = r() * Math.PI * 2;
    const freq = (0.004 + r() * 0.004) * k;
    y += (amp / k) * Math.sin(x * freq + phase);
  }
  return y;
}

export function ridgePath(seed: number, base: number, amp: number): string {
  let d = `M0 ${H + LIFT}`;
  for (let x = 0; x <= W; x += 20) d += ` L${x} ${ridgeY(seed, base, amp, x).toFixed(1)}`;
  return `${d} L${W} ${H + LIFT} Z`;
}

export interface Star {
  x: number;
  y: number;
  r: number;
  o: number;
}

export function starField(seed: number, n: number): Star[] {
  const r = mulberry32(seed);
  return Array.from({ length: n }, () => ({
    x: r() * W,
    y: r() * H * 0.5,
    r: 0.6 + r() * 1.4,
    o: 0.4 + r() * 0.6,
  }));
}

export interface Tree {
  x: number;
  y: number;
  h: number;
}

export function trees(
  seed: number,
  ridgeSeed: number,
  base: number,
  amp: number,
  n: number,
): Tree[] {
  const r = mulberry32(seed);
  return Array.from({ length: n }, () => {
    const x = r() * W;
    return { x, y: ridgeY(ridgeSeed, base, amp, x) + 6, h: 26 + r() * 38 };
  });
}

export interface SceneSpec {
  id: string;
  sky: [string, string, string];
  sun?: { x: number; y: number; r: number; color: string };
  moon?: { x: number; y: number; r: number };
  stars?: number;
  water?: { y: number; color: string };
  forest?: string;
  ridges: { color: string; base: number; amp: number }[];
}

export const SCENES: Record<string, SceneSpec> = {
  dawn: {
    id: 'dawn',
    sky: ['#6f6bd1', '#ff9fb2', '#ffd9a8'],
    sun: { x: 760, y: 470, r: 70, color: '#fff1cf' },
    ridges: [
      { color: '#b48ad0', base: 470, amp: 50 },
      { color: '#8a6bb8', base: 530, amp: 60 },
      { color: '#5f4a9a', base: 600, amp: 55 },
      { color: '#3a2f6e', base: 690, amp: 40 },
    ],
  },
  forest: {
    id: 'forest',
    sky: ['#9fd8c4', '#d8efc9', '#fbf0c4'],
    sun: { x: 300, y: 300, r: 55, color: '#fffbe0' },
    forest: '#173d34',
    ridges: [
      { color: '#8fc4a4', base: 470, amp: 55 },
      { color: '#5fa088', base: 540, amp: 50 },
      { color: '#2f6e5c', base: 620, amp: 45 },
      { color: '#1b4a3f', base: 710, amp: 30 },
    ],
  },
  lake: {
    id: 'lake',
    sky: ['#6cb8ff', '#b6e0ff', '#eef8ff'],
    sun: { x: 900, y: 220, r: 48, color: '#ffffff' },
    water: { y: 600, color: '#4a8fd0' },
    ridges: [
      { color: '#9ab7e0', base: 420, amp: 70 },
      { color: '#6e92c8', base: 490, amp: 60 },
      { color: '#47689f', base: 560, amp: 45 },
    ],
  },
  night: {
    id: 'night',
    sky: ['#070b1d', '#161a46', '#2c2a6e'],
    moon: { x: 880, y: 190, r: 46 },
    stars: 90,
    ridges: [
      { color: '#27306b', base: 520, amp: 60 },
      { color: '#171c47', base: 600, amp: 55 },
      { color: '#0c1030', base: 690, amp: 40 },
    ],
  },
  dusk: {
    id: 'dusk',
    sky: ['#2b1b5a', '#e0586f', '#ffbf7a'],
    sun: { x: 600, y: 560, r: 80, color: '#ffe3a8' },
    water: { y: 580, color: '#7a3b78' },
    ridges: [{ color: '#3a1f5c', base: 585, amp: 18 }],
  },
};
