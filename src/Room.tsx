import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { painterlyMaterial, SOURCES, Source, WALL, WallOpts } from "./painterly";
import { flickerAt, FlickerSpec } from "./flicker";
import Smoke from "./Smoke";
import City from "./City";
import Interact, { view } from "./Interact";
import Inspect from "./Inspect";
import Meditation from "./Meditation";
import { store } from "./store";
import Book, { splitTopBook } from "./Book";
import Laptop from "./Laptop";

const BASE = import.meta.env.BASE_URL + "room/";
// detailed pictures: the brush-stroke noise on top of them reads as a second, overlapping image -> no strokes
const PICTURES = /^(Poster_|Sticker_|Contact_)/;

// Walls: tiling plaster + relief + damage decals instead of the baked albedo (that one was 1024 px for a whole wall -> blurry).
// Prepared by blender/scripts/wall_tiles.py -> /room/walls/. Decal places in Blender coordinates (m): y or x along the wall, z = height.
const WALLS = ["Wall_Back", "Wall_Left", "Wall_Right"] as const;
type DecalSpec = { name: string; at: number; z: number; w: number; rot?: number };
// Places = parts of the walls actually seen from camera 1, mid-turn and camera 2 (found by raycasting the frame).
const WALL_DECALS: Record<(typeof WALLS)[number], DecalSpec[]> = {
  // at = Blender X
  Wall_Back: [
    { name: "crack", at: 0.12, z: 1.45, w: 0.22, rot: 75 },        // from the window corner (camera 1, turn)
    { name: "holes_pair", at: 0.45, z: 1.76, w: 0.16 },            // a picture used to hang above the neon (turn)
    { name: "stain", at: 1.05, z: 1.8, w: 0.4 },                   // damp in the corner (camera 2)
    { name: "chip", at: -1.33, z: 1.45, w: 0.06 },                 // strip left of the window (camera 1)
    { name: "peel", at: -0.45, z: 0.42, w: 0.16 },                 // under the windowsill (camera 1)
    { name: "scuff", at: -0.65, z: 0.32, w: 0.28, rot: 5 },        // chair kicks (camera 1)
  ],
  // at = Blender Y
  Wall_Left: [
    { name: "tape", at: 2.38, z: 1.22, w: 0.11, rot: 5 },
    { name: "chip", at: 1.92, z: 0.88, w: 0.06, rot: 40 },
    { name: "hole_cracks", at: 2.44, z: 0.98, w: 0.14 },
  ],
  Wall_Right: [
    { name: "hole_cracks", at: 2.55, z: 1.6, w: 0.16 },            // left of the shelf (camera 2)
    { name: "tape", at: 0.66, z: 1.35, w: 0.12, rot: -6 },         // right of the shelf (camera 2)
    { name: "scuff", at: 0.65, z: 0.85, w: 0.2 },
  ],
};
interface WallsJson { cells: Record<string, { rect: [number, number, number, number]; px: [number, number] }>; sheet_bg: [number, number, number] }

interface BakedInfo { kind: "baked"; albedo: string; light: string; masks: Partial<Record<Source, string>>; foliage: boolean }
interface OtherInfo { kind: "emissive" | "plain" }
interface SiteJson {
  objects: Record<string, BakedInfo | OtherInfo>;
  ambient: [number, number, number];
  encoding: { log_min: number; log_range: number };
  painterly: { step: number; light_cap: number };
  cameras: Record<string, { lens: number; sensor: number }>;
  emissive_source: Record<string, string>;
  flicker: FlickerSpec;
}

