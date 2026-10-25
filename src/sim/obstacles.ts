import { TUNING } from './tuning.ts';
import type { Heightfield, ObstacleDef, RailShape } from '../maps/types.ts';
import { heightAt, type Vec3Like } from './terrain.ts';

// Solid things on the course that aren't snow or rails: trees, rocks,
// fences, poles, huts. Each is a capsule seen from above (a segment from a to
// b with a radius; a = b for something round) standing from its base up to
// its top. A fence's top follows the snow along it, so on a slope it's no
// taller at its low end than it looks. A uniform grid keeps the per-step
// check to the few nearby ones.

export interface Obstacles {
  count: number;
  ax: Float32Array;
  az: Float32Array;
  bx: Float32Array;
  bz: Float32Array;
  radius: Float32Array;
  /** World heights it stands between; for one that follows the snow, the lowest and highest along it. */
  bottom: Float32Array;
  top: Float32Array;
  /** Height above the snow for one whose top follows the snow (a fence), or -1. */
  rise: Float32Array;
  /** The snow the fences follow. */
  hf: Heightfield;
  /** Grid: cell size, origin and size, and for each cell its slice of `items`. */
  cell: number;
  originX: number;
  originZ: number;
  cols: number;
  rows: number;
  start: Int32Array;
  items: Int32Array;
}

/** Everything a rider can touch: the snow, rails and boxes, and obstacles. */
export interface Course {
  hf: Heightfield;
  rails: readonly RailShape[];
  obstacles: Obstacles;
}

const CELL = 8;
/** Spacing (m) of the snow samples that find how low and high a fence runs. */
const FOLLOW_STEP = 2;
/** How far (m) under the snow an obstacle's base reaches. */
const SINK = 0.5;

export function buildObstacles(defs: readonly ObstacleDef[], hf: Heightfield): Obstacles {
  const n = defs.length;
  const o: Obstacles = {
    count: n,
    ax: new Float32Array(n),
    az: new Float32Array(n),
    bx: new Float32Array(n),
    bz: new Float32Array(n),
    radius: new Float32Array(n),
    bottom: new Float32Array(n),
    top: new Float32Array(n),
    rise: new Float32Array(n),
    hf,
    cell: CELL,
    originX: hf.originX,
    originZ: hf.originZ,
    cols: Math.ceil(((hf.cols - 1) * hf.cellSize) / CELL) + 1,
    rows: Math.ceil(((hf.rows - 1) * hf.cellSize) / CELL) + 1,
    start: new Int32Array(0),
    items: new Int32Array(0),
  };
  // Every cell an obstacle could touch a body in: count them per cell, then
  // fill each cell's slice of one array (big maps have too many cells for a
  // list each).
  const reach = TUNING.rails.bodyRadius;
  const span = new Int32Array(n * 4);
  const counts = new Int32Array(o.cols * o.rows + 1);
  defs.forEach((d, i) => {
    o.ax[i] = d.ax;
    o.az[i] = d.az;
    o.bx[i] = d.bx;
    o.bz[i] = d.bz;
    o.radius[i] = d.radius;
    o.rise[i] = -1;
    if (d.follow && d.y0 === undefined && d.y1 === undefined) {
      // The lowest and highest snow along it bound it; the check uses the snow at the nearest point.
      const steps = Math.max(1, Math.ceil(Math.hypot(d.bx - d.ax, d.bz - d.az) / FOLLOW_STEP));
      let lo = Infinity;
      let hi = -Infinity;
      for (let k = 0; k <= steps; k++) {
        const g = heightAt(hf, d.ax + ((d.bx - d.ax) * k) / steps, d.az + ((d.bz - d.az) * k) / steps);
        lo = Math.min(lo, g);
        hi = Math.max(hi, g);
      }
      o.bottom[i] = lo - SINK;
      o.top[i] = hi + d.height;
      o.rise[i] = d.height;
    } else {
      const ha = d.y0 !== undefined && d.y1 !== undefined ? 0 : heightAt(hf, d.ax, d.az);
      const hb = d.y0 !== undefined && d.y1 !== undefined ? 0 : heightAt(hf, d.bx, d.bz);
      o.bottom[i] = d.y0 ?? Math.min(ha, hb) - SINK;
      o.top[i] = d.y1 ?? Math.max(ha, hb) + d.height;
    }
    const r = d.radius + reach;
    span[i * 4] = cellOf(o, Math.min(d.ax, d.bx) - r, o.originX, o.cols);
    span[i * 4 + 1] = cellOf(o, Math.max(d.ax, d.bx) + r, o.originX, o.cols);
    span[i * 4 + 2] = cellOf(o, Math.min(d.az, d.bz) - r, o.originZ, o.rows);
    span[i * 4 + 3] = cellOf(o, Math.max(d.az, d.bz) + r, o.originZ, o.rows);
    for (let row = span[i * 4 + 2]!; row <= span[i * 4 + 3]!; row++) {
      for (let col = span[i * 4]!; col <= span[i * 4 + 1]!; col++) counts[row * o.cols + col]!++;
    }
  });
  o.start = new Int32Array(o.cols * o.rows + 1);
  for (let k = 0; k < o.cols * o.rows; k++) o.start[k + 1] = o.start[k]! + counts[k]!;
  o.items = new Int32Array(o.start[o.cols * o.rows]!);
  const fill = o.start.slice(0, o.cols * o.rows);
  for (let i = 0; i < n; i++) {
    for (let row = span[i * 4 + 2]!; row <= span[i * 4 + 3]!; row++) {
      for (let col = span[i * 4]!; col <= span[i * 4 + 1]!; col++) o.items[fill[row * o.cols + col]!++] = i;
    }
  }
  return o;
}

