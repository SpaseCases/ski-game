import { CONFIG } from '../config.ts';
import type { Heightfield, LineDecor, XZ } from '../maps/types.ts';
import { heightAt } from './terrain.ts';

// A chairlift riders can take (milestone 17). The cable is one loop: up the
// right-hand side looking up the line, round the top station's bullwheel,
// down the other side and round the bottom one. Chairs are spaced evenly in
// time, and the loop has a speed at every point (slow through the stations,
// fast on the line, like a detachable lift), so they bunch up in the
// stations and spread out on the line. Where every chair is follows from
// one clock, which the sim advances and the renderer reads: the chair the
// skier sits on is one of the chairs drawn.
//
// While the skier rides out on the line the clock runs faster (a
// fast-forward: every chair speeds up with it), easing in and out near the
// stations, so the ride is short without anything jumping.

/** Distance (m) between samples of the loop. */
const SAMPLE = 1;
/** Sizes shared with the model (render/expressLift.ts). */
export const LIFT = {
  /** Half the distance between the up and the down cable: the bullwheel's radius. */
  arm: 2.4,
  /** A station: how far it reaches each way along the line from its bullwheel, and its pillars' places along it. */
  stationHalf: 9,
  pillars: [-5.5, 5.5] as readonly number[],
  /** From a chair's grip on the cable down to its seat's top. */
  hang: 2.7,
  /** The seats across a chair, from the rider's left. The skier takes the last (the outside). */
  seats: [-0.78, -0.26, 0.26, 0.78] as readonly number[],
  /** The skier's feet (the skis' level) against the seat's top: below it, and ahead of its middle. */
  feetBelow: 0.47,
  feetAhead: 0.42,
  /** Distance (m) between towers, about. */
  spacing: 55,
};

export interface LiftPath {
  /** The loop, a sample every SAMPLE m: the grip's place and the heading of travel. */
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  yaw: Float32Array;
  /** How far each sample is from the nearer station's bullwheel, along the line. */
  out: Float32Array;
  /** Seconds from sample 0 to each sample at the loop's speeds; one more entry than samples (the whole loop). */
  time: Float32Array;
  period: number;
  count: number;
  /** Chairs on the loop, and the seconds between them. */
  chairs: number;
  interval: number;
  /** Distance along the loop where a chair picks the skier up, and where it lets them off; and the up side's length. */
  loadS: number;
  unloadS: number;
  upLength: number;
  /** Where the skier waits (the seat's place at loadS, on the snow) and the heading of travel there. */
  loadX: number;
  loadZ: number;
  loadYaw: number;
  /** The way off at the top: a half circle to the right from the seat's place at unloadS. */
  exitX: number;
  exitZ: number;
  exitYaw: number;
  /** The line's ends (bottom, top), its unit direction up it, and the spots of its towers between. */
  bottom: XZ;
  top: XZ;
  dirX: number;
  dirZ: number;
  towers: XZ[];
  /** World height of the cable at each tower, and of each station's floor (bottom, top). */
  towerY: number[];
  floorY: [number, number];
}

export interface Lifts {
  paths: LiftPath[];
  /** Seconds the lifts have run, and what that was one step ago (for drawing between steps). */
  clock: number;
  prev: number;
  /** How fast the clock runs now (1, or more while the skier rides the line). */
  rate: number;
}

/** A chair's grip: where it is, the heading of travel, and how far along the loop. */
export interface ChairSpot {
  x: number;
  y: number;
  z: number;
  yaw: number;
  s: number;
}

/** The lifts riders can take among a map's lines, or undefined when there are none. */
export function buildLifts(lines: readonly LineDecor[], hf: Heightfield): Lifts | undefined {
  const paths = lines.filter((l) => l.kind === 'chairlift' && l.ride && l.points.length >= 2).map((l) => buildPath(l.points, hf));
  return paths.length > 0 ? { paths, clock: 0, prev: 0, rate: 1 } : undefined;
}

