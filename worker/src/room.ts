import { DurableObject } from 'cloudflare:workers';
import { nameProblem, tidyName } from '../../src/core/playerName.ts';
import { OUTFIT_MAX } from '../../src/online/limits.ts';
import {
  BEST_MAX, CHAT_GAP_MS, chatAllowed, CLOSE, HEADER_BYTES, KIND_STATE, RATE_MAX, RATE_STRIKES, REPORT_EVERY_S, ROOM_MAX, SAMPLE_BYTES,
  SILENT_CLOSE_S, STAND_IN_NAME, STATE_MAX, STATE_MIN, stateLength, TEXT_MAX, tidyChat, TOKEN_FORMAT, trickOk,
} from '../../src/online/mpRules.ts';
import type { Lobbies } from './lobbies.ts';

// Multiplayer lobbies (milestone 27): one Durable Object per lobby
// (`room-<code>`), its sockets accepted with the Hibernation API, so an
// object with nothing to do isn't billed for the time it sits there.
//
// A lobby relays each rider's state (a small binary message, 5 a second:
// src/online/mpRules.ts) to everyone else in it, stamped with the rider's id,
// and passes on chat (slurs refused, one line every 2 s), banked scores and
// the developer's hits. It checks every message (sizes, layout, names, rates)
// and closes a connection that floods it. A quiet rider isn't dropped: a
// hidden tab or a closed lid goes silent, and the games mark them away
// themselves; only SILENT_CLOSE_S of silence closes one here. Lobby details
// (code, map, title, open or private) live in storage, each rider's outfit
// too (an attachment holds only 2 kB); nothing else is stored.
//
// The socket test's echo (milestone 27's first step) runs in the same class
// on its own objects: it replies to each message and fans out copies.
//
// Cost on Workers Free (Cloudflare's docs, rechecked 2026-11-18): opening a
// socket is one request, incoming messages count 20 to one, outgoing ones
// and the "ping" auto-response are free; 100,000 requests and 13,000 GB-s a
// day, then calls fail until midnight UTC.

/** The largest message the echo takes, in characters. */
export const MESSAGE_MAX = 1024;
/** The most copies the echo fans out per message. */
export const FAN_MAX = 15;
/** A connection that hasn't said hello this long (ms) is closed. */
const HELLO_WAIT_MS = 20_000;
/** A lobby with nobody in it can be given a new code's lobby after this long (ms). */
const REUSE_MS = 10 * 60_000;
/** How often the silent riders are looked for (ms). */
const SWEEP_MS = 5_000;
/** How often a rider's last-heard time is written to its attachment (ms; it lives in memory between). */
const SAVE_MS = 10_000;

export interface RoomEnv {
  DEV_CODE?: string;
  LOBBIES: DurableObjectNamespace<Lobbies>;
}

/** A lobby's details. */
export interface LobbyMeta {
  code: string;
  map: string;
  title: string;
  open: boolean;
  created: number;
}

/** What each socket carries through hibernation (its attachment, under 2 kB). */
interface Seat {
  /** 'e' the echo test, 'r' a rider. */
  m: 'e' | 'r';
  /** The echo's count and fan-out. */
  got?: number;
  fan?: number;
  /** A rider: said hello yet, its id in the lobby (1..255), name, the game's visit token, the developer's code accepted. */
  hi?: boolean;
  id?: number;
  name?: string;
  tok?: string;
  dev?: boolean;
  best?: number;
  trick?: string;
  joined?: number;
  last?: number;
  /** Already left (closed by us): no second leave. */
  gone?: boolean;
}

/** What a rider's connection keeps in memory between messages (rebuilt from the attachment after hibernation). */
interface Live {
  second: number;
  count: number;
  strikes: number;
  chatAt: number;
  last: number;
  saved: number;
}

export class Room extends DurableObject<RoomEnv> {
  private meta: LobbyMeta | null = null;
  private readonly live = new Map<WebSocket, Live>();
  private lastSweep = 0;
  private lastReport = 0;

