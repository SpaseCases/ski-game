import type { WearPanel } from '../render/wearPanels.ts';

// The garment editor's grid (ui/wearEditor.ts) as numbers: the garment's
// pieces laid out flat (render/wearPanels.ts), which square a layout cell
// is, the brush and the left-right mirror, a straight line of stamps, a fill
// that wraps round each piece (each is a tube), and drawing the grid with
// its cursor marks. It runs on every pointer move and every frame of a
// stroke, so it holds no text and the production build leaves it minified
// only (tools/vite/obfuscate.js EXCLUDE), as ui/paintGrid.ts.

/** A box of layout cells (inclusive): x0, y0, x1, y1. */
export type WearBox = readonly [number, number, number, number];

export class WearGrid {
  panels: readonly WearPanel[] = [];
  /** Where each panel's squares start in `cells`. */
  offsets: readonly number[] = [];
  cells: Uint8Array = new Uint8Array(0);
  colors: readonly string[] = [];
  /** The layout's size in cells. */
  width = 0;
  height = 0;
  color = 0;
  /** The pencil's square, this many cells across. */
  brush = 1;
  /** Every stroke also paints the other side: across the front of the body and the seat, from one sleeve or leg onto the other. */
  mirror = false;

  /** The panel at layout cell (x, y), or -1 in a gap. */
  panelAt(x: number, y: number): number {
    const ps = this.panels;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i]!;
      if (x >= p.x && x < p.x + p.cols && y >= p.y && y < p.y + p.rows) return i;
    }
    return -1;
  }

  /** The square at layout cell (x, y), or -1 in a gap. */
  index(x: number, y: number): number {
    const i = this.panelAt(x, y);
    if (i < 0) return -1;
    const p = this.panels[i]!;
    return this.offsets[i]! + (y - p.y) * p.cols + (x - p.x);
  }

  /** Paints one square (panel, row, column) and, with the mirror on, its mirror. */
  private put(panel: number, r: number, c: number): void {
    const p = this.panels[panel]!;
    this.cells[this.offsets[panel]! + r * p.cols + c] = this.color;
    if (!this.mirror) return;
    const m = p.mirror;
    const q = this.panels[m]!;
    this.cells[this.offsets[m]! + r * q.cols + (q.cols - 1 - c)] = this.color;
  }

  /** The brush's square at (x, y), cut to the panel there; null in a gap. An even brush reaches one more cell right and down. */
  square(x: number, y: number): WearBox | null {
    const i = this.panelAt(x, y);
    if (i < 0) return null;
    const p = this.panels[i]!;
    const lo = -Math.floor((this.brush - 1) / 2);
    return [Math.max(p.x, x + lo), Math.max(p.y, y + lo), Math.min(p.x + p.cols - 1, x + lo + this.brush - 1), Math.min(p.y + p.rows - 1, y + lo + this.brush - 1)];
  }

  /** Paints the brush at (x, y) (nothing in a gap), and its mirror. */
  stamp(x: number, y: number): void {
    const b = this.square(x, y);
    if (!b) return;
    const i = this.panelAt(x, y);
    const p = this.panels[i]!;
    for (let yy = b[1]; yy <= b[3]; yy++) for (let xx = b[0]; xx <= b[2]; xx++) this.put(i, yy - p.y, xx - p.x);
  }

  /** Stamps a straight line of cells from (x, y) to (toX, toY), so a fast drag leaves no gaps. */
  line(x: number, y: number, toX: number, toY: number): void {
    const dx = Math.abs(toX - x);
    const dy = Math.abs(toY - y);
    const sx = toX > x ? 1 : -1;
    const sy = toY > y ? 1 : -1;
    let err = dx - dy;
    for (;;) {
      this.stamp(x, y);
      if (x === toX && y === toY) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }
  }

  /** Fills the patch of one color round (x, y), four ways within its panel (wrapping round its sides: each piece is a tube), and from its mirror. */
  floodFill(x: number, y: number): void {
    const i = this.panelAt(x, y);
    if (i < 0) return;
    const p = this.panels[i]!;
    this.fillFrom(i, y - p.y, x - p.x);
    if (this.mirror) this.fillFrom(p.mirror, y - p.y, this.panels[p.mirror]!.cols - 1 - (x - p.x));
  }

  private fillFrom(panel: number, r0: number, c0: number): void {
    const p = this.panels[panel]!;
    const at = this.offsets[panel]!;
    const cells = this.cells;
    const from = cells[at + r0 * p.cols + c0]!;
    if (from === this.color) return;
    cells[at + r0 * p.cols + c0] = this.color;
    const stack = [r0, c0];
    while (stack.length > 0) {
      const c = stack.pop()!;
      const r = stack.pop()!;
      for (let k = 0; k < 4; k++) {
        const nr = k === 0 ? r - 1 : k === 1 ? r + 1 : r;
        const nc = k === 2 ? (c + p.cols - 1) % p.cols : k === 3 ? (c + 1) % p.cols : c;
        if (nr < 0 || nr >= p.rows) continue;
        const j = at + nr * p.cols + nc;
        if (cells[j] !== from) continue;
        cells[j] = this.color;
        stack.push(nr, nc);
      }
    }
  }

  /** Every square in the picked color. */
  fillAll(): void {
    this.cells.fill(this.color);
  }

  /** What the tool would paint at (x, y), as boxes: the pencil's brush (or a fill's starting cell), then its mirror. */
  marks(x: number, y: number, pencil: boolean): WearBox[] {
    const main = pencil ? this.square(x, y) : this.panelAt(x, y) >= 0 ? ([x, y, x, y] as const) : null;
    if (!main) return [];
    const out: WearBox[] = [main];
    if (this.mirror) {
      const p = this.panels[this.panelAt(x, y)]!;
      const q = this.panels[p.mirror]!;
      const c0 = main[0] - p.x;
      const c1 = main[2] - p.x;
      const box: WearBox = [q.x + q.cols - 1 - c1, main[1], q.x + q.cols - 1 - c0, main[3]];
      if (box[0] !== main[0] || box[2] !== main[2] || p !== q) out.push(box);
    }
    return out;
  }

  /**
   * The next layout cell from (x, y) a step (dx, dy) away that is a square,
   * skipping the gaps between pieces; (x, y) itself when there is none.
   */
  step(x: number, y: number, dx: number, dy: number): [number, number] {
    let nx = x + dx;
    let ny = y + dy;
    while (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
      if (this.panelAt(nx, ny) >= 0) return [nx, ny];
      nx += dx;
      ny += dy;
    }
    return [x, y];
  }

  /**
   * Draws the grid at `s` CSS pixels a cell: each piece's squares, the cell
   * lines, its middle (the front, where the mirror folds) and its outline;
   * then under the mouse (hoverX >= 0) where the tool would paint, in the
   * picked color, and round the keyboard cursor (when `cursor`) a white box,
   * its mirror dashed.
   */
  draw(ctx: CanvasRenderingContext2D, s: number, dpr: number, pencil: boolean, hoverX: number, hoverY: number, cursor: boolean, x: number, y: number): void {
    const { cells, colors } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.width * s, this.height * s);
    this.panels.forEach((p, i) => {
      const at = this.offsets[i]!;
      const px = p.x * s;
      const py = p.y * s;
      for (let r = 0; r < p.rows; r++) {
        for (let c = 0; c < p.cols; c++) {
          ctx.fillStyle = colors[cells[at + r * p.cols + c]!]!;
          ctx.fillRect(px + c * s, py + r * s, s, s);
        }
      }
      if (s >= 6) {
        ctx.fillStyle = 'rgb(0 0 0 / 0.22)';
        for (let c = 1; c < p.cols; c++) ctx.fillRect(px + c * s, py, 1 / dpr, p.rows * s);
        for (let r = 1; r < p.rows; r++) ctx.fillRect(px, py + r * s, p.cols * s, 1 / dpr);
      }
      ctx.fillStyle = 'rgb(255 255 255 / 0.4)';
      ctx.fillRect(px + (p.cols / 2) * s - 0.5, py, 1, p.rows * s);
      box(ctx, px, py, p.cols * s, p.rows * s, 'rgb(255 255 255 / 0.35)', 1);
    });
    if (hoverX >= 0) {
      ctx.fillStyle = colors[this.color]!;
      for (const [x0, y0, x1, y1] of this.marks(hoverX, hoverY, pencil)) {
        const w = (x1 - x0 + 1) * s;
        const h = (y1 - y0 + 1) * s;
        ctx.fillRect(x0 * s + 1, y0 * s + 1, w - 2, h - 2);
        box(ctx, x0 * s, y0 * s, w, h, 'rgb(255 255 255 / 0.8)', 1);
      }
    }
    if (cursor) {
      this.marks(x, y, pencil).forEach(([x0, y0, x1, y1], i) => {
        const bx = x0 * s - 1;
        const by = y0 * s - 1;
        const bw = (x1 - x0 + 1) * s + 2;
        const bh = (y1 - y0 + 1) * s + 2;
        if (i > 0) ctx.setLineDash([2, 2]);
        box(ctx, bx, by, bw, bh, '#142030', 4);
        box(ctx, bx, by, bw, bh, '#f4f8fc', 2);
        ctx.setLineDash([]);
      });
    }
  }
}

