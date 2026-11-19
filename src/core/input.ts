// Keyboard and controller input with rebindable keys and buttons. Key
// bindings use KeyboardEvent.code, so they follow key position rather than
// the layout's printed letter; pad bindings use core/gamepad.ts's codes
// (milestone 26). Both feed the same actions, so the sim never knows which
// one pressed.

export type Action =
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'pop'
  | 'pole'
  | 'lincolnLeft'
  | 'lincolnRight'
  | 'respawn'
  | 'checkpoint'
  | 'confirm'
  | 'trailMap'
  | 'board'
  | 'camera'
  | 'chat'
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
  'pop',
  'pole',
  'lincolnLeft',
  'lincolnRight',
  'respawn',
  'checkpoint',
  'confirm',
  'trailMap',
  'board',
  'camera',
  'chat',
  'pause',
  ...GRAB_ACTIONS,
];

export type Bindings = Record<Action, readonly string[]>;

export const DEFAULT_BINDINGS: Bindings = {
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
  up: ['ArrowUp'],
  down: ['ArrowDown'],
  // Pops only with Settings' "Pop with: Space"; with "Pop with: ↑" the up key pops (see Keyboard.setPopWithUp).
  pop: ['Space'],
  pole: ['ShiftLeft', 'ShiftRight'],
  lincolnLeft: ['KeyQ'],
  lincolnRight: ['KeyE'],
  respawn: ['KeyR'],
  checkpoint: ['Tab'],
  confirm: ['Enter', 'NumpadEnter'],
  trailMap: ['KeyM'],
  // Hides or shows the leaderboard at the finish line.
  board: ['KeyL'],
  // Switches between the chase camera and first person (milestone 18).
  camera: ['KeyH'],
  // Opens the chat box in a multiplayer lobby (milestone 27).
  chat: ['KeyY'],
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

/**
 * The controller's defaults (milestone 26, the user's pick): the left stick
 * and the d-pad steer, spin and flip like the arrows; A pops, RT tucks,
 * LB / RB loop, B respawns, X sets the checkpoint, Y goes back to the top
 * at the finish, Start pauses, View shows the corner map, L3 switches the
 * camera and R3 the finish board. The right stick grabs in eight
 * directions, and with LT held it has a second layer (the right hand's nose
 * and tail, and the style moves).
 */
export const DEFAULT_PAD_BINDINGS: Bindings = {
  left: ['PadLSLeft', 'PadLeft'],
  right: ['PadLSRight', 'PadRight'],
  up: ['PadLSUp', 'PadUp'],
  down: ['PadLSDown', 'PadDown'],
  pop: ['PadA'],
  pole: ['PadRT'],
  lincolnLeft: ['PadLB'],
  lincolnRight: ['PadRB'],
  respawn: ['PadB'],
  checkpoint: ['PadX'],
  confirm: ['PadY'],
  trailMap: ['PadView'],
  board: ['PadR3'],
  camera: ['PadL3'],
  // Chat needs a keyboard: no button.
  chat: [],
  pause: ['PadStart'],
  grabLeftMute: ['PadRSLeft'],
  grabLeftSafety: ['PadRSDownLeft'],
  grabLeftJapan: ['PadRSUpLeft'],
  grabLeftTail: ['PadRSDown'],
  grabRightMute: ['PadRSRight'],
  grabRightSafety: ['PadRSDownRight'],
  grabRightJapan: ['PadRSUpRight'],
  grabRightTail: ['PadLT+RSDown'],
  grabLeftNose: ['PadRSUp'],
  grabRightNose: ['PadLT+RSUp'],
  styleSeaman: ['PadLT+RSLeft'],
  styleDaffy: ['PadLT+RSRight'],
  styleIronCross: ['PadLT+RSUpLeft'],
  styleSpreadEagle: ['PadLT+RSUpRight'],
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
  /** The controller's codes (milestone 26), kept apart from the keys' so each set rebinds on its own. */
  private actionsByPad = new Map<string, Action[]>();
  private heldCodes = new Set<string>();
  private heldCount = new Map<Action, number>();
  private pressedLatch = new Set<Action>();
  private releasedLatch = new Set<Action>();
  /** Off while a menu is open: keys go to the page as usual (Tab moves focus, arrows scroll). */
  private enabled = true;
  /** "Pop with: ↑": the up key crouches and pops too, and the pop key does nothing. */
  private popWithUp = false;

  constructor(bindings: Bindings, padBindings: Bindings = DEFAULT_PAD_BINDINGS) {
    this.setBindings(bindings);
    this.setPadBindings(padBindings);
  }

  setBindings(bindings: Bindings): void {
    fill(this.actionsByCode, bindings);
    this.releaseAll();
  }

  setPadBindings(bindings: Bindings): void {
    fill(this.actionsByPad, bindings);
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

  /** "Pop with: ↑" (true) or with the pop key (false). */
  setPopWithUp(on: boolean): void {
    this.popWithUp = on;
    this.releaseAll();
  }

  /** True when the key with this code is bound to `action` (whether or not game keys are on). */
  isBound(action: Action, code: string): boolean {
    return this.actionsByCode.get(code)?.includes(action) ?? false;
  }

  /** True when the pad code is bound to `action`. */
  isPadBound(action: Action, code: string): boolean {
    return this.actionsByPad.get(code)?.includes(action) ?? false;
  }

  /**
   * A pad code going down or up (core/gamepad.ts, once a frame before the
   * steps): counted exactly like a key, so a key and a button held for the
   * same action hold it until both are let go. Off while a menu is open.
   */
  padKey(code: string, down: boolean): void {
    if (down) {
      if (!this.enabled) return;
      const actions = this.actionsByPad.get(code);
      if (actions) this.press(code, actions);
    } else {
      this.lift(code, this.actionsByPad.get(code));
    }
  }

  /** Copies the current state into `out` and clears the latched edges. */
  sample(out: InputState): void {
    for (const action of ACTIONS) {
      const button = out[action];
      button.held = (this.heldCount.get(action) ?? 0) > 0;
      button.pressed = this.pressedLatch.has(action);
      button.released = this.releasedLatch.has(action);
    }
    if (this.popWithUp) mirrorPop(out);
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
    this.press(e.code, actions);
  }

  private onKeyUp(e: KeyboardEvent): void {
    this.lift(e.code, this.actionsByCode.get(e.code));
  }

  /** A key or pad code down: each of its actions held once more (a code already held is auto-repeat). */
  private press(code: string, actions: readonly Action[]): void {
    if (this.heldCodes.has(code)) return;
    this.heldCodes.add(code);
    for (const action of actions) {
      const count = this.heldCount.get(action) ?? 0;
      if (count === 0) this.pressedLatch.add(action);
      this.heldCount.set(action, count + 1);
    }
  }

  private lift(code: string, actions: readonly Action[] | undefined): void {
    if (!this.heldCodes.delete(code)) return;
    for (const action of actions ?? []) {
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

/** Each code's actions, from a set of bindings. */
function fill(map: Map<string, Action[]>, bindings: Bindings): void {
  map.clear();
  for (const action of ACTIONS) {
    for (const code of bindings[action]) {
      const list = map.get(code);
      if (list) list.push(action);
      else map.set(code, [action]);
    }
  }
}

/**
 * "Pop with: ↑": the sim crouches and pops on `pop` and front-flips on `up`
 * (once a pop is no longer possible, see stepSkier), so pop copying up gives
 * ↑ both jobs, exactly as before the pop action existed.
 */
export function mirrorPop(input: InputState): void {
  const up = input.up;
  const pop = input.pop;
  pop.held = up.held;
  pop.pressed = up.pressed;
  pop.released = up.released;
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
