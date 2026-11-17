import { BOARD_TYPES, boardType, CUSTOM_BOARDS, type BoardId } from './boards.ts';
import { aspectOf, CUSTOM, CUSTOM_SLOTS, graphicColor, SKI_TYPES, skiType, type PixelArt, type Side, type SkiGraphic, type SkiId, type SkiModel } from './skis.ts';
import { readStored, writeStored } from './storage.ts';

// The player's own ski and board graphics: CUSTOM_SLOTS per ski type and,
// since milestone 23, per board type. A ski slot is a pair graphic with two
// grids of palette indices, the top sheets and the bases, each row running
// across both skis (the left ski's columns, then the right's; rows along
// from the tail); a board slot is one board's two grids. Both are drawn
// through `pixels` layers by the same painter as the stock graphics, so
// they cost nothing extra to render. The sidewalls and ends take one picked
// color. While a ski slot is linked, the editor paints both skis alike. The
// skis are saved as one entry (customSkis.v1, its format unchanged since
// milestone 12) and the boards as another (customBoards.v1); with storage
// blocked or wiped the slots still work for the visit. Only the game's own
// code imports this module (main loads it before the outfit), so it stays
// out of the chunk the pose gallery shares.

/**
 * The editor's palette: the Locker's 20 colors (core/outfit.ts) and 12
 * shades the stock graphics use. Saved slots store indices into this list,
 * so its order must never change: add colors at the end only.
 */
export const EDIT_PALETTE: readonly { readonly name: string; readonly hex: string }[] = [
  { name: 'Ink', hex: '#1b1d21' },
  { name: 'Coal', hex: '#2c3037' },
  { name: 'Slate', hex: '#3a3f47' },
  { name: 'Steel', hex: '#4d525b' },
  { name: 'Fog', hex: '#98a2ad' },
  { name: 'Chalk', hex: '#ece8de' },
  { name: 'Ice', hex: '#eef3f7' },
  { name: 'Sand', hex: '#c8b07e' },
  { name: 'Tan', hex: '#d9b98a' },
  { name: 'Peach', hex: '#ffd9a0' },
  { name: 'Bark', hex: '#8a5a3a' },
  { name: 'Rust', hex: '#a24a2a' },
  { name: 'Tangerine', hex: '#ff7a1a' },
  { name: 'Coral', hex: '#f0784a' },
  { name: 'Amber', hex: '#f6a640' },
  { name: 'Lemon', hex: '#f1c93b' },
  { name: 'Lime', hex: '#b8e330' },
  { name: 'Olive', hex: '#677a52' },
  { name: 'Pine', hex: '#2f5a45' },
  { name: 'Lagoon', hex: '#1f6f73' },
  { name: 'Teal', hex: '#23898a' },
  { name: 'Glacier', hex: '#8cc9e0' },
  { name: 'Cobalt', hex: '#2f7fe0' },
  { name: 'Navy', hex: '#22395e' },
  { name: 'Night', hex: '#14203a' },
  { name: 'Dusk', hex: '#3b2a5c' },
  { name: 'Plum', hex: '#6a3b74' },
  { name: 'Heather', hex: '#7a5f9c' },
  { name: 'Lilac', hex: '#b3a2dc' },
  { name: 'Rose', hex: '#a3477a' },
  { name: 'Bubblegum', hex: '#e2497b' },
  { name: 'Cherry', hex: '#d33a3f' },
];
const HEXES = EDIT_PALETTE.map((c) => c.hex);

/** A new slot: the top sheets in Ink, the bases and sidewalls in Cobalt (indices into EDIT_PALETTE). */
const BLANK_TOP = 0;
const BLANK_BASE = 22;

export type Face = 'top' | 'base';

/** What a custom slot is painted on: a ski type, or a board type as `board-<id>`. */
export type Gear = SkiId | `board-${BoardId}`;

export function boardGear(id: BoardId): Gear {
  return `board-${id}`;
}

/** The board type a gear names, or null for a ski. */
export function gearBoard(gear: Gear): BoardId | null {
  return gear.startsWith('board-') ? (gear.slice(6) as BoardId) : null;
}

/** The gear's name, shape and stock graphics. */
export function gearType(gear: Gear): { name: string; model: SkiModel; graphics: readonly SkiGraphic[] } {
  const board = gearBoard(gear);
  return board ? boardType(board) : skiType(gear as SkiId);
}

