// Rides each timed course headlessly, through its gates, with the real
// simulation: from a standstill in the start house, poling through the
// wand, then following a racing line that rounds each gate's inner pole (or
// panel) a little inside it, at the speed the slope gives, checking speed
// only when sliding wide of the line on the outside of a turn, as a player
// would. Reports each run's time (wand to finish), missed gates, poles and
// panels brushed in passing (free) and knocked (costing speed), crashes,
// top and average speed, and how much of the run it braked.
//   node tools/sim/course.ts <map.json> [course names...]
// Options: --margin <m> how far inside the inner pole the line passes
// (default 1); --nobrake never checks speed (the gates at the speed the
// slope gives, whatever happens); --max <m/s> brake above this speed;
// --safety <0..1> brake before the line ahead asks for more than this share
// of the skis' fastest turn (a cautious rider; 0.85 is careful); --tuck crouch on
// straight stretches; --trace prints each gate as it's passed. After a crash
// the rider starts again from a standstill 15 m further on the line.

import { CONFIG } from '../../src/config.ts';
import type { Action } from '../../src/core/input.ts';
import type { XZ } from '../../src/maps/types.ts';
import type { CourseDef, RaceLine } from '../../src/sim/race.ts';
import { wrapAngle } from '../../src/sim/skier.ts';
import { DT, loadMap, Rider } from './harness.ts';

const args = process.argv.slice(2);
const file = args[0];
if (!file) throw new Error('Usage: node tools/sim/course.ts <map.json> [course names...] [--margin m] [--max m/s] [--tuck] [--trace]');
const option = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const margin = Number(option('--margin') ?? 1);
const maxSpeed = Number(option('--max') ?? Infinity);
const safety = Number(option('--safety') ?? Infinity);
const noBrake = args.includes('--nobrake');
/** Sliding this far (m) wide of the line on the outside of a turn checks speed. */
const WIDE = 0.3;
const tuck = args.includes('--tuck');
const trace = args.includes('--trace');
const names = args.slice(1).filter((a, i, all) => !a.startsWith('--') && !['--margin', '--max', '--safety'].includes(all[i - 1] ?? ''));
const sim = loadMap(file);
const race = sim.race;
if (!race) throw new Error(`${file} has no timed course`);
/** Longest ride (s) before giving up. */
const TIME_LIMIT = 400;

// ---------------------------------------------------------------- the line
/**
 * Spots the line passes through: the house, out the door, each gate's apex,
 * and into the finish. `inner` gets each gate's inner side: -1 its left
 * pole, 1 its right, 0 for a gate straight in line with its neighbors.
 */
function apexes(c: CourseDef, inner: number[]): XZ[] {
  const start = c.start!;
  const dir = { x: -Math.sin(start.heading), z: -Math.cos(start.heading) };
  const pts: XZ[] = [
    { x: start.x, z: start.z },
    { x: start.x + dir.x * 4, z: start.z + dir.z * 4 },
  ];
  const gates = race!.gates.slice(c.first, c.first + c.count);
  const finish = finishPoint(c, gates[gates.length - 1] ?? { x: start.x, z: start.z });
  gates.forEach((g, i) => {
    const prev = i === 0 ? pts[1]! : gates[i - 1]!;
    const next = i === gates.length - 1 ? finish : gates[i + 1]!;
    // How far this gate sits off the line between its neighbors, along its right: the turn goes round the side nearer that line.
    const sx = next.x - prev.x;
    const sz = next.z - prev.z;
    const t = ((g.x - prev.x) * sx + (g.z - prev.z) * sz) / (sx * sx + sz * sz);
    const off = (g.x - (prev.x + sx * t)) * g.rightX + (g.z - (prev.z + sz * t)) * g.rightZ;
    inner.push(Math.abs(off) < 0.5 ? 0 : -Math.sign(off));
    const inside = inner[i]! * Math.max(0, g.half - margin);
    pts.push({ x: g.x + g.rightX * inside, z: g.z + g.rightZ * inside });
  });
  pts.push(finish);
  const f = c.finishes[0]!;
  const h = (f.heading * Math.PI) / 180;
  pts.push({ x: finish.x - Math.sin(h) * 25, z: finish.z - Math.cos(h) * 25 });
  return pts;
}

/** Where the line crosses into the finish: under its arch, or straight on from the last gate. */
function finishPoint(c: CourseDef, last: XZ): XZ {
  const f = c.finishes[0]!;
  const h = (f.heading * Math.PI) / 180;
  const rx = Math.cos(h);
  const rz = -Math.sin(h);
  const mid = f.arch ?? { x: last.x, z: last.z };
  // On the zone's line, across from the arch (or the last gate), a few meters in.
  const across = (mid.x - f.x) * rx + (mid.z - f.z) * rz;
  return { x: f.x + rx * across - Math.sin(h) * 3, z: f.z + rz * across - Math.cos(h) * 3 };
}

