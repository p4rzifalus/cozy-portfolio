import { useMemo, useRef } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import { view as altarView } from "./Interact";
import * as THREE from "three";

// The city behind the window: one painted picture cut into depth layers (blender/scripts/city_layers.py ->
// public/room/city/<layer>.webp + layers.json: sky + far city, mid roofs, the big building, near roofs).
// 1) DEPTH: in Blender the picture is one plane 3.85 m from the camera. Here every layer gets its own copy of that plane,
//    scaled k times around the camera point: camera 1 and 2 see exactly the original picture, but when the camera
//    shifts after the cursor, near roofs move against the far ones (parallax). Keep 3.85 * k < camera.far (50 m).
//    The camera shift is only +-4 cm, so the real parallax of a city is tiny. It is exaggerated: every layer is also moved
//    with the camera offset so that it slides as if it stood at APPARENT (same units as k, 1 = 3.85 m from the camera):
//    the sky stays put like something infinitely far, the big building slides like a wall ~5.8 m away (Pasha, 2026-10-13:
//    "stronger, especially between the middle house and the far plane", then "move the middle house further").
//    In dev: window.__cityDepth({ main: 1.2 }).
// 2) LIFE (shader on the same picture): slowly drifting clouds in the sky layer, some lit windows switch off and on,
//    a blinking red light on the TV antenna, a slow one on the spire. (Chimney smoke was tried and removed, 2026-10-13.)
const BASE = import.meta.env.BASE_URL + "room/city/";
// light positions (TV antenna on the left, spire on the right) and the horizon come from layers.json: city_layers.py
// also moves and scales the layers inside the window (horizon under the blinds, the big house smaller and further)
const APPARENT: Record<string, number> = { sky: Infinity, mid: 2.4, main: 1.5, near: 1.0 };   // window glass ~0.66

type LayersJson = {
  size: [number, number]; horizon: number;
  layers: { name: string; file: string; k: number; lights: Partial<Record<"mast" | "chimney", [number, number]>> }[];
};

