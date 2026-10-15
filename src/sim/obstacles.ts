import { CONFIG } from '../config.ts';
import type { Heightfield, ObstacleDef, RailShape } from '../maps/types.ts';
import { heightAt, type Vec3Like } from './terrain.ts';

// Solid things on the course that aren't snow or rails: trees, rocks,
// fences, poles, huts. Each is a capsule seen from above (a segment from a to
// b with a radius; a = b for something round) standing from its base up to
// its top. A uniform grid keeps the per-step check to the few nearby ones.

export interface Obstacles {
  count: number;
  ax: Float32Array;
  az: Float32Array;
  bx: Float32Array;
  bz: Float32Array;
  radius: Float32Array;
  bottom: Float32Array;
  top: Float32Array;
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
    cell: CELL,
    originX: hf.originX,
    originZ: hf.originZ,
    cols: Math.ceil(((hf.cols - 1) * hf.cellSize) / CELL) + 1,
    rows: Math.ceil(((hf.rows - 1) * hf.cellSize) / CELL) + 1,
    start: new Int32Array(0),
    items: new Int32Array(0),
  };
  const cells: number[][] = Array.from({ length: o.cols * o.rows }, () => []);
  const reach = CONFIG.rails.bodyRadius;
  defs.forEach((d, i) => {
    o.ax[i] = d.ax;
    o.az[i] = d.az;
    o.bx[i] = d.bx;
    o.bz[i] = d.bz;
    o.radius[i] = d.radius;
    const ha = heightAt(hf, d.ax, d.az);
    const hb = heightAt(hf, d.bx, d.bz);
    o.bottom[i] = Math.min(ha, hb) - 0.5;
    o.top[i] = Math.max(ha, hb) + d.height;
    // Every cell the obstacle could touch a body in.
    const r = d.radius + reach;
    const c0 = cellOf(o, Math.min(d.ax, d.bx) - r, o.originX, o.cols);
    const c1 = cellOf(o, Math.max(d.ax, d.bx) + r, o.originX, o.cols);
    const r0 = cellOf(o, Math.min(d.az, d.bz) - r, o.originZ, o.rows);
    const r1 = cellOf(o, Math.max(d.az, d.bz) + r, o.originZ, o.rows);
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) cells[row * o.cols + col]!.push(i);
    }
  });
  o.start = new Int32Array(cells.length + 1);
  let total = 0;
  cells.forEach((list, k) => {
    o.start[k] = total;
    total += list.length;
  });
  o.start[cells.length] = total;
  o.items = new Int32Array(total);
  cells.forEach((list, k) => o.items.set(list, o.start[k] ?? 0));
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
  const head = CONFIG.air.headHeight;
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
    let nx = p.x - (ax + sx * t);
    let nz = p.z - (az + sz * t);
    const reach = (o.radius[i] ?? 0) + CONFIG.rails.bodyRadius;
    const d = Math.hypot(nx, nz);
    if (d >= reach) continue;
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
