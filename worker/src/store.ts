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

/** A marketplace item as stored (milestone 24; worker/src/market.ts). */
export interface MarketItem {
  /** 12 letters and digits, made by the Worker. */
  id: string;
  kind: string;
  /** The ski or board type of a ski or board graphic, else ''. */
  type: string;
  title: string;
  /** The board name it was shared under. */
  name: string;
  /** When it was shared, ms since 1970. */
  created: number;
  uses: number;
  /** One per report: a salted hash of the address and the UTC day ("hash:day"); never the address. */
  reports: string[];
  hidden: boolean;
  /** When the reports hid it (0 while shown). */
  hiddenAt: number;
  /** The slot or outfit in the game's own save formats (src/online/marketRules.ts). */
  data: string;
  /** An outfit's 16-character look (src/online/look.ts), else ''. */
  look: string;
  /** Every start of every word of the title and name, for search. */
  words: string[];
}

/** A browse page: shown items only, newest or most used first, after a cursor (the last item's sort values). */
export interface MarketQuery {
  kind: string | null;
  sort: 'new' | 'used';
  word: string | null;
  /** new: [created, id]; used: [uses, created, id]. */
  after: (number | string)[] | null;
  n: number;
}

/** A daily upload count as read: what a guarded write needs. */
export interface Counter {
  key: string;
  count: number;
  /** null when there's none yet. */
  version: string | null;
}

export interface Read<T> {
  item: T;
  version: string;
}

export interface Store {
  marketPage(q: MarketQuery): Promise<MarketItem[]>;
  marketItem(id: string): Promise<Read<MarketItem> | null>;
  /** Replaces an item only if unchanged since read. False when someone else wrote first (or it's gone). */
  putMarketItem(item: MarketItem, version: string): Promise<boolean>;
  /** Adds one to an item's uses; the new count, or null when there's no such item. */
  marketUse(id: string): Promise<number | null>;
  deleteMarketItem(id: string): Promise<void>;
  /** Hidden items, longest hidden first; with `before`, only those hidden before then. */
  marketHidden(n: number, before?: number): Promise<Read<MarketItem>[]>;
  /** Today's upload counts for these keys (0 for none yet). */
  counters(keys: string[]): Promise<Counter[]>;
  /** Writes a new item and each counter one higher, all or nothing, if no counter changed since read. */
  createMarketItem(item: MarketItem, counters: Counter[]): Promise<boolean>;

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
  private readonly market = new Map<string, { item: MarketItem; version: number }>();
  private readonly days = new Map<string, { count: number; version: number }>();
  private clock = 0;

  async marketPage(q: MarketQuery): Promise<MarketItem[]> {
    const key = (it: MarketItem): (number | string)[] => (q.sort === 'new' ? [it.created, it.id] : [it.uses, it.created, it.id]);
    const items = [...this.market.values()]
      .map((e) => e.item)
      .filter((it) => !it.hidden && (q.kind === null || it.kind === q.kind) && (q.word === null || it.words.includes(q.word)))
      .sort((a, b) => compare(key(b), key(a)));
    const after = q.after;
    const from = after ? items.filter((it) => compare(key(it), after) < 0) : items;
    return from.slice(0, q.n).map((it) => structuredClone(it));
  }

  async marketItem(id: string): Promise<Read<MarketItem> | null> {
    const e = this.market.get(id);
    return e ? { item: structuredClone(e.item), version: String(e.version) } : null;
  }

  async putMarketItem(item: MarketItem, version: string): Promise<boolean> {
    const e = this.market.get(item.id);
    if (!e || String(e.version) !== version) return false;
    this.market.set(item.id, { item: structuredClone(item), version: ++this.clock });
    return true;
  }

  async marketUse(id: string): Promise<number | null> {
    const e = this.market.get(id);
    if (!e) return null;
    e.item.uses++;
    e.version = ++this.clock;
    return e.item.uses;
  }

  async deleteMarketItem(id: string): Promise<void> {
    this.market.delete(id);
  }

  async marketHidden(n: number, before = Infinity): Promise<Read<MarketItem>[]> {
    return [...this.market.values()]
      .filter((e) => e.item.hidden && e.item.hiddenAt < before)
      .sort((a, b) => a.item.hiddenAt - b.item.hiddenAt)
      .slice(0, n)
      .map((e) => ({ item: structuredClone(e.item), version: String(e.version) }));
  }

  async counters(keys: string[]): Promise<Counter[]> {
    return keys.map((key) => {
      const d = this.days.get(key);
      return { key, count: d?.count ?? 0, version: d ? String(d.version) : null };
    });
  }

  async createMarketItem(item: MarketItem, counters: Counter[]): Promise<boolean> {
    if (this.market.has(item.id)) return false;
    for (const c of counters) {
      const d = this.days.get(c.key);
      if ((d ? String(d.version) : null) !== c.version) return false;
    }
    for (const c of counters) this.days.set(c.key, { count: c.count + 1, version: ++this.clock });
    this.market.set(item.id, { item: structuredClone(item), version: ++this.clock });
    return true;
  }

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

/** Orders two cursors value by value (numbers as numbers, ids as text). */
export function compare(a: readonly (number | string)[], b: readonly (number | string)[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}
