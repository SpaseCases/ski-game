import {
  copyStock,
  customFace,
  customId,
  customLinked,
  customSidewall,
  EDIT_PALETTE,
  gearBoard,
  gearType,
  saveCustom,
  setCustomLinked,
  setCustomSidewall,
  type Face,
  type Gear,
} from '../core/customSkis.ts';
import { boardGraphic } from '../core/boards.ts';
import { skiGraphic, type PixelArt, type Side, type SkiGraphic, type SkiId, type SkiModel } from '../core/skis.ts';
import { BINDINGS } from '../render/boardPoses.ts';
import type { Rect } from '../render/lockerStage.ts';
import { keycap } from './keyNames.ts';
import { board, setHints, type Screen } from './menus.ts';
import { paintSkis } from './skiThumb.ts';
import { signText } from './signText.ts';

// The ski editor, opened from a custom slot's Edit in the Locker: one ski's
// top sheet or base (the base seen from above, through the ski, as in the
// rack) laid out long, tail on the left, tip on the right, the left edge on
// top, painted a cell at a time from the editor palette. While "Same on both
// skis" is on, every stroke paints both skis; off, Left or Right picks the
// one painted. Side by side (milestone 23) lays both skis' grids out at
// once, the left ski above the right as in the rack, so the cursor and a
// stroke run from one ski onto the other like a pair graphic. The arrows
// move a cursor and Space or Enter paints (held, it paints as the cursor
// moves); the mouse paints by dragging. Pencil (a square brush 1 to 4 cells
// across) or fill; the mirror switches paint every stroke tip to tail and
// edge to edge too (within each ski). Every stroke is saved at once
// (core/customSkis.ts); the grid and the true-shape strip follow it live,
// and the 3D skis turning beside the tools are rebuilt once it ends (a
// rebuild is tens of milliseconds on a Chromebook, too slow for every frame
// of a drag). Since milestone 23 it paints a board's custom slot too: the
// board's own grid, one board, no Left / Right.

export interface SkiEditorHooks {
  /** Put that slot's graphic on the skier (on skis, or on the board). */
  wear: (gear: Gear, graphic: string) => void;
  /** The slot's cells or base changed: rebuild the 3D skis (or board). */
  repaint: () => void;
  /** The editor opened (true) or closed or was covered (false). */
  shown: (open: boolean) => void;
}

type Tool = 'pencil' | 'fill';
interface Snapshot {
  top: Uint8Array;
  base: Uint8Array;
  sidewall: number;
  linked: boolean;
}
/** A box of cells in the grid's own columns (inclusive): along0, x0, along1, x1. */
type Box = readonly [number, number, number, number];

/** Undo steps kept. */
const UNDO_MAX = 60;
/** Grid cell size in CSS pixels: as big as fits, within these. */
const CELL_MAX = 16;
const CELL_MIN = 4;
/** Side by side starts on when both grids fit with cells this big in the height the rest of the editor leaves (less this margin, px). */
const PAIR_CELL_MIN = 6;
const PAIR_MARGIN = 24;
/** Brush sizes: squares this many cells across. */
const BRUSHES = [1, 2, 3, 4] as const;
/** How far Shift + an arrow jumps. */
const JUMP = 4;
/** The boots stand on about this much of the ski (m), for the ruler. */
const BOOT_LENGTH = 0.32;
/** On a board the bindings stand across it, at ±BINDINGS' x from its middle; each boot is about this wide (m). */
const BOOT_WIDTH = 0.12;
const BINDING_SPAN = 2 * Math.abs(BINDINGS[1][0]) + BOOT_WIDTH;

const BOTH = [0, 1] as const;
const ONE = [[0], [1]] as const;
const LEFT_SKI = [-1] as const;
const RIGHT_SKI = [1] as const;
const PAIR_SKIS = [-1, 1] as const;
const BOARD_SIDE = [1] as const;

/** Arrow keys: cells along, cells across. */
const MOVES: Partial<Record<string, readonly [number, number]>> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

const HINTS = [
  [['←', '→', '↑', '↓'], 'Move'],
  [['Space'], 'Paint'],
  [['[', ']'], 'Color'],
  [['1', '4'], 'Brush size'],
  [['I'], 'Take the color under the cursor'],
  [['B'], 'Top or base'],
  [['V'], 'Side by side'],
  [['Tab'], 'Palette and tools'],
  [['Esc'], 'Done'],
] as const;
const BOARD_HINTS = HINTS.filter(([keys]) => keys[0] !== 'V');

