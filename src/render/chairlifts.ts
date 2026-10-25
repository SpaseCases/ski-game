import { Color, Group, InstancedMesh, MeshLambertMaterial, type BufferGeometry } from 'three';
import { alongLine, DECOR_SIZE } from '../maps/decor.ts';
import { hash2 } from '../maps/terrain.ts';
import type { Heightfield, LineDecor, XZ } from '../maps/types.ts';
import { MeshKit } from './meshKit.ts';
import { FLAG_COLORS, PALETTE } from './models.ts';
import { drawnHeightAt } from './terrainMesh.ts';
import { uploadFirst } from './upload.ts';

// The chairlifts' moving parts: chairs running round each lift's cable
// loop (up one side, round the top station's bullwheel, down the other and
// round the bottom one), riders on some of them, and the bullwheels
// turning. The towers, cables and stations are static decoration (see
// render/decor.ts, which draws the cable from the same liftLine). Chairs are
// instanced, one draw call for all chairs, one for all riders, one for all
// wheels, and only the ones near the camera are placed each frame.

/** Cable speed (m/s), and the distance (m) between chairs along it. */
const SPEED = 2.4;
const CHAIR_GAP = 14;
/** The cable's sag (m) midway between two towers. */
export const CABLE_SAG = 1.2;
/** Half the distance (m) between the up and down cables. */
export const CABLE_ARM = 2.2;
/** Chairs this far (m) past the view range are still placed (they hang well below the cable). */
const SLACK = 40;
/** Distance (m) between samples of the cable loop. */
const SAMPLE = 1;

/** A lift's line: its towers (stations at the ends), the cable's height at each, and the cable between. */
export interface LiftLine {
  spots: XZ[];
  /** World height of the cable at each spot. */
  heights: number[];
}

export function liftLine(points: readonly XZ[], hf: Heightfield): LiftLine {
  const S = DECOR_SIZE;
  const spots = alongLine(points, S.chairliftSpacing);
  const last = spots.length - 1;
  // Low through the stations, high over the towers.
  const heights = spots.map((p, i) => drawnHeightAt(hf, p.x, p.z) + (i === 0 || i === last ? S.liftStation.height - 1.3 : S.chairliftHeight - 0.2));
  return { spots, heights };
}

/** A point on the cable `t` (0..1) of the way from spot i to i + 1, on the side `side` (-1 or 1) of the line. */
export function cablePoint(line: LiftLine, i: number, t: number, side: number, out: { x: number; y: number; z: number }): void {
  const a = line.spots[i]!;
  const b = line.spots[i + 1]!;
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const rx = -(b.z - a.z) / len;
  const rz = (b.x - a.x) / len;
  const ya = line.heights[i]!;
  const yb = line.heights[i + 1]!;
  out.x = a.x + (b.x - a.x) * t + rx * CABLE_ARM * side;
  out.y = ya + (yb - ya) * t - CABLE_SAG * 4 * t * (1 - t);
  out.z = a.z + (b.z - a.z) * t + rz * CABLE_ARM * side;
}

/** One lift's loop, sampled every SAMPLE m: positions, the heading of travel, and its chairs. */
interface Loop {
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  yaw: Float32Array;
  length: number;
  chairs: number;
  /** Riders on each chair (0 to 2) and their colors. */
  riders: Uint8Array;
  /** Bounding square of the loop, for skipping lifts far from the camera. */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
/** The riders' own: their per-rider jacket colors need another shader program (one shared material would swap programs every frame). */
const riderMaterial = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
const RIDER_COLORS = ['#c8331f', '#2f6fe0', '#33c26a', '#e0c21f', '#8a4fd6', '#ff7a1a', '#1b2430', '#f4f6fa'].map((h) => new Color(h));

export class ChairliftView {
  readonly group = new Group();
  private readonly loops: Loop[] = [];
  private readonly chairs: InstancedMesh;
  private readonly riders: InstancedMesh;
  private readonly wheels: InstancedMesh | null;
  /** Each bullwheel's spot. */
  private readonly wheelAt: { x: number; y: number; z: number }[] = [];
  private time = 0;