  constructor(ctx: DurableObjectState, env: RoomEnv) {
    super(ctx, env);
    // Answered by Cloudflare without waking the object, and free: the game's dead-socket check.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    void ctx.blockConcurrencyWhile(async () => {
      this.meta = (await ctx.storage.get<LobbyMeta>('meta')) ?? null;
    });
  }

  /** Makes this object a new lobby; false if it's one already (in use, or emptied only lately). */
  async init(meta: LobbyMeta): Promise<boolean> {
    if (this.meta && (this.riders().length > 0 || Date.now() - this.meta.created < REUSE_MS)) return false;
    for (const ws of this.ctx.getWebSockets()) ws.close(CLOSE.noLobby, 'gone');
    await this.ctx.storage.deleteAll();
    this.meta = meta;
    await this.ctx.storage.put('meta', meta);
    return true;
  }

  /** The lobby's details and how many ride in it, or null if there's no lobby here. */
  info(): { map: string; title: string; open: boolean; riders: number; max: number } | null {
    if (!this.meta) return null;
    return { map: this.meta.map, title: this.meta.title, open: this.meta.open, riders: this.riders().length, max: ROOM_MAX };
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const fan = Math.min(FAN_MAX, Math.max(1, Number(url.searchParams.get('fan')) || 1));
    const socket = request.headers.get('Upgrade') === 'websocket';
    if (socket && request.headers.get('X-Mode') === 'room') {
      if (!this.meta) return refusedSocket(CLOSE.noLobby, 'no such lobby');
      const seats = this.ctx.getWebSockets().filter((ws) => (seatOf(ws).m === 'r' && !seatOf(ws).gone));
      if (seats.length >= ROOM_MAX) return refusedSocket(CLOSE.full, 'lobby full');
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      this.ctx.acceptWebSocket(server);
      const now = Date.now();
      server.serializeAttachment({ m: 'r', hi: false, joined: now, last: now } satisfies Seat);
      return new Response(null, { status: 101, webSocket: client });
    }
    if (socket) {
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ m: 'e', got: 0, fan } satisfies Seat);
      return new Response(null, { status: 101, webSocket: client });
    }
    // The socket test's HTTP route (polling): one message in, the echo and its copies out in one reply.
    const text = await request.text();
    if (text.length > MESSAGE_MAX) return new Response('{"error":"too big"}', { status: 413 });
    const seq = seqOf(text);
    const copies: string[] = [];
    for (let i = 1; i < fan; i++) copies.push(text);
    return new Response(`{"e":${seq},"d":${text},"o":[${copies.join(',')}]}`, {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const seat = seatOf(ws);
    if (seat.m === 'e') return this.echo(ws, seat, message);
    if (seat.gone) return;
    const now = Date.now();
    const live = this.liveOf(ws, seat);
    // Rate: over RATE_MAX in a second is a strike; RATE_STRIKES seconds in a row closes the connection.
    const second = Math.floor(now / 1000);
    if (second !== live.second) {
      if (live.count <= RATE_MAX) live.strikes = 0;
      live.second = second;
      live.count = 0;
    }
    live.count++;
    if (live.count === RATE_MAX + 1 && ++live.strikes >= RATE_STRIKES) return this.drop(ws, seat, CLOSE.tooFast, 'too fast');
    live.last = now;
    if (now - live.saved > SAVE_MS) {
      seat.last = now;
      ws.serializeAttachment(seat);
      live.saved = now;
    }
    if (now - this.lastSweep > SWEEP_MS) this.sweep(now);
    if (seat.hi && now - this.lastReport > REPORT_EVERY_S * 1000) void this.report();

    if (typeof message !== 'string') {
      if (!seat.hi) return;
      const bytes = new Uint8Array(message);
      if (bytes.length < STATE_MIN || bytes.length > STATE_MAX || bytes[0] !== KIND_STATE) return this.drop(ws, seat, CLOSE.bad, 'bad state');
      const mask = new DataView(message).getUint32(HEADER_BYTES + SAMPLE_BYTES, true);
      if (stateLength(mask) !== bytes.length) return this.drop(ws, seat, CLOSE.bad, 'bad state');
      bytes[1] = seat.id!;
      this.toOthers(ws, message);
      return;
    }
    if (message === 'k') {
      if (seat.hi) this.toOthers(ws, `k${seat.id}`);
      return;
    }
    if (message.length > TEXT_MAX) return this.drop(ws, seat, CLOSE.bad, 'too big');
    let m: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(message);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      m = parsed as Record<string, unknown>;
    } catch {
      return this.drop(ws, seat, CLOSE.bad, 'bad message');
    }
    if (m.t === 'hi') return this.hello(ws, seat, m, now);
    if (!seat.hi) return;
    switch (m.t) {
      case 'c': {
        if (typeof m.text !== 'string') return;
        const text = tidyChat(m.text);
        if (now - live.chatAt < CHAT_GAP_MS) return send(ws, { t: 'c-slow' });
        if (!chatAllowed(text)) return send(ws, { t: 'c-no' });
        live.chatAt = now;
        this.toAll({ t: 'c', id: seat.id, text });
        return;
      }
      case 's': {
        const best = m.best;
        if (typeof best !== 'number' || !Number.isInteger(best) || best < 0 || best > BEST_MAX || !trickOk(m.trick)) return;
        seat.best = Math.max(seat.best ?? 0, best);
        seat.trick = m.trick;
        ws.serializeAttachment(seat);
        this.toOthers(ws, JSON.stringify({ t: 's', id: seat.id, best: seat.best, trick: seat.trick }));
        return;
      }
      case 'h': {
        // The developer's shot (their code was checked at hello): the rider hit crashes in their own game.
        if (!seat.dev || typeof m.to !== 'number') return;
        const x = clampUnit(m.x);
        const z = clampUnit(m.z);
        const target = this.riders().find((r) => seatOf(r).id === m.to);
        if (target) send(target, { t: 'hit', by: seat.name, x, z });
        return;
      }
      default:
        return;
    }
  }

  override webSocketClose(ws: WebSocket, code: number, reason: string): void {
    this.leave(ws, seatOf(ws));
    try {
      // 1005 (no code) and 1006 (dropped) can't be sent back; close with a plain 1000.
      ws.close(code === 1005 || code === 1006 ? 1000 : code, reason);
    } catch {
      // Already closed.
    }
  }

  override webSocketError(ws: WebSocket): void {
    this.leave(ws, seatOf(ws));
  }

  // ------------------------------------------------------------------

  private async hello(ws: WebSocket, seat: Seat, m: Record<string, unknown>, now: number): Promise<void> {
    if (seat.hi || !this.meta) return;
    const name = m.name;
    const outfit = m.outfit;
    const tok = m.token;
    if (typeof name !== 'string' || tidyName(name) !== name || (nameProblem(name) !== null && !STAND_IN_NAME.test(name))) return this.drop(ws, seat, CLOSE.bad, 'name');
    if (typeof outfit !== 'string' || outfit.length > OUTFIT_MAX || !jsonObject(outfit)) return this.drop(ws, seat, CLOSE.bad, 'outfit');
    if (typeof tok !== 'string' || !TOKEN_FORMAT.test(tok)) return this.drop(ws, seat, CLOSE.bad, 'token');
    const dev = typeof m.dev === 'string' && (await devCode(this.env.DEV_CODE, m.dev));
    // The same game rejoining (a tab back from sleep): its old connection goes.
    for (const other of this.riders()) {
      const s = seatOf(other);
      if (other !== ws && s.tok === tok) this.drop(other, s, CLOSE.replaced, 'replaced');
    }
    const taken = new Set(this.riders().map((r) => seatOf(r).id));
    let id = 1;
    while (taken.has(id)) id++;
    if (id > 255) return this.drop(ws, seat, CLOSE.full, 'lobby full');
    Object.assign(seat, { hi: true, id, name, tok, dev, best: 0, trick: '', last: now } satisfies Partial<Seat>);
    ws.serializeAttachment(seat);
    await this.ctx.storage.put(`o${id}`, outfit);
    const others = this.riders().filter((r) => r !== ws);
    const outfits = await this.ctx.storage.get<string>(others.map((r) => `o${seatOf(r).id}`));
    const riders = others.map((r) => {
      const s = seatOf(r);
      return { id: s.id, name: s.name, outfit: outfits.get(`o${s.id}`) ?? '{}', best: s.best ?? 0, trick: s.trick ?? '', quiet: Math.round((now - (this.live.get(r)?.last ?? s.last ?? now)) / 1000) };
    });
    const { code, map, title, open } = this.meta;
    send(ws, { t: 'welcome', you: id, code, map, title, open, max: ROOM_MAX, riders });
    this.toOthers(ws, JSON.stringify({ t: 'join', r: { id, name, outfit, best: 0, trick: '', quiet: 0 } }));
    await this.report();
  }

  /** The echo test: replies to each message with its sequence number and the count, and fans out copies. */
  private echo(ws: WebSocket, seat: Seat, message: string | ArrayBuffer): void {
    if (typeof message !== 'string' || message.length > MESSAGE_MAX) {
      ws.close(1009, 'message too big');
      return;
    }
    if (message === '{"t":"end"}') {
      ws.send(`{"end":${seat.got ?? 0}}`);
      return;
    }
    seat.got = (seat.got ?? 0) + 1;
    ws.serializeAttachment(seat);
    ws.send(`{"e":${seqOf(message)},"n":${seat.got},"d":${message}}`);
    for (let i = 1; i < (seat.fan ?? 1); i++) ws.send(`{"o":${i},"d":${message}}`);
  }

  /** The riders who said hello and are still connected. */
  private riders(): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => {
      const s = seatOf(ws);
      return s.m === 'r' && s.hi === true && !s.gone && ws.readyState === WebSocket.OPEN;
    });
  }

  private liveOf(ws: WebSocket, seat: Seat): Live {
    let live = this.live.get(ws);
    if (!live) {
      live = { second: 0, count: 0, strikes: 0, chatAt: 0, last: seat.last ?? Date.now(), saved: Date.now() };
      this.live.set(ws, live);
    }
    return live;
  }

  private toOthers(from: WebSocket, data: string | ArrayBuffer): void {
    for (const ws of this.riders()) if (ws !== from) trySend(ws, data);
  }

  private toAll(body: unknown): void {
    const text = JSON.stringify(body);
    for (const ws of this.riders()) trySend(ws, text);
  }

  /** Closes riders silent past SILENT_CLOSE_S, and connections that never said hello. */
  private sweep(now: number): void {
    this.lastSweep = now;
    for (const ws of this.ctx.getWebSockets()) {
      const s = seatOf(ws);
      if (s.m !== 'r' || s.gone) continue;
      const last = this.live.get(ws)?.last ?? s.last ?? now;
      if (s.hi && now - last > SILENT_CLOSE_S * 1000) this.drop(ws, s, CLOSE.silent, 'silent');
      else if (!s.hi && now - (s.joined ?? now) > HELLO_WAIT_MS) this.drop(ws, s, CLOSE.bad, 'no hello');
    }
  }

  /** Closes a connection with a code the game reads, after telling the others it left. */
  private drop(ws: WebSocket, seat: Seat, code: number, reason: string): void {
    this.leave(ws, seat);
    try {
      ws.close(code, reason);
    } catch {
      // Already closed.
    }
  }

  private leave(ws: WebSocket, seat: Seat): void {
    this.live.delete(ws);
    if (seat.m !== 'r' || seat.gone) return;
    const was = seat.hi === true;
    seat.gone = true;
    try {
      ws.serializeAttachment(seat);
    } catch {
      // A closed socket keeps its last attachment.
    }
    if (!was) return;
    this.toAll({ t: 'leave', id: seat.id });
    void this.ctx.storage.delete(`o${seat.id}`);
    void this.report();
  }

  /** Tells the map's lobby list how many ride here (a private lobby is never listed). */
  private async report(): Promise<void> {
    if (!this.meta) return;
    this.lastReport = Date.now();
    const { code, title, map, open } = this.meta;
    try {
      await this.env.LOBBIES.getByName(`lobbies-${map}`).report({ code, title, riders: this.riders().length, max: ROOM_MAX, at: 0 }, open);
    } catch (err) {
      console.error('lobby list', err);
    }
  }
}

