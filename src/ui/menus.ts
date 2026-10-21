import { inTuningPanel } from '../core/input.ts';
import { keycap } from './keyNames.ts';
import { signText } from './signText.ts';

// The menu system: one overlay holding a stack of screens (title, pause, map
// select, settings, controls, and later cheats, the Locker and weather).
// It owns keyboard routing for the whole page:
// - a key trap (Settings listening for a new key) gets the next key first;
// - with a menu open, arrows move focus spatially, Tab cycles inside the
//   menu, Enter and Space press the focused button (as buttons do), and Esc
//   goes back a screen;
// - with no menu open, keys go to the game's handler;
// - keys pressed in the tuning panel are left to it (Esc lets go of it).
// Game keys never reach the skier while a menu is open: the game turns its
// Keyboard off whenever a menu opens.

export interface Screen {
  readonly el: HTMLElement;
  /** Shown (opened, or returned to). Returns the element to focus first. */
  enter(): HTMLElement | null;
  /** Covered by another screen or closed. */
  leave?(): void;
  /** False while going back would lose something (a map loading). */
  canGoBack?(): boolean;
  /** First look at a key while this screen is on top; true when it was used. */
  onKey?(e: KeyboardEvent): boolean;
}

interface Entry {
  screen: Screen;
  /** What had focus on this screen when another opened over it, to focus again on return. */
  focus: HTMLElement | null;
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex="0"]';

export class Menus {
  private readonly root: HTMLElement;
  /** Painted backdrop behind the screens while no map is loaded (see setScenery). */
  readonly scenery: HTMLElement;
  private readonly stack: Entry[] = [];
  private trap: ((e: KeyboardEvent) => void) | null = null;
  /** The clip-path cutting the Locker's window, or '' for none. */
  private hole = '';
  private readonly onRootBack: (screen: Screen) => void;
  private readonly onGameKey: (e: KeyboardEvent) => void;
  private readonly outside: () => HTMLElement[];

  /**
   * `onRootBack`: Esc on the bottom screen (the pause menu resumes; the title
   * stays). `onGameKey`: a key pressed while no menu is open. `outside`:
   * buttons outside the menu that Tab also reaches (the window buttons).
   */
  constructor(hud: HTMLElement, onRootBack: (screen: Screen) => void, onGameKey: (e: KeyboardEvent) => void, outside: () => HTMLElement[]) {
    this.onRootBack = onRootBack;
    this.onGameKey = onGameKey;
    this.outside = outside;
    this.root = document.createElement('div');
    this.root.className = 'menu';
    this.root.hidden = true;
    this.scenery = document.createElement('div');
    this.scenery.className = 'menu-scenery';
    this.scenery.setAttribute('aria-hidden', 'true');
    this.root.appendChild(this.scenery);
    hud.appendChild(this.root);
    // A click on empty space keeps focus where it is, so a choice always shows as focused.
    this.root.addEventListener('mousedown', (e) => {
      if (!(e.target instanceof Element) || !e.target.closest(`${FOCUSABLE}, label`)) e.preventDefault();
    });
    // Capture phase, so menu keys are settled before anything else sees them.
    window.addEventListener('keydown', (e) => this.onKeyDown(e), true);
  }

  add(screen: Screen): void {
    screen.el.hidden = true;
    this.root.appendChild(screen.el);
  }

  get isOpen(): boolean {
    return this.stack.length > 0;
  }

  get top(): Screen | null {
    return this.stack[this.stack.length - 1]?.screen ?? null;
  }

  /** Whether the title's painted mountain covers the game (no map loaded) or the game shows through, dimmed. */
  setScenery(painted: boolean): void {
    this.root.classList.toggle('is-painted', painted);
  }

  /**
   * Cuts a see-through hole in the menu at `rect` (viewport CSS pixels), so the
   * game's canvas shows through it (the Locker's preview). Null fills it in.
   */
  setHole(rect: { x: number; y: number; width: number; height: number } | null): void {
    let clip = '';
    if (rect && rect.width > 0 && rect.height > 0) {
      const { x, y } = rect;
      const r = x + rect.width;
      const b = y + rect.height;
      clip = `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${x}px ${y}px, ${r}px ${y}px, ${r}px ${b}px, ${x}px ${b}px, ${x}px ${y}px)`;
    }
    if (clip !== this.hole) {
      this.hole = clip;
      this.root.style.clipPath = clip;
    }
  }

