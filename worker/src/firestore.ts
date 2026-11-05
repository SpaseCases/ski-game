import { boardKind, RANK_LIMIT } from '../../src/online/limits.ts';
import type { Look, ReadRow, Row, Store } from './store.ts';

// The real store: Firestore over its REST API, signed in as a Google service
// account (the GCP_SERVICE_ACCOUNT secret, its JSON key). Requests made with
// a service account's token are allowed by IAM and skip firestore.rules, so
// the rules can shut everyone else out: this Worker is the only way in.
//
//   boards/<board>/names/<key>   name, look, and combo (points) or ms
//   looks/<key>                  name, outfit, skis
//   testBoards/..., testLooks/...  the same for ?boards=test
// https://firebase.google.com/docs/firestore/reference/rest

const BASE = 'https://firestore.googleapis.com/v1/';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/datastore';
const TIMEOUT_MS = 8000;

interface Value {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  referenceValue?: string;
}

interface Doc {
  name: string;
  fields?: Record<string, Value>;
  updateTime?: string;
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

/** The access token, kept until a minute before it runs out (per Worker instance). */
let token: { value: string; until: number; account: string } | null = null;

/** A Firestore answer other than OK. */
export class StoreError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export class FirestoreStore implements Store {
  private readonly documents: string;
  private readonly boardsRoot: string;
  private readonly looksRoot: string;
  private readonly account: string;

  constructor(project: string, account: string, test: boolean) {
    this.documents = `projects/${project}/databases/(default)/documents`;
    this.boardsRoot = test ? 'testBoards' : 'boards';
    this.looksRoot = test ? 'testLooks' : 'looks';
    this.account = account;
  }

  async entry(board: string, key: string): Promise<ReadRow | null> {
    const doc = await this.getDoc(`${this.boardsRoot}/${board}/names/${key}`);
    const row = doc ? toRow(board, doc) : null;
    return row && doc ? { row, version: doc.updateTime ?? '' } : null;
  }

  async putEntry(board: string, key: string, row: Row, version: string | null): Promise<boolean> {
    const field = boardKind(board) === 'time' ? 'ms' : 'combo';
    const guard = version === null ? 'currentDocument.exists=false' : `currentDocument.updateTime=${encodeURIComponent(version)}`;
    try {
      await this.call('PATCH', `${this.documents}/${urlPath(`${this.boardsRoot}/${board}/names/${key}`)}?${guard}`, {
        fields: { name: str(row.name), look: str(row.look), [field]: int(row.value) },
      });
      return true;
    } catch (err) {
      // Someone wrote first: the guard failed (FAILED_PRECONDITION is a 400, an existing document a 409).
      if (err instanceof StoreError && (err.status === 400 || err.status === 409)) return false;
      throw err;
    }
  }

  async top(board: string, n: number): Promise<Row[]> {
    const docs = await this.runQuery(`${this.boardsRoot}/${board}`, {
      from: [{ collectionId: 'names' }],
      orderBy: [{ field: { fieldPath: fieldOf(board) }, direction: boardKind(board) === 'time' ? 'ASCENDING' : 'DESCENDING' }],
      limit: n,
    });
    return docs.flatMap((d) => toRow(board, d) ?? []);
  }

  async better(board: string, value: number): Promise<number> {
    const rows = await this.call<{ result?: { aggregateFields?: Record<string, Value> } }[]>(
      'POST',
      `${this.documents}/${urlPath(`${this.boardsRoot}/${board}`)}:runAggregationQuery`,
      {
        structuredAggregationQuery: {
          structuredQuery: {
            from: [{ collectionId: 'names' }],
            where: { fieldFilter: { field: { fieldPath: fieldOf(board) }, op: boardKind(board) === 'time' ? 'LESS_THAN' : 'GREATER_THAN', value: int(value) } },
            limit: RANK_LIMIT,
          },
          aggregations: [{ alias: 'n', count: {} }],
        },
      },
    );
    const n = num(rows[0]?.result?.aggregateFields?.n);
    return Number.isFinite(n) ? n : 0;
  }

