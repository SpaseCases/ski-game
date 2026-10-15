// Headless sim harness: loads a map and runs the real simulation with
// scripted keys, with no browser. Node 24 runs these .ts files directly,
// from the repo root:
//   node tools/sim/jumps.ts src/maps/test-slope.json
//   node tools/sim/spin720.ts
// The tools aren't part of the game build (tsconfig only covers src).

import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { CONFIG } from '../../src/config.ts';
import { ACTIONS, createInputState, type Action } from '../../src/core/input.ts';
import { buildMap, type BuiltMap } from '../../src/maps/build.ts';
import { parseMap } from '../../src/maps/loader.ts';
import type { JumpFeature } from '../../src/maps/types.ts';
import { createRun, updateRun, type RunState } from '../../src/sim/checkpoints.ts';
import { createRace, finishRace, stepRace, type RaceState } from '../../src/sim/race.ts';
import { copySkierState, createSkierState, placeSkierAt, stepSkier } from '../../src/sim/skier.ts';

export const DT = 1 / CONFIG.sim.stepHz;

/** A map built exactly as the game builds it. */
export type Sim = BuiltMap;

export function loadMap(file: string): Sim {
  return buildMap(parseMap(JSON.parse(readFileSync(file, 'utf8'))));
}

/** One skier riding a Sim, stepped by hand with the keys to hold each step. */
export class Rider {
  readonly sim: Sim;
  readonly s = createSkierState();
  readonly prev = createSkierState();
  readonly keys = createInputState();
  readonly run: RunState;
  readonly race: RaceState | null;
  /** Seconds since the last place(). */
  t = 0;
  private held = new Set<Action>();

  constructor(sim: Sim) {
    this.sim = sim;
    this.run = createRun(sim.map);
    this.race = sim.race ? createRace(sim.race) : null;
  }

  /** Stands the skier at (x, z) facing `headingDeg`, moving along the skis at `speed` m/s. */
  place(x: number, z: number, headingDeg: number, speed = 0): void {
    placeSkierAt(this.s, x, z, (headingDeg * Math.PI) / 180, this.sim.course.hf);
    this.s.velocity.copy(new Vector3(0, 0, -1).applyQuaternion(this.s.orient)).multiplyScalar(speed);
    copySkierState(this.prev, this.s);
    this.t = 0;
  }

  /** One fixed step with these actions held (presses and releases come from the change since last step). */
  step(held: readonly Action[] = []): void {
    const now = new Set(held);
    for (const a of ACTIONS) {
      const b = this.keys[a];
      b.pressed = now.has(a) && !this.held.has(a);
      b.released = !now.has(a) && this.held.has(a);
      b.held = now.has(a);
    }
    this.held = now;
    copySkierState(this.prev, this.s);
    stepSkier(this.s, this.keys, this.sim.course, DT);
    const event = updateRun(this.run, this.sim.map, this.prev.position, this.s);
    if (this.race && this.sim.race) {
      stepRace(this.race, this.sim.race, this.prev.position, this.s, DT);
      if (event === 'finish') finishRace(this.race);
    }
    this.t += DT;
  }

  get speed(): number {
    return this.s.velocity.length();
  }

  /** One line about where the skier is and what it's doing. */
  describe(): string {
    const s = this.s;
    const p = s.position;
    const state = s.bailed ? `crashed (${s.bailReason})` : s.rail >= 0 ? `on rail ${s.rail}` : s.grounded ? 'riding' : 'in the air';
    return `t=${this.t.toFixed(2)}s at (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}) ${this.speed.toFixed(1)} m/s, ${state}`;
  }
}

const DEG = Math.PI / 180;

/** Distances along a jump (m from where its takeoff starts) to its lip, knuckle, landing face and end, the way maps/shapes.ts builds it. */
export function jumpLayout(j: JumpFeature): { lip: number; knuckle: number; faceStart: number; faceEnd: number; end: number } {
  const lip = (2 * j.lipHeight) / Math.tan(j.lipAngle * DEG);
  const knuckle = lip + j.gap;
  const s = Math.tan(j.landingAngle * DEG);
  let k = j.knuckle;
  let t = j.transition;
  let face = j.landingHeight / s - (k + t) / 2;
  if (face < 0) {
    const f = (2 * j.landingHeight) / (s * (k + t));
    k *= f;
    t *= f;
    face = 0;
  }
  return { lip, knuckle, faceStart: knuckle + k, faceEnd: knuckle + k + face, end: knuckle + k + face + t };
}
