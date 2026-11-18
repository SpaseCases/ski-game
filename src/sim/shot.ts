import { Vector3 } from 'three';
import { CONFIG } from '../config.ts';
import { SURFACE, shapeSurfaceAt } from '../maps/shapes.ts';
import type { RailShape } from '../maps/types.ts';
import type { Course, Obstacles } from './obstacles.ts';
import { groundAt, heightAt } from './terrain.ts';

// A shot's ray (milestone 25, the developer's powers; only the developer's
// chunk imports this). castShot finds the first thing a straight line from
// `origin` along `dir` meets: a rail or box (exactly, by closest approach
// to each segment of its top), an obstacle's capsule (trees, rocks, fences,
// walls) or the snow (marched in CONFIG.dev.shot.step steps, then the
// crossing found by halving), whose shapes are the ramps, pipes and
// buildings. It returns what it hit and where, so a later milestone (27,
// multiplayer) can add riders as another kind of target. Allocates nothing.

/** What a shot hit. */
export const HIT = { none: 0, snow: 1, hard: 2, tree: 3, rail: 4 } as const;

export interface ShotHit {
  /** One of HIT. */
  kind: number;
  point: Vector3;
  /** The surface's outward normal at the point. */
  normal: Vector3;
  /** Meters from the origin. */
  distance: number;
  /** The rail's or the obstacle's index; -1 for the snow. */
  index: number;
}

export function createShotHit(): ShotHit {
  return { kind: HIT.none, point: new Vector3(), normal: new Vector3(), distance: 0, index: -1 };
}

const at = new Vector3();
/** How many halvings find the crossing with the snow (0.5 m / 2^12: under a millimeter). */
const HALVINGS = 12;
/** How far back along the ray (m) to look for a wall: the snow rising more than WALL_RISE there means the ray ran into a side, not onto a top. */
const WALL_BACK = 0.05;
const WALL_RISE = 0.3;
/** An obstacle at least this tall (m) and this thick (m), standing on a point, is a tree: snow falls off it (a thin pole is hard). */
const TREE_HEIGHT = 3;
const TREE_RADIUS = 0.2;

/** Casts a shot; true when it hit something within `range`. `dir` must be unit length. */
export function castShot(course: Course, origin: Vector3, dir: Vector3, range: number, out: ShotHit): boolean {
  out.kind = HIT.none;
  out.index = -1;
  out.distance = range;
  railHit(course.rails, origin, dir, out);
  const hf = course.hf;
  const step = CONFIG.dev.shot.step;
  const maxX = hf.originX + (hf.cols - 1) * hf.cellSize;
  const maxZ = hf.originZ + (hf.rows - 1) * hf.cellSize;
  let lo = 0;
  for (let t = step; t <= out.distance + step; t += step) {
    const d = Math.min(t, out.distance);
    at.copy(origin).addScaledVector(dir, d);
    if (at.x < hf.originX || at.z < hf.originZ || at.x > maxX || at.z > maxZ) break;
    // Obstacles the piece of the ray from lo to d passes through (in its start's and end's grid cells).
    const obstacles = course.obstacles;
    let hit = -1;
    let end = d;
    if (obstacles.count > 0) {
      const k0 = cellAt(obstacles, origin.x + dir.x * lo, origin.z + dir.z * lo);
      const k1 = cellAt(obstacles, at.x, at.z);
      hit = obstacleOnPiece(obstacles, origin, dir, lo, d, k0);
      let hitT = pieceT;
      if (k1 !== k0) {
        const other = obstacleOnPiece(obstacles, origin, dir, lo, d, k1);
        if (other >= 0 && pieceT < hitT) {
          hit = other;
          hitT = pieceT;
        }
      }
      if (hit >= 0) end = hitT;
    }
    // The snow first, if the ray goes into it before the obstacle (or anywhere on this piece).
    at.copy(origin).addScaledVector(dir, end);
    if (at.y < heightAt(hf, at.x, at.z)) {
      // The crossing lies between lo and end: halve down to it.
      let a = lo;
      let b = end;
      for (let k = 0; k < HALVINGS; k++) {
        const m = (a + b) / 2;
        at.copy(origin).addScaledVector(dir, m);
        if (at.y < heightAt(hf, at.x, at.z)) b = m;
        else a = m;
      }
      setSnowHit(course, origin, dir, b, out);
      return true;
    }
    if (hit >= 0) {
      setObstacleHit(obstacles, hit, end, origin, dir, out);
      return true;
    }
    if (d >= out.distance) break;
    lo = d;
  }
  return out.kind !== HIT.none;
}

