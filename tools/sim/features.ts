// Rides at every feature on a map from a run-up along its own heading, at a
// few speeds, with the real simulation, and reports what happened: airtime,
// how hard the landing was, crashes, rails caught. Works at any heading, so
// it covers the Freeride's booters, hips, logs, roofs and plaza.
//   node tools/sim/features.ts <map.json> [kinds] [--speeds 8,12,16,20]
// Kinds (default all): jump, kicker, log, building, terrace.
// - jump: a booter or park jump, ridden straight, with no pop and a full pop.
// - kicker: one feeding a rail or box just past its lip reports whether
//   rolling off it catches; any other is a booter or a hip (air and landing).
// - log: ridden onto at its tip, along it; reports the slide and the landing off its end.
// - building: up its drift (or at its uphill wall) along its length, with and without a pop at the top.
// - terrace: across it and off its front: down the stairs, off the wall beside them, and popped onto each handrail.

import type { Action } from '../../src/core/input.ts';
import { stairRun, townFrame, framePoint } from '../../src/maps/town.ts';
import type { BuildingFeature, Feature, RailFeature, TerraceFeature } from '../../src/maps/types.ts';
import { terrainHeightAt } from '../../src/sim/terrain.ts';
import { DT, loadMap, Rider } from './harness.ts';

const args = process.argv.slice(2);
const file = args[0];
if (!file) throw new Error('Usage: node tools/sim/features.ts <map.json> [kinds] [--speeds a,b,c]');
const option = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const speedList = (option('--speeds') ?? '').split(',').filter(Boolean).map(Number);
const kinds = args.slice(1).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--speeds');
const want = (k: string): boolean => kinds.length === 0 || kinds.includes(k);
const sim = loadMap(file);
const DEG = Math.PI / 180;
let problems = 0;

interface Outcome {
  air: number;
  impact: number;
  crash: string;
  railTime: number;
  caught: boolean;
  /** Highest the feet got above the ground under them (m): on a roof, its height. */
  rise: number;
}

/**
 * Rides from (x, z) along heading `yaw` (degrees) at `speed`, steering to
 * hold that heading on the snow, until `until` says stop or `limit` s pass.
 * `pop(along)`: hold ↑ to crouch until it returns false, then release.
 */
function ride(x: number, z: number, yaw: number, speed: number, until: (along: number, r: Rider) => boolean, pop?: (along: number) => boolean, limit = 8): Outcome {
  const r = new Rider(sim);
  r.place(x, z, yaw, speed);
  const dx = -Math.sin(yaw * DEG);
  const dz = -Math.cos(yaw * DEG);
  const out: Outcome = { air: 0, impact: 0, crash: '', railTime: 0, caught: false, rise: 0 };
  let takeoff = -1;
  let held = false;
  while (r.t < limit) {
    const along = (r.s.position.x - x) * dx + (r.s.position.z - z) * dz;
    if (until(along, r)) break;
    const keys: Action[] = [];
    if (pop && r.s.grounded && pop(along)) {
      keys.push('up');
      held = true;
    } else if (held) {
      held = false;
    }
    r.step(keys);
    out.rise = Math.max(out.rise, r.s.position.y - terrainHeightAt(sim.hf, r.s.position.x, r.s.position.z));
    if (r.s.rail >= 0) {
      out.caught = true;
      out.railTime += DT;
    }
    if (r.s.bailed) {
      out.crash = r.s.bailReason;
      if (takeoff >= 0) out.air = Math.max(out.air, r.t - takeoff);
      out.impact = Math.max(out.impact, r.s.landImpact);
      break;
    }
    if (takeoff < 0 && !r.s.grounded) takeoff = r.t;
    if (takeoff >= 0 && r.s.grounded) {
      const air = r.t - takeoff - DT;
      if (air > 0.25) {
        out.air = Math.max(out.air, air);
        out.impact = Math.max(out.impact, r.s.landImpact);
      }
      takeoff = -1;
    }
  }
  return out;
}

