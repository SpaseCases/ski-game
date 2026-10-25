import { Quaternion, Vector3 } from 'three';
import { CONFIG } from '../config.ts';
import { GRAB_ACTIONS } from '../core/input.ts';
import type { BoxStyle, RailShape, RailStyle } from '../maps/types.ts';
import type { SkierState } from './skier.ts';
import { anyCheat, configChanged, TUNING } from './tuning.ts';

// Scoring: combos of tricks with a timer (GAME_DESIGN.md, Scoring). It reads
// the skier's state after each fixed step and works out what happened from
// the change since the step before (taking off, landing, catching a rail,
// crashing), so the physics never knows it's being scored.
//
// A trick (a landed spin, flip, Lincoln loop or grab, or a rail slide) adds
// points and multiplier and tops the combo timer up; a big air with no trick
// scores and tops it up but adds no multiplier. Carving hard at speed and
// small airs add a trickle of points and slow the drain, but never top it
// up. When the timer runs out on the snow the combo is banked: its points
// times its multiplier. A crash loses it. The timer runs on sim time, so slow
// motion slows it too and the pause menu stops it.
//
// Rotation is measured from the skier's trick quaternion, step by step in
// the body's own axes (x flips, y spins, z Lincoln loops), so it counts what
// the body really turned: a carve into the lip that carries spin counts, the
// skis following the flight path doesn't.

export type ScoreEventKind = 'trick' | 'bank' | 'lost';
export type Landing = 'clean' | 'sketchy' | '';

/** Most grabs one trick names (the longest held). */
export const MAX_GRABS = 3;

export interface ScoreEvent {
  kind: ScoreEventKind;
  /** A trick: the move without its grabs ("Switch cork 720", "Rail slide", "Air"), or '' for grabs alone. */
  name: string;
  /** A trick: its grabs, indices into GRAB_ACTIONS, longest held first (grabCount of them). */
  grabs: Int16Array;
  grabCount: number;
  /** A rail or box: meters slid (0 for an air). */
  meters: number;
  /** A trick: points it added (after any repeat). */
  points: number;
  /** An air landed on the snow: clean or sketchy ('' onto a rail, or a slide). */
  landing: Landing;
  /** Landed riding switch. */
  switchOut: boolean;
  /** How many times this trick came before in the combo (0: new). */
  repeat: number;
  /** Multiplier the trick added. */
  gain: number;
  /** Banked or lost: the combo's score (its points times its multiplier). */
  total: number;
  /** Banked or lost: a cheat was on (or the tuning panel had changed a number) during the combo. */
  tainted: boolean;
}

/** Events kept for readers (the HUD): far more than one frame can make. */
const RING = 16;

interface AirTrack {
  active: boolean;
  time: number;
  /** Rotation so far (radians, signed) about each body axis, and in all. */
  flip: number;
  spin: number;
  lincoln: number;
  total: number;
  /** Seconds each grab was held. */
  grab: Float64Array;
  fromRail: boolean;
  switchTakeoff: boolean;
}

interface RailTrack {
  active: boolean;
  rail: number;
  meters: number;
  sideMeters: number;
  switchMeters: number;
  points: number;
}

export interface ScoreState {
  /** A combo is live. */
  active: boolean;
  /** Its points so far, and its multiplier so far (shown as at least 1; see comboMult). */
  base: number;
  mult: number;
  /** Seconds left on its timer. */
  timer: number;
  /** 0..1 how hard the skier is carving at speed right now (flow), live combo or not. */
  flow: number;
  /** A cheat was on (or the tuning panel had changed a number) during the live combo. */
  tainted: boolean;
  /** Events, oldest first; the newest is events[(seq - 1) % length]. */
  readonly events: readonly ScoreEvent[];
  /** Events made so far (readers keep their own count of those seen). */
  seq: number;
  readonly counts: Map<string, number>;
  readonly air: AirTrack;
  readonly rail: RailTrack;
}

