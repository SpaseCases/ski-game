import { CONFIG } from '../config.ts';
import type { FocusDir, Menus, PadKey } from './menus.ts';

// Menus by pad (milestone 26): while a menu or the full trail map is open,
// main hands every pad code here instead of to the game. The d-pad sends
// the arrow keys (so a screen's own use of them works: an editor's cursor,
// the pause menu's weather), the left stick moves focus straight through
// Menus.moveFocus (so it can leave an editor's grid), A presses Enter on
// the focused element and then clicks it if nothing used the key, B and
// Start press Esc, X / Y / LB / RB press the screen's `padKeys` (X is
// Delete elsewhere: Settings clears a second key with it), and the right
// stick scrolls. Directions repeat while held (CONFIG.pad.menuDelay,
// menuRepeat). `frame` runs every frame, so this file is in the
// obfuscation's EXCLUDE list (no player-readable text).

const DPAD: Record<string, string> = { PadUp: 'ArrowUp', PadDown: 'ArrowDown', PadLeft: 'ArrowLeft', PadRight: 'ArrowRight' };
const STICK: Record<string, FocusDir> = { PadLSUp: 'up', PadLSDown: 'down', PadLSLeft: 'left', PadLSRight: 'right' };
const DELETE: PadKey = { key: 'Delete', code: 'Delete' };

export class PadNav {
  private readonly menus: Menus;
  /** The direction held now (a d-pad or left-stick code), and when it next repeats (s). */
  private held: string | null = null;
  private wait = 0;
  /** The element the right stick scrolls, found when it starts moving; px not yet scrolled. */
  private scroller: HTMLElement | null = null;
  private carry = 0;
  /** Whether A went down here (so its keyup goes out too). */
  private aDown = false;

  constructor(menus: Menus) {
    this.menus = menus;
  }

  /** A pad code going down or up while the menus (or the trail map) have the pad. */
  button(code: string, down: boolean): void {
    if (this.menus.trapped) return;
    if (!down) {
      if (code === this.held) this.held = null;
      if (code === 'PadA' && this.aDown) {
        this.aDown = false;
        send('keyup', 'Enter', 'Enter', false);
      }
      return;
    }
    if (DPAD[code] !== undefined || STICK[code] !== undefined) {
      this.held = code;
      this.wait = CONFIG.pad.menuDelay;
      this.direction(code, false);
      return;
    }
    switch (code) {
      case 'PadA': {
        const target = document.activeElement;
        this.aDown = true;
        if (!send('keydown', 'Enter', 'Enter', false) && target === document.activeElement && pressable(target)) target.click();
        return;
      }
      case 'PadB':
      case 'PadStart':
        send('keydown', 'Escape', 'Escape', false);
        return;
      case 'PadX':
        this.key(this.menus.top?.padKeys?.x ?? DELETE);
        return;
      case 'PadY':
        this.key(this.menus.top?.padKeys?.y);
        return;
      case 'PadLB':
        this.key(this.menus.top?.padKeys?.lb);
        return;
      case 'PadRB':
        this.key(this.menus.top?.padKeys?.rb);
        return;
    }
  }

  /** Every frame the pad is with the menus: repeats a held direction and scrolls with the right stick (`y`, -1 up to 1 down). */
  frame(dt: number, y: number): void {
    if (this.held !== null) {
      this.wait -= dt;
      if (this.wait <= 0) {
        this.wait += CONFIG.pad.menuRepeat;
        if (this.wait < 0) this.wait = CONFIG.pad.menuRepeat;
        this.direction(this.held, true);
      }
    }
    const throwNow = Math.abs(y);
    if (throwNow < CONFIG.pad.stickRelease) {
      this.scroller = null;
      this.carry = 0;
      return;
    }
    this.scroller ??= scrollerOf(document.activeElement);
    if (!this.scroller) return;
    // Past the dead zone the speed grows from nothing to full at full throw.
    const t = (throwNow - CONFIG.pad.stickRelease) / (1 - CONFIG.pad.stickRelease);
    this.carry += Math.sign(y) * t * CONFIG.pad.scrollSpeed * dt;
    const px = Math.trunc(this.carry);
    if (px === 0) return;
    this.carry -= px;
    this.scroller.scrollTop += px;
  }

  /** Drops whatever is held (the pad goes back to the game, or a menu opened under it). */
  reset(): void {
    this.held = null;
    this.scroller = null;
    this.carry = 0;
    this.aDown = false;
  }

  private direction(code: string, repeat: boolean): void {
    const stick = STICK[code];
    if (stick !== undefined) {
      this.menus.moveFocus(stick);
      return;
    }
    const key = DPAD[code]!;
    const active = document.activeElement;
    // A slider takes left and right as its value, which a made-up key press can't change.
    if (active instanceof HTMLInputElement && active.type === 'range' && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      if (key === 'ArrowLeft') active.stepDown();
      else active.stepUp();
      active.dispatchEvent(new Event('input', { bubbles: true }));
      active.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    send('keydown', key, key, repeat);
  }

  private key(k: PadKey | undefined): void {
    if (k) send('keydown', k.key, k.code, false);
  }
}

/** Sends a key event to the focused element (it reaches the window's listeners as a real one would); true if something used it. */
function send(type: 'keydown' | 'keyup', key: string, code: string, repeat: boolean): boolean {
  const target = document.activeElement ?? document.body;
  const e = new KeyboardEvent(type, { key, code, repeat, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e.defaultPrevented;
}

/** What A clicks once nothing took its Enter: buttons, links, check boxes and anything acting as a button. */
function pressable(el: Element | null): el is HTMLElement {
  if (el instanceof HTMLButtonElement) return !el.disabled;
  if (el instanceof HTMLAnchorElement) return true;
  if (el instanceof HTMLInputElement) return !el.disabled && (el.type === 'checkbox' || el.type === 'radio' || el.type === 'button');
  return el instanceof HTMLElement && el.getAttribute('role') === 'button';
}

/** The nearest scrolling box round `el` (the menu itself, else the page). */
function scrollerOf(el: Element | null): HTMLElement | null {
  for (let at = el instanceof HTMLElement ? el : null; at; at = at.parentElement) {
    if (at.scrollHeight > at.clientHeight + 1) {
      const y = getComputedStyle(at).overflowY;
      if (y === 'auto' || y === 'scroll') return at;
    }
  }
  const menu = document.querySelector<HTMLElement>('.menu');
  return menu && !menu.hidden ? menu : null;
}
