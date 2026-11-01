import { CONFIG } from '../config.ts';
import {
  COLOR_PARTS,
  colorName,
  contrastColor,
  GARMENTS,
  HEADWEAR,
  PALETTE,
  PATTERNS,
  type ColorPart,
  type Garment,
  type Headwear,
  type Outfit,
  type Pattern,
} from '../core/outfit.ts';
import {
  drawSki,
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
// on the right. Outfit: the headwear tiles, then a strip of paint chips
// per part, all from one palette, so arrows move across a row and up and
// down a column; under the jacket and the pants, a row of pattern tiles
// and (unless plain) a strip for the pattern's second color. Skis: a tile
// per ski type (its side profile), a rack of its graphics (each pair of
// skis drawn from the same data the 3D skis are painted from, top sheets
// or bases), stat bars against the park ski, marked at the middle, and
// the poles switch.

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
  beanie:
    '<circle cx="20" cy="5.5" r="4" fill="#f3f1ec"/><path d="M7 22 C7 11 13 7 20 7 C27 7 33 11 33 22 Z" fill="#2f7fe0"/><rect x="6" y="19" width="28" height="9" rx="2" fill="#22395e"/><path d="M10 19 V28 M14 19 V28 M18 19 V28 M22 19 V28 M26 19 V28 M30 19 V28" stroke="#2f7fe0" stroke-width="1.2"/>',
  cap:
    '<path d="M7 23 C7 12 13 7 20 7 C27 7 33 12 33 23 Z" fill="#d33a3f"/><path d="M20 7 V23" stroke="#a52a2f" stroke-width="1.2"/><path d="M31 20 C35 20 39 22 39 25 L30 25 Z" fill="#a52a2f"/><path d="M7 23 C9 18 12 17 14 18 L14 23 Z" fill="#3a3f47"/><circle cx="20" cy="7" r="1.6" fill="#a52a2f"/>',
  bucket:
    '<path d="M10 20 L12 9 C14 6 26 6 28 9 L30 20 Z" fill="#c8b07e"/><path d="M3 26 C6 21 10 20 20 20 C30 20 34 21 37 26 Z" fill="#a8925f"/>',
  hood:
    '<path d="M5 30 C4 13 11 3 20 3 C29 3 36 13 35 30 Z" fill="#23898a"/><path d="M11 30 C10 18 14 11 20 11 C26 11 30 18 29 30 Z" fill="#14555a"/><path d="M13 22 C13 15 16 13 20 13 C24 13 27 15 27 22 Z" fill="#2c3037"/><rect x="12" y="19" width="16" height="5" rx="2" fill="#5a6676"/>',
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
  private readonly rows = new Map<ColorPart, PaintRow>();
  /** Each garment's pattern tiles and second-color strip. */
  private readonly patterns = new Map<Garment, { name: HTMLElement; tiles: Map<Pattern, HTMLButtonElement>; accent: PaintRow }>();
  private readonly poleButtons: HTMLButtonElement[] = [];
  private readonly skiTiles = new Map<SkiId, HTMLButtonElement>();
  private readonly graphicButtons = new Map<string, { button: HTMLButtonElement; ski: SkiId }>();
  private readonly statBars = new Map<SkiStat, HTMLElement>();
  /** The graphic last picked on each ski this visit, so switching type and back keeps it. */
  private readonly lastGraphic = new Map<SkiId, string>();
  private skiBlurb!: HTMLElement;
  private skiGraphicName!: HTMLElement;
  /** The rack shows the bases (true) or the top sheets. */
  private showBases = false;
  private readonly faceButtons: HTMLButtonElement[] = [];
  private readonly thumbs: { canvas: HTMLCanvasElement; base: boolean }[] = [];
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
      const row = paintRow(name, (hex) => this.pick({ [id]: hex }));
      panel.appendChild(row.row);
      this.rows.set(id, row);
      const garment = GARMENTS.find((g) => g.id === id);
      if (garment) this.buildPattern(panel, garment);
    }
  }

  /** A garment's pattern tiles, then the strip for its second color. */
  private buildPattern(panel: HTMLElement, garment: (typeof GARMENTS)[number]): void {
    const head = document.createElement('div');
    head.className = 'paint-head';
    const part = document.createElement('span');
    part.className = 'paint-part';
    part.textContent = `${garment.name} pattern`;
    const chosen = document.createElement('span');
    chosen.className = 'paint-name';
    head.append(part, chosen);
    const strip = document.createElement('div');
    strip.className = 'pattern-tiles';
    const tiles = new Map<Pattern, HTMLButtonElement>();
    for (const { id, name } of PATTERNS) {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'pattern-tile';
      tile.setAttribute('aria-label', `${garment.name}: ${name}`);
      const swatch = document.createElement('span');
      swatch.className = 'pattern-swatch';
      const label = document.createElement('span');
      label.textContent = name;
      tile.append(swatch, label);
      tile.addEventListener('click', () => {
        const o = this.hooks.get();
        const change: Partial<Outfit> = { [garment.pattern]: id };
        // Leaving plain: start from a color that stands out on the garment's.
        if (o[garment.pattern] === 'plain' && id !== 'plain') change[garment.accent] = contrastColor(o[garment.id]);
        this.pick(change);
      });
      strip.appendChild(tile);
      tiles.set(id, tile);
    }
    const row = document.createElement('div');
    row.className = 'paint-row pattern-row';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', `${garment.name} pattern`);
    row.append(head, strip);
    panel.appendChild(row);
    const accent = paintRow(`${garment.name} second color`, (hex) => this.pick({ [garment.accent]: hex }));
    panel.appendChild(accent.row);
    this.patterns.set(garment.id, { name: chosen, tiles, accent });
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
    // Top sheets or bases in the rack.
    const faces = document.createElement('div');
    faces.className = 'segmented ski-faces';
    faces.setAttribute('role', 'group');
    faces.setAttribute('aria-label', 'Show');
    for (const [base, label] of [
      [false, 'Top'],
      [true, 'Base'],
    ] as const) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'segment';
      b.textContent = label;
      b.addEventListener('click', () => {
        this.showBases = base;
        this.sync();
      });
      faces.appendChild(b);
      this.faceButtons.push(b);
    }
    head.append(part, this.skiGraphicName, faces);

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
        for (const base of [false, true]) {
          const canvas = skiThumb(type, g, base);
          button.appendChild(canvas);
          this.thumbs.push({ canvas, base });
        }
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

    // Poles: on, or off (Shift's push becomes a skating step).
    const poles = document.createElement('div');
    poles.className = 'poles-row';
    const polesName = document.createElement('span');
    polesName.className = 'stat-name';
    polesName.textContent = 'Poles';
    const polesSwitch = document.createElement('div');
    polesSwitch.className = 'segmented poles-switch';
    polesSwitch.setAttribute('role', 'group');
    polesSwitch.setAttribute('aria-label', 'Poles');
    for (const [on, label] of [
      [true, 'On'],
      [false, 'Off'],
    ] as const) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'segment';
      b.textContent = label;
      b.addEventListener('click', () => this.pick({ poles: on }));
      polesSwitch.appendChild(b);
      this.poleButtons.push(b);
    }
    poles.append(polesName, polesSwitch);
    const polesNote = document.createElement('p');
    polesNote.className = 'setting-note';
    polesNote.textContent = 'Without poles, Shift skates off one leg, then the other.';

    panel.append(types, this.skiBlurb, head, rack, stats, note, poles, polesNote);
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
    for (const g of GARMENTS) {
      const p = this.patterns.get(g.id)!;
      const pattern = o[g.pattern];
      for (const [id, tile] of p.tiles) {
        tile.setAttribute('aria-pressed', String(pattern === id));
        tile.querySelector('.pattern-swatch')!.innerHTML = patternSwatch(id, o[g.id], o[g.accent]);
      }
      p.name.textContent = PATTERNS.find((x) => x.id === pattern)!.name;
      p.accent.row.hidden = pattern === 'plain';
      for (const [hex, chip] of p.accent.chips) chip.setAttribute('aria-pressed', String(o[g.accent] === hex));
      p.accent.name.textContent = colorName(o[g.accent]);
    }
    this.poleButtons.forEach((b, i) => b.setAttribute('aria-pressed', String((i === 0) === o.poles)));

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
    this.faceButtons.forEach((b, i) => b.setAttribute('aria-pressed', String((i === 1) === this.showBases)));
    for (const { canvas, base } of this.thumbs) canvas.hidden = base !== this.showBases;
    const stats = skiStats(o.ski);
    for (const [id, bar] of this.statBars) {
      const steps = statSteps(stats[id]);
      bar.setAttribute('aria-valuenow', String(steps));
      bar.querySelectorAll('i').forEach((seg, i) => seg.classList.toggle('on', i < steps));
    }
  }
}

