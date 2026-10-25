import { CONFIG } from '../config.ts';
import { WEATHERS, type WeatherId } from '../core/weather.ts';
import { brakeTarget, carveTarget, railTarget, slideTarget, windTarget, type Target } from './riding.ts';
import { noiseBuffer, renderLoop, renderShot, SHOT_IDS, type LoopId, type NoiseId, type ShotId } from './synth.ts';

// Dev only (parkLaps.audio.renderWavs()): renders every sound to a WAV
// file, as loud as the game plays it with both sliders at 100%, and saves
// it through the dev server into .playwright-mcp/audio/ (gitignored), so
// the sounds can be listened to outside the game. The one-shots and loops
// are the very buffers the game plays; the continuous sounds are played
// through scripted rides (speed, edge, air, gusts) on the same voices and
// target functions the game uses.

const RATE = 44100;

/** Renders everything and saves it; resolves to the files written. */
export async function renderWavs(): Promise<string[]> {
  const written: string[] = [];
  const save = async (name: string, buf: AudioBuffer): Promise<void> => {
    const res = await fetch(`/__audio-wav?name=${encodeURIComponent(name)}`, { method: 'POST', body: encodeWav(buf) });
    if (!res.ok) throw new Error(`Saving ${name} failed: ${res.status}`);
    written.push(name);
  };
  const shots = new Map<ShotId, AudioBuffer>();
  for (const id of SHOT_IDS) {
    const buf = await renderShot(id, CONFIG.audio.shotRate);
    shots.set(id, buf);
    await save(`shot-${id}.wav`, await gained(buf, CONFIG.audio.shots[id].gain));
  }
  const loops = new Map<LoopId, AudioBuffer>();
  for (const id of ['crowd', 'town', 'lift', 'metal', 'wood'] as const) loops.set(id, await renderLoop(id, CONFIG.audio.loopRate));
  for (const [name, seconds, build] of demos(shots, loops)) await save(`${name}.wav`, await render(seconds, build));
  return written;
}

type Build = (s: Scene) => void;

/** What a demo plays with: the context, its output, and the game's noise. */
interface Scene {
  ctx: OfflineAudioContext;
  out: AudioNode;
  noise: (id: NoiseId) => AudioBuffer;
}

async function render(seconds: number, build: Build): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(1, Math.ceil(seconds * RATE), RATE);
  const cache = new Map<NoiseId, AudioBuffer>();
  const ids: readonly NoiseId[] = ['white', 'pink', 'brown', 'scrape'];
  const noise = (id: NoiseId): AudioBuffer => {
    let b = cache.get(id);
    if (!b) cache.set(id, (b = noiseBuffer(ctx, id, CONFIG.audio.noiseSeconds, 101 + ids.indexOf(id))));
    return b;
  };
  build({ ctx, out: ctx.destination, noise });
  return ctx.startRendering();
}

/** A one-shot at its game gain. */
function gained(buf: AudioBuffer, gain: number): Promise<AudioBuffer> {
  return render(buf.duration, ({ ctx, out }) => shot(ctx, out, buf, 0, gain));
}

function shot(ctx: BaseAudioContext, out: AudioNode, buf: AudioBuffer, t: number, gain: number, rate = 1): void {
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(g).connect(out);
  src.start(t);
}

/** A continuous voice like the game's (loop, filter, gain) moved through `fn(t)` (target and pitch), 50 times a second. */
function voice(s: Scene, buf: AudioBuffer, type: BiquadFilterType, q: number, seconds: number, fn: (t: number, out: Target) => number): void {
  const { ctx } = s;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.value = 0;
  src.connect(f).connect(g).connect(s.out);
  const t0: Target = { gain: 0, freq: 1000 };
  for (let t = 0; t <= seconds; t += 0.02) {
    const pitch = fn(t, t0);
    g.gain.linearRampToValueAtTime(t0.gain, t);
    f.frequency.linearRampToValueAtTime(Math.min(20000, t0.freq * pitch), t);
    src.playbackRate.linearRampToValueAtTime(pitch, t);
  }
  src.start(0);
}

function ramp(t: number, t0: number, t1: number, a: number, b: number): number {
  const k = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
  return a + (b - a) * k;
}

