import type { Vector3 } from 'three';
import { CONFIG } from '../config.ts';
import { raceWand, startFrames } from '../maps/startGates.ts';
import type { Feature, FinishDef, GateKind, Heightfield } from '../maps/types.ts';
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
// body knocks them out of the way, and they spring back. Each knock costs
// the skier a little speed and nudges them off the pole or panel.

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

/** Bends every gate's sides: poles and panels, whichever course they're on and whether or not it's being timed. */
function bendSides(race: RaceState, def: RaceDef, s: SkierState, dt: number): void {
  for (let i = 0; i < def.gates.length * 2; i++) {
    if (def.panel[i >> 1] === 1) bendPanel(race, def, i, s, dt);
    else bendPole(race, def, i, s, dt);
  }
}

/**
 * A pole is a damped spring hinged at the snow. Where the skier's body (a
 * column clipReach wide around the feet, up to the hips) runs into one,
 * it's pushed out to the edge of the body at once, whipping on at least as
 * fast as the skier is moving. The first moment of each knock slows the
 * skier by clipSlow and pushes them clipPush away from the pole.
 */
function bendPole(race: RaceState, def: RaceDef, i: number, s: SkierState, dt: number): void {
  const c = CONFIG.slalom;
  const p = s.position;
  const v = s.velocity;
  const g = def.gates[i >> 1]!;
  const across = sideOffset(def, i);
  const px = g.x + g.rightX * across;
  const pz = g.z + g.rightZ * across;
  let bx = race.bendX[i] ?? 0;
  let bz = race.bendZ[i] ?? 0;
  let rx = race.rateX[i] ?? 0;
  let rz = race.rateZ[i] ?? 0;

  // Where the pole is at the body's height (it leans by its bend there).
  const base = def.poleBase[i] ?? 0;
  const rise = Math.min(c.poleHeight, Math.max(0, s.center.y - base));
  const dx = px + bx * rise - p.x;
  const dz = pz + bz * rise - p.z;
  const d = Math.hypot(dx, dz);
  const touching = !s.bailed && p.y < base + c.poleHeight && d < c.clipReach && rise > 0.2;
  if (touching) {
    // Away from the body (along the skier's travel when dead center).
    const speed = Math.hypot(v.x, v.z);
    const ux = d > 1e-4 ? dx / d : v.x / Math.max(speed, 1e-4);
    const uz = d > 1e-4 ? dz / d : v.z / Math.max(speed, 1e-4);
    // Lean it out to the edge of the body so it never passes through.
    bx = (p.x + ux * c.clipReach - px) / rise;
    bz = (p.z + uz * c.clipReach - pz) / rise;
    const whip = Math.max(speed * c.kick, rx * ux + rz * uz);
    rx = ux * whip;
    rz = uz * whip;
    if (race.touching[i] === 0) knock(s, c.clipSlow, -ux * c.clipPush, -uz * c.clipPush);
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
 * damped spring. Where the skier's body runs into it (anywhere along its
 * width), it's tipped out to the edge of the body at once. The first moment
 * of each knock slows the skier by clipSlow and pushes them clipPush toward
 * the panel's nearer end, so they slide off it.
 */
function bendPanel(race: RaceState, def: RaceDef, i: number, s: SkierState, dt: number): void {
  const c = CONFIG.giantSlalom;
  const pole = CONFIG.slalom.poleHeight;
  const p = s.position;
  const v = s.velocity;
  const g = def.gates[i >> 1]!;
  const side = (i & 1) === 0 ? -1 : 1;
  const offset = sideOffset(def, i);
  const px = g.x + g.rightX * offset;
  const pz = g.z + g.rightZ * offset;
  // Its tip toward the gate's direction (radians), and how fast that's changing.
  let b = (race.bendX[i] ?? 0) * g.dirX + (race.bendZ[i] ?? 0) * g.dirZ;
  let r = (race.rateX[i] ?? 0) * g.dirX + (race.rateZ[i] ?? 0) * g.dirZ;

  const base = def.poleBase[i] ?? 0;
  const rise = Math.min(pole, Math.max(0, s.center.y - base));
  // The body against the panel at its height: how far ahead of it, and how far out past its ends.
  const along = (p.x - px) * g.dirX + (p.z - pz) * g.dirZ;
  const across = ((p.x - px) * g.rightX + (p.z - pz) * g.rightZ) * side;
  const ahead = along - b * rise;
  const past = Math.max(0, Math.abs(across) - c.panelWidth / 2);
  const touching = !s.bailed && p.y < base + pole && rise > 0.2 && Math.hypot(ahead, past) < c.clipReach;
  if (touching) {
    // Tipped away from the body (downhill when it comes from above), out to the edge of it.
    const away = ahead < 0 ? 1 : -1;
    b = (along + away * Math.sqrt(c.clipReach * c.clipReach - past * past)) / rise;
    const speed = Math.abs(v.x * g.dirX + v.z * g.dirZ);
    r = away * Math.max(speed * c.kick, away * r);
    if (race.touching[i] === 0) {
      const end = (across >= 0 ? 1 : -1) * side * c.clipPush;
      knock(s, c.clipSlow, g.rightX * end, g.rightZ * end);
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
