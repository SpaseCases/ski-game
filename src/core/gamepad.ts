import { CONFIG } from '../config.ts';

// Controllers (milestone 26): the Gamepad API with the standard mapping
// (Xbox, PlayStation and most USB pads). Read once a frame, before the sim
// steps, and turned into codes like the keyboard's (`PadA`, `PadLSLeft`,
// `PadLT+RSUp`): the game binds actions to them exactly as it binds keys,
// so the sim never knows which one pressed. Sticks are digital (past
// CONFIG.pad.stickPress), so a stick is the arrow keys.
//
// Nothing is read until a pad is connected (the browser shows a page no pad
// until a button is pressed on it); then one getGamepads() call a frame.
// Everything here is kept in fixed arrays: polling allocates nothing of its
// own. Read every frame, so this file is in the obfuscation's EXCLUDE list
// (it holds no player-readable text).

/**
 * Every code a pad gives, by index: the standard mapping's buttons 0 to 15
 * (16, the home button, is the system's), the left stick's four
 * directions, the right stick's eight (clockwise from up), and the right
 * stick's eight again while LT is held (the second grab layer).
 */
export const PAD_CODES = [
  'PadA',
  'PadB',
  'PadX',
  'PadY',
  'PadLB',
  'PadRB',
  'PadLT',
  'PadRT',
  'PadView',
  'PadStart',
  'PadL3',
  'PadR3',
  'PadUp',
  'PadDown',
  'PadLeft',
  'PadRight',
  'PadLSUp',
  'PadLSDown',
  'PadLSLeft',
  'PadLSRight',
  'PadRSUp',
  'PadRSUpRight',
  'PadRSRight',
  'PadRSDownRight',
  'PadRSDown',
  'PadRSDownLeft',
  'PadRSLeft',
  'PadRSUpLeft',
  'PadLT+RSUp',
  'PadLT+RSUpRight',
  'PadLT+RSRight',
  'PadLT+RSDownRight',
  'PadLT+RSDown',
  'PadLT+RSDownLeft',
  'PadLT+RSLeft',
  'PadLT+RSUpLeft',
] as const;

export type PadCode = (typeof PAD_CODES)[number];

const BUTTONS = 16;
const LT = 6;
const RT = 7;
const LS = 16;
const RS = 20;
const LT_RS = 28;
const COUNT = PAD_CODES.length;
const SECTOR = Math.PI / 4;

/** True for a code a pad gives (bindings keep keys and pad buttons apart by this). */
export function isPadCode(code: string): boolean {
  return (PAD_CODES as readonly string[]).includes(code);
}

/** How a pad's buttons are named: Xbox letters, or PlayStation's shapes. */
export type PadKind = 'xbox' | 'ps';

/** A Sony pad (DualShock, DualSense) by its id: the USB vendor 054c, or its name. */
export function padKindOf(id: string): PadKind {
  return /054c|sony|dualsense|dualshock|playstation|wireless controller/i.test(id) ? 'ps' : 'xbox';
}

export class Gamepads {
  /** Each code held now (1) or not (0), over every connected pad together. */
  readonly active = new Uint8Array(COUNT);
  /** The tester's view of the pad used last: buttons 0..16 (0..1) and the four axes (-1..1). */
  readonly buttons = new Float32Array(17);
  readonly axes = new Float32Array(4);
  /** Whether a pad is connected and seen this frame; its id, and whether it uses the standard mapping. */
  present = false;
  id = '';
  standard = true;
  /** How the pad used last names its buttons. */
  kind: PadKind = 'xbox';
  /** Every press or release of a code, as it happens (set by main). */
  sink: (code: PadCode, down: boolean) => void = () => {};
  /** Whenever a pad presses anything (the game then names buttons, not keys, in its hints). */
  onUse: (kind: PadKind) => void = () => {};
  /** Connected or not, for the tester and the Controls screen (rare: plugging in or out). */
  onConnect: () => void = () => {};

  private readonly next = new Uint8Array(COUNT);
  /** Ids and kinds by the pad's index, read when it connects (reading `id` every frame could make a string). */
  private readonly ids: string[] = ['', '', '', ''];
  private readonly kinds: PadKind[] = ['xbox', 'xbox', 'xbox', 'xbox'];
  private readonly standards: boolean[] = [true, true, true, true];
  /** Polling only while some pad is connected; false for good if the page may not use pads (an iframe's policy). */
  private live = false;
  private blocked = false;
  /** The pad index the tester shows (the one pressed last). */
  private shown = -1;

  constructor() {
    if (typeof navigator.getGamepads !== 'function') {
      this.blocked = true;
      return;
    }
    window.addEventListener('gamepadconnected', (e) => this.connect(e.gamepad));
    window.addEventListener('gamepaddisconnected', () => {
      // The next poll counts what's left and lets go of anything that pad held.
      this.onConnect();
    });
    // A pad pressed on the start screen (boot.ts) connected before this module loaded.
    try {
      for (const p of navigator.getGamepads()) if (p && p.connected) this.connect(p);
    } catch {
      this.blocked = true;
    }
  }

