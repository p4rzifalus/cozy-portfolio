import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { store } from "./store";

// Laptop: click -> the camera leans in until the screen fills most of the window, then the HTML "desktop" with the links
// (LaptopScreen in Overlay.tsx) is laid exactly onto the 3D screen with a CSS perspective transform (matrix3d), every frame.
// Runs after the camera rig (priority 0.1): blends the rig's pose towards the laptop pose.

export const LAPTOP = { fly: 1.2, fill: 0.8 };   // s; share of the window the screen takes (by the tighter side)
// the HTML screen: its element (set by Overlay), its size in CSS px before the transform (Overlay picks w: smaller on phones =
// bigger letters there) and the height / width of the 3D screen
export const laptopScreen = { el: null as HTMLElement | null, w: 1200, h: 750, ratio: 0.625 };

interface Screen { c: THREE.Vector3; n: THREE.Vector3; up: THREE.Vector3; right: THREE.Vector3; hw: number; hh: number }

/** the display face of Laptop_Screen: the biggest flat side facing camera 1 */
function findScreen(scene: THREE.Object3D, cam1: THREE.Vector3): Screen | null {
  const o = scene.getObjectByName("Laptop_Screen");
  let mesh: THREE.Mesh | null = null;
  o?.traverse((x) => { if (!mesh && (x as THREE.Mesh).isMesh) mesh = x as THREE.Mesh; });
  if (!mesh) return null;
  const m: THREE.Mesh = mesh;
  scene.updateMatrixWorld(true);
  const pos = m.geometry.attributes.position as THREE.BufferAttribute;
  const idx = m.geometry.index ? Array.from(m.geometry.index.array) : Array.from({ length: pos.count }, (_, i) => i);
  const v = (i: number) => new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
  const groups = new Map<string, { n: THREE.Vector3; area: number; pts: THREE.Vector3[] }>();
  for (let t = 0; t < idx.length; t += 3) {
    const a = v(idx[t]), b = v(idx[t + 1]), c = v(idx[t + 2]);
    const cr = b.clone().sub(a).cross(c.clone().sub(a));
    const area = cr.length() / 2;
    if (area < 1e-8) continue;
    const n = cr.normalize();
    if (n.dot(cam1.clone().sub(a)) <= 0) continue;
    const k = `${n.x.toFixed(2)},${n.y.toFixed(2)},${n.z.toFixed(2)}`;
    const g = groups.get(k) ?? { n, area: 0, pts: [] };
    g.area += area; g.pts.push(a, b, c); groups.set(k, g);
  }
  const best = [...groups.values()].sort((a, b) => b.area - a.area)[0];
  if (!best) return null;
  const n = best.n;
  const up = new THREE.Vector3(0, 1, 0).addScaledVector(n, -n.y).normalize();
  const right = up.clone().cross(n).normalize();
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const o0 = best.pts[0];
  for (const p of best.pts) {
    const d = p.clone().sub(o0);
    x0 = Math.min(x0, d.dot(right)); x1 = Math.max(x1, d.dot(right));
    y0 = Math.min(y0, d.dot(up)); y1 = Math.max(y1, d.dot(up));
  }
  const c = o0.clone().addScaledVector(right, (x0 + x1) / 2).addScaledVector(up, (y0 + y1) / 2);
  return { c, n, up, right, hw: (x1 - x0) / 2, hh: (y1 - y0) / 2 };
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// CSS matrix3d that maps the rectangle (0,0)-(w,h) onto 4 screen points (top-left, top-right, bottom-right, bottom-left)
function adj(m: number[]) {
  return [m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4],
          m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5],
          m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3]];
}
function mul(a: number[], b: number[]) {
  const c = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) c[3 * i + j] += a[3 * i + k] * b[3 * k + j];
  return c;
}
function basis(p: number[][]) {
  const m = [p[0][0], p[1][0], p[2][0], p[0][1], p[1][1], p[2][1], 1, 1, 1];
  const a = adj(m), x = p[3][0], y = p[3][1];
  const v = [a[0] * x + a[1] * y + a[2], a[3] * x + a[4] * y + a[5], a[6] * x + a[7] * y + a[8]];
  return mul(m, [v[0], 0, 0, 0, v[1], 0, 0, 0, v[2]]);
}
export function quadMatrix(w: number, h: number, dst: number[][]) {
  const t = mul(basis(dst), adj(basis([[0, 0], [w, 0], [w, h], [0, h]])));
  for (let i = 0; i < 9; i++) t[i] /= t[8];
  return `matrix3d(${[t[0], t[3], 0, t[6], t[1], t[4], 0, t[7], 0, 0, 1, 0, t[2], t[5], 0, t[8]].join(",")})`;
}

export default function Laptop({ scene }: { scene: THREE.Object3D }) {
  const { camera, size } = useThree();
  const screen = useMemo(() => {
    const cam1 = scene.getObjectByName("Camera_01_Main")!.getWorldPosition(new THREE.Vector3());
    const s = findScreen(scene, cam1);
    if (s) laptopScreen.ratio = s.hh / s.hw;
    return s;
  }, [scene]);
  const st = useRef({ t: 0 });
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), v: new THREE.Vector3() }), []);

  useFrame((_, dt) => {
    if (!screen) return;
    const s = st.current, state = store.get();
    const want = state.mode.kind === "laptop";
    s.t = want ? Math.min(1, s.t + dt / LAPTOP.fly) : Math.max(0, s.t - dt / LAPTOP.fly);
    if (want && s.t >= 1 && !state.laptopReady) store.set({ laptopReady: true });
    if (!want && state.laptopReady) store.set({ laptopReady: false });
    if (s.t <= 0) return;

    // laptop pose: on the screen normal, far enough for the screen to take LAPTOP.fill of the window
    const cam = camera as THREE.PerspectiveCamera;
    const tanV = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)), aspect = size.width / size.height;
    const dist = Math.max(screen.hh / tanV, screen.hw / (tanV * aspect)) / LAPTOP.fill;
    tmp.p.copy(screen.c).addScaledVector(screen.n, dist);
    // on the way the eyes stay on the screen centre (at the end that is exactly the head-on pose); the look turns a bit ahead
    camera.position.lerp(tmp.p, ease(s.t));
    tmp.m.lookAt(camera.position, screen.c, screen.up);
    tmp.q.setFromRotationMatrix(tmp.m);
    camera.quaternion.slerp(tmp.q, ease(Math.min(1, s.t / 0.7)));
    camera.updateMatrixWorld();

    // HTML screen onto the 3D one
    const el = laptopScreen.el;
    if (!el) return;
    const pts = [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([x, y]) => {
      tmp.v.copy(screen.c).addScaledVector(screen.right, x * screen.hw).addScaledVector(screen.up, y * screen.hh).project(camera);
      return [(tmp.v.x * 0.5 + 0.5) * size.width, (-tmp.v.y * 0.5 + 0.5) * size.height];
    });
    el.style.transform = quadMatrix(laptopScreen.w, laptopScreen.h, pts);
  }, 0.1);
  return null;
}
