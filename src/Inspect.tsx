import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { HOTSPOTS } from "./content";
import { store } from "./store";
import { INSPECT_LAYER, view } from "./Interact";

// Project inspection: click on a project in the shelf -> it flies to the camera, the room darkens behind it,
// the card opens beside it (HTML, Overlay.tsx). Drag rotates it (with inertia), idle -> slow turn. Close -> flies back.
const DIST = 0.55;          // m from the camera
const SIZE = 0.42;          // radius of the object on screen, share of the half-height of the frame
const FLY = 1.1;            // s

interface Item {
  obj: THREE.Object3D;
  meshes: THREE.Mesh[];
  pos: THREE.Vector3; quat: THREE.Quaternion; scale: THREE.Vector3;   // place on the shelf
  center: THREE.Vector3;    // bounding-box centre in local coordinates (the origin is at the bottom)
  radius: number;           // bounding-sphere radius in local units
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export default function Inspect({ scene }: { scene: THREE.Object3D }) {
  const { camera, gl, size } = useThree();
  const items = useMemo(() => {
    scene.updateMatrixWorld(true);
    const r: Record<string, Item> = {};
    for (const [id, h] of Object.entries(HOTSPOTS)) {
      if (h.action !== "project") continue;
      const obj = scene.getObjectByName(id);
      if (!obj) continue;
      // self-lit parts are exported as a separate object (the lantern glass): fly together with the body
      const emit = scene.getObjectByName(id + "__emit");
      if (emit && emit.parent !== obj) obj.attach(emit);
      const meshes: THREE.Mesh[] = [];
      obj.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
      // local bounding box: world box of the object with its own transform removed
      const inv = obj.matrixWorld.clone().invert();
      const box = new THREE.Box3();
      for (const m of meshes) {
        m.geometry.computeBoundingBox();
        box.union(m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld).applyMatrix4(inv));
      }
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      r[id] = { obj, meshes, pos: obj.position.clone(), quat: obj.quaternion.clone(), scale: obj.scale.clone(), center: sphere.center, radius: sphere.radius };
    }
    return r;
  }, [scene]);

  // a soft key light that only matters for the (unbaked) project models
  const key = useMemo(() => {
    const l = new THREE.DirectionalLight("#fff1dc", 0);
    l.layers.enableAll();
    return l;
  }, []);
  const fill = useMemo(() => { const l = new THREE.DirectionalLight("#8a7cff", 0); l.layers.enableAll(); return l; }, []);
  useEffect(() => {
    // the room lights must reach the inspect layer too
    scene.traverse((o) => { if ((o as THREE.Light).isLight) o.layers.enableAll(); });
  }, [scene]);

  const st = useRef({
    id: null as string | null, t: 0,
    yaw: 0, pitch: 0, vyaw: 0, vpitch: 0, idle: 0,
    drag: null as null | { x: number; y: number; time: number },
  });

