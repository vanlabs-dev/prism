import { useMemo, useRef, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { ConeRenderData } from './types';

interface ProbabilityCone3DProps {
  data: ConeRenderData | null;
  horizonDays: number;
  targetLine?: number;
  liquidationPrice?: number;
  takeProfit?: number;
  stopLoss?: number;
}

/** Reference spread: 15% of current price = full visual width (16 units). */
const REF_SPREAD = 0.15;
const MIN_SCALE = 0.08;

const STEPS_X = 80;
const STEPS_Z = 160;
const BASE_WIDTH = 16;
const MESH_Y = -2;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getLogNormalDensity(x: number, currentPrice: number, volatility: number, tYears: number): number {
  if (x <= 0) return 0;
  if (tYears === 0) return x === currentPrice ? 1 : 0;
  const mu = Math.log(currentPrice) - 0.5 * volatility * volatility * tYears;
  const sigma = volatility * Math.sqrt(tYears);
  const coeff = 1 / (x * sigma * Math.sqrt(2 * Math.PI));
  const exponent = -Math.pow(Math.log(x) - mu, 2) / (2 * sigma * sigma);
  return coeff * Math.exp(exponent);
}

function smootherStep(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

// ---------------------------------------------------------------------------
// Geometry builder
// ---------------------------------------------------------------------------

function computeTargetPositions(
  data: ConeRenderData,
  horizonDays: number,
): Float32Array {
  const positions = new Float32Array(STEPS_X * STEPS_Z * 3);

  const spreadScale = Math.max(MIN_SCALE, Math.min(1.0, data.spreadPct / REF_SPREAD));
  const scaledWidth = BASE_WIDTH * spreadScale;

  const minPrice = data.minPrice;
  const maxPrice = data.maxPrice;
  const priceRange = maxPrice - minPrice;

  const refI = Math.max(1, Math.floor(STEPS_X * 0.15));
  const tYearsRef = (refI / (STEPS_X - 1)) * (horizonDays / 365);
  const refDensity = getLogNormalDensity(data.currentPrice, data.currentPrice, data.volatility, tYearsRef);

  for (let i = 0; i < STEPS_X; i++) {
    const tYears = (i / (STEPS_X - 1)) * (horizonDays / 365);
    const xPos = (i / (STEPS_X - 1)) * BASE_WIDTH - BASE_WIDTH / 2;

    for (let j = 0; j < STEPS_Z; j++) {
      const idx = (j * STEPS_X + i) * 3;
      const price = minPrice + (j / (STEPS_Z - 1)) * priceRange;

      const yPos = ((j / (STEPS_Z - 1)) - 0.5) * scaledWidth;

      let density = 0;
      if (i > 0) {
        density = getLogNormalDensity(price, data.currentPrice, data.volatility, tYears);
      } else {
        if (Math.abs(price - data.currentPrice) < priceRange * 0.01) {
          density = refDensity * 2.0;
        }
      }

      const normalized = Math.min(density / refDensity, 2.5);
      const z = Math.pow(normalized, 0.7) * 3.0;

      positions[idx] = xPos;
      positions[idx + 1] = yPos;
      positions[idx + 2] = z;
    }
  }

  return positions;
}

// ---------------------------------------------------------------------------
// Surface mesh with shaders
// ---------------------------------------------------------------------------

const VERTEX_SHADER = `
  varying vec2 vUv;
  varying float vElevation;
  void main() {
    vUv = uv;
    vElevation = position.z;
    vec4 modelPosition = modelMatrix * vec4(position, 1.0);
    vec4 viewPosition = viewMatrix * modelPosition;
    vec4 projectedPosition = projectionMatrix * viewPosition;
    gl_Position = projectedPosition;
  }
`;

const FRAGMENT_SHADER = `
  uniform vec3 uColorStart;
  uniform vec3 uColorEnd;
  uniform float uTargetLine;
  uniform float uLiquidation;
  uniform float uTakeProfit;
  uniform float uStopLoss;
  uniform float uTime;

  varying vec2 vUv;
  varying float vElevation;

  void main() {
    float mixStrength = smoothstep(0.0, 3.0, vElevation);
    vec3 color = mix(uColorStart, uColorEnd, mixStrength);

    // Subtle grid with distance-based fade
    float gridX = mod(vUv.x * 80.0, 1.0);
    float gridY = mod(vUv.y * 160.0, 1.0);
    float distFromCenter = length(vUv - vec2(0.5));
    float gridFade = 1.0 - smoothstep(0.15, 0.5, distFromCenter);
    gridFade *= 0.3;

    if (gridX < 0.04 || gridY < 0.04) {
      color += vec3(0.06, 0.15, 0.35) * gridFade * (1.0 - mixStrength * 0.5);
    }

    // Line overlays
    if (uTargetLine >= 0.0 && abs(vUv.y - uTargetLine) < 0.003) {
      color = vec3(1.0, 1.0, 1.0);
      color += vec3(0.5, 0.5, 0.5) * (0.5 + 0.5 * sin(uTime * 3.0));
    }

    if (uLiquidation >= 0.0 && abs(vUv.y - uLiquidation) < 0.003) {
      color = vec3(1.0, 0.1, 0.1);
      color += vec3(0.8, 0.0, 0.0) * (0.5 + 0.5 * sin(uTime * 4.0));
    }

    if (uTakeProfit >= 0.0 && abs(vUv.y - uTakeProfit) < 0.002) {
      color = vec3(0.1, 1.0, 0.3);
    }

    if (uStopLoss >= 0.0 && abs(vUv.y - uStopLoss) < 0.002) {
      color = vec3(1.0, 0.5, 0.0);
    }

    // Edge fade (price axis)
    float alpha = smoothstep(0.0, 0.1, vUv.y) * smoothstep(1.0, 0.9, vUv.y);
    // Base fade: gradual fade near time=0 (cone tip)
    alpha *= smoothstep(0.0, 0.15, vUv.x);
    // Far edge fade
    alpha *= smoothstep(1.0, 0.85, vUv.x);
    // Elevation-based opacity
    alpha *= 0.5 + 0.5 * mixStrength;

    gl_FragColor = vec4(color, alpha);
  }
`;

const Surface = ({ data, horizonDays, targetLine, liquidationPrice, takeProfit, stopLoss }: ProbabilityCone3DProps) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const currentPositionsRef = useRef<Float32Array | null>(null);
  const targetPositionsRef = useRef<Float32Array | null>(null);
  const animProgressRef = useRef(1.0);

  const { geometry, uniforms } = useMemo(() => {
    if (!data) {
      return {
        geometry: new THREE.PlaneGeometry(1, 1),
        uniforms: {
          uTime: { value: 0 },
          uColorStart: { value: new THREE.Color('#1e293b') },
          uColorEnd: { value: new THREE.Color('#38bdf8') },
          uTargetLine: { value: -1 },
          uLiquidation: { value: -1 },
          uTakeProfit: { value: -1 },
          uStopLoss: { value: -1 },
        },
      };
    }

    const geom = new THREE.BufferGeometry();
    const target = computeTargetPositions(data, horizonDays);

    if (!currentPositionsRef.current || currentPositionsRef.current.length !== target.length) {
      currentPositionsRef.current = new Float32Array(target);
    }
    targetPositionsRef.current = target;
    animProgressRef.current = 0;

    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(currentPositionsRef.current), 3));

    const uvs = new Float32Array(STEPS_X * STEPS_Z * 2);
    for (let i = 0; i < STEPS_X; i++) {
      for (let j = 0; j < STEPS_Z; j++) {
        const idx = (j * STEPS_X + i) * 2;
        uvs[idx] = i / (STEPS_X - 1);
        uvs[idx + 1] = j / (STEPS_Z - 1);
      }
    }
    geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

    const indices: number[] = [];
    for (let j = 0; j < STEPS_Z - 1; j++) {
      for (let i = 0; i < STEPS_X - 1; i++) {
        const a = j * STEPS_X + i;
        const b = a + 1;
        const c = (j + 1) * STEPS_X + i;
        const d = c + 1;
        indices.push(a, b, c);
        indices.push(b, d, c);
      }
    }
    geom.setIndex(indices);
    geom.computeVertexNormals();

    const minPrice = data.minPrice;
    const maxPrice = data.maxPrice;
    const priceRange = maxPrice - minPrice;

    const unifs = {
      uTime: { value: 0 },
      uColorStart: { value: new THREE.Color('#1e293b') },
      uColorEnd: { value: new THREE.Color('#38bdf8') },
      uTargetLine: { value: targetLine != null ? (targetLine - minPrice) / priceRange : -1 },
      uLiquidation: { value: liquidationPrice != null ? (liquidationPrice - minPrice) / priceRange : -1 },
      uTakeProfit: { value: takeProfit != null ? (takeProfit - minPrice) / priceRange : -1 },
      uStopLoss: { value: stopLoss != null ? (stopLoss - minPrice) / priceRange : -1 },
    };

    return { geometry: geom, uniforms: unifs };
  }, [data, horizonDays, targetLine, liquidationPrice, takeProfit, stopLoss]);

  useEffect(() => {
    if (!data) return;
    const target = computeTargetPositions(data, horizonDays);
    targetPositionsRef.current = target;

    if (!currentPositionsRef.current || currentPositionsRef.current.length !== target.length) {
      currentPositionsRef.current = new Float32Array(target);
      animProgressRef.current = 1.0;
    } else {
      animProgressRef.current = 0;
    }
  }, [data, horizonDays]);

  useFrame((state, delta) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
    }

    if (
      currentPositionsRef.current &&
      targetPositionsRef.current &&
      animProgressRef.current < 1.0 &&
      meshRef.current
    ) {
      animProgressRef.current = Math.min(1.0, animProgressRef.current + delta * 2.5);
      const t = smootherStep(animProgressRef.current);
      const current = currentPositionsRef.current;
      const target = targetPositionsRef.current;

      for (let i = 0; i < current.length; i++) {
        current[i] = current[i] + (target[i] - current[i]) * t;
      }

      const posAttr = meshRef.current.geometry.getAttribute('position') as THREE.BufferAttribute;
      posAttr.array.set(current);
      posAttr.needsUpdate = true;
      meshRef.current.geometry.computeVertexNormals();
    }
  });

  if (!data) return null;

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, MESH_Y, 0]}
    >
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={VERTEX_SHADER}
        fragmentShader={FRAGMENT_SHADER}
        transparent={true}
        side={THREE.DoubleSide}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
};

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export default function ProbabilityCone3D(props: ProbabilityCone3DProps) {
  return (
    <div className="absolute inset-0 w-full h-full bg-[#000000] z-0">
      <Canvas camera={{ position: [8, 4, 8], fov: 55 }}>
        <color attach="background" args={['#000000']} />
        <ambientLight intensity={0.2} />
        <pointLight position={[10, 10, 10]} intensity={0.5} />

        <Surface {...props} />

        <OrbitControls
          enableZoom={true}
          enablePan={false}
          /* Vertical: lock to ±15° around default (~70.5° polar) */
          minPolarAngle={Math.PI * 0.3}
          maxPolarAngle={Math.PI * 0.47}
          /* Horizontal: ±35° around default (π/4 ≈ 0.785 rad) */
          minAzimuthAngle={-Math.PI / 12}
          maxAzimuthAngle={Math.PI / 2.4}
          autoRotate={false}
          enableDamping={true}
          dampingFactor={0.08}
        />
      </Canvas>
    </div>
  );
}
