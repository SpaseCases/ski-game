import { CONFIG } from '../config.ts';
import type { AvalancheDef, Heightfield, XZ } from '../maps/types.ts';
import { buryInSlide, type SkierState } from './skier.ts';
import { heightAt } from './terrain.ts';
import { CHEATS } from './tuning.ts';

// Avalanches (milestone 21). A zone is a slope a map marks (`avalanches`):
// the ground swept by the fall lines from a line across its top. At build
// time those fall lines are traced on the snow as lanes, a point every
// LANE_STEP m, and painted into a grid of cells, each holding the lane and
// the distance down it, so finding where a rider is on a zone is one lookup.
//
// Riding onto a loaded zone's snow rolls the dice (CONFIG.avalanche.chance).
// A release cracks the slab `above` m up the fall line from the rider,
// `halfWidth` m either side; after `warning` s its front starts down every
// lane, building toward the zone's speed, runs past the zone's foot and
// slows to a stop `runout` m on. The moving snow (the `body` m behind the
// front) catches a rider on the snow, or less than the slab's depth plus
// `clearance` over it: a crash that carries them along while it runs. Each
// slide catches a rider once. With No crashes on it passes over them.
//
// The state lives on the course, like the chairlift's clock, so a respawn
// doesn't reset it; a map build starts every zone loaded. Nothing here runs
// unless the game (or a tool that asks for slides) calls stepAvalanches,
// and a map without zones has no Avalanches at all.

/** Meters between the points down a lane. */
export const LANE_STEP = 2;
/** Meters between lanes along a zone's top. */
export const LANE_ACROSS = 8;
/** Size (m) of the lookup grid's cells. */
const CELL = 4;
/** Span (m) of the slope estimate a lane follows. */
const FALL_SPAN = 6;
/** How much of its last direction a lane keeps each step (smooths it over bumps). */
const FALL_KEEP = 0.35;

/** A zone's phase: loaded (it can slide), cracked (the warning), running, or settled (reloading). */
export const LOADED = 0;
export const CRACKED = 1;
export const RUNNING = 2;
export const SETTLED = 3;

export interface AvalancheZone {
  readonly name: string;
  readonly depth: number;
  readonly speed: number;
  /** How far (m, from above) down its lanes the zone reaches, and where a slide stops (length + runout). */
  readonly length: number;
  readonly end: number;
  /** Lanes, and points per lane; x and z hold every lane's points, lane after lane. */
  readonly lanes: number;
  readonly steps: number;
  readonly x: Float32Array;
  readonly z: Float32Array;
  /** The lookup grid: its corner, size, and per cell the lane (-1: off the zone) and the point down it. */
  readonly gridX: number;
  readonly gridZ: number;
  readonly cols: number;
  readonly rows: number;
  readonly cellLane: Int16Array;
  readonly cellStep: Int16Array;

  phase: number;
  /** Seconds in this phase, and since the last release. */
  time: number;
  age: number;
  /** Releases so far: the renderer and the sound count them to notice a new one. */
  releases: number;
  /** The slab's lanes (lo to hi), where it cracked and how far its front has run (m down the lanes), and the front's speed. */
  lo: number;
  hi: number;
  crack: number;
  front: number;
  frontSpeed: number;
  /** The rider has been on this zone's snow since last off it. */
  inside: boolean;
  /** This slide has caught the rider (it won't again). */
  caught: boolean;
}

export interface Avalanches {
  zones: AvalancheZone[];
  /** The random state of the release rolls. */
  seed: number;
  /** The zone whose slide is carrying the crashed rider along, or -1. */
  carrying: number;
}

/** A map's avalanche zones built on its snow, or undefined when it has none. */
export function buildAvalanches(defs: readonly AvalancheDef[] | undefined, hf: Heightfield): Avalanches | undefined {
  if (!defs || defs.length === 0) return undefined;
  return { zones: defs.map((d) => buildZone(d, hf)), seed: CONFIG.avalanche.seed, carrying: -1 };
}

