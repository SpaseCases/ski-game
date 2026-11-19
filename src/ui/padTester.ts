import { CONFIG } from '../config.ts';
import { PAD_CODES, type Gamepads } from '../core/gamepad.ts';
import { ACTIONS, type Action, type Bindings } from '../core/input.ts';
import { actionName, INPUT_LOOK, padName } from './keyNames.ts';
import { addBackButton, board, setHints, type Screen } from './menus.ts';
import { PadDrawing } from './padTesterDraw.ts';

// The controller tester (milestone 26, from Controls, beside the key
// tester): a drawing of a pad that lights each button as the browser
// reports it, moves the sticks' dots and fills the triggers, names the pad,
// and lists what's held with what it does. Every button lights here, B
// included: holding B for CONFIG.pad.testerBack seconds goes back, as Esc
// does.

/** The standard mapping's buttons as drawn: their index, a class placing them, and whether the label follows the pad (A or ✕). */
const PARTS: readonly (readonly [number, string])[] = [
  [0, 'pad-a'],
  [1, 'pad-b'],
  [2, 'pad-x'],
  [3, 'pad-y'],
  [4, 'pad-lb'],
  [5, 'pad-rb'],
  [6, 'pad-lt'],
  [7, 'pad-rt'],
  [8, 'pad-view'],
  [9, 'pad-start'],
  [10, 'pad-l3'],
  [11, 'pad-r3'],
  [12, 'pad-up'],
  [13, 'pad-down'],
  [14, 'pad-left'],
  [15, 'pad-right'],
  [16, 'pad-home'],
];

/** The labels each button gets, by its standard-mapping index. */
const LABEL_CODES = ['PadA', 'PadB', 'PadX', 'PadY', 'PadLB', 'PadRB', 'PadLT', 'PadRT', 'PadView', 'PadStart', 'PadL3', 'PadR3'];

export class PadTesterScreen implements Screen {
  readonly el: HTMLElement;
  private readonly pads: Gamepads;
  private readonly bindings: () => Bindings;
  private readonly onBack: () => void;
  private readonly nameEl: HTMLElement;
  private readonly heldEl: HTMLElement;
  private readonly drawing: PadDrawing;
  private readonly labels: HTMLElement[] = [];
  private readonly area: HTMLElement;
  private readonly legend: HTMLElement;
  private readonly held = new Set<string>();
  private showing = false;
  private backHeld = 0;
  /** More buttons the game uses, by code, with their names, when this returns any (the developer's: set by main). */
  extraPad: (() => ReadonlyMap<string, string> | null) | null = null;

  constructor(pads: Gamepads, bindings: () => Bindings, onBack: () => void) {
    this.pads = pads;
    this.bindings = bindings;
    this.onBack = onBack;
    const b = board('Controller tester', 'tester-screen pad-tester-screen');
    this.el = b.el;
    addBackButton(b.head, onBack);

    this.nameEl = document.createElement('p');
    this.nameEl.className = 'pad-tester-name';
    this.heldEl = document.createElement('p');
    this.heldEl.className = 'tester-held';
    this.heldEl.setAttribute('aria-live', 'polite');

    this.area = document.createElement('div');
    this.area.className = 'pad-drawing';
    this.area.tabIndex = -1;
    this.area.setAttribute('aria-label', 'Controller');
    const buttons: HTMLElement[] = [];
    for (const [index, cls] of PARTS) {
      const el = document.createElement('span');
      el.className = `pad-part ${cls}`;
      buttons[index] = el;
      if (index < LABEL_CODES.length) this.labels[index] = el;
      this.area.appendChild(el);
    }
    // The triggers fill as they're pulled.
    const fills = [buttons[6]!, buttons[7]!].map((t) => {
      const fill = document.createElement('i');
      fill.className = 'pad-fill';
      t.appendChild(fill);
      return fill;
    });
    // Each stick: a ring, the dead zone, and a dot (moved across by one element and up and down by the one inside it).
    const reach = 34;
    const sticks = ['pad-ls', 'pad-rs'].map((cls) => {
      const ring = document.createElement('span');
      ring.className = `pad-stick ${cls}`;
      const dead = document.createElement('i');
      dead.className = 'pad-dead';
      dead.style.width = dead.style.height = `${Math.round(CONFIG.pad.stickPress * 100)}%`;
      const x = document.createElement('span');
      x.className = 'pad-dot-x';
      const y = document.createElement('span');
      y.className = 'pad-dot';
      x.appendChild(y);
      ring.append(dead, x);
      this.area.appendChild(ring);
      return { x, y };
    });
    // L3 and R3 light the stick's ring.
    this.area.querySelector('.pad-ls')!.appendChild(buttons[10]!);
    this.area.querySelector('.pad-rs')!.appendChild(buttons[11]!);
    this.drawing = new PadDrawing({ buttons, triggers: [fills[0]!, fills[1]!], sticks: [sticks[0]!, sticks[1]!], reach });

    const legend = document.createElement('p');
    legend.className = 'setting-note';
    this.legend = legend;
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    wrap.appendChild(this.area);
    b.body.append(this.nameEl, this.heldEl, wrap, legend);
    setHints(b.foot, [[['Esc'], 'Back']], [
      [['PadB'], 'Hold to go back'],
    ]);
  }

