import { apiGet, apiSend } from './api.ts';
import { OUTFIT_MAX, SKIS_MAX } from './limits.ts';

// A look saved online under a board name: the Locker's outfit and every
// custom ski slot, as the same JSON text this computer keeps them in
// (outfit.v1, customSkis.v1). One per name (in any case); nobody owns a name,
// so anyone can load or replace it. The leaderboard API (api.ts) checks the
// name, the shape and the sizes. ?boards=test uses the test looks.

export interface SavedLook {
  name: string;
  /** outfit.v1's JSON (core/outfit.ts outfitFrom reads it). */
  outfit: string;
  /** customSkis.v1's JSON (core/customSkis.ts setCustomSkisText reads it). */
  skis: string;
}

/** The look saved under `name`, or null if none is. */
export async function fetchLook(name: string): Promise<SavedLook | null> {
  const { look } = await apiGet<{ look: SavedLook | null }>('/v1/look', { name });
  return look;
}

/** Saves a look under `name`, replacing any there. False when it's too big for the API (nothing is sent). */
export async function saveLook(look: SavedLook): Promise<boolean> {
  if (look.outfit.length > OUTFIT_MAX || look.skis.length > SKIS_MAX) return false;
  await apiSend('PUT', '/v1/look', look);
  return true;
}
