import { store } from "./store";

// Music of the record player. Real tracks: put mp3 files into site/public/music/ and list them in TRACKS.
// Until then a quiet synthesized stand-in plays: vinyl crackle + slow lofi chords (Web Audio, no files).
const TRACKS: string[] = [];   // e.g. ["music/01.mp3", "music/02.mp3"] (relative: the site lives at /cozy-portfolio/ on GitHub Pages)
const VOLUME = 0.5;

let audio: HTMLAudioElement | null = null;
let track = 0;
let synth: { ctx: AudioContext; out: GainNode; timer: number } | null = null;

export function toggleMusic() {
  const on = !store.get().music;
  store.set({ music: on });
  if (TRACKS.length) {
    if (!audio) {
      audio = new Audio(TRACKS[0]);
      audio.volume = VOLUME;
      audio.addEventListener("ended", () => { track = (track + 1) % TRACKS.length; audio!.src = TRACKS[track]; audio!.play(); });
    }
    if (on) audio.play(); else audio.pause();
    return;
  }
  if (on) startSynth(); else stopSynth();
}

// --- stand-in: Fmaj7 - Em7 - Dm7 - Cmaj7, soft electric-piano-ish tones through a low-pass, plus crackle
const CHORDS = [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]];
const BAR = 3.2;   // s per chord
const hz = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

function startSynth() {
  if (synth) { synth.ctx.resume(); synth.out.gain.setTargetAtTime(VOLUME * 0.35, synth.ctx.currentTime, 0.4); return; }
  const ctx = new AudioContext();
  const out = ctx.createGain();
  out.gain.value = 0;
  out.gain.setTargetAtTime(VOLUME * 0.35, ctx.currentTime, 0.6);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass"; lp.frequency.value = 1400; lp.Q.value = 0.4;
  lp.connect(out); out.connect(ctx.destination);

  // crackle: sparse clicks in a noise buffer, looped
  const len = ctx.sampleRate * 4;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.012 + (Math.random() < 0.0004 ? (Math.random() * 2 - 1) * 0.5 : 0);
  const noise = ctx.createBufferSource();
  noise.buffer = buf; noise.loop = true;
  const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 900;
  noise.connect(hp); hp.connect(out); noise.start();

  let bar = 0, next = ctx.currentTime + 0.1;
  const schedule = () => {
    while (next < ctx.currentTime + 1.0) {
      const chord = CHORDS[bar % CHORDS.length];
      chord.forEach((n, i) => note(ctx, lp, hz(n), next + i * 0.045, BAR * 0.98, 0.05));
      note(ctx, lp, hz(chord[0] - 12), next, BAR, 0.07);        // bass
      if (bar % 2 === 1) note(ctx, lp, hz(chord[3] + 12), next + BAR * 0.5, BAR * 0.45, 0.025);   // a little melody note
      next += BAR; bar++;
    }
  };
  schedule();
  synth = { ctx, out, timer: window.setInterval(schedule, 250) };
}

function note(ctx: AudioContext, dest: AudioNode, f: number, t: number, dur: number, vol: number) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.02);
  g.gain.exponentialRampToValueAtTime(vol * 0.35, t + 0.6);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(dest);
  for (const [type, mul, v] of [["sine", 1, 1], ["triangle", 2, 0.25]] as const) {
    const o = ctx.createOscillator();
    o.type = type; o.frequency.value = f * mul;
    o.detune.value = (Math.random() - 0.5) * 8;      // a slightly wobbly tape
    const og = ctx.createGain(); og.gain.value = v;
    o.connect(og); og.connect(g);
    o.start(t); o.stop(t + dur + 0.05);
  }
}

function stopSynth() {
  if (!synth) return;
  const s = synth;
  s.out.gain.setTargetAtTime(0, s.ctx.currentTime, 0.3);
  setTimeout(() => { if (!store.get().music) s.ctx.suspend(); }, 1800);
}

// ---------------- meditation: synthesized mantra ----------------
// Tanpura-like drone (Sa - Pa - Sa', buzzing saw through band-passes, slow re-plucks), a low "Ommm" chant (sawtooth voices
// through vowel formants o -> u -> m, a breath cycle of ~10 s) and a singing bowl every ~16 s, all in a long generated reverb.
// The room music pauses meanwhile and comes back after.
const MANTRA = { volume: 0.55, root: 110 /* Hz, A2 */, breath: 10.5, bowlEvery: 16 };
let mantra: { ctx: AudioContext; out: GainNode; timers: number[] } | null = null;
let roomWasOn = false;

