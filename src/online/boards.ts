import type { MapId } from '../maps/registry.ts';
import { apiGet, apiSend, ApiError } from './api.ts';
import { RANK_LIMIT, valueInRange, type BoardKind } from './limits.ts';

// The leaderboards: per scoring map the best combo, on the Slalom the best
// time per course, each in a clean board and a "-cheats" twin. Each name
// keeps one entry per board, only ever replaced by a better score. Every
// read and post goes through the leaderboard API (api.ts, the Worker in
// worker/), which checks names, boards and ranges and ranks the entries.
// `?boards=test` uses the test boards instead, for play-tests.

export { RANK_LIMIT, type BoardKind };

export interface BoardDef {
  /** The board's document id (without "-cheats"). */
  id: string;
  map: MapId;
  /** The Slalom course (index into RaceDef.courses) for a time board, else -1. */
  course: number;
  title: string;
  kind: BoardKind;
}

/** In the Leaderboards screen's order (the map select's, the Slalom's two courses where it sits). */
export const BOARDS: readonly BoardDef[] = [
  { id: 'park', map: 'park', course: -1, title: 'Park', kind: 'combo' },
  { id: 'jampark', map: 'jampark', course: -1, title: 'Jam Park', kind: 'combo' },
  { id: 'freeride', map: 'freeride', course: -1, title: 'Freeride', kind: 'combo' },
  { id: 'city', map: 'city', course: -1, title: 'City', kind: 'combo' },
  // slalom.json's courses: 0 is the slalom, 1 the giant slalom.
  { id: 'slalom-sl', map: 'slalom', course: 0, title: 'Slalom', kind: 'time' },
  { id: 'slalom-gs', map: 'slalom', course: 1, title: 'Giant slalom', kind: 'time' },
  { id: 'bigair', map: 'bigair', course: -1, title: 'Big air', kind: 'combo' },
  { id: 'test', map: 'test', course: -1, title: 'Test slope', kind: 'combo' },
];

/** A map's board (on the Slalom, `course`'s; its first course when none). */
export function boardFor(map: MapId, course = -1): BoardDef {
  const own = BOARDS.filter((b) => b.map === map);
  return own.find((b) => b.course === course) ?? own[0] ?? BOARDS[0]!;
}

/** Which of a board's two lists: scores ridden clean, or with cheats on. */
export interface BoardRef {
  board: BoardDef;
  cheats: boolean;
}

export interface Entry {
  name: string;
  look: string;
  /** Points on a combo board, milliseconds on a time board. */
  value: number;
  /** 1 for the best; equal scores share a rank. Infinity: past the counted ranks. */
  rank: number;
}

/** The board's id as the API names it: "park", "slalom-gs-cheats"... */
function boardId(ref: BoardRef): string {
  return `${ref.board.id}${ref.cheats ? '-cheats' : ''}`;
}

/** True when `a` beats `b` on this board (more points, or less time). */
export function beats(ref: BoardRef, a: number, b: number): boolean {
  return ref.board.kind === 'combo' ? a > b : a < b;
}

/** An entry as the API sends it: rank null when it's past RANK_LIMIT. */
interface WireEntry {
  name: string;
  look: string;
  value: number;
  rank: number | null;
}

function toEntry(w: WireEntry): Entry {
  return { name: w.name, look: w.look, value: w.value, rank: w.rank ?? Infinity };
}

/** Top lists fetched in the last few seconds, so flicking between boards doesn't re-read them. */
const cache = new Map<string, { at: number; entries: Entry[] }>();
const CACHE_MS = 20000;

/** The board's best `n` entries, ranked. */
export async function topEntries(ref: BoardRef, n: number): Promise<Entry[]> {
  const key = `${boardId(ref)}#${n}`;
  const hit = cache.get(key);
  if (hit && performance.now() - hit.at < CACHE_MS) return hit.entries;
  const { entries } = await apiGet<{ entries: WireEntry[] }>('/v1/top', { board: boardId(ref), n: String(n) });
  const out = entries.map(toEntry);
  cache.set(key, { at: performance.now(), entries: out });
  return out;
}

/** A name's entry on the board, ranked, or null if it has none. */
export async function entryOf(ref: BoardRef, name: string): Promise<Entry | null> {
  const { entry } = await apiGet<{ entry: WireEntry | null }>('/v1/entry', { board: boardId(ref), name });
  return entry ? toEntry(entry) : null;
}

/** Up to `n` entries whose names start with `prefix` (any case), in name order, ranked. */
export async function searchNames(ref: BoardRef, prefix: string, n: number): Promise<Entry[]> {
  const { entries } = await apiGet<{ entries: WireEntry[] }>('/v1/search', { board: boardId(ref), q: prefix, n: String(n) });
  return entries.map(toEntry);
}

/** What posting did: a new best on the board, or the board's entry for that name was already as good. */
export type PostResult = { posted: true; entry: Entry } | { posted: false; entry: Entry | null };

/**
 * Posts a score under `name`. The API writes it only if it beats the name's
 * entry, and answers with the entry that stands. A score it would refuse (a
 * cheated time under 20 s) isn't sent; a refused one (400) reports nothing posted.
 */
export async function post(ref: BoardRef, name: string, value: number, look: string): Promise<PostResult> {
  if (!valueInRange(ref.board.kind, value)) return { posted: false, entry: null };
  let result: { posted: boolean; entry: WireEntry | null };
  try {
    result = await apiSend('POST', '/v1/post', { board: boardId(ref), name, value: Math.round(value), look });
  } catch (err) {
    if (err instanceof ApiError && err.status === 400) return { posted: false, entry: null };
    throw err;
  }
  if (result.posted) for (const key of cache.keys()) if (key.startsWith(`${boardId(ref)}#`)) cache.delete(key);
  const entry = result.entry ? toEntry(result.entry) : null;
  return result.posted && entry ? { posted: true, entry } : { posted: false, entry };
}
