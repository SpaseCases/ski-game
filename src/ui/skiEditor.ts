import { copyStock, customArt, customBase, customId, EDIT_PALETTE, saveCustomSkis, setCustomBase } from '../core/customSkis.ts';
import { skiGraphic, skiType, type PixelArt, type SkiGraphic, type SkiId, type SkiType } from '../core/skis.ts';
import type { Rect } from '../render/lockerStage.ts';
import { keycap } from './keyNames.ts';
import { board, setHints, type Screen } from './menus.ts';
import { paintSkis } from './skiThumb.ts';

// The ski editor, opened from a custom slot's Edit in the Locker: that
// ski's top-sheet grid laid out long (tail on the left, tip on the right,
// the left edge on top, as in the rack), painted a cell at a time from the
// editor palette. The arrows move a cursor and Space or Enter paints (held,
// it paints as the cursor moves); the mouse paints by dragging. Pencil or
// fill; the mirror switches paint every stroke tip to tail and edge to edge
// too. Every stroke is saved at once (core/customSkis.ts) and shows on the
// 3D skis turning in the window beside the tools.

export interface SkiEditorHooks {
  /** Put that slot's graphic on the skier. */
  wear: (ski: SkiId, graphic: string) => void;
  /** The slot's cells or base changed: rebuild the 3D skis. */
  repaint: () => void;
  /** The editor opened (true) or closed or was covered (false). */
  shown: (open: boolean) => void;
}

type Tool = 'pencil' | 'fill';
interface Snapshot {
  cells: Uint8Array;
  base: number;
}

/** Undo steps kept. */
const UNDO_MAX = 60;
/** Grid cell size in CSS pixels: as big as fits, within these. */
const CELL_MAX = 16;
const CELL_MIN = 4;
/** How far Shift + an arrow jumps. */
const JUMP = 4;
/** The boots stand on about this much of the ski (m), for the ruler. */
const BOOT_LENGTH = 0.32;

/** Arrow keys: cells along, cells across. */
const MOVES: Partial<Record<string, readonly [number, number]>> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

const HINTS = [
  [['←', '→', '↑', '↓'], 'Move'],
  [['Space'], 'Paint'],
  [['[', ']'], 'Color'],
  [['I'], 'Take the color under the cursor'],
  [['Tab'], 'Palette and tools'],
  [['Esc'], 'Done'],
] as const;

export class SkiEditorScreen implements Screen {
  readonly el: HTMLElement;
  private readonly hooks: SkiEditorHooks;
  private readonly sub: HTMLElement;
  private readonly bench: HTMLElement;
  private readonly grid: HTMLCanvasElement;
  private readonly boots: HTMLElement;
  private readonly status: HTMLElement;
  private readonly shape: HTMLCanvasElement;
  private readonly shapeBox: HTMLElement;
  private readonly starts: HTMLElement;
  private readonly chips: HTMLButtonElement[] = [];
  private readonly colorName: HTMLElement;
  private readonly colorSwatch: HTMLElement;
  private readonly baseSwatch: HTMLElement;
  private readonly toolButtons = new Map<Tool, HTMLButtonElement>();
  private readonly mirrorEndsButton: HTMLButtonElement;
  private readonly mirrorSidesButton: HTMLButtonElement;
  private readonly undoButton: HTMLButtonElement;
  private readonly blankSwatches: HTMLElement[] = [];
  private readonly view: HTMLElement;
  private readonly rect: Rect = { x: 0, y: 0, width: 0, height: 0 };

