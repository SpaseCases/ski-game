// The game's side of the leaderboard API: the Cloudflare Worker in worker/,
// the only way into the database. The game never talks to Firestore itself.
// Requests time out, and any failure (offline, blocked, refused) rejects;
// callers show "Leaderboard offline". `?boards=test` asks for the test
// boards and looks, for play-tests.
//
// The Worker's address comes from VITE_API_URL (.env.development: the local
// `npm run dev` in worker/; .env.production: the deployed Worker). Empty, every
// request fails at once and the boards show offline.

const BASE: string = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/+$/, '');
const TIMEOUT_MS = 8000;

/** Which boards and looks: the real ones, or the play-test copies. */
export const SET = new URLSearchParams(window.location.search).get('boards') === 'test' ? 'test' : 'live';

/** A request the Worker answered with something other than OK (400: refused, 429: too many). */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function call<T>(method: 'GET' | 'POST' | 'PUT', path: string, params: Record<string, string>, body?: unknown): Promise<T> {
  if (!BASE) throw new ApiError(0, 'No leaderboard address');
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set('set', SET);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: abort.signal,
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    if (!res.ok) throw new ApiError(res.status, `Leaderboard ${method} ${path} answered ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export function apiGet<T>(path: string, params: Record<string, string>): Promise<T> {
  return call<T>('GET', path, params);
}

export function apiSend<T>(method: 'POST' | 'PUT', path: string, body: unknown): Promise<T> {
  return call<T>(method, path, {}, body);
}
