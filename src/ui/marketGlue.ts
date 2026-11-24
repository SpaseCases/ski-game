import { BOARD_TYPES, boardType } from '../core/boards.ts';
import { boardGear, customGraphic, customId, gearBoard, gearType, graphicFromText, setSlotText, slotHasOwnColor, slotText, type Gear } from '../core/customSkis.ts';
import { setWearSlotText, wearCells, wearFromText, wearHasOwnColor, wearPalette, wearPattern, wearSlot, wearSlotText, wornOutfit } from '../core/customWear.ts';
import { GARMENTS, isCustomPattern, outfitFrom, type Garment, type Outfit } from '../core/outfit.ts';
import { CUSTOM_SLOTS, SKI_TYPES, skiType, type SkiId } from '../core/skis.ts';
import type { MarketItem } from '../online/market.ts';
import type { SlotPick } from './marketPanel.ts';
import type { ShareRequest } from './marketSigns.ts';
import { wearOffsets, wearPanels } from '../render/wearPanels.ts';
import { paintSkis } from './skiThumb.ts';
import { drawWear } from './wearGrid.ts';

// The marketplace's game side (milestone 24), in main's chunk: the online
// chunk can't import the save formats or the painters (see ARCHITECTURE.md's
// chunk splitting), so main hands it these through MarketHooks. Thumbnails
// are drawn once per card with the Locker's painters; sharing reads one
// slot (or the outfit and the custom slots it wears) as the game saves it;
// Use writes an item into a free slot on this computer (or one the player
// picks to paint over), saves it, and wears it. An item this game can't read
// throws, and nothing changes.

export interface GlueHooks {
  outfit: () => Outfit;
  setOutfit: (o: Outfit) => void;
  /** A custom ski or board slot changed: rebuild the 3D skis or board. */
  skisChanged: () => void;
  /** A garment slot changed: rebuild that garment. */
  wearChanged: (garment: Garment) => void;
  /** The Locker's custom slots changed (their thumbnails). */
  slotsChanged: () => void;
}

/** Thumbnails' scale, canvas pixels a meter (the longest ski is about 160 px). */
const PX_PER_M = 84;
const BOARD_MAX_HALF = Math.max(...BOARD_TYPES.flatMap((t) => t.model.width.map(([, hw]) => hw)));
const WEAR_PX = 2;
const EMPTY = '#2b5582';

type SlotKind = 'skis' | 'board' | 'jacket' | 'pants';

/** The gear a ski or board item goes on, or null for a type this game doesn't have. */
function gearOf(kind: 'skis' | 'board', type: string): Gear | null {
  if (kind === 'skis') return SKI_TYPES.some((t) => t.id === type) ? (type as SkiId) : null;
  const b = BOARD_TYPES.find((t) => t.id === type);
  return b ? boardGear(b.id) : null;
}

function gearName(gear: Gear): string {
  return gearBoard(gear) ? `${gearType(gear).name} board` : `${gearType(gear).name} skis`;
}

function paintGear(canvas: HTMLCanvasElement, gear: Gear, g: Parameters<typeof paintSkis>[2], base = false): void {
  const board = gearBoard(gear);
  if (board) paintSkis(canvas, boardType(board), g, base, PX_PER_M, [1], BOARD_MAX_HALF);
  else paintSkis(canvas, skiType(gear as SkiId), g, base, PX_PER_M);
}

const EMPTY_GRAPHIC = { id: 'empty', name: 'Empty', base: EMPTY, layers: [{ fill: EMPTY }] };

/** A ski, board or garment item's thumbnail (an outfit's is drawn by the online chunk); a "?" when this game can't read it. */
export function marketThumb(it: MarketItem): HTMLElement {
  const canvas = document.createElement('canvas');
  if (it.kind === 'skis' || it.kind === 'board') {
    const gear = gearOf(it.kind, it.type);
    const g = gear ? graphicFromText(gear, it.data) : null;
    if (gear && g) {
      // The top sheets and the bases, both drawn: the Market's Top / Base switch shows one (market.css).
      paintGear(canvas, gear, g);
      canvas.className = 'mk-face-top';
      const base = document.createElement('canvas');
      base.className = 'mk-face-base';
      paintGear(base, gear, g, true);
      const faces = document.createElement('span');
      faces.className = 'mk-faces';
      faces.append(canvas, base);
      return faces;
    }
  } else if (it.kind === 'jacket' || it.kind === 'pants') {
    const read = wearFromText(it.kind, it.data);
    if (read) {
      drawWear(canvas, wearPanels(it.kind), wearOffsets(it.kind), read.cells, read.colors, WEAR_PX, EMPTY);
      return canvas;
    }
  }
  const unknown = document.createElement('span');
  unknown.className = 'mk-unknown';
  unknown.textContent = '?';
  return unknown;
}

export function marketDescribe(it: MarketItem): string {
  if (it.kind === 'skis' || it.kind === 'board') {
    const gear = gearOf(it.kind, it.type);
    return gear ? gearName(gear) : it.kind === 'skis' ? 'Skis' : 'Board';
  }
  return it.kind === 'jacket' ? 'Jacket' : it.kind === 'pants' ? 'Pants' : 'Outfit';
}