// textures are data (light, noise): read raw pixels, no premultiplied alpha, no flip (glTF UVs)
export class RawLoader extends THREE.ImageBitmapLoader {
  constructor() { super(); this.setOptions({ premultiplyAlpha: "none", colorSpaceConversion: "none" } as ImageBitmapOptions); }
}
export function toTexture(bmp: ImageBitmap, srgb: boolean) {
  const t = new THREE.Texture(bmp as unknown as HTMLImageElement);
  t.flipY = false;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

export default function Room() {
  const site: SiteJson = JSON.parse(useLoader(THREE.FileLoader, BASE + "site.json") as string);
  const gltf = useGLTF(BASE + "room.glb");
  const baked = Object.entries(site.objects).filter(([, v]) => v.kind === "baked") as [string, BakedInfo][];
  const files = useMemo(() => {
    const f: string[] = [];
    for (const [, b] of baked) {
      f.push(b.albedo, b.light);
      for (const s of SOURCES) if (b.masks[s]) f.push(b.masks[s]!);
    }
    return f;
  }, [baked.length]);
  const bitmaps = useLoader(RawLoader, files.map((f) => BASE + f)) as ImageBitmap[];
  const walls: WallsJson = JSON.parse(useLoader(THREE.FileLoader, BASE + "walls/walls.json") as string);
  const [plaster, relief, decals] = useLoader(THREE.TextureLoader, ["plaster", "relief", "decals"].map((f) => BASE + "walls/" + f + ".webp"));

  // materials: baked objects -> Painterly shader; self-lit parts keep their glTF materials (flicker via emissiveIntensity)
  const { shaders, emissive, bulbs } = useMemo(() => {
    const bmp: Record<string, ImageBitmap> = {};
    files.forEach((f, i) => (bmp[f] = bitmaps[i]));
    const shaders: THREE.ShaderMaterial[] = [];
    for (const t of [plaster, relief]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
    plaster.colorSpace = decals.colorSpace = THREE.SRGBColorSpace;
    decals.anisotropy = 8;
    const bg = new THREE.Color().setRGB(...walls.sheet_bg, THREE.SRGBColorSpace);   // -> linear, as the shader sees the sheet
    const wallOpts = (name: (typeof WALLS)[number]): WallOpts => ({
      plaster, relief, decals, decalBg: [bg.r, bg.g, bg.b],
      items: WALL_DECALS[name].map((d) => {
        const c = walls.cells[d.name];
        // u = to the right as seen from inside: left wall +Y, right wall -Y, back wall +X
        const u = name === "Wall_Right" ? -d.at : d.at;
        return { u, v: d.z, w: d.w, rot: d.rot ?? 0, rect: c.rect, aspect: c.px[1] / c.px[0] };
      }),
    });
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__wall = WALL;
    for (const [name, b] of baked) {
      const obj = gltf.scene.getObjectByName(name);
      if (!obj) continue;
      const masks: Partial<Record<Source, THREE.Texture>> = {};
      for (const s of SOURCES) if (b.masks[s]) masks[s] = toTexture(bmp[b.masks[s]!], false);
      const mat = painterlyMaterial({
        albedo: toTexture(bmp[b.albedo], true), light: toTexture(bmp[b.light], false), masks,
        ambient: site.ambient, logMin: site.encoding.log_min, logRange: site.encoding.log_range,
        lightCap: site.painterly.light_cap, foliage: b.foliage,
        strokes: PICTURES.test(name) ? 0 : 1,
        wall: (WALLS as readonly string[]).includes(name) ? wallOpts(name as (typeof WALLS)[number]) : undefined,
      });
      obj.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = mat; });
      shaders.push(mat);
      // dev: window.__wallOn(false) shows the old baked wall albedo (before/after)
      if (import.meta.env.DEV && mat.uniforms.wall.value) {
        const w = window as unknown as { __wallMats?: THREE.ShaderMaterial[]; __wallOn?: (on: boolean) => void };
        (w.__wallMats ??= []).push(mat);
        w.__wallOn = (on) => w.__wallMats!.forEach((m) => (m.uniforms.wall.value = on));
      }
    }
    const emissive: { mat: THREE.MeshStandardMaterial; base: number; src: string }[] = [];
    const bulbs: { mat: THREE.MeshStandardMaterial; base: number }[] = [];
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (o.name.startsWith("Character_2D")) {
        const old = mesh.material as THREE.MeshStandardMaterial;
        // silhouette = alpha of the picture, colour = deep night (like the lifted shadows in Blender)
        mesh.material = new THREE.MeshBasicMaterial({ color: 0x06050e, map: old.map ?? null, alphaTest: 0.5, toneMapped: false });
        return;
      }
      const m = mesh.material as THREE.MeshStandardMaterial;
      const src = site.emissive_source[m.name];
      // only the neon sign flickers (Pasha, 2026-10-13): lamp, screen and lantern stay steady
      if (src === "paw" && m.emissiveIntensity !== undefined) emissive.push({ mat: m, base: m.emissiveIntensity, src });
      if (src === "lamp" && m.emissiveIntensity !== undefined && !bulbs.some((b) => b.mat === m)) bulbs.push({ mat: m, base: m.emissiveIntensity });
    });
    // the top book of the desk stack becomes its own clickable object (after the materials: it keeps the stack's)
    const books = site.objects.Desk_Books as BakedInfo | undefined;
    if (books) splitTopBook(gltf.scene, BASE + books.albedo, gltf.scene.getObjectByName("Camera_01_Main")!.getWorldPosition(new THREE.Vector3()));
    return { shaders, emissive, bulbs };
  }, [gltf, bitmaps, plaster, relief, decals]);

  // flicker of the neon sign only: its baked light mask + the paw tubes. Lamp switch: lamp slot of the shader (lamp-off bake).
  const lamp = useRef({ on: true, k: 1, since: 99 });
  useFrame(({ clock }, dt) => {
    const k = flickerAt(site.flicker, clock.elapsedTime);
    const L = lamp.current, on = store.get().lamp;
    if (on !== L.on) { L.on = on; L.since = 0; }
    L.since += dt;
    L.k = on ? lampOn(L.since) : L.k * Math.exp(-dt * 30);
    for (const s of shaders) (s.uniforms.k.value as THREE.Vector4).set(L.k, 1, k.neon, 1);
    for (const e of emissive) e.mat.emissiveIntensity = e.base * (k as Record<string, number>)[e.src];
    for (const b of bulbs) b.mat.emissiveIntensity = b.base * L.k;
  });

  const lantern = gltf.scene.getObjectByName("Project_01");
  return (
    <>
      <primitive object={gltf.scene} />
      <Smoke scene={gltf.scene} boost />
      <Interact scene={gltf.scene} />
      <Inspect scene={gltf.scene} />
      <City scene={gltf.scene} camera={gltf.scene.getObjectByName("Camera_01_Main")!} />
      {/* temporary project placeholders are not baked: a little real light for them */}
      <ambientLight intensity={0.25} color={"#6a5cff"} />
      {lantern && <pointLight position={lantern.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.2, 0.2))} intensity={0.6} distance={1.5} color={"#ff8a3a"} />}
      <CameraRig gltf={gltf} lens={site.cameras.Camera_01_Main.lens} sensor={site.cameras.Camera_01_Main.sensor} />
      {/* run after the rig (priority 0.1): lean towards the laptop; the desk book flies in front of the camera */}
      <Laptop scene={gltf.scene} />
      <Book />
      {/* after the rig: while meditating it owns the camera (flight through the smoke, the altar scene) */}
      <Suspense fallback={null}><Meditation room={gltf.scene} /></Suspense>
    </>
  );
}

