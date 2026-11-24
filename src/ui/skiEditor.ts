import {
  colorName,
  copyStock,
  customColor,
  customFace,
  customId,
  customLinked,
  customPalette,
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
import { skiGraphic, type Side, type SkiGraphic, type SkiId, type SkiModel } from '../core/skis.ts';
import { BINDINGS } from '../render/boardPoses.ts';
import type { Rect, StageWindow } from '../render/lockerStage.ts';
import { keycap } from './keyNames.ts';
import { PaintGrid } from './paintGrid.ts';
import { previewCanvas } from './lockerMenu.ts';
import { HexColors } from './hexColors.ts';
import { board, EDITOR_PAD_HINTS, EDITOR_PAD_KEYS, setHints, type Screen } from './menus.ts';
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
  /** Share this slot on the marketplace (milestone 24). */
  share: (gear: Gear, slot: number) => void;
}

type Tool = 'pencil' | 'fill';
interface Snapshot {
  top: Uint8Array;
  base: Uint8Array;
  sidewall: number;
  linked: boolean;
}
/** Undo steps kept. */
const UNDO_MAX = 60;
/** Grid cell size in CSS pixels: as big as fits, within these. */
const CELL_MAX = 16;
const CELL_MIN = 4;
/** Side by side starts on when both grids fit with cells this big in the height the rest of the editor leaves in the window. */
const PAIR_CELL_MIN = 6;
/** The menu's padding above and below the sign (style.css .menu), px. */
const MENU_PAD = 74;
/** Brush sizes: squares this many cells across. */
const BRUSHES = [1, 2, 3, 4] as const;
/** How far Shift + an arrow jumps. */
const JUMP = 4;
/** The boots stand on about this much of the ski (m), for the ruler. */
const BOOT_LENGTH = 0.32;
/** On a board the bindings stand across it, at ±BINDINGS' x from its middle; each boot is about this wide (m). */
const BOOT_WIDTH = 0.12;
const BINDING_SPAN = 2 * Math.abs(BINDINGS[1][0]) + BOOT_WIDTH;

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

export class SkiEditorScreen implements Screen, StageWindow {
  readonly el: HTMLElement;
  /** The pad (milestone 26): X undoes, Y takes the color under the cursor, LB / RB the color before or after. */
  readonly padKeys = EDITOR_PAD_KEYS;
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
  /** A hex code typed or picked, and the slot's own colors (ui/hexColors.ts). */
  private readonly hex: HexColors;
  private readonly view: HTMLElement;
  /** Everything but the 3D window: the part that scrolls (style.css .editor-main). */
  private readonly main: HTMLElement;
  private readonly rect: Rect = { x: 0, y: 0, width: 0, height: 0 };
  /** The preview's own canvas in the window (render/lockerStage.ts present copies it in). */
  private readonly preview: CanvasRenderingContext2D | null;

  private gear: Gear = 'park';
  private slot = 0;
  private model: SkiModel = gearType('park').model;
  /** The face being painted. */
  private face: Face = 'top';
  /**
   * The grid's cells, view and brush (ui/paintGrid.ts, left unobfuscated: it
   * runs on every pointer move and frame of a stroke): the face's art, a
   * board or skis, side by side, the ski shown, linked, the picked color,
   * the brush and the mirror switches.
   */
  private readonly g = new PaintGrid();
  /** Decide side by side from the room there is when the editor next lays out (set on opening). */
  private pickPair = false;
  /** Cursor: `along` from the tail (the ski's rows), `x` the grid's column from its top (in side by side, the right ski's start at `cols`). */
  private along = 0;
  private x = 0;
  /** The mouse's cell, or along < 0 when it's off the grid. */
  private hoverAlong = -1;
  private hoverX = 0;
  private tool: Tool = 'pencil';
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
    this.g.color = 22;
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
    this.pairButton = segment('Side by side', 'V', () => this.setPair(!this.g.pair));
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
    this.hex = new HexColors({
      palette: () => customPalette(this.gear, this.slot),
      add: (hex) => customColor(this.gear, this.slot, hex, (i) => this.undo.some((u) => u.sidewall === i || u.top.includes(i) || u.base.includes(i))),
      pick: (i) => this.setColor(i),
    });
    palette.append(paletteHead, chipGrid, this.hex.own, this.hex.el, this.hex.note);

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
    const share = toolButton('Share', '', () => this.hooks.share(this.gear, this.slot));
    share.title = 'Share this graphic on the marketplace';
    tools.append(this.mirrorEndsButton, this.mirrorSidesButton, this.undoButton, clear, this.wallsButton, share);
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
    this.preview = previewCanvas(this.view);
    frame.appendChild(this.view);

