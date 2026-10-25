import { CONFIG } from '../config.ts';
import type { RailShape } from '../maps/types.ts';
import { sketchyLanding } from '../sim/score.ts';
import type { SkierState } from '../sim/skier.ts';
import { AudioEngine, Voice } from './engine.ts';

// The skier's sounds. Like the snow effects, they're worked out from the
// sim's state as it changes, and the sim knows nothing of them: each sim
// step is compared with the one before for events (a pop, a landing, a
// crash, a pole plant, getting onto a rail), and each frame sets the
// continuous sounds (the carve's hiss, the brake's scrape, the wind, the
// rail under the skis) from the state as it is.

/** A continuous sound's target: its gain and its filter's frequency (Hz). */
export interface Target {
  gain: number;
  freq: number;
}

/** 0 at or under a, 1 at or over b, smooth between. */
export function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// The targets from the state, as plain functions (the dev WAV export plays them too).

/** The snow's hiss at `speed` m/s, leaning `lean` rad into the turn, in powder or not. */
export function carveTarget(speed: number, lean: number, powder: boolean, out: Target): Target {
  const c = CONFIG.audio.carve;
  const k = smooth(c.speedMin, c.speedFull, speed);
  const edge = smooth(c.edgeMin, c.edgeFull, Math.abs(lean));
  out.gain = c.gain * k * (c.edgeBase + (1 - c.edgeBase) * edge) * (powder ? c.powderGain : 1);
  out.freq = lerp(c.freqLow, c.freqHigh, k) * (1 + (c.edgeFreq - 1) * edge) * (powder ? c.powderFreq : 1);
  return out;
}

/** Tumbling along the snow in a crash at `speed`. */
export function slideTarget(speed: number, out: Target): Target {
  const c = CONFIG.audio.slide;
  out.gain = c.gain * smooth(0, c.speedFull, speed);
  out.freq = c.freq;
  return out;
}

/** Braking (`brake` 0..1) at `speed`. */
export function brakeTarget(speed: number, brake: number, out: Target): Target {
  const c = CONFIG.audio.brake;
  const k = smooth(c.speedMin, c.speedFull, speed);
  out.gain = c.gain * brake * k;
  out.freq = lerp(c.freqLow, c.freqHigh, k);
  return out;
}

/** Rushing air at `speed`, on the snow or in the air. */
export function windTarget(speed: number, air: boolean, out: Target): Target {
  const c = CONFIG.audio.wind;
  const k = smooth(c.speedMin, c.speedFull, speed);
  out.gain = k * (air ? c.air : c.ground);
  out.freq = lerp(c.freqLow, c.freqHigh, k) * (air ? c.airFreq : 1);
  return out;
}

/** Sliding a rail or box at `speed` along it, braking `brake`: metal or not. */
export function railTarget(speed: number, brake: number, metal: boolean, out: Target): Target {
  const c = CONFIG.audio.rail;
  const m = metal ? c.metal : c.other;
  const k = smooth(c.speedMin, c.speedFull, speed);
  out.gain = m.gain * k * (1 + c.brake * brake);
  out.freq = lerp(m.freqLow, m.freqHigh, k);
  return out;
}

/**
 * True for a rail that sounds like metal: a metal rail or handrail. Boxes
 * (even with metal decks: `metal` is for how they slide), logs, tubes and
 * bonk jibs sound like the other jibs.
 */
export function ringsMetal(rail: RailShape): boolean {
  return rail.kind === 'rail' && (rail.look === 'metal' || rail.look === 'handrail');
}

export class RidingSounds {
  private readonly engine: AudioEngine;
  private readonly carve: Voice;
  private readonly brake: Voice;
  private readonly wind: Voice;
  private metal: Voice | null = null;
  private wood: Voice | null = null;
  private readonly t: Target = { gain: 0, freq: 0 };
  /** Called with where a clean landing came down (for the crowd). */
  onCleanLanding: (x: number, z: number) => void = () => {};