/** The gear's custom slots (the list its graphics are looked up in). */
function gearList(gear: Gear): (SkiGraphic | null)[] {
  const board = gearBoard(gear);
  return board ? CUSTOM_BOARDS[board] : CUSTOM[gear as SkiId];
}

const KEY = 'customSkis.v1';
const BOARD_KEY = 'customBoards.v1';
/** One letter per palette index in the saved string; a run of one color is its length in digits, then the letter. */
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** A slot's own data: its two grids (shared with its graphic's layers), the sidewalls' color index, and whether the skis are painted alike (never on a board). */
interface Slot {
  graphic: SkiGraphic;
  top: PixelArt;
  base: PixelArt;
  sidewall: number;
  linked: boolean;
}
const slots = new Map<string, Slot>();
let loaded = false;

export function customId(gear: Gear, slot: number): string {
  return `custom-${gear}-${slot + 1}`;
}

/** The slot's graphic, or null while it has never been opened in the editor. */
export function customGraphic(gear: Gear, slot: number): SkiGraphic | null {
  return gearList(gear)[slot] ?? null;
}

/** The slot's top sheets or bases (see PixelArt: a ski slot's is a pair, `cols` across both skis), made blank on first use. */
export function customFace(gear: Gear, slot: number, face: Face): PixelArt {
  return slotOf(gear, slot)[face];
}

/** The sidewalls' color, as an index into EDIT_PALETTE. */
export function customSidewall(gear: Gear, slot: number): number {
  return slotOf(gear, slot).sidewall;
}

export function setCustomSidewall(gear: Gear, slot: number, index: number): void {
  const s = slotOf(gear, slot);
  s.sidewall = index;
  s.graphic.sidewall = HEXES[index]!;
  s.graphic.base = HEXES[index]!;
}

/** Whether the editor paints both skis alike (never on a board). */
export function customLinked(gear: Gear, slot: number): boolean {
  return slotOf(gear, slot).linked;
}

export function setCustomLinked(gear: Gear, slot: number, linked: boolean): void {
  slotOf(gear, slot).linked = linked && gearBoard(gear) === null;
}

