// A painted jacket or pants (milestone 23 part 2): every face of the
// garment's low-poly body is one square, painted from the editor palette.
// This is the layout both sides agree on: the pieces (panels) of each
// garment, each a grid of squares laid flat as if seen from the front
// (row 0 at the top; column 0 on the viewer's left, so the skier's right),
// and where the editor draws it. A garment's squares are one array of
// palette indices, panel after panel, each row by row. render/skierRig.ts
// paints its faces from it (the garment's own Locker color still colors the
// collar, cuffs, pockets, hood and hem trim); core/customWear.ts keeps the
// slots and saves them; ui/wearEditor.ts paints them. Kept free of imports
// and text: it sits in the chunk the pose gallery shares, and the rig reads
// it per face only when a garment is rebuilt.

export type WearGarment = 'jacket' | 'pants';

/**
 * How many squares each of plaid's faces is cut into, across and down: 2
 * since the user asked for finer painting (each face split 2 × 2 on its own
 * plane, render/skierRig.ts splitPrism). Saved garments of the first form
 * (one square a face) are scaled up as they load (core/customWear.ts).
 */
export const WEAR_SPLIT = 2;

/** One piece: `cols` squares round it (unrolled with its front in the middle), `rows` down it; at (x, y) in the editor's layout, in squares (two rows are left above each piece for its name). */
export interface WearPanel {
  readonly cols: number;
  readonly rows: number;
  readonly x: number;
  readonly y: number;
  /** The panel the left-right mirror maps this one onto (itself for the body and the seat). */
  readonly mirror: number;
}

/**
 * The jacket: the right sleeve, the body all the way round (back, the
 * skier's right side, the front, the left side, back), the left sleeve.
 * The body's rows: the chest shell's two faces (TORSO_BOTTOM up), then the
 * lower jacket's six bands to the hem, each split in two. A sleeve's: the
 * upper arm's three faces from the shoulder, then the forearm's three to
 * the cuff, split in two. Plaid's faces (sides 18 and 10; rows(PLAID_ROW))
 * times WEAR_SPLIT each way.
 */
export const JACKET_PANELS: readonly WearPanel[] = [
  { cols: 20, rows: 12, x: 0, y: 2, mirror: 2 },
  { cols: 36, rows: 16, x: 22, y: 2, mirror: 1 },
  { cols: 20, rows: 12, x: 60, y: 2, mirror: 0 },
];
/** The pants: the seat round the hips, then the right leg and the left, hip to hem (the thigh's five faces, then the shin's five, split in two). */
export const PANTS_PANELS: readonly WearPanel[] = [
  { cols: 24, rows: 4, x: 14, y: 2, mirror: 0 },
  { cols: 24, rows: 20, x: 0, y: 8, mirror: 2 },
  { cols: 24, rows: 20, x: 28, y: 8, mirror: 1 },
];

/** Jacket panels by name. */
export const SLEEVE_RIGHT = 0;
export const BODY_PANEL = 1;
export const SLEEVE_LEFT = 2;
/** Pants panels by name. */
export const SEAT_PANEL = 0;
export const LEG_RIGHT = 1;
export const LEG_LEFT = 2;

export function wearPanels(garment: WearGarment): readonly WearPanel[] {
  return garment === 'jacket' ? JACKET_PANELS : PANTS_PANELS;
}

/** Where each panel's squares start in the garment's array, and the array's length. */
function offsets(panels: readonly WearPanel[]): number[] {
  const out: number[] = [];
  let n = 0;
  for (const p of panels) {
    out.push(n);
    n += p.cols * p.rows;
  }
  out.push(n);
  return out;
}
export const JACKET_OFFSETS: readonly number[] = offsets(JACKET_PANELS);
export const PANTS_OFFSETS: readonly number[] = offsets(PANTS_PANELS);

export function wearOffsets(garment: WearGarment): readonly number[] {
  return garment === 'jacket' ? JACKET_OFFSETS : PANTS_OFFSETS;
}

/** How many squares a garment has. */
export function wearSize(garment: WearGarment): number {
  const o = wearOffsets(garment);
  return o[o.length - 1]!;
}

/** The editor's layout in squares: as wide and tall as its panels reach. */
export function layoutSize(garment: WearGarment): { width: number; height: number } {
  let width = 0;
  let height = 0;
  for (const p of wearPanels(garment)) {
    width = Math.max(width, p.x + p.cols);
    height = Math.max(height, p.y + p.rows);
  }
  return { width, height };
}

/**
 * The trims a painted garment can color on their own (the user's ask): the
 * pants' cuffs (the folds at the hem) and pockets (the cargo pockets and
 * their flaps). The jacket has none; its trims keep its Locker color.
 */
export const WEAR_TRIMS: Record<WearGarment, number> = { jacket: 0, pants: 2 };
export const CUFFS = 0;
export const POCKETS = 1;

/** A painted garment's squares (palette indices), the palette's hex colors, and each trim's palette index (-1: the garment's own Locker color). */
export interface WearArt {
  readonly cells: Uint8Array;
  readonly colors: readonly string[];
  readonly trims: readonly number[];
}

/**
 * The painted garments by pattern id (`custom-1`...), per garment: filled by
 * core/customWear.ts in the game. The pose gallery and the tools fill none
 * (or their own), and a custom pattern with no art paints plain.
 */
const ARTS: Record<WearGarment, Map<string, WearArt>> = { jacket: new Map(), pants: new Map() };

export function wearArt(garment: WearGarment, pattern: string): WearArt | undefined {
  return ARTS[garment].get(pattern);
}

export function setWearArt(garment: WearGarment, pattern: string, art: WearArt | null): void {
  if (art) ARTS[garment].set(pattern, art);
  else ARTS[garment].delete(pattern);
}
