import { useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { view } from "./Interact";

// Incense smoke: a faint thin thread from every stick tip that slowly rises, curls and fades (soft points, ~18 s per puff).
// Tips = glowing embers (material M_Incense_Ember) of the Incense object; fallback = top of the Incense bounding box.
const PER_TIP = 260;
const PERIOD = 18.0;  // seconds from the tip to the fade-out (incense only smoulders: slow, Pasha 2026-10-13)
const RISE = 0.28;    // metres

const vert = /* glsl */ `
  uniform float time; uniform float period; uniform float rise; uniform float pxScale; uniform float scale; uniform float wind; uniform float size0;
  attribute float seed; attribute float t0;
  varying float vAlpha; varying float vLife;
  void main() {
    float life = fract(time / period + t0);
    float s = seed * 6.2831;
    // the thread sways slowly as a whole, then breaks into curls higher up
    float sway = 0.006 * sin(time * 0.35 + s * 0.1) ;
    float amp = 0.002 + 0.045 * pow(life, 1.6);
    vec3 off = scale * vec3(
      sway + amp * sin(life * 11.0 + time * 0.6 + s) + (0.03 + wind) * life * life,
      life * rise,
      amp * cos(life * 8.0 + time * 0.45 + s * 1.7));
    vec4 mv = modelViewMatrix * vec4(position + off, 1.0);
    gl_Position = projectionMatrix * mv;
    float size = scale * (size0 + 0.04 * pow(life, 1.3));
    gl_PointSize = size * pxScale / -mv.z;
    vAlpha = smoothstep(0.0, 0.02, life) * (1.0 - smoothstep(0.35, 1.0, life));
    vLife = life;
  }
`;
const frag = /* glsl */ `
  uniform vec3 color; uniform float opacity;
  varying float vAlpha; varying float vLife;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float d = dot(p, p);
    if (d > 1.0) discard;
    float a = exp(-d * 3.0) * vAlpha * opacity * mix(1.6, 0.5, vLife);
    gl_FragColor = vec4(color, a);
    #include <colorspace_fragment>
  }
`;

export function findTips(scene: THREE.Object3D): THREE.Vector3[] {
  scene.updateMatrixWorld(true);
  const pts: THREE.Vector3[] = [];
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    if (!mats.some((x) => x.name.startsWith("M_Incense_Ember"))) return;
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) pts.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld));
  });
  // group the ember vertices into tips (embers are ~1 cm apart at least)
  const tips: { sum: THREE.Vector3; n: number; top: number }[] = [];
  for (const p of pts) {
    const t = tips.find((t) => t.sum.clone().divideScalar(t.n).distanceTo(p) < 0.012);
    if (t) { t.sum.add(p); t.n++; t.top = Math.max(t.top, p.y); }
    else tips.push({ sum: p.clone(), n: 1, top: p.y });
  }
  if (tips.length) return tips.map((t) => t.sum.divideScalar(t.n).setY(t.top));
  const inc = scene.getObjectByName("Incense") ?? scene.getObjectByName("Altar_Incense");
  if (!inc) return [];
  const b = new THREE.Box3().setFromObject(inc);
  return [new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2)];
}

interface SmokeProps {
  scene?: THREE.Object3D;       // incense: tips are found in the scene
  tips?: THREE.Vector3[];       // or given directly (city chimneys)
  scale?: number;               // world size of everything (1 = incense)
  wind?: number;                // extra drift to +x, in incense units
  color?: [number, number, number];
  opacity?: number;
  period?: number;
  perTip?: number;
  boost?: boolean;              // diving into the smoke (meditation): it gets denser
  rise?: number;                // metres (incense 0.28)
  size0?: number;               // thread thickness at the tip, m
}

export default function Smoke({ scene, tips: given, scale = 1, wind = 0, color = [0.62, 0.6, 0.7], opacity = 0.06,
  period = PERIOD, perTip = PER_TIP, boost = false, rise = RISE, size0 = 0.003 }: SmokeProps) {
  const { size, camera } = useThree();
  const { geom, mat } = useMemo(() => {
    const tips = given ?? (scene ? findTips(scene) : []);
    const PER_TIP = perTip;
    const n = tips.length * PER_TIP;
    const pos = new Float32Array(n * 3), seed = new Float32Array(n), t0 = new Float32Array(n);
    tips.forEach((tip, k) => {
      const s = Math.random();
      for (let i = 0; i < PER_TIP; i++) {
        const j = k * PER_TIP + i;
        pos.set([tip.x, tip.y, tip.z], j * 3);
        seed[j] = s + Math.random() * 0.15;   // one tip = one thread: similar seeds
        t0[j] = i / PER_TIP + Math.random() * 0.002;
      }
    });
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geom.setAttribute("seed", new THREE.BufferAttribute(seed, 1));
    geom.setAttribute("t0", new THREE.BufferAttribute(t0, 1));
    const mat = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false,
      uniforms: {
        time: { value: 0 }, period: { value: period }, rise: { value: rise }, pxScale: { value: 1 },
        scale: { value: scale }, wind: { value: wind }, size0: { value: size0 },
        color: { value: new THREE.Color(...color) }, opacity: { value: opacity },
      },
    });
    return { geom, mat };
  }, [scene, given]);

  useFrame(({ clock, gl }) => {
    mat.uniforms.time.value = clock.elapsedTime;
    if (boost) mat.uniforms.opacity.value = opacity * (1 + 4 * view.smokeBoost);
    // world size -> pixels: projection scale * half the drawing buffer height
    const cam = camera as THREE.PerspectiveCamera;
    mat.uniforms.pxScale.value = cam.projectionMatrix.elements[5] * size.height * gl.getPixelRatio() * 0.5;
  });
  return <points geometry={geom} material={mat} frustumCulled={false} />;
}
