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

/** One piece: `cols` squares round it (unrolled with its front in the middle), `rows` down it; at (x, y) in the editor's layout, in squares (a row is left above each piece for its name). */
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
 * The body's rows: the chest shell's two (TORSO_BOTTOM up), then the lower
 * jacket's six bands to the hem. A sleeve's: the upper arm's three from the
 * shoulder, then the forearm's three to the cuff. Their sizes are plaid's
 * faces (sides 18 and 10; rows(PLAID_ROW)), so a painted garment has
 * exactly plaid's triangles.
 */
export const JACKET_PANELS: readonly WearPanel[] = [
  { cols: 10, rows: 6, x: 0, y: 1, mirror: 2 },
  { cols: 18, rows: 8, x: 11, y: 1, mirror: 1 },
  { cols: 10, rows: 6, x: 30, y: 1, mirror: 0 },
];
/** The pants: the seat round the hips, then the right leg and the left, hip to hem (the thigh's five rows, then the shin's five). */
export const PANTS_PANELS: readonly WearPanel[] = [
  { cols: 12, rows: 2, x: 7, y: 1, mirror: 0 },
  { cols: 12, rows: 10, x: 0, y: 4, mirror: 2 },
  { cols: 12, rows: 10, x: 14, y: 4, mirror: 1 },
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

/** A painted garment's squares (palette indices) and the palette's hex colors. */
export interface WearArt {
  readonly cells: Uint8Array;
  readonly colors: readonly string[];
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
