import { Color, Vector3 } from 'three';
import { DECOR_SIZE } from '../maps/decor.ts';
import type { RunLevel, SignDecor } from '../maps/types.ts';
import { drawText, textWidth } from './font.ts';
import type { MeshKit } from './meshKit.ts';
import { PALETTE } from './models.ts';

// Trail signs at forks: a timber post with a board per run, each with the
// run's difficulty (green circle, blue square, black diamond, double black
// diamond), its name, and an arrow the way it goes. The boards face riders
// coming down toward the sign's heading.

const BOARD = new Color('#5a3d26');
const BOARD_EDGE = new Color('#3f2a1a');
const TEXT = new Color('#f4ead2');
const CHIP = new Color('#f4f6fa');
const HEADER = new Color('#e9dcbc');
const LEVEL_COLORS: Record<RunLevel, Color> = {
  green: new Color('#2f9a4a'),
  blue: new Color('#2f6fe0'),
  black: new Color('#15191e'),
  double: new Color('#15191e'),
};
/** Capital height (m) of the names, board height, gap between boards, and the side margin. */
const SIZE = 0.2;
const ROW = 0.38;
const GAP = 0.07;
const MARGIN = 0.16;
/** Room (m) for the difficulty symbol and the arrow. */
const MARK = 0.34;

/** Draws a sign into a kit already placed at its foot, turned to its heading (see MeshKit.at). */
export function drawSign(k: MeshKit, sign: SignDecor): void {
  // Tall enough that the lowest board clears the snow.
  const boards = sign.lines.length + (sign.header === '' ? 0 : 1);
  const top = Math.max(DECOR_SIZE.signHeight, 0.75 + boards * (ROW + GAP));
  k.box(0, (top - 0.3) / 2, 0, 0.14, top + 0.3, 0.14, PALETTE.woodDark);
  k.box(0, top + 0.05, 0, 0.2, 0.1, 0.2, PALETTE.snow);
  const width = Math.max(textWidth(sign.header, SIZE * 1.15) + 2 * MARGIN, ...sign.lines.map((l) => textWidth(l.text, SIZE) + 2 * (MARK + MARGIN) + 0.1));
  const front = 0.1;
  const z = front + 0.034;
  const rows = sign.header === '' ? 0 : 1;
  if (rows > 0) {
    const yMid = top - 0.08 - ROW / 2;
    k.box(0, yMid, front, width + 0.04, ROW + 0.04, 0.05, BOARD_EDGE);
    k.box(0, yMid, front + 0.003, width, ROW, 0.05, HEADER);
    const size = SIZE * 1.15;
    drawText(k, sign.header, -textWidth(sign.header, size) / 2, yMid - size / 2, z + 0.002, size, BOARD);
  }
  sign.lines.forEach((line, n) => {
    const i = n + rows;
    const yTop = top - 0.08 - i * (ROW + GAP);
    const yMid = yTop - ROW / 2;
    k.box(0, yMid, front, width + 0.04, ROW + 0.04, 0.05, BOARD_EDGE);
    k.box(0, yMid, front + 0.003, width, ROW, 0.05, BOARD);
    // Left to right as the rider sees it: arrow (if left), symbol, name, arrow (if ahead or right).
    let x = -width / 2 + MARGIN;
    if (line.arrow < 0) {
      arrow(k, x + MARK / 2, yMid, z, -1);
      x += MARK;
    }
    level(k, line.level, x + MARK / 2, yMid, z);
    x += MARK + 0.05;
    drawText(k, line.text, x, yMid - SIZE / 2, z + 0.002, SIZE, TEXT);
    if (line.arrow >= 0) arrow(k, width / 2 - MARGIN - MARK / 2, yMid, z, line.arrow);
  });
}

/** The difficulty symbol on a small white chip, centered at local (x, y) on the plane z. */
function level(k: MeshKit, lv: RunLevel, x: number, y: number, z: number): void {
  const out = k.p(0, 0, z + 1).sub(k.p(0, 0, z));
  const c = 0.14;
  k.quad(k.p(x - c, y - c, z), k.p(x + c, y - c, z), k.p(x + c, y + c, z), k.p(x - c, y + c, z), CHIP, out);
  const color = LEVEL_COLORS[lv];
  const zz = z + 0.002;
  const r = 0.1;
  if (lv === 'green') {
    const n = 10;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      k.tri(k.p(x, y, zz), k.p(x + Math.cos(a0) * r, y + Math.sin(a0) * r, zz), k.p(x + Math.cos(a1) * r, y + Math.sin(a1) * r, zz), color, out);
    }
  } else if (lv === 'blue') {
    const s = r * 0.85;
    k.quad(k.p(x - s, y - s, zz), k.p(x + s, y - s, zz), k.p(x + s, y + s, zz), k.p(x - s, y + s, zz), color, out);
  } else {
    const diamonds = lv === 'double' ? [-0.055, 0.055] : [0];
    const s = lv === 'double' ? r * 0.62 : r;
    for (const dx of diamonds) {
      k.quad(k.p(x + dx, y - s, zz), k.p(x + dx + s * 0.8, y, zz), k.p(x + dx, y + s, zz), k.p(x + dx - s * 0.8, y, zz), color, out);
    }
  }
}

/** An arrow centered at local (x, y) on the plane z: -1 left, 0 straight on (up the board), 1 right. */
function arrow(k: MeshKit, x: number, y: number, z: number, dir: number): void {
  const out = k.p(0, 0, z + 1).sub(k.p(0, 0, z));
  // Along the arrow and across it, in the board's plane.
  const ax = dir === 0 ? 0 : dir;
  const ay = dir === 0 ? 1 : 0;
  const px = -ay;
  const py = ax;
  const p = (along: number, across: number): Vector3 => k.p(x + ax * along + px * across, y + ay * along + py * across, z);
  const L = 0.12;
  const w = 0.025;
  k.quad(p(-L, -w), p(0.02, -w), p(0.02, w), p(-L, w), TEXT, out);
  k.tri(p(L, 0), p(0, 0.08), p(0, -0.08), TEXT, out);
}
