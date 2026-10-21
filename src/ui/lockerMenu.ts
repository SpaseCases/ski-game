import { COLOR_PARTS, colorName, HEADWEAR, PALETTE, type ColorPart, type Headwear, type Outfit } from '../core/outfit.ts';
import type { Rect } from '../render/lockerStage.ts';
import { addBackButton, board, setHints, type Screen } from './menus.ts';

// The Locker: the skier turning slowly in a window on the left (drawn by the
// game's renderer through a hole in the menu, see LockerStage), the choices
// on the right. Outfit: three headwear tiles, then a strip of paint chips
// per part, all from one palette, so arrows move across a row and up and
// down a column. Skis: the ski in use (milestone 6d adds the choices).

export interface LockerHooks {
  get: () => Outfit;
  set: (outfit: Outfit) => void;
  /** The Locker opened (true) or closed or was covered (false). */
  shown: (open: boolean) => void;
}

/** Small flat drawings for the headwear tiles. */
const ICONS: Record<Headwear, string> = {
  helmet:
    '<path d="M6 25 C6 11 13 5 20 5 C27 5 34 11 34 25 Z" fill="#2c3037"/><rect x="7" y="19" width="26" height="7" rx="3" fill="#5a6676"/><rect x="5" y="25" width="30" height="3" rx="1.5" fill="#1b1d21"/>',
  santa:
    '<path d="M8 22 C10 10 18 4 28 7 C33 9 35 13 34 16 C29 12 25 13 30 22 Z" fill="#c3262e"/><circle cx="33" cy="17" r="3.6" fill="#f3f1ec"/><rect x="6" y="21" width="27" height="7" rx="3.5" fill="#f3f1ec"/>',
  pumpkin:
    '<ellipse cx="20" cy="19" rx="14" ry="11" fill="#e8761e"/><path d="M14 9 C12 14 12 24 14 29 M26 9 C28 14 28 24 26 29" stroke="#c95f14" stroke-width="1.6" fill="none"/><path d="M19 9 L20 3 L23 4 L21 9 Z" fill="#6e6a2c"/><path d="M12 17 L15 12 L18 17 Z M22 17 L25 12 L28 17 Z" fill="#2a1206"/><path d="M11 21 C15 26 25 26 29 21 L26 24 L23 22 L20 25 L17 22 L14 24 Z" fill="#2a1206"/>',
};

export class LockerScreen implements Screen {
  readonly el: HTMLElement;
  private readonly hooks: LockerHooks;
  private readonly view: HTMLElement;
  private readonly tabs: HTMLButtonElement[] = [];
  private readonly panels: HTMLElement[] = [];
  private readonly headwear = new Map<Headwear, HTMLButtonElement>();
  private readonly rows = new Map<ColorPart, { row: HTMLElement; name: HTMLElement; chips: Map<string, HTMLButtonElement> }>();
  private readonly rect: Rect = { x: 0, y: 0, width: 0, height: 0 };

  constructor(hooks: LockerHooks, onBack: () => void) {
    this.hooks = hooks;
    const b = board('Locker', 'locker-screen');
    this.el = b.el;
    addBackButton(b.head, onBack);
    b.sub.textContent = 'Dress your skier. Your picks are kept in this browser.';
    b.sub.hidden = false;

    const layout = document.createElement('div');
    layout.className = 'locker-layout';

    // The window the preview shows through.
    const frame = document.createElement('div');
    frame.className = 'locker-frame';
    this.view = document.createElement('div');
    this.view.className = 'locker-view';
    this.view.setAttribute('role', 'img');
    this.view.setAttribute('aria-label', 'Your skier, turning slowly');
    frame.appendChild(this.view);

    const choices = document.createElement('div');
    choices.className = 'locker-choices';
    const tabRow = document.createElement('div');
    tabRow.className = 'locker-tabs';
    tabRow.setAttribute('role', 'tablist');
    choices.appendChild(tabRow);
    for (const [i, name] of ['Outfit', 'Skis'].entries()) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'locker-tab';
      tab.setAttribute('role', 'tab');
      tab.textContent = name;
      tab.addEventListener('click', () => this.showTab(i));
      tabRow.appendChild(tab);
      this.tabs.push(tab);
      const panel = document.createElement('div');
      panel.className = 'locker-panel';
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-label', name);
      choices.appendChild(panel);
      this.panels.push(panel);
    }
    this.buildOutfit(this.panels[0]!);
    this.buildSkis(this.panels[1]!);

