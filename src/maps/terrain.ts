import type { GeneratedTerrainDef, Heightfield } from './types.ts';

/**
 * Builds a heightfield for a straight slope: flat at the top, a steady pitch,
 * then an easing runout, with raised berms on both sides.
 * Row 0 is the bottom of the slope (z = -length); the last row is the top (z = 0).
 */
export function generateSlope(def: GeneratedTerrainDef): Heightfield {
  const cols = Math.round(def.width / def.cellSize) + 1;
  const rows = Math.round(def.length / def.cellSize) + 1;
  const originX = -((cols - 1) * def.cellSize) / 2;
  const originZ = -(rows - 1) * def.cellSize;
  const heights = new Float32Array(cols * rows);

  // Integrate the slope gradient from the top down, one row at a time.
  const pitch = Math.tan((def.slopeDeg * Math.PI) / 180);
  const ease = 12;
  const centerline = new Float32Array(rows);
  let h = 0;
  for (let row = rows - 1; row >= 0; row--) {
    centerline[row] = h;
    const d = -(originZ + row * def.cellSize); // distance down from the top
    const start = smoothstep(def.flatTop - ease, def.flatTop + ease, d);
    const runout = smoothstep(def.length - def.runout - ease, def.length - def.runout + ease, d);
    h -= pitch * start * (1 - 0.75 * runout) * def.cellSize;
  }

  const halfWidth = ((cols - 1) * def.cellSize) / 2;
  for (let row = 0; row < rows; row++) {
    const base = centerline[row] ?? 0;
    for (let col = 0; col < cols; col++) {
      const x = originX + col * def.cellSize;
      const berm = smoothstep(halfWidth - def.bermWidth, halfWidth, Math.abs(x));
      const jitter = hash2(col, row, def.seed) * def.noise * (0.4 + 2 * berm);
      heights[row * cols + col] = base + berm * berm * def.bermHeight + jitter;
    }
  }

  return { cols, rows, cellSize: def.cellSize, originX, originZ, heights };
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
