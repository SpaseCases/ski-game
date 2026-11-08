// What the leaderboard API accepts, shared by the game (src/online/) and the
// Cloudflare Worker (worker/src/), so the two can't drift apart. No DOM and
// no imports: the Worker bundles this file as it is.

/** Boards scored by best combo (each also has a "-cheats" twin). */
export const COMBO_BOARDS: readonly string[] = ['park', 'jampark', 'freeride', 'city', 'bigair', 'test'];
/** Boards scored by best time: the Slalom's courses by index (0 the slalom, 1 the giant slalom). */
export const TIME_BOARDS: readonly string[] = ['slalom-sl', 'slalom-gs'];

export type BoardKind = 'combo' | 'time';

/** A board id's kind ("park", "slalom-gs-cheats"...), or null for an unknown board. */
export function boardKind(id: string): BoardKind | null {
  const base = id.endsWith('-cheats') ? id.slice(0, -'-cheats'.length) : id;
  if (COMBO_BOARDS.includes(base)) return 'combo';
  if (TIME_BOARDS.includes(base)) return 'time';
  return null;
}

/** A combo's points: 1 to 10,000,000. */
export const COMBO_MAX = 10_000_000;
/** A course time in ms: 20 s to an hour. */
export const MS_MIN = 20_000;
export const MS_MAX = 3_600_000;

/** Whether `value` can stand on a board of this kind. */
export function valueInRange(kind: BoardKind, value: number): boolean {
  if (!Number.isInteger(value)) return false;
  return kind === 'combo' ? value >= 1 && value <= COMBO_MAX : value >= MS_MIN && value <= MS_MAX;
}

/** How far down a rank is counted; past it a rank shows as "1000+". */
export const RANK_LIMIT = 1000;
/** The most entries one list request returns. */
export const LIST_MAX = 25;

/** The tiny skier's look (src/online/look.ts). */
export const LOOK_FORMAT = /^[a-z0-9]{0,24}$/;

/** A saved look's sizes (nine checkerboard ski slots come to about 30,000 characters). */
export const OUTFIT_MAX = 2000;
export const SKIS_MAX = 50000;
