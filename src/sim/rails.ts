import { CONFIG } from '../config.ts';
import type { Feature, Heightfield, RailShape } from '../maps/types.ts';
import { heightAt, type Vec3Like } from './terrain.ts';

// Rails and boxes, for the simulation. Each is a line along its top (a
// polyline in world space) that the skis slide on. Queries work on the line
// seen from above: a point is "over" a segment when it projects inside it,
// and its distance across is measured to the right of the segment's direction.

/** Builds the slide lines for every rail and box in the map, sitting on the snow (and on any shapes built on it). */
export function buildRailShapes(features: readonly Feature[], hf: Heightfield): RailShape[] {
  const shapes: RailShape[] = [];
  for (const f of features) {
    if (f.type !== 'box' && f.type !== 'rail') continue;
    const halfWidth = f.type === 'box' ? f.width / 2 : CONFIG.rails.radius;
    shapes.push(makeShape(f.type, halfWidth, f.points.map((p) => [p.x, p.z, p.height] as const), hf));
  }
  return shapes;
}

function makeShape(
  kind: RailShape['kind'],
  halfWidth: number,
  points: readonly (readonly [number, number, number])[],
  hf: Heightfield,
): RailShape {
  const xyz = new Float32Array(points.length * 3);
  const dist = new Float32Array(points.length);
  let px = 0;
  let py = 0;
  let pz = 0;
  points.forEach(([x, z, height], i) => {
    const y = heightAt(hf, x, z) + height;
    xyz.set([x, y, z], i * 3);
    if (i > 0) dist[i] = (dist[i - 1] ?? 0) + Math.hypot(x - px, y - py, z - pz);
    px = x;
    py = y;
    pz = z;
  });
  return { kind, points: xyz, dist, length: dist[points.length - 1] ?? 0, halfWidth };
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
  const last = r.dist.length - 2;
  let k = 0;
  while (k < last && s > (r.dist[k + 1] ?? 0)) k++;
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
  const R = CONFIG.rails;
  const radius = R.bodyRadius;
  let hit = -1;
  for (let i = 0; i < rails.length; i++) {
    const r = rails[i]!;
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
