// Every sound in the game, made from nothing: noise and oscillators shaped
// by filters and envelopes. The one-shots (pop, landings, clank, cheer,
// chimes, clicks) and the long ambient loops (crowd, town, lift) are
// rendered once at startup in an OfflineAudioContext into buffers, so
// playing one costs a buffer source and a gain. The noise buffers that
// feed the continuous voices (carve, wind, rail, weather) are filled here
// in plain JS. A seeded random keeps every render the same, so the dev WAV
// export (audio/wav.ts) is what the game plays.

export type ShotId =
  | 'pop'
  | 'landSoft'
  | 'landHard'
  | 'bail'
  | 'pole'
  | 'railMetal'
  | 'railWood'
  | 'cheer'
  | 'jeer'
  | 'liftCheer'
  | 'liftJeer'
  | 'bank'
  | 'best'
  | 'lost'
  | 'click'
  | 'tick';
export type LoopId = 'crowd' | 'town' | 'lift' | 'metal' | 'wood';
export type NoiseId = 'white' | 'pink' | 'brown' | 'scrape';

export type Rng = () => number;

/** A small seeded random (mulberry32): 0 <= r() < 1. */
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A buffer of looping noise: white, pink (softer highs), brown (a rumble), or scrape (white noise in gritty bursts). */
export function noiseBuffer(ctx: BaseAudioContext, kind: NoiseId, seconds: number, seed: number): AudioBuffer {
  const n = Math.round(seconds * ctx.sampleRate);
  // A little extra, folded back over the start so the loop has no seam.
  const f = Math.min(n >> 3, Math.round(0.05 * ctx.sampleRate));
  const total = n + f;
  const d = new Float32Array(total);
  const r = rng(seed);
  if (kind === 'white') {
    for (let i = 0; i < total; i++) d[i] = r() * 2 - 1;
  } else if (kind === 'pink') {
    // Paul Kellet's filter.
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < total; i++) {
      const w = r() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
    }
  } else if (kind === 'brown') {
    let last = 0;
    for (let i = 0; i < total; i++) {
      last = (last + 0.02 * (r() * 2 - 1)) / 1.02;
      d[i] = last;
    }
  } else {
    // Grains: little bursts at random, each dying in a few ms, over a thin hiss.
    const rate = 260 / ctx.sampleRate;
    const fall = Math.exp(-1 / (0.004 * ctx.sampleRate));
    let grit = 0;
    for (let i = 0; i < total; i++) {
      if (r() < rate) grit += r() * r();
      grit *= fall;
      d[i] = (r() * 2 - 1) * (0.3 + Math.min(1.5, grit));
    }
  }
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const out = buf.getChannelData(0);
  fold(d, n, f, out);
  removeDc(out);
  normalizeRms(out, 0.3);
  return buf;
}

/** How a buffer is made: its length, and the graph that plays into `out` from time 0. */
interface Recipe {
  seconds: number;
  build(ctx: OfflineAudioContext, out: AudioNode, r: Rng, noise: Noise): void;
}

/** Noise for recipes, made at the render's own rate. */
interface Noise {
  white: AudioBuffer;
  pink: AudioBuffer;
  brown: AudioBuffer;
}

/** Renders a one-shot: normalized to a peak of 0.9. */
export async function renderShot(id: ShotId, sampleRate: number, seed = 1): Promise<AudioBuffer> {
  const recipe = SHOTS[id];
  const buf = await renderRecipe(recipe, recipe.seconds, sampleRate, seed);
  const d = buf.getChannelData(0);
  normalizePeak(d, 0.9);
  fadeTail(d, Math.round(0.01 * sampleRate));
  return buf;
}

/** Renders an ambient loop: `fade` s longer, then folded so its end runs into its start without a seam. */
export async function renderLoop(id: LoopId, sampleRate: number, seed = 1): Promise<AudioBuffer> {
  const recipe = LOOPS[id];
  const fade = 0.5;
  const long = await renderRecipe(recipe, recipe.seconds + fade, sampleRate, seed);
  const n = Math.round(recipe.seconds * sampleRate);
  const f = Math.round(fade * sampleRate);
  const src = long.getChannelData(0);
  const buf = new AudioBuffer({ length: n, sampleRate, numberOfChannels: 1 });
  const d = buf.getChannelData(0);
  fold(src, n, f, d);
  removeDc(d);
  normalizeRms(d, 0.2);
  return buf;
}