  get isShown(): boolean {
    return this.showing;
  }

  enter(): HTMLElement | null {
    this.showing = true;
    this.backHeld = 0;
    this.held.clear();
    for (let i = 0; i < PAD_CODES.length; i++) if (this.pads.active[i] === 1) this.held.add(PAD_CODES[i]!);
    this.sync();
    return this.area;
  }

  leave(): void {
    this.showing = false;
    this.held.clear();
  }

  /** A pad code going down or up while the tester shows (it takes the pad from the menus). */
  button(code: string, down: boolean): void {
    if (down) this.held.add(code);
    else this.held.delete(code);
    this.showHeld();
  }

  /** Every frame while shown: the drawing, and B held to go back. */
  frame(dt: number): void {
    this.drawing.update(this.pads);
    if (this.pads.present && this.pads.buttons[1]! > 0.5) {
      this.backHeld += dt;
      if (this.backHeld >= CONFIG.pad.testerBack) {
        this.backHeld = 0;
        this.onBack();
      }
    } else {
      this.backHeld = 0;
    }
  }

  /** The pad's name, its buttons' labels and the held list (the pad plugged in or out, or another one pressed). */
  sync(): void {
    const pads = this.pads;
    if (pads.unavailable) this.nameEl.textContent = 'This page can’t use controllers here (an embedded game may not be allowed to). Open the game in a new tab.';
    else if (!pads.present) this.nameEl.textContent = 'No controller yet. Plug one in and press a button on it.';
    else this.nameEl.textContent = pads.standard ? pads.id : `${pads.id} (not the standard layout: some buttons may be in other places)`;
    this.el.querySelector('.pad-drawing')?.classList.toggle('is-ps', INPUT_LOOK.kind === 'ps');
    LABEL_CODES.forEach((code, i) => {
      const el = this.labels[i];
      if (!el) return;
      const name = padName(code);
      // L3 and R3 sit in their stick's ring: the ring shows their name.
      if (i >= 10) el.dataset.label = name;
      else if (el.firstChild?.nodeType === Node.TEXT_NODE) el.firstChild.textContent = name;
      else el.prepend(document.createTextNode(name));
    });
    this.legend.textContent = `A button lights while the controller reports it held, and the dots follow the sticks: past the inner ring a stick counts as an arrow key. Hold ${padName('PadB')} for a second (or press Esc) to go back.`;
    this.showHeld();
  }

  private showHeld(): void {
    const keys = this.bindings();
    const extra = this.extraPad?.() ?? null;
    const names = [...this.held].map((code) => {
      const actions = ACTIONS.filter((a: Action) => keys[a].includes(code)).map((a) => actionName(a));
      const more = extra?.get(code);
      if (more) actions.push(more);
      return actions.length > 0 ? `${padName(code)} (${actions.join(', ')})` : padName(code);
    });
    this.heldEl.textContent = names.length > 0 ? names.join(' · ') : 'Hold some buttons.';
  }
}