/** The demos: name, seconds, and what plays. */
function demos(shots: Map<ShotId, AudioBuffer>, loops: Map<LoopId, AudioBuffer>): [string, number, Build][] {
  const a = CONFIG.audio;
  const sh = (s: Scene, id: ShotId, t: number, strength = 1, rate = 1): void => shot(s.ctx, s.out, shots.get(id)!, t, a.shots[id].gain * strength, rate);
  const carveRide = (powder: boolean): Build => (s) =>
    voice(s, s.noise('pink'), 'bandpass', a.carve.q, 10, (t, o) => {
      // Straight, speeding up to 24 m/s; then turning hard side to side at 16.
      const speed = t < 4 ? ramp(t, 0, 4, 0, 24) : ramp(t, 4, 5, 24, 16);
      const lean = t < 4 ? 0 : 0.75 * Math.sin(((t - 4) * Math.PI * 2) / 2.2);
      carveTarget(speed, lean, powder, o);
      return 1;
    });
  const rail = (metal: boolean): Build => (s) => {
    sh(s, metal ? 'railMetal' : 'railWood', 0.05, 0.8);
    voice(s, loops.get(metal ? 'metal' : 'wood')!, 'lowpass', 0.7, 4, (t, o) => {
      // On at 8 m/s; braking from 2.5 s.
      const brake = t < 2.5 ? 0 : 1;
      railTarget(t < 2.5 ? 8 : ramp(t, 2.5, 3.8, 8, 2), brake, metal, o);
      if (t > 3.8) o.gain = 0;
      return 1;
    });
  };
  const list: [string, number, Build][] = [
    ['ride-carve', 10, carveRide(false)],
    ['ride-carve-powder', 10, carveRide(true)],
    [
      'ride-brake',
      3.5,
      (s) => {
        // A hockey stop from 14 m/s.
        const speed = (t: number): number => ramp(t, 0.5, 2.8, 14, 0);
        voice(s, s.noise('pink'), 'bandpass', a.carve.q, 3.5, (t, o) => (carveTarget(speed(t), 0.3, false, o), 1));
        voice(s, s.noise('scrape'), 'bandpass', a.brake.q, 3.5, (t, o) => (brakeTarget(speed(t), t < 0.5 ? 0 : 1, o), 1));
      },
    ],
    [
      'ride-jump',
      9,
      (s) => {
        // Carving into a jump at 15 m/s, a pop, 1.6 s in the air, a hard landing, riding away.
        const air = (t: number): boolean => t >= 3 && t < 4.6;
        const speed = (t: number): number => (t < 3 ? ramp(t, 0, 3, 10, 15) : t < 4.6 ? 15 : ramp(t, 4.6, 9, 15, 12));
        voice(s, s.noise('pink'), 'bandpass', a.carve.q, 9, (t, o) => {
          carveTarget(speed(t), t < 2.5 ? 0.5 * Math.sin(t * 2.6) : 0.1, false, o);
          if (air(t)) o.gain = 0;
          return 1;
        });
        voice(s, s.noise('pink'), 'bandpass', a.wind.q, 9, (t, o) => (windTarget(speed(t), air(t), o), 1));
        weatherBed(s, 'bluebird', 9);
        sh(s, 'pole', 0.3);
        sh(s, 'pole', 1.0);
        sh(s, 'pop', 3, 0.9);
        sh(s, 'landHard', 4.6, 0.75);
      },
    ],
    [
      'ride-wind',
      9,
      (s) => {
        // Speeding up on the snow, then 3 s in the air, then down again.
        const air = (t: number): boolean => t >= 4.5 && t < 7.5;
        voice(s, s.noise('pink'), 'bandpass', a.wind.q, 9, (t, o) => (windTarget(t < 4.5 ? ramp(t, 0, 4.5, 5, 30) : 28, air(t), o), 1));
        voice(s, s.noise('pink'), 'bandpass', a.carve.q, 9, (t, o) => {
          carveTarget(t < 4.5 ? ramp(t, 0, 4.5, 5, 30) : 28, 0.1, false, o);
          if (air(t)) o.gain = 0;
          return 1;
        });
      },
    ],
    ['rail-metal', 4, rail(true)],
    ['rail-other', 4, rail(false)],
    [
      'bail-slide',
      3,
      (s) => {
        sh(s, 'bail', 0);
        voice(s, s.noise('pink'), 'bandpass', a.carve.q, 3, (t, o) => (slideTarget(ramp(t, 0, 2.2, 14, 0), o), 1));
      },
    ],
    [
      'slowmo',
      8,
      (s) => {
        // A pop and a landing over a carve at full speed, then the same in slow motion (half speed: an octave down).
        const pitch = (t: number): number => (t < 4 ? 1 : 0.5);
        voice(s, s.noise('pink'), 'bandpass', a.carve.q, 8, (t, o) => (carveTarget(16, 0.4, false, o), pitch(t)));
        sh(s, 'pop', 0.5);
        sh(s, 'landSoft', 1.6);
        sh(s, 'pop', 4.5, 1, 0.5);
        sh(s, 'landSoft', 6.7, 1, 0.5);
      },
    ],
    // The crowd close by (full), and cheering a landing at 5 s.
    ['place-crowd', 12, (s) => loop(s, loops.get('crowd')!, a.crowd.gain, 12, 8000)],
    [
      'place-crowd-cheer',
      9,
      (s) => {
        loop(s, loops.get('crowd')!, a.crowd.gain, 9, 8000);
        sh(s, 'cheer', 3);
      },
    ],
    [
      'place-crowd-jeer',
      9,
      (s) => {
        loop(s, loops.get('crowd')!, a.crowd.gain, 9, 8000);
        sh(s, 'jeer', 3);
      },
    ],
    [
      'place-lift-reactions',
      9,
      (s) => {
        // Under a lift's cable: its riders cheer a landing at 1.5 s, then heckle a crash at 5 s.
        loop(s, loops.get('lift')!, a.lift.gain, 9, 3900);
        sh(s, 'liftCheer', 1.5);
        sh(s, 'bail', 5, 0.7);
        sh(s, 'liftJeer', 5.4);
      },
    ],
    ['place-town', 12, (s) => loop(s, loops.get('town')!, a.town.gain, 12, 8000)],
    ['place-lift', 12, (s) => loop(s, loops.get('lift')!, a.lift.gain * a.lift.station, 12, 3900)],
  ];
  for (const w of WEATHERS) list.push([`weather-${w}`, 14, (s) => weatherBed(s, w, 14)]);
  return list;
}

