import { nameKey, nameProblem, tidyName } from '../../src/core/playerName.ts';
import { boardKind, LIST_MAX, LOOK_FORMAT, OUTFIT_MAX, RANK_LIMIT, SKIS_MAX, valueInRange } from '../../src/online/limits.ts';
import { FirestoreStore } from './firestore.ts';
import { beats, MemoryStore, type Row, type Store } from './store.ts';

// The leaderboard API: a Cloudflare Worker between the game and Firestore,
// and the only way into the database (firestore.rules refuses everyone
// else). It checks every request the way the game does (board ids, ranges,
// the look's format and sizes, and the name with its word filter, from the
// game's own modules), ranks entries, and keeps an entry from ever getting
// worse. Each address gets a few hundred reads and a few dozen writes a
// minute (a whole classroom shares one address, so the limits are loose).
//
//   GET  /v1/top?board=&n=           the best n entries, ranked
//   GET  /v1/entry?board=&name=      one name's entry, ranked, or null
//   GET  /v1/search?board=&q=&n=     names starting with q, ranked
//   POST /v1/post   {board, name, value, look}
//   GET  /v1/look?name=              the look saved under a name, or null
//   PUT  /v1/look   {name, outfit, skis}
//
// Every request takes set=live or set=test (?boards=test in the game).

export interface Env {
  /** The service account's JSON key (a secret: `npx wrangler secret put GCP_SERVICE_ACCOUNT`). */
  GCP_SERVICE_ACCOUNT?: string;
  /** The Firebase project. */
  PROJECT_ID: string;
  /** "firestore", or "memory" for local play-tests (`npm run dev`). */
  STORE: string;
  /** Pages allowed to call the API, comma separated ("http://localhost:*": any port). */
  ALLOWED_ORIGINS: string;
  READS?: RateLimit;
  WRITES?: RateLimit;
}

/** Cloudflare's rate limiting binding (wrangler.jsonc "ratelimits"). */
interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** The largest request body taken (a look with nine full ski slots is about 32 kB). */
const BODY_MAX = 64 * 1024;

/** The local store lives as long as the dev Worker does. */
const memory = new MemoryStore();

/** A refusal the game can read: a status and a short code. */
class Refused extends Error {
  readonly status: number;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
    // An entry ending in ":*" allows any port (the local dev server moves when its port is taken).
    const ok = (o: string): boolean => allowed.some((a) => a === o || (a.endsWith(':*') && o.startsWith(a.slice(0, -1)) && /^\d+$/.test(o.slice(a.length - 1))));
    const cors = origin && ok(origin) ? origin : null;
    if (origin && !cors) return reply(403, { error: 'origin' }, null);
    if (request.method === 'OPTIONS') return preflight(cors);
    try {
      const body = await route(request, env);
      return reply(200, body, cors);
    } catch (err) {
      if (err instanceof Refused) return reply(err.status, { error: err.message }, cors);
      console.error(err);
      return reply(502, { error: 'store' }, cors);
    }
  },
};

async function route(request: Request, env: Env): Promise<unknown> {
  const url = new URL(request.url);
  const set = url.searchParams.get('set');
  if (set !== 'live' && set !== 'test') throw new Refused(400, 'set');
  const writing = request.method !== 'GET';
  const limiter = writing ? env.WRITES : env.READS;
  const who = request.headers.get('CF-Connecting-IP') ?? 'local';
  if (limiter && !(await limiter.limit({ key: who })).success) throw new Refused(429, 'slow down');
  const store = storeFor(env, set === 'test');
  const q = url.searchParams;

  switch (`${request.method} ${url.pathname}`) {
    case 'GET /v1/top': {
      const board = boardParam(q.get('board'));
      const rows = await store.top(board, count(q.get('n')));
      return { entries: rankRun(board, rows) };
    }
    case 'GET /v1/entry': {
      const board = boardParam(q.get('board'));
      const read = await store.entry(board, nameKey(nameParam(q.get('name'), false)));
      return { entry: read ? await ranked(store, board, read.row) : null };
    }
    case 'GET /v1/search': {
      const board = boardParam(q.get('board'));
      const prefix = nameKey(tidyName(q.get('q') ?? ''));
      if (!/^[a-z0-9 _-]{1,16}$/.test(prefix)) throw new Refused(400, 'q');
      const rows = await store.search(board, prefix, count(q.get('n')));
      return { entries: await Promise.all(rows.map((r) => ranked(store, board, r))) };
    }
    case 'POST /v1/post':
      return post(store, await jsonBody(request));
    case 'GET /v1/look': {
      const look = await store.look(nameKey(nameParam(q.get('name'), false)));
      return { look };
    }
    case 'PUT /v1/look': {
      const b = await jsonBody(request);
      const name = nameParam(b.name, true);
      const outfit = jsonText(b.outfit, OUTFIT_MAX, 'outfit');
      const skis = jsonText(b.skis, SKIS_MAX, 'skis');
      await store.putLook(nameKey(name), { name, outfit, skis });
      return { ok: true };
    }
    default:
      throw new Refused(404, 'route');
  }
}

