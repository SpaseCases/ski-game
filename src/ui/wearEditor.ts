import { EDIT_PALETTE } from '../core/customSkis.ts';
import { fillStock, openWear, saveCustomWear } from '../core/customWear.ts';
import { GARMENTS, PATTERNS, type Outfit, type StockPattern } from '../core/outfit.ts';
import type { Rect, StageWindow } from '../render/lockerStage.ts';
import { BODY_PANEL, layoutSize, wearOffsets, wearPanels, type WearGarment } from '../render/wearPanels.ts';
import { keycap } from './keyNames.ts';
import { patternSwatch, previewCanvas } from './lockerMenu.ts';
import { board, setHints, type Screen } from './menus.ts';
import { signText } from './signText.ts';
import { contentWidth, label, text, toolButton } from './skiEditor.ts';
import { WearGrid } from './wearGrid.ts';

// The garment editor (milestone 23 part 2), opened from a jacket's or the
// pants' custom slot in the Locker: every square of the garment's low-poly
// body laid out flat as if seen from the front (render/wearPanels.ts): the
// jacket's right sleeve, its body all the way round (the front in the
// middle) and its left sleeve; the pants' seat over the right leg and the
// left. Painted a square at a time from the editor palette, like the ski
// editor (whose look and keys it shares): the arrows move a cursor and
// Space or Enter paints (held, it paints as the cursor moves), the mouse
// paints by dragging; pencil (a square brush 1 to 4 squares across) or fill
// (round each piece, which is a tube); the mirror (off at first, the user's
// pick) paints the other side too. Start from: Blank, or a stock pattern in
// the garment's two colors. Every stroke saves (core/customWear.ts); the
// grid follows it live and the 3D skier turning beside the tools is rebuilt
// once it ends.

export interface WearEditorHooks {
  get: () => Outfit;
  /** Put that slot on the skier (the garment's pattern custom-<n>). */
  wear: (garment: WearGarment, slot: number) => void;
  /** The slot's squares changed: rebuild the garment on the skier. */
  repaint: (garment: WearGarment) => void;
  /** The editor opened (true) or closed or was covered (false). */
  shown: (open: boolean) => void;
}

type Tool = 'pencil' | 'fill';
const UNDO_MAX = 60;
/** Grid cell size in CSS pixels: as big as fits, within these. */
const CELL_MAX = 20;
const CELL_MIN = 6;
const BRUSHES = [1, 2, 3, 4] as const;
const JUMP = 4;
const MOVES: Partial<Record<string, readonly [number, number]>> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** The pieces' names, in render/wearPanels.ts's order, and the marks under the body (or the seat) round from the back. */
const PANEL_NAMES: Record<WearGarment, readonly string[]> = {
  jacket: ['Right sleeve', 'Body', 'Left sleeve'],
  pants: ['Seat', 'Right leg', 'Left leg'],
};
const ROUND = ['Back', 'Right', 'Front', 'Left', 'Back'] as const;

const HINTS = [
  [['←', '→', '↑', '↓'], 'Move'],
  [['Space'], 'Paint'],
  [['[', ']'], 'Color'],
  [['1', '4'], 'Brush size'],
  [['I'], 'Take the color under the cursor'],
  [['M'], 'Mirror'],
  [['Tab'], 'Palette and tools'],
  [['Esc'], 'Done'],
] as const;

export class WearEditorScreen implements Screen, StageWindow {
  readonly el: HTMLElement;
  private readonly hooks: WearEditorHooks;
  private readonly title: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly bench: HTMLElement;
  private readonly grid: HTMLCanvasElement;
  private readonly status: HTMLElement;
  private readonly starts: HTMLElement;
  private readonly startSwatches: { el: HTMLElement; pattern: StockPattern | null }[] = [];
  private readonly chips: HTMLButtonElement[] = [];
  private readonly colorName: HTMLElement;
  private readonly colorSwatch: HTMLElement;
  private readonly toolButtons = new Map<Tool, HTMLButtonElement>();
  private readonly mirrorButton: HTMLButtonElement;
  private readonly brushButtons: HTMLButtonElement[] = [];
  private readonly undoButton: HTMLButtonElement;
  private readonly view: HTMLElement;
  private readonly rect: Rect = { x: 0, y: 0, width: 0, height: 0 };
  private readonly preview: CanvasRenderingContext2D | null;