// switching the lamp on: an old bulb catches with a couple of blinks, then settles (s since the click -> brightness 0..1)
const LAMP_ON: [number, number][] = [[0, 0], [0.04, 0.55], [0.08, 0.12], [0.13, 0.85], [0.17, 0.45], [0.22, 0.9], [0.4, 1]];
function lampOn(t: number) {
  for (let i = 0; i < LAMP_ON.length - 1; i++) {
    const [t0, v0] = LAMP_ON[i], [t1, v1] = LAMP_ON[i + 1];
    if (t < t1) return v0 + (v1 - v0) * ((t - t0) / (t1 - t0));
  }
  return 1;
}

// Camera 1 -> camera 2 is only a turn of the head (same point). While the cursor is near the right edge the head slowly
// turns towards the shelf, near the left edge back; elsewhere it stays where it is (any angle between camera 1 and 2).
// Small parallax with the cursor: +-4 cm sideways, +-2 cm up/down.
// TURN: edge zone (share of the half-width), speed (full turn per second at the very edge), softness of start/stop and limits.
// Field of view by window width (CSS px): Blender lens up to `from`, `wideFov` (deg, horizontal) from `to` on.
export const VIEW = { from: 1100, to: 1800, wideFov: 58 };
export const TURN = { zone: 0.3, speed: 0.4, accel: 4.0, soft: 0.1 };
// Phone: GYRO.gain = camera turn per phone turn (1 = turn the phone by the same angle as the head, like a window into the room),
// pitch = phone tilt (rad) for the full up/down parallax. Touch drag: `drag` = turn per screen width.
export const GYRO = { gain: 1.3, pitch: 0.35, smooth: 8 };
export const TOUCH = { drag: 1.6 };
// menu buttons: turn the head to a given position (0 = desk, 1 = shelf); the rig eases there and lets go
export const rig = { target: null as number | null };

