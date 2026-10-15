/** One-line key reminder until the Controls menu exists. */
export function mountControlsHint(hud: HTMLElement): void {
  const el = document.createElement('div');
  el.className = 'controls-hint';
  el.textContent = '← → turn · hold ↑ crouch, release to pop · ↓ brake · Shift pole push · R restart · drag to look around';
  hud.appendChild(el);
}

/**
 * Shows "Click to play" whenever the page doesn't have keyboard focus, which
 * is the usual state of a game embedded in another page until it's clicked.
 */
export function mountFocusHint(hud: HTMLElement): void {
  const el = document.createElement('div');
  el.className = 'focus-hint';
  el.textContent = 'Click to play';
  hud.appendChild(el);

  const sync = (): void => {
    el.hidden = document.hasFocus();
  };
  window.addEventListener('focus', sync);
  window.addEventListener('blur', sync);
  sync();
}