interface PaintRow {
  row: HTMLElement;
  name: HTMLElement;
  chips: Map<string, HTMLButtonElement>;
}

/** A labelled strip of paint chips, one per palette color, calling `onPick` with the color picked. */
function paintRow(name: string, onPick: (hex: string) => void): PaintRow {
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
    chip.addEventListener('click', () => onPick(color.hex));
    strip.appendChild(chip);
    chips.set(color.hex, chip);
  }
  row.append(label, strip);
  return { row, name: chosen, chips };
}

/** A small flat drawing of a pattern in the garment's colors, for its tile (roughly as the 3D garment paints it). */
function patternSwatch(pattern: Pattern, base: string, accent: string): string {
  const dark = scaleHex(base, 0.62);
  let art = '';
  if (pattern === 'stripes') art = `<rect y="5" width="30" height="4" fill="${accent}"/><rect y="12" width="30" height="4" fill="${accent}"/>`;
  else if (pattern === 'blocks') art = `<rect width="30" height="7" fill="${accent}"/>`;
  else if (pattern === 'camo') {
    art =
      `<path d="M2 3 C7 1 11 5 9 9 C6 12 1 9 2 3 Z M17 11 C22 8 28 12 25 17 C21 20 15 16 17 11 Z" fill="${accent}"/>` +
      `<path d="M14 1 C19 0 21 4 18 6 C15 8 12 5 14 1 Z M4 14 C8 12 11 15 9 18 C6 20 2 18 4 14 Z M24 2 C28 2 29 6 27 8 C24 9 22 5 24 2 Z" fill="${dark}"/>`;
  } else if (pattern === 'plaid') {
    const cross = scaleHex(mixHex(base, accent), 0.55);
    const bands = [0, 10, 20].map((x) => `<rect x="${x}" width="5" height="20" fill="${accent}"/>`).join('') + [0, 10].map((y) => `<rect y="${y}" width="30" height="5" fill="${accent}"/>`).join('');
    art = bands + [0, 10, 20].flatMap((x) => [0, 10].map((y) => `<rect x="${x}" y="${y}" width="5" height="5" fill="${cross}"/>`)).join('');
  }
  return `<svg viewBox="0 0 30 20" aria-hidden="true"><rect width="30" height="20" fill="${base}"/>${art}</svg>`;
}

