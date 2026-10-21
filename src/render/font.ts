import { Color, Vector3 } from 'three';
import type { MeshKit } from './meshKit.ts';

// A blocky stroke font for signs, drawn as thin bars (no textures): each
// glyph is a few polylines on a 4 × 6 grid, capitals and digits only.
// Lower case is drawn as capitals.

export type Stroke = readonly (readonly [number, number])[];
const O: Stroke = [[1, 0], [0, 1], [0, 5], [1, 6], [3, 6], [4, 5], [4, 1], [3, 0], [1, 0]];
const P: Stroke = [[0, 0], [0, 6], [3, 6], [4, 5], [4, 4], [3, 3], [0, 3]];
export const GLYPHS: Record<string, readonly Stroke[]> = {
  A: [[[0, 0], [0, 4], [2, 6], [4, 4], [4, 0]], [[0, 3], [4, 3]]],
  B: [[[0, 0], [0, 6], [3, 6], [4, 5], [4, 4], [3, 3], [0, 3]], [[3, 3], [4, 2], [4, 1], [3, 0], [0, 0]]],
  C: [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1]]],
  D: [[[0, 0], [0, 6], [3, 6], [4, 5], [4, 1], [3, 0], [0, 0]]],
  E: [[[4, 6], [0, 6], [0, 0], [4, 0]], [[0, 3], [3, 3]]],
  F: [[[4, 6], [0, 6], [0, 0]], [[0, 3], [3, 3]]],
  G: [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1], [4, 3], [2, 3]]],
  H: [[[0, 0], [0, 6]], [[4, 0], [4, 6]], [[0, 3], [4, 3]]],
  I: [[[1, 6], [3, 6]], [[2, 6], [2, 0]], [[1, 0], [3, 0]]],
  J: [[[4, 6], [4, 1], [3, 0], [1, 0], [0, 1]]],
  K: [[[0, 0], [0, 6]], [[4, 6], [0, 2]], [[1, 3], [4, 0]]],
  L: [[[0, 6], [0, 0], [4, 0]]],
  M: [[[0, 0], [0, 6], [2, 3], [4, 6], [4, 0]]],
  N: [[[0, 0], [0, 6], [4, 0], [4, 6]]],
  O: [O],
  P: [P],
  Q: [O, [[2, 2], [4, 0]]],
  R: [P, [[2, 3], [4, 0]]],
  S: [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 4], [1, 3], [3, 3], [4, 2], [4, 1], [3, 0], [1, 0], [0, 1]]],
  T: [[[0, 6], [4, 6]], [[2, 6], [2, 0]]],
  U: [[[0, 6], [0, 1], [1, 0], [3, 0], [4, 1], [4, 6]]],
  V: [[[0, 6], [2, 0], [4, 6]]],
  W: [[[0, 6], [1, 0], [2, 4], [3, 0], [4, 6]]],
  X: [[[0, 6], [4, 0]], [[4, 6], [0, 0]]],
  Y: [[[0, 6], [2, 3], [4, 6]], [[2, 3], [2, 0]]],
  Z: [[[0, 6], [4, 6], [0, 0], [4, 0]]],
  '0': [O, [[0, 1], [4, 5]]],
  '1': [[[1, 5], [2, 6], [2, 0]], [[1, 0], [3, 0]]],
  '2': [[[0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [0, 0], [4, 0]]],
  '3': [[[0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [3, 3], [4, 2], [4, 1], [3, 0], [1, 0], [0, 1]], [[1, 3], [3, 3]]],
  '4': [[[3, 0], [3, 6], [0, 2], [4, 2]]],
  '5': [[[4, 6], [0, 6], [0, 3], [3, 3], [4, 2], [4, 1], [3, 0], [0, 0]]],
  '6': [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1], [4, 2], [3, 3], [0, 3]]],
  '7': [[[0, 6], [4, 6], [1, 0]]],
  '8': [[[1, 3], [0, 4], [0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [3, 3], [1, 3], [0, 2], [0, 1], [1, 0], [3, 0], [4, 1], [4, 2], [3, 3]]],
  '9': [[[4, 3], [1, 3], [0, 4], [0, 5], [1, 6], [3, 6], [4, 5], [4, 1], [3, 0], [1, 0]]],
  ':': [[[2, 0.6], [2, 1.4]], [[2, 3.6], [2, 4.4]]],
  '-': [[[1, 3], [3, 3]]],
  '.': [[[2, 0], [2, 0.7]]],
  "'": [[[2, 6], [2, 4.6]]],
  '/': [[[0, 0], [4, 6]]],
  '&': [[[4, 0], [1, 5], [2, 6], [3, 5], [0, 2], [0, 1], [1, 0], [3, 0], [4, 2]]],
};
/** Grid units per character (4 wide plus a gap), and per line of capitals. */
export const ADVANCE = 5.6;
export const CAP = 6;

/** Width (m) of `text` drawn with capitals `size` m tall. */
export function textWidth(text: string, size: number): number {
  return Math.max(0, text.length * ADVANCE - (ADVANCE - 4)) * (size / CAP);
}

/**
 * Draws `text` in the kit's local space on the plane z = `z`, facing +Z
 * (toward a reader standing at +Z, looking along -Z), from local (x, y) on
 * its baseline toward +X, the reader's right, capitals `size` m tall.
 */
export function drawText(k: MeshKit, text: string, x: number, y: number, z: number, size: number, color: Color): void {
  const unit = size / CAP;
  const w = unit * 0.85;
  const out = k.p(0, 0, z + 1).sub(k.p(0, 0, z));
  let cx = x;
  for (const ch of text.toUpperCase()) {
    const glyph = GLYPHS[ch];
    if (glyph) {
      for (const stroke of glyph) {
        for (let i = 1; i < stroke.length; i++) {
          const [ax, ay] = stroke[i - 1]!;
          const [bx, by] = stroke[i]!;
          bar(k, cx + ax * unit, y + ay * unit, cx + bx * unit, y + by * unit, z, w, color, out);
        }
      }
    }
    cx += ADVANCE * unit;
  }
}

/** A bar `w` wide from (ax, ay) to (bx, by) on the plane z, squared off past its ends so corners join. */
function bar(k: MeshKit, ax: number, ay: number, bx: number, by: number, z: number, w: number, color: Color, out: Vector3): void {
  let dx = bx - ax;
  let dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) {
    dx = 0;
    dy = 1;
  } else {
    dx /= len;
    dy /= len;
  }
  const h = w / 2;
  const nx = -dy * h;
  const ny = dx * h;
  const a0x = ax - dx * h;
  const a0y = ay - dy * h;
  const b0x = bx + dx * h;
  const b0y = by + dy * h;
  k.quad(k.p(a0x + nx, a0y + ny, z), k.p(b0x + nx, b0y + ny, z), k.p(b0x - nx, b0y - ny, z), k.p(a0x - nx, a0y - ny, z), color, out);
}
