import { lazy, Suspense } from 'react';
import { hasWebGL, useReducedMotion } from '../lib/useMotion';

const Orbs = lazy(() => import('./Orbs'));

/**
 * Fixed full-screen backdrop. The body's CSS gradient is always underneath, so
 * reduced-motion users and devices without WebGL simply see the gradient.
 */
export function Backdrop() {
  const reduced = useReducedMotion();
  if (reduced || !hasWebGL()) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10">
      <Suspense fallback={null}>
        <Orbs />
      </Suspense>
    </div>
  );
}
