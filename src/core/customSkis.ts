import { aspectOf, CUSTOM, CUSTOM_SLOTS, graphicColor, SKI_TYPES, skiType, type PixelArt, type SkiGraphic, type SkiId } from './skis.ts';
import { readStored, writeStored } from './storage.ts';

// The player's own ski graphics: CUSTOM_SLOTS per ski type. Each slot is a
// pair graphic with two grids of palette indices, the top sheets and the
// bases, each row running across both skis (the left ski's columns, then
// the right's; rows along from the tail), drawn through `pixels` layers by
// the same painter as the stock graphics, so they cost nothing extra to
// render. The sidewalls and ends take one picked color. While a slot is
// linked, the editor paints both skis alike. Saved as one entry; with
// storage blocked or wiped the slots still work for the visit.

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

const KEY = 'customSkis.v1';
/** One letter per palette index in the saved string; a run of one color is its length in digits, then the letter. */
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** A slot's own data: its two grids (shared with its graphic's layers), the sidewalls' color index, and whether the skis are painted alike. */
interface Slot {
  graphic: SkiGraphic;
  top: PixelArt;
  base: PixelArt;
  sidewall: number;
  linked: boolean;
}
const slots = new Map<string, Slot>();
let loaded = false;

export function customId(ski: SkiId, slot: number): string {
  return `custom-${ski}-${slot + 1}`;
}

/** The slot's graphic, or null while it has never been opened in the editor. */
export function customGraphic(ski: SkiId, slot: number): SkiGraphic | null {
  return CUSTOM[ski][slot] ?? null;
}

/** The slot's top sheets or bases (see PixelArt: a pair, `cols` across both skis), made blank on first use. */
export function customFace(ski: SkiId, slot: number, face: Face): PixelArt {
  return slotOf(ski, slot)[face];
}

/** The sidewalls' color, as an index into EDIT_PALETTE. */
export function customSidewall(ski: SkiId, slot: number): number {
  return slotOf(ski, slot).sidewall;
}

export function setCustomSidewall(ski: SkiId, slot: number, index: number): void {
  const s = slotOf(ski, slot);
  s.sidewall = index;
  s.graphic.sidewall = HEXES[index]!;
  s.graphic.base = HEXES[index]!;
}

/** Whether the editor paints both skis alike. */
export function customLinked(ski: SkiId, slot: number): boolean {
  return slotOf(ski, slot).linked;
}

