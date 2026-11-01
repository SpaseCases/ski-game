import { aspectOf, CUSTOM, CUSTOM_SLOTS, graphicColor, SKI_TYPES, skiType, type PixelArt, type SkiGraphic, type SkiId } from './skis.ts';
import { readStored, writeStored } from './storage.ts';

// The player's own ski graphics: CUSTOM_SLOTS per ski type, each a palette
// index per cell of that ski's top-sheet grid (rows along from the tail,
// columns across from the left edge), drawn through a `pixels` layer by the
// same painter as the stock graphics, so they cost nothing extra to render.
// The base and the sidewalls take one picked color. Both skis of the pair
// are the same. Saved as one entry; with storage blocked or wiped the slots
// still work for the visit.

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

/** A new slot: the top sheet in Ink, the base in Cobalt (indices into EDIT_PALETTE). */
const BLANK_TOP = 0;
const BLANK_BASE = 22;

const KEY = 'customSkis.v1';
/** One letter per palette index in the saved string; a run of one color is its length in digits, then the letter. */
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** A slot's own data: the cells (shared with its graphic's layer) and the base color's index. */
interface Slot {
  graphic: SkiGraphic;
  art: PixelArt;
  base: number;
}
const slots = new Map<string, Slot>();
let loaded = false;

export function customId(ski: SkiId, slot: number): string {
  return `custom-${ski}-${slot + 1}`;
}

/** Which ski and slot a graphic id names, or null for a stock graphic. */
export function customSlotOf(id: string): { ski: SkiId; slot: number } | null {
  const m = /^custom-(\w+)-(\d)$/.exec(id);
  if (!m) return null;
  const type = SKI_TYPES.find((t) => t.id === m[1]);
  const slot = Number(m[2]) - 1;
  return type && slot >= 0 && slot < CUSTOM_SLOTS ? { ski: type.id, slot } : null;
}

/** The slot's graphic, or null while it has never been painted. */
export function customGraphic(ski: SkiId, slot: number): SkiGraphic | null {
  return CUSTOM[ski][slot] ?? null;
}

/** The slot's cells (one EDIT_PALETTE index each, see PixelArt), made blank on first use. */
export function customArt(ski: SkiId, slot: number): PixelArt {
  return slotOf(ski, slot).art;
}

/** The slot's base color, as an index into EDIT_PALETTE. */
export function customBase(ski: SkiId, slot: number): number {
  return slotOf(ski, slot).base;
}

export function setCustomBase(ski: SkiId, slot: number, index: number): void {
  const s = slotOf(ski, slot);
  s.base = index;
  s.graphic.base = HEXES[index]!;
  s.graphic.sidewall = HEXES[index]!;
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

/** Paints the slot cell for cell from a stock graphic of the same ski (a pair graphic gives its left ski's half), snapping to the palette; also copies its base color. */
export function copyStock(ski: SkiId, slot: number, g: SkiGraphic): void {
  const m = skiType(ski).model;
  const aspect = aspectOf(m);
  const { cells } = customArt(ski, slot);
  const memo = new Map<string, number>();
  for (let r = 0; r < m.rows; r++) {
    for (let c = 0; c < m.cols; c++) {
      const hex = graphicColor(g, ((r + 0.5) / m.rows) * 2 - 1, -1 + (2 * c + 1) / m.cols, aspect, -1, false);
      let i = memo.get(hex);
      if (i === undefined) memo.set(hex, (i = nearestIndex(hex)));
      cells[r * m.cols + c] = i;
    }
  }
  setCustomBase(ski, slot, nearestIndex(g.base));
}

function slotOf(ski: SkiId, slot: number): Slot {
  const id = customId(ski, slot);
  let s = slots.get(id);
  if (!s) {
    const { rows, cols } = skiType(ski).model;
    const art: PixelArt = { rows, cols, cells: new Uint8Array(rows * cols).fill(BLANK_TOP), colors: HEXES };
    const graphic: SkiGraphic = { id, name: `Custom ${slot + 1}`, base: HEXES[BLANK_BASE]!, sidewall: HEXES[BLANK_BASE]!, layers: [{ pixels: art }] };
    s = { graphic, art, base: BLANK_BASE };
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
      const decoded = typeof list[slot] === 'string' ? decode(list[slot] as string, type.model.rows * type.model.cols) : null;
      if (!decoded) continue;
      customArt(type.id, slot).cells.set(decoded.cells);
      setCustomBase(type.id, slot, decoded.base);
    }
  }
}

/** Writes every painted slot (if storage works; if not, they last the visit). */
export function saveCustomSkis(): void {
  const out: Record<string, (string | null)[]> = {};
  for (const type of SKI_TYPES) out[type.id] = CUSTOM[type.id].map((g, slot) => (g ? encode(slotOf(type.id, slot)) : null));
  writeStored(KEY, JSON.stringify(out));
}

/** The base's letter, then the cells run by run: "12A" is twelve cells of color 0, "B" one of color 1. */
function encode(s: Slot): string {
  let out = LETTERS[s.base]!;
  const cells = s.art.cells;
  for (let i = 0; i < cells.length; ) {
    let j = i + 1;
    while (j < cells.length && cells[j] === cells[i]) j++;
    out += (j - i > 1 ? String(j - i) : '') + LETTERS[cells[i]!]!;
    i = j;
  }
  return out;
}

function decode(text: string, count: number): { base: number; cells: Uint8Array } | null {
  const index = (ch: string | undefined): number => {
    const i = ch === undefined ? -1 : LETTERS.indexOf(ch);
    return i >= 0 && i < HEXES.length ? i : -1;
  };
  const base = index(text[0]);
  if (base < 0) return null;
  const cells = new Uint8Array(count);
  let n = 0;
  for (let k = 1; k < text.length; ) {
    let run = 0;
    while (k < text.length && text[k]! >= '0' && text[k]! <= '9') run = run * 10 + Number(text[k++]);
    const color = index(text[k++]);
    if (color < 0 || n + Math.max(1, run) > count) return null;
    cells.fill(color, n, n + Math.max(1, run));
    n += Math.max(1, run);
  }
  return n === count ? { base, cells } : null;
}