function smooth(e0: number, e1: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function buildPath(points: readonly XZ[], hf: Heightfield): LiftPath {
  const C = CONFIG.lift;
  const bottom = points[0]!;
  const top = points[points.length - 1]!;
  const len = Math.hypot(top.x - bottom.x, top.z - bottom.z);
  const dirX = (top.x - bottom.x) / len;
  const dirZ = (top.z - bottom.z) / len;
  // The right-hand side looking up the line: the up cable's.
  const rx = -dirZ;
  const rz = dirX;
  const spans = Math.max(2, Math.round(len / LIFT.spacing));
  const spot = (i: number): XZ => ({ x: bottom.x + (dirX * len * i) / spans, z: bottom.z + (dirZ * len * i) / spans });
  const floorY: [number, number] = [heightAt(hf, bottom.x, bottom.z), heightAt(hf, top.x, top.z)];
  const stationY = (end: 0 | 1): number => floorY[end] + C.stationCable;
  const towers: XZ[] = [];
  const towerY: number[] = [];
  for (let i = 1; i < spans; i++) {
    const p = spot(i);
    towers.push(p);
    towerY.push(heightAt(hf, p.x, p.z) + C.towerHeight);
  }
  /** The cable's height `a` m up the line from the bottom bullwheel: level through the stations, sagging between towers. */
  const cableY = (a: number): number => {
    const span = len / spans;
    const i = Math.min(spans - 1, Math.max(0, Math.floor(a / span)));
    const a0 = i * span;
    const y0 = i === 0 ? stationY(0) : towerY[i - 1]!;
    const y1 = i === spans - 1 ? stationY(1) : towerY[i]!;
    // The end spans stay level inside their station, then climb to (or come down from) the first tower.
    const from = i === 0 ? LIFT.stationHalf : 0;
    const to = i === spans - 1 ? span - LIFT.stationHalf : span;
    const u = Math.min(1, Math.max(0, (a - a0 - from) / (to - from)));
    return y0 + (y1 - y0) * u - C.sag * 4 * u * (1 - u);
  };
  // The loop as points: up the right side, round the top wheel, down the left, round the bottom wheel.
  const pts: { x: number; y: number; z: number; out: number }[] = [];
  const step = 1;
  const along = (a: number, side: number): void => {
    pts.push({ x: bottom.x + dirX * a + rx * LIFT.arm * side, y: cableY(a), z: bottom.z + dirZ * a + rz * LIFT.arm * side, out: Math.min(a, len - a) });
  };
  const wheel = (end: 0 | 1, from: number): void => {
    const c = end === 0 ? bottom : top;
    const away = end === 0 ? -1 : 1;
    const n = 10;
    for (let k = 1; k < n; k++) {
      const t = (Math.PI * k) / n;
      const across = Math.cos(t) * from;
      const past = Math.sin(t) * away;
      pts.push({ x: c.x + (rx * across + dirX * past) * LIFT.arm, y: stationY(end), z: c.z + (rz * across + dirZ * past) * LIFT.arm, out: 0 });
    }
  };
  for (let a = 0; a < len; a += step) along(a, 1);
  along(len, 1);
  const upPoints = pts.length;
  wheel(1, 1);
  for (let a = len; a > 0; a -= step) along(a, -1);
  along(0, -1);
  wheel(0, -1);
  // Resample evenly by length.
  const cum = [0];
  for (let i = 1; i <= pts.length; i++) {
    const p = pts[i - 1]!;
    const q = pts[i % pts.length]!;
    cum.push(cum[i - 1]! + Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z));
  }
  const total = cum[pts.length]!;
  const count = Math.floor(total / SAMPLE);
  const x = new Float32Array(count);
  const y = new Float32Array(count);
  const z = new Float32Array(count);
  const yaw = new Float32Array(count);
  const out = new Float32Array(count);
  const time = new Float32Array(count + 1);
  let seg = 0;
  for (let k = 0; k < count; k++) {
    const s = k * SAMPLE;
    while (seg < pts.length - 1 && cum[seg + 1]! < s) seg++;
    const p = pts[seg]!;
    const q = pts[(seg + 1) % pts.length]!;
    const t = (s - cum[seg]!) / Math.max(1e-6, cum[seg + 1]! - cum[seg]!);
    x[k] = p.x + (q.x - p.x) * t;
    y[k] = p.y + (q.y - p.y) * t;
    z[k] = p.z + (q.z - p.z) * t;
    yaw[k] = Math.atan2(-(q.x - p.x), -(q.z - p.z));
    out[k] = p.out + (q.out - p.out) * t;
  }
  for (let k = 0; k < count; k++) {
    const v = C.stationSpeed + (C.lineSpeed - C.stationSpeed) * smooth(LIFT.stationHalf, LIFT.stationHalf + C.ramp, out[k]!);
    time[k + 1] = time[k]! + SAMPLE / v;
  }
  const period = time[count]!;
  const chairs = Math.max(2, Math.round(period / C.interval));
  const upLength = cum[upPoints - 1]!;
  const loadS = 3;
  const unloadS = upLength - 3;
  // The skier's seat is the chair's outside one: to the right of travel on the up side.
  const seat = LIFT.seats[LIFT.seats.length - 1]!;
  const loadYaw = Math.atan2(-dirX, -dirZ);
  const seatAt = (a: number): XZ => ({ x: bottom.x + dirX * a + rx * (LIFT.arm + seat), z: bottom.z + dirZ * a + rz * (LIFT.arm + seat) });
  const load = seatAt(loadS);
  const off = seatAt(len - 3);
  return {
    x,
    y,
    z,
    yaw,
    out,
    time,
    period,
    count,
    chairs,
    interval: period / chairs,
    loadS,
    unloadS,
    upLength,
    loadX: load.x,
    loadZ: load.z,
    loadYaw,
    exitX: off.x,
    exitZ: off.z,
    exitYaw: loadYaw,
    bottom: { x: bottom.x, z: bottom.z },
    top: { x: top.x, z: top.z },
    dirX,
    dirZ,
    towers,
    towerY,
    floorY,
  };
}