    layout.append(frame, choices);
    b.body.appendChild(layout);
    setHints(b.foot, [
      [['←', '→'], 'Choose a color'],
      [['↑', '↓'], 'Next part'],
      [['Enter'], 'Pick'],
      [['Esc'], 'Back'],
    ]);
    this.showTab(0);
  }

  enter(): HTMLElement | null {
    this.sync();
    this.hooks.shown(true);
    const o = this.hooks.get();
    return this.tabs[1]?.getAttribute('aria-selected') === 'true' ? this.tabs[1]! : this.headwear.get(o.headwear) ?? null;
  }

  leave(): void {
    this.hooks.shown(false);
  }

  /** Where the preview shows, in CSS pixels from the viewport's top left (read every frame while open). */
  viewRect(): Rect {
    const r = this.view.getBoundingClientRect();
    this.rect.x = Math.round(r.left);
    this.rect.y = Math.round(r.top);
    this.rect.width = Math.round(r.width);
    this.rect.height = Math.round(r.height);
    return this.rect;
  }

  private buildOutfit(panel: HTMLElement): void {
    const head = document.createElement('div');
    head.className = 'locker-headwear';
    head.setAttribute('role', 'group');
    head.setAttribute('aria-label', 'Headwear');
    for (const { id, name } of HEADWEAR) {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'headwear-tile';
      tile.innerHTML = `<svg viewBox="0 0 40 32" aria-hidden="true">${ICONS[id]}</svg>`;
      const label = document.createElement('span');
      label.textContent = name;
      tile.appendChild(label);
      tile.addEventListener('click', () => this.pick({ headwear: id }));
      head.appendChild(tile);
      this.headwear.set(id, tile);
    }
    panel.appendChild(head);

    for (const { id, name } of COLOR_PARTS) {
      const row = document.createElement('div');
      row.className = 'paint-row';
      row.setAttribute('role', 'group');
      row.setAttribute('aria-label', name);
      const label = document.createElement('div');
      label.className = 'paint-head';
      const part = document.createElement('span');
      part.className = 'paint-part';
      part.textContent = name;
      const chosen = document.createElement('span');
      chosen.className = 'paint-name';
      label.append(part, chosen);
      const strip = document.createElement('div');
      strip.className = 'paint-chips';
      const chips = new Map<string, HTMLButtonElement>();
      for (const color of PALETTE) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip';
        chip.style.setProperty('--chip', color.hex);
        chip.setAttribute('aria-label', `${name}: ${color.name}`);
        chip.title = color.name;
        chip.addEventListener('click', () => this.pick({ [id]: color.hex }));
        strip.appendChild(chip);
        chips.set(color.hex, chip);
      }
      row.append(label, strip);
      panel.appendChild(row);
      this.rows.set(id, { row, name: chosen, chips });
    }
  }

  private buildSkis(panel: HTMLElement): void {
    const card = document.createElement('div');
    card.className = 'ski-current';
    const name = document.createElement('p');
    name.className = 'ski-name';
    name.textContent = 'Park ski';
    const art = document.createElement('p');
    art.className = 'ski-art';
    art.textContent = 'Lime tips, black topsheet, blue base';
    const note = document.createElement('p');
    note.className = 'setting-note';
    note.textContent = 'More skis and graphics are on the way.';
    card.append(name, art, note);
    panel.appendChild(card);
  }

  private pick(change: Partial<Outfit>): void {
    this.hooks.set({ ...this.hooks.get(), ...change });
    this.sync();
  }

  private showTab(index: number): void {
    this.tabs.forEach((t, i) => t.setAttribute('aria-selected', String(i === index)));
    this.panels.forEach((p, i) => (p.hidden = i !== index));
  }

  /** Marks the outfit's picks. */
  private sync(): void {
    const o = this.hooks.get();
    for (const [id, tile] of this.headwear) tile.setAttribute('aria-pressed', String(o.headwear === id));
    for (const { id } of COLOR_PARTS) {
      const r = this.rows.get(id)!;
      for (const [hex, chip] of r.chips) chip.setAttribute('aria-pressed', String(o[id] === hex));
      const hidden = o.headwear === 'pumpkin' && (id === 'helmet' || id === 'goggleFrame' || id === 'goggleStrap');
      r.row.classList.toggle('is-covered', hidden);
      r.name.textContent = hidden ? `${colorName(o[id])}, under the pumpkin` : colorName(o[id]);
    }
  }
}
