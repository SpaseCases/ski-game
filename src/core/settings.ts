import { CONFIG } from '../config.ts';
import { ACTIONS, DEFAULT_BINDINGS, type Action, type Bindings } from './input.ts';
import { readStored, writeStored } from './storage.ts';

// Player settings, saved locally as one versioned JSON entry. Anything
// missing or malformed falls back to its default, so a wiped or blocked
// storage just means the defaults. A `?quality=low` URL parameter overrides
// the saved preset for that visit, for testing.

export type Quality = 'auto' | 'low' | 'medium' | 'high';
export const QUALITIES: readonly Quality[] = ['auto', 'low', 'medium', 'high'];

/** Keys per action: a main key and an optional second one. */
export const KEY_SLOTS = 2;

export interface Settings {
  quality: Quality;
  /** 0..1. Saved now; sound arrives in milestone 7. */
  masterVolume: number;
  sfxVolume: number;
  muted: boolean;
  bindings: Bindings;
}

const KEY = 'settings.v1';
/** Before settings.v1 only the quality preset was saved, under this key. */
const OLD_QUALITY_KEY = 'quality';

function isQuality(value: unknown): value is Quality {
  return typeof value === 'string' && (QUALITIES as readonly string[]).includes(value);
}

export function defaultSettings(): Settings {
  return { quality: 'auto', masterVolume: 0.8, sfxVolume: 0.8, muted: false, bindings: { ...DEFAULT_BINDINGS } };
}

/** The saved settings, or the defaults for anything not saved (or unreadable). */
export function loadSettings(): Settings {
  const out = defaultSettings();
  let saved: Record<string, unknown> = {};
  try {
    const raw = readStored(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') saved = parsed as Record<string, unknown>;
  } catch {
    // Corrupt entry: keep the defaults.
  }
  const quality = saved.quality ?? readStored(OLD_QUALITY_KEY);
  if (isQuality(quality)) out.quality = quality;
  out.masterVolume = unit(saved.masterVolume, out.masterVolume);
  out.sfxVolume = unit(saved.sfxVolume, out.sfxVolume);
  if (typeof saved.muted === 'boolean') out.muted = saved.muted;
  out.bindings = readBindings(saved.bindings);
  return out;
}

export function saveSettings(s: Settings): void {
  writeStored(KEY, JSON.stringify(s));
}

/** The preset named in the URL (?quality=low), which wins over the saved one for this visit. */
export function urlQuality(): Quality | null {
  const q = new URLSearchParams(window.location.search).get('quality');
  return isQuality(q) ? q : null;
}

function unit(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
}

/**
 * Saved bindings, checked: each action keeps its saved keys if they're a
 * list of up to KEY_SLOTS key codes (none: unbound by a swap), else its defaults (so an action added in
 * a later version gets its default key). A key may belong to one action only;
 * if saved data breaks that, the defaults are used.
 */
function readBindings(value: unknown): Bindings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_BINDINGS };
  const saved = value as Record<string, unknown>;
  const out = { ...DEFAULT_BINDINGS };
  for (const action of ACTIONS) {
    const keys = saved[action];
    if (Array.isArray(keys) && keys.length <= KEY_SLOTS && keys.every((k) => typeof k === 'string' && k !== '' && k !== 'Escape')) {
      out[action] = keys as string[];
    }
  }
  const seen = new Set<string>();
  for (const action of ACTIONS) {
    for (const code of out[action]) {
      if (seen.has(code)) return { ...DEFAULT_BINDINGS };
      seen.add(code);
    }
  }
  return out;
}

/** What a rebinding did to another action, if anything. */
export interface Displaced {
  action: Action;
  /** The key that action has now in place of the one taken (null: none). */
  now: string | null;
  /** True when that action is left with no key at all. */
  unbound: boolean;
}

/**
 * Puts key `code` in `action`'s slot `slot` (0 main, 1 second). If another
 * action had the key, the two swap: it gets this slot's old key, or loses the
 * key if this slot was empty (its second key, if any, moves up to be its
 * main one). Returns new bindings and what happened to the other action.
 */
export function assignKey(bindings: Bindings, action: Action, slot: number, code: string): { bindings: Bindings; displaced: Displaced | null } {
  const out: Record<Action, string[]> = {} as Record<Action, string[]>;
  for (const a of ACTIONS) out[a] = [...bindings[a]];
  const mine = out[action];
  const old = mine[slot] ?? null;
  if (old === code) return { bindings: out, displaced: null };

  let displaced: Displaced | null = null;
  for (const other of ACTIONS) {
    const keys = out[other];
    const at = keys.indexOf(code);
    if (at < 0) continue;
    if (other === action) {
      // Already this action's other slot: the two slots swap.
      if (old !== null) keys[at] = old;
      else keys.splice(at, 1);
      break;
    }
    if (old !== null && !keys.includes(old)) keys[at] = old;
    else keys.splice(at, 1);
    displaced = { action: other, now: old, unbound: keys.length === 0 };
    break;
  }
  const slotNow = Math.min(slot, mine.length);
  if (slotNow < mine.length) mine[slotNow] = code;
  else mine.push(code);
  return { bindings: out, displaced };
}

/** Removes `action`'s second key (the main key can only be replaced, never removed). */
export function clearSecondKey(bindings: Bindings, action: Action): Bindings {
  const first = bindings[action][0];
  return { ...bindings, [action]: first ? [first] : [] };
}

/** How far (m) a preset draws the world, where its haze starts, and where the haze is complete. */
export function viewRange(q: Quality): { far: number; fogStart: number; hazeEnd: number } {
  return { far: CONFIG.quality.viewDistance[q], fogStart: CONFIG.quality.fogStart[q], hazeEnd: CONFIG.quality.hazeEnd[q] };
}

/** Share (0..1) of scenery decoration a preset draws. Solid decoration is always drawn. */
export function decorDensity(q: Quality): number {
  return CONFIG.quality.decorDensity[q];
}

/** What a preset gives the snow effects: see CONFIG.snowFx. */
export interface SnowBudget {
  particles: number;
  rate: number;
  trackPoints: number;
  trackLife: number;
  ridgeRange: number;
}

export function snowBudget(q: Quality): SnowBudget {
  const f = CONFIG.snowFx;
  return { particles: f.particles[q], rate: f.rate[q], trackPoints: f.trackPoints[q], trackLife: f.trackLife[q], ridgeRange: f.ridgeRange[q] };
}