/**
 * What the share sign says under an item painted with colors of its own
 * (hex codes, 2026-11-24): the marketplace's Worker takes only the editor
 * palette's colors, so a share carries the nearest of them instead.
 */
const OWN_COLOR_NOTE = ' Your own hex colors share as the nearest palette colors.';

/**
 * One painted slot to share (from an editor or the Locker), or null while
 * it's never been painted. Its own hex colors go as the nearest palette
 * colors (`plain`), and the thumbnail is drawn from what's sent.
 */
export function slotShare(kind: SlotKind, gearOrGarment: Gear | Garment, slot: number): ShareRequest | null {
  if (kind === 'jacket' || kind === 'pants') {
    const data = wearSlotText(kind, slot, true);
    const read = data ? wearFromText(kind, data) : null;
    if (!data || !read) return null;
    const canvas = document.createElement('canvas');
    drawWear(canvas, wearPanels(kind), wearOffsets(kind), read.cells, read.colors, WEAR_PX, EMPTY);
    const note = wearHasOwnColor(kind, slot) ? `.${OWN_COLOR_NOTE}` : '';
    return { kind, type: '', data, look: '', what: `${kind === 'jacket' ? 'Jacket' : 'Pants'}: Custom ${slot + 1}${note}`, thumb: canvas };
  }
  const gear = gearOrGarment as Gear;
  const data = slotText(gear, slot, true);
  const g = data ? graphicFromText(gear, data) : null;
  if (!data || !g) return null;
  const canvas = document.createElement('canvas');
  paintGear(canvas, gear, g);
  const board = gearBoard(gear);
  const note = slotHasOwnColor(gear, slot) ? `.${OWN_COLOR_NOTE}` : '';
  return { kind: board ? 'board' : 'skis', type: board ?? gear, data, look: '', what: `${gearName(gear)}: Custom ${slot + 1}${note}`, thumb: canvas };
}

/** The slot a worn custom ski or board graphic names (customId's "custom-<gear>-<n>"), or -1. */
function graphicSlot(gear: Gear, graphic: string): number {
  for (let slot = 0; slot < CUSTOM_SLOTS; slot++) if (customId(gear, slot) === graphic) return slot;
  return -1;
}

/** The outfit worn now and the custom slots it wears, to share (the caller adds the look code and the thumbnail). */
export function outfitShare(o: Outfit): Omit<ShareRequest, 'thumb' | 'look'> {
  let own = false;
  const garment = (g: Garment): string | null => {
    const p = o[GARMENTS.find((x) => x.id === g)!.pattern];
    if (!isCustomPattern(p)) return null;
    own ||= wearHasOwnColor(g, wearSlot(p));
    return wearSlotText(g, wearSlot(p), true);
  };
  const skiSlot = graphicSlot(o.ski, o.skiGraphic);
  const boardSlot = graphicSlot(boardGear(o.board), o.boardGraphic);
  const data = {
    outfit: o,
    jacket: garment('jacket'),
    pants: garment('pants'),
    skis: skiSlot >= 0 ? slotText(o.ski, skiSlot, true) : null,
    board: boardSlot >= 0 ? slotText(boardGear(o.board), boardSlot, true) : null,
  };
  if (skiSlot >= 0) own ||= slotHasOwnColor(o.ski, skiSlot);
  if (boardSlot >= 0) own ||= slotHasOwnColor(boardGear(o.board), boardSlot);
  const painted = [data.jacket, data.pants, data.skis, data.board].filter((x) => x).length;
  const what = painted ? `Your outfit, with ${painted} painted part${painted === 1 ? '' : 's'}` : 'Your outfit';
  return { kind: 'outfit', type: '', data: JSON.stringify(data), what: own ? `${what}.${OWN_COLOR_NOTE}` : what };
}

/** A free slot of that gear or garment, or (all painted) one the player picks to paint over; null when they cancel. */
async function slotFor(kind: SlotKind, gear: Gear | null, pick: SlotPick): Promise<number | null> {
  const thumbs: HTMLElement[] = [];
  for (let slot = 0; slot < CUSTOM_SLOTS; slot++) {
    const painted = kind === 'jacket' || kind === 'pants' ? wearCells(kind, slot) !== null : customGraphic(gear!, slot) !== null;
    if (!painted) return slot;
    const canvas = document.createElement('canvas');
    if (kind === 'jacket' || kind === 'pants') drawWear(canvas, wearPanels(kind), wearOffsets(kind), wearCells(kind, slot), wearPalette(kind, slot), WEAR_PX, EMPTY);
    else paintGear(canvas, gear!, customGraphic(gear!, slot) ?? EMPTY_GRAPHIC);
    thumbs.push(canvas);
  }
  const what = kind === 'jacket' ? 'jacket' : kind === 'pants' ? 'pants' : gearBoard(gear!) ? `${gearType(gear!).name} board` : `${gearType(gear!).name} ski`;
  return pick(what, thumbs);
}

