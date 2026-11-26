import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import type { Mesh } from 'three';
import { paletteForHour, tintForSleep } from '../lib/timeOfDay';
import { usePageVisible } from '../lib/useMotion';

interface OrbSpec {
  pos: [number, number, number];
  r: number;
  color: string;
  speed: number;
  phase: number;
}

function Orb({ spec }: { spec: OrbSpec }) {
  const ref = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const t = clock.elapsedTime * spec.speed + spec.phase;
    m.position.set(
      spec.pos[0] + Math.sin(t) * 0.6,
      spec.pos[1] + Math.cos(t * 0.8) * 0.5,
      spec.pos[2],
    );
  });
  return (
    <mesh ref={ref} position={spec.pos}>
      <sphereGeometry args={[spec.r, 32, 32]} />
      <meshStandardMaterial
        color={spec.color}
        transparent
        opacity={0.5}
        roughness={0.2}
        metalness={0.1}
      />
    </mesh>
  );
}

export default function Orbs({ sleepQuality = 1 }: { sleepQuality?: number }) {
  const visible = usePageVisible();
  const specs = useMemo<OrbSpec[]>(() => {
    const p0 = paletteForHour(new Date().getHours());
    const p = {
      a: tintForSleep(p0.a, sleepQuality),
      b: tintForSleep(p0.b, sleepQuality),
      c: tintForSleep(p0.c, sleepQuality),
    };
    return [
      { pos: [-3.2, 1.8, -2], r: 1.7, color: p.a, speed: 0.12, phase: 0 },
      { pos: [3.4, -1.2, -3], r: 2.1, color: p.b, speed: 0.09, phase: 2 },
      { pos: [0.4, 2.8, -4], r: 1.2, color: p.c, speed: 0.15, phase: 4 },
      { pos: [-1.2, -2.6, -3], r: 1.4, color: p.c, speed: 0.1, phase: 1 },
    ];
  }, [sleepQuality]);
  return (
    <Canvas
      dpr={[1, 1.5]}
      frameloop={visible ? 'always' : 'never'}
      camera={{ position: [0, 0, 6], fov: 50 }}
      gl={{ alpha: true, antialias: false, powerPreference: 'low-power' }}
    >
      <ambientLight intensity={1.1} />
      <directionalLight position={[3, 4, 5]} intensity={1.2} />
      {specs.map((s, i) => (
        <Orb key={i} spec={s} />
      ))}
    </Canvas>
  );
}
