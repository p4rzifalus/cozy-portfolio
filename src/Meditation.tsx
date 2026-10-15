import { useEffect, useMemo, useRef } from "react";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { painterlyMaterial, SOURCES, Source } from "./painterly";
import { RawLoader, toTexture } from "./Room";
import Smoke, { findTips } from "./Smoke";
import { view } from "./Interact";
import { store } from "./store";
import { startMantra, stopMantra } from "./music";
import { V } from "./version";

// Meditation: click on the incense -> the camera flies into its smoke, the smoke fills the screen, behind it the scene changes
// to the altar (through a fade to black) (Buddha in the middle, incense burner, candle - from web-3d, baked like the room: blender/scripts/altar_build.py +
// altar_export.py -> /altar/), the camera comes out of the altar incense smoke and settles. Mantras play. Esc / button -> back the same way.
// The altar stands far away from the room (ALTAR_AT): the room camera never sees it and vice versa (camera.far = 50).
const BASE = import.meta.env.BASE_URL + "altar/";
const ALTAR_AT = new THREE.Vector3(200, 0, 0);
const FLIGHT = 4.2;          // s, room -> altar (and back)
// exposure: the spot is strong in the bake -> darker than the room, a night altar. Dev: window.__altar.exposure = ...
export const ALTAR = { exposure: 0.45 };
if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__altar = ALTAR;
const AMBIENT_K = 2.0;       // flat night light in the shadows (baked world light is tiny)
const PARALLAX = { x: 0.025, y: 0.012 };   // m, the camera follows the cursor a little
const PULL_BACK = 0.3;      // m: the altar camera stands this much further back than in Blender (Pasha: "чуть отдали")
const EMBER = new THREE.Color(1.0, 0.12, 0.03);   // incense embers: deep red (Pasha)

interface AltarJson {
  objects: Record<string, { kind: "baked"; albedo: string; light: string; masks: Partial<Record<Source, string>> } | { kind: "emissive" }>;
  ambient: [number, number, number];
  encoding: { log_min: number; log_range: number };
  painterly: { step: number; light_cap: number };
  camera: { lens: number; sensor: number };
  candle: [number, number, number];
}
interface Pose { p: THREE.Vector3; q: THREE.Quaternion; fov: number }

const easeIn = (t: number) => t * t * t;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const smooth = (a: number, b: number, x: number) => THREE.MathUtils.smoothstep(x, a, b);
function lookPose(eye: THREE.Vector3, target: THREE.Vector3, fov: number): Pose {
  const m = new THREE.Matrix4().lookAt(eye, target, new THREE.Vector3(0, 1, 0));
  return { p: eye.clone(), q: new THREE.Quaternion().setFromRotationMatrix(m), fov };
}
// a point just in front of the smoke tip, seen from `from`, looking into the smoke
function intoSmoke(tip: THREE.Vector3, from: THREE.Vector3, fov: number): Pose {
  const d = from.clone().sub(tip).normalize();
  const eye = tip.clone().addScaledVector(d, 0.07).add(new THREE.Vector3(0, 0.03, 0));
  return lookPose(eye, tip.clone().add(new THREE.Vector3(0, 0.06, 0)), fov * 0.8);
}

