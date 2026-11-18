import { blockedText, nameKey, nameProblem, tidyName } from '../../src/core/playerName.ts';
import { LOOK_FORMAT } from '../../src/online/limits.ts';
import {
  dataOk,
  dayOf,
  HIDDEN_DAYS,
  isMarketKind,
  PAGE_SIZE,
  REPORTS_HIDE,
  REPORTS_PER_ADDRESS,
  searchWord,
  searchWords,
  tidyTitle,
  titleProblem,
  UPLOADS_PER_ADDRESS,
  UPLOADS_PER_NAME,
} from '../../src/online/marketRules.ts';
import { jsonBody, Refused, type RateLimit } from './http.ts';
import type { MarketItem, MarketQuery, Store } from './store.ts';

// The marketplace (milestone 24): players share outfits, garments and ski
// and board graphics under their board name; anyone browses and uses them.
// Every check the game makes is made again here (src/online/marketRules.ts:
// kinds, sizes, the save formats; the word filter on titles and names).
// Browse pages are cached for a minute: in this Worker instance's memory
// (which works on workers.dev) and in Cloudflare's Cache API (which only
// works on a custom domain, and does nothing on workers.dev). Reports are
// counted per salted address hash, never the address; five hide an item,
// and a hidden item comes back after a week (the daily cron, restoreHidden)
// unless the developer removed it, which takes the DEV_CODE secret.
//
//   GET  /v1/market?kind=&sort=new|used&q=&after=   a page of items
//   POST /v1/market            {kind, type, title, name, data, look}  share one
//   POST /v1/market/use        {id}        one more use
//   POST /v1/market/report     {id}        a report (enough hide it)
//   POST /v1/market/remove     {id, code}  delete it for good (the developer)
//   POST /v1/market/hidden     {code}      the hidden items (the developer)
//   POST /v1/market/dev        {code}      is the code right? (the title's dev box)

export interface MarketEnv {
  /** The developer's code (a secret: `npx wrangler secret put DEV_CODE`; locally worker/.dev.vars). */
  DEV_CODE?: string;
  GCP_SERVICE_ACCOUNT?: string;
  /** "off" turns the memory cache off, to test the Cache API locally. */
  MARKET_MEMORY?: string;
  /** Tries of the code per address a minute. */
  DEV?: RateLimit;
  /** "memory" for local play-tests (see index.ts). */
  STORE?: string;
}

/** How long a browse page is kept, in seconds. */
const CACHE_S = 60;
/** The most pages kept in memory. */
const MEMORY_PAGES = 200;
const ID = /^[A-Za-z0-9]{12}$/;
const ID_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const DAY_MS = 86_400_000;

/** Browse pages this instance answered lately: set|kind|sort|word|after → the JSON and when. */
const memory = new Map<string, { at: number; body: string }>();
/**
 * This instance's own tag, made on its first browse (a Worker's clock and
 * random numbers can't be read while the module loads). The local dev Worker
 * keeps its Cache API on disk across restarts but its memory store not, so
 * there the cache's keys carry this, and a restart starts from an empty cache too.
 */
let boot = '';
/** The Cache API keys this instance stored: a write deletes them (other instances' copies run out within the minute). */
const edgeKeys = new Set<string>();

/** Something changed: drop the pages this instance keeps. */
async function forget(): Promise<void> {
  memory.clear();
  if (typeof caches === 'undefined') return;
  const keys = [...edgeKeys];
  edgeKeys.clear();
  await Promise.all(keys.map((k) => caches.default.delete(new Request(k)).catch(() => false)));
}

/** What a browse answer holds of an item (not its reports or search words). */
function wire(it: MarketItem): Record<string, unknown> {
  return { id: it.id, kind: it.kind, type: it.type, title: it.title, name: it.name, created: it.created, uses: it.uses, data: it.data, look: it.look };
}

/** The answer to a market route: JSON, or a browse page's text with where it came from. */
export type MarketAnswer = { json: unknown } | { text: string; cache: 'memory' | 'edge' | 'miss' };

