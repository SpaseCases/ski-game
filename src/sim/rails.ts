import { TUNING } from './tuning.ts';
import type { Feature, Heightfield, RailShape } from '../maps/types.ts';
import { heightAt, type Vec3Like } from './terrain.ts';

// Rails and boxes, for the simulation. Each is a line along its top (a
// polyline in world space) that the skis slide on. Queries work on the line
// seen from above: a point is "over" a segment when it projects inside it,
// and its distance across is measured to the right of the segment's direction.
//
// A 3D rail (a loop or a corkscrew) also carries its own up at each point,
// and can turn upside down. Seen from above it folds back over itself, so the
// queries only see its upright stretches (CONFIG.rails.uprightCos): the skis
// get onto it there, and round the rest of it slideRail holds them on.

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
    const ups = f.type === 'rail' ? f.ups : [];
    shapes.push(makeShape(f.type, f.style, metal, halfWidth, f.follow > 0 && ups.length === 0 ? followSnow(points, f.follow) : points, hf, ups));
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

function makeShape(
  kind: RailShape['kind'],
  look: RailShape['look'],
  metal: boolean,
  halfWidth: number,
  points: readonly LinePoint[],
  hf: Heightfield,
  ups: readonly (readonly [number, number, number])[],
): RailShape {
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
  const up = ups.length > 0 ? Float32Array.from(ups.flat()) : null;
  const bend = up ? bendAlong(xyz, dist, up) : null;
  return { kind, look, metal, points: xyz, dist, length: dist[points.length - 1] ?? 0, halfWidth, ups: up, bend, ...box };
}

/**
 * How sharply a 3D rail curves toward its up at each point (1/m): the turn
 * of its direction there over the length around it, measured along the up.
 * Its ends don't bend.
 */
function bendAlong(xyz: Float32Array, dist: Float32Array, up: Float32Array): Float32Array {
  const n = dist.length;
  const bend = new Float32Array(n);
  for (let k = 1; k < n - 1; k++) {
    const l0 = (dist[k] ?? 0) - (dist[k - 1] ?? 0);
    const l1 = (dist[k + 1] ?? 0) - (dist[k] ?? 0);
    if (l0 < 1e-6 || l1 < 1e-6) continue;
    let along = 0;
    for (let i = 0; i < 3; i++) {
      const t0 = ((xyz[k * 3 + i] ?? 0) - (xyz[k * 3 - 3 + i] ?? 0)) / l0;
      const t1 = ((xyz[k * 3 + 3 + i] ?? 0) - (xyz[k * 3 + i] ?? 0)) / l1;
      along += (t1 - t0) * (up[k * 3 + i] ?? 0);
    }
    bend[k] = along / ((l0 + l1) / 2);
  }
  return bend;
}

