// Painted UI textures (Disco Elysium / Dishonored look), drawn once in the browser — no image files.
// Dry-brush strokes: bristle streaks along the stroke, ragged ends that break into separate hairs, soft torn edges.
// Result -> CSS variables on <html>: --stroke-0..3 (dark plates), --stroke-light (hover swash), --panel (card), --blot (ink).

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (i: number, s: number) => {
  let h = Math.imul(i ^ Math.imul(s, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};
// smooth 1D value noise 0..1
const noise = (x: number, s: number) => {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return hash(i, s) * (1 - u) + hash(i + 1, s) * u;
};
const sstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

interface StrokeOpts {
  w: number; h: number; seed: number;
  color: [number, number, number];   // base colour 0..255
  alpha: number;                     // max opacity
  margin?: number;                   // empty band at top/bottom, share of height
  ends?: number;                     // how long the dry ragged ends are, share of width
}

function stroke({ w, h, seed, color, alpha, margin = 0.14, ends = 0.16 }: StrokeOpts) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(w, h);
  const r = rng(seed);
  const s = Math.floor(r() * 1e6);
  // each row = one hair of the brush: own strength, own start and end
  const rows = Array.from({ length: h }, (_, y) => {
    const hair = 0.72 + 0.28 * noise(y * 0.11, s) * (0.6 + 0.4 * noise(y * 0.9, s + 1));
    const x0 = w * (0.02 + ends * 0.5 * noise(y * 0.035, s + 2) + ends * 0.35 * noise(y * 0.4, s + 3));
    const x1 = w * (0.98 - ends * 0.5 * noise(y * 0.035, s + 4) - ends * 0.35 * noise(y * 0.4, s + 5));
    return { hair, x0, x1, off: hash(y, s + 6) * 500 };
  });
  for (let x = 0; x < w; x++) {
    // torn top and bottom edge, waving along the stroke
    const top = h * (margin + 0.08 * noise(x * 0.006, s + 7) + 0.03 * noise(x * 0.06, s + 8));
    const bot = h * (1 - margin - 0.08 * noise(x * 0.006, s + 9) - 0.03 * noise(x * 0.06, s + 10));
    for (let y = 0; y < h; y++) {
      const row = rows[y];
      const v = sstep(top, top + h * 0.06, y) * sstep(bot, bot - h * 0.06, y);
      if (v <= 0 || x < row.x0 - 30 || x > row.x1 + 30) continue;
      const along = sstep(row.x0 - 8, row.x0 + 30, x) * sstep(row.x1 + 8, row.x1 - 30, x);
      // dry brush: hairs break more often towards the ends
      const endT = Math.min(x / w, 1 - x / w) / ends;
      const dryAmt = 0.5 * (1 - Math.min(1, endT)) + 0.03;
      const g = noise(x * 0.035 + row.off, s + 11);
      const dry = sstep(dryAmt, dryAmt + 0.18, g);
      const a = alpha * row.hair * v * along * dry;
      if (a <= 0.002) continue;
      // darker body, some hairs catch light (pale streaks, like dry paint over a rough canvas)
      const glint = Math.max(0, noise(y * 0.7, s + 12) - 0.72) / 0.28;
      const shade = 0.72 + 0.5 * (row.hair - 0.55) + 0.9 * glint * glint + 0.12 * (hash(x * 7 + y * 131, s) - 0.5);
      const i = (y * w + x) * 4;
      img.data[i] = Math.min(255, color[0] * shade);
      img.data[i + 1] = Math.min(255, color[1] * shade);
      img.data[i + 2] = Math.min(255, color[2] * shade);
      img.data[i + 3] = Math.min(255, a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL("image/png");
}

// ink blot: noisy round stain with a darker rim (dried ink), a few drops around
function blot(size: number, seed: number, color: [number, number, number], alpha: number) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  const s = Math.floor(rng(seed)() * 1e6);
  const R = size * 0.3;
  const drops = Array.from({ length: 6 }, (_, k) => {
    const a = hash(k, s) * 6.283, d = R * (1.15 + 0.4 * hash(k, s + 1));
    return { x: size / 2 + Math.cos(a) * d, y: size / 2 + Math.sin(a) * d * 0.7, r: size * (0.01 + 0.02 * hash(k, s + 2)) };
  });
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = x - size / 2, dy = (y - size / 2) / 0.7;
    const ang = Math.atan2(dy, dx) / 6.283 + 0.5;
    const edge = R * (0.8 + 0.25 * noise(ang * 9, s + 3) + 0.12 * noise(ang * 40, s + 4));
    const d = Math.hypot(dx, dy);
    let a = sstep(edge + 2, edge - 2, d) * (0.55 + 0.45 * sstep(edge * 0.6, edge, d));
    for (const p of drops) a = Math.max(a, sstep(p.r + 1.5, p.r - 1.5, Math.hypot(x - p.x, y - p.y)));
    if (a <= 0) continue;
    const i = (y * size + x) * 4;
    img.data[i] = color[0]; img.data[i + 1] = color[1]; img.data[i + 2] = color[2];
    img.data[i + 3] = a * alpha * 255 * (0.85 + 0.15 * hash(x + y * size, s));
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL("image/png");
}

export const INK: [number, number, number] = [40, 30, 50];      // dark plum ink, like the room's shadows
export const PAPER: [number, number, number] = [240, 226, 200];  // cream swash (hover)
export const HAZE: [number, number, number] = [104, 88, 116];    // lighter dusty plum: label at the cursor (Pasha, 2026-10-15)

// Generated textures (Midjourney etc., prompts in refs/UI_PROMPTS.md) override the drawn ones:
// site/public/ui/tex/<name>.png (or .webp / .jpg), name = stroke-0..3, stroke-light, panel, blot.
// Two kinds of pictures work:
//  - cut out (transparent background): the shape comes from the transparency, the pale streaks inside it = thin paint;
//  - black ink on white paper: darkness = paint.
// Either way the picture is cropped to the paint (generators leave wide empty margins) and repainted in the plate's
// colour; thin paint is lighter and more see-through, so the plate stays translucent and keeps the brush texture.
const TEX = import.meta.env.BASE_URL + "ui/tex/";

function prepare(img: HTMLImageElement, tint: [number, number, number], alpha: number) {
  const c = document.createElement("canvas");
  const k = Math.min(1, 1400 / Math.max(img.width, img.height));
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  const px = d.data, w = c.width, h = c.height;
  let cutout = false;
  for (let i = 3; i < px.length; i += 4 * 97) if (px[i] < 250) { cutout = true; break; }
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const lum = (px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11) / 255;
    // paint amount 0…1 and how thin it is 0…1
    let paint: number, thin: number;
    if (cutout) { paint = px[i + 3] / 255; thin = Math.min(1, lum / 0.4); }
    else { paint = Math.min(1, Math.max(0, (0.92 - lum) / 0.8)); thin = 1 - paint; }   // paper (≥ 0.92) = empty
    const a = paint * (1 - 0.55 * thin) * alpha;
    const shade = 0.85 + 0.6 * thin;
    px[i] = Math.min(255, tint[0] * shade); px[i + 1] = Math.min(255, tint[1] * shade); px[i + 2] = Math.min(255, tint[2] * shade);
    px[i + 3] = a * 255;
    if (a > 0.06) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  ctx.putImageData(d, 0, 0);
  if (x1 <= x0 || y1 <= y0) return c.toDataURL("image/png");
  const out = document.createElement("canvas");
  out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
  out.getContext("2d")!.drawImage(c, -x0, -y0);
  return out.toDataURL("image/png");
}

export function paintUI() {
  const root = document.documentElement.style;
  const url = (d: string) => `url(${d})`;
  // file = which picture to repaint (one painted stroke can serve several colours)
  const set = (name: string, tint: [number, number, number], alpha: number, drawn: () => string, file = name) => {
    root.setProperty("--" + name, url(drawn()));
    const tryExt = (exts: string[]) => {
      if (!exts.length) return;
      const img = new Image();
      img.onload = () => root.setProperty("--" + name, url(prepare(img, tint, alpha)));
      img.onerror = () => tryExt(exts.slice(1));
      img.src = TEX + file + exts[0];
    };
    tryExt([".png", ".webp", ".jpg"]);
  };
  for (let k = 0; k < 4; k++) set(`stroke-${k}`, INK, 0.85, () => stroke({ w: 900, h: 220, seed: 11 + k * 7, color: INK, alpha: 0.92 }));
  set("stroke-hover", HAZE, 0.9, () => stroke({ w: 900, h: 220, seed: 11, color: HAZE, alpha: 0.9 }), "stroke-2");
  set("stroke-light", PAPER, 0.95, () => stroke({ w: 700, h: 160, seed: 5, color: PAPER, alpha: 0.95, margin: 0.18, ends: 0.12 }));
  set("panel", INK, 0.86, () => stroke({ w: 820, h: 1000, seed: 3, color: INK, alpha: 0.86, margin: 0.03, ends: 0.1 }));
  set("blot", [92, 24, 34], 0.6, () => blot(360, 9, [92, 24, 34], 0.55));
}
