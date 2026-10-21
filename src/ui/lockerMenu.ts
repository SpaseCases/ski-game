import { CONFIG } from '../config.ts';
import { COLOR_PARTS, colorName, HEADWEAR, PALETTE, type ColorPart, type Headwear, type Outfit } from '../core/outfit.ts';
import {
  aspectOf,
  graphicColor,
  halfWidthAt,
  riseAt,
  SKI_STATS,
  SKI_TYPES,
  skiGraphic,
  skiStats,
  skiType,
  type SkiGraphic,
  type SkiId,
  type SkiStat,
  type SkiType,
} from '../core/skis.ts';
import type { Rect } from '../render/lockerStage.ts';
import { addBackButton, board, setHints, type Screen } from './menus.ts';

// The Locker: the skier turning slowly in a window on the left (drawn by the
// game's renderer through a hole in the menu, see LockerStage), the choices
// on the right. Outfit: three headwear tiles, then a strip of paint chips
// per part, all from one palette, so arrows move across a row and up and
// down a column. Skis: a tile per ski type (its side profile), a rack of
// its graphics (each drawn from the same data the 3D ski is painted from),
// and stat bars against the park ski, marked at the middle.

export interface LockerHooks {
  get: () => Outfit;
  set: (outfit: Outfit) => void;
  /** The Locker opened (true) or closed or was covered (false). */
  shown: (open: boolean) => void;
  /** The Skis tab is showing (the preview looks at the skis) or not. */
  skisShown: (skis: boolean) => void;
}

/** Segments in a stat bar; the park ski fills half. */
const STAT_STEPS = 10;
/** Thumbnails' scale: the longest ski fills this many CSS pixels. */
const RACK_WIDTH = 300;
const RACK_PX_PER_M = RACK_WIDTH / Math.max(...SKI_TYPES.map((t) => t.model.length));

const OUTFIT_HINTS = [
  [['←', '→'], 'Choose a color'],
  [['↑', '↓'], 'Next part'],
  [['Enter'], 'Pick'],
  [['Esc'], 'Back'],
] as const;
const SKI_HINTS = [
  [['←', '→'], 'Choose a ski'],
  [['↑', '↓'], 'Graphics'],
  [['Enter'], 'Pick'],
  [['Esc'], 'Back'],
] as const;

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
  private readonly skiTiles = new Map<SkiId, HTMLButtonElement>();
  private readonly graphicButtons = new Map<string, { button: HTMLButtonElement; ski: SkiId }>();
  private readonly statBars = new Map<SkiStat, HTMLElement>();
  /** The graphic last picked on each ski this visit, so switching type and back keeps it. */
  private readonly lastGraphic = new Map<SkiId, string>();
  private skiBlurb!: HTMLElement;
  private skiGraphicName!: HTMLElement;
  private readonly foot: HTMLElement;
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
    this.foot = b.foot;
    this.showTab(0);
  }

  enter(): HTMLElement | null {
    this.sync();
    this.hooks.shown(true);
    const o = this.hooks.get();
    if (this.onSkis()) {
      this.hooks.skisShown(true);
      return this.skiTiles.get(o.ski) ?? null;
    }
    return this.headwear.get(o.headwear) ?? null;
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
    const types = document.createElement('div');
    types.className = 'ski-types';
    types.setAttribute('role', 'group');
    types.setAttribute('aria-label', 'Ski');
    for (const type of SKI_TYPES) {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'ski-tile';
      tile.innerHTML = `<svg viewBox="0 0 100 26" aria-hidden="true"><path d="${profilePath(type)}"/></svg>`;
      const name = document.createElement('span');
      name.textContent = type.name;
      tile.appendChild(name);
      tile.addEventListener('click', () => {
        const o = this.hooks.get();
        if (o.ski !== type.id) this.pick({ ski: type.id, skiGraphic: this.lastGraphic.get(type.id) ?? type.graphics[0]!.id });
      });
      types.appendChild(tile);
      this.skiTiles.set(type.id, tile);
    }
    this.skiBlurb = document.createElement('p');
    this.skiBlurb.className = 'ski-blurb';

    const head = document.createElement('div');
    head.className = 'paint-head ski-rack-head';
    const part = document.createElement('span');
    part.className = 'paint-part';
    part.textContent = 'Graphic';
    this.skiGraphicName = document.createElement('span');
    this.skiGraphicName.className = 'paint-name';
    head.append(part, this.skiGraphicName);

    // The rack: every graphic of every ski, only the chosen ski's showing.
    const rack = document.createElement('div');
    rack.className = 'ski-rack';
    rack.setAttribute('role', 'group');
    rack.setAttribute('aria-label', 'Graphic');
    for (const type of SKI_TYPES) {
      for (const g of type.graphics) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ski-graphic';
        button.setAttribute('aria-label', `${type.name}: ${g.name}`);
        button.appendChild(skiThumb(type, g));
        const label = document.createElement('span');
        label.textContent = g.name;
        button.appendChild(label);
        button.addEventListener('click', () => this.pick({ ski: type.id, skiGraphic: g.id }));
        rack.appendChild(button);
        this.graphicButtons.set(g.id, { button, ski: type.id });
      }
    }

    const stats = document.createElement('div');
    stats.className = 'ski-stats';
    for (const { id, name } of SKI_STATS) {
      const label = document.createElement('span');
      label.className = 'stat-name';
      label.textContent = name;
      const bar = document.createElement('span');
      bar.className = 'stat-bar';
      bar.setAttribute('role', 'meter');
      bar.setAttribute('aria-label', name);
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', String(STAT_STEPS));
      for (let i = 0; i < STAT_STEPS; i++) bar.appendChild(document.createElement('i'));
      stats.append(label, bar);
      this.statBars.set(id, bar);
    }
    const note = document.createElement('p');
    note.className = 'setting-note';
    note.textContent = 'The mark in each bar is the park ski.';

    panel.append(types, this.skiBlurb, head, rack, stats, note);
  }

  private pick(change: Partial<Outfit>): void {
    this.hooks.set({ ...this.hooks.get(), ...change });
    this.sync();
  }

  private showTab(index: number): void {
    this.tabs.forEach((t, i) => t.setAttribute('aria-selected', String(i === index)));
    this.panels.forEach((p, i) => (p.hidden = i !== index));
    setHints(this.foot, index === 1 ? SKI_HINTS : OUTFIT_HINTS);
    this.hooks.skisShown(index === 1);
  }

  private onSkis(): boolean {
    return this.tabs[1]?.getAttribute('aria-selected') === 'true';
  }

  /** Marks the outfit's picks. */
  private sync(): void {
    const o = this.hooks.get();
    for (const [id, tile] of this.headwear) tile.setAttribute('aria-pressed', String(o.headwear === id));
    for (const { id } of COLOR_PARTS) {
      const r = this.rows.get(id)!;
      for (const [hex, chip] of r.chips) chip.setAttribute('aria-pressed', String(o[id] === hex));
      const hidden = o.headwear === 'pumpkin' && (id === 'helmet' || id === 'goggleFrame' || id === 'goggleLens' || id === 'goggleStrap' || id === 'gaiter');
      r.row.classList.toggle('is-covered', hidden);
      r.name.textContent = hidden ? `${colorName(o[id])}, under the pumpkin` : colorName(o[id]);
    }

    const type = skiType(o.ski);
    const graphic = skiGraphic(o.ski, o.skiGraphic);
    this.lastGraphic.set(o.ski, graphic.id);
    for (const [id, tile] of this.skiTiles) tile.setAttribute('aria-pressed', String(o.ski === id));
    for (const [id, { button, ski }] of this.graphicButtons) {
      button.hidden = ski !== o.ski;
      button.setAttribute('aria-pressed', String(id === graphic.id));
    }
    this.skiBlurb.textContent = type.blurb;
    this.skiGraphicName.textContent = graphic.name;
    const stats = skiStats(o.ski);
    for (const [id, bar] of this.statBars) {
      const steps = statSteps(stats[id]);
      bar.setAttribute('aria-valuenow', String(steps));
      bar.querySelectorAll('i').forEach((seg, i) => seg.classList.toggle('on', i < steps));
    }
  }
}

