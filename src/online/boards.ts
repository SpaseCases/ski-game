import type { MapId } from '../maps/registry.ts';
import { nameKey } from '../core/playerName.ts';
import { count, FirestoreError, getDoc, int, num, resourceName, runQuery, setDoc, str, type Doc } from './firestore.ts';

// The leaderboards: per scoring map the best combo, on the Slalom the best
// time per course, each in a clean board and a "-cheats" twin. An entry is
// boards/<board>/names/<name in lower case> (see firestore.rules), so each
// name keeps one entry per board, only ever replaced by a better score.
// `?boards=test` uses testBoards instead, for play-tests.

export type BoardKind = 'combo' | 'time';

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

/** The scores firestore.rules accepts: a combo up to 10,000,000, a time from 20 s to an hour. */
const COMBO_MAX = 10_000_000;
const MS_MIN = 20_000;
const MS_MAX = 3_600_000;

/** How far down a rank is counted (the rules allow queries up to this many). */
export const RANK_LIMIT = 1000;

const ROOT = new URLSearchParams(window.location.search).get('boards') === 'test' ? 'testBoards' : 'boards';

function boardPath(ref: BoardRef): string {
  return `${ROOT}/${ref.board.id}${ref.cheats ? '-cheats' : ''}`;
}

function field(ref: BoardRef): 'combo' | 'ms' {
  return ref.board.kind === 'combo' ? 'combo' : 'ms';
}

/** True when `a` beats `b` on this board (more points, or less time). */
export function beats(ref: BoardRef, a: number, b: number): boolean {
  return ref.board.kind === 'combo' ? a > b : a < b;
}

function toEntry(ref: BoardRef, doc: Doc): Entry | null {
  const f = doc.fields ?? {};
  const name = f.name?.stringValue;
  const value = num(f[field(ref)]);
  if (!name || !Number.isFinite(value)) return null;
  return { name, look: f.look?.stringValue ?? '', value, rank: 0 };
}

/** Top lists fetched in the last few seconds, so flicking between boards doesn't re-read them. */
const cache = new Map<string, { at: number; entries: Entry[] }>();
const CACHE_MS = 20000;

/** The board's best `n` entries, ranked. */
export async function topEntries(ref: BoardRef, n: number): Promise<Entry[]> {
  const key = `${boardPath(ref)}#${n}`;
  const hit = cache.get(key);
  if (hit && performance.now() - hit.at < CACHE_MS) return hit.entries;
  const docs = await runQuery(boardPath(ref), {
    from: [{ collectionId: 'names' }],
    orderBy: [{ field: { fieldPath: field(ref) }, direction: ref.board.kind === 'combo' ? 'DESCENDING' : 'ASCENDING' }],
    limit: n,
  });
  const entries = docs.flatMap((d) => toEntry(ref, d) ?? []);
  entries.forEach((e, i) => (e.rank = i > 0 && entries[i - 1]!.value === e.value ? entries[i - 1]!.rank : i + 1));
  cache.set(key, { at: performance.now(), entries });
  return entries;
}

/** Where a score would rank: one more than the entries that beat it (Infinity past RANK_LIMIT). */
export async function rankOf(ref: BoardRef, value: number): Promise<number> {
  const above = await count(boardPath(ref), {
    from: [{ collectionId: 'names' }],
    where: { fieldFilter: { field: { fieldPath: field(ref) }, op: ref.board.kind === 'combo' ? 'GREATER_THAN' : 'LESS_THAN', value: int(value) } },
    limit: RANK_LIMIT,
  });
  return above >= RANK_LIMIT ? Infinity : above + 1;
}

/** A name's entry on the board, ranked, or null if it has none. */
export async function entryOf(ref: BoardRef, name: string): Promise<Entry | null> {
  const doc = await getDoc(`${boardPath(ref)}/names/${nameKey(name)}`);
  const entry = doc ? toEntry(ref, doc) : null;
  if (entry) entry.rank = await rankOf(ref, entry.value);
  return entry;
}

/** Up to `n` entries whose names start with `prefix` (any case), in name order, ranked. */
export async function searchNames(ref: BoardRef, prefix: string, n: number): Promise<Entry[]> {
  const from = nameKey(prefix);
  const names = `${boardPath(ref)}/names/`;
  const docs = await runQuery(boardPath(ref), {
    from: [{ collectionId: 'names' }],
    where: {
      compositeFilter: {
        op: 'AND',
        filters: [
          { fieldFilter: { field: { fieldPath: '__name__' }, op: 'GREATER_THAN_OR_EQUAL', value: { referenceValue: resourceName(names + from) } } },
          { fieldFilter: { field: { fieldPath: '__name__' }, op: 'LESS_THAN', value: { referenceValue: resourceName(names + from + '') } } },
        ],
      },
    },
    limit: n,
  });
  const entries = docs.flatMap((d) => toEntry(ref, d) ?? []);
  await Promise.all(entries.map(async (e) => (e.rank = await rankOf(ref, e.value))));
  return entries;
}

/** What posting did: a new best on the board, or the board's entry for that name was already as good. */
export type PostResult = { posted: true; entry: Entry } | { posted: false; entry: Entry | null };

/**
 * Posts a score under `name`: read the name's entry first and write only if
 * this beats it (the rules would refuse a worse one anyway, but a refused
 * write shows as an error in the console). Two posts racing for one name
 * can still lose to each other: the refused one reports the entry as kept.
 * A score the rules would refuse (a cheated time under 20 s) isn't sent.
 */
export async function post(ref: BoardRef, name: string, value: number, look: string): Promise<PostResult> {
  const inRange = ref.board.kind === 'combo' ? value >= 1 && value <= COMBO_MAX : value >= MS_MIN && value <= MS_MAX;
  if (!inRange) return { posted: false, entry: null };
  const path = `${boardPath(ref)}/names/${nameKey(name)}`;
  const doc = await getDoc(path);
  const old = doc ? toEntry(ref, doc) : null;
  if (old && !beats(ref, value, old.value)) return { posted: false, entry: old };
  try {
    await setDoc(path, { name: str(name), look: str(look), [field(ref)]: int(value) });
  } catch (err) {
    if (err instanceof FirestoreError && err.status === 403) return { posted: false, entry: old };
    throw err;
  }
  for (const key of cache.keys()) if (key.startsWith(`${boardPath(ref)}#`)) cache.delete(key);
  return { posted: true, entry: { name, look, value, rank: 0 } };
}
