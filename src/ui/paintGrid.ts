import type { PixelArt } from '../core/skis.ts';

// The ski editor's grid (ui/skiEditor.ts) as numbers: which cell of the
// slot's grid each grid column shows (one ski's, both skis' side by side,
// or a board's), the brush and its mirrors, a straight line of stamps, a
// fill, and drawing the grid with its cursor marks. It runs on every pointer
// move and every frame of a stroke, so it holds no text and the production
// build leaves it minified only (tools/vite/obfuscate.js EXCLUDE): obfuscated,
// every property read here became a call to the string table's decoder.

/** A box of cells in the grid's own columns (inclusive): along0, x0, along1, x1. */
export type Box = readonly [number, number, number, number];

const BOTH = [0, 1] as const;
const ONE = [[0], [1]] as const;

export class PaintGrid {
  /** The face being painted (a ski slot's rows hold both skis' columns, the left ski's first). */
  art!: PixelArt;
  /** One ski's (or the board's) cells along and across. */
  rows = 0;
  cols = 0;
  /** A board: one board, no sides. */
  onBoard = false;
  /** Both skis' grids at once, the left ski's columns above the right's. */
  pair = false;
  /** The ski shown in the single view: 0 left, 1 right. */
  side = 0;
  /** Every stroke paints both skis alike (the slot's own flag, kept here by the editor). */
  linked = false;
  color = 0;
  /** The pencil's square, this many cells across. */
  brush = 1;
  mirrorEnds = false;
  mirrorSides = false;

  /** The grid's columns: one ski's (or the board's), or both skis' side by side. */
  get gridCols(): number {
    return this.pair ? this.cols * 2 : this.cols;
  }

  /** The ski (0 left, 1 right) that grid column `x` shows; always 0 on a board. */
  sideAt(x: number): number {
    if (this.onBoard) return 0;
    return this.pair ? (x >= this.cols ? 1 : 0) : this.side;
  }

  /** The column across its own ski that grid column `x` shows. */
  colAt(x: number): number {
    return this.pair && x >= this.cols ? x - this.cols : x;
  }

  /** A cell of the face: `c` across the `side` ski (0 on a board). */
  cellIndex(along: number, side: number, c: number): number {
    return along * this.art.cols + side * this.cols + c;
  }

  /** The cell under grid column `x`. */
  index(along: number, x: number): number {
    return this.cellIndex(along, this.sideAt(x), this.colAt(x));
  }

  /** The skis a cell painted on `side` lands on: both while linked. */
  private paintSides(side: number): readonly number[] {
    return this.linked ? BOTH : ONE[side]!;
  }

  /** The brush's square at (along, x) in grid columns, cut to the grid. An even brush reaches one more cell right and down. */
  square(along: number, x: number): Box {
    const lo = -Math.floor((this.brush - 1) / 2);
    return [Math.max(0, along + lo), Math.max(0, x + lo), Math.min(this.rows - 1, along + lo + this.brush - 1), Math.min(this.gridCols - 1, x + lo + this.brush - 1)];
  }

  /** Paints one cell on its ski, and its mirrors while the switches are on (tip to tail, and edge to edge within the ski). */
  private put(along: number, side: number, c: number): void {
    const cells = this.art.cells;
    const fa = this.rows - 1 - along;
    const fc = this.cols - 1 - c;
    for (const s of this.paintSides(side)) {
      cells[this.cellIndex(along, s, c)] = this.color;
      if (this.mirrorEnds) cells[this.cellIndex(fa, s, c)] = this.color;
      if (this.mirrorSides) cells[this.cellIndex(along, s, fc)] = this.color;
      if (this.mirrorEnds && this.mirrorSides) cells[this.cellIndex(fa, s, fc)] = this.color;
    }
  }