    lower.append(palette, tools);
    // The 3D window beside the rest (above it on a narrow screen), never moving: only the rest scrolls.
    this.main = document.createElement('div');
    this.main.className = 'editor-main';
    this.main.append(switches, this.bench, mid, lower);
    const layout = document.createElement('div');
    layout.className = 'editor-layout';
    layout.append(this.main, frame);
    b.body.append(layout);
    setHints(b.foot, HINTS, EDITOR_PAD_HINTS);
  }

  /** Points the editor at a ski's or board's custom slot (painting it for the first time makes it) and puts it on the skier. */
  open(gear: Gear, slot: number): void {
    this.gear = gear;
    this.slot = slot;
    const type = gearType(gear);
    this.model = type.model;
    this.g.rows = type.model.rows;
    this.g.cols = type.model.cols;
    this.g.onBoard = gearBoard(gear) !== null;
    this.face = 'top';
    this.g.side = 0;
    this.g.pair = false;
    this.pickPair = !this.g.onBoard;
    this.g.art = customFace(gear, slot, 'top');
    // A color of the last slot's own that this one doesn't have: back to the first color new slots get for their bases.
    if (this.g.color >= customPalette(gear, slot).length) this.g.color = 22;
    this.hex.reset();
    this.along = Math.floor(this.rows / 2);
    this.x = Math.floor(this.cols / 2);
    this.hoverAlong = -1;
    this.undo = [];
    this.unbuilt = false;
    const heading = this.g.onBoard ? 'Board editor' : 'Ski editor';
    this.title.replaceChildren(signText(heading));
    this.el.setAttribute('aria-label', heading);
    this.sub.textContent = this.g.onBoard
      ? `Custom ${slot + 1} on the ${type.name} board. Paint the top sheet and the base; it saves as you paint.`
      : `Custom ${slot + 1} on the ${type.name} ski. Paint the top sheets and the bases, both skis alike or each its own, one at a time or side by side; it saves as you paint.`;
    this.skiGroup.hidden = this.g.onBoard;
    this.shapeLabel.textContent = this.g.onBoard ? 'On the board' : 'On the ski';
    this.tipLabel.textContent = this.g.onBoard ? 'Nose' : 'Tip';
    this.view.setAttribute('aria-label', this.g.onBoard ? 'Your board, turning slowly' : 'Your skis, turning slowly');
    this.wallsButton.title = this.g.onBoard ? 'The board’s edges take the picked color' : 'The sidewalls and ends take the picked color';
    setHints(this.foot, this.g.onBoard ? BOARD_HINTS : HINTS, EDITOR_PAD_HINTS);
    // The ruler's mark: where the boots stand on a ski, the bindings on a board.
    const m = this.model;
    const span = this.g.onBoard ? BINDING_SPAN : BOOT_LENGTH;
    const stance = (m.length / 2 - m.mount) / m.length;
    this.boots.textContent = this.g.onBoard ? 'Bindings' : 'Boots';
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

  viewContext(): CanvasRenderingContext2D | null {
    return this.preview;
  }

  onKey(e: KeyboardEvent): boolean {
    // Typing a hex code: the keys are the box's (Esc goes back to the grid).
    if (this.hex.owns(e.target)) {
      if (e.key !== 'Escape') return false;
      this.grid.focus();
      return true;
    }
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
        this.stepColor(key === ']' ? 1 : -1);
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
        this.setColor(this.g.art.cells[this.g.index(this.along, this.x)]!);
        return true;
      case 'b':
        this.setFace(this.face === 'top' ? 'base' : 'top');
        return true;
      case 'w':
        this.setSidewall();
        return true;
    }
    // One ski or the other, both alike, side by side: not on a board.
    if (this.g.onBoard) return false;
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
        this.setPair(!this.g.pair);
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
    return this.g.gridCols;
  }

  private get linked(): boolean {
    return customLinked(this.gear, this.slot);
  }

  private paintCell(along: number, x: number): void {
    this.g.stamp(along, x);
    this.changed();
  }

  /** Paints a straight line of cells from the last one painted, so a fast drag leaves no gaps. */
  private paintLine(along: number, x: number): void {
    this.g.line(this.lastAlong, this.lastX, along, x);
    this.lastAlong = along;
    this.lastX = x;
    this.changed();
  }

  /** Fills the patch of one color round (along, x), four ways within its ski, and its mirrors (on both skis while linked). */
  private floodFill(along: number, x: number): void {
    this.g.floodFill(along, x);
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
    this.g.fillAll();
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
    if (customSidewall(this.gear, this.slot) === this.g.color) return;
    this.remember();
    setCustomSidewall(this.gear, this.slot, this.g.color);
    this.changed();
    this.save();
    this.sync();
  }

  /** Paints the top sheet (seen from above) or the base (seen from above, through the ski). */
  private setFace(face: Face): void {
    this.liftPen();
    this.endDrag();
    this.face = face;
    this.g.art = customFace(this.gear, this.slot, face);
    this.sync();
    this.queueDraw(true);
  }

  /** Shows and paints one ski (side by side, moves the cursor onto it): picking one while linked unlinks them. */
  private setSide(side: number): void {
    this.liftPen();
    this.endDrag();
    if (this.g.pair) this.x = side * this.cols + this.g.colAt(this.x);
    else this.g.side = side;
    if (this.linked) this.setLinked(false);
    this.sync();
    this.queueDraw(true);
  }

  /** Both skis' grids at once, or one ski's: the cursor stays on its cell. */
  private setPair(on: boolean): void {
    if (this.g.onBoard || on === this.g.pair) return;
    this.liftPen();
    this.endDrag();
    if (on) this.x = this.g.side * this.cols + this.x;
    else {
      this.g.side = this.g.sideAt(this.x);
      this.x = this.g.colAt(this.x);
    }
    this.g.pair = on;
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
      const shown = this.g.sideAt(this.x);
      const other = 1 - shown;
      for (const face of ['top', 'base'] as const) {
        const { cells, cols } = customFace(this.gear, this.slot, face);
        for (let a = 0; a < this.rows; a++) cells.copyWithin(a * cols + other * this.cols, a * cols + shown * this.cols, a * cols + (shown + 1) * this.cols);
      }
      this.g.side = shown;
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
    this.g.color = i;
    this.sync();
    this.queueDraw();
  }

  /** [ and ]: the color before or after, round the palette and the slot's own colors. */
  private stepColor(by: number): void {
    const n = customPalette(this.gear, this.slot).length;
    this.setColor((this.g.color + by + n) % n);
  }

  private setTool(tool: Tool): void {
    this.tool = tool;
    this.sync();
    this.queueDraw();
  }

  private setBrush(size: number): void {
    this.g.brush = size;
    this.sync();
    this.queueDraw();
  }

  private toggleMirror(which: 'ends' | 'sides'): void {
    if (which === 'ends') this.g.mirrorEnds = !this.g.mirrorEnds;
    else this.g.mirrorSides = !this.g.mirrorSides;
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

  /**
   * Cells this big fit both skis' grids (side by side) in the bench's width
   * and in the height the rest of the editor leaves in the window: the sign
   * outside its scrolling part (the head, the hints, on a narrow screen the
   * 3D window) and the rest of that part (the switches, the ruler, the strip
   * and the tools), so the whole grid shows without scrolling. `extra` is
   * what the strip under the grid gains side by side.
   */
  private pairCell(width: number, extra = 0): number {
    const sign = this.el.firstElementChild?.getBoundingClientRect().height ?? 0;
    const outside = sign - this.main.clientHeight;
    const others = this.main.scrollHeight - this.grid.getBoundingClientRect().height + extra;
    return Math.min(CELL_MAX, Math.floor(width / this.rows), Math.floor((window.innerHeight - MENU_PAD - outside - others) / (2 * this.cols)));
  }

  /** Sizes the grid to the bench and the true-shape ski to its box (on opening and when the window resizes). */
  private layout(): void {
    if (!this.shown) return;
    const width = contentWidth(this.bench);
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
    this.sizeGrid(this.g.pair ? this.pairCell(width) : Math.floor(width / this.rows));
    // Side by side, the strip under the grid draws both skis (taller) on the next frame: fit the grid again then.
    this.refit = this.g.pair;
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
        this.sizeGrid(this.pairCell(contentWidth(this.bench)));
        if (this.cell !== before) this.queueDraw();
      }
    });
  }

  private drawGrid(): void {
    const { rows, gridCols, cols } = this;
    const { cells } = this.g.art;
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
    // The cells and lines, then where the tool would paint under the mouse and the keyboard cursor's box.
    const hover = this.dragging ? -1 : this.hoverAlong;
    this.g.draw(ctx, s, dpr, this.tool === 'pencil', hover, this.hoverX, document.activeElement === this.grid, this.along, this.x);
    const name = colorName(this.g.art.colors, cells[this.g.index(this.along, this.x)]!);
    const where = `${this.place(this.g.sideAt(this.x))}, ${this.face}`;
    this.status.textContent = `${where}: ${this.along + 1} of ${rows} along, ${this.g.colAt(this.x) + 1} of ${cols} across, ${name}`;
  }

  /** What's painted at the cursor: the board, both skis, or one of them. */
  private place(side: number): string {
    if (this.g.onBoard) return 'Board';
    return this.linked ? 'Both skis' : side === 0 ? 'Left ski' : 'Right ski';
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
    else paintSkis(this.shape, type, skiGraphic(this.gear as SkiId, id), this.face === 'base', pxPerM, this.g.pair ? PAIR_SKIS : this.g.side === 0 ? LEFT_SKI : RIGHT_SKI);
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
    const sides: readonly Side[] = this.g.onBoard ? BOARD_SIDE : PAIR_SKIS;
    for (const g of type.graphics) {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'editor-start-tile';
      tile.setAttribute('aria-label', `Start from ${g.name}`);
      const canvas = document.createElement('canvas');
      canvas.className = 'editor-start-ski';
      if (this.g.onBoard) paintSkis(canvas, type, g, false, 48, sides, maxHalf(type.model));
      else paintSkis(canvas, type, g, false, 48);
      tile.append(canvas, text(g.name));
      tile.addEventListener('click', () => this.startFrom(g));
      tiles.push(tile);
    }
    this.starts.replaceChildren(...tiles);
  }

  /** Marks the picked color, tool and switches. */
  private sync(): void {
    this.g.linked = this.linked;
    const palette = customPalette(this.gear, this.slot);
    const hex = palette[this.g.color]!;
    this.chips.forEach((chip, i) => chip.setAttribute('aria-pressed', String(i === this.g.color)));
    this.hex.sync(this.g.color);
    this.colorName.textContent = colorName(palette, this.g.color);
    this.colorSwatch.style.background = hex;
    for (const s of this.blankSwatches) s.style.background = hex;
    this.wallSwatch.style.background = palette[customSidewall(this.gear, this.slot)]!;
    const linked = this.linked;
    const side = this.g.sideAt(this.x);
    this.sideButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(!linked && i === side)));
    this.linkButton.setAttribute('aria-pressed', String(linked));
    this.pairButton.setAttribute('aria-pressed', String(this.g.pair));
    this.faceButtons.forEach((b, i) => b.setAttribute('aria-pressed', String((i === 1) === (this.face === 'base'))));
    this.bench.classList.toggle('is-base', this.face === 'base');
    const m = this.model;
    const what = this.g.onBoard ? 'The board' : this.g.pair ? 'Both skis side by side, the left ski on top' : linked ? 'Both skis' : side === 0 ? 'Left ski' : 'Right ski';
    const across = this.g.pair ? `${m.cols} across each` : `${m.cols} across`;
    this.grid.setAttribute('aria-label', `${what}, ${this.face === 'base' ? 'base' : 'top sheet'}: ${m.rows} cells long and ${across}. Arrows move, Space paints.`);
    for (const [tool, b] of this.toolButtons) b.setAttribute('aria-pressed', String(tool === this.tool));
    this.mirrorEndsButton.setAttribute('aria-pressed', String(this.g.mirrorEnds));
    this.mirrorSidesButton.setAttribute('aria-pressed', String(this.g.mirrorSides));
    this.brushButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(BRUSHES[i] === this.g.brush)));
    this.undoButton.disabled = this.undo.length === 0;
  }
}

/** An element's width inside its padding (the grid's bench: sized to its clientWidth, the grid overran the padding by 24 px). */
export function contentWidth(el: HTMLElement): number {
  const style = getComputedStyle(el);
  return el.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
}

/** The model's widest half width (m): a board's strip and tiles are drawn as tall as the board. */
function maxHalf(m: SkiModel): number {
  return Math.max(...m.width.map(([, hw]) => hw));
}

export function label(name: string): HTMLElement {
  const el = document.createElement('span');
  el.className = 'paint-part editor-label';
  el.textContent = name;
  return el;
}

export function text(t: string): HTMLElement {
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
export function toolButton(name: string, key: string, onPick: () => void): HTMLButtonElement {
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
