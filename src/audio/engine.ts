import { CONFIG } from '../config.ts';
import { LOOP_IDS, noiseBuffer, renderLoop, renderShot, SHOT_IDS, type LoopId, type NoiseId, type ShotId } from './synth.ts';

// The sound engine: one AudioContext, made (or resumed) only on the first
// key press or click, never before (browsers block sound until then, and
// CLAUDE.md asks for silence until the player does something). Everything
// plays through a master gain and an effects gain, which the Settings
// sliders and mute drive. Under the effects gain, the game's sounds have a
// bus of their own that fades out while the game waits (menus, the trail
// map) and back in on resume; menu clicks go round it, so they still play.
// The context is suspended while the tab is hidden.

/** Pointer and key events that count as the player doing something (and let a page start sound). */
const GESTURES = ['pointerdown', 'keydown', 'touchend', 'click'] as const;

export class AudioEngine {
  ctx: AudioContext | null = null;
  /** Master (slider and mute), then effects (slider), then the game's sounds or the menus'. */
  private master!: GainNode;
  private sfx!: GainNode;
  /** The game's sounds: silent while the game waits. */
  game!: GainNode;
  private ui!: GainNode;
  readonly shots = new Map<ShotId, AudioBuffer>();
  readonly loops = new Map<LoopId, AudioBuffer>();
  readonly noise = new Map<NoiseId, AudioBuffer>();
  /** Game speed (Slow motion): every game sound's pitch. */
  pitch = 1;
  private waiting = false;
  /** One-shots playing now (capped at CONFIG.audio.maxOneShots). */
  private playing = 0;
  private masterVolume: number;
  private sfxVolume: number;
  private muted: boolean;
  private readonly started: ((ctx: AudioContext) => void)[] = [];
  private readonly loopsMade: ((id: LoopId) => void)[] = [];
  private readonly ended = (): void => {
    this.playing--;
  };
  private readonly onGesture = (): void => this.unlock();

  constructor(masterVolume: number, sfxVolume: number, muted: boolean) {
    this.masterVolume = masterVolume;
    this.sfxVolume = sfxVolume;
    this.muted = muted;
  }

  /** Waits for the player's first key press or click (capture phase, before the menus see it). */
  attach(win: Window): void {
    for (const type of GESTURES) win.addEventListener(type, this.onGesture, true);
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  /** Calls `fn` once the context exists and the noise is made (at once, if it already is). */
  onStart(fn: (ctx: AudioContext) => void): void {
    if (this.ctx) fn(this.ctx);
    else this.started.push(fn);
  }

  /** Calls `fn` as each ambient loop is rendered (they're made in the background after the start). */
  onLoop(fn: (id: LoopId) => void): void {
    this.loopsMade.push(fn);
  }

  /** True once sound can be heard (made, running, and the tab showing). */
  get running(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  setVolume(master: number, sfx: number, muted: boolean): void {
    this.masterVolume = master;
    this.sfxVolume = sfx;
    this.muted = muted;
    this.applyVolume();
  }

  /** True while the game waits: its sounds fade out (menu clicks still play). */
  setWaiting(waiting: boolean): void {
    if (waiting === this.waiting) return;
    this.waiting = waiting;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.game.gain.cancelScheduledValues(t);
    this.game.gain.setTargetAtTime(waiting ? 0 : 1, t, CONFIG.audio.pauseFade);
  }

  /**
   * Plays a one-shot at `strength` (0..1 of its gain in CONFIG.audio.shots):
   * into `dest` if given (a panned place), else the game's bus, or the
   * menus' (`ui`, whatever the game speed). Dropped if too many are playing
   * or it isn't made yet.
   */
  play(id: ShotId, strength = 1, dest: AudioNode | null = null, ui = false): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.playing >= CONFIG.audio.maxOneShots || strength <= 0) return;
    const buffer = this.shots.get(id);
    if (!buffer) return;
    const c = CONFIG.audio.shots[id];
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = (ui ? 1 : this.pitch) * (1 + c.spread * (Math.random() * 2 - 1));
    const g = ctx.createGain();
    g.gain.value = c.gain * Math.min(1, strength);
    src.connect(g).connect(dest ?? (ui ? this.ui : this.game));
    src.onended = this.ended;
    this.playing++;
    src.start();
  }

  /** The first gesture makes the context; every gesture until it runs tries to resume it. */
  private unlock(): void {
    if (!this.ctx) this.create();
    const ctx = this.ctx!;
    if (ctx.state === 'running') {
      for (const type of GESTURES) window.removeEventListener(type, this.onGesture, true);
    } else if (!document.hidden) {
      ctx.resume().then(
        () => this.unlock(),
        () => {
          // Not allowed yet: the next gesture tries again.
        },
      );
    }
  }

