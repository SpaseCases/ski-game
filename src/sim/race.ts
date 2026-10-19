import type { Vector3 } from 'three';
import { CONFIG } from '../config.ts';
import { raceWand, startFrames } from '../maps/startGates.ts';
import type { Feature, FinishDef, GateKind, Heightfield } from '../maps/types.ts';
import { smoothstep } from '../maps/terrain.ts';
import { inFinish } from './checkpoints.ts';
import { heightAt } from './terrain.ts';
import type { SkierState } from './skier.ts';

// Timed runs. A map can have several courses side by side, each with its
// own race start house and timing wand, its own gates and its own finish.
// Pushing through a course's wand starts its clock; reaching its finish
// stops it. Each gate has two sides the rider must pass between, in order:
// riding past a gate's line outside them, or skipping it, counts as a
// missed gate. A slalom gate's sides are single poles, a giant slalom
// gate's are panels strung between two poles. Both are hinged: the skier's
// body (leaning into the turn as it's drawn) knocks them out of the way, and
// they spring back. A square knock costs the skier a little speed and
// nudges them off; a pole brushed in passing just flicks aside.

/** A gate (or a wand): its middle, the direction riders cross it, its right, and half its width. */
export interface RaceLine {
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  rightX: number;
  rightZ: number;
  half: number;
}

/** One timed course. */
export interface CourseDef {
  /** Shown on the race HUD. */
  name: string;
  kind: GateKind;
  /** The start house: where the rider stands, facing `heading` (radians). Absent: gates only, no timing. */
  start?: { x: number; z: number; heading: number };
  wand?: RaceLine;
  /** Which of the map's race starts (in feature order) is its house, for drawing the wand; -1 for none. */
  house: number;
  /** Its gates: RaceDef.gates from `first`, `count` of them. */
  first: number;
  count: number;
  /** Finish zones that stop its clock. */
  finishes: FinishDef[];
}

export interface RaceDef {
  courses: CourseDef[];
  /** Every course's gates, course after course. */
  gates: RaceLine[];
  /** Per gate: 1 for a giant slalom gate (a panel each side), 0 for a slalom gate (a pole each side). */
  panel: Uint8Array;
  /** Snow height at the foot of each side (two per gate: left, then right): under the pole, or the panel's middle. */
  poleBase: Float32Array;
}

export interface RaceState {
  /** The course being timed or just finished (index into RaceDef.courses), or -1. */
  course: number;
  running: boolean;
  finished: boolean;
  /** Seconds since the wand, frozen at the finish. */
  time: number;
  missed: number;
  /** Per gate (every course's): 0 still to come, 1 passed, 2 missed. */
  gate: Uint8Array;
  /** Per course: seconds since its wand was last pushed through. */
  wandTime: Float32Array;
  /**
   * Per side (two per gate): how far its pole or panel is bent (radians, as
   * a lean toward world +X and +Z) and how fast that's changing.
   */
  bendX: Float32Array;
  bendZ: Float32Array;
  rateX: Float32Array;
  rateZ: Float32Array;
  /** Per side: 1 while the skier's body is against it. */
  touching: Uint8Array;
}

export type RaceEvent = 'none' | 'start' | 'gate' | 'missed' | 'finish';

/**
 * Builds a map's courses: a course for each name its gates and race starts
 * use (gates and a start naming none make one course too). A course's clock
 * stops at the finishes naming it, or at any finish if none do. Undefined if
 * the map has no gates and no race start.
 */