  private ski: SkiId = 'park';
  private slot = 0;
  private type: SkiType = skiType('park');
  private art!: PixelArt;
  /** Cursor: `along` from the tail (the grid's rows), `across` from the left edge (its columns). */
  private along = 0;
  private across = 0;
  /** The mouse's cell, or along < 0 when it's off the grid. */
  private hoverAlong = -1;
  private hoverAcross = 0;
  private color = 22;
  private tool: Tool = 'pencil';
  private mirrorEnds = false;
  private mirrorSides = false;
  private undo: Snapshot[] = [];
  /** A stroke being painted: by the mouse (its last cell) or by a held Space or Enter. */
  private dragging = false;
  private penDown = false;
  private lastAlong = 0;
  private lastAcross = 0;
  private cell = CELL_MAX;
  private drawQueued = false;
  /** The true-shape ski needs painting again on the next draw. */
  private shapeDirty = true;
  private shown = false;
  private readonly onResize = (): void => this.layout();
  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === ' ') this.liftPen();
  };

  constructor(hooks: SkiEditorHooks, onDone: () => void) {
    this.hooks = hooks;
    const b = board('Ski editor', 'editor-screen');
    this.el = b.el;
    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'board-back';
    done.append(document.createTextNode('Done'), keycap('Esc'));
    done.addEventListener('click', onDone);
    b.head.appendChild(done);
    this.sub = b.sub;
    this.sub.hidden = false;

    // The bench: the grid, and a ruler under it marking the ends and where the boots stand.
    this.bench = document.createElement('div');
    this.bench.className = 'editor-bench';
    this.grid = document.createElement('canvas');
    this.grid.className = 'editor-grid';
    this.grid.tabIndex = 0;
    this.grid.setAttribute('role', 'application');
    this.grid.setAttribute('aria-roledescription', 'pixel grid');
    this.listenPointer();
    this.grid.addEventListener('blur', () => {
      this.liftPen();
      this.queueDraw();
    });
    this.grid.addEventListener('focus', () => this.queueDraw());
    const ruler = document.createElement('div');
    ruler.className = 'editor-ruler';
    const tail = document.createElement('span');
    tail.textContent = 'Tail';
    this.boots = document.createElement('span');
    this.boots.className = 'editor-boots';
    this.boots.textContent = 'Boots';
    const tip = document.createElement('span');
    tip.textContent = 'Tip';
    this.status = document.createElement('span');
    this.status.className = 'editor-status';
    ruler.append(tail, this.status, this.boots, tip);
    this.bench.append(this.grid, ruler);

    // The ski as it really is (the grid stretched to its outline), and the graphics to start from.
    const mid = document.createElement('div');
    mid.className = 'editor-mid';
    this.shapeBox = document.createElement('div');
    this.shapeBox.className = 'editor-shape';
    this.shapeBox.append(label('On the ski'));
    this.shape = document.createElement('canvas');
    this.shape.className = 'editor-shape-ski';
    this.shapeBox.appendChild(this.shape);
    const startBox = document.createElement('div');
    startBox.className = 'editor-start';
    startBox.append(label('Start from'));
    this.starts = document.createElement('div');
    this.starts.className = 'editor-starts';
    this.starts.setAttribute('role', 'group');
    this.starts.setAttribute('aria-label', 'Start from');
    startBox.appendChild(this.starts);
    mid.append(this.shapeBox, startBox);

    // Palette, tools and the 3D window.
    const lower = document.createElement('div');
    lower.className = 'editor-lower';
    const palette = document.createElement('div');
    palette.className = 'editor-palette';
    const paletteHead = document.createElement('div');
    paletteHead.className = 'paint-head';
    const colorLabel = document.createElement('span');
    colorLabel.className = 'paint-part';
    colorLabel.textContent = 'Color';
    this.colorSwatch = document.createElement('span');
    this.colorSwatch.className = 'editor-swatch';
    this.colorName = document.createElement('span');
    this.colorName.className = 'paint-name';
    const picked = document.createElement('span');
    picked.className = 'editor-picked';
    picked.append(this.colorSwatch, this.colorName);
    paletteHead.append(colorLabel, picked);
    const chipGrid = document.createElement('div');
    chipGrid.className = 'editor-chips';
    chipGrid.setAttribute('role', 'group');
    chipGrid.setAttribute('aria-label', 'Palette');
    EDIT_PALETTE.forEach((c, i) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.style.setProperty('--chip', c.hex);
      chip.title = c.name;
      chip.setAttribute('aria-label', c.name);
      chip.addEventListener('click', () => this.setColor(i));
      chipGrid.appendChild(chip);
      this.chips.push(chip);
    });
    palette.append(paletteHead, chipGrid);

    const tools = document.createElement('div');
    tools.className = 'editor-tools';
    tools.setAttribute('role', 'group');
    tools.setAttribute('aria-label', 'Tools');
    for (const [tool, name, key] of [
      ['pencil', 'Pencil', 'P'],
      ['fill', 'Fill', 'F'],
    ] as const) {
      const t = toolButton(name, key, () => this.setTool(tool));
      this.toolButtons.set(tool, t);
      tools.appendChild(t);
    }
    this.mirrorEndsButton = toolButton('Mirror ends', 'E', () => this.toggleMirror('ends'));
    this.mirrorSidesButton = toolButton('Mirror sides', 'S', () => this.toggleMirror('sides'));
    this.undoButton = toolButton('Undo', 'Z', () => this.stepBack());
    const clear = toolButton('Clear', '', () => this.fillAll());
    clear.title = 'Paint the whole ski in the picked color';
    const base = toolButton('Base', 'B', () => this.setBase());
    base.title = 'The base and sidewalls take the picked color';
    this.baseSwatch = document.createElement('span');
    this.baseSwatch.className = 'editor-swatch';
    base.querySelector('.editor-tool-name')!.prepend(this.baseSwatch);
    tools.append(this.mirrorEndsButton, this.mirrorSidesButton, this.undoButton, clear, base);

    const frame = document.createElement('div');
    frame.className = 'locker-frame editor-frame';
    this.view = document.createElement('div');
    this.view.className = 'locker-view';
    this.view.setAttribute('role', 'img');
    this.view.setAttribute('aria-label', 'Your skis, turning slowly');
    frame.appendChild(this.view);

    lower.append(palette, tools, frame);
    b.body.append(this.bench, mid, lower);
    setHints(b.foot, HINTS);
  }

  /** Points the editor at a ski's custom slot (painting it for the first time makes it) and puts it on the skier. */
  open(ski: SkiId, slot: number): void {
    this.ski = ski;
    this.slot = slot;
    this.type = skiType(ski);
    this.art = customArt(ski, slot);
    this.along = Math.floor(this.art.rows / 2);
    this.across = Math.floor(this.art.cols / 2);
    this.undo = [];
    this.sub.textContent = `Custom ${slot + 1} on the ${this.type.name} ski. Both skis get the same picture, and it saves as you paint.`;
    const m = this.type.model;
    const boot = (m.length / 2 - m.mount) / m.length;
    this.boots.style.left = `${((boot - BOOT_LENGTH / 2 / m.length) * 100).toFixed(1)}%`;
    this.boots.style.width = `${((BOOT_LENGTH / m.length) * 100).toFixed(1)}%`;
    this.grid.setAttribute('aria-label', `Top sheet, ${m.rows} cells long and ${m.cols} across. Arrows move, Space paints.`);
    this.buildStarts();
    saveCustomSkis();
    this.hooks.wear(ski, customId(ski, slot));
  }

  enter(): HTMLElement | null {
    this.shown = true;
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keyup', this.onKeyUp);
    this.hooks.shown(true);
    this.sync();
    this.layout();
    return this.grid;
  }

  leave(): void {
    this.shown = false;
    this.liftPen();
    this.endDrag();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keyup', this.onKeyUp);
    this.hooks.shown(false);
  }

  /** Where the 3D skis show, in CSS pixels from the viewport's top left (read every frame while open). */
  viewRect(): Rect {
    const r = this.view.getBoundingClientRect();
    this.rect.x = Math.round(r.left);
    this.rect.y = Math.round(r.top);
    this.rect.width = Math.round(r.width);
    this.rect.height = Math.round(r.height);
    return this.rect;
  }

  onKey(e: KeyboardEvent): boolean {
    const onGrid = document.activeElement === this.grid;
    if (onGrid) {
      const move = MOVES[e.key];
      if (move) {
        const step = e.shiftKey ? JUMP : 1;
        this.moveCursor(move[0] * step, move[1] * step);
        return true;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        if (!e.repeat) this.paintAtCursor();
        return true;
      }
    }
    if (e.altKey || e.metaKey) return false;
    const key = e.key.toLowerCase();
    if (e.ctrlKey) {
      if (key !== 'z') return false;
      this.stepBack();
      return true;
    }
    switch (key) {
      case 'z':
        this.stepBack();
        return true;
      case '[':
      case ']':
        this.setColor((this.color + (key === ']' ? 1 : -1) + EDIT_PALETTE.length) % EDIT_PALETTE.length);
        return true;
    }
    if (e.repeat) return false;
    switch (key) {
      case 'p':
        this.setTool('pencil');
        return true;
      case 'f':
        this.setTool('fill');
        return true;
      case 'e':
        this.toggleMirror('ends');
        return true;
      case 's':
        this.toggleMirror('sides');
        return true;
      case 'i':
        this.setColor(this.art.cells[this.index(this.along, this.across)]!);
        return true;
      case 'b':
        this.setBase();
        return true;
    }
    return false;
  }

  // ------------------------------------------------------------- painting

  private index(along: number, across: number): number {
    return along * this.art.cols + across;
  }

  /** The cells a stroke at (along, across) paints: it, and its mirrors while the switches are on. */
  private targets(along: number, across: number): [number, number][] {
    const out: [number, number][] = [[along, across]];
    const fa = this.art.rows - 1 - along;
    const fc = this.art.cols - 1 - across;
    if (this.mirrorEnds) out.push([fa, across]);
    if (this.mirrorSides) out.push([along, fc]);
    if (this.mirrorEnds && this.mirrorSides) out.push([fa, fc]);
    return out;
  }

  private paintCell(along: number, across: number): void {
    for (const [a, c] of this.targets(along, across)) this.art.cells[this.index(a, c)] = this.color;
    this.changed();
  }

  /** Paints a straight line of cells from the last one painted, so a fast drag leaves no gaps. */
  private paintLine(along: number, across: number): void {
    let a = this.lastAlong;
    let c = this.lastAcross;
    const da = Math.abs(along - a);
    const dc = Math.abs(across - c);
    const sa = along > a ? 1 : -1;
    const sc = across > c ? 1 : -1;
    let err = da - dc;
    for (;;) {
      for (const [ta, tc] of this.targets(a, c)) this.art.cells[this.index(ta, tc)] = this.color;
      if (a === along && c === across) break;
      const e2 = 2 * err;
      if (e2 > -dc) {
        err -= dc;
        a += sa;
      }
      if (e2 < da) {
        err += da;
        c += sc;
      }
    }
    this.lastAlong = along;
    this.lastAcross = across;
    this.changed();
  }

  /** Fills the patch of one color round (along, across), four ways, and its mirrors. */
  private floodFill(along: number, across: number): void {
    const { rows, cols, cells } = this.art;
    for (const [sa, sc] of this.targets(along, across)) {
      const from = cells[this.index(sa, sc)]!;
      if (from === this.color) continue;
      const stack = [this.index(sa, sc)];
      cells[stack[0]!] = this.color;
      while (stack.length > 0) {
        const i = stack.pop()!;
        const a = Math.floor(i / cols);
        const c = i % cols;
        for (const [na, nc] of [
          [a - 1, c],
          [a + 1, c],
          [a, c - 1],
          [a, c + 1],
        ] as const) {
          if (na < 0 || na >= rows || nc < 0 || nc >= cols) continue;
          const j = this.index(na, nc);
          if (cells[j] !== from) continue;
          cells[j] = this.color;
          stack.push(j);
        }
      }
    }
    this.changed();
  }

  private paintAtCursor(): void {
    this.remember();
    if (this.tool === 'fill') {
      this.floodFill(this.along, this.across);
      saveCustomSkis();
      return;
    }
    this.penDown = true;
    this.lastAlong = this.along;
    this.lastAcross = this.across;
    this.paintCell(this.along, this.across);
  }

  private liftPen(): void {
    if (!this.penDown) return;
    this.penDown = false;
    saveCustomSkis();
  }

  private moveCursor(da: number, dc: number): void {
    this.along = Math.min(this.art.rows - 1, Math.max(0, this.along + da));
    this.across = Math.min(this.art.cols - 1, Math.max(0, this.across + dc));
    if (this.penDown) this.paintLine(this.along, this.across);
    else this.queueDraw();
  }

  private fillAll(): void {
    this.remember();
    this.art.cells.fill(this.color);
    this.changed();
    saveCustomSkis();
  }

  private startFrom(g: SkiGraphic | null): void {
    if (g) {
      this.remember();
      copyStock(this.ski, this.slot, g);
      this.changed();
      saveCustomSkis();
      this.sync();
    } else this.fillAll();
  }

  private setBase(): void {
    if (customBase(this.ski, this.slot) === this.color) return;
    this.remember();
    setCustomBase(this.ski, this.slot, this.color);
    this.changed();
    saveCustomSkis();
    this.sync();
  }

  /** Keeps the slot as it is now, for Undo (before a stroke or an action). */
  private remember(): void {
    this.undo.push({ cells: this.art.cells.slice(), base: customBase(this.ski, this.slot) });
    if (this.undo.length > UNDO_MAX) this.undo.shift();
    this.undoButton.disabled = false;
  }

  private stepBack(): void {
    if (this.penDown || this.dragging) return;
    const last = this.undo.pop();
    if (!last) return;
    this.art.cells.set(last.cells);
    setCustomBase(this.ski, this.slot, last.base);
    this.changed();
    saveCustomSkis();
    this.sync();
  }

  private setColor(i: number): void {
    this.color = i;
    this.sync();
    this.queueDraw();
  }

  private setTool(tool: Tool): void {
    this.tool = tool;
    this.sync();
  }

  private toggleMirror(which: 'ends' | 'sides'): void {
    if (which === 'ends') this.mirrorEnds = !this.mirrorEnds;
    else this.mirrorSides = !this.mirrorSides;
    this.sync();
    this.queueDraw();
  }

  /** The cells changed: redraw (once a frame) and rebuild the 3D skis. */
  private changed(): void {
    this.queueDraw(true);
    this.hooks.repaint();
  }

  // ---------------------------------------------------------- the mouse

  private listenPointer(): void {
    const g = this.grid;
    g.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      g.focus({ preventScroll: true });
      const [a, c] = this.cellAt(e);
      if (a < 0) return;
      this.along = a;
      this.across = c;
      this.remember();
      if (this.tool === 'fill') {
        this.floodFill(a, c);
        saveCustomSkis();
        return;
      }
      g.setPointerCapture(e.pointerId);
      this.dragging = true;
      this.lastAlong = a;
      this.lastAcross = c;
      this.paintCell(a, c);
    });
    g.addEventListener('pointermove', (e) => {
      const [a, c] = this.cellAt(e);
      if (this.dragging) {
        if (a < 0) return;
        this.along = a;
        this.across = c;
        if (a !== this.lastAlong || c !== this.lastAcross) this.paintLine(a, c);
        return;
      }
      if (a !== this.hoverAlong || c !== this.hoverAcross) {
        this.hoverAlong = a;
        this.hoverAcross = c;
        this.queueDraw();
      }
    });
    g.addEventListener('pointerleave', () => {
      this.hoverAlong = -1;
      this.queueDraw();
    });
    const end = (): void => this.endDrag();
    g.addEventListener('pointerup', end);
    g.addEventListener('pointercancel', end);
    g.addEventListener('lostpointercapture', end);
    // No menu on a right click: the game never uses one.
    g.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private endDrag(): void {
    if (!this.dragging) return;
    this.dragging = false;
    saveCustomSkis();
  }

  /** The grid cell under a pointer, clamped to the grid while dragging; along -1 when off it. */
  private cellAt(e: PointerEvent): [number, number] {
    const r = this.grid.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return [-1, 0];
    const a = Math.floor(((e.clientX - r.left) / r.width) * this.art.rows);
    const c = Math.floor(((e.clientY - r.top) / r.height) * this.art.cols);
    const inside = a >= 0 && a < this.art.rows && c >= 0 && c < this.art.cols;
    if (!inside && !this.dragging) return [-1, 0];
    return [Math.min(this.art.rows - 1, Math.max(0, a)), Math.min(this.art.cols - 1, Math.max(0, c))];
  }

  // -------------------------------------------------------------- drawing

  /** Sizes the grid to the bench and the true-shape ski to its box (on opening and when the window resizes). */
  private layout(): void {
    if (!this.shown) return;
    const width = this.bench.clientWidth;
    this.cell = Math.max(CELL_MIN, Math.min(CELL_MAX, Math.floor(width / this.art.rows)));
    this.grid.style.width = `${this.cell * this.art.rows}px`;
    this.grid.style.height = `${this.cell * this.art.cols}px`;
    this.queueDraw(true);
  }

  private queueDraw(shape = false): void {
    this.shapeDirty ||= shape;
    if (this.drawQueued) return;
    this.drawQueued = true;
    requestAnimationFrame(() => {
      this.drawQueued = false;
      this.drawGrid();
      if (this.shapeDirty) this.drawShape();
      this.shapeDirty = false;
    });
  }

  private drawGrid(): void {
    const { rows, cols, cells, colors } = this.art;
    const s = this.cell;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(rows * s * dpr);
    const h = Math.round(cols * s * dpr);
    if (this.grid.width !== w || this.grid.height !== h) {
      this.grid.width = w;
      this.grid.height = h;
    }
    const ctx = this.grid.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (let a = 0; a < rows; a++) {
      for (let c = 0; c < cols; c++) {
        ctx.fillStyle = colors[cells[this.index(a, c)]!]!;
        ctx.fillRect(a * s, c * s, s, s);
      }
    }
    // Cell lines, a stronger one every eight cells along and down the middle (where Mirror sides folds).
    if (s >= 6) {
      ctx.fillStyle = 'rgb(0 0 0 / 0.22)';
      for (let a = 1; a < rows; a++) ctx.fillRect(a * s, 0, 1 / dpr, cols * s);
      for (let c = 1; c < cols; c++) ctx.fillRect(0, c * s, rows * s, 1 / dpr);
    }
    ctx.fillStyle = 'rgb(255 255 255 / 0.28)';
    for (let a = 8; a < rows; a += 8) ctx.fillRect(a * s - 0.5, 0, 1, cols * s);
    ctx.fillRect(0, (cols / 2) * s - 0.5, rows * s, 1);

    // The mouse's cell (and its mirrors) in the picked color.
    if (this.hoverAlong >= 0 && !this.dragging) {
      ctx.fillStyle = colors[this.color]!;
      for (const [a, c] of this.targets(this.hoverAlong, this.hoverAcross)) {
        ctx.fillRect(a * s + 1, c * s + 1, s - 2, s - 2);
        box(ctx, a * s, c * s, s, 'rgb(255 255 255 / 0.8)', 1);
      }
    }
    // The keyboard cursor: a white box with a dark keyline; its mirrors dashed.
    if (document.activeElement === this.grid) {
      this.targets(this.along, this.across).forEach(([a, c], i) => {
        if (i > 0) ctx.setLineDash([2, 2]);
        box(ctx, a * s - 1, c * s - 1, s + 2, '#142030', 4);
        box(ctx, a * s - 1, c * s - 1, s + 2, '#f4f8fc', 2);
        ctx.setLineDash([]);
      });
    }
    const name = EDIT_PALETTE[cells[this.index(this.along, this.across)]!]!.name;
    this.status.textContent = `${this.along + 1} of ${rows} along, ${this.across + 1} of ${cols} across: ${name}`;
  }

  /** One ski as it really is: the grid stretched along to its outline. */
  private drawShape(): void {
    const width = this.shapeBox.clientWidth;
    if (width <= 0) return;
    paintSkis(this.shape, this.type, skiGraphic(this.ski, customId(this.ski, this.slot)), false, Math.floor(width / this.type.model.length), false);
  }

  /** The Start from tiles: Blank (the picked color everywhere), then the ski's stock graphics. */
  private buildStarts(): void {
    this.blankSwatches.length = 0;
    const blank = document.createElement('button');
    blank.type = 'button';
    blank.className = 'editor-start-tile';
    const swatch = document.createElement('span');
    swatch.className = 'editor-blank';
    this.blankSwatches.push(swatch);
    blank.append(swatch, text('Blank'));
    blank.title = 'The whole ski in the picked color';
    blank.addEventListener('click', () => this.startFrom(null));
    const tiles = [blank];
    for (const g of this.type.graphics) {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'editor-start-tile';
      tile.setAttribute('aria-label', `Start from ${g.name}`);
      const canvas = document.createElement('canvas');
      canvas.className = 'editor-start-ski';
      paintSkis(canvas, this.type, g, false, 48, false);
      tile.append(canvas, text(g.name));
      tile.addEventListener('click', () => this.startFrom(g));
      tiles.push(tile);
    }
    this.starts.replaceChildren(...tiles);
  }

  /** Marks the picked color, tool and switches. */
  private sync(): void {
    const hex = EDIT_PALETTE[this.color]!.hex;
    this.chips.forEach((chip, i) => chip.setAttribute('aria-pressed', String(i === this.color)));
    this.colorName.textContent = EDIT_PALETTE[this.color]!.name;
    this.colorSwatch.style.background = hex;
    for (const s of this.blankSwatches) s.style.background = hex;
    this.baseSwatch.style.background = EDIT_PALETTE[customBase(this.ski, this.slot)]!.hex;
    for (const [tool, b] of this.toolButtons) b.setAttribute('aria-pressed', String(tool === this.tool));
    this.mirrorEndsButton.setAttribute('aria-pressed', String(this.mirrorEnds));
    this.mirrorSidesButton.setAttribute('aria-pressed', String(this.mirrorSides));
    this.undoButton.disabled = this.undo.length === 0;
  }
}

function label(name: string): HTMLElement {
  const el = document.createElement('span');
  el.className = 'paint-part editor-label';
  el.textContent = name;
  return el;
}

function text(t: string): HTMLElement {
  const el = document.createElement('span');
  el.textContent = t;
  return el;
}

/** A tool's button: its name, and its key as a keycap. */
function toolButton(name: string, key: string, onPick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'editor-tool';
  const n = document.createElement('span');
  n.className = 'editor-tool-name';
  n.textContent = name;
  b.appendChild(n);
  if (key) b.appendChild(keycap(key));
  b.addEventListener('click', onPick);
  return b;
}

function box(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string, width: number): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.strokeRect(x, y, size, size);
}
