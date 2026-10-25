import { TUNING } from './tuning.ts';
import type { Feature, Heightfield, RailShape } from '../maps/types.ts';
import { heightAt, type Vec3Like } from './terrain.ts';

// Rails and boxes, for the simulation. Each is a line along its top (a
// polyline in world space) that the skis slide on. Queries work on the line
// seen from above: a point is "over" a segment when it projects inside it,
// and its distance across is measured to the right of the segment's direction.

/** Radius (m) of a fallen tree, and of a tube, unless its rail gives one. */
const LOG_RADIUS = 0.3;
const TUBE_RADIUS = 0.35;

/** Builds the slide lines for every rail and box in the map, sitting on the snow (and on any shapes built on it). */
export function buildRailShapes(features: readonly Feature[], hf: Heightfield): RailShape[] {
  const shapes: RailShape[] = [];
  for (const f of features) {
    if (f.type !== 'box' && f.type !== 'rail') continue;
    const halfWidth = f.type === 'box' ? f.width / 2 : f.radius > 0 ? f.radius : f.style === 'log' ? LOG_RADIUS : f.style === 'tube' ? TUBE_RADIUS : TUNING.rails.radius;
    // Logs, benches, stumps, tables and spools are wood, ledges and rocks stone; park box decks and rails are metal
    // (barrels are steel, but slide like any box).
    const metal = f.type === 'rail' ? f.style !== 'log' : f.style === 'wood';
    const points = f.points.map((p) => [p.x, p.z, p.height] as const);
    shapes.push(makeShape(f.type, f.style, metal, halfWidth, f.follow > 0 ? followSnow(points, f.follow) : points, hf));
  }
  return shapes;
}

type LinePoint = readonly [x: number, z: number, height: number];

/** Adds points every `spacing` m along each segment, heights blended linearly, so the line rides the snow's curves. */
function followSnow(points: readonly LinePoint[], spacing: number): LinePoint[] {
  const out: LinePoint[] = [points[0]!];
  for (let i = 1; i < points.length; i++) {
    const [ax, az, ah] = points[i - 1]!;
    const [bx, bz, bh] = points[i]!;
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / spacing));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      out.push([ax + (bx - ax) * t, az + (bz - az) * t, ah + (bh - ah) * t]);
    }
  }
  return out;
}

function makeShape(kind: RailShape['kind'], look: RailShape['look'], metal: boolean, halfWidth: number, points: readonly LinePoint[], hf: Heightfield): RailShape {
  const xyz = new Float32Array(points.length * 3);
  const dist = new Float32Array(points.length);
  let px = 0;
  let py = 0;
  let pz = 0;
  const box = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  points.forEach(([x, z, height], i) => {
    const y = heightAt(hf, x, z) + height;
    xyz.set([x, y, z], i * 3);
    if (i > 0) dist[i] = (dist[i - 1] ?? 0) + Math.hypot(x - px, y - py, z - pz);
    px = x;
    py = y;
    pz = z;
    box.minX = Math.min(box.minX, x);
    box.maxX = Math.max(box.maxX, x);
    box.minZ = Math.min(box.minZ, z);
    box.maxZ = Math.max(box.maxZ, z);
  });
  return { kind, look, metal, points: xyz, dist, length: dist[points.length - 1] ?? 0, halfWidth, ...box };
}

/** True when (x, z) is more than `reach` beyond a rail's bounding box. */
function farFrom(r: RailShape, x: number, z: number, reach: number): boolean {
  return x < r.minX - reach || x > r.maxX + reach || z < r.minZ - reach || z > r.maxZ + reach;
}

/** Where a point sits relative to a rail: see railUnder. */
export interface RailSpot {
  rail: number;
  seg: number;
  /** Distance along the rail's top from its first point. */
  s: number;
  /** Height of the top there. */
  top: number;
  /** Distance across the top, to the right of the rail's direction (m). */
  side: number;
}

// Segment scratch, filled by segment().
let ax = 0;
let ay = 0;
let az = 0;
let by = 0;
let hx = 0;
let hz = 0;
let lenH = 0;

/** Loads segment k of a rail into the scratch: start, end height, direction and length seen from above. */
function segment(r: RailShape, k: number): void {
  const p = r.points;
  ax = p[k * 3] ?? 0;
  ay = p[k * 3 + 1] ?? 0;
  az = p[k * 3 + 2] ?? 0;
  const bx = p[k * 3 + 3] ?? 0;
  by = p[k * 3 + 4] ?? 0;
  const bz = p[k * 3 + 5] ?? 0;
  lenH = Math.hypot(bx - ax, bz - az);
  hx = lenH > 1e-6 ? (bx - ax) / lenH : 0;
  hz = lenH > 1e-6 ? (bz - az) / lenH : -1;
}

