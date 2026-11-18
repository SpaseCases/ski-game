// What the marketplace (milestone 24) accepts, shared by the game
// (src/online/, src/ui/marketGlue.ts) and the Worker (worker/src/), so the
// two can't drift apart. No DOM and no imports: the Worker bundles this file
// as it is.
//
// An item's `data` is a slot in the game's own save formats: a ski pair or a
// board as one customSkis.v1 / customBoards.v1 slot string, a jacket or
// pants as one customWear.v1 slot string, a whole outfit as JSON
// { outfit: outfit.v1's object, jacket, pants, skis, board } where each of
// the four is the slot it wears (null when that part isn't custom).
//
// The grid sizes below copy core/skis.ts, core/boards.ts and
// render/wearPanels.ts (this file can't import them: see ARCHITECTURE.md's
// chunk splitting); main checks them against the real ones in dev builds.

export const MARKET_KINDS = ['outfit', 'jacket', 'pants', 'skis', 'board'] as const;
export type MarketKind = (typeof MARKET_KINDS)[number];

export function isMarketKind(v: unknown): v is MarketKind {
  return typeof v === 'string' && (MARKET_KINDS as readonly string[]).includes(v);
}

/** Each kind's data, at most this many characters (just above the largest legal save). */
export const DATA_MAX: Record<MarketKind, number> = { outfit: 12000, jacket: 1200, pants: 1200, skis: 6000, board: 1200 };

