// The page's entry: a start screen that waits for the player. Until the first
// click, tap, key press or controller button nothing else is fetched or run
// (the browser tells a page about a controller only once a button is
// pressed on it: one event, no polling, milestone 26): no Three.js, no
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
  window.removeEventListener('gamepadconnected', start);
  boot?.removeEventListener('pointerdown', start);
  boot?.classList.add('is-loading');
  if (note) note.textContent = 'Loading…';
  import('./main.ts').catch((err: unknown) => {
    console.error(err);
    started = false;
    boot?.classList.remove('is-loading');
    if (note) note.textContent = `The game couldn’t load. Check the connection, then ${touchScreen() ? 'tap' : 'click'} to try again.`;
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
  window.addEventListener('gamepadconnected', start);
  boot?.addEventListener('pointerdown', start);
}

/** True on a phone or tablet: a finger taps, so the words say "tap". */
function touchScreen(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

// Phones (2026-11-24). A finger's tap starts the game like a click (the
// pointerdown above). Held upright, a phone shows a sign over everything
// (index.html's #rotate, shown by CSS only while upright and narrow) asking
// to turn it sideways, with a button to play upright anyway.
if (touchScreen()) {
  if (note && !boot?.classList.contains('is-loading')) note.textContent = 'Tap or press a controller button to start';
  const rotate = document.createElement('div');
  rotate.id = 'rotate';
  rotate.innerHTML =
    '<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="8" y="20" width="48" height="26" rx="5" fill="none" stroke="#f4f8fc" stroke-width="3"/>' +
    '<path d="M20 12 A20 20 0 0 1 48 14" fill="none" stroke="#ff7a1a" stroke-width="3"/><path d="M48 6 L48 14 L40 14" fill="none" stroke="#ff7a1a" stroke-width="3"/></svg>' +
    '<b>Turn your phone sideways</b><p>Park Laps is made for a wide screen. You ride with a controller and tap or steer through the menus.</p>' +
    '<button type="button">Play upright anyway</button>';
  rotate.querySelector('button')?.addEventListener('click', () => rotate.classList.add('is-dismissed'));
  document.body.appendChild(rotate);
}

if (new URLSearchParams(window.location.search).has('map')) start();
else listen();