// phone orientation -> heading (rad, counter-clockwise from above) and pitch of the screen's view direction.
// Same maths as three's old DeviceOrientationControls: alpha/beta/gamma + screen rotation -> quaternion.
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _f = new THREE.Vector3();
const Q_X = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));   // -90 deg around X: look out of the back of the phone
function phoneLook(a: number, b: number, g: number, screen: number) {
  const d = THREE.MathUtils.DEG2RAD;
  _e.set(b * d, a * d, -g * d, "YXZ");
  _q.setFromEuler(_e).multiply(Q_X).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -screen * d));
  _f.set(0, 0, -1).applyQuaternion(_q);
  return { heading: Math.atan2(-_f.x, -_f.z), pitch: Math.asin(THREE.MathUtils.clamp(_f.y, -1, 1)) };
}
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

// iOS asks for permission (only from a tap); Android just sends the events. Returns false if refused / not available.
export async function enableGyro(): Promise<boolean> {
  const DOE = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
  if (!DOE) return false;
  if (typeof DOE.requestPermission === "function") {
    try { if ((await DOE.requestPermission()) !== "granted") return false; } catch { return false; }
  }
  store.set({ gyro: true });
  return true;
}
export const hasGyro = () => typeof window !== "undefined" && "DeviceOrientationEvent" in window && matchMedia("(pointer: coarse)").matches;
function CameraRig({ gltf, lens, sensor }: { gltf: { scene: THREE.Object3D }; lens: number; sensor: number }) {
  const { camera, size } = useThree();
  // cursor over the whole window (also over future UI cards), -1..1
  const mouse = useRef({ x: 0, y: 0, inside: false, drag: 0, dragX: null as number | null });
  // phone orientation (raw, smoothed in useFrame); ref = heading that corresponds to the current turn
  const phone = useRef({ heading: 0, pitch: 0, ok: false, ref: null as number | null, pitch0: 0 });
  useEffect(() => {
    const on = (e: PointerEvent) => {
      if (e.pointerType === "touch") {
        // finger: drag sideways turns the head (no edges, no parallax)
        const m = mouse.current;
        if (m.dragX !== null) m.drag += ((m.dragX - e.clientX) / window.innerWidth) * TOUCH.drag;
        m.dragX = e.clientX;
        return;
      }
      mouse.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.current.y = -((e.clientY / window.innerHeight) * 2 - 1);
      mouse.current.inside = true;
    };
    const down = (e: PointerEvent) => { if (e.pointerType === "touch") mouse.current.dragX = e.clientX; };
    const up = () => { mouse.current.dragX = null; };
    window.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    const orient = (e: DeviceOrientationEvent) => {
      if (e.alpha === null || e.beta === null || e.gamma === null) return;
      const screen = (screen_angle());
      const l = phoneLook(e.alpha, e.beta, e.gamma, screen);
      const p = phone.current;
      p.heading = l.heading; p.pitch = l.pitch; p.ok = true;
    };
    window.addEventListener("deviceorientation", orient);
    // the cursor left the window: stop turning (otherwise the last edge position keeps turning the head)
    const out = () => { mouse.current.inside = false; };
    window.addEventListener("pointermove", on);
    document.documentElement.addEventListener("mouseleave", out);
    window.addEventListener("blur", out);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("deviceorientation", orient);
      window.removeEventListener("pointermove", on);
      document.documentElement.removeEventListener("mouseleave", out);
      window.removeEventListener("blur", out);
    };
  }, []);
  const pose = useMemo(() => {
    gltf.scene.updateMatrixWorld(true);
    const get = (n: string) => {
      const o = gltf.scene.getObjectByName(n)!;
      const cam = o.children.find((c) => (c as THREE.Camera).isCamera) ?? o;
      return { p: cam.getWorldPosition(new THREE.Vector3()), q: cam.getWorldQuaternion(new THREE.Quaternion()) };
    };
    const a = get("Camera_01_Main"), b = get("Camera_02_Shelf");
    return { a, b, angle: a.q.angleTo(b.q) };
  }, [gltf]);
  const st = useRef({ turn: 0, vel: 0, px: 0, py: 0 });

  const [wideFov, setWideFov] = useState(VIEW.wideFov);
  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__wideFov = setWideFov;
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    // horizontal angle: the Blender lens (40 mm, ~48 deg) on small windows, wider on big ones -> the room does not get
    // physically bigger when the window is maximised, you see more of it instead
    const base = 2 * Math.atan(sensor / 2 / lens);
    const k = THREE.MathUtils.smoothstep(size.width, VIEW.from, VIEW.to);
    const hfov = THREE.MathUtils.lerp(base, THREE.MathUtils.degToRad(wideFov), k);
    const aspect = size.width / size.height;
    // very wide windows: never crop more height than the 16:9 Blender frame
    const vMin = 2 * Math.atan(Math.tan(base / 2) / (16 / 9));
    const v = Math.max(vMin, 2 * Math.atan(Math.tan(hfov / 2) / aspect));
    cam.fov = Math.min(75, THREE.MathUtils.radToDeg(v));
    cam.near = 0.02; cam.far = 50;
    cam.updateProjectionMatrix();
  }, [size, camera, lens, sensor, wideFov]);

  useFrame((_, dt) => {
    const s = st.current;
    const pointer = mouse.current;
    if (import.meta.env.DEV) Object.assign(window, { __rig: s, __cam: camera, __scene: gltf.scene, __THREE: THREE });
    // while a project / contacts / meditation is open the head stays still (the cursor is busy with the card)
    const free = store.get().mode.kind === "room";
    // wanted speed: 0 outside the edge zones, grows (smoothly) towards the very edge
    let want = 0;
    if (free && pointer.inside) {
      const depth = THREE.MathUtils.clamp((Math.abs(pointer.x) - (1 - TURN.zone)) / TURN.zone, 0, 1);
      want = Math.sign(pointer.x) * TURN.speed * depth * depth * (3 - 2 * depth);
    }
    if (free && !(store.get().gyro && phone.current.ok)) {
      s.px += (pointer.x - s.px) * (1 - Math.exp(-dt * 3));
      s.py += (pointer.y - s.py) * (1 - Math.exp(-dt * 3));
    }
    // soft start and stop, and slowing down before the limits (camera 1 and camera 2)
    s.vel += (want - s.vel) * (1 - Math.exp(-dt * TURN.accel));
    const room = s.vel > 0 ? 1 - s.turn : s.turn;
    const v = s.vel * THREE.MathUtils.clamp(room / TURN.soft, 0, 1);
    s.turn = THREE.MathUtils.clamp(s.turn + v * dt, 0, 1);
    // finger drag
    if (pointer.drag) {
      if (free) { s.turn = THREE.MathUtils.clamp(s.turn + pointer.drag, 0, 1); rig.target = null; }
      pointer.drag = 0;
    }
    // phone orientation: turning the phone to the right turns the head to the shelf. The reference slides when the
    // phone goes past the limits, so after turning "too far" the way back starts at once.
    const ph = phone.current, gyro = store.get().gyro && ph.ok;
    if (gyro && free && rig.target === null) {
      if (ph.ref === null) { ph.ref = ph.heading + (s.turn * pose.angle) / GYRO.gain; ph.pitch0 = ph.pitch; }
      let want = (wrap(ph.ref - ph.heading) * GYRO.gain) / pose.angle;
      if (want < 0) { ph.ref -= (want * pose.angle) / GYRO.gain; want = 0; }
      if (want > 1) { ph.ref -= ((want - 1) * pose.angle) / GYRO.gain; want = 1; }
      s.turn += (want - s.turn) * (1 - Math.exp(-dt * GYRO.smooth));
      // tilt: parallax up/down; the "level" slowly follows the way the phone is held
      ph.pitch0 += (ph.pitch - ph.pitch0) * (1 - Math.exp(-dt * 0.15));
      s.py += (THREE.MathUtils.clamp((ph.pitch - ph.pitch0) / GYRO.pitch, -1, 1) - s.py) * (1 - Math.exp(-dt * GYRO.smooth));
    } else ph.ref = null;
    // menu: ease to a given turn
    if (rig.target !== null) {
      const d = rig.target - s.turn;
      s.turn += d * (1 - Math.exp(-dt * 2.2));
      s.vel = 0;
      if (Math.abs(d) < 0.002) { s.turn = rig.target; rig.target = null; }
    }
    camera.quaternion.copy(pose.a.q).slerp(pose.b.q, s.turn);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0);
    camera.position.copy(pose.a.p).addScaledVector(right, 0.04 * s.px).addScaledVector(up, 0.02 * s.py);
  });
  return null;
}

const screen_angle = () => (screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0) as number;
