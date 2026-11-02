import type { GroomedPatch, MapDef, RunDef, XZ } from '../maps/types.ts';

// Where the snow is powder: on a map with `powder` (Freeride), everywhere off
// its named runs (within each run's `clear`, unless the run is marked
// `powder`) and its groomed patches. Powder
// lands softer (CONFIG.landing.powderImpact), and the snow effects and the
// carve sound change in it.

/** A map's powder: the snow that isn't. */
export interface PowderArea {
  groomed: readonly GroomedPatch[];
  runs: readonly RunDef[];
}

/** A map's powder area, or null for a map with none (all groomed). */
export function powderArea(map: MapDef): PowderArea | null {
  return map.powder ? { groomed: map.powder.groomed, runs: map.runs } : null;
}

/** Whether the snow at (x, z) is powder. */
export function inPowder(area: PowderArea | null, x: number, z: number): boolean {
  if (!area) return false;
  const groomed = area.groomed;
  for (let i = 0; i < groomed.length; i++) if (inPatch(groomed[i]!, x, z)) return false;
  for (let r = 0; r < area.runs.length; r++) {
    const run = area.runs[r]!;
    if (run.powder) continue;
    const pts = run.points;
    const c2 = run.clear * run.clear;
    for (let i = 1; i < pts.length; i++) if (segmentDistance2(pts[i - 1]!, pts[i]!, x, z) <= c2) return false;
  }
  return true;
}

function inPatch(g: GroomedPatch, x: number, z: number): boolean {
  const h = (g.heading * Math.PI) / 180;
  const dx = x - g.x;
  const dz = z - g.z;
  // Along the heading (0 runs toward -Z), and across it.
  const along = -dx * Math.sin(h) - dz * Math.cos(h);
  const across = dx * Math.cos(h) - dz * Math.sin(h);
  return Math.abs(along) <= g.length / 2 && Math.abs(across) <= g.width / 2;
}

function segmentDistance2(a: XZ, b: XZ, x: number, z: number): number {
  const ux = b.x - a.x;
  const uz = b.z - a.z;
  const l2 = ux * ux + uz * uz;
  const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - a.x) * ux + (z - a.z) * uz) / l2)) : 0;
  return (a.x + ux * t - x) ** 2 + (a.z + uz * t - z) ** 2;
}