  async search(board: string, prefix: string, n: number): Promise<Row[]> {
    const names = `${this.documents}/${this.boardsRoot}/${board}/names/`;
    const docs = await this.runQuery(`${this.boardsRoot}/${board}`, {
      from: [{ collectionId: 'names' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            { fieldFilter: { field: { fieldPath: '__name__' }, op: 'GREATER_THAN_OR_EQUAL', value: { referenceValue: names + prefix } } },
            { fieldFilter: { field: { fieldPath: '__name__' }, op: 'LESS_THAN', value: { referenceValue: names + prefix + '' } } },
          ],
        },
      },
      limit: n,
    });
    return docs.flatMap((d) => toRow(board, d) ?? []);
  }

  async look(key: string): Promise<Look | null> {
    const doc = await this.getDoc(`${this.looksRoot}/${key}`);
    const f = doc?.fields;
    const outfit = f?.outfit?.stringValue;
    const skis = f?.skis?.stringValue;
    const name = f?.name?.stringValue;
    if (outfit === undefined || skis === undefined || name === undefined) return null;
    return { name, outfit, skis };
  }

  async putLook(key: string, look: Look): Promise<void> {
    await this.call('PATCH', `${this.documents}/${urlPath(`${this.looksRoot}/${key}`)}`, {
      fields: { name: str(look.name), outfit: str(look.outfit), skis: str(look.skis) },
    });
  }

  /** Reads one document; null when it doesn't exist (batchGet answers that without a 404). */
  private async getDoc(path: string): Promise<Doc | null> {
    const rows = await this.call<{ found?: Doc }[]>('POST', `${this.documents}:batchGet`, { documents: [`${this.documents}/${path}`] });
    return rows.find((r) => r.found)?.found ?? null;
  }

  private async runQuery(parent: string, query: object): Promise<Doc[]> {
    const rows = await this.call<{ document?: Doc }[]>('POST', `${this.documents}/${urlPath(parent)}:runQuery`, { structuredQuery: query });
    return rows.flatMap((r) => (r.document ? [r.document] : []));
  }

  private async call<T>(method: string, path: string, body: unknown): Promise<T> {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await accessToken(this.account)}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new StoreError(res.status, `Firestore ${method} answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return (await res.json()) as T;
  }
}

function fieldOf(board: string): 'combo' | 'ms' {
  return boardKind(board) === 'time' ? 'ms' : 'combo';
}

function toRow(board: string, doc: Doc): Row | null {
  const f = doc.fields ?? {};
  const name = f.name?.stringValue;
  const value = num(f[fieldOf(board)]);
  if (!name || !Number.isFinite(value)) return null;
  return { name, look: f.look?.stringValue ?? '', value };
}

function str(v: string): Value {
  return { stringValue: v };
}

function int(v: number): Value {
  return { integerValue: String(Math.round(v)) };
}

/** A number field (integers come back as strings). NaN when missing. */
function num(v: Value | undefined): number {
  if (v?.integerValue !== undefined) return Number(v.integerValue);
  if (v?.doubleValue !== undefined) return v.doubleValue;
  return NaN;
}

/** Each URL path segment escaped (names may hold spaces); the slashes between them kept. */
function urlPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

/**
 * A Google access token for the service account: a JWT signed with its
 * private key (RS256, Web Crypto), traded at Google's token endpoint.
 * https://developers.google.com/identity/protocols/oauth2/service-account#httprest
 */
async function accessToken(accountJson: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (token && token.account === accountJson && token.until > now) return token.value;
  const account = JSON.parse(accountJson) as ServiceAccount;
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = { iss: account.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const key = await crypto.subtle.importKey('pkcs8', pemBytes(account.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64url(signature)}` }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new StoreError(res.status, `Google token answered ${res.status}`);
  const got = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: got.access_token, until: now + got.expires_in - 60, account: accountJson };
  return got.access_token;
}

function b64url(data: string | ArrayBuffer): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A PEM private key's DER bytes. */
function pemBytes(pem: string): ArrayBuffer {
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