export async function marketRoute(
  request: Request,
  url: URL,
  env: MarketEnv,
  store: Store,
  set: string,
  who: string,
  ctx: ExecutionContext | undefined,
): Promise<MarketAnswer | null> {
  const route = `${request.method} ${url.pathname}`;
  if (route === 'GET /v1/market') return browse(url, env, store, set, ctx);
  if (!route.startsWith('POST /v1/market')) return null;
  const b = await jsonBody(request);
  switch (url.pathname) {
    case '/v1/market':
      return { json: await upload(store, b, await addressHash(env, who)) };
    case '/v1/market/use': {
      const uses = await store.marketUse(idParam(b.id));
      if (uses === null) throw new Refused(404, 'gone');
      return { json: { uses } };
    }
    case '/v1/market/report':
      return { json: await report(store, idParam(b.id), await addressHash(env, who)) };
    case '/v1/market/remove': {
      await needCode(env, b.code, who);
      await store.deleteMarketItem(idParam(b.id));
      await forget();
      return { json: { ok: true } };
    }
    case '/v1/market/hidden': {
      await needCode(env, b.code, who);
      const rows = await store.marketHidden(PAGE_SIZE * 4);
      return { json: { items: rows.map(({ item }) => ({ ...wire(item), reports: item.reports.length, hiddenAt: item.hiddenAt })) } };
    }
    case '/v1/market/dev':
      await needCode(env, b.code, who);
      return { json: { ok: true } };
    default:
      return null;
  }
}

