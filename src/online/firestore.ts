// A small Firestore client over the REST API (no SDK): just the calls the
// leaderboards need. Every request is unauthenticated, so firestore.rules
// decide what's allowed. Requests time out, and any failure (offline,
// blocked, refused) rejects; callers show "Leaderboard offline".
// https://firebase.google.com/docs/firestore/reference/rest

const PROJECT = 'parklaps-3b60f';
const DATABASE = `projects/${PROJECT}/databases/(default)`;
const DOCUMENTS = `${DATABASE}/documents`;
const BASE = 'https://firestore.googleapis.com/v1/';
const TIMEOUT_MS = 8000;

/** A field value as the REST API writes it (only the kinds the boards use). */
export interface Value {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  referenceValue?: string;
}

export interface Doc {
  /** The full resource name: projects/…/documents/<path>. */
  name: string;
  fields?: Record<string, Value>;
}

/** A request that got an answer other than OK (403: the rules refused it). */
export class FirestoreError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** The full resource name of a document or collection path ("boards/park/names/bob"). */
export function resourceName(path: string): string {
  return `${DOCUMENTS}/${path}`;
}

export function str(v: string): Value {
  return { stringValue: v };
}

export function int(v: number): Value {
  return { integerValue: String(Math.round(v)) };
}

/** A number field (integers come back as strings). NaN when missing. */
export function num(v: Value | undefined): number {
  if (v?.integerValue !== undefined) return Number(v.integerValue);
  if (v?.doubleValue !== undefined) return v.doubleValue;
  return NaN;
}

async function call<T>(method: string, path: string, body: unknown): Promise<T> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: abort.signal,
      credentials: 'omit',
      cache: 'no-store',
    });
    if (!res.ok) throw new FirestoreError(res.status, `Firestore ${method} answered ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Each URL path segment escaped (names may hold spaces); the slashes between them kept. */
function urlPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

/** A structured query (see the REST reference); `parent` is the document holding the collection. */
export async function runQuery(parent: string, query: object): Promise<Doc[]> {
  const rows = await call<{ document?: Doc }[]>('POST', `${DOCUMENTS}/${urlPath(parent)}:runQuery`, { structuredQuery: query });
  return rows.flatMap((r) => (r.document ? [r.document] : []));
}

/** How many documents a structured query matches (counted up to its limit). */
export async function count(parent: string, query: object): Promise<number> {
  const rows = await call<{ result?: { aggregateFields?: Record<string, Value> } }[]>('POST', `${DOCUMENTS}/${urlPath(parent)}:runAggregationQuery`, {
    structuredAggregationQuery: { structuredQuery: query, aggregations: [{ alias: 'n', count: {} }] },
  });
  const n = num(rows[0]?.result?.aggregateFields?.n);
  return Number.isFinite(n) ? n : 0;
}

/** Reads one document; null when it doesn't exist (batchGet answers that without a 404). */
export async function getDoc(path: string): Promise<Doc | null> {
  const rows = await call<{ found?: Doc }[]>('POST', `${DOCUMENTS}:batchGet`, { documents: [resourceName(path)] });
  return rows.find((r) => r.found)?.found ?? null;
}

/** Writes a whole document, creating it or replacing every field (the rules see a create or an update). */
export async function setDoc(path: string, fields: Record<string, Value>): Promise<void> {
  await call('PATCH', `${DOCUMENTS}/${urlPath(path)}`, { fields });
}
