import { BODY_PANEL, LEG_LEFT, LEG_RIGHT, SEAT_PANEL, SLEEVE_LEFT, SLEEVE_RIGHT, setWearArt, wearOffsets, wearPanels, wearSize, type WearGarment } from '../render/wearPanels.ts';
import { EDIT_PALETTE, nearestIndex, runs, unruns } from './customSkis.ts';
import { CUSTOM_PATTERNS, GARMENTS, isCustomPattern, WEAR_SLOTS, type CustomPattern, type Garment, type Outfit, type StockPattern } from './outfit.ts';
import { readStored, writeStored } from './storage.ts';

// The player's own jacket and pants (milestone 23 part 2): WEAR_SLOTS
// custom slots per garment, each every square of the garment's low-poly
// body (render/wearPanels.ts lays them out) as an index into the editor
// palette (core/customSkis.ts EDIT_PALETTE, append only). Worn as the
// garment's pattern `custom-<n>`: the rig paints each face from its square
// and keeps the garment's own Locker color for the collar, cuffs, pockets,
// hood and hem trim. Saved on this computer as one entry, customWear.v1:
// { "jacket": [slot or null, ...], "pants": [...] }, a slot being its
// squares, panel after panel, as customSkis.v1's run-length letters. With
// storage blocked or wiped the slots last the visit. Only the game's own
// code imports this module (main loads it with the custom skis, before the
// outfit), so it stays out of the chunk the pose gallery shares.

const KEY = 'customWear.v1';
const HEXES = EDIT_PALETTE.map((c) => c.hex);
const GARMENT_IDS: readonly WearGarment[] = ['jacket', 'pants'];

/** Each garment's slots: its squares, or null while never opened in the editor. */
const slots: Record<WearGarment, (Uint8Array | null)[]> = {
  jacket: Array.from({ length: WEAR_SLOTS }, () => null),
  pants: Array.from({ length: WEAR_SLOTS }, () => null),
};
let loaded = false;

/** The pattern id a slot is worn as. */
export function wearPattern(slot: number): CustomPattern {
  return CUSTOM_PATTERNS[slot]!;
}

/** The slot a custom pattern names, or -1. */
export function wearSlot(pattern: string): number {
  return (CUSTOM_PATTERNS as readonly string[]).indexOf(pattern);
}

/** A slot's squares (edited in place by the editor), or null while it has never been opened. */
export function wearCells(garment: WearGarment, slot: number): Uint8Array | null {
  return slots[garment][slot] ?? null;
}

/** Makes the slot (blank in `fill`) if it has never been opened, and shows it to the rig. */
function slotCells(garment: WearGarment, slot: number, fill: number): Uint8Array {
  let cells = slots[garment][slot];
  if (!cells) {
    cells = new Uint8Array(wearSize(garment)).fill(fill);
    slots[garment][slot] = cells;
    setWearArt(garment, wearPattern(slot), { cells, colors: HEXES });
  }
  return cells;
}

/**
 * The slot's squares for the editor: made on first use from what the
 * garment wears now (its stock pattern in its two colors, or a copy of the
 * painted slot it wears).
 */
export function openWear(garment: WearGarment, slot: number, o: Outfit): Uint8Array {
  if (slots[garment][slot]) return slots[garment][slot]!;
  const g = GARMENTS.find((x) => x.id === garment)!;
  const worn = o[g.pattern];
  const cells = slotCells(garment, slot, nearestIndex(o[garment]));
  const from = isCustomPattern(worn) ? wearCells(garment, wearSlot(worn)) : null;
  if (from && from !== cells) cells.set(from);
  else fillStock(garment, slot, isCustomPattern(worn) ? 'plain' : worn, o[garment], o[g.accent]);
  return cells;
}

/**
 * Paints the slot with a stock pattern in two colors, as near as the
 * squares go: stripes are a band round the lower chest and the belly and
 * round each upper sleeve, and two columns down the outside of each leg;
 * blocks the chest's top row and the upper sleeves, and the pants from the
 * knee down; plaid an even check of every other column and row, darker where
 * they cross (as the 3D plaid).
 */
export function fillStock(garment: WearGarment, slot: number, pattern: StockPattern, baseHex: string, accentHex: string): void {
  const cells = slotCells(garment, slot, 0);
  const base = nearestIndex(baseHex);
  const accent = nearestIndex(accentHex);
  const dark = nearestIndex(darkHex(baseHex, accentHex));
  const panels = wearPanels(garment);
  const at = wearOffsets(garment);
  panels.forEach((p, panel) => {
    for (let r = 0; r < p.rows; r++) {
      for (let c = 0; c < p.cols; c++) {
        let color = base;
        if (pattern === 'plaid') {
          const across = c % 2 === 0;
          const down = r % 2 === 0;
          color = across && down ? dark : across || down ? accent : base;
        } else if (pattern !== 'plain' && stockAccent(garment, pattern, panel, r, c)) color = accent;
        cells[at[panel]! + r * p.cols + c] = color;
      }
    }
  });
}