export function buildRace(features: readonly Feature[], finishes: readonly FinishDef[], hf: Heightfield): RaceDef | undefined {
  const houses = startFrames(features).filter((s) => s.style === 'race');
  const names: string[] = [];
  for (const f of features) {
    const name = f.type === 'slalom' ? f.name : f.type === 'start' && f.style === 'race' ? f.course : null;
    if (name !== null && !names.includes(name)) names.push(name);
  }
  if (names.length === 0) return undefined;

  const gates: RaceLine[] = [];
  const panel: number[] = [];
  const courses = names.map((name): CourseDef => {
    const first = gates.length;
    let kind: GateKind | undefined;
    for (const f of features) {
      if (f.type !== 'slalom' || f.name !== name) continue;
      kind ??= f.kind;
      for (const g of f.gates) {
        gates.push(line(g.x, g.z, (g.heading * Math.PI) / 180, g.width));
        panel.push(f.kind === 'giant' ? 1 : 0);
      }
    }
    const own = finishes.filter((f) => f.course === name);
    const house = houses.findIndex((s) => s.course === name);
    const course: CourseDef = {
      name: name || (kind === 'giant' ? 'Giant slalom' : 'Slalom'),
      kind: kind ?? 'slalom',
      house,
      first,
      count: gates.length - first,
      finishes: own.length > 0 ? own : [...finishes],
    };
    const s = houses[house];
    if (s) {
      const w = raceWand(s);
      course.start = { x: s.x, z: s.z, heading: s.heading };
      course.wand = line(w.x, w.z, w.heading, w.width);
    }
    return course;
  });

  const def: RaceDef = { courses, gates, panel: Uint8Array.from(panel), poleBase: new Float32Array(gates.length * 2) };
  for (let i = 0; i < gates.length * 2; i++) {
    const g = gates[i >> 1]!;
    const across = sideOffset(def, i);
    def.poleBase[i] = heightAt(hf, g.x + g.rightX * across, g.z + g.rightZ * across);
  }
  return def;
}

/** How far (m) to the gate's right side `i` stands (negative: left): its pole, or its panel's middle. */
export function sideOffset(def: RaceDef, i: number): number {
  const g = def.gates[i >> 1]!;
  const out = def.panel[i >> 1] === 1 ? g.half + CONFIG.giantSlalom.panelWidth / 2 : g.half;
  return (i & 1) === 0 ? -out : out;
}

function line(x: number, z: number, heading: number, width: number): RaceLine {
  return {
    x,
    z,
    dirX: -Math.sin(heading),
    dirZ: -Math.cos(heading),
    rightX: Math.cos(heading),
    rightZ: -Math.sin(heading),
    half: width / 2,
  };
}

export function createRace(def: RaceDef): RaceState {
  const sides = def.gates.length * 2;
  return {
    course: -1,
    running: false,
    finished: false,
    time: 0,
    missed: 0,
    gate: new Uint8Array(def.gates.length),
    wandTime: new Float32Array(def.courses.length).fill(Infinity),
    bendX: new Float32Array(sides),
    bendZ: new Float32Array(sides),
    rateX: new Float32Array(sides),
    rateZ: new Float32Array(sides),
    touching: new Uint8Array(sides),
  };
}

/** Clears the clock and the gates, ready for the next push through a wand. */
export function resetRace(race: RaceState): void {
  race.course = -1;
  race.running = false;
  race.finished = false;
  race.time = 0;
  race.missed = 0;
  race.gate.fill(0);
}

/** Stops the clock at the finish; the course's gates never reached count as missed. */
export function finishRace(race: RaceState, def: RaceDef): void {
  const course = def.courses[race.course];
  if (!race.running || !course) return;
  race.running = false;
  race.finished = true;
  missUpTo(race, course.first, course.first + course.count);
}

/**
 * One step: the clocks, the wands, gates passed or missed between `prev` and
 * the skier's position, the finish, and the poles and panels knocked aside
 * where the skier hits them (which slows and nudges the skier).
 */
