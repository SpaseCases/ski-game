import { readStored, writeStored } from './storage.ts';

// The best banked combo on each map, saved locally as one versioned JSON
// entry ({ "park": 12400, ... }). Unreadable or wiped storage just means no
// bests yet; a new best still shows for this visit.

const KEY = 'bests.v1';

let bests: Record<string, number> | null = null;

function all(): Record<string, number> {
  if (bests) return bests;
  bests = {};
  try {
    const raw = readStored(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') {
      for (const [id, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'number' && Number.isFinite(v) && v > 0) bests[id] = Math.round(v);
      }
    }
  } catch {
    // Corrupt entry: no bests.
  }
  return bests;
}

/** The best combo saved for a map (0: none yet). */
export function bestCombo(mapId: string): number {
  return all()[mapId] ?? 0;
}

/** Records a banked combo; returns true when it beat the map's best (and is now saved as it). */
export function submitCombo(mapId: string, total: number): boolean {
  const b = all();
  if (total <= (b[mapId] ?? 0)) return false;
  b[mapId] = total;
  writeStored(KEY, JSON.stringify(b));
  return true;
}