  /** Paints the brush at (along, x), and its mirrors; side by side its square may reach across onto the other ski. */
  stamp(along: number, x: number): void {
    const [a0, x0, a1, x1] = this.square(along, x);
    for (let a = a0; a <= a1; a++) for (let xx = x0; xx <= x1; xx++) this.put(a, this.sideAt(xx), this.colAt(xx));
  }

  /** Stamps a straight line of cells from (a, x) to (along, toX), so a fast drag leaves no gaps. */
  line(a: number, x: number, along: number, toX: number): void {
    const da = Math.abs(along - a);
    const dc = Math.abs(toX - x);
    const sa = along > a ? 1 : -1;
    const sc = toX > x ? 1 : -1;
    let err = da - dc;
    for (;;) {
      this.stamp(a, x);
      if (a === along && x === toX) break;
      const e2 = 2 * err;
      if (e2 > -dc) {
        err -= dc;
        a += sa;
      }
      if (e2 < da) {
        err += da;
        x += sc;
      }
    }
  }

  /** The cells a fill at (along, c) on one ski starts from: it, and its mirrors while the switches are on. */
  private targets(along: number, c: number): [number, number][] {
    const out: [number, number][] = [[along, c]];
    const fa = this.rows - 1 - along;
    const fc = this.cols - 1 - c;
    if (this.mirrorEnds) out.push([fa, c]);
    if (this.mirrorSides) out.push([along, fc]);
    if (this.mirrorEnds && this.mirrorSides) out.push([fa, fc]);
    return out;
  }

  /** Fills the patch of one color round (along, x), four ways within its ski, and its mirrors (on both skis while linked). */
  floodFill(along: number, x: number): void {
    const { rows, cols } = this;
    const cells = this.art.cells;
    for (const side of this.paintSides(this.sideAt(x))) {
      for (const [sa, sc] of this.targets(along, this.colAt(x))) {
        const from = cells[this.cellIndex(sa, side, sc)]!;
        if (from === this.color) continue;
        cells[this.cellIndex(sa, side, sc)] = this.color;
        const stack: [number, number][] = [[sa, sc]];
        while (stack.length > 0) {
          const [a, c] = stack.pop()!;
          for (const [na, nc] of [
            [a - 1, c],
            [a + 1, c],
            [a, c - 1],
            [a, c + 1],
          ] as const) {
            if (na < 0 || na >= rows || nc < 0 || nc >= cols) continue;
            const j = this.cellIndex(na, side, nc);
            if (cells[j] !== from) continue;
            cells[j] = this.color;
            stack.push([na, nc]);
          }
        }
      }
    }
  }

  /** The whole face in the picked color: of the skis showing (both while linked or side by side), or the board. */
  fillAll(): void {
    const sides = this.onBoard ? ONE[0] : this.pair || this.linked ? BOTH : ONE[this.side]!;
    for (const side of sides) {
      for (let a = 0; a < this.rows; a++) this.art.cells.fill(this.color, this.cellIndex(a, side, 0), this.cellIndex(a, side, this.cols));
    }
  }

  /**
   * What the tool would paint at (along, x), as boxes in grid columns: the
   * pencil's brush (or a fill's starting cell) first, then its mirrors within
   * each ski and, side by side while linked, its copy on the other ski.
   */
  marks(along: number, x: number, pencil: boolean): Box[] {
    const main: Box = pencil ? this.square(along, x) : [along, x, along, x];
    const out: Box[] = [main];
    const { rows, cols } = this;
    const [a0, x0, a1, x1] = main;
    const fa0 = rows - 1 - a1;
    const fa1 = rows - 1 - a0;
    // The box's part on each ski it covers (one ski's grid shows as side 0), then each mirror (and copy) of that part.
    for (const side of this.pair ? BOTH : ONE[0]) {
      const lo = Math.max(x0, this.pair ? side * cols : 0);
      const hi = Math.min(x1, this.pair ? side * cols + cols - 1 : cols - 1);
      if (lo > hi) continue;
      const c0 = this.colAt(lo);
      const c1 = this.colAt(hi);
      const onto = this.pair && this.linked ? BOTH : ONE[this.pair ? side : 0]!;
      for (const s of onto) {
        const at = this.pair ? s * cols : 0;
        if (s !== side) out.push([a0, at + c0, a1, at + c1]);
        if (this.mirrorEnds) out.push([fa0, at + c0, fa1, at + c1]);
        if (this.mirrorSides) out.push([a0, at + cols - 1 - c1, a1, at + cols - 1 - c0]);
        if (this.mirrorEnds && this.mirrorSides) out.push([fa0, at + cols - 1 - c1, fa1, at + cols - 1 - c0]);
      }
    }
    return out;
  }