export function stepRace(race: RaceState, def: RaceDef, prev: Vector3, s: SkierState, dt: number): RaceEvent {
  let event: RaceEvent = 'none';
  for (let c = 0; c < race.wandTime.length; c++) race.wandTime[c]! += dt;
  if (race.running) race.time += dt;
  const p = s.position;
  if (!s.bailed && !race.running && !race.finished) {
    for (let c = 0; c < def.courses.length; c++) {
      const wand = def.courses[c]!.wand;
      // Only through the start house's door: its line runs on across the whole slope.
      if (!wand || crossed(wand, prev, p) !== 1) continue;
      resetRace(race);
      race.course = c;
      race.running = true;
      race.wandTime[c] = 0;
      event = 'start';
      break;
    }
  }
  const course = race.running ? def.courses[race.course] : undefined;
  if (course && !s.bailed) {
    const end = course.first + course.count;
    for (let i = course.first; i < end; i++) {
      if (race.gate[i] !== 0) continue;
      const result = crossed(def.gates[i]!, prev, p);
      if (result === 0) continue;
      // Anything before this gate that's still open was skipped.
      missUpTo(race, course.first, i);
      race.gate[i] = result;
      if (result === 2) race.missed++;
      event = result === 1 ? 'gate' : 'missed';
    }
    for (let f = 0; f < course.finishes.length; f++) {
      if (!inFinish(course.finishes[f]!, p)) continue;
      finishRace(race, def);
      event = 'finish';
      break;
    }
  }
  bendSides(race, def, s, dt);
  return event;
}

function missUpTo(race: RaceState, from: number, end: number): void {
  for (let i = from; i < end; i++) {
    if (race.gate[i] !== 0) continue;
    race.gate[i] = 2;
    race.missed++;
  }
}

/** 0 if the step from a to b doesn't cross the line forward; 1 through it, between its ends; 2 past it, outside them. */
function crossed(g: RaceLine, a: Vector3, b: Vector3): number {
  const alongA = (a.x - g.x) * g.dirX + (a.z - g.z) * g.dirZ;
  const alongB = (b.x - g.x) * g.dirX + (b.z - g.z) * g.dirZ;
  if (!(alongA < 0 && alongB >= 0)) return 0;
  const across = (b.x - g.x) * g.rightX + (b.z - g.z) * g.rightZ;
  return Math.abs(across) <= g.half ? 1 : 2;
}

/** Heights (m up the body from the feet) where it's checked against poles and panels: knees, hips and chest. */
const BODY = [0.35, 0.8, 1.25] as const;
/** Where those parts of the body are this step (world x, z and y). */
const bodyX = new Float64Array(BODY.length);
const bodyZ = new Float64Array(BODY.length);
const bodyY = new Float64Array(BODY.length);
/** Inside this distance (m) of the line the body travels along, a hit is square: it costs the full knock. */
const SQUARE = 0.03;

/**
 * Places the body for this step the way render/skierView.ts draws it: part
 * of the lean into a turn tilts the whole body from the feet and the rest
 * moves the hips inside (more of it tilts the body in a crouch), and a
 * hockey stop leans away from the skid with the body swung round. Carving
 * hard, the chest is well inside the feet.
 */
function placeBody(s: SkierState): void {
  const r = CONFIG.render;
  const lean = s.lean + s.brake * r.brakeLean * s.brakeSide;
  const legShare = s.grounded ? (1 - r.leanBodyShare) * (1 - (1 - r.crouchAngulation) * s.crouch) : 0;
  const bodyLean = lean * (1 - legShare);
  const yaw = s.yaw + s.brake * r.brakeTwist * s.brakeSide;
  // The skier's left: the inside of a left turn (lean > 0).
  const leftX = -Math.cos(yaw);
  const leftZ = Math.sin(yaw);
  const tilt = Math.sin(bodyLean);
  const up = Math.cos(bodyLean);
  for (let k = 0; k < BODY.length; k++) {
    const h = BODY[k]!;
    const inside = tilt * h + r.hipShift * (lean - bodyLean) * Math.min(1, h / BODY[1]);
    bodyX[k] = s.position.x + leftX * inside;
    bodyZ[k] = s.position.z + leftZ * inside;
    bodyY[k] = s.position.y + up * h;
  }
}

/**
 * How square a hit is, 0 to 1, from how far (m) the thing hit stands off the
 * line the body is travelling along: dead ahead is a full knock; out in the
 * last `graze` meters of the reach it's only brushed aside.
 */
function squareness(offLine: number, reach: number, graze: number): number {
  return 1 - smoothstep(SQUARE, Math.max(SQUARE + 0.01, reach - graze), offLine);
}

