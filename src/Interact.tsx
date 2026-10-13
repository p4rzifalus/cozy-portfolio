import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { HOTSPOTS } from "./content";
import { store } from "./store";
import { toggleMusic } from "./music";
import { GRADE } from "./painterly";

// Hover, click and the render loop of the site.
//   hover:  one raycast per frame against the whole room (nearest hit wins, so things behind the chair are not picked),
//           the hit mesh is walked up to a hotspot name (HOTSPOTS in content.ts)
//   render: room -> (project mode) dark veil + the inspected object on top -> soft outline around the hovered hotspot.
//           The outline is a mask of the hotspot (white on black) dilated in a full-screen pass: no post-processing library,
//           so the colour pipeline of the room (AgX, fitted exposure) stays untouched.

export const INSPECT_LAYER = 30;
const MASK_LAYER = 31;
// filled by Inspect.tsx: the object flying to the camera and how dark the room behind it is (0..1)
export const view = {
  inspected: null as THREE.Object3D | null, veil: 0, exposure: 1,
  smokeBoost: 0,          // room incense smoke thickens while the camera dives into it
  fog: 0,                 // fade to black during the flight room <-> altar (1 = black, the cut happens there)
  atAltar: false,         // the camera is in the meditation scene
  altarExposure: 1,       // exposure multiplier there
};

if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__view = view;
const OUTLINE = { color: new THREE.Color("#ffe3b3"), radius: 4.0, fill: 0.1 };

const quadVert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const outlineFrag = /* glsl */ `
  uniform sampler2D mask; uniform vec2 texel; uniform float radius; uniform float amount; uniform vec3 color; uniform float fill;
  varying vec2 vUv;
  void main() {
    float inside = texture2D(mask, vUv).r;
    float m = 0.0;
    // dilate: max over two rings (soft, rounded corners)
    for (int i = 0; i < 16; i++) {
      float a = float(i) * 0.3927;
      vec2 d = vec2(cos(a), sin(a)) * texel;
      m = max(m, texture2D(mask, vUv + d * radius).r);
      m = max(m, texture2D(mask, vUv + d * radius * 0.5).r * 0.85);
    }
    float edge = m * (1.0 - inside);
    float a = (edge * 0.9 + inside * fill) * amount;
    gl_FragColor = vec4(color, a);
  }
`;
const veilFrag = /* glsl */ `
  uniform float amount; varying vec2 vUv;
  void main() {
    float v = length(vUv - 0.5) * 1.3;
    gl_FragColor = vec4(0.02, 0.012, 0.05, amount * (0.55 + 0.35 * v));
  }
`;

// fade to black for the flight room <-> altar (the edges darken first)
const fogFrag = /* glsl */ `
  uniform float amount; uniform float time; varying vec2 vUv;
  void main() {
    float v = length(vUv - 0.5) * 1.4;
    float a = clamp(amount * 1.25 + v * 0.35 * amount - 0.0, 0.0, 1.0);
    gl_FragColor = vec4(0.0, 0.0, 0.0, a);
  }
`;

function quad(frag: string, uniforms: Record<string, THREE.IUniform>) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({ vertexShader: quadVert, fragmentShader: frag, uniforms, transparent: true, depthTest: false, depthWrite: false }),
  );
  m.frustumCulled = false;
  return m;
}

export function hotspotOf(o: THREE.Object3D | null): string | null {
  for (let p = o; p; p = p.parent) {
    for (const [id, h] of Object.entries(HOTSPOTS)) if (h.parts.includes(p.name)) return id;
  }
  return null;
}