/** Ski types' grids: rows along one ski, columns across one ski (a slot paints the pair). */
export const SKI_GRIDS: Readonly<Record<string, readonly [number, number]>> = { park: [64, 8], big: [120, 12], carving: [64, 8] };
/** Board types' grids: one board. */
export const BOARD_GRIDS: Readonly<Record<string, readonly [number, number]>> = { park: [40, 12], freeride: [42, 12], carving: [40, 12] };
/** A garment's squares, and how many trims (cuffs, pockets) it can color. */
export const WEAR_SQUARES: Readonly<Record<'jacket' | 'pants', number>> = { jacket: 1056, pants: 1056 };
export const WEAR_TRIM_COUNT: Readonly<Record<'jacket' | 'pants', number>> = { jacket: 0, pants: 2 };
/** core/customSkis.ts EDIT_PALETTE's length: the letters a slot may use. */
export const PALETTE_SIZE = 32;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** A title: 3 to 24 characters of these (and the name's word filter, applied by the caller). */
export const TITLE_MIN = 3;
export const TITLE_MAX = 24;
export const TITLE_FORMAT = /^[A-Za-z0-9 _'!.-]+$/;

/** Items a browse page holds. */
export const PAGE_SIZE = 12;
/** Reports that hide an item, and how many one address may make a day. */
export const REPORTS_HIDE = 5;
export const REPORTS_PER_ADDRESS = 2;
/** A hidden item nobody removed comes back (its reports cleared) after this long. */
export const HIDDEN_DAYS = 7;
/** Uploads a day (UTC) per board name and per network address (a classroom shares one). */
export const UPLOADS_PER_NAME = 10;
export const UPLOADS_PER_ADDRESS = 100;
/** Search: a word's start, 2 to 12 characters. */
export const WORD_MIN = 2;
export const WORD_MAX = 12;
const WORDS_MAX = 80;

/** A title tidied the way the game shows it: spaces squeezed, trimmed. */
export function tidyTitle(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Why a title (already tidied) can't be used, past the word filter: null when fine. */
export function titleProblem(title: string): 'short' | 'long' | 'chars' | null {
  if (title.length < TITLE_MIN) return 'short';
  if (title.length > TITLE_MAX) return 'long';
  if (!TITLE_FORMAT.test(title)) return 'chars';
  return null;
}

/** What a search box's text looks for: its first word's start, lower case (2 to 12 letters or digits), or '' for none. */
export function searchWord(text: string): string {
  const w = text.toLowerCase().split(/[^a-z0-9]+/).find((s) => s.length > 0) ?? '';
  return w.length >= WORD_MIN ? w.slice(0, WORD_MAX) : '';
}

/** The words stored with an item for search: every start (2 to 12 characters) of each word of its title and board name. */
export function searchWords(title: string, name: string): string[] {
  const out = new Set<string>();
  for (const w of `${title} ${name}`.toLowerCase().split(/[^a-z0-9]+/)) {
    for (let n = WORD_MIN; n <= Math.min(w.length, WORD_MAX); n++) out.add(w.slice(0, n));
  }
  return [...out].slice(0, WORDS_MAX);
}

/** How many cells run-length text (customSkis.v1's: "12A" twelve of color 0) holds, or -1 if it isn't that form. */
function runCount(text: string): number {
  let n = 0;
  let k = 0;
  while (k < text.length) {
    let run = 0;
    let digits = 0;
    while (k < text.length && text[k]! >= '0' && text[k]! <= '9') {
      run = run * 10 + Number(text[k++]);
      if (++digits > 5) return -1;
    }
    const color = LETTERS.indexOf(text[k++] ?? '');
    if (color < 0 || color >= PALETTE_SIZE || (digits > 0 && run < 2)) return -1;
    n += Math.max(1, run);
  }
  return n;
}

function letterOk(ch: string | undefined): boolean {
  const i = ch === undefined ? -1 : LETTERS.indexOf(ch);
  return i >= 0 && i < PALETTE_SIZE;
}

/**
 * Whether `text` is one slot of that kind in the game's save format: a ski
 * pair (`type` a ski type) or a board (`type` a board type) as customSkis.v1
 * writes a slot, a jacket or pants as customWear.v1 does (today's squares).
 */
export function slotOk(kind: 'skis' | 'board' | 'jacket' | 'pants', type: string, text: string): boolean {
  if (typeof text !== 'string' || text.length > DATA_MAX[kind]) return false;
  if (kind === 'jacket' || kind === 'pants') {
    const [cells, trims, extra] = text.split('|');
    if (extra !== undefined || runCount(cells ?? '') !== WEAR_SQUARES[kind]) return false;
    if (trims === undefined) return true;
    const n = WEAR_TRIM_COUNT[kind];
    return n > 0 && trims.length === n && [...trims].every((c) => c === '.' || letterOk(c)) && [...trims].some((c) => c !== '.');
  }
  const grid = kind === 'skis' ? SKI_GRIDS[type] : BOARD_GRIDS[type];
  if (!grid || !Object.prototype.hasOwnProperty.call(kind === 'skis' ? SKI_GRIDS : BOARD_GRIDS, type)) return false;
  const cells = grid[0] * grid[1] * (kind === 'skis' ? 2 : 1);
  if (!letterOk(text[0])) return false;
  const link = text[1];
  if (link !== '~' && (kind === 'board' || link !== '=')) return false;
  const [top, base, extra] = text.slice(2).split('/');
  return extra === undefined && runCount(top ?? '') === cells && runCount(base ?? '') === cells;
}

/** An outfit item's data, read: null when it isn't one. */
export interface OutfitData {
  outfit: Record<string, string | boolean>;
  jacket: string | null;
  pants: string | null;
  skis: string | null;
  board: string | null;
}

/**
 * Reads and checks an outfit item's data: outfit.v1's object (short string
 * and boolean values only), and each custom slot it carries in its own
 * format (the skis' on the outfit's ski type, the board's on its board type).
 */
export function readOutfitData(text: string): OutfitData | null {
  if (typeof text !== 'string' || text.length > DATA_MAX.outfit) return null;
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const d = v as Record<string, unknown>;
  const keys = Object.keys(d);
  if (keys.some((k) => !['outfit', 'jacket', 'pants', 'skis', 'board'].includes(k))) return null;
  const o = d.outfit;
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const entries = Object.entries(o as Record<string, unknown>);
  if (entries.length > 40) return null;
  for (const [k, val] of entries) {
    if (k.length > 24 || !/^[A-Za-z]+$/.test(k)) return null;
    if (typeof val === 'boolean') continue;
    if (typeof val !== 'string' || val.length > 40 || !/^[A-Za-z0-9#_-]*$/.test(val)) return null;
  }
  const outfit = o as Record<string, string | boolean>;
  const slot = (key: 'jacket' | 'pants' | 'skis' | 'board', type: string): string | null | undefined => {
    const s = d[key];
    if (s === undefined || s === null) return null;
    return typeof s === 'string' && slotOk(key, type, s) ? s : undefined;
  };
  const jacket = slot('jacket', '');
  const pants = slot('pants', '');
  const skis = slot('skis', String(outfit.ski ?? ''));
  const board = slot('board', String(outfit.board ?? ''));
  if (jacket === undefined || pants === undefined || skis === undefined || board === undefined) return null;
  return { outfit, jacket, pants, skis, board };
}

/** Whether an item's kind, type and data go together. */
export function dataOk(kind: MarketKind, type: string, data: string): boolean {
  if (typeof data !== 'string' || data.length > DATA_MAX[kind]) return false;
  if (kind === 'outfit') return type === '' && readOutfitData(data) !== null;
  if (kind === 'jacket' || kind === 'pants') return type === '' && slotOk(kind, '', data);
  return slotOk(kind, type, data);
}

/** The UTC day a time falls on, as a number (days since 1970). */
export function dayOf(ms: number): number {
  return Math.floor(ms / 86_400_000);
}