function seatOf(ws: WebSocket): Seat {
  return (ws.deserializeAttachment() as Seat | null) ?? { m: 'r', gone: true };
}

function send(ws: WebSocket, body: unknown): void {
  trySend(ws, JSON.stringify(body));
}

function trySend(ws: WebSocket, data: string | ArrayBuffer): void {
  try {
    ws.send(data);
  } catch {
    // A socket closing as we send: its close handler tidies up.
  }
}

function clampUnit(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.max(-1, Math.min(1, v)) * 1000) / 1000 : 0;
}

function jsonObject(text: string): boolean {
  try {
    const v: unknown = JSON.parse(text);
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  } catch {
    return false;
  }
}

/** Whether `code` is the developer's (the DEV_CODE secret), compared in constant time. */
async function devCode(secret: string | undefined, code: string): Promise<boolean> {
  if (!secret || code.length === 0 || code.length > 200) return false;
  const hash = async (t: string): Promise<Uint8Array> => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)));
  const [a, b] = await Promise.all([hash(secret), hash(code)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/** The sequence number an echo test message carries ("q"), or -1. */
function seqOf(text: string): number {
  const m = /"q":(\d{1,9})/.exec(text);
  return m ? Number(m[1]) : -1;
}

/**
 * A socket that opens and closes at once with a code the game can read: the
 * browser can't see a refused handshake's status, so a refusal (multiplayer
 * full today, a full lobby, a bad request) is an accepted socket closed with a 4xxx code.
 */
export function refusedSocket(code: number, reason: string): Response {
  const pair = new WebSocketPair();
  const [client, server] = [pair[0], pair[1]];
  server.accept();
  server.close(code, reason);
  return new Response(null, { status: 101, webSocket: client });
}

/** Whether an error from a Durable Object call looks like the day's limit running out. */
export function quotaError(err: unknown): boolean {
  return /limit|quota|exceeded|1027/i.test(String(err));
}