function buildZone(def: AvalancheDef, hf: Heightfield): AvalancheZone {
  const end = def.length + def.runout;
  const steps = Math.floor(end / LANE_STEP) + 1;
  // Lane starts evenly spaced along the top line.
  const top = def.top;
  let topLength = 0;
  for (let i = 1; i < top.length; i++) topLength += Math.hypot(top[i]!.x - top[i - 1]!.x, top[i]!.z - top[i - 1]!.z);
  const lanes = Math.max(2, Math.round(topLength / LANE_ACROSS) + 1);
  const x = new Float32Array(lanes * steps);
  const z = new Float32Array(lanes * steps);
  for (let l = 0; l < lanes; l++) {
    const p = alongLine(top, (topLength * l) / (lanes - 1));
    traceLane(hf, p.x, p.z, steps, x, z, l * steps);
  }
  // The grid over every lane's points.
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < x.length; i++) {
    minX = Math.min(minX, x[i]!);
    maxX = Math.max(maxX, x[i]!);
    minZ = Math.min(minZ, z[i]!);
    maxZ = Math.max(maxZ, z[i]!);
  }
  const gridX = minX - CELL;
  const gridZ = minZ - CELL;
  const cols = Math.ceil((maxX - gridX) / CELL) + 2;
  const rows = Math.ceil((maxZ - gridZ) / CELL) + 2;
  const cellLane = new Int16Array(cols * rows).fill(-1);
  const cellStep = new Int16Array(cols * rows).fill(-1);
  // Paint the strip between each pair of neighboring lanes, point by point down them.
  for (let l = 0; l + 1 < lanes; l++) {
    for (let k = 0; k + 1 < steps; k++) {
      for (const dk of [0, 0.5]) {
        const a = l * steps + k;
        const b = (l + 1) * steps + k;
        const ax = x[a]! + (x[a + 1]! - x[a]!) * dk;
        const az = z[a]! + (z[a + 1]! - z[a]!) * dk;
        const bx = x[b]! + (x[b + 1]! - x[b]!) * dk;
        const bz = z[b]! + (z[b + 1]! - z[b]!) * dk;
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / (CELL * 0.5)));
        for (let j = 0; j <= n; j++) {
          const t = j / n;
          const c = Math.floor((ax + (bx - ax) * t - gridX) / CELL);
          const r = Math.floor((az + (bz - az) * t - gridZ) / CELL);
          if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
          cellLane[r * cols + c] = t < 0.5 ? l : l + 1;
          cellStep[r * cols + c] = k;
        }
      }
    }
  }
  return {
    name: def.name,
    depth: def.depth,
    speed: def.speed,
    length: def.length,
    end,
    lanes,
    steps,
    x,
    z,
    gridX,
    gridZ,
    cols,
    rows,
    cellLane,
    cellStep,
    phase: LOADED,
    time: 0,
    age: 0,
    releases: 0,
    lo: 0,
    hi: 0,
    crack: 0,
    front: 0,
    frontSpeed: 0,
    inside: false,
    caught: false,
  };
}

/** The point `d` m along a polyline. */
function alongLine(pts: readonly XZ[], d: number): XZ {
  let left = d;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (left <= len || i === pts.length - 1) {
      const t = len > 0 ? Math.min(1, left / len) : 0;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    }
    left -= len;
  }
  return pts[0]!;
}

/** Follows the fall line from (x0, z0) for `steps` points LANE_STEP m apart (seen from above), into x and z from `at`. */
function traceLane(hf: Heightfield, x0: number, z0: number, steps: number, xs: Float32Array, zs: Float32Array, at: number): void {
  let px = x0;
  let pz = z0;
  let dx = 0;
  let dz = 0;
  for (let k = 0; k < steps; k++) {
    xs[at + k] = px;
    zs[at + k] = pz;
    const e = FALL_SPAN / 2;
    const gx = (heightAt(hf, px + e, pz) - heightAt(hf, px - e, pz)) / FALL_SPAN;
    const gz = (heightAt(hf, px, pz + e) - heightAt(hf, px, pz - e)) / FALL_SPAN;
    const g = Math.hypot(gx, gz);
    // Downhill, smoothed by the last step's direction; on the flat it carries straight on.
    let nx = g > 0.02 ? -gx / g : dx;
    let nz = g > 0.02 ? -gz / g : dz;
    if (k > 0) {
      nx = nx * (1 - FALL_KEEP) + dx * FALL_KEEP;
      nz = nz * (1 - FALL_KEEP) + dz * FALL_KEEP;
    }
    const n = Math.hypot(nx, nz) || 1;
    dx = nx / n;
    dz = nz / n;
    px += dx * LANE_STEP;
    pz += dz * LANE_STEP;
  }
}

