import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import type { Mesh } from 'three';
import { usePageVisible } from '../lib/useMotion';

function Arc({ value }: { value: number }) {
  const mesh = useRef<Mesh>(null);
  // Gentle tilt wobble so the ring reads as 3D without distracting.
  useFrame(({ clock }) => {
    if (mesh.current) mesh.current.rotation.x = Math.sin(clock.elapsedTime * 0.6) * 0.18;
  });
  return (
    <group rotation={[0, 0, Math.PI / 2]}>
      <mesh>
        <torusGeometry args={[1, 0.14, 24, 96]} />
        <meshStandardMaterial color="#ffffff" transparent opacity={0.14} />
      </mesh>
      <mesh ref={mesh}>
        <torusGeometry args={[1, 0.17, 24, 96, Math.max(0.001, value) * Math.PI * 2]} />
        <meshStandardMaterial
          color="#6f8cff"
          emissive="#4a5fff"
          emissiveIntensity={0.55}
          roughness={0.35}
        />
      </mesh>
    </group>
  );
}

export default function Ring3D({ value, size }: { value: number; size: number }) {
  const visible = usePageVisible();
  return (
    <Canvas
      style={{ width: size, height: size }}
      dpr={[1, 1.5]}
      frameloop={visible ? 'always' : 'never'}
      camera={{ position: [0, 0, 3.6], fov: 40 }}
      gl={{ alpha: true, antialias: true, powerPreference: 'low-power' }}
    >
      <ambientLight intensity={0.9} />
      <directionalLight position={[2, 3, 4]} intensity={1.4} />
      <Arc value={value} />
    </Canvas>
  );
}