/**
 * Finds the rail or box whose top passes over (x, z), at most `reach` meters
 * beyond its edge. The nearest one across wins. Returns false if none.
 */
export function railUnder(rails: readonly RailShape[], x: number, z: number, reach: number, out: RailSpot): boolean {
  let best = Infinity;
  for (let i = 0; i < rails.length; i++) {
    const r = rails[i]!;
    if (farFrom(r, x, z, r.halfWidth + reach)) continue;
    const segs = r.dist.length - 1;
    for (let k = 0; k < segs; k++) {
      segment(r, k);
      const rx = x - ax;
      const rz = z - az;
      const u = rx * hx + rz * hz;
      if (u < 0 || u > lenH) continue;
      const v = -rx * hz + rz * hx;
      const across = Math.abs(v);
      if (across > r.halfWidth + reach || across >= best) continue;
      best = across;
      const t = lenH > 1e-6 ? u / lenH : 0;
      out.rail = i;
      out.seg = k;
      out.top = ay + t * (by - ay);
      out.s = (r.dist[k] ?? 0) + t * ((r.dist[k + 1] ?? 0) - (r.dist[k] ?? 0));
      out.side = v;
    }
  }
  return best < Infinity;
}

/**
 * The point on a rail's top at distance `s` along it (clamped to the rail),
 * and the unit direction of the rail there. Returns the segment index.
 */
export function railFrame(r: RailShape, s: number, pos: Vec3Like, dir: Vec3Like): number {
  // The segment holding s: the last k with dist[k] < s (binary search; a long rail has hundreds).
  let k = 0;
  let hi = r.dist.length - 2;
  while (k < hi) {
    const mid = (k + hi + 1) >> 1;
    if (s > (r.dist[mid] ?? 0)) k = mid;
    else hi = mid - 1;
  }
  const p = r.points;
  const x0 = p[k * 3] ?? 0;
  const y0 = p[k * 3 + 1] ?? 0;
  const z0 = p[k * 3 + 2] ?? 0;
  const dx = (p[k * 3 + 3] ?? 0) - x0;
  const dy = (p[k * 3 + 4] ?? 0) - y0;
  const dz = (p[k * 3 + 5] ?? 0) - z0;
  const len = (r.dist[k + 1] ?? 0) - (r.dist[k] ?? 0);
  const t = len > 1e-6 ? Math.min(1, Math.max(0, (s - (r.dist[k] ?? 0)) / len)) : 0;
  pos.x = x0 + dx * t;
  pos.y = y0 + dy * t;
  pos.z = z0 + dz * t;
  const inv = len > 1e-6 ? 1 / len : 0;
  dir.x = dx * inv;
  dir.y = dy * inv;
  dir.z = dz * inv;
  return k;
}

/**
 * Keeps a body at feet position `p` out of the sides and ends of rails and
 * boxes, where its feet are below their top. Pushes it out the nearest way
 * and drops any velocity into the face. Returns the fastest speed it was
 * moving into a face (0 for a touch), or -1 if it touched nothing.
 */
export function collideRails(rails: readonly RailShape[], p: Vec3Like, v: Vec3Like): number {
  const R = TUNING.rails;
  const radius = R.bodyRadius;
  let hit = -1;
  for (let i = 0; i < rails.length; i++) {
    const r = rails[i]!;
    if (farFrom(r, p.x, p.z, r.halfWidth + radius)) continue;
    const segs = r.dist.length - 1;
    for (let k = 0; k < segs; k++) {
      segment(r, k);
      const first = k === 0;
      const last = k === segs - 1;
      const rx = p.x - ax;
      const rz = p.z - az;
      const u = rx * hx + rz * hz;
      const side = -rx * hz + rz * hx;
      const reach = r.halfWidth + radius;
      if (u <= (first ? -radius : 0) || u >= (last ? lenH + radius : lenH)) continue;
      if (Math.abs(side) >= reach) continue;
      const t = lenH > 1e-6 ? Math.min(1, Math.max(0, u / lenH)) : 0;
      if (p.y > ay + t * (by - ay) - R.stepTolerance) continue;

      // Out the nearest way: off a side, or off either end of the whole line.
      const sign = side < 0 ? -1 : 1;
      let depth = reach - Math.abs(side);
      let nx = -hz * sign;
      let nz = hx * sign;
      if (first && u + radius < depth) {
        depth = u + radius;
        nx = -hx;
        nz = -hz;
      }
      if (last && lenH + radius - u < depth) {
        depth = lenH + radius - u;
        nx = hx;
        nz = hz;
      }
      p.x += nx * depth;
      p.z += nz * depth;
      const into = -(v.x * nx + v.z * nz);
      if (into > 0) {
        v.x += nx * into;
        v.z += nz * into;
      }
      hit = Math.max(hit, into > 0 ? into : 0);
    }
  }
  return hit;
}