/** Posts a score if it beats the name's entry; answers with the entry that stands, ranked. */
async function post(store: Store, b: Record<string, unknown>): Promise<unknown> {
  const board = boardParam(b.board);
  const name = nameParam(b.name, true);
  const value = b.value;
  if (typeof value !== 'number' || !valueInRange(boardKind(board)!, value)) throw new Refused(400, 'value');
  const look = b.look;
  if (typeof look !== 'string' || !LOOK_FORMAT.test(look)) throw new Refused(400, 'look');
  const key = nameKey(name);
  // Read, then write only if nothing changed since: two posts racing can't put a worse score back.
  for (let tries = 0; tries < 3; tries++) {
    const old = await store.entry(board, key);
    if (old && !beats(board, value, old.row.value)) return { posted: false, entry: await ranked(store, board, old.row) };
    const row: Row = { name, look, value };
    if (await store.putEntry(board, key, row, old ? old.version : null)) return { posted: true, entry: await ranked(store, board, row) };
  }
  throw new Refused(409, 'busy');
}

function storeFor(env: Env, test: boolean): Store {
  if (env.STORE === 'memory') return memory;
  if (!env.GCP_SERVICE_ACCOUNT) throw new Error('GCP_SERVICE_ACCOUNT is not set');
  return new FirestoreStore(env.PROJECT_ID, env.GCP_SERVICE_ACCOUNT, test);
}

function boardParam(value: unknown): string {
  if (typeof value !== 'string' || !boardKind(value)) throw new Refused(400, 'board');
  return value;
}

/** A name as the game saves it. Posting and saving (`strict`) also need it to pass the word filter. */
function nameParam(value: unknown, strict: boolean): string {
  if (typeof value !== 'string' || tidyName(value) !== value) throw new Refused(400, 'name');
  const problem = nameProblem(value);
  if (problem && (strict || problem !== 'word')) throw new Refused(400, 'name');
  return value;
}

/** A list size: 1 to LIST_MAX (10 when missing). */
function count(value: string | null): number {
  const n = value === null ? 10 : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > LIST_MAX) throw new Refused(400, 'n');
  return n;
}

/** A look part: JSON text no longer than `max`. */
function jsonText(value: unknown, max: number, what: string): string {
  if (typeof value !== 'string' || value.length > max) throw new Refused(400, what);
  try {
    JSON.parse(value);
  } catch {
    throw new Refused(400, what);
  }
  return value;
}

async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > BODY_MAX) throw new Refused(413, 'too big');
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // Falls through to the refusal.
  }
  throw new Refused(400, 'body');
}

/** A top list ranked in place: equal scores share a rank. */
function rankRun(board: string, rows: Row[]): (Row & { rank: number })[] {
  const out: (Row & { rank: number })[] = [];
  rows.forEach((r, i) => {
    const prev = out[i - 1];
    out.push({ ...r, rank: prev && !beats(board, prev.value, r.value) ? prev.rank : i + 1 });
  });
  return out;
}

/** One entry with its rank: one more than the entries that beat it (null past RANK_LIMIT). */
async function ranked(store: Store, board: string, row: Row): Promise<Row & { rank: number | null }> {
  const above = await store.better(board, row.value);
  return { ...row, rank: above >= RANK_LIMIT ? null : above + 1 };
}

function corsHeaders(origin: string | null): Record<string, string> {
  return origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : { Vary: 'Origin' };
}

function preflight(origin: string | null): Response {
  return new Response(null, {
    status: origin ? 204 : 403,
    headers: {
      ...corsHeaders(origin),
      'Access-Control-Allow-Methods': 'GET, POST, PUT',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}

function reply(status: number, body: unknown, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
