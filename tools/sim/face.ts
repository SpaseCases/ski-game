// Rides down a mountain headlessly the way a player picks a line, with the
// real simulation: steering toward a spot ahead on the line (around trees
// and rocks in the way), braking to stay under a speed cap, poling when slow. Reports each ride's time, speed,
// airs (off cliffs, lips, pillows), crashes, stuck spots, bumps against the
// edge of the play area, and which finish it reached.
//   node tools/sim/face.ts <map.json> [run names...]   ride the map's named runs (default: all of them)
//   node tools/sim/face.ts <map.json> --fall [n]       n riders (default 16) off the spawn in every direction, each following the fall line
// Options: --max <m/s> brake above this speed (default 20). After a crash the
// rider starts again from a standstill 20 m further on.

import { CONFIG } from '../../src/config.ts';
import type { Action } from '../../src/core/input.ts';
import type { Bounds, RunDef, XZ } from '../../src/maps/types.ts';
import { finishAt } from '../../src/sim/checkpoints.ts';
import { wrapAngle } from '../../src/sim/skier.ts';
import { heightAt } from '../../src/sim/terrain.ts';
import { DT, loadMap, Rider } from './harness.ts';

const args = process.argv.slice(2);
const file = args[0];
if (!file) throw new Error('Usage: node tools/sim/face.ts <map.json> [run names...] [--fall [n]] [--max m/s]');
const option = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const maxSpeed = Number(option('--max') ?? 20);
const fall = args.includes('--fall');
const fallCount = Number(option('--fall') ?? 16) || 16;
const names = args.slice(1).filter((a, i, all) => !a.startsWith('--') && !['--max', '--fall'].includes(all[i - 1] ?? ''));
const sim = loadMap(file);
const hf = sim.course.hf;
const DEG = Math.PI / 180;
/** Seconds slower than 0.8 m/s (while poling) that count as stuck. */
const STUCK_TIME = 6;
/** Longest ride (s) before giving up. */
const TIME_LIMIT = 600;

/** Where to steer: a heading (radians) for the rider now, or null when the line is done. */
type Guide = (r: Rider) => number | null;

interface Ride {
  label: string;
  /** Start spot and heading (degrees). */
  start: XZ;
  heading: number;
  guide: Guide;
  /** Spot to start again from after a crash at the rider's position. */
  restart: (r: Rider) => { at: XZ; heading: number };
}

// ---------------------------------------------------------------- guides
/** Follows a polyline: steers at a spot a little ahead of the nearest point, never going back along it. */
function runGuide(run: RunDef): { guide: Guide; restart: Ride['restart'] } {
  const pts = run.points;
  const at: number[] = [0];
  for (let i = 1; i < pts.length; i++) at.push(at[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z));
  const total = at[at.length - 1]!;
  let progress = 0;
  const pointAt = (d: number): XZ => {
    const dd = Math.min(total, Math.max(0, d));
    let i = 1;
    while (i < pts.length - 1 && at[i]! < dd) i++;
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const t = (dd - at[i - 1]!) / Math.max(1e-6, at[i]! - at[i - 1]!);
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
  };
  /** Distance along the line of the point nearest (x, z), searching a stretch from the progress so far. */
  const nearest = (x: number, z: number): number => {
    let best = Infinity;
    let bestD = progress;
    for (let i = 1; i < pts.length; i++) {
      if (at[i]! < progress - 5 || at[i - 1]! > progress + 120) continue;
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const sx = b.x - a.x;
      const sz = b.z - a.z;
      const len2 = sx * sx + sz * sz;
      const t = Math.min(1, Math.max(0, ((x - a.x) * sx + (z - a.z) * sz) / len2));
      const d2 = (x - a.x - sx * t) ** 2 + (z - a.z - sz * t) ** 2;
      if (d2 < best) {
        best = d2;
        bestD = at[i - 1]! + Math.sqrt(len2) * t;
      }
    }
    return bestD;
  };
  const headingAlong = (d: number): number => {
    const a = pointAt(d);
    const b = pointAt(d + 2);
    return Math.atan2(-(b.x - a.x), -(b.z - a.z));
  };
  return {
    guide: (r) => {
      const p = r.s.position;
      progress = Math.max(progress, nearest(p.x, p.z));
      if (progress >= total - 1) return null;
      const ahead = pointAt(progress + Math.min(35, Math.max(12, r.speed * 1.1)));
      return Math.atan2(-(ahead.x - p.x), -(ahead.z - p.z));
    },
    restart: (r) => {
      progress = nearest(r.s.position.x, r.s.position.z) + 20;
      return { at: pointAt(progress), heading: headingAlong(progress) / DEG };
    },
  };
}

/**
 * Straight down the hill: the steepest way down from where the rider is,
 * smoothed over a few meters. Where it's nearly level (a saddle at the end
 * of a ridge, a flat), it looks around for the lowest ground nearby instead,
 * as a player would.
 */
