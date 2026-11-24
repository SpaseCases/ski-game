// Phones and tablets (2026-11-24): the game is played with a controller
// there (milestone 26), but a finger taps the menus and starts the game, so
// the words that say "click" say "tap" on a touch screen. The sizing is
// CSS (phone.css); this file has the two things scripts need.

/** True when the main pointer is a finger (a phone or tablet), so "click" reads as "tap". */
export function isTouchScreen(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/**
 * The menu's padding above and below its sign, in px, as laid out now
 * (style.css .menu: 58 + 16 on a Chromebook; less on a short phone screen,
 * more where a notch or the home bar takes room). The editors fit their
 * grids into the window's height less this. Read on opening and on resize,
 * never per frame.
 */
export function menuPadY(el: Element): number {
  const menu = el.closest('.menu');
  if (!menu) return 74;
  const style = getComputedStyle(menu);
  return (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
}