export default function Meditation({ room }: { room: THREE.Object3D }) {
  const { camera, size } = useThree();
  const json: AltarJson = JSON.parse(useLoader(THREE.FileLoader, BASE + "altar.json" + V) as string);
  const gltf = useGLTF(BASE + "altar.glb" + V);
  const baked = Object.entries(json.objects).filter(([, v]) => v.kind === "baked") as [string, { albedo: string; light: string; masks: Partial<Record<Source, string>> }][];
  const files = useMemo(() => baked.flatMap(([, b]) => [b.albedo, b.light, ...SOURCES.filter((s) => b.masks[s]).map((s) => b.masks[s]!)]), [baked.length]);
  const bitmaps = useLoader(RawLoader, files.map((f) => BASE + f + V)) as ImageBitmap[];

  // materials like the room: Painterly from albedo + lightmap; the candle mask uses the "lantern" flicker slot
  const { shaders, flames, altarCam, tips } = useMemo(() => {
    const bmp: Record<string, ImageBitmap> = {};
    files.forEach((f, i) => (bmp[f] = bitmaps[i]));
    const amb = json.ambient.map((v) => v * AMBIENT_K) as [number, number, number];
    const shaders: THREE.ShaderMaterial[] = [];
    for (const [name, b] of baked) {
      const obj = gltf.scene.getObjectByName(name);
      if (!obj) continue;
      const masks: Partial<Record<Source, THREE.Texture>> = {};
      for (const s of SOURCES) if (b.masks[s]) masks[s] = toTexture(bmp[b.masks[s]!], false);
      const mat = painterlyMaterial({
        albedo: toTexture(bmp[b.albedo], true), light: toTexture(bmp[b.light], false), masks,
        ambient: amb, logMin: json.encoding.log_min, logRange: json.encoding.log_range,
        lightCap: json.painterly.light_cap, foliage: false, strokes: 1,
      });
      obj.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = mat; });
      shaders.push(mat);
    }
    const flames: { mat: THREE.MeshStandardMaterial; base: number; time: THREE.IUniform }[] = [];
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const m = mesh.material as THREE.MeshStandardMaterial | undefined;
      if (!mesh.isMesh || !m?.name) return;
      if (m.name.startsWith("M_Incense_Ember")) { m.color.copy(EMBER); m.emissive.copy(EMBER); m.emissiveIntensity = 2.2; }
      if (m.name.startsWith("M_Candle_Flame")) {
        // the flame sways and stretches: vertices bend more the higher they are (base = bottom of the flame faces)
        mesh.geometry.computeBoundingBox();
        const bb = mesh.geometry.boundingBox!;
        const time = { value: 0 };
        m.onBeforeCompile = (sh) => {
          sh.uniforms.fTime = time;
          sh.uniforms.fBase = { value: bb.min.y };
          sh.uniforms.fHeight = { value: Math.max(1e-4, bb.max.y - bb.min.y) };
          sh.uniforms.fCenter = { value: new THREE.Vector2((bb.min.x + bb.max.x) / 2, (bb.min.z + bb.max.z) / 2) };
          sh.vertexShader = "uniform float fTime; uniform float fBase; uniform float fHeight; uniform vec2 fCenter;\n" +
            sh.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
            float fh = clamp((transformed.y - fBase) / fHeight, 0.0, 1.0);
            float sway = sin(fTime * 3.1) * 0.6 + sin(fTime * 7.3 + 1.3) * 0.3 + sin(fTime * 13.0) * 0.12;
            float sway2 = sin(fTime * 2.3 + 0.7) * 0.6 + sin(fTime * 9.1) * 0.25;
            float stretch = 1.0 + 0.12 * sin(fTime * 5.7) + 0.06 * sin(fTime * 11.0 + 2.0);
            vec2 r = transformed.xz - fCenter;
            transformed.xz = fCenter + r * (1.0 - 0.15 * fh * (stretch - 1.0) * 4.0) + vec2(sway, sway2) * fHeight * 0.18 * fh * fh;
            transformed.y = fBase + (transformed.y - fBase) * stretch;`);
        };
        m.needsUpdate = true;
        flames.push({ mat: m, base: m.emissiveIntensity, time });
      }
    });
    gltf.scene.position.copy(ALTAR_AT);
    gltf.scene.updateMatrixWorld(true);
    const c = gltf.scene.getObjectByName("Camera_Altar")!;
    const cam = c.children.find((x) => (x as THREE.Camera).isCamera) ?? c;
    const altarCam = { p: cam.getWorldPosition(new THREE.Vector3()), q: cam.getWorldQuaternion(new THREE.Quaternion()) };
    altarCam.p.addScaledVector(new THREE.Vector3(0, 0, 1).applyQuaternion(altarCam.q), PULL_BACK);
    const tips = findTips(gltf.scene);
    return { shaders, flames, altarCam, tips };
  }, [gltf, bitmaps]);

  // field of view of the altar camera: its lens across the width, never less height than a 16:9 frame
  const altarFov = useMemo(() => {
    const h = 2 * Math.atan(json.camera.sensor / 2 / json.camera.lens);
    const aspect = size.width / size.height;
    const vMin = 2 * Math.atan(Math.tan(h / 2) / (16 / 9));
    return THREE.MathUtils.radToDeg(Math.max(vMin, 2 * Math.atan(Math.tan(h / 2) / aspect)));
  }, [size, json]);

  const mouse = useRef({ x: 0, y: 0 });
  useEffect(() => {
    const on = (e: PointerEvent) => { mouse.current.x = (e.clientX / innerWidth) * 2 - 1; mouse.current.y = -((e.clientY / innerHeight) * 2 - 1); };
    window.addEventListener("pointermove", on);
    return () => window.removeEventListener("pointermove", on);
  }, []);

  const st = useRef({
    phase: "room" as "room" | "toAltar" | "altar" | "toRoom", t: 0,
    room: null as Pose | null, roomDive: null as Pose | null, altarDive: null as Pose | null, from: null as Pose | null,
    px: 0, py: 0,
  });
  const roomTip = useMemo(() => findTips(room)[0] ?? new THREE.Vector3(), [room]);
  const altarTip = useMemo(() => tips.reduce((a, b) => (b.y > a.y ? b : a), tips[0] ?? altarCam.p), [tips, altarCam]);

  const cam = camera as THREE.PerspectiveCamera;
  const apply = (a: Pose, b: Pose, k: number) => {
    cam.position.copy(a.p).lerp(b.p, k);
    cam.quaternion.copy(a.q).slerp(b.q, k);
    const f = THREE.MathUtils.lerp(a.fov, b.fov, k);
    if (Math.abs(cam.fov - f) > 1e-3) { cam.fov = f; cam.updateProjectionMatrix(); }
  };

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.05);   // a hidden tab / hiccup must not skip the whole flight
    const s = st.current;
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__med = s;
    const want = store.get().mode.kind === "meditation";
    const altarPose = (): Pose => {
      // settled: the altar camera + a little cursor parallax
      s.px += (mouse.current.x - s.px) * (1 - Math.exp(-dt * 2)); s.py += (mouse.current.y - s.py) * (1 - Math.exp(-dt * 2));
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(altarCam.q);
      return { p: altarCam.p.clone().addScaledVector(right, PARALLAX.x * s.px).add(new THREE.Vector3(0, PARALLAX.y * s.py, 0)), q: altarCam.q, fov: altarFov };
    };

    if (want && s.phase === "room") {
      s.room = { p: cam.position.clone(), q: cam.quaternion.clone(), fov: cam.fov };
      s.roomDive = intoSmoke(roomTip, s.room.p, s.room.fov);
      s.altarDive = intoSmoke(altarTip, altarCam.p, altarFov);
      s.phase = "toAltar"; s.t = 0;
      startMantra();
    } else if (!want && s.phase === "altar") {
      s.from = altarPose();   // not the camera: the head-turn rig has already written the room pose into it this frame
      s.phase = "toRoom"; s.t = 0;
      stopMantra();
    }

    // candle flicker: flame + its light on the scene (mask)
    const t = clock.elapsedTime;
    const candle = 1 + 0.1 * Math.sin(t * 7.3) * Math.sin(t * 2.1 + 1) + 0.06 * Math.sin(t * 17.0 + Math.sin(t * 3.0));
    for (const m of shaders) (m.uniforms.k.value as THREE.Vector4).set(1, 1, 1, candle);
    for (const f of flames) { f.mat.emissiveIntensity = f.base * candle; f.time.value = t; }

    if (s.phase === "room") return;
    view.altarExposure = ALTAR.exposure;
    s.t = Math.min(1, s.t + dt / FLIGHT);
    const u = s.t;
    if (s.phase === "toAltar") {
      if (u < 0.5) {
        const a = easeIn(u / 0.5);
        apply(s.room!, s.roomDive!, a);
        view.atAltar = false;
      } else {
        apply(s.altarDive!, altarPose(), easeOut((u - 0.5) / 0.5));
        view.smokeBoost = 0; view.atAltar = true;
      }
      view.fog = smooth(0.25, 0.47, u) * (1 - smooth(0.53, 0.78, u));   // fade through black, the cut is in the dark
      if (u >= 1) { s.phase = "altar"; view.fog = 0; }
    } else if (s.phase === "altar") {
      const p = altarPose(); apply(p, p, 0);
      view.atAltar = true; view.fog = 0;
    } else if (s.phase === "toRoom") {
      if (u < 0.5) {
        apply(s.from!, s.altarDive!, easeIn(u / 0.5));
        view.atAltar = true;
      } else {
        const a = easeOut((u - 0.5) / 0.5);
        apply(s.roomDive!, s.room!, a);
        view.atAltar = false;
      }
      view.fog = smooth(0.25, 0.47, u) * (1 - smooth(0.53, 0.78, u));   // fade through black, the cut is in the dark
      if (u >= 1) {
        s.phase = "room"; view.fog = 0; view.smokeBoost = 0;
        cam.fov = s.room!.fov; cam.updateProjectionMatrix();
      }
    }
  }, 0.5);   // always after the head-turn rig (0) and before the render loop (Interact, 1)

  return (
    <>
      <primitive object={gltf.scene} />
      <Smoke tips={tips} opacity={0.085} period={24} rise={0.42} perTip={420} size0={0.005} />
    </>
  );
}