function verdict(o: Outcome): string {
  if (o.crash) {
    problems++;
    return `CRASH (${o.crash}${o.air > 0 ? ` after ${o.air.toFixed(1)} s air` : ''}, ${o.impact.toFixed(0)} m/s)`;
  }
  const parts: string[] = [];
  if (o.caught) parts.push(`slid ${o.railTime.toFixed(1)} s`);
  if (o.air > 0) parts.push(`${o.air.toFixed(1)} s air, ${o.impact.toFixed(0)} m/s in`);
  return parts.length ? parts.join(', ') : 'no air';
}

const speeds = (fallback: number[]): number[] => (speedList.length ? speedList : fallback);
const lipOf = (h: number, angle: number): number => (2 * h) / Math.tan(angle * DEG);

/** The rail or box whose first point lies just past a kicker's lip, in line with it. */
function railAfter(k: { x: number; z: number; yaw: number; lipHeight: number; lipAngle: number }): number {
  const dx = -Math.sin(k.yaw * DEG);
  const dz = -Math.cos(k.yaw * DEG);
  const lip = lipOf(k.lipHeight, k.lipAngle);
  return sim.map.features.findIndex((f) => {
    if (f.type !== 'rail' && f.type !== 'box') return false;
    const p = f.points[0]!;
    const along = (p.x - k.x) * dx + (p.z - k.z) * dz;
    const across = (p.x - k.x) * -dz + (p.z - k.z) * dx;
    return along > lip - 0.5 && along < lip + 4 && Math.abs(across) < 1.5;
  });
}

const where = (f: { x: number; z: number }): string => `(${f.x.toFixed(0)}, ${f.z.toFixed(0)})`;
const report = (label: string, results: string[]): void => console.log(`${label}: ${results.join(' | ')}`);

sim.map.features.forEach((f: Feature, i) => {
  if (f.type === 'jump' && want('jump')) {
    const lip = lipOf(f.lipHeight, f.lipAngle);
    const results: string[] = [];
    for (const v of speeds([8, 12, 16, 20, 24])) {
      for (const pop of [false, true]) {
        const back = 25;
        const x = f.x + Math.sin(f.yaw * DEG) * back;
        const z = f.z + Math.cos(f.yaw * DEG) * back;
        const o = ride(x, z, f.yaw, v, (along) => along > back + lip + 60, pop ? (a) => a < back + lip - 0.2 : undefined);
        results.push(`${v}${pop ? ' pop' : ''}: ${verdict(o)}`);
      }
    }
    report(`${f.natural ? 'booter' : 'jump'} ${i} ${where(f)} lip ${f.lipHeight} m at ${f.lipAngle}°`, results);
  } else if (f.type === 'kicker' && want('kicker')) {
    const rail = railAfter(f);
    const lip = lipOf(f.lipHeight, f.lipAngle);
    const back = 8;
    const x = f.x + Math.sin(f.yaw * DEG) * back;
    const z = f.z + Math.cos(f.yaw * DEG) * back;
    const results: string[] = [];
    if (rail >= 0) {
      const target = sim.map.features[rail] as RailFeature;
      const len = target.points.reduce((sum, p, k, all) => (k === 0 ? 0 : sum + Math.hypot(p.x - all[k - 1]!.x, p.z - all[k - 1]!.z)), 0);
      for (const v of speeds([6, 10, 14, 18])) {
        const o = ride(x, z, f.yaw, v, (along) => along > back + lip + len + 25);
        if (!o.caught && !o.crash) problems++;
        results.push(`${v}: ${o.caught ? verdict(o) : o.crash ? verdict(o) : 'MISSED'}`);
      }
      report(`kicker ${i} ${where(f)} to ${target.type} ${rail}`, results);
    } else {
      for (const v of speeds([8, 12, 16, 20, 24])) {
        for (const pop of [false, true]) {
          const o = ride(x, z, f.yaw, v, (along) => along > back + lip + 60, pop ? (a) => a < back + lip - 0.2 : undefined);
          results.push(`${v}${pop ? ' pop' : ''}: ${verdict(o)}`);
        }
      }
      report(`${f.natural ? 'booter' : 'hip'} ${i} ${where(f)} lip ${f.lipHeight} m at ${f.lipAngle}°`, results);
    }
  } else if (f.type === 'rail' && f.style === 'log' && want('log')) {
    const a = f.points[0]!;
    const b = f.points[f.points.length - 1]!;
    const yaw = Math.atan2(-(b.x - a.x), -(b.z - a.z)) / DEG;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const back = 10;
    const results: string[] = [];
    for (const v of speeds([5, 9, 13])) {
      const x = a.x + Math.sin(yaw * DEG) * back;
      const z = a.z + Math.cos(yaw * DEG) * back;
      const o = ride(x, z, yaw, v, (along) => along > back + len + 25);
      if (!o.caught && !o.crash) problems++;
      results.push(`${v}: ${o.caught ? verdict(o) : o.crash ? verdict(o) : 'MISSED'}`);
    }
    report(`log ${i} ${where(a)} ${len.toFixed(0)} m`, results);
  } else if (f.type === 'building' && want('building') && (f.drift > 0 || f.apron > 0)) {
    // Only the ones built to be ridden: with a drift up to them or a landing below.
    rideBuilding(f, i);
  } else if (f.type === 'terrace' && want('terrace')) {
    rideTerrace(f, i);
  }
});

