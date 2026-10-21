/** "Crashed" notice shown while the skier tumbles, naming the respawn key. */
export function mountCrashHint(hud: HTMLElement): { show(visible: boolean): void; setKey(key: string): void } {
  const el = document.createElement('div');
  el.className = 'crash-hint';
  el.hidden = true;
  hud.appendChild(el);
  return {
    show(visible: boolean): void {
      if (el.hidden === visible) el.hidden = !visible;
    },
    setKey(key: string): void {
      el.textContent = `Crashed! Press ${key} to skip`;
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
