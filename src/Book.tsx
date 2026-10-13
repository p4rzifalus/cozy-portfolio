import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { store } from "./store";
import { INSPECT_LAYER, view } from "./Interact";

// The top book of the stack on the desk = the Telegram channel. Click -> it flies up in front of the camera (cover to the
// viewer, spine on the left), then the HTML book (BookOverlay in Overlay.tsx) takes its place exactly and opens.
// Close: the HTML cover shuts, the 3D book shows again and flies back to the stack.
//
// Desk_Books is one baked object (3 books). Here the top book is cut out of it into its own mesh "Desk_Book_Top"
// (same material, same UVs -> same baked look) and re-centred into a book frame: origin = centre of the book,
// X = away from the spine, Y = along the book (top), Z = cover normal (up while lying).

export const BOOK = {
  fly: 1.0,                 // s
  pageH: 0.74,              // height of the book on screen, share of the window height (desktop)
};
// filled by splitTopBook: cover picture for the HTML book and the real proportions
export const bookAssets = { cover: "", aspect: 0.71, ready: false };

interface Frame { mesh: THREE.Mesh; pos: THREE.Vector3; quat: THREE.Quaternion; halfW: number; halfH: number }
let frame: Frame | null = null;

/** cut the top book out of Desk_Books (once). Call after the room materials are assigned. */
export function splitTopBook(scene: THREE.Object3D, albedoUrl: string, cam1: THREE.Vector3) {
  if (frame || scene.getObjectByName("Desk_Book_Top")) return;
  const src = scene.getObjectByName("Desk_Books");
  let mesh: THREE.Mesh | null = null;
  src?.traverse((o) => { if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh; });
  if (!mesh) return;
  const m: THREE.Mesh = mesh;
  scene.updateMatrixWorld(true);
  const g = m.geometry;
  const pos = g.attributes.position as THREE.BufferAttribute;
  const idx = g.index ? Array.from(g.index.array) : Array.from({ length: pos.count }, (_, i) => i);
  const world = Array.from({ length: pos.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld));

  // books = connected pieces; vertices are split at hard edges / UV seams, so weld by position first
  const key = (v: THREE.Vector3) => `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;
  const weld = new Map<string, number>();
  const root = world.map((v, i) => { const k = key(v); if (!weld.has(k)) weld.set(k, i); return weld.get(k)!; });
  const parent = world.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let t = 0; t < idx.length; t += 3) {
    const a = find(root[idx[t]]);
    for (const j of [idx[t + 1], idx[t + 2]]) parent[find(root[j])] = a;
  }
  const top = new Map<number, number>();
  world.forEach((v, i) => { const c = find(root[i]); top.set(c, Math.max(top.get(c) ?? -1e9, v.y)); });
  const topBook = [...top.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const inTop = (i: number) => find(root[i]) === topBook;

  // book frame: lying flat (world Y up); long horizontal axis = along the book; spine = long side facing camera 1
  const verts = world.filter((_, i) => inTop(i));
  const c = verts.reduce((s, v) => s.add(v), new THREE.Vector3()).divideScalar(verts.length);
  let sxx = 0, szz = 0, sxz = 0;
  for (const v of verts) { const dx = v.x - c.x, dz = v.z - c.z; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; }
  const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  const along = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
  let side = new THREE.Vector3(0, 1, 0).cross(along).normalize();          // horizontal, across the book
  if (side.dot(cam1.clone().sub(c)) > 0) side.negate();                     // X points AWAY from the spine
  const up = new THREE.Vector3(0, 1, 0);
  const Y = up.clone().cross(side).normalize();                             // right-handed: X x Y = Z(up)
  // exact extents and centre in this frame
  const R = new THREE.Matrix4().makeBasis(side, Y, up);
  const Rinv = R.clone().transpose();
  const box = new THREE.Box3();
  for (const v of verts) box.expandByPoint(v.clone().sub(c).applyMatrix4(Rinv));
  const centre = box.getCenter(new THREE.Vector3()).applyMatrix4(R).add(c);
  const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);

  // new geometry in the book frame
  const toLocal = new THREE.Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z).premultiply(Rinv).multiply(m.matrixWorld);
  const tris: number[] = [], rest: number[] = [];
  for (let t = 0; t < idx.length; t += 3) (inTop(idx[t]) ? tris : rest).push(idx[t], idx[t + 1], idx[t + 2]);
  const used = [...new Set(tris)];
  const remap = new Map(used.map((v, i) => [v, i]));
  const ng = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(g.attributes)) {
    const a = attr as THREE.BufferAttribute;
    const arr = new Float32Array(used.length * a.itemSize);
    used.forEach((v, i) => { for (let k = 0; k < a.itemSize; k++) arr[i * a.itemSize + k] = a.getComponent(v, k); });
    ng.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize, a.normalized));
  }
  ng.setIndex(tris.map((v) => remap.get(v)!));
  ng.applyMatrix4(toLocal);                                                  // positions and normals
  ng.computeBoundingSphere();
  g.setIndex(rest);                                                          // the stack keeps the other books

  const book = new THREE.Mesh(ng, m.material);
  book.name = "Desk_Book_Top";
  book.position.copy(centre);
  book.quaternion.setFromRotationMatrix(R);
  scene.add(book);
  frame = { mesh: book, pos: centre.clone(), quat: book.quaternion.clone(), halfW: half.x, halfH: half.y };
  bookAssets.aspect = half.x / half.y;

  // cover picture for the HTML book: the cover face of the baked albedo, unwrapped into the same frame
  const uv = ng.attributes.uv as THREE.BufferAttribute | undefined;
  const p = ng.attributes.position as THREE.BufferAttribute;
  if (!uv) return;
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    const W = 600, H = Math.round(W / bookAssets.aspect);
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d")!;
    ctx.fillStyle = "#5a2a22"; ctx.fillRect(0, 0, W, H);
    const ix = ng.index!.array;
    const toPx = (i: number) => [((p.getX(i) + half.x) / (2 * half.x)) * W, ((half.y - p.getY(i)) / (2 * half.y)) * H];
    const toUv = (i: number) => [uv.getX(i) * img.width, uv.getY(i) * img.height];
    for (let t = 0; t < ix.length; t += 3) {
      const [a, b, d] = [ix[t], ix[t + 1], ix[t + 2]];
      if ([a, b, d].some((i) => p.getZ(i) < half.z - 0.004)) continue;      // only the cover face (top)
      drawTri(ctx, img, toUv(a), toUv(b), toUv(d), toPx(a), toPx(b), toPx(d));
    }
    // the bevelled rim is not part of the cover face: crop it away (otherwise a thin line of the fill colour shows)
    const out = document.createElement("canvas"); out.width = W; out.height = H;
    const m = Math.round(W * 0.02);
    out.getContext("2d")!.drawImage(cv, m, m, W - 2 * m, H - 2 * m, 0, 0, W, H);
    bookAssets.cover = out.toDataURL("image/jpeg", 0.9);
    bookAssets.ready = true;
  };
  img.src = albedoUrl;
}

// textured triangle on a 2D canvas: affine map from the image triangle s to the canvas triangle d (slightly grown: no seams)
function drawTri(ctx: CanvasRenderingContext2D, img: HTMLImageElement, s0: number[], s1: number[], s2: number[], d0: number[], d1: number[], d2: number[]) {
  const cx = (d0[0] + d1[0] + d2[0]) / 3, cy = (d0[1] + d1[1] + d2[1]) / 3;
  const grow = (d: number[]) => [d[0] + Math.sign(d[0] - cx) * 0.8, d[1] + Math.sign(d[1] - cy) * 0.8];
  const [g0, g1, g2] = [grow(d0), grow(d1), grow(d2)];
  const den = (s1[0] - s0[0]) * (s2[1] - s0[1]) - (s2[0] - s0[0]) * (s1[1] - s0[1]);
  if (Math.abs(den) < 1e-9) return;
  const a = ((d1[0] - d0[0]) * (s2[1] - s0[1]) - (d2[0] - d0[0]) * (s1[1] - s0[1])) / den;
  const b = ((d1[1] - d0[1]) * (s2[1] - s0[1]) - (d2[1] - d0[1]) * (s1[1] - s0[1])) / den;
  const c = ((d2[0] - d0[0]) * (s1[0] - s0[0]) - (d1[0] - d0[0]) * (s2[0] - s0[0])) / den;
  const d = ((d2[1] - d0[1]) * (s1[0] - s0[0]) - (d1[1] - d0[1]) * (s2[0] - s0[0])) / den;
  const e = d0[0] - a * s0[0] - c * s0[1], f = d0[1] - b * s0[0] - d * s0[1];
  ctx.save();
  ctx.beginPath(); ctx.moveTo(g0[0], g0[1]); ctx.lineTo(g1[0], g1[1]); ctx.lineTo(g2[0], g2[1]); ctx.closePath(); ctx.clip();
  ctx.setTransform(a, b, c, d, e, f);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

/** size of the closed book on screen, CSS px (shared with the HTML book so the swap is seamless) */
export function bookScreenSize(w: number, h: number) {
  const portrait = w / h < 0.9;
  let H = h * (portrait ? 0.62 : BOOK.pageH);
  const maxW = w * (portrait ? 0.74 : 0.42);
  if (H * bookAssets.aspect > maxW) H = maxW / bookAssets.aspect;
  return { w: H * bookAssets.aspect, h: H };
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export default function Book() {
  const { camera, size } = useThree();
  const st = useRef({ t: 0, shown: 0 });
  const tmp = useMemo(() => ({ c: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3(), fwd: new THREE.Vector3(), up: new THREE.Vector3() }), []);

  useFrame((_, dt) => {
    const f = frame;
    if (!f) return;
    const s = st.current, state = store.get();
    const want = state.mode.kind === "book";
    // the HTML book covers the 3D one: hide the 3D one a moment after the swap
    s.shown = state.bookOpen ? s.shown + dt : 0;
    f.mesh.visible = s.shown < 0.25;
    if (want || state.bookOpen) s.t = Math.min(1, s.t + dt / BOOK.fly);
    else s.t = Math.max(0, s.t - dt / BOOK.fly);
    if (want && s.t >= 1 && !state.bookOpen && bookAssets.ready) store.set({ bookOpen: true });

    const e = ease(s.t);
    // target: centre of the window, the long side = the HTML book height
    const cam = camera as THREE.PerspectiveCamera;
    const H = bookScreenSize(size.width, size.height).h;
    const dist = (2 * f.halfH * size.height) / (2 * H * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)));
    camera.updateMatrixWorld();
    camera.matrixWorld.decompose(tmp.c, tmp.q, tmp.s);
    tmp.fwd.set(0, 0, -1).applyQuaternion(tmp.q);
    tmp.up.set(0, 1, 0).applyQuaternion(tmp.q);
    const target = tmp.c.clone().addScaledVector(tmp.fwd, dist);
    f.mesh.position.copy(f.pos).lerp(target, e).addScaledVector(tmp.up, Math.sin(Math.PI * e) * 0.06);
    f.mesh.quaternion.copy(f.quat).slerp(tmp.q, e);
    f.mesh.layers.set(s.t > 0.02 ? INSPECT_LAYER : 0);
    view.bookVeil = e;
    if (s.t === 0) { f.mesh.position.copy(f.pos); f.mesh.quaternion.copy(f.quat); }
  }, 0.1);   // after the camera rig
  return null;
}