/**
 * A smooth line through the spots (Catmull-Rom), every half meter: its
 * heading (radians) and curvature (1/m, positive turning left) at each point.
 */
function smooth(pts: readonly XZ[]): { x: Float64Array; z: Float64Array; h: Float64Array; k: Float64Array; at: Float64Array } {
  const out: XZ[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[Math.min(pts.length - 1, i + 2)]!;
    const n = Math.max(2, Math.ceil(Math.hypot(p2.x - p1.x, p2.z - p1.z) / 0.5));
    for (let j = 0; j < n; j++) {
      const t = j / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number): number =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), z: f(p0.z, p1.z, p2.z, p3.z) });
    }
  }
  out.push(pts[pts.length - 1]!);
  const n = out.length;
  const x = Float64Array.from(out, (p) => p.x);
  const z = Float64Array.from(out, (p) => p.z);
  const at = new Float64Array(n);
  for (let i = 1; i < n; i++) at[i] = at[i - 1]! + Math.hypot(x[i]! - x[i - 1]!, z[i]! - z[i - 1]!);
  const h = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    h[i] = Math.atan2(-(x[b]! - x[a]!), -(z[b]! - z[a]!));
  }
  const k = new Float64Array(n);
  for (let i = 3; i < n - 3; i++) k[i] = wrapAngle(h[i + 3]! - h[i - 3]!) / Math.max(1e-6, at[i + 3]! - at[i - 3]!);
  return { x, z, h, k, at };
}

/** Fastest speed (m/s) the skis can carve a turn of curvature k at, with a little to spare. */
function carveSpeed(k: number): number {
  const c = CONFIG.skier;
  if (k < 1e-4) return Infinity;
  let lo = 0;
  let hi = 60;
  for (let i = 0; i < 30; i++) {
    const v = (lo + hi) / 2;
    const rate = Math.min(c.turnRateSlow + (c.turnRateFast - c.turnRateSlow) * Math.min(1, v / c.turnSpeedRef), (c.grip * c.gravity * 0.95) / v);
    if (v * k <= rate * safety) lo = v;
    else hi = v;
  }
  return lo;
}

// ---------------------------------------------------------------- riding
interface Result {
  time: number;
  finished: boolean;
  missed: number[];
  /** Poles and panels brushed in passing (no speed lost), and knocked squarely enough to cost speed. */
  brushed: number;
  knocked: number;
  crashes: string[];
  top: number;
  distance: number;
  braking: number;
}

