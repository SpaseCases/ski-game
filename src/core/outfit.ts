import { SKI_TYPES, skiGraphic, type SkiId } from './skis.ts';
import { readStored, writeStored } from './storage.ts';

// The skier's look, picked in the Locker: a color for each part from one
// shared palette, the headwear, a pattern for the jacket and the pants (in a
// second palette color), the skis (type and graphic, see core/skis.ts) and
// whether the skier carries poles. Saved locally as one versioned JSON entry; anything
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

export type Headwear = 'helmet' | 'beanie' | 'cap' | 'bucket' | 'hood' | 'santa' | 'pumpkin';
export const HEADWEAR: readonly { readonly id: Headwear; readonly name: string }[] = [
  { id: 'helmet', name: 'Helmet' },
  { id: 'beanie', name: 'Beanie' },
  { id: 'cap', name: 'Cap' },
  { id: 'bucket', name: 'Bucket hat' },
  { id: 'hood', name: 'Hood up' },
  { id: 'santa', name: 'Santa hat' },
  { id: 'pumpkin', name: "Jack-o'-lantern" },
];

/** A garment's pattern, painted in its second color. */
export type Pattern = 'plain' | 'stripes' | 'blocks' | 'camo' | 'plaid';
export const PATTERNS: readonly { readonly id: Pattern; readonly name: string }[] = [
  { id: 'plain', name: 'Plain' },
  { id: 'stripes', name: 'Stripes' },
  { id: 'blocks', name: 'Blocks' },
  { id: 'camo', name: 'Camo' },
  { id: 'plaid', name: 'Plaid' },
];
/** The garments that take a pattern, and the outfit keys of their pattern and second color. */
export const GARMENTS = [
  { id: 'jacket', name: 'Jacket', pattern: 'jacketPattern', accent: 'jacketAccent' },
  { id: 'pants', name: 'Pants', pattern: 'pantsPattern', accent: 'pantsAccent' },
] as const;
export type Garment = (typeof GARMENTS)[number]['id'];

/** The parts with a color, in the Locker's order. */
export type ColorPart = 'helmet' | 'goggleFrame' | 'goggleLens' | 'goggleStrap' | 'gaiter' | 'jacket' | 'pants' | 'boots' | 'mittens';
export const COLOR_PARTS: readonly { readonly id: ColorPart; readonly name: string }[] = [
  { id: 'helmet', name: 'Helmet / hat' },
  { id: 'goggleFrame', name: 'Goggle frame' },
  { id: 'goggleLens', name: 'Goggle lens' },
  { id: 'goggleStrap', name: 'Goggle strap' },
  { id: 'gaiter', name: 'Neck gaiter' },
  { id: 'jacket', name: 'Jacket' },
  { id: 'pants', name: 'Pants' },
  { id: 'boots', name: 'Boots' },
  { id: 'mittens', name: 'Mittens' },
];

export type Outfit = Record<ColorPart, string> & {
  headwear: Headwear;
  jacketPattern: Pattern;
  jacketAccent: string;
  pantsPattern: Pattern;
  pantsAccent: string;
  ski: SkiId;
  skiGraphic: string;
  poles: boolean;
};

/** Today's look: matte black helmet, goggles and neck gaiter with a smoke lens, a plain charcoal shell, plain olive pants, gray boots and mittens, on park skis with lime tips, with poles. */
export const DEFAULT_OUTFIT: Readonly<Outfit> = {
  helmet: '#2c3037',
  goggleFrame: '#2c3037',
  goggleLens: '#4d525b',
  goggleStrap: '#2c3037',
  gaiter: '#2c3037',
  jacket: '#2c3037',
  pants: '#677a52',
  boots: '#4d525b',
  mittens: '#3a3f47',
  headwear: 'helmet',
  jacketPattern: 'plain',
  jacketAccent: '#ece8de',
  pantsPattern: 'plain',
  pantsAccent: '#ece8de',
  ski: 'park',
  skiGraphic: 'park-lime',
  poles: true,
};

const KEY = 'outfit.v1';

export function colorName(hex: string): string {
  return PALETTE.find((c) => c.hex === hex)?.name ?? hex;
}

/** A palette color that stands out on `hex`: Chalk on a dark color, Coal on a light one. */
export function contrastColor(hex: string): string {
  const v = parseInt(hex.slice(1), 16);
  const lum = 0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255);
  return lum < 128 ? '#ece8de' : '#2c3037';
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
  for (const g of GARMENTS) {
    const pattern = saved[g.pattern];
    if (PATTERNS.some((p) => p.id === pattern)) out[g.pattern] = pattern as Pattern;
    const accent = saved[g.accent];
    out[g.accent] = typeof accent === 'string' && PALETTE.some((c) => c.hex === accent) ? accent : contrastColor(out[g.id]);
  }
  if (typeof saved.poles === 'boolean') out.poles = saved.poles;
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