export class SkiEditorScreen implements Screen {
  readonly el: HTMLElement;
  private readonly hooks: SkiEditorHooks;
  private readonly title: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly foot: HTMLElement;
  private readonly skiGroup: HTMLElement;
  private readonly bench: HTMLElement;
  private readonly grid: HTMLCanvasElement;
  private readonly ruler: HTMLElement;
  private readonly boots: HTMLElement;
  private readonly tipLabel: HTMLElement;
  private readonly status: HTMLElement;
  private readonly shape: HTMLCanvasElement;
  private readonly shapeLabel: HTMLElement;
  private readonly shapeBox: HTMLElement;
  private readonly starts: HTMLElement;
  private readonly chips: HTMLButtonElement[] = [];
  private readonly colorName: HTMLElement;
  private readonly colorSwatch: HTMLElement;
  private readonly wallSwatch: HTMLElement;
  private readonly sideButtons: HTMLButtonElement[] = [];
  private readonly linkButton: HTMLButtonElement;
  private readonly pairButton: HTMLButtonElement;
  private readonly faceButtons: HTMLButtonElement[] = [];
  private readonly toolButtons = new Map<Tool, HTMLButtonElement>();
  private readonly mirrorEndsButton: HTMLButtonElement;
  private readonly mirrorSidesButton: HTMLButtonElement;
  private readonly wallsButton: HTMLButtonElement;
  private readonly brushButtons: HTMLButtonElement[] = [];
  private readonly undoButton: HTMLButtonElement;
  private readonly blankSwatches: HTMLElement[] = [];
  private readonly view: HTMLElement;
  private readonly rect: Rect = { x: 0, y: 0, width: 0, height: 0 };