function ride(ci: number): Result {
  const c = race!.courses[ci]!;
  const inner: number[] = [];
  const line = smooth(apexes(c, inner));
  const n = line.x.length;
  const allowed = Float64Array.from(line.k, (k) => (Number.isFinite(safety) ? carveSpeed(Math.abs(k)) : Infinity));
  const r = new Rider(sim);
  const start = c.start!;
  r.place(start.x, start.z, (start.heading * 180) / Math.PI, 0);
  const res: Result = { time: 0, finished: false, missed: [], brushed: 0, knocked: 0, crashes: [], top: 0, distance: 0, braking: 0 };
  let progress = 0;
  let started = -1;
  const touching = new Uint8Array(race!.gates.length * 2);
  const nearest = (px: number, pz: number): number => {
    let best = Infinity;
    let bi = progress;
    for (let i = progress; i < Math.min(n, progress + 200); i++) {
      const d = (line.x[i]! - px) ** 2 + (line.z[i]! - pz) ** 2;
      if (d < best) {
        best = d;
        bi = i;
      }
    }
    return bi;
  };
  while (r.t < TIME_LIMIT) {
    const p = r.s.position;
    progress = nearest(p.x, p.z);
    const speed = r.speed;
    // Turn as fast as the line turns here, plus a correction back onto it:
    // toward its heading, and toward it when off to one side.
    const h = line.h[progress]!;
    const off = (p.x - line.x[progress]!) * Math.cos(h) - (p.z - line.z[progress]!) * Math.sin(h);
    const err = wrapAngle(h + Math.atan(1.2 * off) - r.s.yaw);
    const rate = speed * line.k[progress]! + 3 * err;
    // The slowest the line asks for over the next stretch (a little longer when fast).
    let limit = maxSpeed;
    for (let i = progress; i < n && line.at[i]! - line.at[progress]! < 6 + speed * 0.9; i++) limit = Math.min(limit, allowed[i]!);
    const keys: Action[] = [];
    if (r.s.grounded) {
      // Keys turn the skis at full rate or let them straighten: press toward the rate wanted, let go past it.
      if (rate > 0.02 && r.s.yawRate < rate) keys.push('left');
      else if (rate < -0.02 && r.s.yawRate > rate) keys.push('right');
      if (speed > limit || (!noBrake && off * line.k[progress]! > 0 && Math.abs(off) > WIDE && Math.abs(line.k[progress]!) > 0.02)) keys.push('down');
      else if (speed < 6 && Math.abs(err) < 0.5) keys.push('pole');
      else if (tuck && limit === Infinity && Math.abs(err) < 0.05) keys.push('up');
    }
    const prevX = p.x;
    const prevZ = p.z;
    const before = r.speed;
    const event = r.step(keys);
    // A knock takes a good part of a m/s off in one step; the slope and the snow never do.
    const knock = before - r.speed > 0.15;
    if (keys.includes('down')) res.braking += DT;
    res.distance += Math.hypot(p.x - prevX, p.z - prevZ);
    if (started >= 0) res.top = Math.max(res.top, r.speed);
    const state = r.race!;
    for (let i = 0; i < touching.length; i++) {
      if (state.touching[i] === 1 && touching[i] === 0) {
        if (knock) res.knocked++;
        else res.brushed++;
      }
      touching[i] = state.touching[i]!;
    }
    if (event === 'start') started = r.t;
    if ((event === 'gate' || event === 'missed') && trace) {
      const k = state.gate.slice(c.first, c.first + c.count).findLastIndex((g) => g !== 0);
      const g = race!.gates[c.first + k]!;
      const across = (p.x - g.x) * g.rightX + (p.z - g.z) * g.rightZ;
      const s = inner[k]!;
      const pass = s === 0 ? `${across.toFixed(2)} m right of the middle` : `${(g.half - s * across).toFixed(2)} m inside the ${s < 0 ? 'left' : 'right'} pole`;
      console.log(`    gate ${k + 1}${event === 'missed' ? ' MISSED' : ''} at ${(r.t - started).toFixed(2)} s, ${r.speed.toFixed(1)} m/s, ${pass}, z ${p.z.toFixed(0)}`);
    }
    if (event === 'finish') {
      res.finished = true;
      res.time = state.time;
      state.gate.slice(c.first, c.first + c.count).forEach((g, i) => {
        if (g === 2) res.missed.push(i + 1);
      });
      break;
    }
    if (r.s.bailed) {
      res.crashes.push(`${r.s.bailReason} at (${p.x.toFixed(0)}, ${p.z.toFixed(0)}), ${(r.t - started).toFixed(1)} s in`);
      const k = Math.min(n - 1, nearest(p.x, p.z) + 30);
      const t = r.t;
      const heading = Math.atan2(-(line.x[Math.min(n - 1, k + 2)]! - line.x[k]!), -(line.z[Math.min(n - 1, k + 2)]! - line.z[k]!));
      r.place(line.x[k]!, line.z[k]!, (heading * 180) / Math.PI, 0);
      r.t = t + CONFIG.bail.respawnDelay;
      progress = k;
    }
  }
  if (started >= 0 && !res.finished) res.time = r.t - started;
  return res;
}

console.log(
  `${file}: line ${margin} m inside the inner poles` +
    `${Number.isFinite(maxSpeed) ? `, braking above ${maxSpeed} m/s` : ''}${Number.isFinite(safety) ? `, braking for turns past ${safety} of the skis' fastest` : ''}${tuck ? ', tucking the straights' : ''}`,
);
race.courses.forEach((c, i) => {
  if (!c.start || (names.length > 0 && !names.some((n) => c.name.toLowerCase().includes(n.toLowerCase())))) return;
  const res = ride(i);
  const avg = res.distance / Math.max(1, res.time);
  console.log(
    `${c.name} (${c.count} ${c.kind === 'giant' ? 'giant slalom' : 'slalom'} gates): ${res.finished ? `finished in ${res.time.toFixed(2)} s` : `NO FINISH after ${res.time.toFixed(0)} s`}, ` +
      `${res.missed.length} missed${res.missed.length > 0 ? ` (gates ${res.missed.join(', ')})` : ''}, ${res.brushed} brushed, ${res.knocked} knocked, ` +
      `top ${res.top.toFixed(1)} m/s, avg ${avg.toFixed(1)} m/s, braking ${((100 * res.braking) / Math.max(1, res.time)).toFixed(0)}% of the time`,
  );
  for (const crash of res.crashes) console.log(`    CRASH: ${crash}`);
});
