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

/**
 * Colors of the player's own (typed as hex codes in an editor, 2026-11-24)
 * each slot may add after EDIT_PALETTE: indices 32 on, one letter each
 * (LETTERS has 52). A slot's palette is EDIT_PALETTE then its own colors.
 */
export const OWN_COLORS = 8;

/** A hex code as typed ("f0a", "#FF00aa") made "#rrggbb", or null when it isn't one. */
export function hexCode(text: string): string | null {
  const t = text.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{6}$/.test(t)) return `#${t}`;
  if (/^[0-9a-f]{3}$/.test(t)) return `#${t[0]}${t[0]}${t[1]}${t[1]}${t[2]}${t[2]}`;
  return null;
}

/** A new slot's palette: EDIT_PALETTE's colors, its own appended as they're added. */
export function newPalette(): string[] {
  return HEXES.slice();
}

/**
 * The index of `hex` in a slot's `palette` (EDIT_PALETTE's own if it's one
 * of them, else one of the slot's own colors), adding it (in place) if it's
 * new: in a free place, or over an own color nothing uses (`used`). -1 when
 * all OWN_COLORS are in use.
 */
export function paletteAdd(palette: string[], hex: string, used: (index: number) => boolean): number {
  const at = palette.indexOf(hex);
  if (at >= 0) return at;
  if (palette.length < HEXES.length + OWN_COLORS) return palette.push(hex) - 1;
  for (let i = HEXES.length; i < palette.length; i++) {
    if (!used(i)) {
      palette[i] = hex;
      return i;
    }
  }
  return -1;
}

/** A palette's own colors as saved: six hex digits each, after the last separator (nothing when it has none). */
export function ownColorsText(palette: readonly string[]): string {
  let out = '';
  for (let i = HEXES.length; i < palette.length; i++) out += palette[i]!.slice(1);
  return out;
}

/** A slot's palette from its saved own colors (ownColorsText's form; undefined: none), or null if it can't be read. */
export function paletteFrom(text: string | undefined): string[] | null {
  const out = newPalette();
  if (text === undefined || text === '') return out;
  if (text.length % 6 !== 0 || text.length / 6 > OWN_COLORS || !/^[0-9a-f]+$/.test(text)) return null;
  for (let k = 0; k < text.length; k += 6) out.push(`#${text.slice(k, k + 6)}`);
  return out;
}

/** A color's name in an editor: EDIT_PALETTE's, or the hex code of an own color. */
export function colorName(palette: readonly string[], index: number): string {
  return EDIT_PALETTE[index]?.name ?? (palette[index] ?? '#000000').toUpperCase();
}

/** Each own color of `palette` as the nearest EDIT_PALETTE color (an index map; EDIT_PALETTE's own map to themselves). */
export function snapMap(palette: readonly string[]): Uint8Array {
  const map = new Uint8Array(palette.length);
  for (let i = 0; i < palette.length; i++) map[i] = i < HEXES.length ? i : nearestIndex(palette[i]!);
  return map;
}

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
export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** A slot's own data: its two grids (shared with its graphic's layers), the sidewalls' color index, and whether the skis are painted alike (never on a board). */
interface Slot {
  graphic: SkiGraphic;
  /** The slot's palette (EDIT_PALETTE, then its own colors), shared with both grids' art. */
  colors: string[];
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
  s.graphic.sidewall = s.colors[index] ?? HEXES[0]!;
  s.graphic.base = s.graphic.sidewall;
}

/** The slot's palette: EDIT_PALETTE's colors, then its own (edited in place by customColor). */
export function customPalette(gear: Gear, slot: number): readonly string[] {
  return slotOf(gear, slot).colors;
}

/**
 * The index of a color typed as a hex code in the slot's palette, added as
 * one of its own if new (over one nothing uses: not the slot, nor `held`,
 * the editor's undo steps); -1 when its own colors are all in use.
 */