function fallGuide(): { guide: Guide; restart: Ride['restart'] } {
  const downhill = (x: number, z: number): number => {
    const e = 5;
    const gx = heightAt(hf, x + e, z) - heightAt(hf, x - e, z);
    const gz = heightAt(hf, x, z + e) - heightAt(hf, x, z - e);
    if (Math.hypot(gx, gz) > 0.08 * 2 * e) return Math.atan2(gx, gz);
    let best = Infinity;
    let heading = 0;
    for (let k = 0; k < 24; k++) {
      const h = (k / 24) * 2 * Math.PI;
      const y = heightAt(hf, x - Math.sin(h) * 25, z - Math.cos(h) * 25);
      if (y < best) {
        best = y;
        heading = h;
      }
    }
    return heading;
  };
  return {
    guide: (r) => {
      const p = r.s.position;
      // Look a little ahead along the way down so the rider turns early into gullies.
      const h = downhill(p.x, p.z);
      return downhill(p.x - Math.sin(h) * 10, p.z - Math.cos(h) * 10);
    },
    restart: (r) => {
      const p = r.s.position;
      const h = downhill(p.x, p.z);
      return { at: { x: p.x - Math.sin(h) * 20, z: p.z - Math.cos(h) * 20 }, heading: h / DEG };
    },
  };
}

// ---------------------------------------------------------------- riding
interface Result {
  label: string;
  finish: number;
  time: number;
  distance: number;
  top: number;
  braking: number;
  crashes: string[];
  airs: string[];
  stuck: string[];
  edge: string[];
  edgeTime: number;
  flags: number;
  steepest: number;
}

/** Where a point is, for reports: distance out from the spawn and the heading it's at. */
function spot(p: XZ): string {
  const dx = p.x - sim.map.spawn.x;
  const dz = p.z - sim.map.spawn.z;
  return `${Math.hypot(dx, dz).toFixed(0)} m out at ${((Math.atan2(-dx, -dz) / DEG + 360) % 360).toFixed(0)}° (${p.x.toFixed(0)}, ${p.z.toFixed(0)})`;
}

function ride(def: Ride): Result {
  const r = new Rider(sim);
  r.place(def.start.x, def.start.z, def.heading, 0);
  const res: Result = { label: def.label, finish: -1, time: 0, distance: 0, top: 0, braking: 0, crashes: [], airs: [], stuck: [], edge: [], edgeTime: 0, flags: 0, steepest: 0 };
  let slow = 0;
  let takeoff: { t: number; y: number; at: XZ; speed: number } | null = null;
  let lastEdge = -Infinity;
  let keys: Action[] = [];
  while (r.t < TIME_LIMIT) {
    const target = def.guide(r);
    if (target === null) break;
    const p = r.s.position;
    const prevX = p.x;
    const prevZ = p.z;
    keys = [];
    if (r.s.grounded) {
      const err = wrapAngle(avoid(r, target) - r.s.yaw);
      if (err > 0.03) keys.push('left');
      else if (err < -0.03) keys.push('right');
      if (r.speed > maxSpeed) keys.push('down');
      else if (r.speed < 5 && Math.abs(err) < 0.6) keys.push('pole');
    } else if (r.s.rail < 0 && !(r.s.spinDriven & 2) && Math.abs(r.s.spin.y) > 0.15) {
      // Carving into a lip starts a spin; a tap the other way stops it, as a player would.
      keys.push(r.s.spin.y > 0 ? 'right' : 'left');
    }
    r.step(keys);
    if (keys.includes('down')) res.braking += DT;
    res.distance += Math.hypot(p.x - prevX, p.z - prevZ);
    res.top = Math.max(res.top, r.speed);
    if (r.s.grounded) res.steepest = Math.max(res.steepest, Math.acos(Math.min(1, r.s.normal.y)) / DEG);

    if (!r.s.grounded && r.s.rail < 0 && !r.s.bailed && !takeoff) takeoff = { t: r.t, y: p.y, at: { x: p.x, z: p.z }, speed: r.speed };
    if (takeoff && (r.s.grounded || r.s.bailed)) {
      const air = r.t - takeoff.t;
      if (air > 0.4) {
        res.airs.push(
          `${air.toFixed(1)} s air, ${(takeoff.y - p.y).toFixed(1)} m drop, off at ${takeoff.speed.toFixed(0)} m/s, ${r.s.landImpact.toFixed(1)} m/s in` +
            `${r.s.bailed ? ` CRASH (${r.s.bailReason})` : ''} — ${spot(takeoff.at)}`,
        );
      }
      takeoff = null;
    }
    if (r.s.bailed) {
      res.crashes.push(`${r.s.bailReason} at ${spot(p)}`);
      const again = def.restart(r);
      const t = r.t;
      r.place(again.at.x, again.at.z, again.heading, 0);
      r.t = t + CONFIG.bail.respawnDelay;
      takeoff = null;
      continue;
    }
    slow = r.speed < 0.8 ? slow + DT : 0;
    if (slow > STUCK_TIME) {
      res.stuck.push(spot(p));
      const again = def.restart(r);
      const t = r.t;
      r.place(again.at.x, again.at.z, again.heading, 0);
      r.t = t;
      slow = 0;
      if (res.stuck.length > 4) break;
    }
    if (edgeDistance(hf.bounds, p.x, p.z) < 1.5) {
      // One report per stretch along the edge, with how long it stayed there.
      if (r.t - lastEdge > 3) res.edge.push(spot(p));
      else res.edgeTime += DT;
      lastEdge = r.t;
    }
    const f = finishAt(sim.map, p);
    if (f >= 0) {
      res.finish = f;
      break;
    }
  }
  res.time = r.t;
  res.flags = r.run.passed.filter(Boolean).length;
  return res;
}

