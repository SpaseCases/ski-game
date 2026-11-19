import type { Gamepads } from '../core/gamepad.ts';

// The controller tester's drawing, updated every frame while it shows
// (milestone 26). Kept apart from ui/padTester.ts (the screen and its
// words) and in the obfuscation's EXCLUDE list, since it runs every frame.
// It allocates nothing: the sticks and triggers move through transforms made
// once (STEPS positions a side), and an element is touched only when what
// it shows changes.

/** Stick and trigger positions drawn, each way from the middle (a stick) or from empty (a trigger). */
const STEPS = 16;

export interface PadParts {
  /** The standard mapping's buttons 0..16, each lit while held. */
  buttons: readonly HTMLElement[];
  /** LT and RT's fills (scaled up from the bottom). */
  triggers: readonly [HTMLElement, HTMLElement];
  /** Each stick's dot: an outer element moved across, an inner one moved up and down. */
  sticks: readonly [{ x: HTMLElement; y: HTMLElement }, { x: HTMLElement; y: HTMLElement }];
  /** How far a stick's dot travels from the middle (px). */
  reach: number;
}

export class PadDrawing {
  private readonly parts: PadParts;
  private readonly moveX: string[] = [];
  private readonly moveY: string[] = [];
  private readonly fill: string[] = [];
  private readonly lit = new Uint8Array(17);
  /** What each transform shows now (-1: not set yet): sticks x0, y0, x1, y1, then the two triggers. */
  private readonly shown = new Int16Array([-1, -1, -1, -1, -1, -1]);

  constructor(parts: PadParts) {
    this.parts = parts;
    for (let i = -STEPS; i <= STEPS; i++) {
      const px = ((i / STEPS) * parts.reach).toFixed(1);
      this.moveX.push(`translateX(${px}px)`);
      this.moveY.push(`translateY(${px}px)`);
    }
    for (let i = 0; i <= STEPS; i++) this.fill.push(`scaleY(${(i / STEPS).toFixed(3)})`);
  }

  /** Shows the pad as it is now (nothing held when none is present). */
  update(pads: Gamepads): void {
    const present = pads.present;
    const { buttons, triggers, sticks } = this.parts;
    for (let b = 0; b < 17; b++) {
      const on = present && pads.buttons[b]! > 0.5 ? 1 : 0;
      if (on === this.lit[b]) continue;
      this.lit[b] = on;
      buttons[b]?.classList.toggle('is-held', on === 1);
    }
    for (let s = 0; s < 2; s++) {
      const x = present ? step(pads.axes[s * 2]!) : 0;
      const y = present ? step(pads.axes[s * 2 + 1]!) : 0;
      if (x !== this.shown[s * 2]) {
        this.shown[s * 2] = x;
        sticks[s]!.x.style.transform = this.moveX[x + STEPS]!;
      }
      if (y !== this.shown[s * 2 + 1]) {
        this.shown[s * 2 + 1] = y;
        sticks[s]!.y.style.transform = this.moveY[y + STEPS]!;
      }
    }
    for (let t = 0; t < 2; t++) {
      const v = present ? Math.round(Math.min(1, Math.max(0, pads.buttons[6 + t]!)) * STEPS) : 0;
      if (v === this.shown[4 + t]) continue;
      this.shown[4 + t] = v;
      triggers[t]!.style.transform = this.fill[v]!;
    }
  }
}

/** An axis (-1..1) as a whole step from the middle. */
function step(v: number): number {
  return Math.round(Math.min(1, Math.max(-1, v)) * STEPS);
}
