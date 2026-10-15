import { Vector3 } from 'three';
import type { FinishDef, FlagDef, Heightfield, MapDef } from '../maps/types.ts';
import { placeSkier, placeSkierAt, type SkierState } from './skier.ts';

// Checkpoints and the run from top to finish. Riding through a flag gate
// saves it; Tab saves a personal checkpoint (position, heading and speed).
// Respawning goes to whichever was saved most recently, and going back to
// the top starts a fresh run from the map's spawn.

export type CheckpointKind = 'spawn' | 'flag' | 'personal';

export interface RunState {
  /** What a respawn returns to. */
  kind: CheckpointKind;
  /** The saved flag (index into the map's flags) when kind is 'flag', else -1. */
  flag: number;
  /** Personal checkpoint: feet position, ski heading (radians) and velocity. */
  position: Vector3;
  yaw: number;
  velocity: Vector3;
  /** Per flag: ridden through since the last trip to the top. */
  passed: boolean[];
  /** Inside the finish zone since the last respawn. */
  finished: boolean;
}

/** What `updateRun` noticed this step. */
export type RunEvent = 'none' | 'flag' | 'finish';

export function createRun(map: MapDef): RunState {
  return {
    kind: 'spawn',
    flag: -1,
    position: new Vector3(),
    yaw: 0,
    velocity: new Vector3(),
    passed: map.flags.map(() => false),
    finished: false,
  };
}

/** Forgets every checkpoint and passed flag: the next respawn is the top. */
export function resetRun(run: RunState): void {
  run.kind = 'spawn';
  run.flag = -1;
  run.passed.fill(false);
  run.finished = false;
}

/** Personal checkpoints only work standing on the snow: not in the air, on a rail, or crashed. */
export function canSetPersonal(s: SkierState): boolean {
  return s.grounded && s.rail < 0 && !s.bailed;
}

export function setPersonal(run: RunState, s: SkierState): void {
  run.kind = 'personal';
  run.flag = -1;
  run.position.copy(s.position);
  run.yaw = s.yaw;
  run.velocity.copy(s.velocity);
}

/** Puts the skier at the latest checkpoint. A personal one gives back its speed too. */
export function respawnSkier(run: RunState, s: SkierState, map: MapDef, hf: Heightfield): void {
  run.finished = false;
  const flag = run.kind === 'flag' ? map.flags[run.flag] : undefined;
  if (flag) {
    placeSkier(s, flag, hf);
  } else if (run.kind === 'personal') {
    placeSkierAt(s, run.position.x, run.position.z, run.yaw, hf);
    s.velocity.copy(run.velocity);
  } else {
    placeSkier(s, map.spawn, hf);
  }
}

/**
 * Checks the step from `prev` to the skier's position for flag gates ridden
 * through and for reaching the finish. Returns what happened; a saved flag
 * is in `run.flag`.
 */
export function updateRun(run: RunState, map: MapDef, prev: Vector3, s: SkierState): RunEvent {
  if (s.bailed) return 'none';
  for (let i = 0; i < map.flags.length; i++) {
    if (run.kind === 'flag' && run.flag === i) continue;
    if (crossedGate(map.flags[i]!, prev, s.position)) {
      run.kind = 'flag';
      run.flag = i;
      run.passed[i] = true;
      return 'flag';
    }
  }
  if (!run.finished && inFinish(map.finish, s.position)) {
    run.finished = true;
    return 'finish';
  }
  return 'none';
}

/** True when the step from a to b crosses the gate's line forward, between its poles. */
function crossedGate(f: FlagDef, a: Vector3, b: Vector3): boolean {
  const h = (f.heading * Math.PI) / 180;
  const dx = -Math.sin(h);
  const dz = -Math.cos(h);
  const alongA = (a.x - f.x) * dx + (a.z - f.z) * dz;
  const alongB = (b.x - f.x) * dx + (b.z - f.z) * dz;
  if (!(alongA < 0 && alongB >= 0)) return false;
  const across = (b.x - f.x) * -dz + (b.z - f.z) * dx;
  return Math.abs(across) <= f.width / 2;
}

function inFinish(f: FinishDef, p: Vector3): boolean {
  const h = (f.heading * Math.PI) / 180;
  const dx = -Math.sin(h);
  const dz = -Math.cos(h);
  const along = (p.x - f.x) * dx + (p.z - f.z) * dz;
  const across = (p.x - f.x) * -dz + (p.z - f.z) * dx;
  return along >= 0 && along <= f.length && Math.abs(across) <= f.width / 2;
}