  private gear: Gear = 'park';
  private slot = 0;
  private model: SkiModel = gearType('park').model;
  /** Painting a board (one board, its own grid) rather than a pair of skis. */
  private onBoard = false;
  /** The face being painted, and its grid (a ski slot's is a pair: both skis' columns in each row). */
  private face: Face = 'top';
  private art!: PixelArt;
  /** The ski shown and painted in the single view when the slot isn't linked: 0 left, 1 right. */
  private side = 0;
  /** Both skis' grids at once, the left ski's columns above the right's (never on a board). */
  private pair = false;
  /** Decide side by side from the room there is when the editor next lays out (set on opening). */
  private pickPair = false;
  /** Cursor: `along` from the tail (the ski's rows), `x` the grid's column from its top (in side by side, the right ski's start at `cols`). */
  private along = 0;
  private x = 0;
  /** The mouse's cell, or along < 0 when it's off the grid. */
  private hoverAlong = -1;
  private hoverX = 0;
  private color = 22;
  private tool: Tool = 'pencil';
  private mirrorEnds = false;
  private mirrorSides = false;
  /** The pencil's square, this many cells across. */
  private brush = 1;
  private undo: Snapshot[] = [];
  /** A stroke being painted: by the mouse (its last cell) or by a held Space or Enter. */
  private dragging = false;
  private penDown = false;
  private lastAlong = 0;
  private lastX = 0;
  /** The cells changed since the 3D skis were last rebuilt (they rebuild when a stroke ends). */
  private unbuilt = false;
  private cell = CELL_MAX;
  private drawQueued = false;
  /** The true-shape ski needs painting again on the next draw. */
  private shapeDirty = true;
  /** Side by side: size the grid again once the strip under it is drawn. */
  private refit = false;
  /** Where the ruler's mark starts along the grid, and how long it is, as shares of the grid's length. */
  private mark: readonly [number, number] = [0, 0];
  private shown = false;
  private readonly onResize = (): void => this.layout();
  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === ' ') this.liftPen();
  };

  constructor(hooks: SkiEditorHooks, onDone: () => void) {
    this.hooks = hooks;
    const b = board('Ski editor', 'editor-screen');
    this.el = b.el;
    this.title = b.head.querySelector('.board-title')!;
    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'board-back';
    done.append(document.createTextNode('Done'), keycap('Esc'));
    done.addEventListener('click', onDone);
    b.head.appendChild(done);
    this.sub = b.sub;
    this.sub.hidden = false;
    this.foot = b.foot;

    // Which ski and which face: a row of switches over the bench.
    const switches = document.createElement('div');
    switches.className = 'editor-switches';
    this.skiGroup = document.createElement('div');
    this.skiGroup.className = 'segmented editor-segments';
    this.skiGroup.setAttribute('role', 'group');
    this.skiGroup.setAttribute('aria-label', 'Ski');
    for (const [side, name, key] of [
      [0, 'Left ski', 'L'],
      [1, 'Right ski', 'R'],
    ] as const) {
      const b = segment(name, key, () => this.setSide(side));
      this.skiGroup.appendChild(b);
      this.sideButtons.push(b);
    }
    this.linkButton = segment('Same on both', 'K', () => this.setLinked(!this.linked));
    this.linkButton.classList.add('editor-link');
    this.pairButton = segment('Side by side', 'V', () => this.setPair(!this.pair));
    this.pairButton.classList.add('editor-link');
    this.skiGroup.append(this.linkButton, this.pairButton);
    const faceGroup = document.createElement('div');
    faceGroup.className = 'segmented editor-segments';
    faceGroup.setAttribute('role', 'group');
    faceGroup.setAttribute('aria-label', 'Face');
    for (const face of ['top', 'base'] as const) {
      const b = segment(face === 'top' ? 'Top' : 'Base', '', () => this.setFace(face));
      faceGroup.appendChild(b);
      this.faceButtons.push(b);
    }
    faceGroup.appendChild(keycap('B'));
    switches.append(this.skiGroup, faceGroup);

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
    const ruler = (this.ruler = document.createElement('div'));
    ruler.className = 'editor-ruler';
    const tail = document.createElement('span');
    tail.textContent = 'Tail';
    this.boots = document.createElement('span');
    this.boots.className = 'editor-boots';
    this.boots.textContent = 'Boots';
    this.tipLabel = document.createElement('span');
    this.tipLabel.textContent = 'Tip';
    this.status = document.createElement('span');
    this.status.className = 'editor-status';
    ruler.append(tail, this.status, this.boots, this.tipLabel);
    this.bench.append(this.grid, ruler);

    // The ski as it really is (the grid stretched to its outline), and the graphics to start from.
    const mid = document.createElement('div');
    mid.className = 'editor-mid';
    this.shapeBox = document.createElement('div');
    this.shapeBox.className = 'editor-shape';
    this.shapeLabel = label('On the ski');
    this.shapeBox.append(this.shapeLabel);
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
    clear.title = 'Paint the whole top or base in the picked color';
    this.wallsButton = toolButton('Sidewalls', 'W', () => this.setSidewall());
    this.wallSwatch = document.createElement('span');
    this.wallSwatch.className = 'editor-swatch';
    this.wallsButton.querySelector('.editor-tool-name')!.prepend(this.wallSwatch);
    tools.append(this.mirrorEndsButton, this.mirrorSidesButton, this.undoButton, clear, this.wallsButton);
    // Brush size: a square of 1 to 4 cells, drawn to scale on each button.
    const brushes = document.createElement('div');
    brushes.className = 'editor-brushes';
    brushes.setAttribute('role', 'group');
    brushes.setAttribute('aria-label', 'Brush size');
    brushes.append(label('Brush'));
    for (const size of BRUSHES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'editor-tool editor-brush';
      b.setAttribute('aria-label', `Brush ${size} by ${size}`);
      const dot = document.createElement('span');
      dot.className = 'editor-brush-dot';
      dot.style.setProperty('--size', String(size));
      b.append(dot, keycap(String(size)));
      b.addEventListener('click', () => this.setBrush(size));
      brushes.appendChild(b);
      this.brushButtons.push(b);
    }
    tools.appendChild(brushes);

    const frame = document.createElement('div');
    frame.className = 'locker-frame editor-frame';
    this.view = document.createElement('div');
    this.view.className = 'locker-view';
    this.view.setAttribute('role', 'img');
    this.view.setAttribute('aria-label', 'Your skis, turning slowly');
    frame.appendChild(this.view);

    lower.append(palette, tools, frame);
    b.body.append(switches, this.bench, mid, lower);
    setHints(b.foot, HINTS);
  }

  /** Points the editor at a ski's or board's custom slot (painting it for the first time makes it) and puts it on the skier. */
  open(gear: Gear, slot: number): void {
    this.gear = gear;
    this.slot = slot;
    const type = gearType(gear);
    this.model = type.model;
    this.onBoard = gearBoard(gear) !== null;
    this.face = 'top';
    this.side = 0;
    this.pair = false;
    this.pickPair = !this.onBoard;
    this.art = customFace(gear, slot, 'top');
    this.along = Math.floor(this.rows / 2);
    this.x = Math.floor(this.cols / 2);
    this.hoverAlong = -1;
    this.undo = [];
    this.unbuilt = false;
    const heading = this.onBoard ? 'Board editor' : 'Ski editor';
    this.title.replaceChildren(signText(heading));
    this.el.setAttribute('aria-label', heading);
    this.sub.textContent = this.onBoard
      ? `Custom ${slot + 1} on the ${type.name} board. Paint the top sheet and the base; it saves as you paint.`
      : `Custom ${slot + 1} on the ${type.name} ski. Paint the top sheets and the bases, both skis alike or each its own, one at a time or side by side; it saves as you paint.`;
    this.skiGroup.hidden = this.onBoard;
    this.shapeLabel.textContent = this.onBoard ? 'On the board' : 'On the ski';
    this.tipLabel.textContent = this.onBoard ? 'Nose' : 'Tip';
    this.view.setAttribute('aria-label', this.onBoard ? 'Your board, turning slowly' : 'Your skis, turning slowly');
    this.wallsButton.title = this.onBoard ? 'The board’s edges take the picked color' : 'The sidewalls and ends take the picked color';
    setHints(this.foot, this.onBoard ? BOARD_HINTS : HINTS);
    // The ruler's mark: where the boots stand on a ski, the bindings on a board.
    const m = this.model;
    const span = this.onBoard ? BINDING_SPAN : BOOT_LENGTH;
    const stance = (m.length / 2 - m.mount) / m.length;
    this.boots.textContent = this.onBoard ? 'Bindings' : 'Boots';
    this.mark = [stance - span / 2 / m.length, span / m.length];
    this.buildStarts();
    saveCustom(gear);
    this.hooks.wear(gear, customId(gear, slot));
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
    this.build();
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
    const size = BRUSHES.find((n) => String(n) === key);
    if (size) {
      this.setBrush(size);
      return true;
    }
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
        this.setColor(this.art.cells[this.index(this.along, this.x)]!);
        return true;
      case 'b':
        this.setFace(this.face === 'top' ? 'base' : 'top');
        return true;
      case 'w':
        this.setSidewall();
        return true;
    }
    // One ski or the other, both alike, side by side: not on a board.
    if (this.onBoard) return false;
    switch (key) {
      case 'l':
        this.setSide(0);
        return true;
      case 'r':
        this.setSide(1);
        return true;
      case 'k':
        this.setLinked(!this.linked);
        return true;
      case 'v':
        this.setPair(!this.pair);
        return true;
    }
    return false;
  }

  // ------------------------------------------------------------- painting

  /** The ski's (or board's) cells along and across. */
  private get rows(): number {
    return this.model.rows;
  }

  private get cols(): number {
    return this.model.cols;
  }

  /** The grid's columns: one ski's (or the board's), or both skis' side by side. */
  private get gridCols(): number {
    return this.pair ? this.cols * 2 : this.cols;
  }

  private get linked(): boolean {
    return customLinked(this.gear, this.slot);
  }

  /** The ski (0 left, 1 right) that grid column `x` shows; always 0 on a board. */
  private sideAt(x: number): number {
    if (this.onBoard) return 0;
    return this.pair ? (x >= this.cols ? 1 : 0) : this.side;
  }

  /** The column across its own ski that grid column `x` shows. */
  private colAt(x: number): number {
    return this.pair && x >= this.cols ? x - this.cols : x;
  }

  /** A cell of the face being painted: `c` across the `side` ski (0 on a board). */
  private cellIndex(along: number, side: number, c: number): number {
    return along * this.art.cols + side * this.cols + c;
  }

  /** The cell under grid column `x`. */
  private index(along: number, x: number): number {
    return this.cellIndex(along, this.sideAt(x), this.colAt(x));
  }

  /** The skis a cell painted on `side` lands on: both while linked. */
  private paintSides(side: number): readonly number[] {
    return this.linked ? BOTH : ONE[side]!;
  }

  /** The brush's square at (along, x) in grid columns, cut to the grid. An even brush reaches one more cell right and down. */
  private square(along: number, x: number): Box {
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
  private stamp(along: number, x: number): void {
    const [a0, x0, a1, x1] = this.square(along, x);
    for (let a = a0; a <= a1; a++) for (let xx = x0; xx <= x1; xx++) this.put(a, this.sideAt(xx), this.colAt(xx));
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

  private paintCell(along: number, x: number): void {
    this.stamp(along, x);
    this.changed();
  }

  /** Paints a straight line of cells from the last one painted, so a fast drag leaves no gaps. */
  private paintLine(along: number, x: number): void {
    let a = this.lastAlong;
    let c = this.lastX;
    const da = Math.abs(along - a);
    const dc = Math.abs(x - c);
    const sa = along > a ? 1 : -1;
    const sc = x > c ? 1 : -1;
    let err = da - dc;
    for (;;) {
      this.stamp(a, c);
      if (a === along && c === x) break;
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
    this.lastX = x;
    this.changed();
  }

  /** Fills the patch of one color round (along, x), four ways within its ski, and its mirrors (on both skis while linked). */
  private floodFill(along: number, x: number): void {
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
    this.changed();
  }

  private paintAtCursor(): void {
    this.remember();
    if (this.tool === 'fill') {
      this.floodFill(this.along, this.x);
      this.save();
      return;
    }
    this.penDown = true;
    this.lastAlong = this.along;
    this.lastX = this.x;
    this.paintCell(this.along, this.x);
  }

  private liftPen(): void {
    if (!this.penDown) return;
    this.penDown = false;
    this.save();
  }

  private moveCursor(da: number, dx: number): void {
    this.along = Math.min(this.rows - 1, Math.max(0, this.along + da));
    this.x = Math.min(this.gridCols - 1, Math.max(0, this.x + dx));
    if (this.penDown) this.paintLine(this.along, this.x);
    else this.queueDraw();
  }

  /** The whole face in the picked color: of the skis showing (both while linked or side by side), or the board. */
  private fillAll(): void {
    this.remember();
    const sides = this.onBoard ? ONE[0] : this.pair || this.linked ? BOTH : ONE[this.side]!;
    for (const side of sides) {
      for (let a = 0; a < this.rows; a++) this.art.cells.fill(this.color, this.cellIndex(a, side, 0), this.cellIndex(a, side, this.cols));
    }
    this.changed();
    this.save();
  }

  private startFrom(g: SkiGraphic | null): void {
    if (g) {
      this.remember();
      copyStock(this.gear, this.slot, g);
      this.changed();
      this.save();
      this.sync();
    } else this.fillAll();
  }

  private setSidewall(): void {
    if (customSidewall(this.gear, this.slot) === this.color) return;
    this.remember();
    setCustomSidewall(this.gear, this.slot, this.color);
    this.changed();
    this.save();
    this.sync();
  }

  /** Paints the top sheet (seen from above) or the base (seen from above, through the ski). */
  private setFace(face: Face): void {
    this.liftPen();
    this.endDrag();
    this.face = face;
    this.art = customFace(this.gear, this.slot, face);
    this.sync();
    this.queueDraw(true);
  }

  /** Shows and paints one ski (side by side, moves the cursor onto it): picking one while linked unlinks them. */
  private setSide(side: number): void {
    this.liftPen();
    this.endDrag();
    if (this.pair) this.x = side * this.cols + this.colAt(this.x);
    else this.side = side;
    if (this.linked) this.setLinked(false);
    this.sync();
    this.queueDraw(true);
  }

  /** Both skis' grids at once, or one ski's: the cursor stays on its cell. */
  private setPair(on: boolean): void {
    if (this.onBoard || on === this.pair) return;
    this.liftPen();
    this.endDrag();
    if (on) this.x = this.side * this.cols + this.x;
    else {
      this.side = this.sideAt(this.x);
      this.x = this.colAt(this.x);
    }
    this.pair = on;
    this.hoverAlong = -1;
    this.sync();
    this.layout();
  }

  /** Linking copies the ski being shown (side by side, the cursor's), top and base, onto the other (Undo brings the other back). */
  private setLinked(linked: boolean): void {
    this.liftPen();
    this.endDrag();
    if (linked) {
      this.remember();
      const shown = this.sideAt(this.x);
      const other = 1 - shown;
      for (const face of ['top', 'base'] as const) {
        const { cells, cols } = customFace(this.gear, this.slot, face);
        for (let a = 0; a < this.rows; a++) cells.copyWithin(a * cols + other * this.cols, a * cols + shown * this.cols, a * cols + (shown + 1) * this.cols);
      }
      this.side = shown;
      this.changed();
    }
    setCustomLinked(this.gear, this.slot, linked);
    this.save();
    this.sync();
    this.queueDraw(true);
  }

  /** Keeps the slot as it is now, for Undo (before a stroke or an action). */
  private remember(): void {
    this.undo.push({
      top: customFace(this.gear, this.slot, 'top').cells.slice(),
      base: customFace(this.gear, this.slot, 'base').cells.slice(),
      sidewall: customSidewall(this.gear, this.slot),
      linked: this.linked,
    });
    if (this.undo.length > UNDO_MAX) this.undo.shift();
    this.undoButton.disabled = false;
  }

  private stepBack(): void {
    if (this.penDown || this.dragging) return;
    const last = this.undo.pop();
    if (!last) return;
    customFace(this.gear, this.slot, 'top').cells.set(last.top);
    customFace(this.gear, this.slot, 'base').cells.set(last.base);
    setCustomSidewall(this.gear, this.slot, last.sidewall);
    setCustomLinked(this.gear, this.slot, last.linked);
    this.changed();
    this.save();
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
    this.queueDraw();
  }

  private setBrush(size: number): void {
    this.brush = size;
    this.sync();
    this.queueDraw();
  }

  private toggleMirror(which: 'ends' | 'sides'): void {
    if (which === 'ends') this.mirrorEnds = !this.mirrorEnds;
    else this.mirrorSides = !this.mirrorSides;
    this.sync();
    this.queueDraw();
  }

  /** The cells changed: redraw the grid and the strip (once a frame); the 3D skis wait for the stroke to end. */
  private changed(): void {
    this.queueDraw(true);
    this.unbuilt = true;
  }

  /** A stroke or an action ended: save the slot and rebuild the 3D skis once. */
  private save(): void {
    saveCustom(this.gear);
    this.build();
  }

  /** Rebuilds the 3D skis (or board) if the cells changed since the last time. */
  private build(): void {
    if (!this.unbuilt) return;
    this.unbuilt = false;
    this.hooks.repaint();
  }

  // ---------------------------------------------------------- the mouse

  private listenPointer(): void {
    const g = this.grid;
    g.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      g.focus({ preventScroll: true });
      const [a, x] = this.cellAt(e);
      if (a < 0) return;
      this.along = a;
      this.x = x;
      this.remember();
      if (this.tool === 'fill') {
        this.floodFill(a, x);
        this.save();
        return;
      }
      g.setPointerCapture(e.pointerId);
      this.dragging = true;
      this.lastAlong = a;
      this.lastX = x;
      this.paintCell(a, x);
    });
    g.addEventListener('pointermove', (e) => {
      const [a, x] = this.cellAt(e);
      if (this.dragging) {
        if (a < 0) return;
        this.along = a;
        this.x = x;
        if (a !== this.lastAlong || x !== this.lastX) this.paintLine(a, x);
        return;
      }
      if (a !== this.hoverAlong || x !== this.hoverX) {
        this.hoverAlong = a;
        this.hoverX = x;
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
    this.save();
  }

  /** The grid cell under a pointer (along, grid column), clamped to the grid while dragging; along -1 when off it. */
  private cellAt(e: PointerEvent): [number, number] {
    const r = this.grid.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return [-1, 0];
    const a = Math.floor(((e.clientX - r.left) / r.width) * this.rows);
    const x = Math.floor(((e.clientY - r.top) / r.height) * this.gridCols);
    const inside = a >= 0 && a < this.rows && x >= 0 && x < this.gridCols;
    if (!inside && !this.dragging) return [-1, 0];
    return [Math.min(this.rows - 1, Math.max(0, a)), Math.min(this.gridCols - 1, Math.max(0, x))];
  }

  // -------------------------------------------------------------- drawing

  /** Cells this big fit both skis' grids (side by side) in the bench's width and the height the rest of the editor leaves in the window, so the 3D skis stay in view. */
  private pairCell(width: number, extra = 0): number {
    const sign = this.el.firstElementChild?.getBoundingClientRect().height ?? 0;
    const rest = sign - this.grid.getBoundingClientRect().height + extra;
    return Math.min(CELL_MAX, Math.floor(width / this.rows), Math.floor((window.innerHeight - rest - PAIR_MARGIN) / (2 * this.cols)));
  }

  /** Sizes the grid to the bench and the true-shape ski to its box (on opening and when the window resizes). */
  private layout(): void {
    if (!this.shown) return;
    const width = this.bench.clientWidth;
    // On opening, side by side when both grids fit at a readable size. The
    // strip under the grid is drawn first (a canvas not yet drawn has its
    // default size), and side by side it gains the second ski.
    if (this.pickPair) {
      this.pickPair = false;
      this.drawShape();
      if (this.pairCell(width, this.shape.getBoundingClientRect().height) >= PAIR_CELL_MIN) {
        this.setPair(true);
        return;
      }
    }
    this.sizeGrid(this.pair ? this.pairCell(width) : Math.floor(width / this.rows));
    // Side by side, the strip under the grid draws both skis (taller) on the next frame: fit the grid again then.
    this.refit = this.pair;
    this.queueDraw(true);
  }

  private sizeGrid(cell: number): void {
    this.cell = Math.max(CELL_MIN, Math.min(CELL_MAX, cell));
    this.grid.style.width = `${this.cell * this.rows}px`;
    this.grid.style.height = `${this.cell * this.gridCols}px`;
    // The boots' (or bindings') mark on the ruler, over the cells it marks: the grid sits centered on the bench.
    const gridWidth = this.cell * this.rows;
    const left = (this.ruler.clientWidth - gridWidth) / 2;
    this.boots.style.left = `${Math.round(left + this.mark[0] * gridWidth)}px`;
    this.boots.style.width = `${Math.round(this.mark[1] * gridWidth)}px`;
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
      if (this.refit) {
        this.refit = false;
        const before = this.cell;
        this.sizeGrid(this.pairCell(this.bench.clientWidth));
        if (this.cell !== before) this.queueDraw();
      }
    });
  }

  private drawGrid(): void {
    const { rows, gridCols, cols } = this;
    const { cells, colors } = this.art;
    const s = this.cell;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(rows * s * dpr);
    const h = Math.round(gridCols * s * dpr);
    if (this.grid.width !== w || this.grid.height !== h) {
      this.grid.width = w;
      this.grid.height = h;
    }
    const ctx = this.grid.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (let a = 0; a < rows; a++) {
      for (let x = 0; x < gridCols; x++) {
        ctx.fillStyle = colors[cells[this.index(a, x)]!]!;
        ctx.fillRect(a * s, x * s, s, s);
      }
    }
    // Cell lines, a stronger one every eight cells along and down each ski's middle (where Mirror sides folds).
    if (s >= 6) {
      ctx.fillStyle = 'rgb(0 0 0 / 0.22)';
      for (let a = 1; a < rows; a++) ctx.fillRect(a * s, 0, 1 / dpr, gridCols * s);
      for (let x = 1; x < gridCols; x++) ctx.fillRect(0, x * s, rows * s, 1 / dpr);
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

    // Where the pencil would paint under the mouse (the brush and its mirrors) in the picked color; for a fill, its starting cells.
    if (this.hoverAlong >= 0 && !this.dragging) {
      ctx.fillStyle = colors[this.color]!;
      for (const [a0, x0, a1, x1] of this.marks(this.hoverAlong, this.hoverX)) {
        const [w, h] = [(a1 - a0 + 1) * s, (x1 - x0 + 1) * s];
        ctx.fillRect(a0 * s + 1, x0 * s + 1, w - 2, h - 2);
        box(ctx, a0 * s, x0 * s, w, h, 'rgb(255 255 255 / 0.8)', 1);
      }
    }
    // The keyboard cursor round the brush: a white box with a dark keyline; its mirrors (and its copy on the other ski) dashed.
    if (document.activeElement === this.grid) {
      this.marks(this.along, this.x).forEach(([a0, x0, a1, x1], i) => {
        const [bx, by, bw, bh] = [a0 * s - 1, x0 * s - 1, (a1 - a0 + 1) * s + 2, (x1 - x0 + 1) * s + 2];
        if (i > 0) ctx.setLineDash([2, 2]);
        box(ctx, bx, by, bw, bh, '#142030', 4);
        box(ctx, bx, by, bw, bh, '#f4f8fc', 2);
        ctx.setLineDash([]);
      });
    }
    const name = EDIT_PALETTE[cells[this.index(this.along, this.x)]!]!.name;
    const where = `${this.place(this.sideAt(this.x))}, ${this.face}`;
    this.status.textContent = `${where}: ${this.along + 1} of ${rows} along, ${this.colAt(this.x) + 1} of ${cols} across, ${name}`;
  }

  /** What's painted at the cursor: the board, both skis, or one of them. */
  private place(side: number): string {
    if (this.onBoard) return 'Board';
    return this.linked ? 'Both skis' : side === 0 ? 'Left ski' : 'Right ski';
  }

  /**
   * What the tool would paint at (along, x), as boxes in grid columns: the
   * pencil's brush (or a fill's starting cell) first, then its mirrors within
   * each ski and, side by side while linked, its copy on the other ski.
   */
  private marks(along: number, x: number): Box[] {
    const main: Box = this.tool === 'pencil' ? this.square(along, x) : [along, x, along, x];
    const out: Box[] = [main];
    const { rows, cols } = this;
    const [a0, x0, a1, x1] = main;
    const fa: readonly [number, number] = [rows - 1 - a1, rows - 1 - a0];
    // The box's part on each ski it covers (one ski's grid shows as side 0), then each mirror (and copy) of that part.
    for (const side of this.pair ? BOTH : ONE[0]) {
      const lo = Math.max(x0, this.pair ? side * cols : 0);
      const hi = Math.min(x1, this.pair ? side * cols + cols - 1 : cols - 1);
      if (lo > hi) continue;
      const [c0, c1] = [this.colAt(lo), this.colAt(hi)];
      const onto = this.pair && this.linked ? BOTH : ONE[this.pair ? side : 0]!;
      for (const s of onto) {
        const at = this.pair ? s * cols : 0;
        if (s !== side) out.push([a0, at + c0, a1, at + c1]);
        if (this.mirrorEnds) out.push([fa[0], at + c0, fa[1], at + c1]);
        if (this.mirrorSides) out.push([a0, at + cols - 1 - c1, a1, at + cols - 1 - c0]);
        if (this.mirrorEnds && this.mirrorSides) out.push([fa[0], at + cols - 1 - c1, fa[1], at + cols - 1 - c0]);
      }
    }
    return out;
  }

  /** The skis (or board) as they really are (the grid stretched along to the outline), top or base: the one shown, or both side by side. */
  private drawShape(): void {
    const width = this.shapeBox.clientWidth;
    if (width <= 0) return;
    const id = customId(this.gear, this.slot);
    const board = gearBoard(this.gear);
    const type = gearType(this.gear);
    const pxPerM = Math.floor(width / type.model.length);
    if (board) paintSkis(this.shape, type, boardGraphic(board, id), this.face === 'base', pxPerM, BOARD_SIDE, maxHalf(type.model));
    else paintSkis(this.shape, type, skiGraphic(this.gear as SkiId, id), this.face === 'base', pxPerM, this.pair ? PAIR_SKIS : this.side === 0 ? LEFT_SKI : RIGHT_SKI);
  }

  /** The Start from tiles: Blank (the picked color everywhere), then the ski's (or board's) stock graphics. */
  private buildStarts(): void {
    this.blankSwatches.length = 0;
    const blank = document.createElement('button');
    blank.type = 'button';
    blank.className = 'editor-start-tile';
    const swatch = document.createElement('span');
    swatch.className = 'editor-blank';
    this.blankSwatches.push(swatch);
    blank.append(swatch, text('Blank'));
    blank.title = 'The whole top or base in the picked color';
    blank.addEventListener('click', () => this.startFrom(null));
    const tiles = [blank];
    const type = gearType(this.gear);
    const sides: readonly Side[] = this.onBoard ? BOARD_SIDE : PAIR_SKIS;
    for (const g of type.graphics) {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'editor-start-tile';
      tile.setAttribute('aria-label', `Start from ${g.name}`);
      const canvas = document.createElement('canvas');
      canvas.className = 'editor-start-ski';
      if (this.onBoard) paintSkis(canvas, type, g, false, 48, sides, maxHalf(type.model));
      else paintSkis(canvas, type, g, false, 48);
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
    this.wallSwatch.style.background = EDIT_PALETTE[customSidewall(this.gear, this.slot)]!.hex;
    const linked = this.linked;
    const side = this.sideAt(this.x);
    this.sideButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(!linked && i === side)));
    this.linkButton.setAttribute('aria-pressed', String(linked));
    this.pairButton.setAttribute('aria-pressed', String(this.pair));
    this.faceButtons.forEach((b, i) => b.setAttribute('aria-pressed', String((i === 1) === (this.face === 'base'))));
    this.bench.classList.toggle('is-base', this.face === 'base');
    const m = this.model;
    const what = this.onBoard ? 'The board' : this.pair ? 'Both skis side by side, the left ski on top' : linked ? 'Both skis' : side === 0 ? 'Left ski' : 'Right ski';
    const across = this.pair ? `${m.cols} across each` : `${m.cols} across`;
    this.grid.setAttribute('aria-label', `${what}, ${this.face === 'base' ? 'base' : 'top sheet'}: ${m.rows} cells long and ${across}. Arrows move, Space paints.`);
    for (const [tool, b] of this.toolButtons) b.setAttribute('aria-pressed', String(tool === this.tool));
    this.mirrorEndsButton.setAttribute('aria-pressed', String(this.mirrorEnds));
    this.mirrorSidesButton.setAttribute('aria-pressed', String(this.mirrorSides));
    this.brushButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(BRUSHES[i] === this.brush)));
    this.undoButton.disabled = this.undo.length === 0;
  }
}

/** The model's widest half width (m): a board's strip and tiles are drawn as tall as the board. */
function maxHalf(m: SkiModel): number {
  return Math.max(...m.width.map(([, hw]) => hw));
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

/** A switch in a segmented row, with its key as a keycap (if any). */
function segment(name: string, key: string, onPick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'segment';
  b.append(text(name));
  if (key) b.appendChild(keycap(key));
  b.addEventListener('click', onPick);
  return b;
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

function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, width: number): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.strokeRect(x, y, w, h);
}
