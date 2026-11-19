import { DurableObject } from 'cloudflare:workers';
import { LIST_MAX_LOBBIES, LIST_STALE_S, type LobbyEntry } from '../../src/online/mpRules.ts';

export type { LobbyEntry };

// One map's list of open lobbies (milestone 27): one Durable Object per map
// (`lobbies-<map>`). Each lobby (room.ts) reports itself when someone joins
// or leaves, and every few minutes while anyone rides in it; private lobbies
// and empty ones are never listed. Kept in the object's storage (it isn't
// a socket object, so it doesn't stay in memory), one row per lobby.

export class Lobbies extends DurableObject {
  /** A lobby's count, title and whether it's listed; 0 riders or private takes it off. */
  async report(entry: LobbyEntry, open: boolean): Promise<void> {
    const key = `l:${entry.code}`;
    if (!open || entry.riders <= 0) await this.ctx.storage.delete(key);
    else await this.ctx.storage.put(key, { ...entry, at: Date.now() });
  }

  /** The open lobbies, the fullest first; ones silent too long are dropped. */
  async list(): Promise<LobbyEntry[]> {
    const rows = await this.ctx.storage.list<LobbyEntry>({ prefix: 'l:' });
    const now = Date.now();
    const out: LobbyEntry[] = [];
    const stale: string[] = [];
    for (const [key, e] of rows) {
      if (now - e.at > LIST_STALE_S * 1000) stale.push(key);
      else out.push(e);
    }
    if (stale.length) await this.ctx.storage.delete(stale);
    out.sort((a, b) => b.riders - a.riders || b.at - a.at);
    return out.slice(0, LIST_MAX_LOBBIES);
  }
}
