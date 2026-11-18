// The developer's powers (milestone 25) with the real simulation: free flight
// and the shot's ray. Nobody else's game ever runs either, so no other tool
// sees them.
//   node tools/sim/flight.ts [map.json ...]   (default: the Park, Freeride, the City, Proving Ground)
// Flight: from the map's spawn, takes off, cruises, climbs, turns, flies
// fast, hovers, dives into the snow (it must skim, never go under), then
// glides down and rides away. Then glides down onto each kind of ground the
// map has (open snow, a kicker, a halfpipe's wall, a building's roof, a
// steep face) and rides on 3 s. A flight that goes under the snow, never
// lands, or crashes on landing is a problem.
// Shots: at the snow from above, at a rail, at an obstacle (a tree or a
// rock) and at a building's wall, printing what each hit and how far.

import { CONFIG } from '../../src/config.ts';
import { flightStep, startFlight, toggleLanding, flightKeys } from '../../src/sim/flight.ts';
import { castShot, createShotHit, HIT } from '../../src/sim/shot.ts';
import { setFlightStep } from '../../src/sim/skier.ts';
import { heightAt } from '../../src/sim/terrain.ts';
import type { Action } from '../../src/core/input.ts';
import { Vector3 } from 'three';
import { DT, loadMap, Rider, type Sim } from './harness.ts';

setFlightStep(flightStep);
const files = process.argv.slice(2);
if (files.length === 0) files.push(...['park', 'freeride', 'city', 'proving'].map((m) => `src/maps/${m}.json`));
const KIND = Object.fromEntries(Object.entries(HIT).map(([k, v]) => [v, k]));
let problems = 0;

for (const file of files) {
  const sim = loadMap(file);
  console.log(`\n${file}`);
  flyAround(sim);
  for (const [name, x, z] of landingSpots(sim)) landAt(sim, name, x, z);
  shots(sim);
}
console.log(`\n${problems} problem${problems === 1 ? '' : 's'}`);

/** Steps `seconds` with `keys` held, returning the lowest the feet came to the snow (m). */
function hold(r: Rider, seconds: number, keys: readonly Action[] = [], hover = false): number {
  flightKeys.hover = hover;
  let low = Infinity;
  for (let t = 0; t < seconds; t += DT) {
    r.step(keys);
    const p = r.s.position;
    low = Math.min(low, p.y - heightAt(r.sim.course.hf, p.x, p.z));
  }
  flightKeys.hover = false;
  return low;
}

function flyAround(sim: Sim): void {
  const r = new Rider(sim);
  const sp = sim.map.spawn;
  r.place(sp.x, sp.z, sp.heading, 8);
  hold(r, 1);
  startFlight(r.s);
  const legs: [string, number, Action[], boolean][] = [
    ['cruise', 2, [], false],
    ['climb', 2, ['up'], false],
    ['turn left', 2, ['left'], false],
    ['fast', 2, ['pole'], false],
    ['hover', 2, [], true],
    ['dive', 6, ['down', 'pole'], false],
  ];
  for (const [name, seconds, keys, hover] of legs) {
    const low = hold(r, seconds, keys, hover);
    const p = r.s.position;
    const over = p.y - heightAt(sim.course.hf, p.x, p.z);
    console.log(`  ${name.padEnd(9)} ${r.speed.toFixed(1).padStart(5)} m/s, ${over.toFixed(1).padStart(6)} m over the snow (lowest ${low.toFixed(2)})`);
    if (low < -0.01) {
      console.log('    PROBLEM: under the snow');
      problems++;
    }
  }
  toggleLanding(r.s);
  landed(r, 'from the dive');
}

/** Glides down from where the flight is, then rides 3 s: reports where and how it ended. */
function landed(r: Rider, what: string): void {
  let t = 0;
  while (r.s.flight !== 0 && t < 60) {
    r.step();
    t += DT;
  }
  if (r.s.flight !== 0) {
    console.log(`  land ${what}: PROBLEM: still flying after 60 s`);
    problems++;
    return;
  }
  const speed = r.speed;
  hold(r, 3);
  const s = r.s;
  const ok = !s.bailed;
  console.log(`  land ${what}: down after ${t.toFixed(1)} s at ${speed.toFixed(1)} m/s; 3 s later ${r.describe().replace(/^t=\S+ /, '')}${ok ? '' : '  PROBLEM'}`);
  if (!ok) problems++;
}

function landAt(sim: Sim, name: string, x: number, z: number): void {
  const r = new Rider(sim);
  r.place(x, z, 0, 0);
  startFlight(r.s);
  r.s.position.y += 20;
  hold(r, 0.5, [], true);
  toggleLanding(r.s);
  flightKeys.hover = true;
  landed(r, `on ${name} (${x.toFixed(0)}, ${z.toFixed(0)})`);
  flightKeys.hover = false;
}