function rideBuilding(b: BuildingFeature, i: number): void {
  const t = townFrame(b);
  const start = b.drift > 0 ? -b.drift - 15 : -15;
  const p = framePoint(t, start, 0);
  const end = b.length + b.apron + 30;
  const results: string[] = [];
  for (const v of speeds([10, 14, 18])) {
    for (const pop of [false, true]) {
      // A pop just before the downhill eave (or a gable's ridge).
      const popAt = -start + (b.roof === 'gable' ? b.length / 2 : b.length) - 0.3;
      const o = ride(p.x, p.z, b.yaw, v, (along) => along > end - start, pop ? (a) => a > popAt - v * 0.35 && a < popAt : undefined);
      results.push(`${v}${pop ? ' pop' : ''}: ${verdict(o)}${o.rise < b.eave - 0.5 ? ` (stayed off the roof, up ${o.rise.toFixed(1)} m)` : ''}`);
    }
  }
  report(`building ${i} ${b.sign || b.style} ${b.roof} ${where(b)} eave ${b.eave} m`, results);
}

function rideTerrace(f: TerraceFeature, i: number): void {
  const t = townFrame(f);
  const end = f.length + stairRun(f) + 25;
  for (const [label, v, pop] of [
    ['stairs', 0, false],
    ['wall', f.stairs / 2 + 3, false],
    ['handrail left', -(f.stairs / 2 - 0.3), true],
    ['handrail right', f.stairs / 2 - 0.3, true],
  ] as const) {
    const results: string[] = [];
    for (const s of speeds(pop ? [7, 10, 13] : [5, 8, 12])) {
      const p = framePoint(t, -8, v);
      // Onto a handrail: pop half a second before its top end, to come down onto it.
      const popAt = 8 + f.length - 2.5 - s * 0.5;
      const o = ride(p.x, p.z, f.yaw, s, (along) => along > end + 8, pop ? (a) => a > popAt - s * 0.35 && a < popAt : undefined);
      if (pop && !o.caught && !o.crash) problems++;
      results.push(`${s}: ${pop && !o.caught && !o.crash ? 'MISSED' : verdict(o)}`);
    }
    report(`terrace ${i} ${label}`, results);
  }
}

console.log(problems === 0 ? 'no problems' : `${problems} problem${problems === 1 ? '' : 's'} (crashes or missed slides)`);
