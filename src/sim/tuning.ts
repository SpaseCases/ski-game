import { CONFIG } from '../config.ts';

// The numbers the simulation actually runs on. CONFIG (config.ts, edited
// live by the tuning panel) is the base; TUNING is that base times the ski's
// multipliers (milestone 6d) times every cheat that's on. It's rebuilt only
// when one of those changes, never per frame. With no ski multipliers and
// every cheat off it equals CONFIG exactly (a number times 1 is itself), so
// the headless sim tools, which read CONFIG, get the same results.

/** The cheats that scale numbers (each names its multipliers in CONFIG.cheats). */
export type ScaleCheat = keyof typeof CONFIG.cheats;
export type CheatId = ScaleCheat | 'noCrashes';

export const CHEAT_IDS: readonly CheatId[] = ['lowGravity', 'superFast', 'moonJump', 'slowMotion', 'noCrashes', 'turboSpins'];

/** Which cheats are on. Never saved: every visit starts with them off. */
export const CHEATS: Record<CheatId, boolean> = {
  lowGravity: false,
  superFast: false,
  moonJump: false,
  slowMotion: false,
  noCrashes: false,
  turboSpins: false,
};

/** The CONFIG blocks the simulation reads. */
const BLOCKS = ['sim', 'skier', 'air', 'landing', 'rails', 'bail', 'slalom', 'giantSlalom'] as const;
type Block = (typeof BLOCKS)[number];
export type Tuning = { [B in Block]: (typeof CONFIG)[B] };
/** Multipliers for some numbers of some blocks; any left out are 1. */
export type Scale = { [B in Block]?: { [K in keyof (typeof CONFIG)[B]]?: number } };

type Numbers = Record<string, number>;

/** config.ts's values as loaded, before the tuning panel touches CONFIG. */
const ORIGINAL = structuredClone(CONFIG);

export const TUNING = {} as Tuning;
for (const b of BLOCKS) (TUNING as Record<Block, Numbers>)[b] = { ...(CONFIG[b] as Numbers) };

/** The ski's multipliers. Milestone 6d sets them; until then every one is 1. */
let skiScale: Scale = {};

export function setSkiScale(scale: Scale): void {
  skiScale = scale;
  rebuildTuning();
}

export function setCheat(id: CheatId, on: boolean): void {
  CHEATS[id] = on;
  rebuildTuning();
}

/** Recomputes TUNING from CONFIG, the ski and the cheats. Call after any of them changes. */
export function rebuildTuning(): void {
  for (const b of BLOCKS) {
    const base = CONFIG[b] as Numbers;
    const out = (TUNING as Record<Block, Numbers>)[b];
    const ski = skiScale[b] as Numbers | undefined;
    for (const key in base) {
      let v = base[key]! * (ski?.[key] ?? 1);
      for (const id in CONFIG.cheats) {
        if (!CHEATS[id as ScaleCheat]) continue;
        const m = (CONFIG.cheats[id as ScaleCheat] as Scale)[b] as Numbers | undefined;
        if (m?.[key] !== undefined) v *= m[key];
      }
      out[key] = v;
    }
  }
}

/** True while any cheat is on. */
export function anyCheat(): boolean {
  return CHEAT_IDS.some((id) => CHEATS[id]);
}

/** True when the tuning panel has changed any number from config.ts's. */
export function configChanged(): boolean {
  return !sameValues(CONFIG, ORIGINAL);
}

/** Puts every number back to config.ts's, and rebuilds TUNING. */
export function resetConfig(): void {
  restore(CONFIG as unknown as Record<string, unknown>, ORIGINAL as unknown as Record<string, unknown>);
  rebuildTuning();
}

function sameValues(a: unknown, b: unknown): boolean {
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return a === b;
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  for (const key in rb) if (!sameValues(ra[key], rb[key])) return false;
  return true;
}

function restore(into: Record<string, unknown>, from: Record<string, unknown>): void {
  for (const key in from) {
    const v = from[key];
    if (typeof v === 'object' && v !== null) restore(into[key] as Record<string, unknown>, v as Record<string, unknown>);
    else into[key] = v;
  }
}