/** A hex color times `k` (darker below 1), as a hex color. */
function scaleHex(hex: string, k: number): string {
  const v = parseInt(hex.slice(1), 16);
  return toHex([16, 8, 0].map((s) => Math.round(((v >> s) & 255) * k)));
}

/** Halfway between two hex colors. */
function mixHex(a: string, b: string): string {
  const va = parseInt(a.slice(1), 16);
  const vb = parseInt(b.slice(1), 16);
  return toHex([16, 8, 0].map((s) => Math.round((((va >> s) & 255) + ((vb >> s) & 255)) / 2)));
}

function toHex(rgb: number[]): string {
  return `#${rgb.map((x) => Math.min(255, x).toString(16).padStart(2, '0')).join('')}`;
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

/** A canvas of the pair of skis seen from above (or their bases), tip to the right, the left ski on top, painted cell by cell like the 3D skis. */
function skiThumb(type: SkiType, g: SkiGraphic, base: boolean): HTMLCanvasElement {
  const w = Math.round(type.model.length * RACK_PX_PER_M);
  const maxHalf = Math.max(...SKI_TYPES.flatMap((t) => t.model.width.map(([, hw]) => hw)));
  const skiH = Math.ceil(2 * maxHalf * RACK_PX_PER_M) + 1;
  const gap = 3;
  const h = skiH * 2 + gap;
  const canvas = document.createElement('canvas');
  canvas.className = 'ski-thumb';
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const img = ctx.createImageData(w, h);
  for (const [row, side] of [
    [0, -1],
    [1, 1],
  ] as const) {
    drawSki(type, g, side, base, RACK_PX_PER_M, row * (skiH + gap) + skiH / 2, (x, y, hex) => {
      if (x >= w || y < 0 || y >= h) return;
      const i = (y * w + x) * 4;
      img.data[i] = parseInt(hex.slice(1, 3), 16);
      img.data[i + 1] = parseInt(hex.slice(3, 5), 16);
      img.data[i + 2] = parseInt(hex.slice(5, 7), 16);
      img.data[i + 3] = 255;
    });
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