/** Segments lit for a stat (1 is the park ski's: half the bar). */
function statSteps(stat: number): number {
  const share = 0.5 + (stat - 1) * CONFIG.locker.statGain;
  return Math.round(Math.min(1, Math.max(1 / STAT_STEPS, share)) * STAT_STEPS);
}

/** The ski seen side on, its rise exaggerated, as an SVG path in a 100 x 26 box (tip to the right). */
function profilePath(type: SkiType): string {
  const m = type.model;
  const half = m.length / 2;
  const longest = Math.max(...SKI_TYPES.map((t) => t.model.length));
  const scale = 96 / longest;
  const lift = 90;
  const steps = 40;
  const top: string[] = [];
  const bottom: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = -half + (m.length * i) / steps;
    const x = (50 + a * scale).toFixed(1);
    const y = 21 - riseAt(m, a) * lift;
    bottom.push(`${x} ${y.toFixed(1)}`);
    top.push(`${x} ${(y - 2.6).toFixed(1)}`);
  }
  return `M${bottom.join('L')}L${top.reverse().join('L')}Z`;
}

/** A canvas of the graphic on the ski's outline seen from above, tip to the right, painted cell by cell like the 3D ski. */
function skiThumb(type: SkiType, g: SkiGraphic): HTMLCanvasElement {
  const m = type.model;
  const half = m.length / 2;
  const aspect = aspectOf(m);
  const w = Math.round(m.length * RACK_PX_PER_M);
  const maxHalf = Math.max(...SKI_TYPES.flatMap((t) => t.model.width.map(([, hw]) => hw)));
  const h = Math.ceil(2 * maxHalf * RACK_PX_PER_M) + 2;
  const canvas = document.createElement('canvas');
  canvas.className = 'ski-thumb';
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const img = ctx.createImageData(w, h);
  const mid = h / 2;
  for (let px = 0; px < w; px++) {
    const along = -half + ((px + 0.5) / w) * m.length;
    const row = Math.min(m.rows - 1, Math.floor(((along + half) / m.length) * m.rows));
    const u = ((row + 0.5) / m.rows) * 2 - 1;
    const hw = halfWidthAt(m, along) * RACK_PX_PER_M;
    for (let py = Math.max(0, Math.ceil(mid - hw - 0.5)); py < Math.min(h, mid + hw); py++) {
      // Tip to the right, so the ski's left edge (v = -1) is at the top.
      const col = Math.min(m.cols - 1, Math.max(0, Math.floor(((py + 0.5 - (mid - hw)) / (2 * hw)) * m.cols)));
      const hex = graphicColor(g, u, -1 + (2 * col + 1) / m.cols, aspect);
      const i = (py * w + px) * 4;
      img.data[i] = parseInt(hex.slice(1, 3), 16);
      img.data[i + 1] = parseInt(hex.slice(3, 5), 16);
      img.data[i + 2] = parseInt(hex.slice(5, 7), 16);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
