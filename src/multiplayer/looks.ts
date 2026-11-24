import type { Gear } from '../core/customSkis.ts';
import { RIDER_GRAPHICS, skiType, type SkiGraphic } from '../core/skis.ts';
import { boardType } from '../core/boards.ts';
import { GARMENTS, isCustomPattern, outfitFrom, type Outfit } from '../core/outfit.ts';
import { fetchLook } from '../online/looks.ts';
import { setWearArt, type WearGarment } from '../render/wearPanels.ts';

// Other riders' looks (milestone 27). Their outfit comes with them into the
// lobby (outfit.v1's JSON); anything painted (custom skis, a board, a jacket
// or pants) names one of *their* slots, which this computer doesn't have, so
// it's read from the look saved online under their board name (fetched once
// a name per visit, and cached), registered under ids of its own
// (`mp<n>…`, and garment patterns from `custom-1000` up) and worn by their
// rig only. Until it arrives, or if it can't be read, those parts are drawn
// stock (the type's first graphic, a plain garment).

/**
 * The painted-gear readers, from main (core/customSkis.ts, customWear.ts):
 * imported here, those modules would move into the chunk the pose gallery
 * shares (ARCHITECTURE.md, chunk splitting).
 */
export interface PaintKit {
  customId(gear: Gear, slot: number): string;
  boardGear(id: Outfit['board']): Gear;
  graphicFromText(gear: Gear, text: string): SkiGraphic | null;
  /** A painted garment slot read, with its palette (EDIT_PALETTE's colors, then the slot's own hex colors). */
  wearFromText(garment: WearGarment, text: string): { cells: Uint8Array; trims: number[]; colors: readonly string[] } | null;
}
let kit: PaintKit | null = null;
export function setPaintKit(k: PaintKit): void {
  kit = k;
}
/** Each name's saved look text (`skis`), or null when there's none; a pending fetch while it's coming. */
const fetched = new Map<string, Promise<string | null>>();

/** What a rider's look registered, to free when they leave. */
export interface WornLook {
  outfit: Outfit;
  graphics: string[];
  patterns: { garment: WearGarment; pattern: string }[];
}

/** A rider's outfit as sent, its painted parts made stock (drawn until the paint arrives). */
export function stockLook(outfitJson: string): Outfit {
  const o = outfitFrom(outfitJson);
  const out: Outfit = { ...o };
  if (!skiType(o.ski).graphics.some((g) => g.id === o.skiGraphic)) out.skiGraphic = skiType(o.ski).graphics[0]!.id;
  if (!boardType(o.board).graphics.some((g) => g.id === o.boardGraphic)) out.boardGraphic = boardType(o.board).graphics[0]!.id;
  for (const g of GARMENTS) if (isCustomPattern(o[g.pattern])) out[g.pattern] = 'plain';
  return out;
}

/** Whether the outfit wears anything painted (so its look is worth fetching). */
export function paints(outfitJson: string): boolean {
  const o = outfitFrom(outfitJson);
  return (
    !skiType(o.ski).graphics.some((g) => g.id === o.skiGraphic) ||
    (o.ride === 'board' && !boardType(o.board).graphics.some((g) => g.id === o.boardGraphic)) ||
    GARMENTS.some((g) => isCustomPattern(o[g.pattern]))
  );
}

/** The saved look's `skis` text for a name (fetched once a visit), or null. */
export function lookText(name: string): Promise<string | null> {
  const key = name.toLowerCase();
  let p = fetched.get(key);
  if (!p) {
    p = fetchLook(name).then(
      (look) => look?.skis ?? null,
      () => {
        fetched.delete(key);
        return null;
      },
    );
    fetched.set(key, p);
  }
  return p;
}

/**
 * The outfit as `n`'s rig wears it with the painted parts read from their
 * saved look (`skisText`): each registered under this rider's own ids.
 */
export function paintedLook(outfitJson: string, skisText: string | null, n: number): WornLook {
  const o = outfitFrom(outfitJson);
  const out: Outfit = stockLook(outfitJson);
  const worn: WornLook = { outfit: out, graphics: [], patterns: [] };
  const saved = parse(skisText);
  if (!saved || !kit) return worn;
  const { customId, boardGear, graphicFromText, wearFromText } = kit;
  const slotOf = (gear: Gear, id: string): number => [0, 1, 2].find((s) => customId(gear, s) === id) ?? -1;
  // Skis: customSkis.v1's lists by ski type.
  const skiSlot = slotOf(o.ski, o.skiGraphic);
  const skiText = skiSlot >= 0 ? listAt(saved[o.ski], skiSlot) : null;
  const ski = skiText ? graphicFromText(o.ski, skiText) : null;
  if (ski) {
    const id = `mp${n}s`;
    RIDER_GRAPHICS.set(id, { ...ski, id });
    out.skiGraphic = id;
    worn.graphics.push(id);
  }
  // A board: the `boards` object, by board type.
  const gear = boardGear(o.board);
  const boardSlot = slotOf(gear, o.boardGraphic);
  const boards = saved.boards && typeof saved.boards === 'object' ? (saved.boards as Record<string, unknown>) : null;
  const boardText = boardSlot >= 0 && boards ? listAt(boards[o.board], boardSlot) : null;
  const board = boardText ? graphicFromText(gear, boardText) : null;
  if (board) {
    const id = `mp${n}b`;
    RIDER_GRAPHICS.set(id, { ...board, id });
    out.boardGraphic = id;
    worn.graphics.push(id);
  }
  // Garments: the `wear` object, by garment.
  const wear = saved.wear && typeof saved.wear === 'object' ? (saved.wear as Record<string, unknown>) : null;
  GARMENTS.forEach((g, gi) => {
    const p = o[g.pattern];
    if (!isCustomPattern(p) || !wear) return;
    const slot = Number(p.slice('custom-'.length)) - 1;
    const text = listAt(wear[g.id], slot);
    const read = text ? wearFromText(g.id, text) : null;
    if (!read) return;
    const pattern = `custom-${1000 + n * 2 + gi}`;
    setWearArt(g.id, pattern, { cells: read.cells, colors: read.colors, trims: read.trims });
    out[g.pattern] = pattern as Outfit['jacketPattern'];
    worn.patterns.push({ garment: g.id, pattern });
  });
  return worn;
}

/** Frees what a rider's look registered. */
export function freeLook(worn: WornLook): void {
  for (const id of worn.graphics) RIDER_GRAPHICS.delete(id);
  for (const p of worn.patterns) setWearArt(p.garment, p.pattern, null);
}

function parse(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const v: unknown = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function listAt(list: unknown, slot: number): string | null {
  const v = Array.isArray(list) ? (list[slot] as unknown) : null;
  return typeof v === 'string' ? v : null;
}