async function renderRecipe(recipe: Recipe, seconds: number, sampleRate: number, seed: number): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(1, Math.ceil(seconds * sampleRate), sampleRate);
  const noise: Noise = {
    white: noiseBuffer(ctx, 'white', 2, seed + 11),
    pink: noiseBuffer(ctx, 'pink', 2, seed + 12),
    brown: noiseBuffer(ctx, 'brown', 2, seed + 13),
  };
  recipe.build(ctx, ctx.destination, rng(seed), noise);
  return ctx.startRendering();
}

// ------------------------------------------------------------------ helpers

/** An envelope on `param`: up to `peak` in `attack` s from `t`, then a fall with time constant `decay`. */
function env(param: AudioParam, t: number, attack: number, peak: number, decay: number): void {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + attack);
  param.setTargetAtTime(0, t + attack, decay);
}

interface ToneOpts {
  type?: OscillatorType;
  /** Start and end frequency (Hz), sliding over `glide` s (exponentially). */
  f0: number;
  f1?: number;
  glide?: number;
  t?: number;
  attack?: number;
  decay: number;
  gain: number;
}

/** An oscillator note with a sliding pitch and a plucked envelope. */
function tone(ctx: BaseAudioContext, out: AudioNode, o: ToneOpts): void {
  const t = o.t ?? 0;
  const osc = ctx.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.f0, t);
  if (o.f1 !== undefined) osc.frequency.exponentialRampToValueAtTime(o.f1, t + (o.glide ?? o.decay * 3));
  const g = ctx.createGain();
  env(g.gain, t, o.attack ?? 0.002, o.gain, o.decay);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + (o.attack ?? 0.002) + o.decay * 7);
}

interface BurstOpts {
  noise: AudioBuffer;
  t?: number;
  attack?: number;
  decay: number;
  gain: number;
  type?: BiquadFilterType;
  freq: number;
  /** End frequency, sliding over the burst. */
  freq1?: number;
  q?: number;
}

/** A burst of filtered noise. */
function burst(ctx: BaseAudioContext, out: AudioNode, r: Rng, o: BurstOpts): void {
  const t = o.t ?? 0;
  const src = ctx.createBufferSource();
  src.buffer = o.noise;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = o.type ?? 'bandpass';
  f.frequency.setValueAtTime(o.freq, t);
  if (o.freq1 !== undefined) f.frequency.exponentialRampToValueAtTime(o.freq1, t + o.decay * 4);
  f.Q.value = o.q ?? 1;
  const g = ctx.createGain();
  env(g.gain, t, o.attack ?? 0.002, o.gain, o.decay);
  src.connect(f).connect(g).connect(out);
  // Start somewhere new in the noise each time.
  src.start(t, r() * (o.noise.duration - 0.1));
  src.stop(t + (o.attack ?? 0.002) + o.decay * 7);
}

/** A low-pass in front of `out`, for a whole recipe or part of one. */
function lowpass(ctx: BaseAudioContext, out: AudioNode, freq: number, q = 0.7): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = freq;
  f.Q.value = q;
  f.connect(out);
  return f;
}

/** A vowel's first two formants (Hz), picked from. */
const VOWELS: readonly (readonly [number, number])[] = [
  [730, 1090], // ah
  [530, 1840], // eh
  [390, 1990], // ih
  [570, 840], // aw
  [440, 1020], // oo-ish
  [660, 1720], // a
  [490, 1350], // uh
];

interface TalkOpts {
  start: number;
  end: number;
  /** Voice pitch (Hz) range: each talker gets one within it. */
  pitch: [number, number];
  gain: number;
  /** Syllables per second. */
  rate: number;
  /** Chance of a pause between phrases, and how long (s). */
  pause: [number, number];
}

/**
 * One talker: a buzzy voice (a sawtooth with a wandering pitch) through two
 * formant filters that jump from vowel to vowel, cut into syllables and
 * phrases. Words don't come through; a few together make a murmur.
 */