export function customColor(gear: Gear, slot: number, hex: string, held: (index: number) => boolean = () => false): number {
  const s = slotOf(gear, slot);
  return paletteAdd(s.colors, hex, (i) => s.sidewall === i || s.top.cells.includes(i) || s.base.cells.includes(i) || held(i));
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
    const colors = newPalette();
    const grid = (fill: number): PixelArt => ({ rows, cols: width, pair, cells: new Uint8Array(rows * width).fill(fill), colors });
    const top = grid(BLANK_TOP);
    const base = grid(BLANK_BASE);
    const wall = HEXES[BLANK_BASE]!;
    const graphic: SkiGraphic = { id, name: `Custom ${slot + 1}`, base: wall, sidewall: wall, pair, layers: [{ pixels: top }], baseLayers: [{ pixels: base }] };
    s = { graphic, colors, top, base, sidewall: BLANK_BASE, linked: pair };
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

/**
 * What an online look stores: customSkis.v1's JSON with the boards' slots
 * (customBoards.v1's) appended as `boards`, and `more` after them (since
 * milestone 23 part 2 the garments, `wear`: core/customWear.ts), so the look only grows.
 */
export function lookSkisText(more: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...slotsJson(SKI_GEARS), boards: slotsJson(BOARD_GEARS), ...more });
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
 * one of color 1. A slot with colors of its own (hex codes, 2026-11-24) adds
 * a `/` and six hex digits for each (letters from `g` on: index 32 up).
 * (The first ski saves, before the bases were painted, were the base's
 * letter then one ski's top: still read.) A board slot's is the same,
 * always `~`, its rows one board wide. `plain` writes the own colors as the
 * nearest EDIT_PALETTE ones, with no `/` part (the marketplace's form: its
 * Worker takes only EDIT_PALETTE's letters).
 */
function encode(s: Slot, plain = false): string {
  const own = ownColorsText(s.colors);
  const map = plain && own ? snapMap(s.colors) : null;
  const tail = own && !plain ? `/${own}` : '';
  return `${LETTERS[map ? map[s.sidewall]! : s.sidewall]!}${s.linked ? '=' : '~'}${runs(s.top.cells, map)}/${runs(s.base.cells, map)}${tail}`;
}

/** Run-length text of palette letters (customSkis.v1's cells; core/customWear.ts saves garments the same way). */
export function runs(cells: Uint8Array, map: Uint8Array | null = null): string {
  let out = '';
  const at = (i: number): number => (map ? map[cells[i]!]! : cells[i]!);
  for (let i = 0; i < cells.length; ) {
    let j = i + 1;
    while (j < cells.length && at(j) === at(i)) j++;
    out += (j - i > 1 ? String(j - i) : '') + LETTERS[at(i)]!;
    i = j;
  }
  return out;
}

/** A saved letter's palette index, or -1 if it isn't one of a palette of `size` colors (EDIT_PALETTE's by default). */
export function letterIndex(ch: string | undefined, size = HEXES.length): number {
  const i = ch === undefined ? -1 : LETTERS.indexOf(ch);
  return i >= 0 && i < size ? i : -1;
}

/** Fills `count` cells from run-length text (letters of a palette of `size` colors), or returns null if it doesn't fit exactly. */
export function unruns(text: string, count: number, size = HEXES.length): Uint8Array | null {
  const cells = new Uint8Array(count);
  let n = 0;
  for (let k = 0; k < text.length; ) {
    let run = 0;
    while (k < text.length && text[k]! >= '0' && text[k]! <= '9') run = run * 10 + Number(text[k++]);
    const color = letterIndex(text[k++], size);
    const len = Math.max(1, run);
    if (color < 0 || n + len > count) return null;
    cells.fill(color, n, n + len);
    n += len;
  }
  return n === count ? cells : null;
}

/** A slot's saved text read: its two grids, the sidewalls' color, whether it's linked and its palette; null if it can't be read. */
function parseSlot(text: string, gear: Gear): { top: Uint8Array; base: Uint8Array; wall: number; linked: boolean; colors: string[] } | null {
  const { rows, cols } = gearType(gear).model;
  const board = gearBoard(gear) !== null;
  const width = board ? cols : cols * 2;
  if (text[1] === '=' || text[1] === '~') {
    const [topText, baseText, own, extra] = text.slice(2).split('/');
    const colors = paletteFrom(own);
    if (!colors || extra !== undefined) return null;
    const wall = letterIndex(text[0], colors.length);
    const top = unruns(topText ?? '', rows * width, colors.length);
    const base = unruns(baseText ?? '', rows * width, colors.length);
    if (wall < 0 || !top || !base) return null;
    return { top, base, wall, linked: !board && text[1] === '=', colors };
  }
  // The first ski format: one ski's top sheet, the same on both, and one color underneath.
  const wall = letterIndex(text[0]);
  if (board || wall < 0) return null;
  const one = unruns(text.slice(1), rows * cols);
  if (!one) return null;
  const top = new Uint8Array(rows * width);
  for (let r = 0; r < rows; r++) {
    for (let side = 0; side < 2; side++) top.set(one.subarray(r * cols, (r + 1) * cols), r * cols * 2 + side * cols);
  }
  return { top, base: new Uint8Array(rows * width).fill(wall), wall, linked: false, colors: newPalette() };
}

/** Fills the slot from saved text; false (the slot untouched) if it can't be read. */
function decode(text: string, gear: Gear, slot: number): boolean {
  const read = parseSlot(text, gear);
  if (!read) return false;
  const s = slotOf(gear, slot);
  // The palette in place: both grids' art shares it.
  s.colors.length = 0;
  s.colors.push(...read.colors);
  s.top.cells.set(read.top);
  s.base.cells.set(read.base);
  if (text[1] === '=' || text[1] === '~') s.linked = read.linked;
  setCustomSidewall(gear, slot, read.wall);
  return true;
}

/**
 * One slot's saved text (the marketplace shares it, milestone 24, `plain`:
 * its own colors as the nearest EDIT_PALETTE ones), or null while it has
 * never been opened.
 */
export function slotText(gear: Gear, slot: number, plain = false): string | null {
  return gearList(gear)[slot] ? encode(slotOf(gear, slot), plain) : null;
}

/** Whether the slot paints with a color of its own (one only its own palette has: the marketplace shares it as the nearest). */
export function slotHasOwnColor(gear: Gear, slot: number): boolean {
  if (!gearList(gear)[slot]) return false;
  const s = slotOf(gear, slot);
  return s.sidewall >= HEXES.length || s.top.cells.some((c) => c >= HEXES.length) || s.base.cells.some((c) => c >= HEXES.length);
}

/** Paints one slot from saved text and saves; false (nothing changed) if it can't be read. The caller repaints. */
export function setSlotText(gear: Gear, slot: number, text: string): boolean {
  if (!decode(text, gear, slot)) return false;
  saveCustom(gear);
  return true;
}

/** A graphic drawn from saved text without touching any slot (a marketplace thumbnail), or null if it can't be read. */
export function graphicFromText(gear: Gear, text: string): SkiGraphic | null {
  const read = parseSlot(text, gear);
  if (!read) return null;
  const { rows, cols } = gearType(gear).model;
  const pair = gearBoard(gear) === null;
  const width = pair ? cols * 2 : cols;
  const art = (cells: Uint8Array): PixelArt => ({ rows, cols: width, pair, cells, colors: read.colors });
  const wall = read.colors[read.wall]!;
  return { id: 'market', name: 'Market', base: wall, sidewall: wall, pair, layers: [{ pixels: art(read.top) }], baseLayers: [{ pixels: art(read.base) }] };
}