export function createScore(): ScoreState {
  const events: ScoreEvent[] = [];
  for (let i = 0; i < RING; i++) {
    events.push({ kind: 'trick', name: '', grabs: new Int16Array(MAX_GRABS), grabCount: 0, meters: 0, points: 0, landing: '', switchOut: false, repeat: 0, gain: 0, total: 0, tainted: false });
  }
  return {
    active: false,
    base: 0,
    mult: 0,
    timer: 0,
    flow: 0,
    tainted: false,
    events,
    seq: 0,
    counts: new Map(),
    air: { active: false, time: 0, flip: 0, spin: 0, lincoln: 0, total: 0, grab: new Float64Array(GRAB_ACTIONS.length), fromRail: false, switchTakeoff: false },
    rail: { active: false, rail: -1, meters: 0, sideMeters: 0, switchMeters: 0, points: 0 },
  };
}

/** The live combo's multiplier: at least 1, at most CONFIG.score.multMax. */
export function comboMult(sc: ScoreState): number {
  return Math.max(1, Math.min(CONFIG.score.multMax, sc.mult));
}

/** What the live combo would bank now. */
export function comboTotal(sc: ScoreState): number {
  return Math.round(sc.base * comboMult(sc));
}

/** The event `seq` (0 for the first ever), while it's still kept. */
export function scoreEvent(sc: ScoreState, seq: number): ScoreEvent | null {
  return seq >= 0 && seq < sc.seq && seq >= sc.seq - RING ? sc.events[seq % RING]! : null;
}

/** True while a cheat is on or the tuning panel has changed a number: a combo then can't set a best. */
export function cheatsOn(): boolean {
  return anyCheat() || configChanged();
}

/** Marks the live combo as ridden with cheats (call when a cheat or the tuning panel changes). */
export function taintCombo(sc: ScoreState): void {
  if (sc.active && cheatsOn()) sc.tainted = true;
}

// Scratch, so stepping never allocates.
const qDelta = new Quaternion();
const forward = new Vector3();
const DEG = 180 / Math.PI;
/** Sliding a rail: |sin| of the skis' angle to the direction of travel past this is sideways, and cos below minus this is switch. */
const SIDEWAYS = 0.7;

/**
 * After each fixed step (`prev` the state before it, `s` after): tracks
 * airs and rails, scores what ended, and runs the combo timer.
 */
export function stepScore(sc: ScoreState, prev: SkierState, s: SkierState, rails: readonly RailShape[], dt: number): void {
  const C = CONFIG.score;
  if (s.bailed) {
    if (!prev.bailed) {
      if (sc.active) endWith(sc, 'lost');
      clearTracks(sc);
    }
    sc.flow = 0;
    return;
  }

  // Off a rail (an end, a pop, the snow rising over it): the slide scores.
  if (prev.rail >= 0 && s.rail !== prev.rail) endRail(sc, rails);
  const wasAir = !prev.grounded;
  const inAir = !s.grounded;
  if (inAir && !wasAir) beginAir(sc, prev);
  if (wasAir && sc.air.active) {
    trackAir(sc.air, prev, s, inAir ? s.grab : prev.grab, dt);
    if (!inAir) endAir(sc, s, s.rail >= 0);
  }
  if (s.rail >= 0) {
    if (prev.rail !== s.rail) beginRail(sc, s);
    trackRail(sc.rail, s, dt);
  }

  sc.flow = 0;
  if (s.grounded && s.rail < 0) {
    sc.flow = smoothstep(C.flowLeanMin, C.flowLeanFull, Math.abs(s.lean)) * smoothstep(C.flowSpeedMin, C.flowSpeedFull, s.velocity.length());
  }
  if (!sc.active) return;
  if (s.rail >= 0) return; // the timer holds on a rail
  if (inAir) {
    // Drains slower, and can't run out mid-air.
    sc.timer = Math.max(Math.min(sc.timer, C.airFloor), sc.timer - C.airDrain * dt);
    return;
  }
  sc.base += C.flowPoints * sc.flow * dt;
  sc.timer -= dt * (1 - C.flowSlow * sc.flow);
  if (sc.timer <= 0) endWith(sc, 'bank');
}