/** Seconds from sample 0 to `s` m along the loop. */
function timeAt(p: LiftPath, s: number): number {
  const f = Math.min(p.count - 1e-6, Math.max(0, s / SAMPLE));
  const i = Math.floor(f);
  return p.time[i]! + (p.time[i + 1]! - p.time[i]!) * (f - i);
}

/** Where chair `c`'s grip is at `clock`. */
export function chairAt(p: LiftPath, clock: number, c: number, out: ChairSpot): void {
  let t = (clock + c * p.interval) % p.period;
  if (t < 0) t += p.period;
  // The sample holding t.
  let lo = 0;
  let hi = p.count;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (p.time[mid]! <= t) lo = mid;
    else hi = mid;
  }
  const f = (t - p.time[lo]!) / Math.max(1e-9, p.time[lo + 1]! - p.time[lo]!);
  const j = lo + 1 < p.count ? lo + 1 : 0;
  out.x = p.x[lo]! + (p.x[j]! - p.x[lo]!) * f;
  out.y = p.y[lo]! + (p.y[j]! - p.y[lo]!) * f;
  out.z = p.z[lo]! + (p.z[j]! - p.z[lo]!) * f;
  // Headings turn only round the wheels: blend the short way.
  let d = p.yaw[j]! - p.yaw[lo]!;
  d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
  out.yaw = p.yaw[lo]! + d * f;
  out.s = (lo + f) * SAMPLE;
}

/** How far out from the nearer station a point `s` m along the loop is. */
export function outAt(p: LiftPath, s: number): number {
  return p.out[Math.min(p.count - 1, Math.max(0, Math.round(s / SAMPLE)))]!;
}

/**
 * The chair that reaches the loading point within the next `dt` s of the
 * clock, or -1 when none does.
 */
export function chairArriving(p: LiftPath, clock: number, dt: number): number {
  const at = timeAt(p, p.loadS);
  let wait = (at - clock) % p.interval;
  if (wait < 0) wait += p.interval;
  if (wait > dt) return -1;
  const c = Math.round((at - clock - wait) / p.interval) % p.chairs;
  return c < 0 ? c + p.chairs : c;
}

/** Runs the lifts' clock on by one step: faster while the skier (on chair `chair` of lift `lift`, or -1) is out on the line. */
export function stepLifts(lifts: Lifts, lift: number, chair: number, dt: number): void {
  const C = CONFIG.lift;
  let target = 1;
  if (lift >= 0 && chair >= 0) {
    const p = lifts.paths[lift]!;
    chairAt(p, lifts.clock, chair, scratch);
    if (scratch.s < p.upLength) target = 1 + (C.rideBoost - 1) * smooth(C.boostFrom, C.boostFull, outAt(p, scratch.s));
  }
  lifts.rate += (target - lifts.rate) * (1 - Math.exp(-dt / C.boostEase));
  lifts.prev = lifts.clock;
  lifts.clock += dt * lifts.rate;
}

const scratch: ChairSpot = { x: 0, y: 0, z: 0, yaw: 0, s: 0 };