/** Bends every gate's sides: poles and panels, whichever course they're on and whether or not it's being timed. */
function bendSides(race: RaceState, def: RaceDef, s: SkierState, dt: number): void {
  placeBody(s);
  for (let i = 0; i < def.gates.length * 2; i++) {
    if (def.panel[i >> 1] === 1) bendPanel(race, def, i, s, dt);
    else bendPole(race, def, i, s, dt);
  }
}

/**
 * A pole is a damped spring hinged at the snow. Where the skier's body (the
 * knees, hips and chest, clipReach wide, leaning as drawn) runs into one,
 * it's pushed out to the edge of the body at once, so it never passes
 * through. How hard it whips on, and what the knock costs the skier (up to
 * clipSlow of speed, and a clipPush away from the pole), depends on how
 * square the hit is: a pole brushed with a shoulder or a shin in passing
 * costs nothing and only flicks aside.
 */
function bendPole(race: RaceState, def: RaceDef, i: number, s: SkierState, dt: number): void {
  const c = CONFIG.slalom;
  const v = s.velocity;
  const g = def.gates[i >> 1]!;
  const across = sideOffset(def, i);
  const px = g.x + g.rightX * across;
  const pz = g.z + g.rightZ * across;
  let bx = race.bendX[i] ?? 0;
  let bz = race.bendZ[i] ?? 0;
  let rx = race.rateX[i] ?? 0;
  let rz = race.rateZ[i] ?? 0;

  // The part of the body nearest the pole, where the pole is at its height (it leans by its bend there).
  const base = def.poleBase[i] ?? 0;
  let d = Infinity;
  let k = -1;
  let rise = 0;
  let dx = 0;
  let dz = 0;
  for (let j = 0; j < BODY.length; j++) {
    const up = bodyY[j]! - base;
    if (up < 0.1 || up > c.poleHeight) continue;
    const ex = px + bx * up - bodyX[j]!;
    const ez = pz + bz * up - bodyZ[j]!;
    const e = Math.hypot(ex, ez);
    if (e >= d) continue;
    d = e;
    k = j;
    rise = up;
    dx = ex;
    dz = ez;
  }
  const touching = !s.bailed && k >= 0 && d < c.clipReach;
  if (touching) {
    // Away from the body (along the skier's travel when dead center).
    const speed = Math.hypot(v.x, v.z);
    const ux = d > 1e-4 ? dx / d : v.x / Math.max(speed, 1e-4);
    const uz = d > 1e-4 ? dz / d : v.z / Math.max(speed, 1e-4);
    // Lean it out to the edge of the body so it never passes through.
    bx = (bodyX[k]! + ux * c.clipReach - px) / rise;
    bz = (bodyZ[k]! + uz * c.clipReach - pz) / rise;
    const hit = squareness(speed > 0.5 ? Math.abs(dx * v.z - dz * v.x) / speed : d, c.clipReach, c.grazeWidth);
    const whip = Math.max(speed * c.kick * (0.25 + 0.75 * hit), rx * ux + rz * uz);
    rx = ux * whip;
    rz = uz * whip;
    if (race.touching[i] === 0) knock(s, c.clipSlow * hit, -ux * c.clipPush * hit, -uz * c.clipPush * hit);
  }
  race.touching[i] = touching ? 1 : 0;
  rx += (-c.stiffness * bx - c.damping * rx) * dt;
  rz += (-c.stiffness * bz - c.damping * rz) * dt;
  bx += rx * dt;
  bz += rz * dt;
  const bend = Math.hypot(bx, bz);
  if (bend > c.maxBend) {
    bx *= c.maxBend / bend;
    bz *= c.maxBend / bend;
  }
  race.bendX[i] = bx;
  race.bendZ[i] = bz;
  race.rateX[i] = rx;
  race.rateZ[i] = rz;
}