function talker(ctx: BaseAudioContext, out: AudioNode, r: Rng, o: TalkOpts): void {
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  const base = o.pitch[0] + (o.pitch[1] - o.pitch[0]) * r();
  const f1 = ctx.createBiquadFilter();
  const f2 = ctx.createBiquadFilter();
  f1.type = f2.type = 'bandpass';
  f1.Q.value = 5;
  f2.Q.value = 7;
  const g = ctx.createGain();
  g.gain.value = 0;
  const g2 = ctx.createGain();
  g2.gain.value = 0.6;
  osc.connect(f1).connect(g);
  osc.connect(f2).connect(g2).connect(g);
  g.connect(out);
  let t = o.start + r() * 0.4;
  let phrase = 3 + Math.floor(r() * 6);
  while (t < o.end) {
    const len = (0.6 + 0.8 * r()) / o.rate;
    const [a, b] = VOWELS[Math.floor(r() * VOWELS.length)]!;
    const shift = 0.9 + 0.25 * r();
    f1.frequency.setTargetAtTime(a * shift, t, 0.02);
    f2.frequency.setTargetAtTime(b * shift, t, 0.025);
    // Pitch: a little up at the start of a syllable, falling through it.
    const p = base * (0.9 + 0.25 * r());
    osc.frequency.setTargetAtTime(p * 1.08, t, 0.01);
    osc.frequency.setTargetAtTime(p * 0.94, t + len * 0.3, len * 0.5);
    const peak = o.gain * (0.5 + 0.5 * r());
    g.gain.setTargetAtTime(peak, t, 0.012);
    g.gain.setTargetAtTime(0, t + len * 0.75, 0.02);
    t += len;
    if (--phrase <= 0) {
      phrase = 3 + Math.floor(r() * 7);
      if (r() < 0.85) t += o.pause[0] + (o.pause[1] - o.pause[0]) * r();
    }
  }
  osc.start(o.start);
  osc.stop(o.end + 0.2);
}

// ---------------------------------------------------------------- one-shots

