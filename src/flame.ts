import * as THREE from "three";

// Candle flames (altar candle, Jack's lantern): brightness flicker + a vertex sway of the flame mesh.
export const candleAt = (t: number) =>
  1 + 0.1 * Math.sin(t * 7.3) * Math.sin(t * 2.1 + 1) + 0.06 * Math.sin(t * 17.0 + Math.sin(t * 3.0));

// the flame sways and stretches: vertices bend more the higher they are (base = bottom of the flame faces).
// amp: size of the sway/stretch (altar 1). tongues: colour along the height (yellow core at the bottom -> red-orange tip)
// with bright bands running up, like licking tongues of fire. Returns the time uniform: set .value every frame.
export function swayFlame(mesh: THREE.Mesh, m: THREE.Material, { amp = 1, tongues = false } = {}): THREE.IUniform {
  mesh.geometry.computeBoundingBox();
  const bb = mesh.geometry.boundingBox!;
  const time = { value: 0 };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.fTime = time;
    sh.uniforms.fBase = { value: bb.min.y };
    sh.uniforms.fHeight = { value: Math.max(1e-4, bb.max.y - bb.min.y) };
    sh.uniforms.fCenter = { value: new THREE.Vector2((bb.min.x + bb.max.x) / 2, (bb.min.z + bb.max.z) / 2) };
    sh.uniforms.fAmp = { value: amp };
    sh.vertexShader = "uniform float fTime; uniform float fBase; uniform float fHeight; uniform vec2 fCenter; uniform float fAmp;\nvarying float vFh;\n" +
      sh.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
      float fh = clamp((transformed.y - fBase) / fHeight, 0.0, 1.0);
      float sway = sin(fTime * 3.1) * 0.6 + sin(fTime * 7.3 + 1.3) * 0.3 + sin(fTime * 13.0) * 0.12;
      float sway2 = sin(fTime * 2.3 + 0.7) * 0.6 + sin(fTime * 9.1) * 0.25;
      float stretch = 1.0 + fAmp * (0.12 * sin(fTime * 5.7) + 0.06 * sin(fTime * 11.0 + 2.0));
      sway *= fAmp; sway2 *= fAmp; vFh = fh;
      vec2 r = transformed.xz - fCenter;
      transformed.xz = fCenter + r * (1.0 - 0.15 * fh * (stretch - 1.0) * 4.0) + vec2(sway, sway2) * fHeight * 0.18 * fh * fh;
      transformed.y = fBase + (transformed.y - fBase) * stretch;`);
    if (tongues) {
      sh.fragmentShader = "uniform float fTime;\nvarying float vFh;\n" +
        sh.fragmentShader.replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        vec3 fcol = mix(vec3(1.35, 1.15, 0.55), vec3(1.0, 0.42, 0.22), smoothstep(0.15, 0.85, vFh));
        float band = 0.82 + 0.18 * sin(vFh * 14.0 - fTime * 9.0) + 0.08 * sin(vFh * 31.0 - fTime * 17.0);
        totalEmissiveRadiance *= fcol * band;`);
    } else {
      sh.fragmentShader = "varying float vFh;\n" + sh.fragmentShader;
    }
  };
  m.needsUpdate = true;
  return time;
}