/** The cell of zone `zone` under (x, z), or -1 off its grid or its lanes. */
export function zoneCell(zone: AvalancheZone, x: number, z: number): number {
  const c = Math.floor((x - zone.gridX) / CELL);
  const r = Math.floor((z - zone.gridZ) / CELL);
  if (c < 0 || r < 0 || c >= zone.cols || r >= zone.rows) return -1;
  const i = r * zone.cols + c;
  return zone.cellLane[i]! >= 0 ? i : -1;
}

/** The outline of a zone (its edge lanes down to its foot, and across its foot and top), for the trail map. */
export function zoneOutline(zone: AvalancheZone): XZ[] {
  const k = Math.min(zone.steps - 1, Math.round(zone.length / LANE_STEP));
  const out: XZ[] = [];
  const pt = (l: number, s: number): XZ => ({ x: zone.x[l * zone.steps + s]!, z: zone.z[l * zone.steps + s]! });
  for (let s = 0; s <= k; s += 2) out.push(pt(0, s));
  for (let l = 0; l < zone.lanes; l++) out.push(pt(l, k));
  for (let s = k; s >= 0; s -= 2) out.push(pt(zone.lanes - 1, s));
  for (let l = zone.lanes - 1; l >= 0; l--) out.push(pt(l, 0));
  return out;
}

/** A point `d` m down lane `l` (between its points), into `out`. */
export function lanePoint(zone: AvalancheZone, l: number, d: number, out: { x: number; z: number }): void {
  const f = Math.min(zone.steps - 1.001, Math.max(0, d / LANE_STEP));
  const k = Math.floor(f);
  const t = f - k;
  const i = l * zone.steps + k;
  out.x = zone.x[i]! + (zone.x[i + 1]! - zone.x[i]!) * t;
  out.z = zone.z[i]! + (zone.z[i + 1]! - zone.z[i]!) * t;
}

