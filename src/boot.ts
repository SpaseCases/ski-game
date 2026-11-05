// The page's entry: a start screen that waits for the player. Until the first
// click, tap or key press nothing else is fetched or run: no Three.js, no
// WebGL, no game loop. An idle tab, or a Google Sites page with the game
// embedded and not yet played, costs a Chromebook next to nothing. Then the
// game (main.ts, a lazy chunk) loads and removes this screen.
//
// A URL naming a map (?map=park, for testing) starts at once.
// This file must stay tiny and import nothing.

const boot = document.getElementById('boot');
const note = boot?.querySelector('span') ?? null;

/** Keys that never start the game: moving focus, and modifiers held on their own. */
const IGNORED = new Set(['Tab', 'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Escape']);

let started = false;

function start(): void {
  if (started) return;
  started = true;
  window.removeEventListener('keydown', onKey, true);
  boot?.removeEventListener('pointerdown', start);
  boot?.classList.add('is-loading');
  if (note) note.textContent = 'Loading…';
  import('./main.ts').catch((err: unknown) => {
    console.error(err);
    started = false;
    boot?.classList.remove('is-loading');
    if (note) note.textContent = 'The game couldn’t load. Check the connection, then click to try again.';
    listen();
  });
}

function onKey(e: KeyboardEvent): void {
  if (IGNORED.has(e.key) || e.ctrlKey || e.metaKey || e.altKey) return;
  // The key only starts the game; it doesn't reach it (or scroll the host page).
  e.preventDefault();
  start();
}

function listen(): void {
  window.addEventListener('keydown', onKey, true);
  boot?.addEventListener('pointerdown', start);
}

if (new URLSearchParams(window.location.search).has('map')) start();
else listen();
