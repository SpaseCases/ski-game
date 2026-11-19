import { CONFIG } from '../config.ts';
import { apiBase } from './address.ts';
import { CLOSE, closeText } from '../online/mpRules.ts';

// The lobby's socket (milestone 27): connects to the leaderboard Worker,
// says hello, and keeps itself honest. Every CONFIG.mp.ping s it sends
// "ping", which Cloudflare answers for free without waking the lobby; when
// nothing at all comes back for CONFIG.mp.dead s the socket is treated as
// dead (a closed lid, a Wi-Fi drop: the browser can take minutes to notice),
// closed, and the game rejoins the same lobby, waiting longer each try. A
// hidden tab doesn't try (Chrome slows its timers to once a second, then a
// minute); it rejoins the moment the tab shows again. The Worker's own
// refusals (a full lobby, the day's quota run out) are said in plain words
// and not retried.

const BASE = apiBase();

export type LinkState = 'connecting' | 'joined' | 'retrying' | 'closed';

export interface LinkHooks {
  /** The hello to send once open (JSON text). */
  hello: () => string;
  /** A rider's state (binary), a keep-alive's rider id, a JSON message. */
  state: (data: ArrayBuffer) => void;
  keep: (id: number) => void;
  message: (m: Record<string, unknown>) => void;
  /** The state changed; `text` says why in plain words (a refusal or a problem). */
  status: (state: LinkState, text: string) => void;
}

export class Link {
  private ws: WebSocket | null = null;
  private stateNow: LinkState = 'closed';
  /** Gave up for good (a refusal), or left on purpose. */
  private stopped = true;
  private code = '';
  private lastHeard = 0;
  private openedAt = 0;
  private everJoined = false;
  private tries = 0;
  private pingTimer = 0;
  private retryTimer = 0;
  private openTimer = 0;
  private readonly hooks: LinkHooks;
  private readonly onVisible = (): void => {
    if (document.visibilityState !== 'visible' || this.stopped) return;
    // Back from a hidden tab or a closed lid: a socket that went quiet is dead; rejoin now rather than after the next wait.
    if (!this.ws || performance.now() - this.lastHeard > CONFIG.mp.dead * 1000) this.reconnect(0);
  };

  constructor(hooks: LinkHooks) {
    this.hooks = hooks;
    // A tab shown again, a page Chrome froze in the background (or a lid) resuming, the network back.
    document.addEventListener('visibilitychange', this.onVisible);
    document.addEventListener('resume', this.onVisible);
    window.addEventListener('online', this.onVisible);
  }

  get state(): LinkState {
    return this.stateNow;
  }

  get lobby(): string {
    return this.code;
  }

  /** Joins the lobby with this code (leaving any other). */
  join(code: string): void {
    this.leave();
    this.code = code;
    this.stopped = false;
    this.everJoined = false;
    this.tries = 0;
    this.open();
  }

  /** Leaves on purpose: no rejoining. */
  leave(): void {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    this.drop(1000, 'left');
    this.set('closed', '');
  }

  /** The Worker welcomed us: the lobby is joined. */
  welcomed(): void {
    this.everJoined = true;
    this.tries = 0;
    this.set('joined', '');
  }

  sendBinary(data: Uint8Array<ArrayBuffer>): void {
    if (this.ws?.readyState === WebSocket.OPEN && this.stateNow === 'joined') this.ws.send(data);
  }

  sendText(text: string): void {
    if (this.ws?.readyState === WebSocket.OPEN && this.stateNow === 'joined') this.ws.send(text);
  }

  dispose(): void {
    this.leave();
    document.removeEventListener('visibilitychange', this.onVisible);
    document.removeEventListener('resume', this.onVisible);
    window.removeEventListener('online', this.onVisible);
  }