/** A place's loop at `gain`, low-passed at `freq`. */
function loop(s: Scene, buf: AudioBuffer, gain: number, seconds: number, freq: number): void {
  voice(s, buf, 'lowpass', 0.7, seconds, (_t, o) => {
    o.gain = gain;
    o.freq = freq;
    return 1;
  });
}

/** A weather's ambience, its howl following the snow effects' gusts (render/snowFx.ts, gust()). */
function weatherBed(s: Scene, id: WeatherId, seconds: number): void {
  const w = CONFIG.audio.weather[id];
  const gusty = CONFIG.weather[id].fx.gust;
  voice(s, s.noise('brown'), 'lowpass', 0.7, seconds, (_t, o) => {
    o.gain = w.bed;
    o.freq = w.bedFreq;
    return 1;
  });
  voice(s, s.noise('pink'), 'bandpass', w.q, seconds, (t, o) => {
    const g = gusty * 0.6 * Math.sin(t * 0.7) * Math.sin(t * 0.23 + 1);
    o.gain = w.howl * Math.max(0, 1 + w.gustGain * g);
    o.freq = w.howlFreq * (1 + w.gustFreq * g);
    return 1;
  });
}

/** 16-bit mono PCM WAV. */
function encodeWav(buf: AudioBuffer): ArrayBuffer {
  const d = buf.getChannelData(0);
  const n = d.length;
  const out = new ArrayBuffer(44 + n * 2);
  const v = new DataView(out);
  const text = (at: number, s: string): void => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, buf.sampleRate, true);
  v.setUint32(28, buf.sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, d[i]!)) * 32767, true);
  return out;
}
