import { EDIT_PALETTE, hexCode, OWN_COLORS } from '../core/customSkis.ts';

// Colors of the player's own in both editors (2026-11-24, the user's ask:
// "a hex color picker option for the cosmetic creator"). Under the palette:
// a box to type a hex code, the browser's own color picker beside it, and
// Add; then a row of the slot's own colors (core/customSkis.ts OWN_COLORS of
// them, after EDIT_PALETTE in the slot's palette), each a chip like the
// palette's. A code that is one of EDIT_PALETTE's picks that chip; a new one
// takes a free place (or one no square uses). The editor keeps the keys out
// of its shortcuts while the box has the focus (`owns`).

export interface HexHost {
  /** The slot's palette: EDIT_PALETTE's colors, then its own. */
  palette: () => readonly string[];
  /** The index of `hex` in the palette, added as one of its own if new; -1 when they're all in use. */
  add: (hex: string) => number;
  /** Paint with that palette index. */
  pick: (index: number) => void;
}

/** Tells the boxes' ids apart (each editor has one). */
let boxes = 0;

const FULL_TEXT = `Your ${OWN_COLORS} colors are all in use: paint over one to free it.`;
const BAD_TEXT = 'Type a hex code: 6 digits 0 to 9 and a to f, like #ff7a1a.';

export class HexColors {
  /** The box, the picker and Add. */
  readonly el: HTMLElement;
  /** The slot's own colors (and the empty places left). */
  readonly own: HTMLElement;
  /** What went wrong with the last code (empty when nothing did). */
  readonly note: HTMLElement;
  private readonly host: HexHost;
  private readonly input: HTMLInputElement;
  private readonly picker: HTMLInputElement;
  private readonly chips: HTMLButtonElement[] = [];
  private readonly gaps: HTMLElement[] = [];

  constructor(host: HexHost) {
    this.host = host;
    this.el = document.createElement('div');
    this.el.className = 'editor-hex';
    const name = document.createElement('label');
    name.className = 'paint-part';
    name.textContent = 'Hex';
    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.className = 'text-box editor-hex-input';
    this.input.maxLength = 7;
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.input.placeholder = '#ff7a1a';
    this.input.setAttribute('aria-label', 'Hex color code');
    this.input.id = `editor-hex-${++boxes}`;
    name.htmlFor = this.input.id;
    this.input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      this.useTyped();
    });
    this.input.addEventListener('input', () => {
      const hex = hexCode(this.input.value);
      if (hex) this.picker.value = hex;
      this.note.textContent = '';
    });
    this.picker = document.createElement('input');
    this.picker.type = 'color';
    this.picker.className = 'editor-hex-pick';
    this.picker.title = 'Pick any color';
    this.picker.setAttribute('aria-label', 'Pick any color');
    this.picker.addEventListener('input', () => {
      this.input.value = this.picker.value;
      this.note.textContent = '';
    });
    this.picker.addEventListener('change', () => this.use(this.picker.value));
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'editor-tool editor-hex-add';
    add.textContent = 'Add';
    add.title = 'Paint with the typed color (Enter in the box)';
    add.addEventListener('click', () => this.useTyped());
    this.el.append(name, this.input, this.picker, add);

    this.own = document.createElement('div');
    this.own.className = 'editor-chips editor-own';
    this.own.setAttribute('role', 'group');
    this.own.setAttribute('aria-label', 'Your colors');
    for (let k = 0; k < OWN_COLORS; k++) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.addEventListener('click', () => this.host.pick(EDIT_PALETTE.length + k));
      const gap = document.createElement('span');
      gap.className = 'editor-own-gap';
      gap.setAttribute('aria-hidden', 'true');
      this.chips.push(chip);
      this.gaps.push(gap);
      this.own.append(chip, gap);
    }
    this.note = document.createElement('p');
    this.note.className = 'editor-hex-note';
    this.note.setAttribute('aria-live', 'polite');
  }

  /** Whether the key went to the box or the picker (the editor's shortcuts leave it alone). */
  owns(target: EventTarget | null): boolean {
    return target === this.input || target === this.picker;
  }

  /** Shows the slot's own colors, marks the picked one, and puts its code in the box (unless it's being typed in). */
  sync(color: number): void {
    const palette = this.host.palette();
    this.chips.forEach((chip, k) => {
      const i = EDIT_PALETTE.length + k;
      const hex = palette[i];
      chip.hidden = hex === undefined;
      this.gaps[k]!.hidden = hex !== undefined;
      if (hex === undefined) return;
      chip.style.setProperty('--chip', hex);
      chip.title = hex.toUpperCase();
      chip.setAttribute('aria-label', `Your color ${hex.toUpperCase()}`);
      chip.setAttribute('aria-pressed', String(i === color));
    });
    const hex = palette[color] ?? '#000000';
    if (document.activeElement !== this.input) this.input.value = hex;
    this.picker.value = hex;
  }

  /** Clears the note (an editor opening on another slot). */
  reset(): void {
    this.note.textContent = '';
  }

  private useTyped(): void {
    const hex = hexCode(this.input.value);
    if (!hex) {
      this.note.textContent = BAD_TEXT;
      return;
    }
    this.use(hex);
  }

  private use(hex: string): void {
    const i = this.host.add(hex);
    this.note.textContent = i < 0 ? FULL_TEXT : '';
    if (i >= 0) {
      this.input.value = hex;
      this.host.pick(i);
    }
  }
}