/** The snow (or a shape on it) at `t` along the ray: a wall the ray ran into, a steep face or wood is hard. */
function setSnowHit(course: Course, origin: Vector3, dir: Vector3, t: number, out: ShotHit): void {
  const hf = course.hf;
  const p = out.point.copy(origin).addScaledVector(dir, t);
  const ground = groundAt(hf, p.x, p.z, out.normal);
  const flat = Math.hypot(dir.x, dir.z);
  let wall = false;
  if (flat > 1e-4) {
    const bx = p.x - (dir.x / flat) * WALL_BACK;
    const bz = p.z - (dir.z / flat) * WALL_BACK;
    wall = ground - heightAt(hf, bx, bz) > WALL_RISE;
    if (wall) out.normal.set(-dir.x / flat, 0, -dir.z / flat);
  }
  out.kind = wall || out.normal.y < CONFIG.dev.shot.hardCos || shapeSurfaceAt(hf, p.x, p.z) === SURFACE.wood ? HIT.hard : HIT.snow;
  out.distance = t;
  out.index = -1;
}

/** The grid cell holding (x, z), or -1 off the grid. */
function cellAt(o: Obstacles, x: number, z: number): number {
  const col = Math.floor((x - o.originX) / o.cell);
  const row = Math.floor((z - o.originZ) / o.cell);
  if (col < 0 || row < 0 || col >= o.cols || row >= o.rows) return -1;
  return row * o.cols + col;
}

/** Where along the ray (m) obstacleOnPiece's hit begins. */
let pieceT = 0;

/**
 * The first obstacle of grid cell `k` (seen from above, a capsule: a
 * segment with a radius, between its bottom and top) that the ray's piece
 * from t0 to t1 enters, or -1. Sets pieceT to where it enters.
 */
function obstacleOnPiece(o: Obstacles, origin: Vector3, dir: Vector3, t0: number, t1: number, k: number): number {
  if (k < 0) return -1;
  let best = -1;
  let bestT = Infinity;
  const flat2 = dir.x * dir.x + dir.z * dir.z;
  for (let j = o.start[k]!; j < o.start[k + 1]!; j++) {
    const i = o.items[j]!;
    const ax = o.ax[i]!;
    const az = o.az[i]!;
    const ux = o.bx[i]! - ax;
    const uz = o.bz[i]! - az;
    const r = o.radius[i]!;
    // Closest approach, seen from above, of the ray's line and the capsule's segment.
    const wx = origin.x - ax;
    const wz = origin.z - az;
    const b = dir.x * ux + dir.z * uz;
    const c = ux * ux + uz * uz;
    const d = dir.x * wx + dir.z * wz;
    const e = ux * wx + uz * wz;
    const den = flat2 * c - b * b;
    let s = den > 1e-9 ? (b * e - c * d) / den : flat2 > 1e-9 ? -d / flat2 : t0;
    let u = c > 1e-9 ? (e + b * s) / c : 0;
    if (u < 0 || u > 1) {
      u = u < 0 ? 0 : 1;
      s = flat2 > 1e-9 ? (dir.x * (ax + ux * u - origin.x) + dir.z * (az + uz * u - origin.z)) / flat2 : t0;
    }
    const nx = origin.x + dir.x * s - (ax + ux * u);
    const nz = origin.z + dir.z * s - (az + uz * u);
    const gap2 = nx * nx + nz * nz;
    if (gap2 > r * r) continue;
    // Back to where the ray enters the circle, kept within this piece.
    const back = flat2 > 1e-9 ? Math.sqrt((r * r - gap2) / flat2) : 0;
    const t = Math.max(t0, s - back);
    if (t > t1 || s + back < t0 || t >= bestT) continue;
    const y = origin.y + dir.y * t;
    if (y < o.bottom[i]! || y > o.top[i]!) continue;
    const rise = o.rise[i]!;
    if (rise >= 0 && y > heightAt(o.hf, ax + ux * u, az + uz * u) + rise) continue;
    best = i;
    bestT = t;
  }
  pieceT = bestT;
  return best;
}

