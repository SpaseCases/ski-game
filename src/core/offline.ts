import { isEmbedded } from '../ui/embed.ts';
import { isTouchScreen } from '../ui/phone.ts';

// Playing with no connection (2026-11-24, the user's ask: the game as an app
// on his phone). tools/vite/offline.js writes dist/sw.js, a service worker
// that keeps a copy of the whole build; once it has, the game opens and
// rides with no connection (the leaderboards and multiplayer say they're
// offline, as before).
//
// Registered only where it's wanted, and only after the game has started
// (nothing loads before the first input): production builds, not in an
// embed (a school's Google Sites page stays as it was), and only on a touch
// screen or when opened from the home screen. The worker then fetches the
// build in the background, on its own thread.

/** How long after the game starts before the worker's download begins, so it doesn't compete with the first map's. */
const DELAY_MS = 8000;

/** True when the game was opened from the home screen (installed), not a browser tab. */
function installed(): boolean {
  try {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}

/** Registers the offline worker when this is a phone or the installed game (see above). */
export function registerOffline(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || isEmbedded()) return;
  if (!installed() && !isTouchScreen()) return;
  window.setTimeout(() => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // Refused (private browsing, blocked storage): the game runs online as before.
    });
  }, DELAY_MS);
}
