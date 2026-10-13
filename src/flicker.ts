// Flicker of the light sources, same numbers as blender/scripts/flicker.py (keys: [frame, multiplier], 24 fps, 4 s loop).
export type Keys = [number, number][];
export interface FlickerSpec {
  loop_s: number;
  fps: number;
  lamp: { interp: string; keys: Keys };
  screen: { interp: string; keys: Keys };
  paw: { interp: string; keys: Keys };
  lantern: { noise: number; period_frames: number };
}

function sample(keys: Keys, frame: number, smooth: boolean) {
  if (frame <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [f0, v0] = keys[i];
    const [f1, v1] = keys[i + 1];
    if (frame < f1) {
      if (!smooth) return v0;
      const t = (frame - f0) / (f1 - f0);
      return v0 + (v1 - v0) * (t * t * (3 - 2 * t));
    }
  }
  return keys[keys.length - 1][1];
}

/** multipliers of every flickering source at time t (seconds) */
export function flickerAt(spec: FlickerSpec, t: number) {
  const frame = 1 + ((t % spec.loop_s) / spec.loop_s) * (spec.loop_s * spec.fps);
  const paw = sample(spec.paw.keys, frame, false);
  // candle: a few unrelated sines ~ the noise wobble of Blender (period ~6 frames)
  const w = (2 * Math.PI * spec.fps) / spec.lantern.period_frames;
  const n = 0.5 * Math.sin(t * w) + 0.3 * Math.sin(t * w * 1.73 + 1.3) + 0.2 * Math.sin(t * w * 0.61 + 4.1);
  return {
    lamp: sample(spec.lamp.keys, frame, spec.lamp.interp === "smooth"),
    screen: sample(spec.screen.keys, frame, false),
    neon: 0.85 + 0.15 * paw,
    lantern: 1 + spec.lantern.noise * n,
    paw,
  };
}
