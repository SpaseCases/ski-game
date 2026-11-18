import { CONFIG } from '../config.ts';
import type { AudioEngine } from './engine.ts';
import { burst, lowpass, noiseBuffer, rng, tone } from './synth.ts';

// The shot's sound (milestone 25, the developer's powers): a seeded recipe
// like synth.ts's, rendered once in an OfflineAudioContext the first time
// the developer aims (never for anyone else: only the developer's chunk
// has it). A sharp crack, the boom under it, then the report coming back
// off the mountains: two echoes, each later, softer and duller.

/** Its own seed, so no other recipe changes. */
const SEED = 2501;
const SECONDS = 2.8;
const RATE = 32000;

let buffer: AudioBuffer | null = null;
let making: Promise<void> | null = null;

/** Renders the shot (once); safe to call every aim. */
export function prepareShot(): void {
  making ??= render().then(
    (b) => {
      buffer = b;
    },
    (err: unknown) => console.warn('The shot could not be made:', err),
  );
}

/** Plays the shot on the game's bus (silent while the game waits), at the game's speed. */
export function playShot(engine: AudioEngine): void {
  const ctx = engine.ctx;
  if (!ctx || ctx.state !== 'running' || !buffer) return;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = engine.pitch;
  const g = ctx.createGain();
  g.gain.value = CONFIG.dev.shot.gain;
  src.connect(g).connect(engine.game);
  src.start();
}

async function render(): Promise<AudioBuffer> {
  const S = CONFIG.dev.shot;
  const ctx = new OfflineAudioContext(1, Math.ceil(SECONDS * RATE), RATE);
  const r = rng(SEED);
  const white = noiseBuffer(ctx, 'white', 2, SEED + 11);
  const brown = noiseBuffer(ctx, 'brown', 2, SEED + 13);
  // The dry report goes straight out and into the echoes.
  const dry = ctx.createGain();
  dry.connect(ctx.destination);
  for (const [delay, gain, cut] of [
    [S.echo, S.echoGain, 1800],
    [S.echo * 2.3, S.echoGain * 0.45, 900],
  ] as const) {
    const d = ctx.createDelay(SECONDS);
    d.delayTime.value = delay;
    const g = ctx.createGain();
    g.gain.value = gain;
    dry.connect(d).connect(g).connect(lowpass(ctx, ctx.destination, cut));
  }
  // The crack: a very short, bright burst.
  burst(ctx, dry, r, { noise: white, decay: 0.012, gain: 1, type: 'highpass', freq: 1800, q: 0.5 });
  burst(ctx, dry, r, { noise: white, decay: 0.03, gain: 0.6, type: 'bandpass', freq: 3200, freq1: 900, q: 0.8 });
  // The boom: low noise and a falling thump.
  burst(ctx, dry, r, { noise: brown, decay: 0.11, gain: 1.1, type: 'lowpass', freq: 420, freq1: 120, q: 0.7 });
  tone(ctx, dry, { f0: 90, f1: 38, glide: 0.2, decay: 0.09, gain: 0.8 });
  // The tail rolling away.
  burst(ctx, dry, r, { noise: brown, t: 0.04, attack: 0.03, decay: 0.35, gain: 0.25, type: 'lowpass', freq: 260, q: 0.6 });
  const out = await ctx.startRendering();
  const d = out.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]!));
  const k = peak > 0 ? 0.9 / peak : 1;
  // Normalized to 0.9, faded out over the last 50 ms.
  const fade = Math.round(0.05 * RATE);
  for (let i = 0; i < d.length; i++) d[i] = d[i]! * k * Math.min(1, (d.length - i) / fade);
  return out;
}