/**
 * A panel stands across the gate's line, its two poles hinged at the snow,
 * so it only tips forward or back (along the gate's direction), as one
 * damped spring. Where the skier's body (as for a pole) runs into it, it's
 * tipped out to the edge of the body at once. Running into its face is a
 * full knock: up to clipSlow of speed, and a clipPush toward its nearer end
 * so the skier slides off it. Catching an end pole costs less the more
 * glancing it is, and brushing one in passing costs nothing.
 */
function bendPanel(race: RaceState, def: RaceDef, i: number, s: SkierState, dt: number): void {
  const c = CONFIG.giantSlalom;
  const pole = CONFIG.slalom.poleHeight;
  const half = c.panelWidth / 2;
  const v = s.velocity;
  const g = def.gates[i >> 1]!;
  const side = (i & 1) === 0 ? -1 : 1;
  const offset = sideOffset(def, i);
  const px = g.x + g.rightX * offset;
  const pz = g.z + g.rightZ * offset;
  // Its tip toward the gate's direction (radians), and how fast that's changing.
  let b = (race.bendX[i] ?? 0) * g.dirX + (race.bendZ[i] ?? 0) * g.dirZ;
  let r = (race.rateX[i] ?? 0) * g.dirX + (race.rateZ[i] ?? 0) * g.dirZ;

  // The part of the body nearest the panel: how far ahead of it (at that height), and how far out past its ends.
  const base = def.poleBase[i] ?? 0;
  let d = Infinity;
  let k = -1;
  let rise = 0;
  let along = 0;
  let across = 0;
  let past = 0;
  for (let j = 0; j < BODY.length; j++) {
    const up = bodyY[j]! - base;
    if (up < 0.1 || up > pole) continue;
    const a = (bodyX[j]! - px) * g.dirX + (bodyZ[j]! - pz) * g.dirZ;
    const w = ((bodyX[j]! - px) * g.rightX + (bodyZ[j]! - pz) * g.rightZ) * side;
    const out = Math.max(0, Math.abs(w) - half);
    const e = Math.hypot(a - b * up, out);
    if (e >= d) continue;
    d = e;
    k = j;
    rise = up;
    along = a;
    across = w;
    past = out;
  }
  const touching = !s.bailed && k >= 0 && d < c.clipReach;
  if (touching) {
    // Tipped away from the body (downhill when it comes from above), out to the edge of it.
    const away = along - b * rise < 0 ? 1 : -1;
    b = (along + away * Math.sqrt(c.clipReach * c.clipReach - past * past)) / rise;
    const speed = Math.hypot(v.x, v.z);
    // Square into its face, or as glancing as the line of travel past the end pole it caught.
    let hit = 1;
    if (past > 0 && speed > 0.5) {
      const end = (across >= 0 ? half : -half) * side;
      const ex = px + g.rightX * end - bodyX[k]!;
      const ez = pz + g.rightZ * end - bodyZ[k]!;
      hit = squareness(Math.abs(ex * v.z - ez * v.x) / speed, c.clipReach, c.grazeWidth);
    }
    r = away * Math.max(Math.abs(v.x * g.dirX + v.z * g.dirZ) * c.kick * (0.25 + 0.75 * hit), away * r);
    if (race.touching[i] === 0) {
      const push = (across >= 0 ? 1 : -1) * side * c.clipPush * hit;
      knock(s, c.clipSlow * hit, g.rightX * push, g.rightZ * push);
    }
  }
  race.touching[i] = touching ? 1 : 0;
  r += (-c.stiffness * b - c.damping * r) * dt;
  b += r * dt;
  b = Math.max(-c.maxBend, Math.min(c.maxBend, b));
  race.bendX[i] = b * g.dirX;
  race.bendZ[i] = b * g.dirZ;
  race.rateX[i] = r * g.dirX;
  race.rateZ[i] = r * g.dirZ;
}

/** The first moment of a knock: the skier loses `slow` m/s and is pushed by (pushX, pushZ) m/s. */
function knock(s: SkierState, slow: number, pushX: number, pushZ: number): void {
  const v = s.velocity;
  const total = v.length();
  if (total > 1e-3) v.multiplyScalar(Math.max(0, total - slow) / total);
  v.x += pushX;
  v.z += pushZ;
}
