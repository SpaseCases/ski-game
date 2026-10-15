import type { GeneratedTerrainDef, Heightfield, RollersDef } from './types.ts';

/**
 * Builds a heightfield for a straight slope: flat at the top, a steady pitch,
 * optional rollers, then a runout that flattens and rises gently, with raised
 * berms on both sides. Random facet jitter goes in `detail` (visual only).
 * Row 0 is the bottom of the slope (z = -length); the last row is the top (z = 0).
 */
export function generateSlope(def: GeneratedTerrainDef): Heightfield {
  const cols = Math.round(def.width / def.cellSize) + 1;
  const rows = Math.round(def.length / def.cellSize) + 1;
  const originX = -((cols - 1) * def.cellSize) / 2;
  const originZ = -(rows - 1) * def.cellSize;
  const heights = new Float32Array(cols * rows);
  const detail = new Float32Array(cols * rows);

  // Integrate the slope gradient from the top down, one row at a time.
  const pitch = Math.tan((def.slopeDeg * Math.PI) / 180);
  const ease = 12;
  const centerline = new Float32Array(rows);
  const rollers = new Float32Array(rows);
  let h = 0;
  for (let row = rows - 1; row >= 0; row--) {
    centerline[row] = h;
    const d = -(originZ + row * def.cellSize); // distance down from the top
    if (def.rollers) rollers[row] = rollerOffset(def.rollers, d);
    const start = smoothstep(def.flatTop - ease, def.flatTop + ease, d);
    const runout = smoothstep(def.length - def.runout - ease, def.length - ease, d);
    h -= pitch * start * (1 - 1.6 * runout) * def.cellSize;
  }

  const halfWidth = ((cols - 1) * def.cellSize) / 2;
  for (let row = 0; row < rows; row++) {
    const base = centerline[row] ?? 0;
    const roll = rollers[row] ?? 0;
    for (let col = 0; col < cols; col++) {
      const x = originX + col * def.cellSize;
      const berm = smoothstep(halfWidth - def.bermWidth, halfWidth, Math.abs(x));
      const i = row * cols + col;
      heights[i] = base + roll * (1 - berm) + berm * berm * def.bermHeight;
      detail[i] = hash2(col, row, def.seed) * def.noise * (0.15 + berm);
    }
  }

  return { cols, rows, cellSize: def.cellSize, originX, originZ, heights, detail };
}

/** Sine rollers that fade in and out over half a spacing at each end. */
function rollerOffset(r: RollersDef, d: number): number {
  if (d <= r.start || d >= r.end) return 0;
  const half = r.spacing / 2;
  const fade = smoothstep(r.start, r.start + half, d) * (1 - smoothstep(r.end - half, r.end, d));
  return r.amplitude * Math.sin((2 * Math.PI * (d - r.start)) / r.spacing) * fade;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
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
