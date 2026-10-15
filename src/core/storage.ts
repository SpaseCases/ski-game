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

export function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(PREFIX + key, value);
  } catch {
    // Not saved; the setting still applies for this visit.
  }
}