export default function Interact({ scene }: { scene: THREE.Object3D }) {
  const { gl, camera, size } = useThree();

  // everything that can block the view; city layers and the hidden silhouette are not targets
  const pickables = useMemo(() => {
    const list: THREE.Mesh[] = [];
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !o.name.startsWith("City") && !o.name.startsWith("Character")) list.push(m);
    });
    return list;
  }, [scene]);
  const partsOf = useMemo(() => {
    const r: Record<string, THREE.Mesh[]> = {};
    for (const id of Object.keys(HOTSPOTS)) {
      r[id] = [];
      for (const n of HOTSPOTS[id].parts) scene.getObjectByName(n)?.traverse((o) => { if ((o as THREE.Mesh).isMesh) r[id].push(o as THREE.Mesh); });
    }
    return r;
  }, [scene]);

  const pointer = useRef({ ndc: new THREE.Vector2(9, 9), moved: false, down: null as null | { x: number; y: number; t: number } });
  const ray = useMemo(() => new THREE.Raycaster(), []);

  useEffect(() => {
    const el = gl.domElement;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      pointer.current.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      pointer.current.moved = true;
    };
    const leave = () => { pointer.current.ndc.set(9, 9); pointer.current.moved = true; };
    const down = (e: PointerEvent) => { move(e); pointer.current.down = { x: e.clientX, y: e.clientY, t: performance.now() }; };
    const up = (e: PointerEvent) => {
      const d = pointer.current.down;
      pointer.current.down = null;
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 600) return;   // a drag, not a click
      const s = store.get();
      if (s.mode.kind !== "room") return;
      // touch screens have no hover: pick right at the tap
      move(e);
      const id = pick();
      if (!id) return;
      const a = HOTSPOTS[id].action;
      if (a === "project") store.set({ mode: { kind: "project", id }, hovered: null });
      else if (a === "contacts") store.set({ mode: { kind: "contacts" }, hovered: null });
      else if (a === "meditation") store.set({ mode: { kind: "meditation" }, hovered: null });
      else if (a === "music") toggleMusic();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointerup", up);
    };
  }, [gl, camera, pickables]);

  function pick(): string | null {
    if (Math.abs(pointer.current.ndc.x) > 1) return null;
    ray.setFromCamera(pointer.current.ndc, camera);
    const hit = ray.intersectObjects(pickables, false).find((h) => h.object.visible);
    return hit ? hotspotOf(hit.object) : null;
  }

  // render targets and full-screen passes
  const passes = useMemo(() => {
    const mask = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true });
    const outline = quad(outlineFrag, {
      mask: { value: mask.texture }, texel: { value: new THREE.Vector2() }, radius: { value: OUTLINE.radius },
      amount: { value: 0 }, color: { value: OUTLINE.color }, fill: { value: OUTLINE.fill },
    });
    const veil = quad(veilFrag, { amount: { value: 0 } });
    const fog = quad(fogFrag, { amount: { value: 0 }, time: { value: 0 } });
    const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    return { mask, outline, veil, fog, white, ortho, shown: null as string | null, amount: 0 };
  }, []);
  useEffect(() => {
    const dpr = gl.getPixelRatio();
    passes.mask.setSize(Math.round(size.width * dpr), Math.round(size.height * dpr));
    (passes.outline.material as THREE.ShaderMaterial).uniforms.texel.value.set(1 / (size.width), 1 / (size.height));
  }, [size, gl, passes]);
  useEffect(() => () => { passes.mask.dispose(); }, [passes]);

  useFrame(({ scene: root }, dt) => {
    const s = store.get();

    // --- hover
    if (pointer.current.moved || s.mode.kind !== "room") {
      pointer.current.moved = false;
      const id = s.mode.kind === "room" && !pointer.current.down ? pick() : null;
      if (id !== s.hovered) store.set({ hovered: id });
    }
    const hovered = store.get().hovered;
    gl.domElement.style.cursor = hovered ? "pointer" : s.mode.kind === "project" ? "grab" : s.mode.kind === "meditation" ? "default" : "";
    // outline fades in and out; while fading out it keeps the last hotspot
    if (hovered) passes.shown = hovered;
    passes.amount += ((hovered ? 1 : 0) - passes.amount) * (1 - Math.exp(-dt * 12));

    // --- room
    gl.toneMappingExposure = view.exposure;
    GRADE.gain.value = view.atAltar ? view.altarExposure : 1;
    const camLayers = camera.layers.mask;
    gl.autoClear = true;
    camera.layers.set(0);
    gl.render(root, camera);
    gl.autoClear = false;

    // --- inspected project on top of a dark veil
    if (view.inspected && view.veil > 0.001) {
      (passes.veil.material as THREE.ShaderMaterial).uniforms.amount.value = view.veil;
      gl.render(passes.veil, passes.ortho);
      gl.clearDepth();
      camera.layers.set(INSPECT_LAYER);
      gl.render(root, camera);
    }

    // --- outline
    if (passes.shown && passes.amount > 0.01) {
      const meshes = partsOf[passes.shown];
      for (const m of meshes) m.layers.enable(MASK_LAYER);
      camera.layers.set(MASK_LAYER);
      const bg = root.background, ov = root.overrideMaterial;
      root.background = null;
      root.overrideMaterial = passes.white;
      const clear = gl.getClearColor(new THREE.Color()), clearA = gl.getClearAlpha();
      gl.setRenderTarget(passes.mask);
      gl.setClearColor(0x000000, 0);
      gl.clear();
      gl.render(root, camera);
      gl.setRenderTarget(null);
      gl.setClearColor(clear, clearA);
      root.background = bg;
      root.overrideMaterial = ov;
      for (const m of meshes) m.layers.disable(MASK_LAYER);
      (passes.outline.material as THREE.ShaderMaterial).uniforms.amount.value = passes.amount;
      gl.render(passes.outline, passes.ortho);
    } else if (!hovered) passes.shown = null;

    // --- smoke curtain of the flight room <-> altar
    if (view.fog > 0.001) {
      const u = (passes.fog.material as THREE.ShaderMaterial).uniforms;
      u.amount.value = view.fog; u.time.value += dt;
      gl.render(passes.fog, passes.ortho);
    }

    camera.layers.mask = camLayers;
    gl.autoClear = true;
  }, 1);

  return null;
}
