import { lazy, Suspense } from 'react';
import { useEffect, useState } from 'react';
import { getSleep } from '../lib/api';
import { sleepQuality } from '../lib/timeOfDay';
import { hasWebGL, useReducedMotion } from '../lib/useMotion';

const Orbs = lazy(() => import('./Orbs'));

/**
 * Fixed full-screen backdrop. The body's CSS gradient is always underneath, so
 * reduced-motion users and devices without WebGL simply see the gradient.
 */
export function Backdrop() {
  const reduced = useReducedMotion();
  const [quality, setQuality] = useState(1);
  // Last night's sleep tints the orbs: a short night drains their colour.
  useEffect(() => {
    getSleep().then(
      (s) => setQuality(sleepQuality(s.nights[0]?.minutes ?? null, s.targetHours)),
      () => undefined,
    );
  }, []);
  if (reduced || !hasWebGL()) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10">
      <Suspense fallback={null}>
        <Orbs sleepQuality={quality} />
      </Suspense>
    </div>
  );
}