  constructor(engine: AudioEngine, ctx: AudioContext) {
    this.engine = engine;
    const n = engine.noise;
    const out = engine.game;
    this.carve = new Voice(ctx, n.get('pink')!, out, 'bandpass', 1000, CONFIG.audio.carve.q);
    this.brake = new Voice(ctx, n.get('scrape')!, out, 'bandpass', 1000, CONFIG.audio.brake.q);
    this.wind = new Voice(ctx, n.get('pink')!, out, 'bandpass', 500, CONFIG.audio.wind.q);
    // The rails' voices wait for their loops to be made.
    engine.onLoop((id) => {
      const buf = engine.loops.get(id)!;
      if (id === 'metal') this.metal = new Voice(ctx, buf, out, 'lowpass', 4000, 0.7);
      if (id === 'wood') this.wood = new Voice(ctx, buf, out, 'lowpass', 1000, 0.7);
    });
  }

  /** One sim step from `prev` to `s`: plays what happened in it. */
  step(prev: SkierState, s: SkierState, rails: readonly RailShape[]): void {
    const e = this.engine;
    const a = CONFIG.audio;
    if (s.bailed) {
      if (!prev.bailed) e.play('bail');
      return;
    }
    // Pop: the pop was spent and the skier was thrown up off the snow (not just rolling off an edge).
    if (prev.canPop && !s.canPop && s.velocity.y - prev.velocity.y > 1) {
      e.play('pop', a.pop.min + (1 - a.pop.min) * Math.max(prev.crouch, prev.butterAmount));
    }
    if (s.landTime < prev.landTime) {
      if (s.rail >= 0) {
        this.railOn(s, rails);
      } else {
        const L = a.landing;
        const impact = s.landImpact;
        if (impact >= L.hard) e.play('landHard', 0.6 + 0.4 * smooth(L.hard, L.full, impact));
        else if (impact >= L.min) e.play('landSoft', 0.3 + 0.7 * smooth(L.min, L.hard, impact));
        if (prev.airTime >= a.cheer.minAir && !sketchyLanding(s, prev.airTime, prev.railExit)) this.onCleanLanding(s.position.x, s.position.z);
      }
    } else if (prev.rail < 0 && s.rail >= 0) {
      this.railOn(s, rails);
    }
    if (s.poleTime < prev.poleTime && s.grounded && s.rail < 0) e.play('pole');
  }

  /** Sets the continuous sounds from the skier's state `s` now (at game speed `pitch`, in powder or not). */
  update(s: SkierState, rails: readonly RailShape[], powder: boolean, pitch: number): void {
    const t = this.t;
    const speed = s.velocity.length();
    const onSnow = s.grounded && s.rail < 0 && !s.bailed;
    if (onSnow) carveTarget(speed, s.lean, powder, t);
    else if (s.bailed) slideTarget(speed, t);
    else t.gain = 0;
    this.carve.set(t.gain, t.freq, pitch);
    brakeTarget(speed, onSnow ? s.brake : 0, t);
    this.brake.set(t.gain, t.freq, pitch);
    windTarget(speed, !s.grounded && !s.bailed, t);
    this.wind.set(t.gain, t.freq, pitch, 0, 0.15);
    const rail = s.rail >= 0 ? rails[s.rail] : undefined;
    const metal = rail !== undefined && ringsMetal(rail);
    if (rail) railTarget(Math.abs(s.railSpeed), s.brake, metal, t);
    else t.gain = 0;
    this.metal?.set(metal ? t.gain : 0, t.freq, pitch, 0, 0.03);
    this.wood?.set(rail && !metal ? t.gain : 0, t.freq, pitch, 0, 0.03);
  }

  /** The gains the continuous sounds are heading for (dev readout). */
  levels(): Record<string, number> {
    return { carve: this.carve.level, brake: this.brake.level, wind: this.wind.level, railMetal: this.metal?.level ?? 0, railOther: this.wood?.level ?? 0 };
  }

  private railOn(s: SkierState, rails: readonly RailShape[]): void {
    const rail = rails[s.rail];
    const c = CONFIG.audio.railOn;
    const k = c.min + (1 - c.min) * smooth(0, c.full, Math.abs(s.railSpeed));
    this.engine.play(rail && ringsMetal(rail) ? 'railMetal' : 'railWood', k);
  }
}