  private garment: WearGarment = 'jacket';
  private slot = 0;
  /** The squares' numbers (ui/wearGrid.ts, left unobfuscated: it runs every frame of a stroke). */
  private readonly g = new WearGrid();
  /** Cursor and mouse, in layout cells (hoverX < 0: the mouse is off the grid). */
  private x = 0;
  private y = 0;
  private hoverX = -1;
  private hoverY = 0;
  private tool: Tool = 'pencil';
  private undo: Uint8Array<ArrayBufferLike>[] = [];
  private dragging = false;
  private penDown = false;
  private lastX = 0;
  private lastY = 0;
  private unbuilt = false;
  private cell = CELL_MAX;
  private drawQueued = false;
  private shown = false;
  private readonly onResize = (): void => this.layout();
  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === ' ') this.liftPen();
  };

  constructor(hooks: WearEditorHooks, onDone: () => void) {
    this.hooks = hooks;
    this.g.colors = EDIT_PALETTE.map((c) => c.hex);
    this.g.color = 22;
    const b = board('Jacket editor', 'editor-screen');
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

    // The bench: the pieces, and a status line under them.
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
    this.status = document.createElement('span');
    this.status.className = 'editor-status';
    ruler.append(this.status);
    this.bench.append(this.grid, ruler);

    // Start from: Blank (the picked color), or a stock pattern in the garment's colors.
    const startBox = document.createElement('div');
    startBox.className = 'editor-start';
    startBox.append(label('Start from'));
    this.starts = document.createElement('div');
    this.starts.className = 'editor-starts';
    this.starts.setAttribute('role', 'group');
    this.starts.setAttribute('aria-label', 'Start from');
    for (const pattern of [null, ...PATTERNS.map((p) => p.id)]) {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'editor-start-tile wear-start-tile';
      const swatch = document.createElement('span');
      swatch.className = pattern ? 'pattern-swatch' : 'editor-blank';
      const name = pattern ? PATTERNS.find((p) => p.id === pattern)!.name : 'Blank';
      tile.append(swatch, text(name));
      tile.title = pattern ? `${name} in the garment’s two colors` : 'Every square in the picked color';
      tile.addEventListener('click', () => this.startFrom(pattern));
      this.starts.appendChild(tile);
      this.startSwatches.push({ el: swatch, pattern });
    }
    startBox.appendChild(this.starts);
    const mid = document.createElement('div');
    mid.className = 'editor-mid wear-mid';
    mid.append(startBox);

    // Palette and tools.
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
    this.mirrorButton = toolButton('Mirror', 'M', () => this.toggleMirror());
    this.mirrorButton.title = 'Paint the other side too: across the front, and from one sleeve or leg onto the other';
    this.undoButton = toolButton('Undo', 'Z', () => this.stepBack());
    const clear = toolButton('Clear', '', () => this.fillAll());
    clear.title = 'Paint every square in the picked color';
    tools.append(this.mirrorButton, this.undoButton, clear);
    const brushes = document.createElement('div');
    brushes.className = 'editor-brushes';
    brushes.setAttribute('role', 'group');
    brushes.setAttribute('aria-label', 'Brush size');
    brushes.append(label('Brush'));
    for (const size of BRUSHES) {
      const bb = document.createElement('button');
      bb.type = 'button';
      bb.className = 'editor-tool editor-brush';
      bb.setAttribute('aria-label', `Brush ${size} by ${size}`);
      const dot = document.createElement('span');
      dot.className = 'editor-brush-dot';
      dot.style.setProperty('--size', String(size));
      bb.append(dot, keycap(String(size)));
      bb.addEventListener('click', () => this.setBrush(size));
      brushes.appendChild(bb);
      this.brushButtons.push(bb);
    }
    tools.appendChild(brushes);
    lower.append(palette, tools);

    // The 3D window: beside everything else (above it on a narrow screen), and never moving: only the rest scrolls.
    const frame = document.createElement('div');
    frame.className = 'locker-frame editor-frame';
    this.view = document.createElement('div');
    this.view.className = 'locker-view';
    this.view.setAttribute('role', 'img');
    this.view.setAttribute('aria-label', 'Your skier, turning slowly');
    this.preview = previewCanvas(this.view);
    frame.appendChild(this.view);

    const main = document.createElement('div');
    main.className = 'editor-main';
    main.append(this.bench, mid, lower);
    const layout = document.createElement('div');
    layout.className = 'editor-layout';
    layout.append(main, frame);
    b.body.appendChild(layout);
    setHints(b.foot, HINTS);
  }

  /** Points the editor at a garment's custom slot (painting it for the first time makes it, from what the garment wears now) and puts it on the skier. */
  open(garment: WearGarment, slot: number): void {
    this.garment = garment;
    this.slot = slot;
    const panels = wearPanels(garment);
    this.g.panels = panels;
    this.g.offsets = wearOffsets(garment);
    this.g.cells = openWear(garment, slot, this.hooks.get());
    const size = layoutSize(garment);
    this.g.width = size.width;
    this.g.height = size.height;
    this.g.mirror = false;
    // The cursor on the front of the body (or the seat).
    const main = panels[garment === 'jacket' ? BODY_PANEL : 0]!;
    this.x = main.x + main.cols / 2;
    this.y = main.y;
    this.hoverX = -1;
    this.undo = [];
    this.unbuilt = false;
    const name = garment === 'jacket' ? 'Jacket' : 'Pants';
    const heading = `${name} editor`;
    this.title.replaceChildren(signText(heading));
    this.el.setAttribute('aria-label', heading);
    this.sub.textContent =
      garment === 'jacket'
        ? `Custom ${slot + 1} for your jacket: every square of it, laid flat with the front in the middle. The collar, cuffs, pockets, hood and hem stay your jacket color. It saves as you paint.`
        : `Custom ${slot + 1} for your pants: the seat and both legs, hip to hem, laid flat with the front in the middle. The pocket and the hem's folds stay your pants color. It saves as you paint.`;
    saveCustomWear();
    this.hooks.wear(garment, slot);
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
    if (document.activeElement === this.grid) {
      const move = MOVES[e.key];
      if (move) {
        const n = e.shiftKey ? JUMP : 1;
        for (let i = 0; i < n; i++) [this.x, this.y] = this.g.step(this.x, this.y, move[0], move[1]);
        if (this.penDown) this.paintLine(this.x, this.y);
        else this.queueDraw();
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
        this.setColor((this.g.color + (key === ']' ? 1 : -1) + EDIT_PALETTE.length) % EDIT_PALETTE.length);
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
      case 'm':
        this.toggleMirror();
        return true;
      case 'i': {
        const i = this.g.index(this.x, this.y);
        if (i >= 0) this.setColor(this.g.cells[i]!);
        return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------------- painting

  private paintLine(x: number, y: number): void {
    this.g.line(this.lastX, this.lastY, x, y);
    this.lastX = x;
    this.lastY = y;
    this.changed();
  }

  private paintAtCursor(): void {
    this.remember();
    if (this.tool === 'fill') {
      this.g.floodFill(this.x, this.y);
      this.changed();
      this.save();
      return;
    }
    this.penDown = true;
    this.lastX = this.x;
    this.lastY = this.y;
    this.g.stamp(this.x, this.y);
    this.changed();
  }

  private liftPen(): void {
    if (!this.penDown) return;
    this.penDown = false;
    this.save();
  }

  private fillAll(): void {
    this.remember();
    this.g.fillAll();
    this.changed();
    this.save();
  }

  private startFrom(pattern: StockPattern | null): void {
    if (!pattern) {
      this.fillAll();
      return;
    }
    this.remember();
    const o = this.hooks.get();
    const g = GARMENTS.find((x) => x.id === this.garment)!;
    fillStock(this.garment, this.slot, pattern, o[g.id], o[g.accent]);
    this.changed();
    this.save();
  }

  private remember(): void {
    this.undo.push(this.g.cells.slice());
    if (this.undo.length > UNDO_MAX) this.undo.shift();
    this.undoButton.disabled = false;
  }

  private stepBack(): void {
    if (this.penDown || this.dragging) return;
    const last = this.undo.pop();
    if (!last) return;
    this.g.cells.set(last);
    this.changed();
    this.save();
    this.sync();
  }

  private setColor(i: number): void {
    this.g.color = i;
    this.sync();
    this.queueDraw();
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

  private toggleMirror(): void {
    this.g.mirror = !this.g.mirror;
    this.sync();
    this.queueDraw();
  }

  /** The squares changed: redraw the grid (once a frame); the 3D skier waits for the stroke to end. */
  private changed(): void {
    this.queueDraw();
    this.unbuilt = true;
  }

  /** A stroke or an action ended: save the slots and rebuild the garment once. */
  private save(): void {
    saveCustomWear();
    this.build();
  }

  private build(): void {
    if (!this.unbuilt) return;
    this.unbuilt = false;
    this.hooks.repaint(this.garment);
  }

  // ---------------------------------------------------------- the mouse

  private listenPointer(): void {
    const g = this.grid;
    g.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      g.focus({ preventScroll: true });
      const [x, y] = this.cellAt(e);
      if (x < 0 || this.g.panelAt(x, y) < 0) return;
      this.x = x;
      this.y = y;
      this.remember();
      if (this.tool === 'fill') {
        this.g.floodFill(x, y);
        this.changed();
        this.save();
        return;
      }
      g.setPointerCapture(e.pointerId);
      this.dragging = true;
      this.lastX = x;
      this.lastY = y;
      this.g.stamp(x, y);
      this.changed();
    });
    g.addEventListener('pointermove', (e) => {
      const [x, y] = this.cellAt(e);
      if (this.dragging) {
        if (x < 0) return;
        if (this.g.panelAt(x, y) >= 0) {
          this.x = x;
          this.y = y;
        }
        if (x !== this.lastX || y !== this.lastY) this.paintLine(x, y);
        return;
      }
      if (x !== this.hoverX || y !== this.hoverY) {
        this.hoverX = x;
        this.hoverY = y;
        this.queueDraw();
      }
    });
    g.addEventListener('pointerleave', () => {
      this.hoverX = -1;
      this.queueDraw();
    });
    const end = (): void => this.endDrag();
    g.addEventListener('pointerup', end);
    g.addEventListener('pointercancel', end);
    g.addEventListener('lostpointercapture', end);
    g.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private endDrag(): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.save();
  }

  /** The layout cell under a pointer, clamped to the grid while dragging; x -1 when off it. */
  private cellAt(e: PointerEvent): [number, number] {
    const r = this.grid.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return [-1, 0];
    const x = Math.floor(((e.clientX - r.left) / r.width) * this.g.width);
    const y = Math.floor(((e.clientY - r.top) / r.height) * this.g.height);
    const inside = x >= 0 && x < this.g.width && y >= 0 && y < this.g.height;
    if (!inside && !this.dragging) return [-1, 0];
    return [Math.min(this.g.width - 1, Math.max(0, x)), Math.min(this.g.height - 1, Math.max(0, y))];
  }

  // -------------------------------------------------------------- drawing

  /** Sizes the grid to the bench (on opening and when the window resizes). */
  private layout(): void {
    if (!this.shown) return;
    const width = contentWidth(this.bench);
    this.cell = Math.max(CELL_MIN, Math.min(CELL_MAX, Math.floor(width / this.g.width)));
    this.grid.style.width = `${this.cell * this.g.width}px`;
    this.grid.style.height = `${this.cell * this.g.height}px`;
    this.queueDraw();
  }

  private queueDraw(): void {
    if (this.drawQueued) return;
    this.drawQueued = true;
    requestAnimationFrame(() => {
      this.drawQueued = false;
      this.drawGrid();
    });
  }

  private drawGrid(): void {
    const s = this.cell;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(this.g.width * s * dpr);
    const h = Math.round(this.g.height * s * dpr);
    if (this.grid.width !== w || this.grid.height !== h) {
      this.grid.width = w;
      this.grid.height = h;
    }
    const ctx = this.grid.getContext('2d');
    if (!ctx) return;
    const hover = this.dragging ? -1 : this.hoverX;
    this.g.draw(ctx, s, dpr, this.tool === 'pencil', hover, this.hoverY, document.activeElement === this.grid, this.x, this.y);
    this.drawNames(ctx, s);
    const panel = this.g.panelAt(this.x, this.y);
    const i = this.g.index(this.x, this.y);
    if (panel >= 0 && i >= 0) {
      const p = this.g.panels[panel]!;
      this.status.textContent = `${PANEL_NAMES[this.garment][panel]}: row ${this.y - p.y + 1} of ${p.rows}, square ${this.x - p.x + 1} of ${p.cols} round, ${EDIT_PALETTE[this.g.cells[i]!]!.name}`;
    }
  }

  /** Each piece's name in the row above it, and round the body (or the seat) where its back, sides and front are. */
  private drawNames(ctx: CanvasRenderingContext2D, s: number): void {
    const size = Math.max(9, Math.min(13, Math.round(s * 0.7)));
    ctx.font = `700 ${size}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#a9c1dc';
    this.g.panels.forEach((p, i) => {
      const y = (p.y - 0.5) * s;
      const main = this.garment === 'jacket' ? i === BODY_PANEL : i === 0;
      if (!main) {
        ctx.textAlign = 'center';
        ctx.fillText(PANEL_NAMES[this.garment][i]!, (p.x + p.cols / 2) * s, y);
        return;
      }
      // Back, right, front, left, back: a quarter of the way round apart.
      ROUND.forEach((name, k) => {
        ctx.textAlign = k === 0 ? 'left' : k === ROUND.length - 1 ? 'right' : 'center';
        ctx.fillText(k === 2 ? `${PANEL_NAMES[this.garment][i]}: ${name}` : name, (p.x + (p.cols * k) / 4) * s, y);
      });
    });
  }

  /** Marks the picked color, tool and switches. */
  private sync(): void {
    const o = this.hooks.get();
    const g = GARMENTS.find((x) => x.id === this.garment)!;
    const hex = EDIT_PALETTE[this.g.color]!.hex;
    this.chips.forEach((chip, i) => chip.setAttribute('aria-pressed', String(i === this.g.color)));
    this.colorName.textContent = EDIT_PALETTE[this.g.color]!.name;
    this.colorSwatch.style.background = hex;
    for (const s of this.startSwatches) {
      if (s.pattern) s.el.innerHTML = patternSwatch(s.pattern, o[g.id], o[g.accent]);
      else s.el.style.background = hex;
    }
    for (const [tool, b] of this.toolButtons) b.setAttribute('aria-pressed', String(tool === this.tool));
    this.mirrorButton.setAttribute('aria-pressed', String(this.g.mirror));
    this.brushButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(BRUSHES[i] === this.g.brush)));
    this.undoButton.disabled = this.undo.length === 0;
    const what = this.garment === 'jacket' ? 'The jacket laid flat: the right sleeve, the body round from the back with the front in the middle, the left sleeve' : 'The pants laid flat: the seat, then the right leg and the left';
    this.grid.setAttribute('aria-label', `${what}. Arrows move, Space paints.`);
  }
}
