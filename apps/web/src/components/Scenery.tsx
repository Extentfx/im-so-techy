import { memo, useId, useMemo } from 'react';
import { H, LIFT, ridgePath, SCENES, starField, trees, W } from '../lib/scenery';

/** One landscape as inline SVG. Layers drift sideways by `shift` for gentle parallax. */
const Scene = memo(function Scene({
  name,
  seed,
  shift,
}: {
  name: string;
  seed: number;
  shift: number;
}) {
  const spec = SCENES[name]!;
  const gid = useId();
  const geometry = useMemo(
    () => ({
      ridges: spec.ridges.map((r, i) => ({ ...r, d: ridgePath(seed + i * 17, r.base, r.amp) })),
      stars: spec.stars ? starField(seed, spec.stars) : [],
      trees: spec.forest
        ? trees(
            seed + 5,
            seed + (spec.ridges.length - 1) * 17,
            spec.ridges.at(-1)!.base,
            spec.ridges.at(-1)!.amp,
            46,
          )
        : [],
    }),
    [spec, seed],
  );
  const drift = (depth: number) => ({ transform: `translateX(${-shift * depth}px)` });

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${gid}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={spec.sky[0]} />
          <stop offset="0.55" stopColor={spec.sky[1]} />
          <stop offset="1" stopColor={spec.sky[2]} />
        </linearGradient>
        <radialGradient id={`${gid}-glow`}>
          <stop offset="0" stopColor="#fff" stopOpacity="0.6" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${gid}-fog`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.18" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#${gid}-sky)`} />
      <g className="scene-layer" style={drift(4)}>
        {geometry.stars.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#fff" opacity={s.o} />
        ))}
      </g>
      <g transform={`translate(0 ${-LIFT})`}>
        <g className="scene-layer" style={drift(4)}>
          {spec.sun && (
            <>
              <circle
                cx={spec.sun.x}
                cy={spec.sun.y}
                r={spec.sun.r * 3.2}
                fill={`url(#${gid}-glow)`}
              />
              <circle cx={spec.sun.x} cy={spec.sun.y} r={spec.sun.r} fill={spec.sun.color} />
            </>
          )}
          {spec.moon && (
            <>
              <circle
                cx={spec.moon.x}
                cy={spec.moon.y}
                r={spec.moon.r * 3}
                fill={`url(#${gid}-glow)`}
              />
              <circle cx={spec.moon.x} cy={spec.moon.y} r={spec.moon.r} fill="#f4f1e6" />
              <circle
                cx={spec.moon.x + 14}
                cy={spec.moon.y - 8}
                r={spec.moon.r * 0.92}
                fill={spec.sky[1]}
                opacity="0.9"
              />
            </>
          )}
        </g>
        {geometry.ridges.map((r, i) => (
          <g key={i} className="scene-layer" style={drift(8 + i * 10)}>
            <path d={r.d} fill={r.color} />
          </g>
        ))}
        {spec.water && (
          <g>
            <rect
              x="0"
              y={spec.water.y}
              width={W}
              height={H + LIFT - spec.water.y}
              fill={spec.water.color}
            />
            {spec.sun && (
              <rect
                x={spec.sun.x - 40}
                y={spec.water.y}
                width="80"
                height={H + LIFT - spec.water.y}
                fill={spec.sun.color}
                opacity="0.35"
              />
            )}
            <rect
              x="0"
              y={spec.water.y}
              width={W}
              height={H + LIFT - spec.water.y}
              fill={`url(#${gid}-fog)`}
            />
          </g>
        )}
        {spec.forest && (
          <g className="scene-layer" style={drift(60)} fill={spec.forest}>
            {geometry.trees.map((t, i) => (
              <path
                key={i}
                d={`M${t.x - t.h * 0.28} ${t.y} L${t.x} ${t.y - t.h} L${t.x + t.h * 0.28} ${t.y} Z`}
              />
            ))}
          </g>
        )}
      </g>
      <rect y={H * 0.55} width={W} height={H * 0.45} fill={`url(#${gid}-fog)`} />
    </svg>
  );
});

export function Scenery({ scene, seed, step }: { scene: string; seed: number; step: number }) {
  // Keep every scene mounted and cross-fade, so changing steps never flashes.
  return (
    <div aria-hidden="true" className="fixed inset-0 -z-10 overflow-hidden">
      {Object.keys(SCENES).map((name) => (
        <div
          key={name}
          className="scene-fade absolute inset-0"
          style={{ opacity: name === scene ? 1 : 0 }}
        >
          <Scene name={name} seed={seed} shift={name === scene ? step * 18 : 0} />
        </div>
      ))}
    </div>
  );
}