/** A wanted heading, turned aside as little as it takes when a tree or rock stands in the way ahead. */
function avoid(r: Rider, want: number): number {
  const p = r.s.position;
  const look = Math.max(10, r.speed * 0.9);
  for (const off of [0, 0.12, -0.12, 0.25, -0.25, 0.4, -0.4, 0.6, -0.6, 0.85, -0.85]) {
    const h = want + off;
    if (clearAhead(p.x, p.z, p.y, -Math.sin(h), -Math.cos(h), look)) return h;
  }
  return want;
}

/** True when nothing solid stands within a body's width of the line `look` meters ahead along (dx, dz). */
function clearAhead(x: number, z: number, y: number, dx: number, dz: number, look: number): boolean {
  const o = sim.course.obstacles;
  if (o.count === 0) return true;
  const seen = new Set<number>();
  for (let d = 0; d <= look + o.cell; d += o.cell / 2) {
    const col = Math.floor((x + dx * d - o.originX) / o.cell);
    const row = Math.floor((z + dz * d - o.originZ) / o.cell);
    if (col < 0 || row < 0 || col >= o.cols || row >= o.rows) continue;
    const k = row * o.cols + col;
    for (let j = o.start[k]!; j < o.start[k + 1]!; j++) {
      const i = o.items[j]!;
      if (seen.has(i) || o.top[i]! < y) continue;
      seen.add(i);
      // Distance from the obstacle (its middle) to the line ahead.
      const ox = (o.ax[i]! + o.bx[i]!) / 2 - x;
      const oz = (o.az[i]! + o.bz[i]!) / 2 - z;
      const t = Math.min(look, Math.max(0, ox * dx + oz * dz));
      if (Math.hypot(ox - dx * t, oz - dz * t) < o.radius[i]! + 1.3) return false;
    }
  }
  return true;
}

/** Flat distance from (x, z) to the play area's polygon edge (Infinity with no polygon). */
function edgeDistance(b: Bounds, x: number, z: number): number {
  const poly = b.polygon;
  let best = Infinity;
  const n = poly.length / 2;
  for (let i = 0; i < n; i++) {
    const ax = poly[i * 2]!;
    const az = poly[i * 2 + 1]!;
    const j = (i + 1) % n;
    const sx = poly[j * 2]! - ax;
    const sz = poly[j * 2 + 1]! - az;
    const len2 = sx * sx + sz * sz;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * sx + (z - az) * sz) / len2)) : 0;
    best = Math.min(best, Math.hypot(x - ax - sx * t, z - az - sz * t));
  }
  return best;
}

function report(res: Result): void {
  const finish = res.finish >= 0 ? `finish ${res.finish + 1}` : 'NO FINISH';
  console.log(
    `${res.label}: ${finish} in ${res.time.toFixed(0)} s (${(res.time / 60).toFixed(1)} min), ${res.distance.toFixed(0)} m ridden, ` +
      `avg ${(res.distance / Math.max(1, res.time)).toFixed(1)} m/s, top ${res.top.toFixed(1)} m/s, braking ${((100 * res.braking) / Math.max(1, res.time)).toFixed(0)}% of the time, ` +
      `steepest ${res.steepest.toFixed(0)}°, ${res.flags} flag${res.flags === 1 ? '' : 's'}`,
  );
  for (const a of res.airs) console.log(`    air: ${a}`);
  for (const c of res.crashes) console.log(`    CRASH: ${c}`);
  for (const s of res.stuck) console.log(`    STUCK: ${s}`);
  for (const e of res.edge) console.log(`    at the edge: ${e}`);
  if (res.edge.length > 0) console.log(`    (${res.edgeTime.toFixed(1)} s against the edge in all)`);
}

console.log(`${file}: braking above ${maxSpeed} m/s`);
if (fall) {
  for (let k = 0; k < fallCount; k++) {
    const heading = (360 * k) / fallCount;
    const h = heading * DEG;
    const start = { x: sim.map.spawn.x - Math.sin(h) * 26, z: sim.map.spawn.z - Math.cos(h) * 26 };
    const g = fallGuide();
    report(ride({ label: `fall line from ${heading.toFixed(0)}°`, start, heading, ...g }));
  }
} else {
  const runs = sim.map.runs.filter((run) => names.length === 0 || names.some((n) => run.name.toLowerCase().includes(n.toLowerCase())));
  if (runs.length === 0) throw new Error(`No run matches ${names.join(', ')}`);
  for (const run of runs) {
    const g = runGuide(run);
    const a = run.points[0]!;
    const b = run.points[1]!;
    report(ride({ label: run.name, start: a, heading: Math.atan2(-(b.x - a.x), -(b.z - a.z)) / DEG, ...g }));
  }
}