function cellOf(o: Obstacles, coord: number, origin: number, size: number): number {
  return Math.min(size - 1, Math.max(0, Math.floor((coord - origin) / o.cell)));
}

/**
 * Keeps a body with feet at `p` out of obstacles: pushes it out sideways and
 * drops any velocity into them. Returns the fastest speed it was moving into
 * one (0 for a touch), or -1 if it touched nothing. Feet above an obstacle's
 * top pass over it.
 */
export function collideObstacles(o: Obstacles, p: Vec3Like, v: Vec3Like): number {
  if (o.count === 0) return -1;
  const col = Math.floor((p.x - o.originX) / o.cell);
  const row = Math.floor((p.z - o.originZ) / o.cell);
  if (col < 0 || row < 0 || col >= o.cols || row >= o.rows) return -1;
  const k = row * o.cols + col;
  const head = TUNING.air.headHeight;
  let hit = -1;
  for (let j = o.start[k] ?? 0; j < (o.start[k + 1] ?? 0); j++) {
    const i = o.items[j] ?? 0;
    if (p.y > (o.top[i] ?? 0) || p.y + head < (o.bottom[i] ?? 0)) continue;
    // Closest point on the segment, seen from above.
    const ax = o.ax[i] ?? 0;
    const az = o.az[i] ?? 0;
    const sx = (o.bx[i] ?? 0) - ax;
    const sz = (o.bz[i] ?? 0) - az;
    const len2 = sx * sx + sz * sz;
    const t = len2 > 1e-9 ? Math.min(1, Math.max(0, ((p.x - ax) * sx + (p.z - az) * sz) / len2)) : 0;
    const cx = ax + sx * t;
    const cz = az + sz * t;
    let nx = p.x - cx;
    let nz = p.z - cz;
    const reach = (o.radius[i] ?? 0) + TUNING.rails.bodyRadius;
    const d = Math.hypot(nx, nz);
    if (d >= reach) continue;
    const rise = o.rise[i] ?? -1;
    if (rise >= 0) {
      // A fence: as high as it stands above the snow right here.
      const g = heightAt(o.hf, cx, cz);
      if (p.y > g + rise || p.y + head < g - SINK) continue;
    }
    if (d > 1e-6) {
      nx /= d;
      nz /= d;
    } else {
      // Dead center: back out the way it came.
      const s = Math.hypot(v.x, v.z);
      nx = s > 1e-6 ? -v.x / s : 1;
      nz = s > 1e-6 ? -v.z / s : 0;
    }
    p.x += nx * (reach - d);
    p.z += nz * (reach - d);
    const into = -(v.x * nx + v.z * nz);
    if (into > 0) {
      v.x += nx * into;
      v.z += nz * into;
    }
    hit = Math.max(hit, into > 0 ? into : 0);
  }
  return hit;
}