  /** Opens `screen` as the only screen (the title, or the pause menu). */
  open(screen: Screen): void {
    this.hideTop();
    this.stack.length = 0;
    this.stack.push({ screen, focus: null });
    this.root.hidden = false;
    document.body.classList.add('menu-open');
    this.showTop(null);
  }

  /** Opens `screen` over the current one; Esc or back() returns. */
  push(screen: Screen): void {
    const below = this.stack[this.stack.length - 1];
    if (below) below.focus = document.activeElement instanceof HTMLElement && below.screen.el.contains(document.activeElement) ? document.activeElement : null;
    this.hideTop();
    this.stack.push({ screen, focus: null });
    this.showTop(null);
  }

  /** Back one screen; on the bottom screen, asks the game (onRootBack). */
  back(): void {
    const top = this.top;
    if (!top || top.canGoBack?.() === false) return;
    if (this.stack.length === 1) {
      this.onRootBack(top);
      return;
    }
    this.hideTop();
    this.stack.pop();
    this.showTop(this.stack[this.stack.length - 1]!.focus);
  }

  close(): void {
    if (!this.isOpen) return;
    this.hideTop();
    this.stack.length = 0;
    this.trap = null;
    this.root.hidden = true;
    document.body.classList.remove('menu-open');
    // Drop focus so Enter or Space can't press a hidden button.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }

  /** The next key goes to `fn` and nowhere else (Settings listening for a new key). Null cancels. */
  trapNextKey(fn: ((e: KeyboardEvent) => void) | null): void {
    this.trap = fn;
  }

  private showTop(focus: HTMLElement | null): void {
    const top = this.top;
    if (!top) return;
    top.el.hidden = false;
    this.root.scrollTop = 0;
    const first = top.enter();
    (focus && top.el.contains(focus) ? focus : first ?? this.focusables()[0])?.focus({ preventScroll: true });
  }

  private hideTop(): void {
    const top = this.top;
    if (!top) return;
    top.leave?.();
    top.el.hidden = true;
  }

  private focusables(): HTMLElement[] {
    const top = this.top;
    if (!top) return [];
    return [...top.el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (this.trap) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat) return;
      const fn = this.trap;
      this.trap = null;
      fn(e);
      return;
    }
    if (inTuningPanel(e.target)) {
      if (e.key === 'Escape' && e.target instanceof HTMLElement) e.target.blur();
      return;
    }
    if (!this.isOpen) {
      this.onGameKey(e);
      return;
    }
    if (this.top?.onKey?.(e)) {
      e.preventDefault();
      return;
    }
    const items = this.focusables();
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const at = active ? items.indexOf(active) : -1;
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        if (!e.repeat) this.back();
        return;
      case 'Tab': {
        e.preventDefault();
        const ring = [...items, ...this.outside().filter(visible)];
        const from = active ? ring.indexOf(active) : -1;
        const next = from < 0 ? (e.shiftKey ? ring.length - 1 : 0) : (from + (e.shiftKey ? -1 : 1) + ring.length) % ring.length;
        ring[next]?.focus();
        return;
      }
      case 'Enter':
      case ' ':
        // Pressed on a focused button, the browser clicks it. With nothing focused, focus the first item.
        if (at < 0 && !(active && this.outside().includes(active))) {
          e.preventDefault();
          items[0]?.focus();
        }
        return;
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight': {
        const horizontal = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
        // Sliders keep left and right for their value.
        if (horizontal && active instanceof HTMLInputElement && active.type === 'range') return;
        e.preventDefault();
        if (at < 0) {
          items[0]?.focus();
          return;
        }
        const dir = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 1;
        const next = horizontal ? across(items, at, dir) : upDown(items, at, dir);
        next?.focus();
        return;
      }
    }
  }
}

function visible(el: HTMLElement): boolean {
  return el.getClientRects().length > 0;
}

/**
 * The item in the next row up (-1) or down (1) from item `from`: the nearest
 * one in the same column (overlapping it across) if any, else the nearest
 * row's item closest across. Past the last row it wraps to the other end.
 */
