import { SKI_TYPES, skiGraphic, type SkiId } from './skis.ts';
import { readStored, writeStored } from './storage.ts';

// The skier's look, picked in the Locker: a color for each part from one
// shared palette, the headwear, and the skis (type and graphic, see
// core/skis.ts). Saved locally as one versioned JSON entry; anything
// missing, unknown or unreadable falls back to the default, so a wiped or
// blocked storage just means today's look.

/** One shared palette for every part, ordered for the swatch strip: neutrals, then round the color wheel. */
export const PALETTE: readonly { readonly name: string; readonly hex: string }[] = [
  { name: 'Coal', hex: '#2c3037' },
  { name: 'Slate', hex: '#3a3f47' },
  { name: 'Steel', hex: '#4d525b' },
  { name: 'Fog', hex: '#98a2ad' },
  { name: 'Chalk', hex: '#ece8de' },
  { name: 'Sand', hex: '#c8b07e' },
  { name: 'Rust', hex: '#a24a2a' },
  { name: 'Tangerine', hex: '#ff7a1a' },
  { name: 'Lemon', hex: '#f1c93b' },
  { name: 'Lime', hex: '#b8e330' },
  { name: 'Olive', hex: '#677a52' },
  { name: 'Pine', hex: '#2f5a45' },
  { name: 'Teal', hex: '#23898a' },
  { name: 'Glacier', hex: '#8cc9e0' },
  { name: 'Cobalt', hex: '#2f7fe0' },
  { name: 'Navy', hex: '#22395e' },
  { name: 'Plum', hex: '#6a3b74' },
  { name: 'Lilac', hex: '#b3a2dc' },
  { name: 'Bubblegum', hex: '#e2497b' },
  { name: 'Cherry', hex: '#d33a3f' },
];

export type Headwear = 'helmet' | 'santa' | 'pumpkin';
export const HEADWEAR: readonly { readonly id: Headwear; readonly name: string }[] = [
  { id: 'helmet', name: 'Helmet' },
  { id: 'santa', name: 'Santa hat' },
  { id: 'pumpkin', name: "Jack-o'-lantern" },
];

/** The parts with a color, in the Locker's order. */
export type ColorPart = 'helmet' | 'goggleFrame' | 'goggleLens' | 'goggleStrap' | 'jacket' | 'pants' | 'boots' | 'mittens';
export const COLOR_PARTS: readonly { readonly id: ColorPart; readonly name: string }[] = [
  { id: 'helmet', name: 'Helmet' },
  { id: 'goggleFrame', name: 'Goggle frame' },
  { id: 'goggleLens', name: 'Goggle lens' },
  { id: 'goggleStrap', name: 'Goggle strap' },
  { id: 'jacket', name: 'Jacket' },
  { id: 'pants', name: 'Pants' },
  { id: 'boots', name: 'Boots' },
  { id: 'mittens', name: 'Mittens' },
];

export type Outfit = Record<ColorPart, string> & { headwear: Headwear; ski: SkiId; skiGraphic: string };

/** Today's look: matte black helmet and goggles with a smoke lens, a charcoal shell, olive pants, gray boots and mittens, on park skis with lime tips. */
export const DEFAULT_OUTFIT: Readonly<Outfit> = {
  helmet: '#2c3037',
  goggleFrame: '#2c3037',
  goggleLens: '#4d525b',
  goggleStrap: '#2c3037',
  jacket: '#2c3037',
  pants: '#677a52',
  boots: '#4d525b',
  mittens: '#3a3f47',
  headwear: 'helmet',
  ski: 'park',
  skiGraphic: 'park-lime',
};

const KEY = 'outfit.v1';

export function colorName(hex: string): string {
  return PALETTE.find((c) => c.hex === hex)?.name ?? hex;
}

/** The saved outfit, or the default for anything not saved (or not a palette color). */
export function loadOutfit(): Outfit {
  const out: Outfit = { ...DEFAULT_OUTFIT };
  let saved: Record<string, unknown> = {};
  try {
    const raw = readStored(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') saved = parsed as Record<string, unknown>;
  } catch {
    // Corrupt entry: keep the defaults.
  }
  for (const { id } of COLOR_PARTS) {
    const v = saved[id];
    if (typeof v === 'string' && PALETTE.some((c) => c.hex === v)) out[id] = v;
  }
  const hw = saved.headwear;
  if (HEADWEAR.some((h) => h.id === hw)) out.headwear = hw as Headwear;
  const ski = SKI_TYPES.find((s) => s.id === saved.ski);
  if (ski) {
    out.ski = ski.id;
    out.skiGraphic = skiGraphic(ski.id, typeof saved.skiGraphic === 'string' ? saved.skiGraphic : '').id;
  }
  return out;
}

export function saveOutfit(o: Outfit): void {
  writeStored(KEY, JSON.stringify(o));
}