/** An obstacle hit at `t` along the ray: its normal points out from its middle line. */
function setObstacleHit(o: Obstacles, i: number, t: number, origin: Vector3, dir: Vector3, out: ShotHit): void {
  const p = out.point.copy(origin).addScaledVector(dir, t);
  const ax = o.ax[i]!;
  const az = o.az[i]!;
  const sx = o.bx[i]! - ax;
  const sz = o.bz[i]! - az;
  const len2 = sx * sx + sz * sz;
  const u = len2 > 1e-9 ? Math.min(1, Math.max(0, ((p.x - ax) * sx + (p.z - az) * sz) / len2)) : 0;
  out.normal.set(p.x - (ax + sx * u), 0, p.z - (az + sz * u));
  if (out.normal.lengthSq() < 1e-8) out.normal.set(-dir.x, 0, -dir.z);
  if (out.normal.lengthSq() < 1e-8) out.normal.set(0, 1, 0);
  out.normal.normalize();
  out.kind = len2 < 1e-4 && o.radius[i]! >= TREE_RADIUS && o.top[i]! - o.bottom[i]! > TREE_HEIGHT ? HIT.tree : HIT.hard;
  out.distance = t;
  out.index = i;
}

/** The nearest rail or box top the ray passes within its half width of (before out.distance). */
function railHit(rails: readonly RailShape[], origin: Vector3, dir: Vector3, out: ShotHit): void {
  for (let r = 0; r < rails.length; r++) {
    const rail = rails[r]!;
    const pts = rail.points;
    const reach = rail.halfWidth;
    for (let k = 0; k + 5 < pts.length; k += 3) {
      // Closest approach between the ray (origin + dir t, 0 <= t <= out.distance) and the segment a..b.
      const ax = pts[k]!;
      const ay = pts[k + 1]!;
      const az = pts[k + 2]!;
      const ux = pts[k + 3]! - ax;
      const uy = pts[k + 4]! - ay;
      const uz = pts[k + 5]! - az;
      const wx = origin.x - ax;
      const wy = origin.y - ay;
      const wz = origin.z - az;
      const b = dir.x * ux + dir.y * uy + dir.z * uz;
      const c = ux * ux + uy * uy + uz * uz;
      const d = dir.x * wx + dir.y * wy + dir.z * wz;
      const e = ux * wx + uy * wy + uz * wz;
      const den = c - b * b;
      let s = den > 1e-9 ? (b * e - c * d) / den : 0;
      if (s < 0 || s > out.distance) continue;
      let u = c > 1e-9 ? (e + b * s) / c : 0;
      if (u < 0 || u > 1) {
        u = u < 0 ? 0 : 1;
        // The end point's closest spot along the ray.
        s = dir.x * (ax + ux * u - origin.x) + dir.y * (ay + uy * u - origin.y) + dir.z * (az + uz * u - origin.z);
        if (s < 0 || s > out.distance) continue;
      }
      const px = origin.x + dir.x * s;
      const py = origin.y + dir.y * s;
      const pz = origin.z + dir.z * s;
      const nx = px - (ax + ux * u);
      const ny = py - (ay + uy * u);
      const nz = pz - (az + uz * u);
      const gap2 = nx * nx + ny * ny + nz * nz;
      if (gap2 > reach * reach) continue;
      // Where the ray enters the round top, not its middle.
      const back = Math.sqrt(Math.max(0, reach * reach - gap2));
      const t = Math.max(0, s - back);
      out.kind = HIT.rail;
      out.index = r;
      out.distance = t;
      out.point.copy(origin).addScaledVector(dir, t);
      out.normal.set(out.point.x - (ax + ux * u), out.point.y - (ay + uy * u), out.point.z - (az + uz * u));
      if (out.normal.lengthSq() < 1e-8) out.normal.copy(dir).negate();
      out.normal.normalize();
    }
  }
}
