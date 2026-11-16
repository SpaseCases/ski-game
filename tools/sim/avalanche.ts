// Avalanche check (milestone 21): for every avalanche zone on a map,
//   1. rides into it from above, tucked and steering down its fall line,
//      with every roll a release, and shows the zone cracks and the rider
//      outruns the slide (the closest the front came, and whether it caught);
//      a few lanes across the zone are tried, since cliff bands stand in
//      some of them;
//   2. stands a rider still across the slope partway down and releases the
//      zone above them: they must be caught (and how soon);
//   3. the same with No crashes on: the slide must pass over them;
//   4. rides in 40 times at the real odds and counts the releases.
// A zone a tucked rider can't outrun on any lane tried, one that can't be
// set off, or a stopped rider it doesn't catch is a problem.
//   node tools/sim/avalanche.ts [map.json] [--lanes n]

import { CONFIG } from '../../src/config.ts';
import { CRACKED, LANE_STEP, LOADED, RUNNING, SETTLED, releaseZone, zoneCell, type AvalancheZone } from '../../src/sim/avalanche.ts';
import { setCheat } from '../../src/sim/tuning.ts';
import { loadMap, Rider, DT } from './harness.ts';
import type { Action } from '../../src/core/input.ts';

const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const file = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')) ?? 'src/maps/freeride.json';
const tries = Number(option('--lanes') ?? 4);
const sim = loadMap(file);
const av = sim.course.avalanches;
if (!av) {
  console.log(`${file}: no avalanche zones`);
  process.exit(0);
}
const chance = CONFIG.avalanche.chance;
let problems = 0;

const rider = new Rider(sim);
rider.avalanches = true;

function reset(): void {
  for (const z of av!.zones) {
    z.phase = LOADED;
    z.time = 0;
    z.age = 0;
    z.inside = false;
    z.caught = false;
  }
  av!.carrying = -1;
}

/** Where lane `l` of a zone starts, and the heading (degrees) of its first steps. */
function laneAt(z: AvalancheZone, l: number, k: number): { x: number; z: number; heading: number } {
  const i = l * z.steps + Math.min(k, z.steps - 2);
  const dx = z.x[i + 1]! - z.x[i]!;
  const dz = z.z[i + 1]! - z.z[i]!;
  return { x: z.x[i]!, z: z.z[i]!, heading: (Math.atan2(-dx, -dz) * 180) / Math.PI };
}

/** The rider's distance down the zone's lanes (m), or NaN off its grid. */
function along(z: AvalancheZone): number {
  const c = zoneCell(z, rider.s.position.x, rider.s.position.z);
  return c < 0 ? NaN : z.cellStep[c]! * LANE_STEP;
}

/** Keys that tuck and steer toward the fall line of zone z where the rider is (no steering in the air). */
function steer(z: AvalancheZone): Action[] {
  const keys: Action[] = ['pole'];
  const s = rider.s;
  if (!s.grounded) return [];
  const c = zoneCell(z, s.position.x, s.position.z);
  if (c < 0) return keys;
  const lane = laneAt(z, z.cellLane[c]!, z.cellStep[c]!);
  let diff = (lane.heading * Math.PI) / 180 - s.yaw;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  if (diff > 0.06) keys.push('left');
  else if (diff < -0.06) keys.push('right');
  return keys;
}

const f1 = (v: number): string => v.toFixed(1);