  /**
   * Draws the grid at `s` CSS pixels a cell: the cells, the cell lines, a
   * stronger line every eight cells along and down each ski's middle (where
   * Mirror sides folds), the seam side by side, then the marks: under the
   * mouse (hoverAlong >= 0) where the tool would paint, in the picked color,
   * and round the keyboard cursor (when `cursor`) a white box, its mirrors dashed.
   */
  draw(ctx: CanvasRenderingContext2D, s: number, dpr: number, pencil: boolean, hoverAlong: number, hoverX: number, cursor: boolean, along: number, x: number): void {
    const { rows, cols } = this;
    const gridCols = this.gridCols;
    const { cells, colors } = this.art;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (let a = 0; a < rows; a++) {
      for (let xx = 0; xx < gridCols; xx++) {
        ctx.fillStyle = colors[cells[this.index(a, xx)]!]!;
        ctx.fillRect(a * s, xx * s, s, s);
      }
    }
    if (s >= 6) {
      ctx.fillStyle = 'rgb(0 0 0 / 0.22)';
      for (let a = 1; a < rows; a++) ctx.fillRect(a * s, 0, 1 / dpr, gridCols * s);
      for (let xx = 1; xx < gridCols; xx++) ctx.fillRect(0, xx * s, rows * s, 1 / dpr);
    }
    ctx.fillStyle = 'rgb(255 255 255 / 0.28)';
    for (let a = 8; a < rows; a += 8) ctx.fillRect(a * s - 0.5, 0, 1, gridCols * s);
    for (let k = 0; k < gridCols / cols; k++) ctx.fillRect(0, (k + 0.5) * cols * s - 0.5, rows * s, 1);
    // Side by side: a seam between the left ski and the right, a light line on a dark keyline so it shows on any color.
    if (this.pair) {
      ctx.fillStyle = '#142030';
      ctx.fillRect(0, cols * s - 2, rows * s, 4);
      ctx.fillStyle = 'rgb(244 248 252 / 0.85)';
      ctx.fillRect(0, cols * s - 1, rows * s, 2);
    }
    if (hoverAlong >= 0) {
      ctx.fillStyle = colors[this.color]!;
      for (const [a0, x0, a1, x1] of this.marks(hoverAlong, hoverX, pencil)) {
        const w = (a1 - a0 + 1) * s;
        const h = (x1 - x0 + 1) * s;
        ctx.fillRect(a0 * s + 1, x0 * s + 1, w - 2, h - 2);
        box(ctx, a0 * s, x0 * s, w, h, 'rgb(255 255 255 / 0.8)', 1);
      }
    }
    if (cursor) {
      this.marks(along, x, pencil).forEach(([a0, x0, a1, x1], i) => {
        const bx = a0 * s - 1;
        const by = x0 * s - 1;
        const bw = (a1 - a0 + 1) * s + 2;
        const bh = (x1 - x0 + 1) * s + 2;
        if (i > 0) ctx.setLineDash([2, 2]);
        box(ctx, bx, by, bw, bh, '#142030', 4);
        box(ctx, bx, by, bw, bh, '#f4f8fc', 2);
        ctx.setLineDash([]);
      });
    }
  }
}

function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, width: number): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.strokeRect(x, y, w, h);
}
