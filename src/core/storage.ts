// localStorage can throw (blocked site data, private windows, sandboxed
// iframes) or be wiped at any time. Every read and write goes through here,
// and the game works the same without it.

const PREFIX = 'parkLaps.';

export function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

/** Removes everything the game saved in this browser (every `parkLaps.` key), leaving other sites' data alone. */
export function clearStored(): void {
  try {
    const store = window.localStorage;
    const ours: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key?.startsWith(PREFIX)) ours.push(key);
    }
    for (const key of ours) store.removeItem(key);
  } catch {
    // Blocked storage: nothing was saved, so there's nothing to erase.
  }
}

export function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(PREFIX + key, value);
  } catch {
    // Not saved; the setting still applies for this visit.
  }
}
