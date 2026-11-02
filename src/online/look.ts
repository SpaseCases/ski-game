import type { Outfit } from '../core/outfit.ts';

// The skier's look posted with each score and drawn beside the name as a
// tiny figure (20 × 24). A look is 13 characters, one per part: palette
// colors as letters (a is PALETTE[0]), headwear, patterns and the ski type as
// digits. firestore.rules allows [a-z0-9]{0,24}. Anything unreadable draws
// as the default look's color, so a bad or old look never breaks a board.
// The palette and lists come from main (setLookTables): importing
// core/outfit.ts here would split it, with config.ts, into a chunk of its
// own that the first load would then fetch.

/** The lists a look indexes: PALETTE's hex colors, then HEADWEAR, PATTERNS and SKI_TYPES ids, in order. */
export interface LookTables {
  palette: readonly string[];
  headwear: readonly string[];
  patterns: readonly string[];
  skis: readonly string[];
}

let tables: LookTables = { palette: ['#2c3037'], headwear: ['helmet'], patterns: ['plain'], skis: ['park'] };

export function setLookTables(t: LookTables): void {
  tables = t;
}

const PARTS = ['helmet', 'goggleLens', 'gaiter', 'jacket', 'jacketPattern', 'jacketAccent', 'pants', 'pantsPattern', 'pantsAccent', 'boots', 'mittens', 'headwear', 'ski'] as const;
type Part = (typeof PARTS)[number];
function digits(part: Part): readonly string[] | null {
  if (part === 'jacketPattern' || part === 'pantsPattern') return tables.patterns;
  if (part === 'headwear') return tables.headwear;
  if (part === 'ski') return tables.skis;
  return null;
}

export function encodeLook(o: Outfit): string {
  return PARTS.map((part) => {
    const list = digits(part);
    if (list) return String(Math.max(0, list.indexOf(String(o[part]))));
    const i = tables.palette.indexOf(String(o[part]));
    return String.fromCharCode(97 + Math.max(0, i));
  }).join('');
}

interface Look {
  colors: Record<string, string>;
  jacketPattern: string;
  pantsPattern: string;
  headwear: string;
  ski: string;
}

function decode(look: string): Look {
  const colors: Record<string, string> = {};
  const picks: Record<string, string> = {};
  PARTS.forEach((part, i) => {
    const ch = look.charAt(i);
    const list = digits(part);
    if (list) picks[part] = list[Number(ch)] ?? list[0]!;
    else colors[part] = tables.palette[ch.charCodeAt(0) - 97] ?? tables.palette[0]!;
  });
  return { colors, jacketPattern: picks.jacketPattern!, pantsPattern: picks.pantsPattern!, headwear: picks.headwear!, ski: picks.ski! };
}

const PUMPKIN = '#e8761e';
const SKI = '#d5dbe2';

/** The tiny skier for a look, as SVG markup (it holds only colors from the palette, never posted text). */
export function lookSvg(look: string): string {
  const { colors: c, jacketPattern, pantsPattern, headwear, ski } = decode(look);
  const p: string[] = [];
  const rect = (x: number, y: number, w: number, h: number, fill: string): void => {
    p.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`);
  };
  // The skis: longer for the big-mountain ski.
  const half = ski === 'big' ? 9.6 : 8.4;
  rect(10 - half, 22.2, half * 2, 1.4, SKI);
  // A hood sits behind the head, in the jacket's color.
  if (headwear === 'hood') p.push(`<circle cx="10" cy="5" r="4.4" fill="${c.jacket}"/>`);
  // Legs and boots.
  rect(6.9, 15, 2.8, 5.6, c.pants!);
  rect(10.3, 15, 2.8, 5.6, c.pants!);
  if (pantsPattern === 'stripes') {
    rect(6.9, 15, 0.8, 5.6, c.pantsAccent!);
    rect(12.3, 15, 0.8, 5.6, c.pantsAccent!);
  } else if (pantsPattern === 'blocks') {
    rect(6.9, 18, 2.8, 2.6, c.pantsAccent!);
    rect(10.3, 18, 2.8, 2.6, c.pantsAccent!);
  } else if (pantsPattern === 'plaid') {
    rect(6.9, 17.4, 6.2, 0.8, c.pantsAccent!);
  }
  rect(6.6, 20.4, 3.2, 1.8, c.boots!);
  rect(10.2, 20.4, 3.2, 1.8, c.boots!);
  // Arms, mittens, the jacket.
  p.push(`<path d="M6.6 9.2 4.4 14.2M13.4 9.2l2.2 5" stroke="${c.jacket}" stroke-width="2.2" stroke-linecap="round"/>`);
  p.push(`<circle cx="4.3" cy="14.6" r="1.3" fill="${c.mittens}"/><circle cx="15.7" cy="14.6" r="1.3" fill="${c.mittens}"/>`);
  p.push(`<path d="M6.2 9.4Q6.2 8 7.6 8h4.8q1.4 0 1.4 1.4V15.6H6.2z" fill="${c.jacket}"/>`);
  if (jacketPattern === 'stripes') rect(6.2, 11.2, 7.6, 1.4, c.jacketAccent!);
  else if (jacketPattern === 'blocks') rect(10, 8, 3.8, 7.6, c.jacketAccent!);
  else if (jacketPattern === 'plaid') {
    rect(6.2, 11.6, 7.6, 0.8, c.jacketAccent!);
    rect(9.6, 8, 0.8, 7.6, c.jacketAccent!);
  }
  // The head: the gaiter covers the face, the goggles across it.
  p.push(`<circle cx="10" cy="5" r="3.2" fill="${c.gaiter}"/>`);
  const h = c.helmet!;
  switch (headwear) {
    case 'pumpkin':
      p.push(`<circle cx="10" cy="4.8" r="3.9" fill="${PUMPKIN}"/><path d="M8 4.2h1.2M10.8 4.2H12M8.2 6.4q1.8 1.2 3.6 0" stroke="#3a2412" stroke-width="0.8" stroke-linecap="round"/>`);
      break;
    case 'fullface':
      p.push(`<circle cx="10" cy="5" r="3.5" fill="${h}"/>`);
      break;
    case 'beanie':
      p.push(`<path d="M6.8 5C6.8 0.6 13.2 0.6 13.2 5z" fill="${h}"/>`);
      rect(6.6, 3.8, 6.8, 1.3, h);
      break;
    case 'cap':
      p.push(`<path d="M6.8 4.6a3.2 3.2 0 0 1 6.4 0z" fill="${h}"/>`);
      rect(12.6, 3.6, 2.2, 1, h);
      break;
    case 'bucket':
      p.push(`<path d="M7.2 4.4C7.4 1.4 12.6 1.4 12.8 4.4z" fill="${h}"/>`);
      rect(5.4, 3.9, 9.2, 1, h);
      break;
    case 'santa':
      p.push(`<path d="M6.8 4.4C7.6 1.2 11 0.4 15.4 2.2 12.4 2.2 13 3 13.2 4.4z" fill="${h}"/><circle cx="15.6" cy="2.4" r="1" fill="#ece8de"/>`);
      rect(6.6, 3.7, 6.8, 1.2, '#ece8de');
      break;
    case 'hood':
    default:
      p.push(`<path d="M6.8 4.6a3.2 3.2 0 0 1 6.4 0z" fill="${h}"/>`);
  }
  if (headwear !== 'pumpkin') rect(7, 4.6, 6, 1.5, c.goggleLens!);
  return `<svg class="lb-look" viewBox="0 0 20 24" width="20" height="24" aria-hidden="true">${p.join('')}</svg>`;
}
