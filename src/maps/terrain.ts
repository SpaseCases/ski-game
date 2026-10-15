import type { GeneratedTerrainDef, Heightfield, RollersDef } from './types.ts';

/** How steeply (rise per meter) the scenery hillsides climb past the berms, and the slope above the top. */
const HILLSIDE_RISE = 0.45;
const TOP_RISE = 0.25;

/**
 * Builds a heightfield for a straight slope: flat at the top, a steady pitch,
 * optional rollers, then a runout that flattens and rises gently, with raised
 * berms on both sides. Past the play area, scenery: hillsides climb away
 * beyond the berms and the slope carries on above and below. Random facet
 * jitter goes in `detail` (visual only).
 * Row 0 is the lowest z (the bottom); the last row is the highest (the top).
 */
export function generateSlope(def: GeneratedTerrainDef): Heightfield {
  const m = def.margin;
  const cols = Math.round((def.width + 2 * m) / def.cellSize) + 1;
  const rows = Math.round((def.length + 2 * m) / def.cellSize) + 1;
  const originX = -((cols - 1) * def.cellSize) / 2;
  const originZ = m - (rows - 1) * def.cellSize;
  const heights = new Float32Array(cols * rows);
  const detail = new Float32Array(cols * rows);

  // Integrate the slope gradient from the top down, one row at a time,
  // starting at height 0 on the top edge of the play area.
  const pitch = Math.tan((def.slopeDeg * Math.PI) / 180);
  const ease = 12;
  const centerline = new Float32Array(rows);
  const rollers = new Float32Array(rows);
  const topRow = Math.round((0 - originZ) / def.cellSize);
  const gradient = (d: number): number => {
    if (d < 0) return -TOP_RISE * smoothstep(0, -ease, d);
    const start = smoothstep(def.flatTop - ease, def.flatTop + ease, d);
    const runout = smoothstep(def.length - def.runout - ease, def.length - ease, d);
    return pitch * start * (1 - 1.6 * runout);
  };
  let h = 0;
  for (let row = topRow; row >= 0; row--) {
    centerline[row] = h;
    h -= gradient(distanceDown(row)) * def.cellSize;
  }
  h = 0;
  for (let row = topRow; row < rows; row++) {
    centerline[row] = h;
    h += gradient(distanceDown(row + 1)) * def.cellSize;
  }
  for (let row = 0; row < rows; row++) {
    if (def.rollers) rollers[row] = rollerOffset(def.rollers, distanceDown(row));
  }

  const halfWidth = def.width / 2;
  for (let row = 0; row < rows; row++) {
    const base = centerline[row] ?? 0;
    const roll = rollers[row] ?? 0;
    for (let col = 0; col < cols; col++) {
      const x = originX + col * def.cellSize;
      const ax = Math.abs(x);
      const berm = smoothstep(halfWidth - def.bermWidth, halfWidth, ax);
      const out = Math.max(0, ax - halfWidth);
      const hill = HILLSIDE_RISE * out * smoothstep(0, 12, out);
      const i = row * cols + col;
      heights[i] = base + roll * (1 - berm) + berm * berm * def.bermHeight + hill;
      detail[i] = hash2(col, row, def.seed) * def.noise * (0.15 + berm);
    }
  }

  return {
    cols,
    rows,
    cellSize: def.cellSize,
    originX,
    originZ,
    heights,
    detail,
    bounds: { minX: -halfWidth, maxX: halfWidth, minZ: -def.length, maxZ: 0 },
  };

  function distanceDown(row: number): number {
    return -(originZ + row * def.cellSize);
  }
}

/** Sine rollers that fade in and out over half a spacing at each end. */
function rollerOffset(r: RollersDef, d: number): number {
  if (d <= r.start || d >= r.end) return 0;
  const half = r.spacing / 2;
  const fade = smoothstep(r.start, r.start + half, d) * (1 - smoothstep(r.end - half, r.end, d));
  return r.amplitude * Math.sin((2 * Math.PI * (d - r.start)) / r.spacing) * fade;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Deterministic integer hash mapped to [-1, 1]. */
export function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 982451653)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}
