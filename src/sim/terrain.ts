import type { Heightfield } from '../maps/types.ts';

// Terrain sampling. Each grid cell is split into two triangles along the
// (col, row) -> (col + 1, row + 1) diagonal, the same split the terrain mesh
// uses, so sampled heights sit exactly on the rendered surface.

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

interface CellPlane {
  /** Height at the cell's (col, row) corner. */
  h00: number;
  /** Height change per meter along X and Z inside the sampled triangle. */
  dhdx: number;
  dhdz: number;
  /** Offset of the sample point from the (col, row) corner, in meters. */
  dx: number;
  dz: number;
}

// Reused scratch result so sampling never allocates.
const plane: CellPlane = { h00: 0, dhdx: 0, dhdz: 0, dx: 0, dz: 0 };

function locate(hf: Heightfield, x: number, z: number): CellPlane {
  const gx = clamp((x - hf.originX) / hf.cellSize, 0, hf.cols - 1);
  const gz = clamp((z - hf.originZ) / hf.cellSize, 0, hf.rows - 1);
  const col = Math.min(Math.floor(gx), hf.cols - 2);
  const row = Math.min(Math.floor(gz), hf.rows - 2);
  const fx = gx - col;
  const fz = gz - row;

  const i = row * hf.cols + col;
  const h = hf.heights;
  const h00 = h[i] ?? 0;
  const h10 = h[i + 1] ?? 0;
  const h01 = h[i + hf.cols] ?? 0;
  const h11 = h[i + hf.cols + 1] ?? 0;

  plane.h00 = h00;
  if (fx >= fz) {
    plane.dhdx = (h10 - h00) / hf.cellSize;
    plane.dhdz = (h11 - h10) / hf.cellSize;
  } else {
    plane.dhdx = (h11 - h01) / hf.cellSize;
    plane.dhdz = (h01 - h00) / hf.cellSize;
  }
  plane.dx = fx * hf.cellSize;
  plane.dz = fz * hf.cellSize;
  return plane;
}

/** Terrain height at world (x, z). Points outside the map use the nearest edge. */
export function heightAt(hf: Heightfield, x: number, z: number): number {
  const p = locate(hf, x, z);
  return p.h00 + p.dhdx * p.dx + p.dhdz * p.dz;
}

/** Writes the unit surface normal at world (x, z) into `out` and returns it. */
export function normalAt<T extends Vec3Like>(hf: Heightfield, x: number, z: number, out: T): T {
  const p = locate(hf, x, z);
  const len = Math.hypot(p.dhdx, 1, p.dhdz);
  out.x = -p.dhdx / len;
  out.y = 1 / len;
  out.z = -p.dhdz / len;
  return out;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
