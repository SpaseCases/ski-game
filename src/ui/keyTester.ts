import { ACTIONS, type Action, type Bindings } from '../core/input.ts';
import { ACTION_NAMES, keycap, keyName } from './keyNames.ts';
import { addBackButton, board, setHints, type Screen } from './menus.ts';

// The key tester (from Controls): a laptop keyboard drawing that lights each
// key as the browser reports it held, how many are held, and the most held at
// once. Laptop and Chromebook keyboards can't report some 3- and 4-key
// combinations (ghosting, in the keyboard itself), and which ones depends on
// the keyboard, so players hold their usual combos here to find out. Every
// key but Esc is caught while it's open: Esc goes back.

/** A key on the drawing: its codes (either lights it), its label, and its width in key widths. */
interface Cap {
  codes: readonly string[];
  label: string;
  w: number;
}

const cap = (code: string, w = 1, label = keyName(code)): Cap => ({ codes: [code], label, w });
const letters = (s: string): Cap[] => [...s].map((c) => cap(`Key${c}`));

/** A Chromebook-style layout, 15 key widths a row; the function row is left off (its keys are the system's). */
const ROWS: readonly (readonly Cap[])[] = [
  [cap('Backquote'), ...[...'1234567890'].map((d) => cap(`Digit${d}`)), cap('Minus'), cap('Equal'), cap('Backspace', 2)],
  [cap('Tab', 1.5), ...letters('QWERTYUIOP'), cap('BracketLeft'), cap('BracketRight'), cap('Backslash', 1.5)],
  [{ codes: ['CapsLock', 'MetaLeft'], label: 'Search', w: 1.75 }, ...letters('ASDFGHJKL'), cap('Semicolon'), cap('Quote'), cap('Enter', 2.25)],
  [cap('ShiftLeft', 2.25), ...letters('ZXCVBNM'), cap('Comma'), cap('Period'), cap('Slash'), cap('ShiftRight', 2.75, 'Shift')],
  [cap('ControlLeft', 1.5), cap('AltLeft', 1.25), cap('Space', 6.25), cap('AltRight', 1.25, 'Alt'), cap('ControlRight', 1.25, 'Ctrl')],
];

/** The usual combos to try (GAME_DESIGN.md, Controls): what they're for, and the actions held. */
const COMBOS: readonly (readonly [string, readonly Action[]])[] = [
  ['Two arrows, a grab and Shift', ['left', 'down', 'grabLeftMute', 'pole']],
  ['Two arrows, a grab and Shift', ['right', 'up', 'grabRightJapan', 'pole']],
  ['Spin, Lincoln loop and a grab', ['left', 'lincolnLeft', 'grabLeftSafety']],
  ['Spin, Lincoln loop and a grab', ['right', 'lincolnRight', 'grabRightTail']],
  ['Cork: spin, flip and a grab', ['left', 'up', 'grabLeftNose']],
  ['Turn and crouch for a pop, tucked', ['right', 'pop', 'pole']],
];

export class KeyTesterScreen implements Screen {
  readonly el: HTMLElement;
  private readonly bindings: () => Bindings;
  private readonly board: HTMLElement;
  /** Each drawn key with the codes that light it. */
  private readonly capList: { el: HTMLElement; codes: readonly string[] }[] = [];
  private readonly nowEl: HTMLElement;
  private readonly mostEl: HTMLElement;
  private readonly heldList: HTMLElement;
  private readonly comboList: HTMLElement;
  /** Each combo's key codes and its row, ticked once every key in it was seen held together. */
  private combos: { codes: string[]; row: HTMLElement }[] = [];
  private readonly held = new Set<string>();
  private most = 0;

  constructor(bindings: () => Bindings, onBack: () => void) {
    this.bindings = bindings;
    const b = board('Key tester', 'tester-screen');
    this.el = b.el;
    addBackButton(b.head, onBack);

    const counts = document.createElement('div');
    counts.className = 'tester-counts';
    this.nowEl = count(counts, 'Held now');
    this.mostEl = count(counts, 'Most at once');
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'plank plank-small';
    clear.textContent = 'Start over';
    clear.addEventListener('click', () => this.reset());
    counts.appendChild(clear);

    this.heldList = document.createElement('p');
    this.heldList.className = 'tester-held';
    this.heldList.setAttribute('aria-live', 'polite');

    // The drawing: the arrows sit at the bottom right, ↑ over ↓ between ← and →.
    this.board = document.createElement('div');
    this.board.className = 'tester-board';
    this.board.tabIndex = -1;
    this.board.setAttribute('aria-label', 'Keyboard');
    ROWS.forEach((row, i) => {
      const r = document.createElement('div');
      r.className = 'tester-row';
      for (const c of row) r.appendChild(this.addCap(c));
      if (i === ROWS.length - 1) {
        const arrows = document.createElement('div');
        arrows.className = 'tester-arrows';
        const upDown = document.createElement('div');
        upDown.className = 'tester-updown';
        upDown.append(this.addCap(cap('ArrowUp')), this.addCap(cap('ArrowDown')));
        arrows.append(this.addCap(cap('ArrowLeft')), upDown, this.addCap(cap('ArrowRight')));
        r.appendChild(arrows);
      }
      this.board.appendChild(r);
    });

    const legend = document.createElement('p');
    legend.className = 'setting-note';
    legend.textContent = 'Blue keys are the game’s. A key lights while the keyboard reports it held. If you hold a combo and one key stays dark, your keyboard drops that combo: tell us which, and we can move those keys. Esc goes back.';

    const tryIt = document.createElement('h2');
    tryIt.className = 'tester-heading';
    tryIt.textContent = 'Try these';
    this.comboList = document.createElement('ul');
    this.comboList.className = 'tester-combos';

    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    wrap.appendChild(this.board);
    b.body.append(counts, this.heldList, wrap, legend, tryIt, this.comboList);
    setHints(b.foot, [
      [['Any key'], 'Light it'],
      [['Esc'], 'Back'],
    ]);
  }

