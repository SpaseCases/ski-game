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

/**
 * The mouse over the game view (the polish after milestone 28, the user's
 * request): the scope aims with it. Moved pixels since the last take (a
 * plain move, no button held: a drag goes through core/pointerOrbit.ts and
 * main hands it over), whether the cursor sits at the window's edge (-1, 0
 * or 1 each way: the aim keeps turning there, since without pointer lock
 * the cursor stops at the edge), and a click (pressed and let go without
 * moving).
 */
export interface DevMouse {
  x: number;
  y: number;
  edgeX: number;
  edgeY: number;
  click: boolean;
}

/** How near the window's edge (CSS px) the cursor counts as at it, and how far a press may move and still be a click. */
const EDGE = 3;
const CLICK_SLOP = 5;

export class DevKeys {
  readonly fly: DevButton = { held: false, pressed: false };
  readonly aim: DevButton = { held: false, pressed: false };
  readonly fire: DevButton = { held: false, pressed: false };
  readonly space: DevButton = { held: false, pressed: false };
  private readonly down = { fly: false, aim: false, fire: false, space: false };
  private readonly latch = { fly: false, aim: false, fire: false, space: false };
  private readonly listening: () => boolean;
  private mouseX = 0;
  private mouseY = 0;
  private edgeX = 0;
  private edgeY = 0;
  private clicked = false;
  /** A left press down on the game view, and where. */
  private down0 = false;
  private downX = 0;
  private downY = 0;

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
    window.addEventListener(
      'mousemove',
      (e) => {
        if (!this.listening()) return;
        // A held button is a drag: main hands the orbit's pixels over instead (no counting them twice).
        if (e.buttons === 0) {
          this.mouseX += e.movementX;
          this.mouseY += e.movementY;
        }
        this.edgeX = e.clientX <= EDGE ? -1 : e.clientX >= window.innerWidth - 1 - EDGE ? 1 : 0;
        this.edgeY = e.clientY <= EDGE ? -1 : e.clientY >= window.innerHeight - 1 - EDGE ? 1 : 0;
      },
      { passive: true },
    );
    // Out of the window (or the embedding page's frame): no more moves come, so nothing keeps turning.
    document.documentElement.addEventListener('mouseleave', () => {
      this.edgeX = 0;
      this.edgeY = 0;
    });
    window.addEventListener('mousedown', (e) => {
      this.down0 = e.button === 0 && e.target instanceof HTMLCanvasElement && this.listening();
      this.downX = e.clientX;
      this.downY = e.clientY;
    });
    window.addEventListener('mouseup', (e) => {
      const was = this.down0;
      this.down0 = false;
      if (e.button === 0 && was && Math.abs(e.clientX - this.downX) + Math.abs(e.clientY - this.downY) <= CLICK_SLOP && this.listening()) this.clicked = true;
    });
  }

  /** Writes the mouse since the last take into `out` and clears the moves and the click. */
  takeMouse(out: DevMouse): void {
    out.x = this.mouseX;
    out.y = this.mouseY;
    out.edgeX = this.edgeX;
    out.edgeY = this.edgeY;
    out.click = this.clicked;
    this.mouseX = 0;
    this.mouseY = 0;
    this.clicked = false;
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
    this.mouseX = 0;
    this.mouseY = 0;
    this.clicked = false;
    this.down0 = false;
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
