import { readStored, writeStored } from './storage.ts';

// The best banked combo on each map, saved locally as one versioned JSON
// entry ({ "park": 12400, "park#cheats": 30100, ... }): a combo ridden with
// cheats on saves under the map's "#cheats" entry, never as its clean best.
// Unreadable or wiped storage just means no bests yet; a new best still
// shows for this visit. Saving re-reads the entry first, so a best set in
// another open tab isn't overwritten.

const KEY = 'bests.v1';

let bests: Record<string, number> | null = null;

/** The saved entry's bests (none if it's missing or corrupt). */
function readAll(): Record<string, number> {
  const out: Record<string, number> = {};
  try {
    const raw = readStored(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') {
      for (const [id, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[id] = Math.round(v);
      }
    }
  } catch {
    // Corrupt entry: no bests.
  }
  return out;
}

function all(): Record<string, number> {
  bests ??= readAll();
  return bests;
}

function key(mapId: string, cheats: boolean): string {
  return cheats ? `${mapId}#cheats` : mapId;
}

/** The best combo saved for a map, clean or with cheats (0: none yet). */
export function bestCombo(mapId: string, cheats = false): number {
  return all()[key(mapId, cheats)] ?? 0;
}

/** Records a banked combo (`cheats`: ridden with cheats on); returns true when it beat that best (and is now saved as it). */
export function submitCombo(mapId: string, total: number, cheats = false): boolean {
  const b = all();
  // Another tab may have saved since this one read: keep the higher of each.
  for (const [id, v] of Object.entries(readAll())) b[id] = Math.max(b[id] ?? 0, v);
  const k = key(mapId, cheats);
  if (total <= (b[k] ?? 0)) return false;
  b[k] = total;
  writeStored(KEY, JSON.stringify(b));
  return true;
}