/**
 * Before a respawn or a trip back to the top: banks the live combo if the
 * skier is riding the snow, and loses it if in the air or on a rail.
 */
export function endCombo(sc: ScoreState, s: SkierState): void {
  if (sc.active) endWith(sc, s.grounded && s.rail < 0 && !s.bailed ? 'bank' : 'lost');
  clearTracks(sc);
}

/** Drops everything without a word (a new map, or scoring switched off). */
export function resetScore(sc: ScoreState): void {
  clearCombo(sc);
  clearTracks(sc);
}

function clearCombo(sc: ScoreState): void {
  sc.active = false;
  sc.base = 0;
  sc.mult = 0;
  sc.timer = 0;
  sc.flow = 0;
  sc.tainted = false;
  sc.counts.clear();
}

function clearTracks(sc: ScoreState): void {
  sc.air.active = false;
  sc.rail.active = false;
}

/** True when the skis are going backwards (switch), from the body's heading and the velocity. */
function isSwitch(s: SkierState): boolean {
  const speed = s.velocity.length();
  if (speed < 2) return false;
  forward.set(0, 0, -1).applyQuaternion(s.orient);
  return forward.dot(s.velocity) < -0.5 * speed;
}

function beginAir(sc: ScoreState, prev: SkierState): void {
  const a = sc.air;
  a.active = true;
  a.time = 0;
  a.flip = 0;
  a.spin = 0;
  a.lincoln = 0;
  a.total = 0;
  a.grab.fill(0);
  a.fromRail = prev.rail >= 0;
  a.switchTakeoff = isSwitch(prev);
}

/** One step in the air: the trick rotation's change, in body axes, and the grab held. */
function trackAir(a: AirTrack, prev: SkierState, s: SkierState, grab: number, dt: number): void {
  a.time += dt;
  if (grab >= 0 && grab < a.grab.length) a.grab[grab]! += dt;
  qDelta.copy(prev.trick).invert().multiply(s.trick);
  if (qDelta.w < 0) qDelta.set(-qDelta.x, -qDelta.y, -qDelta.z, -qDelta.w);
  const sinHalf = Math.hypot(qDelta.x, qDelta.y, qDelta.z);
  if (sinHalf < 1e-9) return;
  const angle = 2 * Math.atan2(sinHalf, qDelta.w);
  const k = angle / sinHalf;
  a.flip += qDelta.x * k;
  a.spin += qDelta.y * k;
  a.lincoln += qDelta.z * k;
  a.total += angle;
}

/** Whole steps of `step` degrees in `deg`, counting one that falls short by up to `short`. */
function steps(deg: number, step: number, short: number): number {
  return Math.floor((deg + short) / step) * step;
}

const MULTI = ['', '', 'double ', 'triple ', 'quad '];