/** Copies an item into this computer's slots and wears it; what it did, or null when the player cancelled. Throws when it can't be read. */
export async function useItem(it: MarketItem, pick: SlotPick, h: GlueHooks): Promise<string | null> {
  if (it.kind === 'skis' || it.kind === 'board') {
    const gear = gearOf(it.kind, it.type);
    if (!gear || !graphicFromText(gear, it.data)) throw new Error('unreadable');
    const slot = await slotFor(it.kind, gear, pick);
    if (slot === null) return null;
    setSlotText(gear, slot, it.data);
    h.skisChanged();
    const board = gearBoard(gear);
    const o = h.outfit();
    h.setOutfit(board ? { ...o, ride: 'board', board, boardGraphic: customId(gear, slot) } : { ...o, ride: 'skis', ski: gear as SkiId, skiGraphic: customId(gear, slot) });
    h.slotsChanged();
    return `In your ${gearName(gear)} Custom ${slot + 1}, and on your feet.`;
  }
  if (it.kind === 'jacket' || it.kind === 'pants') {
    const garment = it.kind;
    if (!wearFromText(garment, it.data)) throw new Error('unreadable');
    const slot = await slotFor(garment, null, pick);
    if (slot === null) return null;
    setWearSlotText(garment, slot, it.data);
    h.wearChanged(garment);
    const g = GARMENTS.find((x) => x.id === garment)!;
    h.setOutfit({ ...h.outfit(), [g.pattern]: wearPattern(slot) });
    h.slotsChanged();
    return `In your ${garment === 'jacket' ? 'Jacket' : 'Pants'} Custom ${slot + 1}, and wearing it.`;
  }
  return useOutfit(it, pick, h);
}

async function useOutfit(it: MarketItem, pick: SlotPick, h: GlueHooks): Promise<string | null> {
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(it.data) as Record<string, unknown>;
  } catch {
    throw new Error('unreadable');
  }
  const raw = d.outfit;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('unreadable');
  const rawOutfit = raw as Record<string, unknown>;
  // The outfit read once for its ski and board types (where the graphics go).
  const types = outfitFrom(JSON.stringify(rawOutfit));
  const text = (k: string): string | null => (typeof d[k] === 'string' ? (d[k] as string) : null);
  const pieces: { kind: SlotKind; gear: Gear | null; text: string }[] = [];
  for (const g of ['jacket', 'pants'] as const) {
    const t = text(g);
    if (t !== null) {
      if (!wearFromText(g, t)) throw new Error('unreadable');
      pieces.push({ kind: g, gear: null, text: t });
    }
  }
  const skis = text('skis');
  if (skis !== null) {
    if (!graphicFromText(types.ski, skis)) throw new Error('unreadable');
    pieces.push({ kind: 'skis', gear: types.ski, text: skis });
  }
  const boardText = text('board');
  const bGear = boardGear(types.board);
  if (boardText !== null) {
    if (!graphicFromText(bGear, boardText)) throw new Error('unreadable');
    pieces.push({ kind: 'board', gear: bGear, text: boardText });
  }
  // Every slot is settled before anything is written, so Cancel leaves everything as it was.
  const slots: number[] = [];
  for (const p of pieces) {
    const slot = await slotFor(p.kind, p.gear, pick);
    if (slot === null) return null;
    slots.push(slot);
  }
  const at = new Map<SlotKind, number>();
  pieces.forEach((p, i) => {
    const slot = slots[i]!;
    at.set(p.kind, slot);
    if (p.kind === 'jacket' || p.kind === 'pants') {
      setWearSlotText(p.kind, slot, p.text);
      h.wearChanged(p.kind);
    } else {
      setSlotText(p.gear!, slot, p.text);
    }
  });
  if (at.has('skis') || at.has('board')) h.skisChanged();
  // The outfit read again now its graphics are in their slots, then pointed at the slots they went to; a custom part it didn't carry is plain (or the type's first graphic).
  const o = outfitFrom(JSON.stringify(rawOutfit));
  for (const g of GARMENTS) {
    const slot = at.get(g.id);
    if (slot !== undefined) o[g.pattern] = wearPattern(slot);
    else if (isCustomPattern(o[g.pattern])) o[g.pattern] = 'plain';
  }
  const skiSlot = at.get('skis');
  if (skiSlot !== undefined) o.skiGraphic = customId(o.ski, skiSlot);
  else if (String(rawOutfit.skiGraphic ?? '').startsWith('custom-')) o.skiGraphic = skiType(o.ski).graphics[0]!.id;
  const boardSlot = at.get('board');
  if (boardSlot !== undefined) o.boardGraphic = customId(bGear, boardSlot);
  else if (String(rawOutfit.boardGraphic ?? '').startsWith('custom-')) o.boardGraphic = boardType(o.board).graphics[0]!.id;
  h.setOutfit(wornOutfit(o));
  h.slotsChanged();
  return pieces.length ? `Wearing it. Its ${pieces.length === 1 ? 'painted part is' : `${pieces.length} painted parts are`} in your Custom slots.` : 'Wearing it.';
}