export function startMantra() {
  roomWasOn = store.get().music;
  if (roomWasOn) { if (audio) audio.pause(); else stopSynth(); }
  if (mantra) {
    mantra.ctx.resume();
    mantra.out.gain.cancelScheduledValues(mantra.ctx.currentTime);
    mantra.out.gain.setTargetAtTime(MANTRA.volume, mantra.ctx.currentTime, 1.5);
    return;
  }
  const ctx = new AudioContext();
  const out = ctx.createGain(); out.gain.value = 0;
  out.gain.setTargetAtTime(MANTRA.volume, ctx.currentTime + 1.5, 1.5);   // fades in while the camera flies
  const verb = ctx.createConvolver(); verb.buffer = impulse(ctx, 5.0);
  const wet = ctx.createGain(); wet.gain.value = 0.55;
  const dry = ctx.createGain(); dry.gain.value = 0.6;
  const bus = ctx.createGain();
  bus.connect(dry); bus.connect(verb); verb.connect(wet); dry.connect(out); wet.connect(out); out.connect(ctx.destination);
  const R = MANTRA.root;

  // drone: Sa, Pa, Sa', Sa (low) - four strings re-plucked in turn
  const strings = [R * 1.5, R * 2, R * 2, R];
  strings.forEach((f, i) => {
    const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = f; o.detune.value = (i - 1.5) * 3;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = f * 6; bp.Q.value = 1.2;   // "jawari" buzz
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1800;
    const g = ctx.createGain(); g.gain.value = 0;
    o.connect(bp); bp.connect(lp); lp.connect(g); g.connect(bus); o.start();
    const pluck = () => {
      if (ctx.state !== "running") return;   // paused between meditations: no events piling up
      const t = ctx.currentTime;
      g.gain.cancelScheduledValues(t);
      g.gain.setTargetAtTime(0.05, t, 0.02);
      g.gain.setTargetAtTime(0.018, t + 0.1, 1.2);
      bp.frequency.setValueAtTime(f * 9, t); bp.frequency.exponentialRampToValueAtTime(f * 4, t + 2.5);   // the buzz sweeps down
    };
    setTimeout(() => { pluck(); mantra?.timers.push(window.setInterval(pluck, 4000)); }, i * 1000);
  });

  // chant: three detuned voices on the root through formant filters; vowel moves o -> u -> m over one breath
  const voice = ctx.createGain(); voice.gain.value = 0; voice.connect(bus);
  const formants = [ctx.createBiquadFilter(), ctx.createBiquadFilter(), ctx.createBiquadFilter()];
  formants.forEach((f) => { f.type = "bandpass"; f.Q.value = 6; f.connect(voice); });
  const fGain = [1.0, 0.5, 0.25];
  for (const d of [-7, 0, 6]) {
    const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = R; o.detune.value = d;
    const vib = ctx.createOscillator(); vib.frequency.value = 4.6 + d * 0.05; const vg = ctx.createGain(); vg.gain.value = 3;
    vib.connect(vg); vg.connect(o.detune); vib.start();
    formants.forEach((f, i) => { const g = ctx.createGain(); g.gain.value = fGain[i]; o.connect(g); g.connect(f); });
    o.start();
  }
  const breath = () => {
    if (ctx.state !== "running") return;
    const t = ctx.currentTime, B = MANTRA.breath;
    const [f1, f2, f3] = formants;
    // "O" -> "U" -> "M" (nasal: only a low formant)
    f1.frequency.setValueAtTime(450, t); f2.frequency.setValueAtTime(800, t); f3.frequency.setValueAtTime(2600, t);
    f1.frequency.linearRampToValueAtTime(330, t + B * 0.35); f2.frequency.linearRampToValueAtTime(650, t + B * 0.35);
    f1.frequency.linearRampToValueAtTime(250, t + B * 0.55); f2.frequency.linearRampToValueAtTime(300, t + B * 0.55);
    f3.frequency.linearRampToValueAtTime(900, t + B * 0.55);
    voice.gain.cancelScheduledValues(t);
    voice.gain.setValueAtTime(0, t);
    voice.gain.linearRampToValueAtTime(0.22, t + 1.2);
    voice.gain.linearRampToValueAtTime(0.16, t + B * 0.55);
    voice.gain.linearRampToValueAtTime(0.0, t + B * 0.85);   // a pause to breathe in
  };
  breath();
  const timers = [window.setInterval(breath, MANTRA.breath * 1000)];

  // singing bowl: inharmonic partials, long decay, slow beating
  const bowl = () => {
    if (ctx.state !== "running") return;
    const t = ctx.currentTime;
    for (const [mul, v, dec] of [[1, 0.09, 9], [2.71, 0.05, 6], [5.12, 0.025, 4], [8.2, 0.012, 2.5]] as const) {
      for (const beat of [0, 0.6]) {
        const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = R * 2.25 * mul + beat;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
        o.connect(g); g.connect(bus); o.start(t); o.stop(t + dec + 0.1);
      }
    }
  };
  setTimeout(bowl, 2500);
  timers.push(window.setInterval(bowl, MANTRA.bowlEvery * 1000));
  mantra = { ctx, out, timers };
}

export function stopMantra() {
  if (mantra) {
    const m = mantra;
    m.out.gain.cancelScheduledValues(m.ctx.currentTime);
    m.out.gain.setTargetAtTime(0, m.ctx.currentTime, 0.8);
    setTimeout(() => { if (store.get().mode.kind !== "meditation") m.ctx.suspend(); }, 4000);
  }
  if (roomWasOn && store.get().music) {
    if (audio) audio.play(); else startSynth();
  }
}

function impulse(ctx: AudioContext, seconds: number) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.5);
  }
  return b;
}
