import { boardKind, RANK_LIMIT } from '../../src/online/limits.ts';

// Where the boards and looks live. FirestoreStore (firestore.ts) is the real
// one; MemoryStore below is for `npm run dev`, so the game can be play-tested
// against a local Worker with no Google key. Every board is one of
// src/online/limits.ts's ids; keys are names in lower case.

/** One name's entry on a board. */
export interface Row {
  name: string;
  look: string;
  /** Points on a combo board, ms on a time board. */
  value: number;
}

/** A row as read, with what a guarded write needs to know it hasn't changed since. */
export interface ReadRow {
  row: Row;
  /** The store's version of the entry (Firestore's updateTime). */
  version: string;
}

export interface Look {
  name: string;
  outfit: string;
  skis: string;
}

export interface Store {
  entry(board: string, key: string): Promise<ReadRow | null>;
  /**
   * Writes an entry only if it's unchanged since it was read (`version`;
   * null: only if there's none yet). False when someone else wrote first.
   */
  putEntry(board: string, key: string, row: Row, version: string | null): Promise<boolean>;
  /** The best `n` entries. */
  top(board: string, n: number): Promise<Row[]>;
  /** How many entries beat `value`, counted up to RANK_LIMIT. */
  better(board: string, value: number): Promise<number>;
  /** Up to `n` entries whose key starts with `prefix`, in key order. */
  search(board: string, prefix: string, n: number): Promise<Row[]>;
  look(key: string): Promise<Look | null>;
  putLook(key: string, look: Look): Promise<void>;
}

/** True when `a` beats `b` on this board (more points, or less time). */
export function beats(board: string, a: number, b: number): boolean {
  return boardKind(board) === 'time' ? a < b : a > b;
}

/** Everything in this Worker's memory: lost on restart. For local play-tests only. */
export class MemoryStore implements Store {
  private readonly boards = new Map<string, Map<string, { row: Row; version: number }>>();
  private readonly looks = new Map<string, Look>();
  private clock = 0;

  private board(id: string): Map<string, { row: Row; version: number }> {
    let b = this.boards.get(id);
    if (!b) this.boards.set(id, (b = new Map()));
    return b;
  }

  async entry(board: string, key: string): Promise<ReadRow | null> {
    const e = this.board(board).get(key);
    return e ? { row: { ...e.row }, version: String(e.version) } : null;
  }

  async putEntry(board: string, key: string, row: Row, version: string | null): Promise<boolean> {
    const b = this.board(board);
    const now = b.get(key);
    if ((now ? String(now.version) : null) !== version) return false;
    b.set(key, { row: { ...row }, version: ++this.clock });
    return true;
  }

  async top(board: string, n: number): Promise<Row[]> {
    const rows = [...this.board(board).values()].map((e) => e.row);
    rows.sort((a, b) => (beats(board, a.value, b.value) ? -1 : beats(board, b.value, a.value) ? 1 : 0));
    return rows.slice(0, n);
  }

  async better(board: string, value: number): Promise<number> {
    let n = 0;
    for (const e of this.board(board).values()) if (beats(board, e.row.value, value) && ++n >= RANK_LIMIT) break;
    return n;
  }

  async search(board: string, prefix: string, n: number): Promise<Row[]> {
    const keys = [...this.board(board).keys()].filter((k) => k.startsWith(prefix)).sort();
    return keys.slice(0, n).map((k) => this.board(board).get(k)!.row);
  }

  async look(key: string): Promise<Look | null> {
    return this.looks.get(key) ?? null;
  }

  async putLook(key: string, look: Look): Promise<void> {
    this.looks.set(key, { ...look });
  }
}