  enter(): HTMLElement | null {
    const keys = this.bindings();
    const bound = new Map<string, Action[]>();
    for (const action of ACTIONS) {
      for (const code of keys[action]) bound.set(code, [...(bound.get(code) ?? []), action]);
    }
    for (const { el, codes } of this.capList) {
      const actions = codes.flatMap((code) => bound.get(code) ?? []);
      el.classList.toggle('is-bound', actions.length > 0);
      el.title = actions.map((a) => ACTION_NAMES[a]).join(', ');
    }
    this.buildCombos(keys);
    this.reset();
    window.addEventListener('keyup', this.onKeyUp, true);
    window.addEventListener('blur', this.onBlur);
    // Focus on the drawing, not a button, so Space and Enter press nothing.
    return this.board;
  }

  leave(): void {
    window.removeEventListener('keyup', this.onKeyUp, true);
    window.removeEventListener('blur', this.onBlur);
    this.held.clear();
  }

  /** Every key but Esc lights the drawing and does nothing else. */
  onKey(e: KeyboardEvent): boolean {
    if (e.key === 'Escape') return false;
    if (!e.repeat && !this.held.has(e.code)) {
      this.held.add(e.code);
      this.most = Math.max(this.most, this.held.size);
      for (const c of this.combos) if (c.codes.every((code) => this.held.has(code))) c.row.classList.add('is-done');
      this.sync();
    }
    return true;
  }

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (this.held.delete(e.code)) this.sync();
  };

  /** Keys let go while the window is unfocused never send keyup. */
  private readonly onBlur = (): void => {
    this.held.clear();
    this.sync();
  };

  private reset(): void {
    this.held.clear();
    this.most = 0;
    for (const c of this.combos) c.row.classList.remove('is-done');
    this.sync();
  }

  private addCap(c: Cap): HTMLElement {
    const el = document.createElement('span');
    el.className = 'tester-key';
    el.style.flexGrow = String(c.w);
    el.textContent = c.label;
    this.capList.push({ el, codes: c.codes });
    return el;
  }

  private buildCombos(keys: Bindings): void {
    this.combos = [];
    const rows: HTMLElement[] = [];
    for (const [name, actions] of COMBOS) {
      const codes = actions.map((a) => keys[a][0]);
      if (codes.some((c) => c === undefined)) continue;
      const li = document.createElement('li');
      const caps = document.createElement('span');
      caps.className = 'plank-keys';
      for (const code of codes as string[]) caps.appendChild(keycap(keyName(code)));
      const text = document.createElement('span');
      text.textContent = name;
      li.append(caps, text);
      rows.push(li);
      this.combos.push({ codes: codes as string[], row: li });
    }
    this.comboList.replaceChildren(...rows);
  }

  private sync(): void {
    // A key with two codes (Search, Caps Lock elsewhere) lights for either.
    for (const { el, codes } of this.capList) el.classList.toggle('is-held', codes.some((c) => this.held.has(c)));
    this.nowEl.textContent = String(this.held.size);
    this.mostEl.textContent = String(this.most);
    const keys = this.bindings();
    const names = [...this.held].map((code) => {
      const action = ACTIONS.find((a) => keys[a].includes(code));
      return action ? `${keyName(code)} (${ACTION_NAMES[action]})` : keyName(code);
    });
    this.heldList.textContent = names.length > 0 ? names.join(' · ') : 'Hold some keys.';
  }
}

/** A labelled number in the counts row; returns the number's element. */
function count(parent: HTMLElement, label: string): HTMLElement {
  const box = document.createElement('div');
  box.className = 'tester-count';
  const n = document.createElement('strong');
  const l = document.createElement('span');
  l.textContent = label;
  box.append(n, l);
  parent.appendChild(box);
  return n;
}
