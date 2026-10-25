import { topShape, type ShapeSample } from '../maps/shapes.ts';
import type { Heightfield } from '../maps/types.ts';

// Physics surface: a smooth Catmull-Rom (bicubic) surface through the
// heightfield samples, so slope and normal change continuously and the skier
// doesn't hop at every triangle edge. The rendered triangles pass through the
// same samples and differ from this surface by a few centimeters at most.

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** Catmull-Rom weights (w) and their derivatives (d) for one axis. */
interface AxisWeights {
  w0: number;
  w1: number;
  w2: number;
  w3: number;
  d0: number;
  d1: number;
  d2: number;
  d3: number;
}

// Reused scratch so sampling never allocates.
const wx: AxisWeights = { w0: 0, w1: 0, w2: 0, w3: 0, d0: 0, d1: 0, d2: 0, d3: 0 };
const wz: AxisWeights = { w0: 0, w1: 0, w2: 0, w3: 0, d0: 0, d1: 0, d2: 0, d3: 0 };
const surface = { height: 0, dhdx: 0, dhdz: 0 };
const shape: ShapeSample = { height: 0, dhdx: 0, dhdz: 0 };
/** One row's interpolated height and slope, from sampleRow (fields of an object, not loose numbers, so writing them never allocates). */
const rowOut = { height: 0, slope: 0 };

function setWeights(t: number, a: AxisWeights): void {
  const t2 = t * t;
  const t3 = t2 * t;
  a.w0 = 0.5 * (-t + 2 * t2 - t3);
  a.w1 = 0.5 * (2 - 5 * t2 + 3 * t3);
  a.w2 = 0.5 * (t + 4 * t2 - 3 * t3);
  a.w3 = 0.5 * (-t2 + t3);
  a.d0 = 0.5 * (-1 + 4 * t - 3 * t2);
  a.d1 = 0.5 * (-10 * t + 9 * t2);
  a.d2 = 0.5 * (1 + 8 * t - 9 * t2);
  a.d3 = 0.5 * (-2 * t + 3 * t2);
}

/** Interpolates along one heightfield row; sets rowOut.height and rowOut.slope (per cell). */
function sampleRow(hf: Heightfield, row: number, c0: number, c1: number, c2: number, c3: number): void {
  const base = row * hf.cols;
  const h = hf.heights;
  const v0 = h[base + c0] ?? 0;
  const v1 = h[base + c1] ?? 0;
  const v2 = h[base + c2] ?? 0;
  const v3 = h[base + c3] ?? 0;
  rowOut.height = wx.w0 * v0 + wx.w1 * v1 + wx.w2 * v2 + wx.w3 * v3;
  rowOut.slope = wx.d0 * v0 + wx.d1 * v1 + wx.d2 * v2 + wx.d3 * v3;
}

function sampleSurface(hf: Heightfield, x: number, z: number, withShapes = true): typeof surface {
  const gx = clamp((x - hf.originX) / hf.cellSize, 0, hf.cols - 1);
  const gz = clamp((z - hf.originZ) / hf.cellSize, 0, hf.rows - 1);
  const col = Math.min(Math.floor(gx), hf.cols - 2);
  const row = Math.min(Math.floor(gz), hf.rows - 2);
  setWeights(gx - col, wx);
  setWeights(gz - row, wz);

  const c0 = Math.max(col - 1, 0);
  const c3 = Math.min(col + 2, hf.cols - 1);
  const r0 = Math.max(row - 1, 0);
  const r3 = Math.min(row + 2, hf.rows - 1);

  let height = 0;
  let dx = 0;
  let dz = 0;
  sampleRow(hf, r0, c0, col, col + 1, c3);
  height += wz.w0 * rowOut.height;
  dx += wz.w0 * rowOut.slope;
  dz += wz.d0 * rowOut.height;
  sampleRow(hf, row, c0, col, col + 1, c3);
  height += wz.w1 * rowOut.height;
  dx += wz.w1 * rowOut.slope;
  dz += wz.d1 * rowOut.height;
  sampleRow(hf, row + 1, c0, col, col + 1, c3);
  height += wz.w2 * rowOut.height;
  dx += wz.w2 * rowOut.slope;
  dz += wz.d2 * rowOut.height;
  sampleRow(hf, r3, c0, col, col + 1, c3);
  height += wz.w3 * rowOut.height;
  dx += wz.w3 * rowOut.slope;
  dz += wz.d3 * rowOut.height;

  surface.height = height;
  surface.dhdx = dx / hf.cellSize;
  surface.dhdz = dz / hf.cellSize;

  // Jumps, pipes, decks and roofs sit on top of the smooth slope; where two
  // overlap, the higher one is the snow.
  if (withShapes && topShape(hf, x, z, shape)) {
    surface.height += shape.height;
    surface.dhdx += shape.dhdx;
    surface.dhdz += shape.dhdz;
  }
  return surface;
}

/** Snow height at world (x, z). Points outside the map use the nearest edge. */
export function heightAt(hf: Heightfield, x: number, z: number): number {
  return sampleSurface(hf, x, z).height;
}

/** Height of the ground itself at world (x, z): the slope without any shape built on it. */
export function terrainHeightAt(hf: Heightfield, x: number, z: number): number {
  return sampleSurface(hf, x, z, false).height;
}

/** Writes the unit snow normal at world (x, z) into `out` and returns the snow height. */
export function groundAt(hf: Heightfield, x: number, z: number, out: Vec3Like): number {
  const s = sampleSurface(hf, x, z);
  const len = Math.hypot(s.dhdx, 1, s.dhdz);
  out.x = -s.dhdx / len;
  out.y = 1 / len;
  out.z = -s.dhdz / len;
  return s.height;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