const SHOTS: Record<ShotId, Recipe> = {
  // Skis popping off the snow: a soft thump, a puff of snow and the skis' click.
  pop: {
    seconds: 0.35,
    build(ctx, out, r, n) {
      tone(ctx, out, { f0: 150, f1: 60, glide: 0.08, decay: 0.035, gain: 0.8 });
      burst(ctx, out, r, { noise: n.pink, decay: 0.03, gain: 0.9, freq: 1600, freq1: 900, q: 0.8 });
      burst(ctx, out, r, { noise: n.white, t: 0.004, decay: 0.006, gain: 0.35, type: 'highpass', freq: 3500 });
    },
  },
  // Touching down: a muffled thump into the snow and a short crunch.
  landSoft: {
    seconds: 0.5,
    build(ctx, out, r, n) {
      tone(ctx, out, { f0: 100, f1: 45, glide: 0.12, decay: 0.06, gain: 0.9 });
      burst(ctx, out, r, { noise: n.pink, decay: 0.07, gain: 0.8, type: 'lowpass', freq: 1100, freq1: 500 });
      crunch(ctx, out, r, n, 0.005, 0.12, 0.35, 2200);
    },
  },
  // Slamming down: a deep thud, both skis clacking, and a long crunch.
  landHard: {
    seconds: 0.85,
    build(ctx, out, r, n) {
      tone(ctx, out, { f0: 85, f1: 34, glide: 0.2, decay: 0.11, gain: 1 });
      tone(ctx, out, { type: 'triangle', f0: 180, f1: 70, glide: 0.1, decay: 0.05, gain: 0.35 });
      burst(ctx, out, r, { noise: n.pink, decay: 0.12, gain: 1, type: 'lowpass', freq: 1500, freq1: 400 });
      burst(ctx, out, r, { noise: n.white, decay: 0.008, gain: 0.45, freq: 3300, q: 2 });
      burst(ctx, out, r, { noise: n.white, t: 0.022, decay: 0.008, gain: 0.35, freq: 3000, q: 2 });
      crunch(ctx, out, r, n, 0.01, 0.28, 0.5, 1900);
    },
  },
  // A crash: the body and skis thumping down again and again, and the slide.
  bail: {
    seconds: 1.8,
    build(ctx, out, r, n) {
      const hits = [0, 0.2, 0.43, 0.68, 0.98];
      hits.forEach((t, i) => {
        const k = 1 - i * 0.16;
        const at = t + 0.04 * r();
        tone(ctx, out, { t: at, f0: 95 - 8 * i, f1: 40, glide: 0.12, decay: 0.07, gain: 0.9 * k });
        burst(ctx, out, r, { noise: n.pink, t: at, decay: 0.08, gain: 0.7 * k, type: 'lowpass', freq: 1200, freq1: 450 });
        if (i === 1 || i === 3) burst(ctx, out, r, { noise: n.white, t: at + 0.03, decay: 0.01, gain: 0.3 * k, freq: 2800, q: 3 });
      });
      // The slide: a swish that dies away.
      const src = ctx.createBufferSource();
      src.buffer = n.pink;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 0.9;
      f.frequency.setValueAtTime(1500, 0);
      f.frequency.exponentialRampToValueAtTime(600, 1.6);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, 0);
      g.gain.linearRampToValueAtTime(0.35, 0.15);
      g.gain.setTargetAtTime(0, 0.5, 0.35);
      src.connect(f).connect(g).connect(out);
      src.start(0, r());
      src.stop(1.8);
    },
  },
  // A pole planted in the snow: a small crisp "tsk".
  pole: {
    seconds: 0.15,
    build(ctx, out, r, n) {
      burst(ctx, out, r, { noise: n.white, decay: 0.02, gain: 0.8, freq: 3200, q: 1.5 });
      tone(ctx, out, { f0: 260, f1: 160, decay: 0.012, gain: 0.3 });
    },
  },
  // Onto a metal rail: a clank with a ring (out-of-tune partials, like a struck pipe).
  railMetal: {
    seconds: 1,
    build(ctx, out, r, n) {
      const f0 = 410;
      const parts: readonly [number, number, number][] = [
        [1, 0.32, 0.5],
        [2.76, 0.2, 0.35],
        [5.4, 0.11, 0.25],
        [8.93, 0.06, 0.16],
      ];
      for (const [m, d, g] of parts) tone(ctx, out, { f0: f0 * m, decay: d, gain: g });
      burst(ctx, out, r, { noise: n.white, decay: 0.006, gain: 0.6, type: 'highpass', freq: 2200 });
      tone(ctx, out, { f0: 120, f1: 60, decay: 0.03, gain: 0.5 });
    },
  },
  // Onto a box, log or any jib that isn't metal: a hollow knock.
  railWood: {
    seconds: 0.35,
    build(ctx, out, r, n) {
      tone(ctx, out, { f0: 190, f1: 150, decay: 0.05, gain: 0.7 });
      tone(ctx, out, { f0: 420, decay: 0.03, gain: 0.35 });
      tone(ctx, out, { f0: 710, decay: 0.018, gain: 0.2 });
      burst(ctx, out, r, { noise: n.pink, decay: 0.025, gain: 0.6, type: 'lowpass', freq: 1800 });
      tone(ctx, out, { f0: 95, f1: 50, decay: 0.04, gain: 0.5 });
    },
  },
  // The crowd going up: voices rising to a shout, whistles and clapping.
  cheer: {
    seconds: 3.2,
    build(ctx, out, r, n) {
      const bus = lowpass(ctx, out, 3800);
      // Shouts: "woo" and "yeah", pitches rising.
      for (let i = 0; i < 14; i++) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        const p = 160 + 180 * r();
        const t = 0.02 + 0.25 * r();
        osc.frequency.setValueAtTime(p * 0.8, t);
        osc.frequency.exponentialRampToValueAtTime(p * (1.3 + 0.3 * r()), t + 0.35);
        osc.frequency.setTargetAtTime(p * 1.1, t + 0.6, 0.6);
        const [a, b] = VOWELS[i % 2 === 0 ? 0 : 4]!;
        const f1 = ctx.createBiquadFilter();
        f1.type = 'bandpass';
        f1.frequency.value = a * (0.9 + 0.2 * r());
        f1.Q.value = 4;
        const f2 = ctx.createBiquadFilter();
        f2.type = 'bandpass';
        f2.frequency.value = b * (0.9 + 0.2 * r());
        f2.Q.value = 6;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.25, t + 0.15);
        g.gain.setTargetAtTime(0.12, t + 0.5, 0.3);
        g.gain.setTargetAtTime(0, t + 0.9 + 0.8 * r(), 0.35);
        osc.connect(f1).connect(g);
        osc.connect(f2).connect(g);
        g.connect(bus);
        osc.start(t);
        osc.stop(3.2);
      }
      // A couple of whistles.
      for (let i = 0; i < 2; i++) {
        const t = 0.25 + 0.5 * r();
        const osc = ctx.createOscillator();
        const f = 1700 + 600 * r();
        osc.frequency.setValueAtTime(f, t);
        osc.frequency.exponentialRampToValueAtTime(f * 1.45, t + 0.2);
        osc.frequency.exponentialRampToValueAtTime(f * 1.2, t + 0.55);
        const g = ctx.createGain();
        env(g.gain, t, 0.04, 0.07, 0.25);
        osc.connect(g).connect(bus);
        osc.start(t);
        osc.stop(t + 1.5);
      }
      // Clapping: claps at random, thick at first, thinning out.
      let t = 0.15;
      while (t < 2.9) {
        const k = Math.max(0, 1 - t / 3);
        burst(ctx, bus, r, { noise: n.white, t, decay: 0.012, gain: 0.25 * k * (0.5 + r()), freq: 1100 + 900 * r(), q: 1.2 });
        t += (0.015 + 0.03 * r()) / (0.3 + k);
      }
    },
  },
  // The crowd seeing a crash: a long "ooooh" sinking, a few boos, a laugh.
  jeer: {
    seconds: 3,
    build(ctx, out, r) {
      const bus = lowpass(ctx, out, 3000);
      for (let i = 0; i < 14; i++) {
        const p = 200 + 140 * r();
        shout(ctx, bus, r, { t: 0.03 + 0.2 * r(), len: 1.1 + 0.6 * r(), f0: p, f1: p * 0.6, from: OO, to: AW, gain: 0.22 });
      }
      for (let i = 0; i < 3; i++) {
        const p = 110 + 40 * r();
        const t = 0.8 + 0.3 * r();
        shout(ctx, bus, r, { t, len: 0.45, f0: p, f1: p * 0.9, from: BOO, to: BOO, gain: 0.25 });
        shout(ctx, bus, r, { t: t + 0.6, len: 0.5, f0: p * 0.98, f1: p * 0.85, from: BOO, to: BOO, gain: 0.22 });
      }
      laugh(ctx, bus, 1.3 + 0.3 * r(), 240 + 40 * r(), 5, 0.22);
    },
  },
  // Riders on a chairlift overhead seeing a clean landing: a few whoops, a whistle, muffled mitten claps.
  liftCheer: {
    seconds: 2.4,
    build(ctx, out, r, n) {
      const bus = lowpass(ctx, out, 3400);
      for (let i = 0; i < 4; i++) {
        const p = (i % 2 === 0 ? 170 : 260) + 60 * r();
        shout(ctx, bus, r, { t: 0.02 + 0.3 * r(), len: 0.5 + 0.3 * r(), f0: p * 0.85, f1: p * 1.45, from: OO, to: AH, gain: 0.3 });
      }
      // A wolf whistle: up, then down.
      const t = 0.5 + 0.2 * r();
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(1500, t);
      osc.frequency.exponentialRampToValueAtTime(2600, t + 0.18);
      osc.frequency.setValueAtTime(2300, t + 0.32);
      osc.frequency.exponentialRampToValueAtTime(1300, t + 0.7);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.08, t + 0.04);
      g.gain.setValueAtTime(0.08, t + 0.18);
      g.gain.linearRampToValueAtTime(0, t + 0.24);
      g.gain.linearRampToValueAtTime(0.08, t + 0.34);
      g.gain.setTargetAtTime(0, t + 0.55, 0.06);
      osc.connect(g).connect(bus);
      osc.start(t);
      osc.stop(t + 1);
      // Mittens clapping: dull.
      let c = 0.2;
      while (c < 1.8) {
        burst(ctx, bus, r, { noise: n.pink, t: c, decay: 0.02, gain: 0.3 * (1 - c / 2), type: 'lowpass', freq: 700 });
        c += 0.09 + 0.08 * r();
      }
    },
  },
  // Riders on a chairlift overhead seeing a crash: an "ohhh", a boo and a laugh.
  liftJeer: {
    seconds: 2.4,
    build(ctx, out, r) {
      const bus = lowpass(ctx, out, 3400);
      for (let i = 0; i < 2; i++) {
        const p = 180 + 120 * r();
        shout(ctx, bus, r, { t: 0.03 + 0.15 * r(), len: 0.9, f0: p * 1.1, f1: p * 0.65, from: OH, to: AW, gain: 0.3 });
      }
      const b = 115 + 30 * r();
      shout(ctx, bus, r, { t: 0.7, len: 0.55, f0: b, f1: b * 0.88, from: BOO, to: BOO, gain: 0.3 });
      laugh(ctx, bus, 1.0 + 0.2 * r(), 230 + 50 * r(), 6, 0.28);
    },
  },
  // A combo banked: two soft bell notes, a fifth apart.
  bank: {
    seconds: 1,
    build(ctx, out) {
      tone(ctx, out, { f0: 880, attack: 0.004, decay: 0.22, gain: 0.5 });
      tone(ctx, out, { f0: 1760, attack: 0.004, decay: 0.08, gain: 0.08 });
      tone(ctx, out, { t: 0.07, f0: 1318.5, attack: 0.004, decay: 0.28, gain: 0.45 });
      tone(ctx, out, { t: 0.07, f0: 2637, attack: 0.004, decay: 0.08, gain: 0.06 });
    },
  },
  // A new best combo: a bright rising arpeggio.
  best: {
    seconds: 1.6,
    build(ctx, out) {
      const notes = [659.3, 880, 1108.7, 1318.5, 1760];
      notes.forEach((f, i) => {
        tone(ctx, out, { t: i * 0.07, f0: f, attack: 0.004, decay: 0.25 + i * 0.03, gain: 0.4 });
        tone(ctx, out, { t: i * 0.07, f0: f * 2, attack: 0.004, decay: 0.08, gain: 0.07 });
      });
    },
  },
  // A combo lost: a muffled falling note.
  lost: {
    seconds: 0.6,
    build(ctx, out) {
      const lp = lowpass(ctx, out, 700);
      tone(ctx, lp, { type: 'triangle', f0: 240, f1: 140, glide: 0.25, attack: 0.01, decay: 0.12, gain: 0.8 });
      tone(ctx, lp, { type: 'triangle', f0: 180, f1: 105, glide: 0.25, attack: 0.01, decay: 0.12, gain: 0.5 });
    },
  },
  // Menus: a soft wooden tap, like knocking on a trail sign.
  click: {
    seconds: 0.08,
    build(ctx, out, r, n) {
      tone(ctx, out, { f0: 1050, f1: 820, decay: 0.008, gain: 0.6 });
      tone(ctx, out, { f0: 420, decay: 0.01, gain: 0.35 });
      burst(ctx, out, r, { noise: n.pink, decay: 0.005, gain: 0.4, freq: 2500, q: 1.5 });
    },
  },
  tick: {
    seconds: 0.03,
    build(ctx, out) {
      tone(ctx, out, { f0: 2100, decay: 0.003, gain: 0.6 });
    },
  },
};