const vert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const frag = /* glsl */ `
  uniform sampler2D map; uniform vec3 emissive; uniform float time; uniform vec2 img;
  uniform vec2 mast; uniform vec2 chimney; uniform float horizon; uniform float clouds;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
  float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

  void main() {
    vec4 t = texture2D(map, vUv);
    if (t.a < 0.004) discard;
    vec3 c = t.rgb;
    vec2 px = vUv * img;

    // clouds: soft lighter patches drifting right, only in the sky (fade out towards the horizon)
    float sky = (1.0 - smoothstep(horizon - 0.07, horizon, vUv.y)) * clouds;
    float n = 0.65 * fbm(vec2(vUv.x * 3.0 - time * 0.006, vUv.y * 7.0)) + 0.35 * fbm(vec2(vUv.x * 7.0 - time * 0.011 + 4.0, vUv.y * 14.0 + 2.0));
    float cl = smoothstep(0.45, 0.75, n) * sky;
    c = mix(c, max(c, vec3(0.045, 0.048, 0.065)), cl * 0.8);
    c *= 1.0 - 0.25 * (1.0 - smoothstep(0.3, 0.55, n)) * sky;          // and darker gaps between them

    // windows: small warm spots brighter than their surroundings, below the horizon
    vec2 o = 6.0 / img;
    float around = 0.25 * (lum(texture2D(map, vUv + vec2(o.x, 0)).rgb) + lum(texture2D(map, vUv - vec2(o.x, 0)).rgb)
                         + lum(texture2D(map, vUv + vec2(0, o.y)).rgb) + lum(texture2D(map, vUv - vec2(0, o.y)).rgb));
    float win = smoothstep(0.01, 0.04, lum(c) - around) * smoothstep(0.01, 0.05, c.r - c.b) * smoothstep(horizon + 0.02, horizon + 0.04, vUv.y);
    vec2 cell = floor(px / vec2(5.0, 7.0));
    float h = hash(cell), h2 = hash(cell + 17.1);
    if (h < 0.35) {                                   // about a third of the windows live their own life
      float ph = fract(time / (20.0 + 50.0 * h2) + h * 7.0);
      float off = smoothstep(0.0, 0.01, ph) * (1.0 - smoothstep(0.4, 0.41, ph));
      c = mix(c, c * 0.15, win * off);
    }

    // red light on the mast: short blink every 1.25 s; the chimney: slow breathing (only on the layer that owns them)
    float dm = length(px - mast), dc = length(px - chimney);
    float bm = step(fract(time * 0.8), 0.12);
    float bc = 0.5 + 0.5 * sin(time * 2.0);
    c += vec3(1.0, 0.08, 0.04) * (exp(-dm * dm / 4.0) * 4.0 + exp(-dm * dm / 60.0) * 0.4) * bm;
    c += vec3(1.0, 0.12, 0.05) * (exp(-dc * dc / 4.0) * 2.0 + exp(-dc * dc / 50.0) * 0.25) * bc;

    gl_FragColor = vec4(c * emissive, t.a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export default function City({ scene, camera }: { scene: THREE.Object3D; camera: THREE.Object3D }) {
  const cfg: LayersJson = JSON.parse(useLoader(THREE.FileLoader, BASE + "layers.json") as string);
  const maps = useLoader(THREE.TextureLoader, cfg.layers.map((l) => import.meta.env.BASE_URL + "room/" + l.file));

  const layers = useRef<{ mesh: THREE.Mesh; base: THREE.Matrix4; k: number; name: string }[]>([]);
  const origin = useRef(new THREE.Vector3());
  const depth = useRef({ ...APPARENT });
  const mats = useMemo(() => {
    const city = scene.getObjectByName("City_Backdrop") as THREE.Mesh | undefined;
    if (!city || !city.parent) return [];
    scene.updateMatrixWorld(true);
    const cam = camera.getWorldPosition(new THREE.Vector3());
    origin.current.copy(cam);
    layers.current = [];
    const old = (city.userData.oldMat ?? city.material) as THREE.MeshStandardMaterial;
    city.userData.oldMat = old;
    city.visible = false;
    // once (StrictMode runs memos twice): drop layers of a previous run
    for (const m of (city.userData.layers ?? []) as THREE.Mesh[]) m.removeFromParent();

    const off = new THREE.Vector2(-1e4, -1e4);
    const meshes: THREE.Mesh[] = [];
    const mats = cfg.layers.map((l, i) => {
      const t = maps[i];
      t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.needsUpdate = true;
      const mat = new THREE.ShaderMaterial({
        vertexShader: vert, fragmentShader: frag, transparent: i > 0, depthWrite: i === 0,
        uniforms: {
          map: { value: t }, emissive: { value: old.emissive.clone().multiplyScalar(old.emissiveIntensity) },
          time: { value: 0 }, img: { value: new THREE.Vector2(...cfg.size) }, horizon: { value: cfg.horizon },
          mast: { value: l.lights.mast ? new THREE.Vector2(...l.lights.mast) : off },
          chimney: { value: l.lights.chimney ? new THREE.Vector2(...l.lights.chimney) : off },
          clouds: { value: l.name === "sky" ? 1 : 0 },
        },
      });
      // the plane scaled k times around the camera point (its parent is the scene root)
      const m = new THREE.Mesh(city.geometry, mat);
      m.name = "City_" + l.name;
      m.matrixAutoUpdate = false;
      m.matrix.makeTranslation(cam.x, cam.y, cam.z)
        .multiply(new THREE.Matrix4().makeScale(l.k, l.k, l.k))
        .multiply(new THREE.Matrix4().makeTranslation(-cam.x, -cam.y, -cam.z))
        .multiply(city.matrix);
      m.renderOrder = i;                              // far to near
      layers.current.push({ mesh: m, base: m.matrix.clone(), k: l.k, name: l.name });
      city.parent!.add(m);
      meshes.push(m);
      return mat;
    });
    city.userData.layers = meshes;
    if (import.meta.env.DEV) (window as any).__cityDepth = (d: Record<string, number>) => Object.assign(depth.current, d);
    return mats;
  }, [scene, camera, cfg, maps]);

  const off = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ clock, camera: view }) => {
    for (const m of mats) m.uniforms.time.value = clock.elapsedTime;
    // the camera is in the meditation scene (far away): keep the layers where they are, hide them
    for (const l of layers.current) l.mesh.visible = !altarView.atAltar;
    if (altarView.atAltar) return;
    off.subVectors(view.position, origin.current);   // the cursor parallax shift of the camera
    for (const l of layers.current) {
      const f = 1 - l.k / (depth.current[l.name] ?? Infinity);   // 1 = moves with the camera (infinitely far)
      l.mesh.matrix.makeTranslation(off.x * f, off.y * f, off.z * f).multiply(l.base);
      l.mesh.matrixWorldNeedsUpdate = true;
    }
  });
  return null;
}