function upDown(items: readonly HTMLElement[], from: number, dir: number): HTMLElement | undefined {
  const a = items[from]!.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  let column: HTMLElement | undefined;
  let columnGap = Infinity;
  let best: HTMLElement | undefined;
  let bestGap = Infinity;
  let bestX = Infinity;
  for (const item of items) {
    if (item === items[from]) continue;
    const b = item.getBoundingClientRect();
    const gap = dir > 0 ? b.top - a.bottom : a.top - b.bottom;
    if (gap < -1) continue;
    if (b.left < a.right - 2 && b.right > a.left + 2 && gap < columnGap) {
      column = item;
      columnGap = gap;
    }
    const dx = Math.abs(b.left + b.width / 2 - ax);
    if (gap < bestGap - 2 || (Math.abs(gap - bestGap) <= 2 && dx < bestX)) {
      best = item;
      bestGap = gap;
      bestX = dx;
    }
  }
  return column ?? best ?? (dir > 0 ? items[0] : items[items.length - 1]);
}

/** The nearest item left (-1) or right (1) in the same row; at a row's end, the next item in order. */
function across(items: readonly HTMLElement[], from: number, dir: number): HTMLElement | undefined {
  const a = items[from]!.getBoundingClientRect();
  let best: HTMLElement | undefined;
  let bestGap = Infinity;
  for (const item of items) {
    if (item === items[from]) continue;
    const b = item.getBoundingClientRect();
    const sameRow = b.top < a.bottom - 2 && b.bottom > a.top + 2;
    if (!sameRow) continue;
    const gap = dir > 0 ? b.left - a.right : a.left - b.right;
    if (gap < -1) continue;
    if (gap < bestGap) {
      best = item;
      bestGap = gap;
    }
  }
  return best ?? items[(from + dir + items.length) % items.length];
}

// Building blocks the screens share.

/** A screen's sign board: a heading in the sign font, an optional line under it, then the body. */
export function board(heading: string, className = ''): { el: HTMLElement; head: HTMLElement; sub: HTMLElement; body: HTMLElement; foot: HTMLElement } {
  const el = document.createElement('section');
  el.className = `menu-screen ${className}`.trim();
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', heading);
  const sign = document.createElement('div');
  sign.className = 'board';
  const head = document.createElement('header');
  head.className = 'board-head';
  const h = document.createElement('h1');
  h.className = 'board-title';
  h.appendChild(signText(heading));
  const sub = document.createElement('p');
  sub.className = 'board-sub';
  sub.hidden = true;
  const titles = document.createElement('div');
  titles.className = 'board-titles';
  titles.append(h, sub);
  head.appendChild(titles);
  const body = document.createElement('div');
  body.className = 'board-body';
  const foot = document.createElement('footer');
  foot.className = 'board-foot';
  sign.append(head, body, foot);
  el.appendChild(sign);
  return { el, head, sub, body, foot };
}

/** A sign plank: a menu choice, with the key that does the same in game (if any) on its right. */
export function plank(label: string, onPick: () => void, keys: readonly string[] = []): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'plank';
  const text = document.createElement('span');
  text.className = 'plank-label';
  text.textContent = label;
  const keyBox = document.createElement('span');
  keyBox.className = 'plank-keys';
  b.append(text, keyBox);
  setPlankKeys(b, keys);
  b.addEventListener('click', onPick);
  return b;
}

export function setPlankKeys(b: HTMLElement, keys: readonly string[]): void {
  const box = b.querySelector('.plank-keys');
  box?.replaceChildren(...keys.map(keycap));
}

/** The key hints along a board's foot: pairs of keys and what they do. */
export function setHints(foot: HTMLElement, hints: readonly (readonly [readonly string[], string])[]): void {
  foot.replaceChildren(
    ...hints.map(([keys, what]) => {
      const span = document.createElement('span');
      span.className = 'hint';
      span.append(...keys.map(keycap), document.createTextNode(what));
      return span;
    }),
  );
}

/** The Back button at the top of a screen's board, for the mouse (Esc does the same). */
export function addBackButton(head: HTMLElement, onBack: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'board-back';
  b.append(document.createTextNode('Back'), keycap('Esc'));
  b.addEventListener('click', onBack);
  head.appendChild(b);
  return b;
}
