/**
 * Geometry for a quarter-circle wheel anchored in the bottom-right screen corner.
 * Coordinates live in a square viewBox whose bottom-right point is the corner.
 * Angle 0 runs left along the bottom edge; 90 runs up the right edge.
 */

export const VIEW = 300;
export const R_INNER = 54;
export const R_OUTER = 292;

export interface Sector {
  index: number;
  /** Center angle in degrees (0..90). Index 0 is nearest the top of the right edge. */
  angle: number;
  path: string;
  label: { x: number; y: number };
}

const rad = (deg: number) => (deg * Math.PI) / 180;
const pt = (r: number, deg: number) => ({
  x: VIEW - r * Math.cos(rad(deg)),
  y: VIEW - r * Math.sin(rad(deg)),
});
const f = (n: number) => n.toFixed(2);

export function wheelSectors(count: number, gapDeg = 1.6): Sector[] {
  const span = 90 / count;
  return Array.from({ length: count }, (_, index) => {
    const hi = 90 - index * span; // top edge of this wedge
    const lo = hi - span; // bottom edge
    const a0 = lo + gapDeg / 2;
    const a1 = hi - gapDeg / 2;
    const o0 = pt(R_OUTER, a0);
    const o1 = pt(R_OUTER, a1);
    const i1 = pt(R_INNER, a1);
    const i0 = pt(R_INNER, a0);
    // Outer arc runs a0 -> a1 (clockwise on screen, sweep 1); inner arc returns (sweep 0).
    const path =
      `M${f(o0.x)} ${f(o0.y)} A${R_OUTER} ${R_OUTER} 0 0 1 ${f(o1.x)} ${f(o1.y)} ` +
      `L${f(i1.x)} ${f(i1.y)} A${R_INNER} ${R_INNER} 0 0 0 ${f(i0.x)} ${f(i0.y)} Z`;
    const angle = (lo + hi) / 2;
    return { index, angle, path, label: pt((R_INNER + R_OUTER) / 2 + 6, angle) };
  });
}
