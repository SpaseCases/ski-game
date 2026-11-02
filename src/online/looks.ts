import { nameKey } from '../core/playerName.ts';
import { getDoc, setDoc, str } from './firestore.ts';

// A look saved online under a board name: the Locker's outfit and every
// custom ski slot, as the same JSON text this computer keeps them in
// (outfit.v1, customSkis.v1). One per name at looks/<name in lower case>;
// nobody owns a name, so anyone can load or replace it (firestore.rules
// checks only the shape and sizes). ?boards=test uses testLooks.

export interface SavedLook {
  name: string;
  /** outfit.v1's JSON (core/outfit.ts outfitFrom reads it). */
  outfit: string;
  /** customSkis.v1's JSON (core/customSkis.ts setCustomSkisText reads it). */
  skis: string;
}

/** The sizes firestore.rules accepts (nine checkerboard slots come to about 30,000 characters). */
const OUTFIT_MAX = 2000;
const SKIS_MAX = 50000;

const ROOT = new URLSearchParams(window.location.search).get('boards') === 'test' ? 'testLooks' : 'looks';

/** The look saved under `name`, or null if none is. */
export async function fetchLook(name: string): Promise<SavedLook | null> {
  const doc = await getDoc(`${ROOT}/${nameKey(name)}`);
  const f = doc?.fields;
  const outfit = f?.outfit?.stringValue;
  const skis = f?.skis?.stringValue;
  if (!f || outfit === undefined || skis === undefined) return null;
  return { name: f.name?.stringValue ?? name, outfit, skis };
}

/** Saves a look under `name`, replacing any there. False when it's too big for the rules (nothing is sent). */
export async function saveLook(look: SavedLook): Promise<boolean> {
  if (look.outfit.length > OUTFIT_MAX || look.skis.length > SKIS_MAX) return false;
  await setDoc(`${ROOT}/${nameKey(look.name)}`, { name: str(look.name), outfit: str(look.outfit), skis: str(look.skis) });
  return true;
}
