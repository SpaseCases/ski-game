/** True when the game runs inside another page's iframe (e.g. Google Sites). */
export function isEmbedded(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    // Some browsers throw when a cross-origin parent blocks access; that means embedded.
    return true;
  }
}

/**
 * Adds the window buttons to the HUD: "Open in new tab" when embedded, and
 * "Fullscreen" only when the browser allows it here. Returns the bar, so
 * other buttons can join it.
 */
export function mountWindowButtons(hud: HTMLElement): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'window-buttons';

  if (isEmbedded()) {
    const link = document.createElement('a');
    link.className = 'hud-button';
    link.href = window.location.href;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'Open in new tab';
    bar.appendChild(link);
  }

  if (document.fullscreenEnabled) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hud-button';
    const sync = (): void => {
      button.textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen';
    };
    button.addEventListener('click', () => {
      const request = document.fullscreenElement
        ? document.exitFullscreen()
        : document.documentElement.requestFullscreen();
      request.catch(() => {
        // Refused (no user gesture or blocked by policy). Nothing to do.
      });
    });
    document.addEventListener('fullscreenchange', sync);
    sync();
    bar.appendChild(button);
  }

  hud.appendChild(bar);
  return bar;
}