  private open(): void {
    if (!BASE) {
      this.stop('Multiplayer has no server address in this build.');
      return;
    }
    if (!navigator.onLine) {
      this.set('retrying', "You're offline. Waiting for the network…");
      this.retryLater();
      return;
    }
    this.set(this.everJoined ? 'retrying' : 'connecting', this.everJoined ? 'Connection lost. Rejoining…' : '');
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/v1/mp/join?code=${encodeURIComponent(this.code)}${forceParam()}`);
    } catch {
      this.stop("Couldn't start a connection to multiplayer.");
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    this.openedAt = performance.now();
    this.lastHeard = this.openedAt;
    let opened = false;
    clearTimeout(this.openTimer);
    this.openTimer = window.setTimeout(() => {
      if (opened || this.ws !== ws) return;
      // Neither open nor closed: a filter holding the connection. Say so, and keep trying.
      this.drop(1000, 'timeout');
      this.failed(1006);
    }, CONFIG.mp.connectTimeout * 1000);
    ws.onopen = () => {
      if (this.ws !== ws) return;
      opened = true;
      clearTimeout(this.openTimer);
      this.lastHeard = performance.now();
      ws.send(this.hooks.hello());
      clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.ping(), CONFIG.mp.ping * 1000);
    };
    ws.onmessage = (e: MessageEvent) => {
      if (this.ws !== ws) return;
      this.lastHeard = performance.now();
      const data: unknown = e.data;
      if (data instanceof ArrayBuffer) {
        this.hooks.state(data);
        return;
      }
      if (typeof data !== 'string' || data === 'pong') return;
      if (data.charCodeAt(0) === 107 /* k */) {
        this.hooks.keep(Number(data.slice(1)));
        return;
      }
      try {
        const m: unknown = JSON.parse(data);
        if (m && typeof m === 'object') this.hooks.message(m as Record<string, unknown>);
      } catch {
        // Not ours to read.
      }
    };
    ws.onclose = (e: CloseEvent) => {
      if (this.ws !== ws) return;
      this.ws = null;
      clearInterval(this.pingTimer);
      clearTimeout(this.openTimer);
      if (this.stopped) return;
      this.failed(opened ? e.code : e.code === 1000 ? 1006 : e.code);
    };
  }

  /** A connection ended (or never opened) with `code`: says why, and rejoins unless the Worker refused. */
  private failed(code: number): void {
    const said = closeText(code);
    if (said && code !== CLOSE.silent && code !== CLOSE.down) {
      this.stop(said);
      return;
    }
    if (!this.everJoined && this.tries >= 2) {
      // Never got in: a network that blocks it, most likely. Keep trying, slowly, and say so.
      this.set('retrying', navigator.onLine ? "Can't reach multiplayer. This network may block it. Still trying…" : "You're offline. Waiting for the network…");
    } else {
      this.set('retrying', said ?? (this.everJoined ? 'Connection lost. Rejoining…' : 'Connecting…'));
    }
    this.retryLater();
  }

  private ping(): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (performance.now() - this.lastHeard > CONFIG.mp.dead * 1000) {
      // Nothing back, not even the free pong: the socket is dead even if the browser hasn't noticed.
      this.drop(1000, 'dead');
      this.failed(1006);
      return;
    }
    ws.send('ping');
  }

  private retryLater(): void {
    clearTimeout(this.retryTimer);
    if (this.stopped) return;
    const M = CONFIG.mp;
    const wait = Math.min(M.retryMax, M.retryFirst * 2 ** this.tries);
    this.tries++;
    this.retryTimer = window.setTimeout(() => {
      // A hidden tab waits for the tab to show (onVisible), rather than trying at a minute's pace.
      if (document.visibilityState === 'visible') this.open();
    }, wait * 1000);
  }

  private reconnect(wait: number): void {
    clearTimeout(this.retryTimer);
    this.drop(1000, 'rejoin');
    this.retryTimer = window.setTimeout(() => this.open(), wait);
  }

  private stop(text: string): void {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    this.drop(1000, 'stop');
    this.set('closed', text);
  }

  private drop(code: number, reason: string): void {
    const ws = this.ws;
    this.ws = null;
    clearInterval(this.pingTimer);
    clearTimeout(this.openTimer);
    if (!ws) return;
    ws.onopen = ws.onmessage = ws.onclose = null;
    try {
      ws.close(code, reason);
    } catch {
      // Already closing.
    }
  }

  private set(state: LinkState, text: string): void {
    this.stateNow = state;
    this.hooks.status(state, text);
  }
}

/** Local play-tests only: ?mpforce=full or down asks the local Worker for that refusal. */
function forceParam(): string {
  const f = new URLSearchParams(window.location.search).get('mpforce');
  return f ? `&force=${encodeURIComponent(f)}` : '';
}

/** The lobby API (plain HTTPS): lists, details, making one. Rejects on any failure, with the status (0 when unreachable). */
export async function lobbyApi<T>(method: 'GET' | 'POST', path: string, params: Record<string, string>, body?: unknown): Promise<T> {
  if (!BASE) throw new LobbyError(0, '');
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const f = new URLSearchParams(window.location.search).get('mpforce');
  if (f) url.searchParams.set('force', f);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 8000);
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
    const json = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new LobbyError(res.status, typeof json.error === 'string' ? json.error : '');
    return json;
  } catch (err) {
    if (err instanceof LobbyError) throw err;
    throw new LobbyError(0, '');
  } finally {
    clearTimeout(timer);
  }
}

export class LobbyError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(`lobby ${status} ${code}`);
    this.status = status;
    this.code = code;
  }
}

/** Plain words for a lobby request that failed. */
export function lobbyErrorText(err: unknown): string {
  if (!(err instanceof LobbyError)) return "Couldn't reach multiplayer.";
  if (err.status === 0) return navigator.onLine ? "Can't reach multiplayer. This network may block it." : "You're offline.";
  if (err.status === 503 && err.code === 'full today') return 'Multiplayer is full today. Riding alone still works.';
  if (err.status === 503) return 'Multiplayer is down right now.';
  if (err.status === 429) return 'Too many tries from this network. Wait a minute.';
  if (err.status === 404) return 'No lobby has that code.';
  return "Multiplayer didn't take that.";
}