  // drag to rotate (anywhere on the canvas while a project is open)
  useEffect(() => {
    const el = gl.domElement;
    const down = (e: PointerEvent) => {
      if (store.get().mode.kind !== "project") return;
      st.current.drag = { x: e.clientX, y: e.clientY, time: performance.now() };
      el.setPointerCapture(e.pointerId);
      el.style.cursor = "grabbing";
    };
    const move = (e: PointerEvent) => {
      const s = st.current, d = s.drag;
      if (!d) return;
      const k = 4.0 / Math.max(300, Math.min(window.innerWidth, window.innerHeight));
      const dx = (e.clientX - d.x) * k, dy = (e.clientY - d.y) * k;
      const dtm = Math.max(1, performance.now() - d.time) / 1000;
      s.yaw += dx; s.pitch = THREE.MathUtils.clamp(s.pitch + dy, -1.1, 1.1);
      s.vyaw = dx / dtm; s.vpitch = dy / dtm;
      s.drag = { x: e.clientX, y: e.clientY, time: performance.now() };
      s.idle = 0;
    };
    const up = () => { st.current.drag = null; };
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [gl]);

  const tmp = useMemo(() => ({
    p: new THREE.Vector3(), q: new THREE.Quaternion(), qu: new THREE.Quaternion(), s: new THREE.Vector3(),
    fwd: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3(), c: new THREE.Vector3(),
  }), []);

  useFrame((_, dt) => {
    const s = st.current;
    const mode = store.get().mode;
    const want = mode.kind === "project" ? mode.id : null;

    // switching: the current one flies back first
    if (want !== s.id) {
      if (s.id && s.t > 0) s.t = Math.max(0, s.t - dt / FLY);
      else { s.id = want; s.t = 0; s.yaw = 0; s.pitch = 0; s.vyaw = 0; s.vpitch = 0; s.idle = 0; }
    } else if (s.id) s.t = Math.min(1, s.t + dt / FLY);

    const it = s.id ? items[s.id] : null;
    if (!it) { view.inspected = null; view.veil += (0 - view.veil) * (1 - Math.exp(-dt * 6)); key.intensity = fill.intensity = 0; return; }

    // rotation: inertia after a drag, then a slow idle turn
    if (!s.drag && s.t >= 1) {
      s.vyaw *= Math.exp(-dt * 3); s.vpitch *= Math.exp(-dt * 3);
      s.yaw += s.vyaw * dt; s.pitch = THREE.MathUtils.clamp(s.pitch + s.vpitch * dt, -1.1, 1.1);
      s.idle += dt;
      if (s.idle > 2.5) { s.yaw += dt * 0.25 * Math.min(1, (s.idle - 2.5) / 2); s.pitch *= Math.exp(-dt * 0.5); }
    }

    // target in front of the camera: desktop -> left of the card, portrait -> above the card
    const cam = camera as THREE.PerspectiveCamera;
    const halfH = DIST * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const aspect = size.width / size.height;
    const portrait = aspect < 0.9;
    const sx = portrait ? 0 : -0.38, sy = portrait ? 0.42 : 0.02;
    camera.matrixWorld.decompose(tmp.c, tmp.q, tmp.s);
    tmp.fwd.set(0, 0, -1).applyQuaternion(tmp.q);
    tmp.right.set(1, 0, 0).applyQuaternion(tmp.q);
    tmp.up.set(0, 1, 0).applyQuaternion(tmp.q);
    const target = tmp.c.clone().addScaledVector(tmp.fwd, DIST)
      .addScaledVector(tmp.right, sx * halfH * aspect).addScaledVector(tmp.up, sy * halfH);
    const scaleK = ((portrait ? 0.3 : SIZE) * halfH) / it.radius;

    // orientation: as it stands on the shelf, turned by the user in camera space
    tmp.qu.setFromEuler(new THREE.Euler(s.pitch, s.yaw, 0, "YXZ"));
    const qTarget = tmp.q.clone().multiply(tmp.qu).multiply(tmp.q.clone().invert()).multiply(it.quat);

    const e = ease(s.t);
    const q = it.quat.clone().slerp(qTarget, e);
    const sc = it.scale.clone().lerp(new THREE.Vector3(scaleK, scaleK, scaleK), e);
    // the bounding-box centre travels from its place on the shelf to the target (a little arc upwards)
    const c0 = it.center.clone().multiply(it.scale).applyQuaternion(it.quat).add(it.pos);
    const center = c0.lerp(target, e).addScaledVector(tmp.up, Math.sin(Math.PI * e) * 0.05);
    it.obj.quaternion.copy(q);
    it.obj.scale.copy(sc);
    it.obj.position.copy(center).sub(it.center.clone().multiply(sc).applyQuaternion(q));

    // on top of the veil while flying (except the very start / end, where it still sits in the shelf)
    const onTop = s.t > 0.03;
    for (const m of it.meshes) m.layers.set(onTop ? INSPECT_LAYER : 0);
    view.inspected = onTop ? it.obj : null;
    view.veil = e;

    key.intensity = 1.2 * e; fill.intensity = 0.6 * e;
    key.position.copy(tmp.c).addScaledVector(tmp.up, 0.6).addScaledVector(tmp.right, 0.5).addScaledVector(tmp.fwd, 0.1);
    key.target.position.copy(target);
    fill.position.copy(tmp.c).addScaledVector(tmp.right, -0.7).addScaledVector(tmp.fwd, 0.4);
    fill.target.position.copy(target);
    key.target.updateMatrixWorld(); fill.target.updateMatrixWorld();

    // back home: restore exactly
    if (want !== s.id && s.t === 0) {
      it.obj.position.copy(it.pos); it.obj.quaternion.copy(it.quat); it.obj.scale.copy(it.scale);
      for (const m of it.meshes) m.layers.set(0);
    }
  });

  return (
    <>
      <primitive object={key} />
      <primitive object={key.target} />
      <primitive object={fill} />
      <primitive object={fill.target} />
    </>
  );
}