  /** Whether the page can't use pads at all (no Gamepad API, or a frame's policy forbids it). */
  get unavailable(): boolean {
    return this.blocked;
  }

  /** Reads every pad and reports each code that went down or up since the last poll. */
  poll(): void {
    if (!this.live) return;
    let pads: readonly (Gamepad | null)[];
    try {
      pads = navigator.getGamepads();
    } catch {
      this.blocked = true;
      this.live = false;
      this.letGo();
      return;
    }
    const next = this.next;
    next.fill(0);
    let any = false;
    let used = -1;
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (!p || !p.connected) continue;
      any = true;
      if (this.read(p) && used < 0) used = p.index;
    }
    if (!any) {
      this.live = false;
      this.present = false;
      this.letGo();
      this.onConnect();
      return;
    }
    if (used >= 0 && used < 4) this.shown = used;
    this.copyShown(pads);
    let pressed = false;
    const active = this.active;
    for (let i = 0; i < COUNT; i++) {
      if (next[i] === active[i]) continue;
      active[i] = next[i]!;
      if (active[i] === 1) pressed = true;
      this.sink(PAD_CODES[i]!, active[i] === 1);
    }
    if (pressed && used >= 0 && used < 4) {
      this.kind = this.kinds[used]!;
      this.onUse(this.kind);
    }
  }

  /** Lets go of everything held (reported as releases). */
  letGo(): void {
    const active = this.active;
    for (let i = 0; i < COUNT; i++) {
      if (active[i] === 0) continue;
      active[i] = 0;
      this.sink(PAD_CODES[i]!, false);
    }
  }

  private connect(p: Gamepad): void {
    if (this.blocked) return;
    if (p.index >= 0 && p.index < 4) {
      this.ids[p.index] = p.id;
      this.kinds[p.index] = padKindOf(p.id);
      this.standards[p.index] = p.mapping === 'standard';
      if (this.shown < 0) this.shown = p.index;
    }
    this.live = true;
    this.onConnect();
  }

  /** Adds one pad's held codes into `next`; true when it holds anything. */
  private read(p: Gamepad): boolean {
    const next = this.next;
    const active = this.active;
    const cfg = CONFIG.pad;
    const buttons = p.buttons;
    const axes = p.axes;
    let held = false;
    const n = Math.min(BUTTONS, buttons.length);
    for (let b = 0; b < n; b++) {
      const button = buttons[b]!;
      let on: boolean;
      if (b === LT || b === RT) on = button.value > (active[b] === 1 ? cfg.triggerRelease : cfg.triggerPress);
      else on = button.pressed || button.value > 0.5;
      if (on) {
        next[b] = 1;
        held = true;
      }
    }
    if (axes.length >= 2) {
      const x = axes[0]!;
      const y = axes[1]!;
      if (-y > (active[LS] === 1 ? cfg.stickRelease : cfg.stickPress)) next[LS] = 1;
      if (y > (active[LS + 1] === 1 ? cfg.stickRelease : cfg.stickPress)) next[LS + 1] = 1;
      if (-x > (active[LS + 2] === 1 ? cfg.stickRelease : cfg.stickPress)) next[LS + 2] = 1;
      if (x > (active[LS + 3] === 1 ? cfg.stickRelease : cfg.stickPress)) next[LS + 3] = 1;
      if (next[LS] || next[LS + 1] || next[LS + 2] || next[LS + 3]) held = true;
    }
    if (axes.length >= 4) {
      const x = axes[2]!;
      const y = axes[3]!;
      // The direction held now, either layer (-1: none).
      let was = -1;
      for (let s = 0; s < 8; s++) if (active[RS + s] === 1 || active[LT_RS + s] === 1) was = s;
      const throwNow = Math.hypot(x, y);
      if (throwNow > (was >= 0 ? cfg.stickRelease : cfg.stickPress)) {
        // Clockwise from up: up is 0, right 2, down 4, left 6.
        const angle = Math.atan2(x, -y);
        let sector = ((Math.round(angle / SECTOR) % 8) + 8) % 8;
        if (was >= 0 && sector !== was) {
          let off = angle - was * SECTOR;
          off = Math.atan2(Math.sin(off), Math.cos(off));
          if (Math.abs(off) < SECTOR / 2 + (cfg.sectorKeep * Math.PI) / 180) sector = was;
        }
        next[(next[LT] === 1 ? LT_RS : RS) + sector] = 1;
        held = true;
      }
    }
    return held;
  }

  /** Copies the shown pad's raw buttons and axes for the tester. */
  private copyShown(pads: readonly (Gamepad | null)[]): void {
    const p = this.shown >= 0 ? pads[this.shown] : null;
    if (!p || !p.connected) {
      this.present = false;
      return;
    }
    this.present = true;
    this.id = this.ids[this.shown]!;
    this.standard = this.standards[this.shown]!;
    const buttons = p.buttons;
    for (let b = 0; b < 17; b++) this.buttons[b] = b < buttons.length ? buttons[b]!.value : 0;
    const axes = p.axes;
    for (let a = 0; a < 4; a++) this.axes[a] = a < axes.length ? axes[a]! : 0;
  }
}
