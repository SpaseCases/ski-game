import type { Bounds } from '../maps/types.ts';
import type { Vec3Like } from './terrain.ts';

// The edge of the play area: a rectangle, and on maps that have one a
// polygon inside it. Riders meet it as an invisible wall.

/** How far (m) inside the rectangle's edges the skier is kept. */
const RECT_MARGIN = 1;
/** How far (m) inside the polygon a skier pushed back from it ends up. */
const POLYGON_MARGIN = 0.05;

/** True when (x, z) is inside the play area. */
export function insideBounds(b: Bounds, x: number, z: number): boolean {
  if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return false;
  return b.polygon.length < 6 || insidePolygon(b.polygon, x, z);
}

/**
 * Keeps a point inside the play area: back inside if it got out, with any
 * velocity out through the edge dropped. Returns true if it was pushed.
 */
export function keepInside(b: Bounds, p: Vec3Like, v: Vec3Like): boolean {
  let pushed = false;
  const minX = b.minX + RECT_MARGIN;
  const maxX = b.maxX - RECT_MARGIN;
  const minZ = b.minZ + RECT_MARGIN;
  const maxZ = b.maxZ - RECT_MARGIN;
  if (p.x < minX) {
    p.x = minX;
    if (v.x < 0) v.x = 0;
    pushed = true;
  } else if (p.x > maxX) {
    p.x = maxX;
    if (v.x > 0) v.x = 0;
    pushed = true;
  }
  if (p.z < minZ) {
    p.z = minZ;
    if (v.z < 0) v.z = 0;
    pushed = true;
  } else if (p.z > maxZ) {
    p.z = maxZ;
    if (v.z > 0) v.z = 0;
    pushed = true;
  }
  const poly = b.polygon;
  if (poly.length < 6 || insidePolygon(poly, p.x, p.z)) return pushed;

  // Outside the polygon: back to the nearest point on its edge, then a little in.
  let best = Infinity;
  let qx = p.x;
  let qz = p.z;
  const n = poly.length / 2;
  for (let i = 0; i < n; i++) {
    const ax = poly[i * 2]!;
    const az = poly[i * 2 + 1]!;
    const j = (i + 1) % n;
    const sx = poly[j * 2]! - ax;
    const sz = poly[j * 2 + 1]! - az;
    const len2 = sx * sx + sz * sz;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((p.x - ax) * sx + (p.z - az) * sz) / len2)) : 0;
    const cx = ax + sx * t;
    const cz = az + sz * t;
    const d2 = (p.x - cx) ** 2 + (p.z - cz) ** 2;
    if (d2 < best) {
      best = d2;
      qx = cx;
      qz = cz;
    }
  }
  const d = Math.sqrt(best);
  if (d < 1e-9) return true;
  // Inward: from the point toward the edge, and on past it.
  const nx = (qx - p.x) / d;
  const nz = (qz - p.z) / d;
  p.x = qx + nx * POLYGON_MARGIN;
  p.z = qz + nz * POLYGON_MARGIN;
  const into = v.x * nx + v.z * nz;
  if (into < 0) {
    v.x -= nx * into;
    v.z -= nz * into;
  }
  return true;
}

/** Flat distance (m) from (x, z) to the nearest edge of the play area's polygon (or rectangle when there's none). */
export function boundsDistance(b: Bounds, x: number, z: number): number {
  const poly = b.polygon;
  if (poly.length < 6) return Math.min(Math.abs(x - b.minX), Math.abs(x - b.maxX), Math.abs(z - b.minZ), Math.abs(z - b.maxZ));
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
    best = Math.min(best, (x - ax - sx * t) ** 2 + (z - az - sz * t) ** 2);
  }
  return Math.sqrt(best);
}

/** Even-odd test against a polygon given as x, z, x, z... */
function insidePolygon(poly: Float32Array, x: number, z: number): boolean {
  let inside = false;
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i * 2]!;
    const zi = poly[i * 2 + 1]!;
    const xj = poly[j * 2]!;
    const zj = poly[j * 2 + 1]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
