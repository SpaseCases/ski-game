// The developer's keys (milestone 25): fixed, not rebindable, and listened
// for only in the developer's chunk, so nobody else's game knows them. Read
// every step, so this file is in the obfuscation's EXCLUDE list (no text).
// Like core/input.ts's Keyboard: by KeyboardEvent.code, presses latched
// until the step reads them, and nothing while a menu is open or a box is
// being typed in.

/** The keys: take off and land, aim (held), fire; Space hovers while flying and fires while aiming. */
export const DEV_CODES = { fly: 'KeyY', aim: 'KeyU', fire: 'KeyI', space: 'Space' } as const;

export type DevKey = keyof typeof DEV_CODES;

/**
 * The same on a controller (milestone 26, the user's pick): Y takes off and
 * lands, LT held aims, RT fires; A hovers while flying (it fires too while
 * aiming), as Space does. Only this chunk knows them.
 */
export const DEV_PADS = { fly: 'PadY', aim: 'PadLT', fire: 'PadRT', space: 'PadA' } as const;

export interface DevButton {
  held: boolean;
  pressed: boolean;
}

export class DevKeys {
  readonly fly: DevButton = { held: false, pressed: false };
  readonly aim: DevButton = { held: false, pressed: false };
  readonly fire: DevButton = { held: false, pressed: false };
  readonly space: DevButton = { held: false, pressed: false };
  private readonly down = { fly: false, aim: false, fire: false, space: false };
  private readonly latch = { fly: false, aim: false, fire: false, space: false };
  private readonly listening: () => boolean;

  /** `listening` says whether the game takes keys now (no menu open). */
  constructor(listening: () => boolean) {
    this.listening = listening;
    window.addEventListener('keydown', (e) => {
      const key = keyOf(e.code);
      if (!key || !this.listening() || typing(e.target)) return;
      if (key !== 'space') e.preventDefault();
      if (this.down[key]) return; // auto-repeat
      this.down[key] = true;
      this.latch[key] = true;
    });
    window.addEventListener('keyup', (e) => {
      const key = keyOf(e.code);
      if (key) this.down[key] = false;
    });
    window.addEventListener('blur', () => this.clear());
  }

  /** A pad code going down or up (main hands every one over while riding): its power, if it has one. */
  pad(code: string, down: boolean): void {
    const key = code === DEV_PADS.fly ? 'fly' : code === DEV_PADS.aim ? 'aim' : code === DEV_PADS.fire ? 'fire' : code === DEV_PADS.space ? 'space' : null;
    if (!key) return;
    if (!down) {
      this.down[key] = false;
      return;
    }
    if (!this.listening() || this.down[key]) return;
    this.down[key] = true;
    this.latch[key] = true;
  }

  /** Copies the held keys and the presses since the last sample into the buttons. */
  sample(): void {
    this.copy('fly', this.fly);
    this.copy('aim', this.aim);
    this.copy('fire', this.fire);
    this.copy('space', this.space);
  }

  /** Drops everything held (a menu opened, the window lost focus). */
  clear(): void {
    for (const key of KEYS) {
      this.down[key] = false;
      this.latch[key] = false;
    }
  }

  private copy(key: DevKey, b: DevButton): void {
    b.held = this.down[key];
    b.pressed = this.latch[key];
    this.latch[key] = false;
  }
}

const KEYS: readonly DevKey[] = ['fly', 'aim', 'fire', 'space'];

function keyOf(code: string): DevKey | null {
  return code === DEV_CODES.fly ? 'fly' : code === DEV_CODES.aim ? 'aim' : code === DEV_CODES.fire ? 'fire' : code === DEV_CODES.space ? 'space' : null;
}

function typing(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable) ||
    (target instanceof Element && target.closest('.lil-gui') !== null)
  );
}