for (const z of av.zones) {
  console.log(`${z.name}: ${z.lanes} lanes, ${z.length.toFixed(0)} m + ${(z.end - z.length).toFixed(0)} m run-out, slab ${z.depth} m, ${z.speed} m/s`);

  // 1. Tucked, from 20 m above its top, every roll a release.
  CONFIG.avalanche.chance = 1;
  let outran = 0;
  let setOff = 0;
  const lanes = [...new Set(Array.from({ length: tries }, (_, i) => Math.round(((i + 0.5) * (z.lanes - 1)) / tries)))];
  for (const l of lanes) {
    reset();
    const start = laneAt(z, l, 0);
    const back = (start.heading * Math.PI) / 180;
    rider.place(start.x + Math.sin(back) * 20, start.z + Math.cos(back) * 20, start.heading, 8);
    let crackedAt = NaN;
    let closest = Infinity;
    let top = 0;
    let result = '';
    for (let n = 0; n < 60 / DT; n++) {
      rider.step(steer(z));
      top = Math.max(top, rider.speed);
      if (rider.cracked > 0 && Number.isNaN(crackedAt)) crackedAt = along(z);
      const d = along(z);
      if (z.phase === RUNNING && !Number.isNaN(d)) closest = Math.min(closest, d - z.front);
      if (rider.s.bailed) {
        result = rider.s.bailReason === 'avalanche' ? `CAUGHT at ${f1(d)} m` : `crashed (${rider.s.bailReason}) at ${f1(d)} m`;
        break;
      }
      if (z.phase === SETTLED || (z.phase !== LOADED && z.phase !== CRACKED && !Number.isNaN(d) && d > z.end) || (Number.isNaN(d) && rider.t > 3)) {
        result = 'outran it';
        outran++;
        break;
      }
    }
    if (!result) result = 'still riding after 60 s';
    if (!Number.isNaN(crackedAt)) setOff++;
    const cracked = Number.isNaN(crackedAt) ? 'never cracked' : `cracked with the rider ${f1(crackedAt)} m in`;
    console.log(`  lane ${l}: ${cracked}; ${result}; front at its closest ${Number.isFinite(closest) ? f1(closest) : '-'} m behind; top speed ${f1(top)} m/s`);
  }
  if (setOff === 0) {
    problems++;
    console.log('  PROBLEM: never set off');
  }
  if (outran === 0) {
    problems++;
    console.log('  PROBLEM: no tucked rider outran it');
  }

  // 2 and 3. Standing still across the slope, partway down; released above them.
  for (const noCrash of [false, true]) {
    setCheat('noCrashes', noCrash);
    reset();
    const l = Math.round((z.lanes - 1) / 2);
    const k = Math.round(Math.min(z.length * 0.5, 80) / LANE_STEP);
    const spot = laneAt(z, l, k);
    rider.place(spot.x, spot.z, spot.heading + 90, 0);
    rider.step();
    const c = zoneCell(z, rider.s.position.x, rider.s.position.z);
    if (c < 0) {
      console.log(`  standing: off the zone's grid at lane ${l}`);
      continue;
    }
    releaseZone(z, c);
    let caughtAt = NaN;
    let moved = 0;
    for (let n = 0; n < 30 / DT; n++) {
      rider.step();
      moved = Math.max(moved, rider.speed);
      if (rider.s.bailed && rider.s.bailReason === 'avalanche' && Number.isNaN(caughtAt)) caughtAt = rider.t;
      if (z.phase === SETTLED) break;
    }
    const caught = !Number.isNaN(caughtAt);
    const what = noCrash ? 'with No crashes' : 'standing';
    console.log(`  ${what}: ${caught ? `caught ${f1(caughtAt)} s after the crack, carried at up to ${f1(moved)} m/s` : `passed over (fastest ${f1(moved)} m/s)`}`);
    if (caught === noCrash) {
      problems++;
      console.log(`  PROBLEM: ${noCrash ? 'caught with No crashes on' : 'a standing rider was not caught'}`);
    }
  }
  setCheat('noCrashes', false);

  // 4. The real odds: ride in 40 times.
  CONFIG.avalanche.chance = chance;
  let released = 0;
  const l = Math.round((z.lanes - 1) / 2);
  const start = laneAt(z, l, 0);
  const back = (start.heading * Math.PI) / 180;
  for (let i = 0; i < 40; i++) {
    reset();
    rider.place(start.x + Math.sin(back) * 10, start.z + Math.cos(back) * 10, start.heading, 6);
    for (let n = 0; n < 3 / DT; n++) {
      rider.step(steer(z));
      if (rider.cracked > 0) {
        released++;
        break;
      }
    }
  }
  console.log(`  at 1 in ${Math.round(1 / chance)}: released ${released} of 40 times`);
}
CONFIG.avalanche.chance = chance;
console.log(`${av.zones.length} zones, ${problems} problems`);