/** Vowels for shouts: first and second formants (Hz). */
const OO: readonly [number, number] = [440, 1020];
const OH: readonly [number, number] = [500, 900];
const AW: readonly [number, number] = [570, 840];
const AH: readonly [number, number] = [730, 1090];
const BOO: readonly [number, number] = [300, 870];

interface ShoutOpts {
  t: number;
  len: number;
  /** Pitch (Hz) at the start and the end. */
  f0: number;
  f1: number;
  /** Vowel at the start and the end. */
  from: readonly [number, number];
  to: readonly [number, number];
  gain: number;
}

/** One voice calling out: a buzzy voice through a vowel's formants, the pitch and vowel gliding over `len` s. */
function shout(ctx: BaseAudioContext, out: AudioNode, r: Rng, o: ShoutOpts): void {
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(o.f0, o.t);
  osc.frequency.exponentialRampToValueAtTime(o.f1, o.t + o.len);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, o.t);
  g.gain.linearRampToValueAtTime(o.gain, o.t + Math.min(0.1, o.len * 0.25));
  g.gain.setTargetAtTime(o.gain * 0.7, o.t + o.len * 0.4, o.len * 0.3);
  g.gain.setTargetAtTime(0, o.t + o.len, 0.08);
  const shift = 0.92 + 0.16 * r();
  for (const [k, q, level] of [
    [0, 5, 1],
    [1, 7, 0.6],
  ] as const) {
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = q;
    f.frequency.setValueAtTime(o.from[k] * shift, o.t);
    f.frequency.linearRampToValueAtTime(o.to[k] * shift, o.t + o.len);
    const fg = ctx.createGain();
    fg.gain.value = level;
    osc.connect(f).connect(fg).connect(g);
  }
  g.connect(out);
  osc.start(o.t);
  osc.stop(o.t + o.len + 0.6);
}

