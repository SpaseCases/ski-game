import { CONFIG } from '../config.ts';
import { readStored, writeStored } from './storage.ts';

// Player settings. For now just the quality preset; the Settings menu
// (milestone 6) adds the rest. A `?quality=low` URL parameter overrides the
// saved preset, for testing.

export type Quality = 'auto' | 'low' | 'medium' | 'high';
export const QUALITIES: readonly Quality[] = ['auto', 'low', 'medium', 'high'];

function isQuality(value: unknown): value is Quality {
  return typeof value === 'string' && (QUALITIES as readonly string[]).includes(value);
}

export function loadQuality(): Quality {
  const fromUrl = new URLSearchParams(window.location.search).get('quality');
  if (isQuality(fromUrl)) return fromUrl;
  const saved = readStored('quality');
  return isQuality(saved) ? saved : 'auto';
}

export function saveQuality(q: Quality): void {
  writeStored('quality', q);
}

/** Share (0..1) of scenery decoration a preset draws. Solid decoration is always drawn. */
export function decorDensity(q: Quality): number {
  return CONFIG.quality.decorDensity[q];
}