/**
 * A garment's pieces in their layout, `px` CSS pixels a square, on `canvas`
 * (the Locker's slot thumbnails): `cells` null draws the pieces' outlines only (an empty slot).
 */
export function drawWear(canvas: HTMLCanvasElement, panels: readonly WearPanel[], offsets: readonly number[], cells: Uint8Array | null, colors: readonly string[], px: number, empty: string): void {
  let width = 0;
  let height = 0;
  for (const p of panels) {
    width = Math.max(width, p.x + p.cols);
    height = Math.max(height, p.y + p.rows);
  }
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * px * dpr);
  canvas.height = Math.round(height * px * dpr);
  canvas.style.width = `${width * px}px`;
  canvas.style.height = `${height * px}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  panels.forEach((p, i) => {
    if (!cells) {
      ctx.fillStyle = empty;
      ctx.fillRect(p.x * px, p.y * px, p.cols * px, p.rows * px);
      return;
    }
    const at = offsets[i]!;
    for (let r = 0; r < p.rows; r++) {
      for (let c = 0; c < p.cols; c++) {
        ctx.fillStyle = colors[cells[at + r * p.cols + c]!]!;
        ctx.fillRect((p.x + c) * px, (p.y + r) * px, px, px);
      }
    }
  });
}

function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, width: number): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.strokeRect(x, y, w, h);
}