/** Whether stripes or blocks put the second color on this square. */
function stockAccent(garment: WearGarment, pattern: 'stripes' | 'blocks', panel: number, r: number, c: number): boolean {
  const sleeve = panel === SLEEVE_LEFT || panel === SLEEVE_RIGHT;
  if (garment === 'jacket') {
    if (pattern === 'stripes') return panel === BODY_PANEL ? r === 1 || r === 3 : r === 1;
    return panel === BODY_PANEL ? r === 0 : sleeve && r < 3;
  }
  if (pattern === 'blocks') return (panel === LEG_LEFT || panel === LEG_RIGHT) && r >= 5;
  // Stripes down the outside of each leg and the seat's sides: the two columns either side of the skier's right (left on the left leg).
  if (panel === LEG_LEFT) return c === 8 || c === 9;
  if (panel === LEG_RIGHT || panel === SEAT_PANEL) return c === 2 || c === 3 || (panel === SEAT_PANEL && (c === 8 || c === 9));
  return false;
}

/** Plaid's darker crossing of two colors, as the rig mixes it (halfway, at 55%). */
function darkHex(a: string, b: string): string {
  const va = parseInt(a.slice(1), 16);
  const vb = parseInt(b.slice(1), 16);
  const ch = (s: number): string => Math.round(((((va >> s) & 255) + ((vb >> s) & 255)) / 2) * 0.55).toString(16).padStart(2, '0');
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

/** The outfit as worn: a custom pattern whose slot was never painted is plain (an online look's, say). */
export function wornOutfit(o: Outfit): Outfit {
  let out = o;
  for (const g of GARMENTS) {
    const p = o[g.pattern];
    if (isCustomPattern(p) && !wearCells(g.id, wearSlot(p))) out = { ...out, [g.pattern]: 'plain' };
  }
  return out;
}

/** Reads the saved slots once (later calls do nothing); anything unreadable leaves that slot never opened. */
export function loadCustomWear(): void {
  if (loaded) return;
  loaded = true;
  readSlots(readStored(KEY), false);
}

/** Writes every slot (if storage works; if not, they last the visit). */
export function saveCustomWear(): void {
  writeStored(KEY, JSON.stringify(wearJson()));
}

/** Every slot as saved (customWear.v1's object): an online look carries it in its `skis` text as `wear`. */
export function wearJson(): Record<Garment, (string | null)[]> {
  return { jacket: slots.jacket.map((c) => (c ? runs(c) : null)), pants: slots.pants.map((c) => (c ? runs(c) : null)) };
}

/**
 * Replaces every slot with an online look's (its `skis` text, read for
 * `wear`) and saves them. A look saved before milestone 23 part 2 has none
 * and leaves this computer's garments as they are; a slot it leaves empty or
 * can't read goes back to never opened. The rig repaints from the new squares
 * once the caller sets the outfit again.
 */
export function setWearText(skisText: string): void {
  if (readSlots(skisText, true)) saveCustomWear();
}

/** How many garment slots an online look's `skis` text has painted. */
export function paintedWear(skisText: string): number {
  const wear = wearOf(skisText);
  if (!wear) return 0;
  return GARMENT_IDS.reduce((n, g) => n + (Array.isArray(wear[g]) ? (wear[g] as unknown[]).filter((s) => typeof s === 'string').length : 0), 0);
}

/** Reads customWear.v1's object (or a look's `wear` in it, `inLook`) into the slots: false when there was none to read. */
function readSlots(text: string | null, inLook: boolean): boolean {
  const saved = inLook ? wearOf(text) : objectOf(parse(text));
  if (!saved) return false;
  for (const garment of GARMENT_IDS) {
    const list = saved[garment];
    for (let slot = 0; slot < WEAR_SLOTS; slot++) {
      const entry = Array.isArray(list) ? (list[slot] as unknown) : null;
      const cells = typeof entry === 'string' ? unruns(entry, wearSize(garment)) : null;
      if (cells) slotCells(garment, slot, 0).set(cells);
      else if (inLook || entry !== undefined) {
        slots[garment][slot] = null;
        setWearArt(garment, wearPattern(slot), null);
      }
    }
  }
  return true;
}

function wearOf(skisText: string | null): Record<string, unknown> | null {
  return objectOf(objectOf(parse(skisText))?.wear);
}

function parse(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function objectOf(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
