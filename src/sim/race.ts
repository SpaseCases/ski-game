import type { Vector3 } from 'three';
import { CONFIG } from '../config.ts';
import { raceWand, startFrames } from '../maps/startGates.ts';
import type { Feature, Heightfield } from '../maps/types.ts';
import { heightAt } from './terrain.ts';
import type { SkierState } from './skier.ts';

// A timed slalom run. Pushing through the race start's timing wand starts
// the clock; the map's finish stops it. Each slalom gate is a pair of poles
// the rider must pass between, in order: riding past a gate's line outside
// its poles, or skipping it, counts as a missed gate. Poles are hinged:
// the skier's body knocks them flat out of the way, and they spring back.
// Each knock costs the skier a little speed and nudges them off the pole.

/** A gate (or the wand): its middle, the direction riders cross it, its right, and half its width. */
export interface RaceLine {
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  rightX: number;
  rightZ: number;
  half: number;
}

export interface RaceDef {
  /** The start house: where the rider stands, facing `heading` (radians). Absent: gates only, no timing. */
  start?: { x: number; z: number; heading: number };
  wand?: RaceLine;
  gates: RaceLine[];
  /** Snow height at the foot of each pole (two per gate: left, then right). */
  poleBase: Float32Array;
}

export interface RaceState {
  running: boolean;
  finished: boolean;
  /** Seconds since the wand, frozen at the finish. */
  time: number;
  missed: number;
  /** Per gate: 0 still to come, 1 passed, 2 missed. */
  gate: Uint8Array;
  /** Seconds since the wand was last pushed through. */
  wandTime: number;
  /** Per pole: how far it's bent (radians, as a lean toward world +X and +Z) and how fast that's changing. */
  bendX: Float32Array;
  bendZ: Float32Array;
  rateX: Float32Array;
  rateZ: Float32Array;
  /** Per pole: 1 while the skier's body is against it. */
  touching: Uint8Array;
}

export type RaceEvent = 'none' | 'start' | 'gate' | 'missed';

/** Builds the race from a map's race start and slalom gates; undefined if it has neither. */
export function buildRace(features: readonly Feature[], hf: Heightfield): RaceDef | undefined {
  const gates: RaceLine[] = [];
  for (const f of features) {
    if (f.type !== 'slalom') continue;
    for (const g of f.gates) gates.push(line(g.x, g.z, (g.heading * Math.PI) / 180, g.width));
  }
  const house = startFrames(features).find((s) => s.style === 'race');
  if (!house && gates.length === 0) return undefined;
  const poleBase = new Float32Array(gates.length * 2);
  gates.forEach((g, i) => {
    for (let k = 0; k < 2; k++) {
      const side = k === 0 ? -1 : 1;
      poleBase[i * 2 + k] = heightAt(hf, g.x + g.rightX * g.half * side, g.z + g.rightZ * g.half * side);
    }
  });
  const def: RaceDef = { gates, poleBase };
  if (house) {
    const w = raceWand(house);
    def.start = { x: house.x, z: house.z, heading: house.heading };
    def.wand = line(w.x, w.z, w.heading, w.width);
  }
  return def;
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
  const poles = def.gates.length * 2;
  return {
    running: false,
    finished: false,
    time: 0,
    missed: 0,
    gate: new Uint8Array(def.gates.length),
    wandTime: Infinity,
    bendX: new Float32Array(poles),
    bendZ: new Float32Array(poles),
    rateX: new Float32Array(poles),
    rateZ: new Float32Array(poles),
    touching: new Uint8Array(poles),
  };
}

/** Clears the clock and the gates, ready for the next push through the wand. */
export function resetRace(race: RaceState): void {
  race.running = false;
  race.finished = false;
  race.time = 0;
  race.missed = 0;
  race.gate.fill(0);
}

/** Stops the clock at the finish; gates never reached count as missed. */
export function finishRace(race: RaceState): void {
  if (!race.running) return;
  race.running = false;
  race.finished = true;
  missUpTo(race, race.gate.length);
}

/**
 * One step: the clock, the wand, gates passed or missed between `prev` and
 * the skier's position, and the poles knocked aside where the skier hits
 * them (which slows and nudges the skier).
 */
export function stepRace(race: RaceState, def: RaceDef, prev: Vector3, s: SkierState, dt: number): RaceEvent {
  let event: RaceEvent = 'none';
  race.wandTime += dt;
  if (race.running) race.time += dt;
  const p = s.position;
  // Only through the start house's door: its line runs on across the whole slope.
  if (!s.bailed && def.wand && !race.running && !race.finished && crossed(def.wand, prev, p) === 1) {
    resetRace(race);
    race.running = true;
    race.wandTime = 0;
    event = 'start';
  }
  if (race.running && !s.bailed) {
    for (let i = 0; i < def.gates.length; i++) {
      if (race.gate[i] !== 0) continue;
      const result = crossed(def.gates[i]!, prev, p);
      if (result === 0) continue;
      // Anything before this gate that's still open was skipped.
      missUpTo(race, i);
      race.gate[i] = result;
      if (result === 2) race.missed++;
      event = result === 1 ? 'gate' : 'missed';
    }
  }
  bendPoles(race, def, s, dt);
  return event;
}

function missUpTo(race: RaceState, end: number): void {
  for (let i = 0; i < end; i++) {
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

/**
 * Each pole is a damped spring hinged at the snow. Where the skier's body
 * (a column clipReach wide around the feet, up to the hips) runs into one,
 * it's pushed out to the edge of the body at once, whipping on at least as
 * fast as the skier is moving. The first moment of each knock slows the
 * skier by clipSlow and pushes them clipPush away from the pole.
 */
function bendPoles(race: RaceState, def: RaceDef, s: SkierState, dt: number): void {
  const c = CONFIG.slalom;
  const p = s.position;
  const v = s.velocity;
  for (let i = 0; i < def.gates.length * 2; i++) {
    const g = def.gates[i >> 1]!;
    const side = (i & 1) === 0 ? -1 : 1;
    const px = g.x + g.rightX * g.half * side;
    const pz = g.z + g.rightZ * g.half * side;
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
      if (race.touching[i] === 0) {
        const total = v.length();
        if (total > 1e-3) v.multiplyScalar(Math.max(0, total - c.clipSlow) / total);
        v.x -= ux * c.clipPush;
        v.z -= uz * c.clipPush;
      }
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
}
