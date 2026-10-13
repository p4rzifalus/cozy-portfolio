import * as THREE from "three";

// Same look as the "Painterly" node group in Blender (blender/scripts/style.py), but light comes from baked maps:
//   light  = max(0, lightmap + sum_i (k_i - 1) * mask_i) + ambient        (maps are log-encoded: v = 2^(c*range + min))
//   lamp slot is different: it holds the lightmap with the lamp OFF -> lightmap + (k_lamp - 1) * (lightmap - off),
//   so the switch (k_lamp 1 -> 0) lands exactly on the lamp-off bake (a subtracted mask left colour noise)
//   value  = 2^snap(log2(V) + (noise - 0.5)*jitter, step, soft)  capped at lightCap  (V = brightness of the light, hue kept)
//   colour = albedo * (0.97 + (noise - 0.5)*albedoVar) * light'
// Blender's Painterly: step 0.9, jitter 1.4, soft 0 (hard), albedoVar 0.5 — the site uses a calmer PAINT (see below).
// noise = brush-stroke noise baked into the lightmap alpha.
export const SOURCES = ["lamp", "screen", "neon", "lantern"] as const;
export type Source = (typeof SOURCES)[number];

const vert = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

// Walls: colour = tiling plaster (1 m) x relief (0.7 m, fake emboss lit from above) x large soft blotches x grime at the floor,
// plus damage decals from an atlas. Coordinates in metres on the wall plane, u = to the right as seen from inside the room.
export const MAX_DECALS = 8;
const wallFrag = /* glsl */ `
  uniform bool wall;
  uniform sampler2D plasterMap; uniform sampler2D reliefMap; uniform sampler2D decalMap;
  uniform vec4 wallP;      // tile size m, relief size m, relief strength, grime strength
  uniform float blotch;    // large-scale brightness variation, hides the repetition of the tile
  uniform vec3 decalBg;    // wall colour of the decal sheet: decals follow the brightness of the plaster under them
  uniform int dCount;
  uniform vec4 dPos[${MAX_DECALS}];   // centre u, v (m), width, height (m)
  uniform vec4 dRect[${MAX_DECALS}];  // atlas rect x, y (from top), w, h
  uniform float dRot[${MAX_DECALS}];  // radians
  varying vec3 vWorld;
  varying vec3 vNormalW;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  vec2 wallUV() {
    vec3 n = vNormalW, a = abs(n);
    if (a.x >= a.y && a.x >= a.z) return vec2(-sign(n.x) * vWorld.z, vWorld.y);
    if (a.z >= a.y) return vec2(sign(n.z) * vWorld.x, vWorld.y);
    return vec2(vWorld.x, vWorld.z);
  }
  vec3 wallAlbedo() {
    vec2 uv = wallUV();
    vec3 c = texture2D(plasterMap, uv / wallP.x).rgb;
    float b = vnoise(uv * 1.3 + 7.0) * 0.6 + vnoise(uv * 3.1) * 0.4;
    c *= 1.0 + (b - 0.5) * blotch;
    // relief: slopes facing up (towards the lamp and the ceiling glow) lighter, cavities a little darker
    vec2 ru = uv / wallP.y;
    float h = texture2D(reliefMap, ru).r;
    float hu = texture2D(reliefMap, ru + vec2(0.0015, 0.004)).r;
    c *= 1.0 + wallP.z * ((hu - h) * 6.0 + (h - 0.5) * 0.5);
    // grime along the floor, uneven
    float g = (1.0 - smoothstep(0.0, 0.35 + vnoise(vec2(uv.x * 4.0, 0.0)) * 0.25, vWorld.y)) * (0.55 + 0.45 * vnoise(uv * 6.0));
    c *= 1.0 - wallP.w * g;
    for (int i = 0; i < ${MAX_DECALS}; i++) {
      if (i >= dCount) break;
      vec2 d = uv - dPos[i].xy;
      float cs = cos(dRot[i]), sn = sin(dRot[i]);
      d = vec2(cs * d.x + sn * d.y, -sn * d.x + cs * d.y);
      vec2 t = d / dPos[i].zw + 0.5;
      if (any(lessThan(t, vec2(0.0))) || any(greaterThan(t, vec2(1.0)))) continue;
      vec4 s = texture2D(decalMap, vec2(dRect[i].x + t.x * dRect[i].z, 1.0 - dRect[i].y - (1.0 - t.y) * dRect[i].w));
      // follow the brightness of the plaster under it (blotches, grime), keep the decal's own hue
      float tint = clamp(dot(c, vec3(0.2126, 0.7152, 0.0722)) / dot(decalBg, vec3(0.2126, 0.7152, 0.0722)), 0.6, 1.4);
      c = mix(c, s.rgb * tint, s.a);
    }
    return c;
  }
`;