async function browse(url: URL, env: MarketEnv, store: Store, set: string, ctx: ExecutionContext | undefined): Promise<MarketAnswer> {
  const q = url.searchParams;
  const kindParam = q.get('kind') ?? 'all';
  if (kindParam !== 'all' && !isMarketKind(kindParam)) throw new Refused(400, 'kind');
  const text = q.get('q') ?? '';
  const word = text ? searchWord(text) : '';
  if (text && !word) throw new Refused(400, 'q');
  // A search lists the newest first.
  const sortParam = word ? 'new' : (q.get('sort') ?? 'new');
  if (sortParam !== 'new' && sortParam !== 'used') throw new Refused(400, 'sort');
  const sort = sortParam;
  const afterText = q.get('after') ?? '';
  const after = afterText ? cursorOf(sort, afterText) : null;

  const key = `${set}|${kindParam}|${sort}|${word}|${afterText}`;
  const now = Date.now();
  const useMemory = env.MARKET_MEMORY !== 'off';
  const kept = useMemory ? memory.get(key) : undefined;
  if (kept && now - kept.at < CACHE_S * 1000) return { text: kept.body, cache: 'memory' };
  // The Cache API: keyed by a normalized URL, so the parameters' order doesn't matter.
  const edgeKey = new Request(`${url.origin}/v1/market-cache?k=${encodeURIComponent(key)}${env.STORE === 'memory' ? `&boot=${(boot ||= `${Date.now()}-${Math.random()}`)}` : ''}`);
  const edge = typeof caches !== 'undefined' ? await caches.default.match(edgeKey).catch(() => undefined) : undefined;
  if (edge) {
    const body = await edge.text();
    if (useMemory) remember(key, body, now);
    return { text: body, cache: 'edge' };
  }
  const query: MarketQuery = { kind: kindParam === 'all' ? null : kindParam, sort, word: word || null, after, n: PAGE_SIZE };
  const items = await store.marketPage(query);
  const last = items[items.length - 1];
  const next = items.length === PAGE_SIZE && last ? (sort === 'new' ? `${last.created}.${last.id}` : `${last.uses}.${last.created}.${last.id}`) : null;
  const body = JSON.stringify({ items: items.map(wire), next });
  if (useMemory) remember(key, body, now);
  if (typeof caches !== 'undefined') {
    if (edgeKeys.size < MEMORY_PAGES) edgeKeys.add(edgeKey.url);
    const put = caches.default.put(edgeKey, new Response(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${CACHE_S}` } })).catch(() => {});
    if (ctx) ctx.waitUntil(put);
    else await put;
  }
  return { text: body, cache: 'miss' };
}

function remember(key: string, body: string, at: number): void {
  if (memory.size >= MEMORY_PAGES) {
    for (const [k, v] of memory) if (at - v.at >= CACHE_S * 1000) memory.delete(k);
    if (memory.size >= MEMORY_PAGES) memory.delete(memory.keys().next().value!);
  }
  memory.set(key, { at, body });
}

/** A page's cursor from the game: new "created.id", used "uses.created.id". */
function cursorOf(sort: 'new' | 'used', text: string): (number | string)[] {
  const parts = text.split('.');
  const nums = parts.slice(0, -1);
  const id = parts[parts.length - 1] ?? '';
  if (nums.length !== (sort === 'new' ? 1 : 2) || !ID.test(id) || nums.some((n) => !/^\d{1,15}$/.test(n))) throw new Refused(400, 'after');
  return [...nums.map(Number), id];
}

async function upload(store: Store, b: Record<string, unknown>, address: string): Promise<unknown> {
  const kind = b.kind;
  if (!isMarketKind(kind)) throw new Refused(400, 'kind');
  const type = b.type;
  if (typeof type !== 'string') throw new Refused(400, 'type');
  const title = b.title;
  if (typeof title !== 'string' || tidyTitle(title) !== title || titleProblem(title) || blockedText(title)) throw new Refused(400, 'title');
  const name = b.name;
  if (typeof name !== 'string' || tidyName(name) !== name || nameProblem(name)) throw new Refused(400, 'name');
  const data = b.data;
  if (typeof data !== 'string' || !dataOk(kind, type, data)) throw new Refused(400, 'data');
  const look = b.look;
  if (typeof look !== 'string' || (kind === 'outfit' ? !look || !LOOK_FORMAT.test(look) : look !== '')) throw new Refused(400, 'look');

  const now = Date.now();
  const day = dayOf(now);
  const keys = [`${day}-n-${nameKey(name)}`, `${day}-a-${address}`];
  for (let tries = 0; tries < 3; tries++) {
    const counters = await store.counters(keys);
    if (counters[0]!.count >= UPLOADS_PER_NAME || counters[1]!.count >= UPLOADS_PER_ADDRESS) throw new Refused(429, 'limit');
    const item: MarketItem = { id: newId(), kind, type, title, name, created: now, uses: 0, reports: [], hidden: false, hiddenAt: 0, data, look, words: searchWords(title, name) };
    if (await store.createMarketItem(item, counters)) {
      await forget();
      return { id: item.id };
    }
  }
  throw new Refused(409, 'busy');
}

/** One more report from this address, unless it made REPORTS_PER_ADDRESS today; REPORTS_HIDE of them hide the item. */
async function report(store: Store, id: string, address: string): Promise<unknown> {
  const mark = `${address}:${dayOf(Date.now())}`;
  for (let tries = 0; tries < 3; tries++) {
    const read = await store.marketItem(id);
    if (!read) throw new Refused(404, 'gone');
    const it = read.item;
    if (it.hidden) return { counted: false, hidden: true };
    if (it.reports.filter((r) => r === mark).length >= REPORTS_PER_ADDRESS) return { counted: false, hidden: false };
    const reports = [...it.reports, mark];
    const hidden = reports.length >= REPORTS_HIDE;
    if (await store.putMarketItem({ ...it, reports, hidden, hiddenAt: hidden ? Date.now() : 0 }, read.version)) {
      if (hidden) await forget();
      return { counted: true, hidden };
    }
  }
  throw new Refused(409, 'busy');
}

/** The daily cron: items hidden a week or more and never removed come back, their reports cleared. */
export async function restoreHidden(store: Store): Promise<number> {
  const rows = await store.marketHidden(100, Date.now() - HIDDEN_DAYS * DAY_MS);
  let back = 0;
  for (const { item, version } of rows) if (await store.putMarketItem({ ...item, hidden: false, hiddenAt: 0, reports: [] }, version)) back++;
  if (back) await forget();
  return back;
}

function idParam(v: unknown): string {
  if (typeof v !== 'string' || !ID.test(v)) throw new Refused(400, 'id');
  return v;
}

function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let out = '';
  for (const b of bytes) out += ID_LETTERS[b % ID_LETTERS.length];
  return out;
}

/** Refuses unless `code` is the developer's (the DEV_CODE secret), compared in constant time, a few tries a minute per address. */
async function needCode(env: MarketEnv, code: unknown, who: string): Promise<void> {
  if (env.DEV && !(await env.DEV.limit({ key: who })).success) throw new Refused(429, 'slow down');
  if (!env.DEV_CODE || typeof code !== 'string' || code.length === 0 || code.length > 200) throw new Refused(403, 'code');
  const [a, b] = await Promise.all([sha256(env.DEV_CODE), sha256(code)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  if (diff !== 0) throw new Refused(403, 'code');
}

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

/**
 * The address as a salted hash (16 hex digits): an HMAC keyed by a secret
 * the repo never holds (the developer's code, or else the service account's
 * key), so nobody can work an address back out of what's stored.
 */
async function addressHash(env: MarketEnv, who: string): Promise<string> {
  const secret = env.DEV_CODE || env.GCP_SERVICE_ACCOUNT || 'local only';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`parklaps-address|${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(who)));
  return [...mac.slice(0, 8)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
