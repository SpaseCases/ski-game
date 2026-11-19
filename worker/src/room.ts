import { DurableObject } from 'cloudflare:workers';

// Multiplayer rooms (milestone 27): one Durable Object per room, its sockets
// accepted with the Hibernation API, so an object with nothing to do isn't
// billed for the time it sits there. For now it only holds the socket test:
// an echo that replies to each message and fans out copies the size of what
// the other riders in a room would send, so the test page sees real sizes
// and rates both ways.
//
// Cost on Workers Free (Cloudflare's docs, rechecked 2026-11-18): opening a
// socket is one request, incoming messages count 20 to one, outgoing ones
// and the "ping" auto-response are free; 100,000 requests and 13,000 GB-s a
// day, then calls fail until midnight UTC.

/** The largest message taken from a client, in characters. */
export const MESSAGE_MAX = 1024;
/** The most copies the echo fans out per message (the other riders in a room). */
export const FAN_MAX = 15;

interface EchoState {
  /** Messages this socket sent us. */
  got: number;
  /** Copies sent back for each message (1 = the echo alone). */
  fan: number;
}

export class Room extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    // Answered by Cloudflare without waking the object, and free: the client's dead-socket check.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const fan = Math.min(FAN_MAX, Math.max(1, Number(url.searchParams.get('fan')) || 1));
    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ got: 0, fan } satisfies EchoState);
      return new Response(null, { status: 101, webSocket: client });
    }
    // The HTTP route (polling): one message in, the echo and its copies out in one reply.
    const text = await request.text();
    if (text.length > MESSAGE_MAX) return new Response('{"error":"too big"}', { status: 413 });
    const seq = seqOf(text);
    const copies: string[] = [];
    for (let i = 1; i < fan; i++) copies.push(text);
    return new Response(`{"e":${seq},"d":${text},"o":[${copies.join(',')}]}`, {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  override webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message !== 'string' || message.length > MESSAGE_MAX) {
      ws.close(1009, 'message too big');
      return;
    }
    const state = (ws.deserializeAttachment() as EchoState | null) ?? { got: 0, fan: 1 };
    if (message === '{"t":"end"}') {
      ws.send(`{"end":${state.got}}`);
      return;
    }
    state.got++;
    ws.serializeAttachment(state);
    ws.send(`{"e":${seqOf(message)},"n":${state.got},"d":${message}}`);
    for (let i = 1; i < state.fan; i++) ws.send(`{"o":${i},"d":${message}}`);
  }

  override webSocketClose(ws: WebSocket, code: number, reason: string): void {
    // 1005 (no code) and 1006 (dropped) can't be sent back; close with a plain 1000.
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, reason);
    } catch {
      // Already closed.
    }
  }

  override webSocketError(): void {
    // Nothing kept per socket outside its attachment.
  }
}

/** The sequence number a test message carries ("q"), or -1. */
function seqOf(text: string): number {
  const m = /"q":(\d{1,9})/.exec(text);
  return m ? Number(m[1]) : -1;
}

/**
 * A socket that opens and closes at once with a code the game can read: the
 * browser can't see a refused handshake's status, so a refusal ("multiplayer
 * full today", a bad request) is an accepted socket closed with a 4xxx code.
 */
export function refusedSocket(code: number, reason: string): Response {
  const pair = new WebSocketPair();
  const [client, server] = [pair[0], pair[1]];
  server.accept();
  server.close(code, reason);
  return new Response(null, { status: 101, webSocket: client });
}

/** Close codes the game reads (4000 to 4999 are ours). */
export const CLOSE = {
  /** The day's free quota ran out ("Multiplayer is full today"). */
  full: 4429,
  /** The room couldn't be reached for another reason. */
  down: 4503,
  /** A bad request (route, parameters). */
  bad: 4400,
} as const;

/** Whether an error from a Durable Object call looks like the day's limit running out. */
export function quotaError(err: unknown): boolean {
  return /limit|quota|exceeded|1027/i.test(String(err));
}
