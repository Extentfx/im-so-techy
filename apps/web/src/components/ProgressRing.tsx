import { lazy, Suspense } from 'react';
import { clamp01 } from '../lib/timeOfDay';
import { hasWebGL, useReducedMotion } from '../lib/useMotion';

const Ring3D = lazy(() => import('./Ring3D'));

/** SVG ring: the accessible baseline and the reduced-motion / no-WebGL fallback. */
function RingSvg({ value, size }: { value: number; size: number }) {
  const r = size / 2 - 10;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--glass-border)"
        strokeWidth="10"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={`${c * value} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

export function ProgressRing({
  value,
  label,
  caption,
  size = 132,
}: {
  value: number;
  label: string;
  caption: string;
  size?: number;
}) {
  const v = clamp01(value);
  const reduced = useReducedMotion();
  const use3D = !reduced && hasWebGL();
  return (
    <div
      className="relative grid place-items-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${label}: ${Math.round(v * 100)} percent, ${caption}`}
    >
      {use3D ? (
        <Suspense fallback={<RingSvg value={v} size={size} />}>
          <Ring3D value={v} size={size} />
        </Suspense>
      ) : (
        <RingSvg value={v} size={size} />
      )}
      <div className="pointer-events-none absolute text-center">
        <div className="font-display text-3xl leading-none">{Math.round(v * 100)}%</div>
        <div className="mt-1 text-[10px] uppercase tracking-wider text-[var(--ink-soft)]">
          {label}
        </div>
      </div>
    </div>
  );
}