  constructor(lines: readonly LineDecor[], hf: Heightfield) {
    let chairCount = 0;
    let riderCount = 0;
    for (const l of lines) {
      if (l.kind !== 'chairlift' || l.points.length < 2) continue;
      const line = liftLine(l.points, hf);
      const loop = buildLoop(line, this.loops.length);
      this.loops.push(loop);
      chairCount += loop.chairs;
      for (const n of loop.riders) riderCount += n;
      for (const i of [0, line.spots.length - 1]) this.wheelAt.push({ x: line.spots[i]!.x, y: line.heights[i]! + 0.15, z: line.spots[i]!.z });
    }
    this.chairs = new InstancedMesh(chairGeometry(), material, Math.max(1, chairCount));
    this.riders = new InstancedMesh(riderGeometry(), riderMaterial, Math.max(1, riderCount));
    this.wheels = this.wheelAt.length > 0 ? new InstancedMesh(wheelGeometry(), material, this.wheelAt.length) : null;
    // Every rider slot gets a jacket color (rewritten as the near ones are packed in each frame).
    for (let k = 0; k < riderCount; k++) this.riders.setColorAt(k, riderColor(k));
    for (const m of [this.chairs, this.riders, this.wheels]) {
      if (!m) continue;
      // Placed every frame, so their bounds are never known ahead: always drawn (only the near ones are in the list).
      m.frustumCulled = false;
      m.matrixAutoUpdate = false;
      m.count = 0;
      this.group.add(m);
    }
    this.group.matrixAutoUpdate = false;
  }