/** The release rolls' random numbers (mulberry32 on the course's state). */
function roll(av: Avalanches): number {
  av.seed = (av.seed + 0x6d2b79f5) | 0;
  let t = av.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Cracks zone `zone` above the rider at cell `cell`: the warning starts. */
export function releaseZone(zone: AvalancheZone, cell: number): void {
  const C = CONFIG.avalanche;
  const lane = zone.cellLane[cell]!;
  const reach = Math.round(C.halfWidth / LANE_ACROSS);
  zone.phase = CRACKED;
  zone.time = 0;
  zone.age = 0;
  zone.releases++;
  zone.lo = Math.max(0, lane - reach);
  zone.hi = Math.min(zone.lanes - 1, lane + reach);
  zone.crack = Math.max(0, zone.cellStep[cell]! * LANE_STEP - C.above);
  zone.front = zone.crack;
  zone.frontSpeed = 0;
  zone.caught = false;
}

/**
 * Notes where the skier is on every zone without rolling (a respawn, or a
 * tool placing a rider): appearing on a zone's snow isn't riding into it.
 */
export function placeInAvalanches(av: Avalanches, s: SkierState): void {
  for (const zone of av.zones) {
    const cell = zoneCell(zone, s.position.x, s.position.z);
    zone.inside = cell >= 0 && inZone(zone, cell);
  }
}

/** Whether a cell is within the zone proper (not its run-out). */
function inZone(zone: AvalancheZone, cell: number): boolean {
  return zone.cellStep[cell]! * LANE_STEP <= zone.length;
}

/**
 * One step of every zone and of the skier against them: releases, fronts
 * running and stopping, reloads, catching and carrying. Called after
 * stepSkier. Returns how many zones cracked this step.
 */
export function stepAvalanches(av: Avalanches, s: SkierState, hf: Heightfield, dt: number): number {
  const C = CONFIG.avalanche;
  let cracked = 0;
  const px = s.position.x;
  const pz = s.position.z;
  const onLift = s.lift >= 0;
  for (let zi = 0; zi < av.zones.length; zi++) {
    const zone = av.zones[zi]!;
    // The slide itself.
    if (zone.phase !== LOADED) {
      zone.time += dt;
      zone.age += dt;
      if (zone.phase === CRACKED && zone.time >= C.warning) {
        zone.phase = RUNNING;
        zone.time = 0;
      } else if (zone.phase === RUNNING) {
        // Building toward the zone's speed, then past its foot slowing to a stop at its end.
        let target = zone.speed;
        if (zone.front > zone.length) target *= Math.sqrt(Math.max(0, (zone.end - zone.front) / (zone.end - zone.length)));
        zone.frontSpeed += (target - zone.frontSpeed) * (1 - Math.exp(-dt / C.build));
        if (zone.front > zone.length) zone.frontSpeed = Math.min(zone.frontSpeed, target + 0.5);
        zone.front += zone.frontSpeed * dt;
        if (zone.front >= zone.end - 0.5) {
          zone.front = zone.end;
          zone.phase = SETTLED;
          zone.time = 0;
        }
      } else if (zone.phase === SETTLED && zone.age >= C.reload) {
        zone.phase = LOADED;
        zone.time = 0;
      }
    }
    if (onLift) continue;
    const cell = zoneCell(zone, px, pz);
    // Riding onto its snow: a roll, if it's loaded.
    if (cell < 0 || !inZone(zone, cell)) {
      zone.inside = false;
    } else if (s.grounded && !s.bailed) {
      if (!zone.inside && zone.phase === LOADED && roll(av) < C.chance) {
        releaseZone(zone, cell);
        cracked++;
      }
      zone.inside = true;
    }
    // Caught by the moving snow.
    if (zone.phase === RUNNING && !zone.caught && !s.bailed && cell >= 0 && !CHEATS.noCrashes) {
      const lane = zone.cellLane[cell]!;
      const d = zone.cellStep[cell]! * LANE_STEP;
      if (lane >= zone.lo && lane <= zone.hi && d <= zone.front + 1 && d >= zone.front - C.body && d >= zone.crack) {
        const over = s.grounded ? 0 : s.position.y - heightAt(hf, px, pz);
        if (over < zone.depth + C.clearance) {
          zone.caught = true;
          av.carrying = zi;
          const k = zone.cellStep[cell]!;
          laneDirection(zone, lane, k);
          buryInSlide(s, hf, dirX * zone.frontSpeed * C.carry, dirZ * zone.frontSpeed * C.carry);
        }
      }
    }
  }
  carry(av, s, dt);
  return cracked;
}

/** Scratch: the direction down a lane, from laneDirection. */
let dirX = 0;
let dirZ = 0;

/** The direction (into dirX, dirZ) down lane `l` at point `k`; returns the step's length. */
function laneDirection(zone: AvalancheZone, l: number, k: number): number {
  const i = l * zone.steps + Math.min(k, zone.steps - 2);
  const ex = zone.x[i + 1]! - zone.x[i]!;
  const ez = zone.z[i + 1]! - zone.z[i]!;
  const n = Math.hypot(ex, ez) || 1;
  dirX = ex / n;
  dirZ = ez / n;
  return n;
}

/** A crashed rider caught by a running slide is swept along with it until it stops (or they respawn). */
function carry(av: Avalanches, s: SkierState, dt: number): void {
  if (av.carrying < 0) return;
  const zone = av.zones[av.carrying]!;
  if (!s.bailed || zone.phase !== RUNNING) {
    av.carrying = -1;
    return;
  }
  const cell = zoneCell(zone, s.position.x, s.position.z);
  if (cell < 0) {
    av.carrying = -1;
    return;
  }
  const C = CONFIG.avalanche;
  laneDirection(zone, zone.cellLane[cell]!, zone.cellStep[cell]!);
  const k = 1 - Math.exp(-dt / C.carryEase);
  const want = zone.frontSpeed * C.carry;
  const v = s.velocity;
  v.x += (dirX * want - v.x) * k;
  v.z += (dirZ * want - v.z) * k;
}