/** A laugh: `count` falling "ha"s from `t` at pitch `p`. */
function laugh(ctx: BaseAudioContext, out: AudioNode, t0: number, p: number, count: number, gain: number): void {
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 780;
  f.Q.value = 3;
  const g = ctx.createGain();
  g.gain.value = 0;
  osc.connect(f).connect(g).connect(out);
  for (let i = 0; i < count; i++) {
    const t = t0 + i * 0.15;
    osc.frequency.setValueAtTime(p - i * 12, t);
    env(g.gain, t, 0.015, gain * (1 - i * 0.12), 0.05);
  }
  osc.start(t0);
  osc.stop(t0 + count * 0.15 + 0.4);
}

/** A crunch: grains of snow breaking, thick at first and thinning, from `t` over `len` s. */
function crunch(ctx: BaseAudioContext, out: AudioNode, r: Rng, n: Noise, t: number, len: number, gain: number, freq: number): void {
  let at = t;
  while (at < t + len) {
    const k = 1 - (at - t) / len;
    burst(ctx, out, r, { noise: n.white, t: at, decay: 0.004 + 0.004 * r(), gain: gain * k * (0.4 + 0.6 * r()), freq: freq * (0.7 + 0.6 * r()), q: 1.5 });
    at += 0.006 + 0.018 * r() * (1.5 - k);
  }
}