/** One spot of each kind of ground the map has. */
function landingSpots(sim: Sim): [string, number, number][] {
  const out: [string, number, number][] = [];
  const sp = sim.map.spawn;
  out.push(['open snow', sp.x, sp.z - 60]);
  const f = sim.map.features;
  const kicker = f.find((g) => g.type === 'kicker');
  if (kicker && 'x' in kicker) out.push(['a kicker', kicker.x, kicker.z]);
  const pipe = f.find((g) => g.type === 'halfpipe');
  if (pipe && pipe.type === 'halfpipe') out.push(["a halfpipe's wall", pipe.x + pipe.floorWidth / 2 + pipe.radius * 0.6, pipe.z - pipe.length / 2]);
  const building = f.find((g) => g.type === 'building');
  if (building && 'x' in building) out.push(["a building's roof", building.x, building.z]);
  // The steepest snow within 400 m of the spawn, on a 20 m grid.
  let best = 0;
  let steep: [number, number] | null = null;
  const hf = sim.course.hf;
  for (let dx = -400; dx <= 400; dx += 20) {
    for (let dz = -400; dz <= 400; dz += 20) {
      const x = sp.x + dx;
      const z = sp.z + dz;
      const slope = Math.abs(heightAt(hf, x + 1, z) - heightAt(hf, x - 1, z)) / 2 + Math.abs(heightAt(hf, x, z + 1) - heightAt(hf, x, z - 1)) / 2;
      if (slope > best && slope < 2) {
        best = slope;
        steep = [x, z];
      }
    }
  }
  if (steep) out.push([`a steep face (${((Math.atan(best) * 180) / Math.PI).toFixed(0)}°)`, steep[0], steep[1]]);
  return out;
}

function shots(sim: Sim): void {
  const hit = createShotHit();
  const range = CONFIG.dev.shot.range;
  const hf = sim.course.hf;
  const shoot = (name: string, from: Vector3, to: Vector3): void => {
    // Never from under the snow (the City is on a hill): from 1.7 m over it at least.
    from.y = Math.max(from.y, heightAt(hf, from.x, from.z) + 1.7);
    const dir = to.clone().sub(from).normalize();
    const any = castShot(sim.course, from, dir, range, hit);
    const p = hit.point;
    console.log(
      `  shot at ${name}: ${any ? `${KIND[hit.kind]}${hit.index >= 0 ? ` #${hit.index}` : ''} at ${hit.distance.toFixed(1)} m (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}), normal (${hit.normal.x.toFixed(2)}, ${hit.normal.y.toFixed(2)}, ${hit.normal.z.toFixed(2)})` : 'nothing'}`,
    );
  };
  /** From `out` m away on the downhill side (the lowest snow of four), at `y` or 1.7 m over the snow there. */
  const downhill = (x: number, z: number, y: number, out: number): Vector3 => {
    let best = new Vector3(x + out, y, z);
    for (const [dx, dz] of [[out, 0], [-out, 0], [0, out], [0, -out]] as const) {
      if (heightAt(hf, x + dx, z + dz) < heightAt(hf, best.x, best.z)) best = new Vector3(x + dx, y, z + dz);
    }
    return best;
  };
  const sp = sim.map.spawn;
  const g = heightAt(hf, sp.x, sp.z);
  shoot('the snow', new Vector3(sp.x, g + 2, sp.z), new Vector3(sp.x, heightAt(hf, sp.x, sp.z - 30), sp.z - 30));
  const rail = sim.course.rails.find((r) => r.kind === 'rail' && !r.ups);
  if (rail) {
    const k = Math.floor(rail.points.length / 6) * 3;
    const at = new Vector3(rail.points[k], rail.points[k + 1], rail.points[k + 2]);
    shoot(`a rail (${rail.metal ? 'metal' : 'wood'})`, downhill(at.x, at.z, at.y + 1.5, 12), at);
  }
  const o = sim.course.obstacles;
  for (const wantTree of [true, false]) {
    let found = false;
    for (let i = 0; i < o.count && !found; i++) {
      const tree = o.ax[i] === o.bx[i] && o.az[i] === o.bz[i] && o.radius[i]! >= 0.2 && o.top[i]! - o.bottom[i]! > 3;
      if (tree !== wantTree) continue;
      const cx = (o.ax[i]! + o.bx[i]!) / 2;
      const cz = (o.az[i]! + o.bz[i]!) / 2;
      const y = Math.min(o.top[i]! - 0.3, heightAt(hf, cx, cz) + 1);
      shoot(wantTree ? 'a tree' : 'a rock, fence or wall', downhill(cx, cz, y + 0.5, 25), new Vector3(cx, y, cz));
      found = true;
    }
    if (!found) console.log(`  shot at ${wantTree ? 'a tree' : 'a rock, fence or wall'}: none on this map`);
  }
  const building = sim.map.features.find((f) => f.type === 'building');
  if (building && 'x' in building) {
    // Level at the wall's middle height, from 30 m out.
    const y = heightAt(hf, building.x, building.z) - building.eave / 2;
    shoot("a building's wall", downhill(building.x, building.z, y, 30), new Vector3(building.x, y, building.z));
  }
}