  private create(): void {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.sfx = ctx.createGain();
    this.game = ctx.createGain();
    this.ui = ctx.createGain();
    this.game.gain.value = this.waiting ? 0 : 1;
    this.game.connect(this.sfx);
    this.ui.connect(this.sfx);
    this.sfx.connect(this.master).connect(ctx.destination);
    this.applyVolume();
    const a = CONFIG.audio;
    const kinds: readonly NoiseId[] = ['white', 'pink', 'brown', 'scrape'];
    kinds.forEach((k, i) => this.noise.set(k, noiseBuffer(ctx, k, a.noiseSeconds, 101 + i)));
    for (const fn of this.started.splice(0)) fn(ctx);
    void this.render();
  }

  /** Renders the one-shots, then the ambient loops, one at a time in the background. */
  private async render(): Promise<void> {
    const a = CONFIG.audio;
    try {
      for (const id of SHOT_IDS) this.shots.set(id, await renderShot(id, a.shotRate));
      for (const id of LOOP_IDS) {
        this.loops.set(id, await renderLoop(id, a.loopRate));
        for (const fn of this.loopsMade) fn(id);
      }
    } catch (err) {
      // No sound is better than no game.
      console.warn('Sound could not be made:', err);
    }
  }

  private applyVolume(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const curve = CONFIG.audio.volumeCurve;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.masterVolume ** curve, t, 0.02);
    this.sfx.gain.setTargetAtTime(this.sfxVolume ** curve, t, 0.02);
  }
}

/**
 * A continuous sound: a looping buffer through a filter and a gain (and a
 * stereo pan, for places), started once and never stopped; it's moved by
 * gliding its gain, filter and playback rate toward targets. A target is
 * only sent on when it has moved enough to matter, so a steady sound costs
 * nothing per frame.
 */
export class Voice {
  readonly src: AudioBufferSourceNode;
  readonly filter: BiquadFilterNode;
  readonly gain: GainNode;
  readonly panner: StereoPannerNode | null;
  /** The gain it's heading for (read by the dev readout). */
  level = 0;
  private freq = -1;
  private rate = -1;
  private pan = 0;
  private readonly ctx: BaseAudioContext;

  constructor(ctx: BaseAudioContext, buffer: AudioBuffer, out: AudioNode, type: BiquadFilterType, freq: number, q: number, panned = false) {
    this.ctx = ctx;
    this.src = ctx.createBufferSource();
    this.src.buffer = buffer;
    this.src.loop = true;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = type;
    this.filter.frequency.value = freq;
    this.filter.Q.value = q;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.panner = panned ? ctx.createStereoPanner() : null;
    this.src.connect(this.filter).connect(this.gain);
    if (this.panner) this.gain.connect(this.panner).connect(out);
    else this.gain.connect(out);
    // Each voice starts at its own spot in its loop, so two on the same noise don't line up.
    this.src.start(0, Math.random() * buffer.duration);
  }

  /** Heads for `gain`, a filter at `freq` Hz (times `pitch`; left alone while `gain` is 0), playing at `pitch`, panned to `pan` (-1 left .. 1 right), gliding with time constant `tau` s. */
  set(gain: number, freq: number, pitch: number, pan = 0, tau = CONFIG.audio.smooth): void {
    const t = this.ctx.currentTime;
    const eps = CONFIG.audio.epsilon;
    if (Math.abs(gain - this.level) > Math.max(0.001, eps * this.level) || (gain === 0 && this.level !== 0)) {
      this.level = gain;
      this.gain.gain.setTargetAtTime(gain, t, tau);
    }
    // Silent, the filter can stay where it is.
    const f = freq * pitch;
    if (gain > 0 && Math.abs(f - this.freq) > eps * this.freq) {
      this.freq = f;
      this.filter.frequency.setTargetAtTime(f, t, tau);
    }
    if (Math.abs(pitch - this.rate) > 0.002) {
      this.rate = pitch;
      this.src.playbackRate.setTargetAtTime(pitch, t, tau);
    }
    if (this.panner && Math.abs(pan - this.pan) > 0.02) {
      this.pan = pan;
      this.panner.pan.setTargetAtTime(pan, t, tau);
    }
  }

  /** Stops and lets go of it. */
  stop(): void {
    this.src.stop();
    this.src.disconnect();
    (this.panner ?? this.gain).disconnect();
  }
}