// -------------------------------------------------------------------- loops

const LOOPS: Record<LoopId, Recipe> = {
  // Spectators: a dozen talkers at a distance, smeared together.
  crowd: {
    seconds: 6,
    build(ctx, out, r, n) {
      const lp = lowpass(ctx, out, 1700);
      // A touch of smear, as if some voices come from farther along the fence.
      const d1 = ctx.createDelay();
      d1.delayTime.value = 0.047;
      const d2 = ctx.createDelay();
      d2.delayTime.value = 0.113;
      const dg = ctx.createGain();
      dg.gain.value = 0.35;
      const bus = ctx.createGain();
      bus.connect(lp);
      bus.connect(d1).connect(dg);
      bus.connect(d2).connect(dg);
      dg.connect(lp);
      for (let i = 0; i < 12; i++) talker(ctx, bus, r, { start: 0, end: 6.6, pitch: i % 3 === 0 ? [190, 260] : [95, 150], gain: 0.25, rate: 4.5, pause: [0.3, 1.2] });
      // Shuffling feet and rustle under it.
      const src = ctx.createBufferSource();
      src.buffer = n.pink;
      src.loop = true;
      const g = ctx.createGain();
      g.gain.value = 0.02;
      src.connect(g).connect(lp);
      src.start(0);
    },
  },
  // Freeride's town: a few people nearer by, a laugh, cups and cutlery.
  town: {
    seconds: 6,
    build(ctx, out, r, n) {
      const lp = lowpass(ctx, out, 3200);
      for (let i = 0; i < 5; i++) talker(ctx, lp, r, { start: 0, end: 6.6, pitch: i % 2 === 0 ? [180, 250] : [100, 140], gain: 0.3, rate: 4.2, pause: [0.4, 1.6] });
      // A laugh: "ha-ha-ha" falling.
      laugh(ctx, lp, 2.2, 260, 5, 0.3);
      // Cups and cutlery.
      for (const t of [0.7, 1.05, 3.6, 4.4, 4.55, 5.5]) {
        const p = 2400 + 2000 * r();
        tone(ctx, lp, { t, f0: p, decay: 0.05, gain: 0.05 });
        tone(ctx, lp, { t, f0: p * 1.51, decay: 0.03, gain: 0.03 });
      }
      // A boot on the boardwalk now and then.
      for (const t of [1.6, 1.95, 4.9, 5.25]) burst(ctx, lp, r, { noise: n.pink, t, decay: 0.03, gain: 0.08, type: 'lowpass', freq: 500 });
    },
  },
  // A chairlift: the motor's drone, the cable's whirr, and a chair rattling over a tower's wheels once a loop.
  lift: {
    seconds: 5.8,
    build(ctx, out, r, n) {
      const lp = lowpass(ctx, out, 900);
      const motor = ctx.createOscillator();
      motor.type = 'sawtooth';
      motor.frequency.value = 49;
      const mf = lowpass(ctx, lp, 240, 1.5);
      const mg = ctx.createGain();
      mg.gain.value = 0.35;
      motor.connect(mg).connect(mf);
      motor.start(0);
      const hum = ctx.createOscillator();
      hum.frequency.value = 98;
      const hg = ctx.createGain();
      hg.gain.value = 0.12;
      hum.connect(hg).connect(lp);
      hum.start(0);
      // The cable's whirr, breathing slowly.
      const src = ctx.createBufferSource();
      src.buffer = n.pink;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 170;
      bp.Q.value = 2;
      const wg = ctx.createGain();
      wg.gain.value = 0.4;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 1 / 2.9;
      const lg = ctx.createGain();
      lg.gain.value = 0.15;
      lfo.connect(lg).connect(wg.gain);
      lfo.start(0);
      src.connect(bp).connect(wg).connect(lp);
      src.start(0);
      // A chair's grip over the tower's wheels: ka-chunk-chunk-chunk.
      for (let i = 0; i < 4; i++) {
        const t = 2 + i * 0.11 + 0.01 * r();
        burst(ctx, lp, r, { noise: n.white, t, decay: 0.015, gain: 0.35 - i * 0.05, freq: 800, q: 2 });
        tone(ctx, lp, { t, f0: 300, f1: 200, decay: 0.02, gain: 0.25 - i * 0.04 });
      }
    },
  },
  // A metal rail under the skis: a hiss through the rail's ringing tones.
  metal: {
    seconds: 2.5,
    build(ctx, out, r, n) {
      const bus = ctx.createGain();
      bus.connect(out);
      for (const [f, q, g] of [
        [2150, 14, 0.6],
        [3450, 11, 0.45],
        [5300, 9, 0.3],
        [7600, 4, 0.2],
      ] as const) {
        const src = ctx.createBufferSource();
        src.buffer = n.white;
        src.loop = true;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = f;
        bp.Q.value = q;
        const gg = ctx.createGain();
        gg.gain.value = g;
        src.connect(bp).connect(gg).connect(bus);
        src.start(0, r());
      }
      // Rattles: the skis chattering on the rail.
      let t = 0;
      while (t < 3) {
        burst(ctx, bus, r, { noise: n.white, t, decay: 0.004, gain: 0.15 * r(), freq: 4000, q: 2 });
        t += 0.01 + 0.04 * r();
      }
    },
  },
  // A box, log or other jib under the skis: a dull, grainy rumble.
  wood: {
    seconds: 2.5,
    build(ctx, out, r, n) {
      const src = ctx.createBufferSource();
      src.buffer = n.pink;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 520;
      bp.Q.value = 1.2;
      src.connect(bp).connect(out);
      src.start(0, r());
      const rum = ctx.createBufferSource();
      rum.buffer = n.brown;
      rum.loop = true;
      const lp = lowpass(ctx, out, 200);
      const rg = ctx.createGain();
      rg.gain.value = 1.5;
      rum.connect(rg).connect(lp);
      rum.start(0, r());
      // The grain of the boards going by.
      let t = 0;
      while (t < 3) {
        burst(ctx, out, r, { noise: n.pink, t, decay: 0.006, gain: 0.35 * r(), freq: 900 + 600 * r(), q: 2 });
        t += 0.012 + 0.03 * r();
      }
    },
  },
};

