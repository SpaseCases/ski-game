import { CONFIG } from '../config.ts';
import type { MapDef, XZ } from '../maps/types.ts';
import { insidePolygon } from './bounds.ts';

// Gaps for scoring (GAME_DESIGN.md, Scoring): places where an air that takes
// off in one area and lands in another scores a trick of its own. Every open
// gap jump is one ("Gap": off its takeoff, landed past its knuckle), and a
// map can name its own (the Cat gap). Fences between lines are kept as
// segments, so an air whose path crosses one is a "Fence hop". Built once per
// map; scoring only reads it, at takeoff and landing.

/** A takeoff area and a landing area, as polygons (x, z, x, z...) with their bounding boxes. */
export interface GapZone {
  name: string;
  points: number;
  /** From the map's `gaps` (it stands in for a plain "Gap" on the same air). */
  named: boolean;
  from: Float32Array;
  to: Float32Array;
  /** min x, max x, min z, max z of `from`, then of `to`. */
  box: Float32Array;
}

export interface Gaps {
  zones: GapZone[];
  /** Fence segments: ax, az, bx, bz each. */
  fences: Float32Array;
}

/** An open gap's takeoff area starts this far (m) before its takeoff and ends this far past its lip. */
const TAKEOFF_BEFORE = 3;
const TAKEOFF_PAST = 1;
/** Its landing area runs from the knuckle to this far (m) past the end of the landing: overshot onto the flat, it still cleared the gap. */
const LANDING_PAST = 60;

const DEG = Math.PI / 180;

export const NO_GAPS: Gaps = { zones: [], fences: new Float32Array(0) };

export function buildGaps(map: MapDef): Gaps {
  const zones: GapZone[] = [];
  for (const g of map.gaps ?? []) zones.push(zone(g.name, g.points, true, g.from, g.to));
  for (const f of map.features) {
    if (f.type !== 'jump' || f.deck) continue;
    // Along the jump as maps/shapes.ts builds it: the takeoff to its lip, the gap, then the landing.
    const lip = (2 * f.lipHeight) / Math.tan(f.lipAngle * DEG);
    const knuckle = lip + f.gap;
    const end = knuckle + f.knuckle + f.landingHeight / Math.tan(f.landingAngle * DEG) + f.transition;
    const a = f.yaw * DEG;
    const dx = -Math.sin(a);
    const dz = -Math.cos(a);
    const half = f.width / 2 + f.sideWidth;
    const rect = (u0: number, u1: number): XZ[] => [
      { x: f.x + dx * u0 - dz * half, z: f.z + dz * u0 + dx * half },
      { x: f.x + dx * u1 - dz * half, z: f.z + dz * u1 + dx * half },
      { x: f.x + dx * u1 + dz * half, z: f.z + dz * u1 - dx * half },
      { x: f.x + dx * u0 + dz * half, z: f.z + dz * u0 - dx * half },
    ];
    zones.push(zone('Gap', CONFIG.score.gapPoints, false, rect(-TAKEOFF_BEFORE, lip + TAKEOFF_PAST), rect(knuckle, end + LANDING_PAST)));
  }
  const segments: number[] = [];
  for (const d of map.decor) {
    if (d.kind !== 'fence') continue;
    for (let i = 1; i < d.points.length; i++) {
      const p = d.points[i - 1]!;
      const q = d.points[i]!;
      segments.push(p.x, p.z, q.x, q.z);
    }
  }
  return { zones, fences: new Float32Array(segments) };
}

function zone(name: string, points: number, named: boolean, from: XZ[], to: XZ[]): GapZone {
  const box = new Float32Array([Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity]);
  const poly = (list: XZ[], at: number): Float32Array => {
    const out = new Float32Array(list.length * 2);
    list.forEach((p, i) => {
      out[i * 2] = p.x;
      out[i * 2 + 1] = p.z;
      box[at] = Math.min(box[at]!, p.x);
      box[at + 1] = Math.max(box[at + 1]!, p.x);
      box[at + 2] = Math.min(box[at + 2]!, p.z);
      box[at + 3] = Math.max(box[at + 3]!, p.z);
    });
    return out;
  };
  return { name, points, named, from: poly(from, 0), to: poly(to, 4), box };
}

/** True when an air from (x0, z0) to (x1, z1) took off in the zone's `from` and landed in its `to`. */
export function clearsZone(g: GapZone, x0: number, z0: number, x1: number, z1: number): boolean {
  const b = g.box;
  if (x0 < b[0]! || x0 > b[1]! || z0 < b[2]! || z0 > b[3]! || x1 < b[4]! || x1 > b[5]! || z1 < b[6]! || z1 > b[7]!) return false;
  return insidePolygon(g.from, x0, z0) && insidePolygon(g.to, x1, z1);
}

/** True when the straight line (seen from above) from (x0, z0) to (x1, z1) crosses a fence. */
export function crossesFence(gaps: Gaps, x0: number, z0: number, x1: number, z1: number): boolean {
  const f = gaps.fences;
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minZ = Math.min(z0, z1);
  const maxZ = Math.max(z0, z1);
  const rx = x1 - x0;
  const rz = z1 - z0;
  for (let i = 0; i < f.length; i += 4) {
    const ax = f[i]!;
    const az = f[i + 1]!;
    const bx = f[i + 2]!;
    const bz = f[i + 3]!;
    if (Math.max(ax, bx) < minX || Math.min(ax, bx) > maxX || Math.max(az, bz) < minZ || Math.min(az, bz) > maxZ) continue;
    const sx = bx - ax;
    const sz = bz - az;
    const den = rx * sz - rz * sx;
    if (den === 0) continue;
    const qx = ax - x0;
    const qz = az - z0;
    const t = (qx * sz - qz * sx) / den;
    const u = (qx * rz - qz * rx) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return true;
  }
  return false;
}