/** The nearest palette color to `hex` (an exact match if there is one). */
export function nearestIndex(hex: string): number {
  const exact = HEXES.indexOf(hex);
  if (exact >= 0) return exact;
  const v = parseInt(hex.slice(1), 16);
  let best = 0;
  let bestD = Infinity;
  HEXES.forEach((h, i) => {
    const w = parseInt(h.slice(1), 16);
    // Weighted RGB distance (green counts most, as the eye sees it).
    const d = 2 * (((v >> 16) & 255) - ((w >> 16) & 255)) ** 2 + 4 * (((v >> 8) & 255) - ((w >> 8) & 255)) ** 2 + 3 * ((v & 255) - (w & 255)) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/** The skis a ski slot's rows hold (left, then right), and the one board a board slot's do (painted as the 3D board is, side 1). */
const PAIR_SIDES: readonly Side[] = [-1, 1];
const BOARD_SIDES: readonly Side[] = [1];

/**
 * Paints the slot cell for cell from a stock graphic of the same gear (both
 * skis', or the board's, top sheets and bases), snapping to the palette,
 * and takes its sidewall color. A pair graphic's two skis differ, so it
 * unlinks the slot.
 */
export function copyStock(gear: Gear, slot: number, g: SkiGraphic): void {
  const m = gearType(gear).model;
  const aspect = aspectOf(m);
  const s = slotOf(gear, slot);
  const sides = gearBoard(gear) ? BOARD_SIDES : PAIR_SIDES;
  const memo = new Map<string, number>();
  for (const face of ['top', 'base'] as const) {
    const { cells, cols } = s[face];
    for (let r = 0; r < m.rows; r++) {
      sides.forEach((side, k) => {
        for (let c = 0; c < m.cols; c++) {
          const hex = graphicColor(g, ((r + 0.5) / m.rows) * 2 - 1, -1 + (2 * c + 1) / m.cols, aspect, side, face === 'base');
          let i = memo.get(hex);
          if (i === undefined) memo.set(hex, (i = nearestIndex(hex)));
          cells[r * cols + k * m.cols + c] = i;
        }
      });
    }
  }
  setCustomSidewall(gear, slot, nearestIndex(g.sidewall ?? g.base));
  if (g.pair) s.linked = false;
}

function slotOf(gear: Gear, slot: number): Slot {
  const id = customId(gear, slot);
  let s = slots.get(id);
  if (!s) {
    const { rows, cols } = gearType(gear).model;
    // A ski slot paints the pair (each row across both skis); a board slot one board.
    const pair = gearBoard(gear) === null;
    const width = pair ? cols * 2 : cols;
    const grid = (fill: number): PixelArt => ({ rows, cols: width, pair, cells: new Uint8Array(rows * width).fill(fill), colors: HEXES });
    const top = grid(BLANK_TOP);
    const base = grid(BLANK_BASE);
    const wall = HEXES[BLANK_BASE]!;
    const graphic: SkiGraphic = { id, name: `Custom ${slot + 1}`, base: wall, sidewall: wall, pair, layers: [{ pixels: top }], baseLayers: [{ pixels: base }] };
    s = { graphic, top, base, sidewall: BLANK_BASE, linked: pair };
    slots.set(id, s);
    gearList(gear)[slot] = graphic;
  }
  return s;
}

/** Each saved entry's keys and the gear they hold: customSkis.v1 by ski type, customBoards.v1 by board type. */
interface Entry {
  key: string;
  gear: Gear;
}
const SKI_GEARS: readonly Entry[] = SKI_TYPES.map((t) => ({ key: t.id, gear: t.id }));
const BOARD_GEARS: readonly Entry[] = BOARD_TYPES.map((t) => ({ key: t.id, gear: boardGear(t.id) }));

/**
 * Reads the saved slots once (later calls do nothing); anything unreadable
 * leaves that slot unpainted. Call it before loading the outfit, so the
 * outfit can wear a custom graphic.
 */
export function loadCustomSkis(): void {
  if (loaded) return;
  loaded = true;
  for (const [key, gears] of [
    [KEY, SKI_GEARS],
    [BOARD_KEY, BOARD_GEARS],
  ] as const) {
    const saved = parseObject(readStored(key));
    for (const { key: k, gear } of gears) {
      const list = saved?.[k];
      if (!Array.isArray(list)) continue;
      for (let slot = 0; slot < CUSTOM_SLOTS; slot++) {
        if (typeof list[slot] === 'string') decode(list[slot] as string, gear, slot);
      }
    }
  }
}

/** Writes the painted slots (if storage works; if not, they last the visit): the skis', the boards', or both. */
export function saveCustomSkis(which: 'skis' | 'boards' | 'both' = 'both'): void {
  if (which !== 'boards') writeStored(KEY, customSkisText());
  if (which !== 'skis') writeStored(BOARD_KEY, JSON.stringify(slotsJson(BOARD_GEARS)));
}

/** Saves the slots of that gear's kind (the skis' entry or the boards'). */
export function saveCustom(gear: Gear): void {
  saveCustomSkis(gearBoard(gear) ? 'boards' : 'skis');
}

/** Every ski slot as saved: { "park": [slot or null, ...], ... } as JSON (customSkis.v1). */
export function customSkisText(): string {
  return JSON.stringify(slotsJson(SKI_GEARS));
}

/** What an online look stores: customSkis.v1's JSON with the boards' slots (customBoards.v1's) appended as `boards`, so the look only grows. */
export function lookSkisText(): string {
  return JSON.stringify({ ...slotsJson(SKI_GEARS), boards: slotsJson(BOARD_GEARS) });
}

function slotsJson(gears: readonly Entry[]): Record<string, (string | null)[]> {
  const out: Record<string, (string | null)[]> = {};
  for (const { key, gear } of gears) out[key] = gearList(gear).map((g, slot) => (g ? encode(slotOf(gear, slot)) : null));
  return out;
}

/**
 * Replaces every slot with `text` (lookSkisText's form, or customSkisText's
 * from an older look) and saves it. A slot it leaves empty or can't read
 * goes back to never opened; a look without `boards` (saved before
 * milestone 23) leaves this computer's boards as they are. The grids are
 * refilled in place, so the caller repaints.
 */
export function setCustomSkisText(text: string): void {
  const saved = parseObject(text);
  if (!saved) return;
  replaceSlots(saved, SKI_GEARS);
  const boards = objectOf(saved.boards);
  if (boards) replaceSlots(boards, BOARD_GEARS);
  saveCustomSkis();
}

function replaceSlots(saved: Record<string, unknown>, gears: readonly Entry[]): void {
  for (const { key, gear } of gears) {
    const list = saved[key];
    for (let slot = 0; slot < CUSTOM_SLOTS; slot++) {
      const entry = Array.isArray(list) ? list[slot] : null;
      if (typeof entry === 'string' && decode(entry, gear, slot)) continue;
      slots.delete(customId(gear, slot));
      gearList(gear)[slot] = null;
    }
  }
}

/** How many slots `text` (lookSkisText's form) has painted, skis and boards. */
export function paintedSlots(text: string): number {
  const count = (o: Record<string, unknown>): number => Object.values(o).reduce<number>((n, list) => n + (Array.isArray(list) ? list.filter((s) => typeof s === 'string').length : 0), 0);
  const saved = parseObject(text);
  if (!saved) return 0;
  const boards = objectOf(saved.boards);
  return count(saved) + (boards ? count(boards) : 0);
}

function parseObject(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  try {
    return objectOf(JSON.parse(text));
  } catch {
    return null;
  }
}

function objectOf(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * The sidewalls' letter, `=` (linked) or `~`, then the top sheets' cells and,
 * after a `/`, the bases', run by run: "12A" is twelve cells of color 0, "B"
 * one of color 1. (The first ski saves, before the bases were painted, were
 * the base's letter then one ski's top: still read.) A board slot's is the
 * same, always `~`, its rows one board wide.
 */
function encode(s: Slot): string {
  return `${LETTERS[s.sidewall]!}${s.linked ? '=' : '~'}${runs(s.top.cells)}/${runs(s.base.cells)}`;
}

function runs(cells: Uint8Array): string {
  let out = '';
  for (let i = 0; i < cells.length; ) {
    let j = i + 1;
    while (j < cells.length && cells[j] === cells[i]) j++;
    out += (j - i > 1 ? String(j - i) : '') + LETTERS[cells[i]!]!;
    i = j;
  }
  return out;
}

function letterIndex(ch: string | undefined): number {
  const i = ch === undefined ? -1 : LETTERS.indexOf(ch);
  return i >= 0 && i < HEXES.length ? i : -1;
}

/** Fills `count` cells from run-length text, or returns null if it doesn't fit exactly. */
function unruns(text: string, count: number): Uint8Array | null {
  const cells = new Uint8Array(count);
  let n = 0;
  for (let k = 0; k < text.length; ) {
    let run = 0;
    while (k < text.length && text[k]! >= '0' && text[k]! <= '9') run = run * 10 + Number(text[k++]);
    const color = letterIndex(text[k++]);
    const len = Math.max(1, run);
    if (color < 0 || n + len > count) return null;
    cells.fill(color, n, n + len);
    n += len;
  }
  return n === count ? cells : null;
}

/** Fills the slot from saved text; false (the slot untouched) if it can't be read. */
function decode(text: string, gear: Gear, slot: number): boolean {
  const { rows, cols } = gearType(gear).model;
  const board = gearBoard(gear) !== null;
  const width = board ? cols : cols * 2;
  const wall = letterIndex(text[0]);
  if (wall < 0) return false;
  if (text[1] === '=' || text[1] === '~') {
    const [topText, baseText] = text.slice(2).split('/');
    const top = unruns(topText ?? '', rows * width);
    const base = unruns(baseText ?? '', rows * width);
    if (!top || !base) return false;
    const s = slotOf(gear, slot);
    s.top.cells.set(top);
    s.base.cells.set(base);
    s.linked = !board && text[1] === '=';
    setCustomSidewall(gear, slot, wall);
    return true;
  }
  // The first ski format: one ski's top sheet, the same on both, and one color underneath.
  if (board) return false;
  const one = unruns(text.slice(1), rows * cols);
  if (!one) return false;
  const s = slotOf(gear, slot);
  for (let r = 0; r < rows; r++) {
    for (let side = 0; side < 2; side++) s.top.cells.set(one.subarray(r * cols, (r + 1) * cols), r * cols * 2 + side * cols);
  }
  s.base.cells.fill(wall);
  setCustomSidewall(gear, slot, wall);
  return true;
}