/** True when segment k of a 3D rail is upright enough to get onto or bump into (always, for an ordinary rail). */
function upright(r: RailShape, k: number): boolean {
  const u = r.ups;
  if (!u) return true;
  const min = TUNING.rails.uprightCos;
  return (u[k * 3 + 1] ?? 0) >= min && (u[k * 3 + 4] ?? 0) >= min;
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

// Segment scratch, filled by segment(): the start, the end's height, the
// direction and length seen from above (fields of an object, not loose
// numbers, so filling it every step never allocates).
const seg = { ax: 0, ay: 0, az: 0, by: 0, hx: 0, hz: 0, lenH: 0 };

/** Loads segment k of a rail into the scratch: start, end height, direction and length seen from above. */
function segment(r: RailShape, k: number): void {
  const p = r.points;
  seg.ax = p[k * 3] ?? 0;
  seg.ay = p[k * 3 + 1] ?? 0;
  seg.az = p[k * 3 + 2] ?? 0;
  const bx = p[k * 3 + 3] ?? 0;
  seg.by = p[k * 3 + 4] ?? 0;
  const bz = p[k * 3 + 5] ?? 0;
  seg.lenH = Math.hypot(bx - seg.ax, bz - seg.az);
  seg.hx = seg.lenH > 1e-6 ? (bx - seg.ax) / seg.lenH : 0;
  seg.hz = seg.lenH > 1e-6 ? (bz - seg.az) / seg.lenH : -1;
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
      if (!upright(r, k)) continue;
      segment(r, k);
      const rx = x - seg.ax;
      const rz = z - seg.az;
      const u = rx * seg.hx + rz * seg.hz;
      if (u < 0 || u > seg.lenH) continue;
      const v = -rx * seg.hz + rz * seg.hx;
      const across = Math.abs(v);
      if (across > r.halfWidth + reach || across >= best) continue;
      best = across;
      const t = seg.lenH > 1e-6 ? u / seg.lenH : 0;
      out.rail = i;
      out.seg = k;
      out.top = seg.ay + t * (seg.by - seg.ay);
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

/** The rail's direction across point k (between its two segments), unit length, into `out`. */
function tangentAt(r: RailShape, k: number, out: Vec3Like): void {
  const p = r.points;
  const a = Math.max(0, k - 1) * 3;
  const b = Math.min(r.dist.length - 1, k + 1) * 3;
  const x = (p[b] ?? 0) - (p[a] ?? 0);
  const y = (p[b + 1] ?? 0) - (p[a + 1] ?? 0);
  const z = (p[b + 2] ?? 0) - (p[a + 2] ?? 0);
  const l = Math.hypot(x, y, z) || 1;
  out.x = x / l;
  out.y = y / l;
  out.z = z / l;
}

// Scratch for railUp: the rail's direction at each end of a segment.
const ta = { x: 0, y: 0, z: 0 };
const tb = { x: 0, y: 0, z: 0 };

/**
 * A 3D rail's up at distance `s` along it, on segment `k` (as railFrame
 * found it), into `up`, and its direction there into `along`: both blended
 * between the segment's ends, the up turned square to the direction. They
 * turn smoothly along a bend (the segment's own straight direction would
 * rock the up back and forth at every point of a corkscrew). Returns the
 * rail's bend there (1/m, see RailShape.bend), blended the same way.
 */
export function railUp(r: RailShape, s: number, k: number, up: Vec3Like, along: Vec3Like): number {
  const u = r.ups!;
  const b = r.bend!;
  const d0 = r.dist[k] ?? 0;
  const len = (r.dist[k + 1] ?? 0) - d0;
  const t = len > 1e-6 ? Math.min(1, Math.max(0, (s - d0) / len)) : 0;
  tangentAt(r, k, ta);
  tangentAt(r, k + 1, tb);
  let dx = ta.x * (1 - t) + tb.x * t;
  let dy = ta.y * (1 - t) + tb.y * t;
  let dz = ta.z * (1 - t) + tb.z * t;
  const dl = Math.hypot(dx, dy, dz) || 1;
  dx /= dl;
  dy /= dl;
  dz /= dl;
  let x = (u[k * 3] ?? 0) * (1 - t) + (u[k * 3 + 3] ?? 0) * t;
  let y = (u[k * 3 + 1] ?? 0) * (1 - t) + (u[k * 3 + 4] ?? 0) * t;
  let z = (u[k * 3 + 2] ?? 0) * (1 - t) + (u[k * 3 + 5] ?? 0) * t;
  const on = x * dx + y * dy + z * dz;
  x -= on * dx;
  y -= on * dy;
  z -= on * dz;
  const l = Math.hypot(x, y, z);
  up.x = l > 1e-6 ? x / l : 0;
  up.y = l > 1e-6 ? y / l : 1;
  up.z = l > 1e-6 ? z / l : 0;
  along.x = dx;
  along.y = dy;
  along.z = dz;
  return (b[k] ?? 0) * (1 - t) + (b[k + 1] ?? 0) * t;
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
      if (!upright(r, k)) continue;
      segment(r, k);
      const first = k === 0;
      const last = k === segs - 1;
      const rx = p.x - seg.ax;
      const rz = p.z - seg.az;
      const u = rx * seg.hx + rz * seg.hz;
      const side = -rx * seg.hz + rz * seg.hx;
      const reach = r.halfWidth + radius;
      if (u <= (first ? -radius : 0) || u >= (last ? seg.lenH + radius : seg.lenH)) continue;
      if (Math.abs(side) >= reach) continue;
      const t = seg.lenH > 1e-6 ? Math.min(1, Math.max(0, u / seg.lenH)) : 0;
      if (p.y > seg.ay + t * (seg.by - seg.ay) - R.stepTolerance) continue;

      // Out the nearest way: off a side, or off either end of the whole line.
      const sign = side < 0 ? -1 : 1;
      let depth = reach - Math.abs(side);
      let nx = -seg.hz * sign;
      let nz = seg.hx * sign;
      if (first && u + radius < depth) {
        depth = u + radius;
        nx = -seg.hx;
        nz = -seg.hz;
      }
      if (last && seg.lenH + radius - u < depth) {
        depth = seg.lenH + radius - u;
        nx = seg.hx;
        nz = seg.hz;
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