/** The air is over (on the snow, or onto a rail): name and score its trick. */
function endAir(sc: ScoreState, s: SkierState, toRail: boolean): void {
  const C = CONFIG.score;
  const a = sc.air;
  a.active = false;

  // Rotation. Onto or off a rail it counts in 90s (a slide lands sideways).
  const railEnd = toRail || a.fromRail;
  const step = railEnd ? 90 : 180;
  const short = railEnd ? C.spinShort / 2 : C.spinShort;
  const minSpin = railEnd ? C.railSpinMin : 180;
  const spin = Math.abs(a.spin) * DEG;
  const flip = Math.abs(a.flip) * DEG;
  const lincoln = Math.abs(a.lincoln) * DEG;
  let rotation = '';
  let points = 0;
  if (spin >= flip && spin >= lincoln) {
    // Spinning: the whole rotation counts (a cork's axis is tipped off the spin's).
    const deg = steps(a.total * DEG, step, short);
    if (deg >= minSpin) {
      const cork = Math.max(flip, lincoln) >= C.corkMin;
      rotation = `${cork ? 'cork ' : ''}${deg}`;
      points = (deg / 180) * C.spinPoints * (cork ? 1 + C.corkBonus : 1);
    }
  } else {
    const flips = Math.floor(((flip >= lincoln ? flip : lincoln) + C.flipShort) / 360);
    if (flips >= 1) {
      const deg = steps(spin, step, short);
      const spun = deg >= minSpin;
      const times = MULTI[Math.min(flips, MULTI.length - 1)] ?? '';
      if (flip >= lincoln) {
        const back = a.flip > 0; // nose up
        rotation = spun ? `${times}${back ? 'rodeo' : 'misty'} ${deg}` : `${times}${back ? 'back flip' : 'front flip'}`;
        points = flips * C.flipPoints;
      } else {
        rotation = `${times}Lincoln loop${spun ? ` ${deg}` : ''}`;
        points = flips * C.lincolnPoints;
      }
      if (spun) points += (deg / 180) * C.spinPoints;
    }
  }
  if (rotation !== '') rotation += a.fromRail ? ' off' : toRail ? ' on' : '';

  // Grabs held long enough, longest first.
  const ev = nextEvent(sc);
  ev.grabCount = 0;
  for (let i = 0; i < a.grab.length; i++) {
    const t = a.grab[i]!;
    if (t < C.grabMin) continue;
    points += C.grabPoints + C.grabHoldPoints * Math.min(t, C.grabHoldMax);
    let at = ev.grabCount;
    while (at > 0 && a.grab[ev.grabs[at - 1]!]! < t) at--;
    if (at >= MAX_GRABS) continue;
    for (let j = Math.min(ev.grabCount, MAX_GRABS - 1); j > at; j--) ev.grabs[j] = ev.grabs[j - 1]!;
    ev.grabs[at] = i;
    ev.grabCount = Math.min(ev.grabCount + 1, MAX_GRABS);
  }

  const trick = rotation !== '' || ev.grabCount > 0;
  if (!trick) {
    // Onto a rail with no trick: the slide scores. A big air is a jump; a small one is flow.
    if (toRail) return;
    if (a.time < C.jumpAir) {
      if (sc.active) sc.base += C.smallAirPoints * a.time;
      return;
    }
  }

  // The landing: onto a rail is clean by catching it; on the snow, close to the limits is sketchy.
  let landing: Landing = '';
  if (!toRail) {
    const L = TUNING.landing;
    const edges = a.time >= L.edgeCheckAir || a.fromRail;
    const sketchy =
      s.landPitch > C.sketchyPitch * L.pitchMax ||
      s.landImpact > C.sketchyImpact * L.impactMax ||
      (edges && (s.landRoll > C.sketchyRoll * L.rollMax || s.landSide > C.sketchySide * L.sideMax));
    landing = sketchy ? 'sketchy' : 'clean';
  }
  const switchOut = !toRail && isSwitch(s);
  points += C.airPoints * a.time;
  if (trick && a.switchTakeoff) points *= 1 + C.switchBonus;
  if (switchOut) points *= 1 + C.switchBonus;
  points *= landing === 'clean' ? 1 + C.cleanBonus : landing === 'sketchy' ? C.sketchyScale : 1;

  const name = !trick ? 'Air' : capitalize(`${a.switchTakeoff ? 'switch ' : ''}${rotation}`);
  // The repeat key: the move and its grabs, whichever order they were held in.
  let key = name;
  for (let i = 0; i < a.grab.length; i++) if (a.grab[i]! >= C.grabMin) key += `|${GRAB_ACTIONS[i]}`;
  addTrick(sc, ev, key, name, points, trick && landing !== 'sketchy');
  ev.meters = 0;
  ev.landing = landing;
  ev.switchOut = switchOut;
}

function beginRail(sc: ScoreState, s: SkierState): void {
  const r = sc.rail;
  r.active = true;
  r.rail = s.rail;
  r.meters = 0;
  r.sideMeters = 0;
  r.switchMeters = 0;
  r.points = 0;
}