  /** Moves the chairs on by `dt` seconds and places the ones within `range` m of the camera at (cx, cz). */
  update(dt: number, cx: number, cz: number, range: number): void {
    this.time += dt;
    const reach = range + SLACK;
    const reach2 = reach * reach;
    const cm = this.chairs.instanceMatrix.array as Float32Array;
    const rm = this.riders.instanceMatrix.array as Float32Array;
    let chairs = 0;
    let riders = 0;
    let riderSlot = 0;
    for (const loop of this.loops) {
      const near = cx > loop.minX - reach && cx < loop.maxX + reach && cz > loop.minZ - reach && cz < loop.maxZ + reach;
      if (!near) {
        for (let c = 0; c < loop.chairs; c++) riderSlot += loop.riders[c]!;
        continue;
      }
      const shift = (this.time * SPEED) % loop.length;
      for (let c = 0; c < loop.chairs; c++) {
        const n = loop.riders[c]!;
        let s = c * CHAIR_GAP + shift;
        if (s >= loop.length) s -= loop.length;
        const f = s / SAMPLE;
        const i = Math.floor(f);
        const j = i + 1 < loop.x.length ? i + 1 : 0;
        const t = f - i;
        const x = loop.x[i]! + (loop.x[j]! - loop.x[i]!) * t;
        const z = loop.z[i]! + (loop.z[j]! - loop.z[i]!) * t;
        const dx = x - cx;
        const dz = z - cz;
        if (dx * dx + dz * dz > reach2) {
          riderSlot += n;
          continue;
        }
        const y = loop.y[i]! + (loop.y[j]! - loop.y[i]!) * t;
        const yaw = loop.yaw[i]!;
        const cos = Math.cos(yaw);
        const sin = Math.sin(yaw);
        writeYaw(cm, chairs++, x, y, z, cos, sin);
        const colors = this.riders.instanceColor?.array as Float32Array | undefined;
        for (let r = 0; r < n; r++) {
          // Side by side on the seat (a rider alone sits to one side).
          const off = n === 1 ? (riderSlot % 2 === 0 ? -0.35 : 0.35) : r === 0 ? -0.38 : 0.38;
          writeYaw(rm, riders, x + cos * off, y, z - sin * off, cos, sin);
          if (colors) {
            const color = riderColor(riderSlot);
            colors[riders * 3] = color.r;
            colors[riders * 3 + 1] = color.g;
            colors[riders * 3 + 2] = color.b;
          }
          riders++;
          riderSlot++;
        }
      }
    }
    this.chairs.count = chairs;
    this.riders.count = riders;
    // Upload only the part in use.
    uploadFirst(this.chairs.instanceMatrix, chairs * 16);
    uploadFirst(this.riders.instanceMatrix, riders * 16);
    if (this.riders.instanceColor) uploadFirst(this.riders.instanceColor, riders * 3);
    if (this.wheels) {
      // Each wheel turns at the cable's speed round its rim; only near ones are listed.
      const wm = this.wheels.instanceMatrix.array as Float32Array;
      const angle = (this.time * SPEED) / CABLE_ARM;
      let w = 0;
      for (const p of this.wheelAt) {
        const dx = p.x - cx;
        const dz = p.z - cz;
        if (dx * dx + dz * dz > reach2) continue;
        writeYaw(wm, w++, p.x, p.y, p.z, Math.cos(angle), Math.sin(angle));
      }
      this.wheels.count = w;
      uploadFirst(this.wheels.instanceMatrix, w * 16);
    }
  }
}

/** The jacket color of rider slot k. */
function riderColor(k: number): Color {
  return RIDER_COLORS[Math.floor((0.5 + 0.5 * hash2(k, 3, 7)) * RIDER_COLORS.length) % RIDER_COLORS.length]!;
}

/** Writes a matrix turning by a yaw (given as its cosine and sine) about +Y and moving to (x, y, z), into slot k. */
function writeYaw(a: Float32Array, k: number, x: number, y: number, z: number, cos: number, sin: number): void {
  const o = k * 16;
  a[o] = cos;
  a[o + 1] = 0;
  a[o + 2] = -sin;
  a[o + 3] = 0;
  a[o + 4] = 0;
  a[o + 5] = 1;
  a[o + 6] = 0;
  a[o + 7] = 0;
  a[o + 8] = sin;
  a[o + 9] = 0;
  a[o + 10] = cos;
  a[o + 11] = 0;
  a[o + 12] = x;
  a[o + 13] = y;
  a[o + 14] = z;
  a[o + 15] = 1;
}

/**
 * Samples a lift's whole cable loop every SAMPLE m: up the right-hand cable
 * (looking up the line) from the bottom station to the top, half round the
 * top bullwheel, down the left-hand cable, and half round the bottom one.
 */
function buildLoop(line: LiftLine, seed: number): Loop {
  const pts: { x: number; y: number; z: number }[] = [];
  const p = { x: 0, y: 0, z: 0 };
  const n = line.spots.length - 1;
  const span = (i: number, side: number, forward: boolean): void => {
    const a = line.spots[i]!;
    const b = line.spots[i + 1]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(2, Math.ceil(len / 2));
    for (let k = 0; k < steps; k++) {
      const t = forward ? k / steps : 1 - k / steps;
      cablePoint(line, i, t, side, p);
      pts.push({ ...p });
    }
  };
  /** Half round the wheel at spot i, from side `from` to the other. */
  const turn = (i: number, from: number): void => {
    const c = line.spots[i]!;
    const o = line.spots[i === 0 ? 1 : i - 1]!;
    const len = Math.hypot(o.x - c.x, o.z - c.z);
    // Along the line (toward the inside of the loop), and across it.
    const ux = (o.x - c.x) / len;
    const uz = (o.z - c.z) / len;
    const vx = i === 0 ? -uz : uz;
    const vz = i === 0 ? ux : -ux;
    const steps = 6;
    for (let k = 0; k < steps; k++) {
      const a = (Math.PI * k) / steps;
      // Starts on side `from` (across), swings out past the station's end, ends on the other side.
      const across = Math.cos(a) * from;
      const out = -Math.sin(a);
      pts.push({ x: c.x + (vx * across + ux * out) * CABLE_ARM, y: line.heights[i]!, z: c.z + (vz * across + uz * out) * CABLE_ARM });
    }
  };
  for (let i = 0; i < n; i++) span(i, 1, true);
  turn(n, 1);
  for (let i = n - 1; i >= 0; i--) span(i, -1, false);
  turn(0, -1);
  // Resample evenly by length along the loop.
  const cum = [0];
  for (let i = 1; i <= pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i % pts.length]!;
    cum.push(cum[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
  }
  const length = cum[cum.length - 1]!;
  const count = Math.floor(length / SAMPLE);
  const x = new Float32Array(count);
  const y = new Float32Array(count);
  const z = new Float32Array(count);
  const yaw = new Float32Array(count);
  let seg = 0;
  for (let k = 0; k < count; k++) {
    const s = k * SAMPLE;
    while (seg < pts.length - 1 && cum[seg + 1]! < s) seg++;
    const a = pts[seg]!;
    const b = pts[(seg + 1) % pts.length]!;
    const t = (s - cum[seg]!) / Math.max(1e-6, cum[seg + 1]! - cum[seg]!);
    x[k] = a.x + (b.x - a.x) * t;
    y[k] = a.y + (b.y - a.y) * t;
    z[k] = a.z + (b.z - a.z) * t;
    yaw[k] = Math.atan2(-(b.x - a.x), -(b.z - a.z));
  }
  const chairs = Math.floor(length / CHAIR_GAP);
  const riders = new Uint8Array(chairs);
  for (let c = 0; c < chairs; c++) {
    const r = 0.5 + 0.5 * hash2(c, seed, 29);
    riders[c] = r < 0.45 ? 0 : r < 0.8 ? 1 : 2;
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let k = 0; k < count; k++) {
    minX = Math.min(minX, x[k]!);
    maxX = Math.max(maxX, x[k]!);
    minZ = Math.min(minZ, z[k]!);
    maxZ = Math.max(maxZ, z[k]!);
  }
  return { x, y, z, yaw, length: count * SAMPLE, chairs, riders, minX, maxX, minZ, maxZ };
}

/** A chair hanging from its grip on the cable (local origin), facing -Z: the hanger, seat, back and footrest. */
function chairGeometry(): BufferGeometry {
  const k = new MeshKit();
  k.box(0, 0.05, 0, 0.3, 0.25, 0.4, PALETTE.dark);
  k.beam(0, 0, 0, 0, -1.7, 0.25, 0.06, PALETTE.post);
  k.beam(0, -1.7, 0.25, -0.75, -1.75, 0.3, 0.05, PALETTE.post);
  k.beam(0, -1.7, 0.25, 0.75, -1.75, 0.3, 0.05, PALETTE.post);
  k.box(0, -1.9, 0, 1.6, 0.1, 0.55, PALETTE.post);
  k.box(0, -1.55, 0.3, 1.6, 0.6, 0.08, PALETTE.post);
  // The safety bar down in front, with its footrest.
  k.beam(-0.7, -1.3, 0.3, -0.7, -1.4, -0.45, 0.04, PALETTE.metal);
  k.beam(-0.7, -1.4, -0.45, 0.7, -1.4, -0.45, 0.04, PALETTE.metal);
  k.beam(0, -1.4, -0.45, 0, -2.3, -0.5, 0.04, PALETTE.metal);
  k.beam(-0.5, -2.3, -0.5, 0.5, -2.3, -0.5, 0.05, PALETTE.metal);
  return k.geometry();
}

/**
 * A rider sitting on a chair, local origin at the chair's grip (so it
 * shares the chair's matrix plus a shift across): jacket (instance color)
 * and helmet, knees out over the seat's front, boots on the footrest, skis
 * hanging under them.
 */
function riderGeometry(): BufferGeometry {
  const k = new MeshKit();
  const jacket = new Color('#ffffff');
  k.box(0, -1.5, 0.12, 0.44, 0.62, 0.3, jacket);
  k.box(0, -1.08, 0.08, 0.26, 0.26, 0.26, PALETTE.dark);
  k.box(0, -1.08, -0.06, 0.2, 0.08, 0.04, FLAG_COLORS[3]!);
  // Arms resting on the safety bar.
  k.box(-0.26, -1.55, -0.12, 0.12, 0.12, 0.5, jacket);
  k.box(0.26, -1.55, -0.12, 0.12, 0.12, 0.5, jacket);
  // Thighs forward along the seat, shins down to the footrest.
  k.box(-0.11, -1.8, -0.15, 0.16, 0.16, 0.6, PALETTE.dark);
  k.box(0.11, -1.8, -0.15, 0.16, 0.16, 0.6, PALETTE.dark);
  k.box(-0.11, -2.1, -0.44, 0.15, 0.55, 0.15, PALETTE.dark);
  k.box(0.11, -2.1, -0.44, 0.15, 0.55, 0.15, PALETTE.dark);
  k.box(-0.11, -2.4, -0.5, 0.09, 0.05, 1.6, FLAG_COLORS[0]!);
  k.box(0.11, -2.4, -0.5, 0.09, 0.05, 1.6, FLAG_COLORS[0]!);
  return k.geometry();
}

/** A bullwheel: a rim on spokes round a hub, lying flat, so its turning shows. */
function wheelGeometry(): BufferGeometry {
  const k = new MeshKit();
  const r = CABLE_ARM;
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    k.beam(Math.cos(a0) * r, 0, Math.sin(a0) * r, Math.cos(a1) * r, 0, Math.sin(a1) * r, 0.22, i % 2 === 0 ? PALETTE.red : PALETTE.dark);
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI;
    k.beam(-Math.cos(a) * r, 0.05, -Math.sin(a) * r, Math.cos(a) * r, 0.05, Math.sin(a) * r, 0.12, PALETTE.metalDark);
  }
  k.prism(0, 0, -0.2, 0.9, 0.3, 0.3, 6, PALETTE.metalDark, true);
  return k.geometry();
}