export const SHOT_IDS = Object.keys(SHOTS) as ShotId[];
export const LOOP_IDS = Object.keys(LOOPS) as LoopId[];

// ------------------------------------------------------------- buffer edits

function removeDc(d: Float32Array): void {
  let sum = 0;
  for (let i = 0; i < d.length; i++) sum += d[i]!;
  const mean = sum / d.length;
  for (let i = 0; i < d.length; i++) d[i]! -= mean;
}

/**
 * Makes `out` (n samples) a seamless loop from `src` (at least n + f): the
 * f samples past n fade out over the start while the start fades in (equal
 * power), so the end runs on into the start.
 */
function fold(src: Float32Array, n: number, f: number, out: Float32Array): void {
  out.set(src.subarray(0, n));
  for (let i = 0; i < f && i < n; i++) {
    const t = i / f;
    out[i] = src[i]! * Math.sin((t * Math.PI) / 2) + src[n + i]! * Math.cos((t * Math.PI) / 2);
  }
}

function normalizePeak(d: Float32Array, peak: number): void {
  let max = 0;
  for (let i = 0; i < d.length; i++) max = Math.max(max, Math.abs(d[i]!));
  if (max > 0) for (let i = 0; i < d.length; i++) d[i]! *= peak / max;
}

function normalizeRms(d: Float32Array, rms: number): void {
  let sum = 0;
  let max = 0;
  for (let i = 0; i < d.length; i++) {
    sum += d[i]! * d[i]!;
    max = Math.max(max, Math.abs(d[i]!));
  }
  const now = Math.sqrt(sum / d.length);
  if (now <= 0) return;
  // As loud as asked, but never clipping.
  const k = Math.min(rms / now, 0.99 / max);
  for (let i = 0; i < d.length; i++) d[i]! *= k;
}

function fadeTail(d: Float32Array, f: number): void {
  const n = d.length;
  for (let i = 0; i < f && i < n; i++) d[n - 1 - i]! *= i / f;
}
