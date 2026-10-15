/** Key reminder until the Controls menu exists. */
export function mountControlsHint(hud: HTMLElement): void {
  const el = document.createElement('div');
  el.className = 'controls-hint';
  el.innerText =
    '← → turn · hold ↑ crouch, release to pop · ↓ brake · Shift pole push · R restart · drag to look around\n' +
    'In the air: ← → spin · ↑ ↓ flip · Q E Lincoln loop · grabs A S D F (left hand) Z X C V (right hand)\n' +
    'On a rail or box (land on it): ← → turn skis straight or sideways · hold and release ↑ to pop off';
  hud.appendChild(el);
}

/** "Crashed" notice shown while the skier tumbles. */
export function mountCrashHint(hud: HTMLElement): { show(visible: boolean): void } {
  const el = document.createElement('div');
  el.className = 'crash-hint';
  el.textContent = 'Crashed! Press R to skip';
  el.hidden = true;
  hud.appendChild(el);
  return {
    show(visible: boolean): void {
      if (el.hidden === visible) el.hidden = !visible;
    },
  };
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
