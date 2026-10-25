// Keyboard input with rebindable keys. Bindings use KeyboardEvent.code, so
// they follow key position rather than the layout's printed letter.

export type Action =
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'pole'
  | 'lincolnLeft'
  | 'lincolnRight'
  | 'respawn'
  | 'checkpoint'
  | 'confirm'
  | 'trailMap'
  | 'pause'
  | GrabAction;

/**
 * Grab and style move keys, in the order of the GRABS list
 * (render/skierPoses.ts): the left hand's grabs, the right hand's, the noses,
 * then the style moves. New moves go on the end.
 */
export const GRAB_ACTIONS = [
  'grabLeftMute',
  'grabLeftSafety',
  'grabLeftJapan',
  'grabLeftTail',
  'grabRightMute',
  'grabRightSafety',
  'grabRightJapan',
  'grabRightTail',
  'grabLeftNose',
  'grabRightNose',
  'styleSeaman',
  'styleDaffy',
  'styleIronCross',
  'styleSpreadEagle',
] as const;

export type GrabAction = (typeof GRAB_ACTIONS)[number];

export const ACTIONS: readonly Action[] = [
  'left',
  'right',
  'up',
  'down',
  'pole',
  'lincolnLeft',
  'lincolnRight',
  'respawn',
  'checkpoint',
  'confirm',
  'trailMap',
  'pause',
  ...GRAB_ACTIONS,
];

export type Bindings = Record<Action, readonly string[]>;

export const DEFAULT_BINDINGS: Bindings = {
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
  up: ['ArrowUp'],
  down: ['ArrowDown'],
  pole: ['ShiftLeft', 'ShiftRight'],
  lincolnLeft: ['KeyQ'],
  lincolnRight: ['KeyE'],
  respawn: ['KeyR'],
  checkpoint: ['Tab'],
  confirm: ['Enter', 'NumpadEnter'],
  trailMap: ['KeyM'],
  // Esc opens the pause menu too, but it isn't a binding: in fullscreen the browser takes it.
  pause: ['KeyP'],
  grabLeftMute: ['KeyA'],
  grabLeftSafety: ['KeyS'],
  grabLeftJapan: ['KeyD'],
  grabLeftTail: ['KeyF'],
  grabRightMute: ['KeyZ'],
  grabRightSafety: ['KeyX'],
  grabRightJapan: ['KeyC'],
  grabRightTail: ['KeyV'],
  grabLeftNose: ['KeyG'],
  grabRightNose: ['KeyB'],
  styleSeaman: ['KeyT'],
  styleDaffy: ['KeyW'],
  styleIronCross: ['Digit1'],
  styleSpreadEagle: ['Digit2'],
};

export interface ButtonState {
  held: boolean;
  /** Went down since the previous simulation step. */
  pressed: boolean;
  /** Came up since the previous simulation step. */
  released: boolean;
}

export type InputState = Record<Action, ButtonState>;

export function createInputState(): InputState {
  const state = {} as InputState;
  for (const action of ACTIONS) state[action] = { held: false, pressed: false, released: false };
  return state;
}

/**
 * Tracks held keys and latches presses and releases until the simulation
 * reads them, so a quick tap between two steps is never lost.
 */
export class Keyboard {
  private actionsByCode = new Map<string, Action[]>();
  private heldCodes = new Set<string>();
  private heldCount = new Map<Action, number>();
  private pressedLatch = new Set<Action>();
  private releasedLatch = new Set<Action>();
  /** Off while a menu is open: keys go to the page as usual (Tab moves focus, arrows scroll). */
  private enabled = true;

  constructor(bindings: Bindings) {
    this.setBindings(bindings);
  }

  setBindings(bindings: Bindings): void {
    this.actionsByCode.clear();
    for (const action of ACTIONS) {
      for (const code of bindings[action]) {
        const list = this.actionsByCode.get(code);
        if (list) list.push(action);
        else this.actionsByCode.set(code, [action]);
      }
    }
    this.releaseAll();
  }

  attach(target: Window): void {
    target.addEventListener('keydown', (e) => this.onKeyDown(e));
    target.addEventListener('keyup', (e) => this.onKeyUp(e));
    // Keys released while the window is unfocused never send keyup.
    target.addEventListener('blur', () => this.releaseAll());
  }

  /** Turns game keys on or off. Either way, everything held is dropped, so nothing carries across. */
  setEnabled(on: boolean): void {
    this.enabled = on;
    this.releaseAll();
  }

  /** True when the key with this code is bound to `action` (whether or not game keys are on). */
  isBound(action: Action, code: string): boolean {
    return this.actionsByCode.get(code)?.includes(action) ?? false;
  }

  /** Copies the current state into `out` and clears the latched edges. */
  sample(out: InputState): void {
    for (const action of ACTIONS) {
      const button = out[action];
      button.held = (this.heldCount.get(action) ?? 0) > 0;
      button.pressed = this.pressedLatch.has(action);
      button.released = this.releasedLatch.has(action);
    }
    this.pressedLatch.clear();
    this.releasedLatch.clear();
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (!this.enabled || isTypingTarget(e.target) || inTuningPanel(e.target)) return;
    // Enter and Space on a focused HUD button or link work it, not the game.
    if (isPressable(e.target) && (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space')) return;
    const actions = this.actionsByCode.get(e.code);
    if (!actions) return;
    e.preventDefault(); // stop arrows and Tab from scrolling or moving focus
    if (this.heldCodes.has(e.code)) return; // auto-repeat
    this.heldCodes.add(e.code);
    for (const action of actions) {
      const count = this.heldCount.get(action) ?? 0;
      if (count === 0) this.pressedLatch.add(action);
      this.heldCount.set(action, count + 1);
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    if (!this.heldCodes.delete(e.code)) return;
    for (const action of this.actionsByCode.get(e.code) ?? []) {
      const count = (this.heldCount.get(action) ?? 1) - 1;
      this.heldCount.set(action, count);
      if (count === 0) this.releasedLatch.add(action);
    }
  }

  /** Drops every held key without reporting releases (so losing focus never pops). */
  private releaseAll(): void {
    this.heldCodes.clear();
    this.heldCount.clear();
    this.pressedLatch.clear();
    this.releasedLatch.clear();
  }
}

/** True for a key pressed in the tuning panel (lil-gui): it's typing or using the panel, never riding. */
export function inTuningPanel(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.lil-gui') !== null;
}

function isPressable(target: EventTarget | null): boolean {
  return target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement;
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}