const frag = /* glsl */ `
  uniform sampler2D albedoMap;
  uniform sampler2D lightMap;
  uniform sampler2D mask0; uniform sampler2D mask1; uniform sampler2D mask2; uniform sampler2D mask3;
  uniform vec4 hasMask;
  uniform vec4 k;
  uniform vec3 ambient;
  uniform float logMin; uniform float logRange;
  uniform float stepSize; uniform float lightCap;
  uniform float saturation;
  uniform float contrast;
  uniform float gain;      // scene brightness (meditation altar is darker); renderer exposure is not refreshed for this shader
  uniform float jitter; uniform float soft; uniform float albedoVar;
  uniform bool foliage;
  uniform float strokes;   // 1 = brush strokes on light and colour, 0 = clean (pictures: posters, stickers)
  varying vec2 vUv;
  ${wallFrag}

  vec3 decode(vec3 c) { return exp2(c * logRange + logMin) - exp2(logMin); }

  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
  }
  vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
  }

  void main() {
    vec4 al = texture2D(albedoMap, vUv);
    if (wall) al.rgb = wallAlbedo();
    if (foliage && al.a < 0.5) discard;
    vec4 lm = texture2D(lightMap, vUv);
    vec3 L = decode(lm.rgb);
    L += (k.x - 1.0) * hasMask.x * (L - decode(texture2D(mask0, vUv).rgb));
    L += (k.y - 1.0) * hasMask.y * decode(texture2D(mask1, vUv).rgb);
    L += (k.z - 1.0) * hasMask.z * decode(texture2D(mask2, vUv).rgb);
    L += (k.w - 1.0) * hasMask.w * decode(texture2D(mask3, vUv).rgb);
    L = max(L, vec3(0.0)) + ambient;
    float noise = mix(0.5, lm.a, strokes);
    vec3 hsv = rgb2hsv(L);
    float x = (log2(max(hsv.z, 1.0e-4)) + (noise - 0.5) * jitter) / stepSize;
    // soft = 0: hard steps; soft = 1: every step blends smoothly into the next one
    float s = floor(x) + smoothstep(1.0 - max(soft, 1.0e-3), 1.0, fract(x));
    float v = min(exp2(s * stepSize), lightCap);
    vec3 light = hsv2rgb(vec3(hsv.xy, v));
    vec3 col = al.rgb * (0.97 + (noise - 0.5) * albedoVar) * light * gain;
    // "Punchy" look of Blender's AgX, approximated: contrast around mid-grey in log space + saturation
    col = 0.18 * pow(max(col, vec3(1.0e-6)) / 0.18, vec3(contrast));
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = max(mix(vec3(lum), col, saturation), 0.0);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// colour grade shared by all objects (tuned against Blender renders; window.__grade in dev for live tweaking)
export const GRADE = { saturation: { value: 1.1 }, contrast: { value: 1.0 }, gain: { value: 1.0 } };

// light steps ("ladder") shared by all objects (window.__paint in dev for live tweaking)
// variant «В — спокойно», chosen by Pasha 2026-10-13 (screenshots/116_noise_variants_lamp.jpg)
export const PAINT = { step: { value: 0.6 }, jitter: { value: 0.4 }, soft: { value: 0.65 }, albedoVar: { value: 0.18 } };

const BLACK = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
BLACK.needsUpdate = true;

export function painterlyMaterial(opts: {
  albedo: THREE.Texture;
  light: THREE.Texture;
  masks: Partial<Record<Source, THREE.Texture>>;
  ambient: [number, number, number];
  logMin: number;
  logRange: number;
  lightCap: number;
  foliage: boolean;
  strokes?: number;
  wall?: WallOpts;
}) {
  const m = SOURCES.map((s) => opts.masks[s]);
  return new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    side: opts.foliage ? THREE.DoubleSide : THREE.FrontSide,
    uniforms: {
      albedoMap: { value: opts.albedo },
      lightMap: { value: opts.light },
      mask0: { value: m[0] ?? BLACK },
      mask1: { value: m[1] ?? BLACK },
      mask2: { value: m[2] ?? BLACK },
      mask3: { value: m[3] ?? BLACK },
      hasMask: { value: new THREE.Vector4(...m.map((t) => (t ? 1 : 0))) },
      k: { value: new THREE.Vector4(1, 1, 1, 1) },
      ambient: { value: new THREE.Vector3(...opts.ambient) },
      logMin: { value: opts.logMin },
      logRange: { value: opts.logRange },
      stepSize: PAINT.step,
      jitter: PAINT.jitter,
      soft: PAINT.soft,
      albedoVar: PAINT.albedoVar,
      lightCap: { value: opts.lightCap },
      saturation: GRADE.saturation,
      contrast: GRADE.contrast,
      gain: GRADE.gain,
      foliage: { value: opts.foliage },
      strokes: { value: opts.strokes ?? 1 },
      ...wallUniforms(opts.wall),
    },
  });
}

// shared wall look (window.__wall in dev for live tweaking): tile 1 m, relief 0.7 m
export const WALL = { wallP: { value: new THREE.Vector4(1.0, 0.7, 0.18, 0.3) }, blotch: { value: 0.16 } };

export interface WallOpts {
  plaster: THREE.Texture; relief: THREE.Texture; decals: THREE.Texture; decalBg: [number, number, number];
  // u, v = centre on the wall (m), w = width (m), rot (deg), rect = atlas rect, aspect = h / w of the decal
  items: { u: number; v: number; w: number; rot: number; rect: [number, number, number, number]; aspect: number }[];
}

function wallUniforms(w?: WallOpts) {
  const pos = Array.from({ length: MAX_DECALS }, () => new THREE.Vector4());
  const rect = Array.from({ length: MAX_DECALS }, () => new THREE.Vector4());
  const rot = new Array(MAX_DECALS).fill(0);
  w?.items.slice(0, MAX_DECALS).forEach((d, i) => {
    pos[i].set(d.u, d.v, d.w, d.w * d.aspect);
    rect[i].set(...d.rect);
    rot[i] = THREE.MathUtils.degToRad(d.rot);
  });
  return {
    wall: { value: !!w },
    plasterMap: { value: w?.plaster ?? BLACK }, reliefMap: { value: w?.relief ?? BLACK }, decalMap: { value: w?.decals ?? BLACK },
    decalBg: { value: new THREE.Vector3(...(w?.decalBg ?? [1, 1, 1])) },
    dCount: { value: w ? Math.min(w.items.length, MAX_DECALS) : 0 },
    dPos: { value: pos }, dRect: { value: rect }, dRot: { value: rot },
    wallP: WALL.wallP, blotch: WALL.blotch,
  };
}