export function setCustomLinked(ski: SkiId, slot: number, linked: boolean): void {
  slotOf(ski, slot).linked = linked;
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

/**
 * Paints the slot cell for cell from a stock graphic of the same ski, both
 * skis' top sheets and bases, snapping to the palette, and takes its
 * sidewall color. A pair graphic's two skis differ, so it unlinks the slot.
 */
export function copyStock(ski: SkiId, slot: number, g: SkiGraphic): void {
  const m = skiType(ski).model;
  const aspect = aspectOf(m);
  const s = slotOf(ski, slot);
  const memo = new Map<string, number>();
  for (const face of ['top', 'base'] as const) {
    const { cells, cols } = s[face];
    for (let r = 0; r < m.rows; r++) {
      for (let side = 0; side < 2; side++) {
        for (let c = 0; c < m.cols; c++) {
          const hex = graphicColor(g, ((r + 0.5) / m.rows) * 2 - 1, -1 + (2 * c + 1) / m.cols, aspect, side === 0 ? -1 : 1, face === 'base');
          let i = memo.get(hex);
          if (i === undefined) memo.set(hex, (i = nearestIndex(hex)));
          cells[r * cols + side * m.cols + c] = i;
        }
      }
    }
  }
  setCustomSidewall(ski, slot, nearestIndex(g.sidewall ?? g.base));
  if (g.pair) s.linked = false;
}

function slotOf(ski: SkiId, slot: number): Slot {
  const id = customId(ski, slot);
  let s = slots.get(id);
  if (!s) {
    const { rows, cols } = skiType(ski).model;
    const grid = (fill: number): PixelArt => ({ rows, cols: cols * 2, pair: true, cells: new Uint8Array(rows * cols * 2).fill(fill), colors: HEXES });
    const top = grid(BLANK_TOP);
    const base = grid(BLANK_BASE);
    const wall = HEXES[BLANK_BASE]!;
    const graphic: SkiGraphic = { id, name: `Custom ${slot + 1}`, base: wall, sidewall: wall, pair: true, layers: [{ pixels: top }], baseLayers: [{ pixels: base }] };
    s = { graphic, top, base, sidewall: BLANK_BASE, linked: true };
    slots.set(id, s);
    CUSTOM[ski][slot] = graphic;
  }
  return s;
}

/** Reads the saved slots once (later calls do nothing). Anything unreadable leaves that slot unpainted. */
export function loadCustomSkis(): void {
  if (loaded) return;
  loaded = true;
  let saved: Record<string, unknown> = {};
  try {
    const raw = readStored(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') saved = parsed as Record<string, unknown>;
  } catch {
    return;
  }
  for (const type of SKI_TYPES) {
    const list = saved[type.id];
    if (!Array.isArray(list)) continue;
    for (let slot = 0; slot < CUSTOM_SLOTS; slot++) {
      if (typeof list[slot] === 'string') decode(list[slot] as string, type.id, slot);
    }
  }
}

/** Writes every painted slot (if storage works; if not, they last the visit). */
export function saveCustomSkis(): void {
  writeStored(KEY, customSkisText());
}

/** Every slot as saved: { "park": [slot or null, ...], ... } as JSON (also what the online look stores). */
export function customSkisText(): string {
  const out: Record<string, (string | null)[]> = {};
  for (const type of SKI_TYPES) out[type.id] = CUSTOM[type.id].map((g, slot) => (g ? encode(slotOf(type.id, slot)) : null));
  return JSON.stringify(out);
}

/**
 * Replaces every slot with `text` (customSkisText's form, from an online
 * look) and saves it. A slot it leaves empty or can't read goes back to
 * never opened. The grids are refilled in place, so the caller repaints.
 */
export function setCustomSkisText(text: string): void {
  let saved: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object') saved = parsed as Record<string, unknown>;
  } catch {
    return;
  }
  for (const type of SKI_TYPES) {
    const list = saved[type.id];
    for (let slot = 0; slot < CUSTOM_SLOTS; slot++) {
      const entry = Array.isArray(list) ? list[slot] : null;
      if (typeof entry === 'string' && decode(entry, type.id, slot)) continue;
      slots.delete(customId(type.id, slot));
      CUSTOM[type.id][slot] = null;
    }
  }
  saveCustomSkis();
}

/** How many slots `text` (customSkisText's form) has painted. */
export function paintedSlots(text: string): number {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') return 0;
    return Object.values(parsed as Record<string, unknown>).reduce<number>((n, list) => n + (Array.isArray(list) ? list.filter((s) => typeof s === 'string').length : 0), 0);
  } catch {
    return 0;
  }
}

/**
 * The sidewalls' letter, `=` (linked) or `~`, then the top sheets' cells and,
 * after a `/`, the bases', run by run: "12A" is twelve cells of color 0, "B"
 * one of color 1. (The first saves, before the bases were painted, were the
 * base's letter then one ski's top: still read.)
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
function decode(text: string, ski: SkiId, slot: number): boolean {
  const { rows, cols } = skiType(ski).model;
  const wall = letterIndex(text[0]);
  if (wall < 0) return false;
  if (text[1] === '=' || text[1] === '~') {
    const [topText, baseText] = text.slice(2).split('/');
    const top = unruns(topText ?? '', rows * cols * 2);
    const base = unruns(baseText ?? '', rows * cols * 2);
    if (!top || !base) return false;
    const s = slotOf(ski, slot);
    s.top.cells.set(top);
    s.base.cells.set(base);
    s.linked = text[1] === '=';
    setCustomSidewall(ski, slot, wall);
    return true;
  }
  // The first format: one ski's top sheet, the same on both, and one color underneath.
  const one = unruns(text.slice(1), rows * cols);
  if (!one) return false;
  const s = slotOf(ski, slot);
  for (let r = 0; r < rows; r++) {
    for (let side = 0; side < 2; side++) s.top.cells.set(one.subarray(r * cols, (r + 1) * cols), r * cols * 2 + side * cols);
  }
  s.base.cells.fill(wall);
  setCustomSidewall(ski, slot, wall);
  return true;
}