function trackRail(r: RailTrack, s: SkierState, dt: number): void {
  if (!r.active) return;
  const C = CONFIG.score;
  const m = Math.abs(s.railSpeed) * dt;
  const scored = Math.max(0, Math.min(m, C.railMax - r.meters));
  // The skis' angle to the direction of travel along the rail.
  const angle = s.railAngle + (s.railSpeed < 0 ? Math.PI : 0);
  const sideways = Math.abs(Math.sin(angle)) > SIDEWAYS;
  const sw = Math.cos(angle) < -SIDEWAYS;
  r.meters += m;
  if (sideways) r.sideMeters += m;
  if (sw) r.switchMeters += m;
  r.points += scored * C.railPoints * (sideways ? C.railSideways : 1) * (sw ? C.railSwitch : 1);
}

/** The slide in progress ("Rail slide", "Switch box 50-50"), or '' when not on a rail or not past railMin yet. */
export function liveSlide(sc: ScoreState, rails: readonly RailShape[]): string {
  const r = sc.rail;
  return r.active && r.meters >= CONFIG.score.railMin ? slideName(r, rails) : '';
}

function slideName(r: RailTrack, rails: readonly RailShape[]): string {
  const shape = rails[r.rail];
  const what = shape ? LOOK_NAMES[shape.look] : 'rail';
  const style = r.sideMeters * 2 > r.meters ? 'slide' : '50-50';
  return capitalize(`${r.switchMeters * 2 > r.meters ? 'switch ' : ''}${what} ${style}`);
}

/** What a slide on each look is called. */
const LOOK_NAMES: Record<RailStyle | BoxStyle, string> = {
  metal: 'rail',
  handrail: 'handrail',
  log: 'log',
  wood: 'box',
  ledge: 'ledge',
  bench: 'bench',
  rock: 'rock',
  stump: 'stump',
  tube: 'tube',
  table: 'table',
  barrels: 'barrel',
  spool: 'spool',
};

function endRail(sc: ScoreState, rails: readonly RailShape[]): void {
  const r = sc.rail;
  if (!r.active) return;
  r.active = false;
  const C = CONFIG.score;
  if (r.meters < C.railMin) return;
  const name = slideName(r, rails);
  const ev = nextEvent(sc);
  ev.grabCount = 0;
  addTrick(sc, ev, name, name, r.points, true);
  ev.meters = r.meters;
  ev.landing = '';
  ev.switchOut = false;
}

/** Claims the next event slot (filled by the caller). */
function nextEvent(sc: ScoreState): ScoreEvent {
  return sc.events[sc.seq % RING]!;
}

/**
 * Adds a trick to the combo (starting one if none is live): points, the
 * multiplier (`gains`: a clean trick, not a plain jump or a sketchy landing)
 * and a timer top-up, each scaled down for a repeat. Fills and publishes `ev`.
 */
function addTrick(sc: ScoreState, ev: ScoreEvent, key: string, name: string, points: number, gains: boolean): void {
  const C = CONFIG.score;
  if (!sc.active) {
    clearCombo(sc);
    sc.active = true;
  }
  if (cheatsOn()) sc.tainted = true;
  const n = sc.counts.get(key) ?? 0;
  sc.counts.set(key, n + 1);
  const f = C.repeatScale ** n;
  const pts = Math.round(points * f);
  const gain = gains && f >= C.multGainMin ? f : 0;
  sc.base += pts;
  sc.mult = Math.min(C.multMax, sc.mult + gain);
  sc.timer = Math.max(sc.timer, C.comboTime * C.repeatRefill ** n);
  ev.kind = 'trick';
  ev.name = name;
  ev.points = pts;
  ev.repeat = n;
  ev.gain = gain;
  ev.total = 0;
  ev.tainted = sc.tainted;
  sc.seq++;
}

/** Ends the live combo: banked (the timer ran out, or a respawn on the snow) or lost (a crash). */
function endWith(sc: ScoreState, kind: 'bank' | 'lost'): void {
  if (cheatsOn()) sc.tainted = true;
  const ev = nextEvent(sc);
  ev.kind = kind;
  ev.name = '';
  ev.grabCount = 0;
  ev.meters = 0;
  ev.points = 0;
  ev.landing = '';
  ev.switchOut = false;
  ev.repeat = 0;
  ev.gain = 0;
  ev.total = comboTotal(sc);
  ev.tainted = sc.tainted;
  sc.seq++;
  clearCombo(sc);
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
