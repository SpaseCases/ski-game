import { CONFIG } from '../config.ts';
import {
  COLOR_PARTS,
  colorName,
  contrastColor,
  GARMENTS,
  HEADWEAR,
  isCustomPattern,
  PALETTE,
  PATTERNS,
  WEAR_SLOTS,
  type ColorPart,
  type Garment,
  type Headwear,
  type Outfit,
  type Pattern,
} from '../core/outfit.ts';
import { BOARD_TYPES, boardGraphic, boardStats, boardType, type BoardId } from '../core/boards.ts';
import { boardGear, customGraphic, customId, gearBoard, gearType, type Gear } from '../core/customSkis.ts';
import { wearCells, wearPalette, wearPattern } from '../core/customWear.ts';
import { wearOffsets, wearPanels } from '../render/wearPanels.ts';
import {
  CUSTOM_SLOTS,
  riseAt,
  SKI_STATS,
  SKI_TYPES,
  skiGraphic,
  skiStats,
  skiType,
  type SkiGraphic,
  type SkiId,
  type SkiModel,
  type SkiStat,
  type SkiType,
} from '../core/skis.ts';
import type { Rect, StageWindow } from '../render/lockerStage.ts';
import { addBackButton, board, setHints, type Screen } from './menus.ts';
import { paintSkis } from './skiThumb.ts';
import { drawWear } from './wearGrid.ts';

// The Locker: the skier turning slowly in a window on the left (drawn by the
// game's renderer through a hole in the menu, see LockerStage), the choices
// on the right. Outfit: the headwear tiles, then a strip of paint chips
// per part, all from one palette, so arrows move across a row and up and
// down a column; under the jacket and the pants, a row of pattern tiles
// and (unless plain) a strip for the pattern's second color. Skis: a tile
// per ski type (its side profile), a rack of its graphics (each pair of
// skis drawn from the same data the 3D skis are painted from, top sheets
// or bases), stat bars against the park ski, marked at the middle, and
// the poles switch. Since milestone 22 part 2 that tab is Ride: a Skis |
// Board switch at its top; on Board the same rows show the three boards,
// their graphics and stats (against the park board), and Regular | Goofy
// stands where the poles switch is. Each ski and (since milestone 23) each
// board has a row of custom slots, each with Edit (the editor, skiEditor.ts),
// and so (since milestone 23 part 2) do the jacket and the pants, under their
// pattern tiles: a painted garment is worn as its pattern (wearEditor.ts).
// Since milestone 24 a third tab, Market, holds the marketplace (the online
// chunk's MarketPanel, which main mounts into it), and each painted custom
// slot has Share under its Edit.

export interface LockerHooks {
  get: () => Outfit;
  set: (outfit: Outfit) => void;
  /** The Locker opened (true) or closed or was covered (false). */
  shown: (open: boolean) => void;
  /** The Ride tab is showing (the preview looks at the skis or the board) or not. */
  skisShown: (skis: boolean) => void;
  /** Opens the editor on that ski's or board's custom slot. */
  edit: (gear: Gear, slot: number) => void;
  /** Opens the garment editor on the jacket's or the pants' custom slot. */
  editWear: (garment: Garment, slot: number) => void;
  /** The Market tab's panel is showing (fill it), or null: it was left. */
  market: (panel: HTMLElement | null) => void;
  /** Share a painted slot on the marketplace. */
  share: (kind: ShareKind, gear: Gear | Garment, slot: number) => void;
}

/** What a custom slot shares as. */
export type ShareKind = 'skis' | 'board' | 'jacket' | 'pants';

/** Segments in a stat bar; the park ski fills half. */
const STAT_STEPS = 10;
/** Thumbnails' scale: the longest ski fills this many CSS pixels. */
const RACK_WIDTH = 300;
const RACK_PX_PER_M = RACK_WIDTH / Math.max(...SKI_TYPES.map((t) => t.model.length));
/** The boards' rack: the same scale, its thumbnails as tall as the widest board. */
const BOARD_MAX_HALF = Math.max(...BOARD_TYPES.flatMap((t) => t.model.width.map(([, hw]) => hw)));
const LONGEST_SKI = Math.max(...SKI_TYPES.map((t) => t.model.length));
const LONGEST_BOARD = Math.max(...BOARD_TYPES.map((t) => t.model.length));
/** A garment slot's thumbnail: CSS pixels a square. */
const WEAR_THUMB_PX = 3;
/** A custom slot never painted: the ski's outline in the plank's hover blue. */
const EMPTY_SLOT: SkiGraphic = { id: 'empty', name: 'Empty', base: '#2b5582', layers: [{ fill: '#2b5582' }] };

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
const BOARD_HINTS = [
  [['←', '→'], 'Choose a board'],
  [['↑', '↓'], 'Graphics'],
  [['Enter'], 'Pick'],
  [['Esc'], 'Back'],
] as const;
const MARKET_HINTS = [
  [['↑', '↓', '←', '→'], 'Move'],
  [['Enter'], 'Pick'],
  [['Esc'], 'Back'],
] as const;
const MARKET_TAB = 2;

/** Small flat drawings for the headwear tiles. */
const ICONS: Record<Headwear, string> = {
  helmet:
    '<path d="M6 25 C6 11 13 5 20 5 C27 5 34 11 34 25 Z" fill="#2c3037"/><rect x="7" y="19" width="26" height="7" rx="3" fill="#5a6676"/><rect x="5" y="25" width="30" height="3" rx="1.5" fill="#1b1d21"/>',
  fullface:
    '<path d="M7 24 C6 11 13 6 20 6 C27 6 34 11 33 24 L28 33 H12 Z" fill="#2c3037"/><path d="M14 27 L20 35 L26 27 Z" fill="#2c3037"/><path d="M10 15 H30 L31 23 H9 Z" fill="#0e0f12"/><rect x="11" y="16.5" width="18" height="5.5" rx="2.5" fill="#5a6676"/><path d="M3 13 C9 8 31 8 37 13 L35 15 C29 11 11 11 5 15 Z" fill="#3a3f47"/>',
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

export class LockerScreen implements Screen, StageWindow {
  readonly el: HTMLElement;
  private readonly hooks: LockerHooks;
  private readonly view: HTMLElement;
  private readonly tabs: HTMLButtonElement[] = [];
  private readonly panels: HTMLElement[] = [];
  private readonly headwear = new Map<Headwear, HTMLButtonElement>();
  private readonly rows = new Map<ColorPart, PaintRow>();
  /** Each garment's pattern tiles and second-color strip. */
  private readonly patterns = new Map<Garment, { name: HTMLElement; tiles: Map<Pattern, HTMLButtonElement>; accent: PaintRow }>();
  /** Each garment's custom slots: the pick button, its note and its thumbnail. */
  private readonly wearSlots: { garment: Garment; slot: number; button: HTMLButtonElement; note: HTMLElement; thumb: HTMLCanvasElement; share: HTMLButtonElement }[] = [];
  private readonly poleButtons: HTMLButtonElement[] = [];
  private readonly skiTiles = new Map<SkiId, HTMLButtonElement>();
  /** Skis or Board, its board tiles, Regular / Goofy, and the rows only skis (or only a board) show. */
  private readonly rideButtons: HTMLButtonElement[] = [];
  private readonly boardTiles = new Map<BoardId, HTMLButtonElement>();
  private readonly stanceButtons: HTMLButtonElement[] = [];
  private readonly skiOnly: HTMLElement[] = [];
  private readonly boardOnly: HTMLElement[] = [];
  private readonly boardButtons = new Map<string, { button: HTMLButtonElement; board: BoardId }>();
  private readonly lastBoardGraphic = new Map<BoardId, string>();
  private statNote!: HTMLElement;
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
  /** Each ski's and board's row of custom slots, and each slot's pick button, name and thumbnails. */
  private readonly customRows = new Map<Gear, HTMLElement>();
  private readonly customs: { gear: Gear; slot: number; button: HTMLButtonElement; note: HTMLElement; thumbs: { canvas: HTMLCanvasElement; base: boolean }[]; share: HTMLButtonElement }[] = [];
  private readonly foot: HTMLElement;
  private readonly rect: Rect = { x: 0, y: 0, width: 0, height: 0 };
  /** The preview's own canvas in the window (render/lockerStage.ts present copies it in). */
  private readonly preview: CanvasRenderingContext2D | null;

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
    this.preview = previewCanvas(this.view);
    frame.appendChild(this.view);

    const choices = document.createElement('div');
    choices.className = 'locker-choices';
    const tabRow = document.createElement('div');
    tabRow.className = 'locker-tabs';
    tabRow.setAttribute('role', 'tablist');
    choices.appendChild(tabRow);
    for (const [i, name] of ['Outfit', 'Ride', 'Market'].entries()) {
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
    const loading = document.createElement('p');
    loading.className = 'setting-note';
    loading.textContent = 'Loading the marketplace…';
    this.panels[MARKET_TAB]!.appendChild(loading);

    layout.append(frame, choices);
    b.body.appendChild(layout);
    this.foot = b.foot;
    this.showTab(0);
  }

  enter(): HTMLElement | null {
    this.paintCustoms();
    this.sync();
    this.hooks.shown(true);
    const o = this.hooks.get();
    if (this.onMarket()) {
      this.hooks.market(this.panels[MARKET_TAB]!);
      return this.tabs[MARKET_TAB]!;
    }
    if (this.onSkis()) {
      this.hooks.skisShown(true);
      return (o.ride === 'board' ? this.boardTiles.get(o.board) : this.skiTiles.get(o.ski)) ?? null;
    }
    return this.headwear.get(o.headwear) ?? null;
  }

  leave(): void {
    this.hooks.shown(false);
    this.hooks.market(null);
  }

  /** Repaints the custom slots and the picks (the marketplace's Use changed them). */
  refresh(): void {
    this.paintCustoms();
    this.sync();
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

  viewContext(): CanvasRenderingContext2D | null {
    return this.preview;
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
    // The garment painted square by square (milestone 23 part 2): three slots, each with Edit.
    const customs = document.createElement('div');
    customs.className = 'ski-customs wear-customs';
    customs.setAttribute('role', 'group');
    customs.setAttribute('aria-label', `${garment.name}: your designs`);
    for (let slot = 0; slot < WEAR_SLOTS; slot++) {
      const cell = document.createElement('div');
      cell.className = 'ski-custom';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ski-graphic ski-custom-pick';
      const thumb = document.createElement('canvas');
      thumb.className = 'wear-thumb';
      const name = document.createElement('span');
      name.className = 'ski-custom-name';
      name.textContent = `Custom ${slot + 1}`;
      const note = document.createElement('span');
      note.className = 'ski-custom-note';
      name.appendChild(note);
      button.append(thumb, name);
      button.addEventListener('click', () => {
        if (!wearCells(garment.id, slot)) this.hooks.editWear(garment.id, slot);
        else this.pick({ [garment.pattern]: wearPattern(slot) });
      });
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'ski-edit';
      edit.textContent = 'Edit';
      edit.setAttribute('aria-label', `Edit ${garment.name.toLowerCase()} custom ${slot + 1}`);
      edit.addEventListener('click', () => this.hooks.editWear(garment.id, slot));
      const share = shareButton(`Share ${garment.name.toLowerCase()} custom ${slot + 1}`, () => this.hooks.share(garment.id, garment.id, slot));
      cell.append(button, actions(edit, share));
      customs.appendChild(cell);
      this.wearSlots.push({ garment: garment.id, slot, button, note, thumb, share });
    }
    const row = document.createElement('div');
    row.className = 'paint-row pattern-row';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', `${garment.name} pattern`);
    row.append(head, strip, customs);
    panel.appendChild(row);
    const accent = paintRow(`${garment.name} second color`, (hex) => this.pick({ [garment.accent]: hex }));
    panel.appendChild(accent.row);
    this.patterns.set(garment.id, { name: chosen, tiles, accent });
  }

  private buildSkis(panel: HTMLElement): void {
    // Skis or a snowboard.
    const ride = switchRow('Ride', 'ride-row', [
      ['Skis', () => this.pick({ ride: 'skis' })],
      ['Board', () => this.pick({ ride: 'board' })],
    ]);
    this.rideButtons.push(...ride.buttons);

    const types = document.createElement('div');
    types.className = 'ski-types';
    types.setAttribute('role', 'group');
    types.setAttribute('aria-label', 'Ski');
    for (const type of SKI_TYPES) {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'ski-tile';
      tile.innerHTML = `<svg viewBox="0 0 100 26" aria-hidden="true"><path d="${profilePath(type.model, LONGEST_SKI)}"/></svg>`;
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
    // The boards, the same way.
    const boards = document.createElement('div');
    boards.className = 'ski-types';
    boards.setAttribute('role', 'group');
    boards.setAttribute('aria-label', 'Board');
    for (const type of BOARD_TYPES) {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'ski-tile';
      tile.innerHTML = `<svg viewBox="0 0 100 26" aria-hidden="true"><path d="${profilePath(type.model, LONGEST_BOARD)}"/></svg>`;
      const name = document.createElement('span');
      name.textContent = type.name;
      tile.appendChild(name);
      tile.addEventListener('click', () => {
        const o = this.hooks.get();
        if (o.board !== type.id) this.pick({ board: type.id, boardGraphic: this.lastBoardGraphic.get(type.id) ?? type.graphics[0]!.id });
      });
      boards.appendChild(tile);
      this.boardTiles.set(type.id, tile);
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
    for (const type of BOARD_TYPES) {
      for (const g of type.graphics) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ski-graphic';
        button.setAttribute('aria-label', `${type.name} board: ${g.name}`);
        for (const base of [false, true]) {
          const canvas = document.createElement('canvas');
          canvas.className = 'ski-thumb';
          paintSkis(canvas, type, g, base, RACK_PX_PER_M, [1], BOARD_MAX_HALF);
          button.appendChild(canvas);
          this.thumbs.push({ canvas, base });
        }
        const label = document.createElement('span');
        label.textContent = g.name;
        button.appendChild(label);
        button.addEventListener('click', () => this.pick({ board: type.id, boardGraphic: g.id }));
        rack.appendChild(button);
        this.boardButtons.set(g.id, { button, board: type.id });
      }
    }

    // The player's own graphics: a row of custom slots per ski and per board, each with Edit.
    const customBox = document.createElement('div');
    const gears: Gear[] = [...SKI_TYPES.map((t) => t.id), ...BOARD_TYPES.map((t) => boardGear(t.id))];
    for (const gear of gears) {
      const name = gearBoard(gear) ? `${gearType(gear).name} board` : gearType(gear).name;
      const row = document.createElement('div');
      row.className = 'ski-customs';
      row.setAttribute('role', 'group');
      row.setAttribute('aria-label', `${name}: your graphics`);
      for (let slot = 0; slot < CUSTOM_SLOTS; slot++) {
        const cell = document.createElement('div');
        cell.className = 'ski-custom';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ski-graphic ski-custom-pick';
        const thumbs = [false, true].map((base) => {
          const canvas = document.createElement('canvas');
          canvas.className = 'ski-thumb';
          button.appendChild(canvas);
          return { canvas, base };
        });
        const label = document.createElement('span');
        label.className = 'ski-custom-name';
        label.textContent = `Custom ${slot + 1}`;
        const note = document.createElement('span');
        note.className = 'ski-custom-note';
        label.appendChild(note);
        button.appendChild(label);
        button.addEventListener('click', () => {
          if (!customGraphic(gear, slot)) this.hooks.edit(gear, slot);
          else {
            const board = gearBoard(gear);
            this.pick(board ? { board, boardGraphic: customId(gear, slot) } : { ski: gear as SkiId, skiGraphic: customId(gear, slot) });
          }
        });
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'ski-edit';
        edit.textContent = 'Edit';
        edit.setAttribute('aria-label', `Edit ${name} custom ${slot + 1}`);
        edit.addEventListener('click', () => this.hooks.edit(gear, slot));
        const share = shareButton(`Share ${name} custom ${slot + 1}`, () => this.hooks.share(gearBoard(gear) ? 'board' : 'skis', gear, slot));
        cell.append(button, actions(edit, share));
        row.appendChild(cell);
        this.customs.push({ gear, slot, button, note, thumbs, share });
      }
      customBox.appendChild(row);
      this.customRows.set(gear, row);
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
    this.statNote = document.createElement('p');
    this.statNote.className = 'setting-note';

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

    // On a board, where the poles switch is: which foot goes forward.
    const stance = switchRow('Stance', 'stance-row', [
      ['Regular', () => this.pick({ stance: 'regular' })],
      ['Goofy', () => this.pick({ stance: 'goofy' })],
    ]);
    this.stanceButtons.push(...stance.buttons);
    const stanceNote = document.createElement('p');
    stanceNote.className = 'setting-note';
    stanceNote.textContent = 'Regular rides left foot forward, goofy right foot forward. Riding backwards is fakie.';

    this.skiOnly.push(types, poles, polesNote);
    this.boardOnly.push(boards, stance.row, stanceNote);
    panel.append(ride.row, types, boards, this.skiBlurb, head, rack, customBox, stats, this.statNote, poles, polesNote, stance.row, stanceNote);
  }

  /** Redraws the custom slots' thumbnails (they change in the editor). */
  private paintCustoms(): void {
    for (const w of this.wearSlots) {
      const cells = wearCells(w.garment, w.slot);
      drawWear(w.thumb, wearPanels(w.garment), wearOffsets(w.garment), cells, wearPalette(w.garment, w.slot), WEAR_THUMB_PX, '#2b5582');
      w.note.textContent = cells ? '' : 'Empty: paint one';
      w.share.hidden = !cells;
      w.button.setAttribute('aria-label', `${w.garment === 'jacket' ? 'Jacket' : 'Pants'}: Custom ${w.slot + 1}${cells ? '' : ', empty'}`);
    }
    for (const c of this.customs) {
      const g = customGraphic(c.gear, c.slot);
      const type = gearType(c.gear);
      const board = gearBoard(c.gear) !== null;
      for (const { canvas, base } of c.thumbs) {
        if (board) paintSkis(canvas, type, g ?? EMPTY_SLOT, base, RACK_PX_PER_M, [1], BOARD_MAX_HALF);
        else paintSkis(canvas, type, g ?? EMPTY_SLOT, base, RACK_PX_PER_M);
      }
      c.note.textContent = g ? '' : 'Empty: paint one';
      c.share.hidden = !g;
      c.button.setAttribute('aria-label', `${type.name}${board ? ' board' : ''}: Custom ${c.slot + 1}${g ? '' : ', empty'}`);
    }
  }

  private pick(change: Partial<Outfit>): void {
    this.hooks.set({ ...this.hooks.get(), ...change });
    this.sync();
  }

  private showTab(index: number): void {
    const was = this.onMarket();
    this.tabs.forEach((t, i) => t.setAttribute('aria-selected', String(i === index)));
    this.panels.forEach((p, i) => (p.hidden = i !== index));
    setHints(this.foot, index === MARKET_TAB ? MARKET_HINTS : index === 1 ? (this.hooks.get().ride === 'board' ? BOARD_HINTS : SKI_HINTS) : OUTFIT_HINTS);
    this.hooks.skisShown(index === 1);
    // The constructor shows the first tab before the hooks may run anything.
    if (index === MARKET_TAB) this.hooks.market(this.panels[MARKET_TAB]!);
    else if (was) this.hooks.market(null);
  }

  private onMarket(): boolean {
    return this.tabs[MARKET_TAB]?.getAttribute('aria-selected') === 'true';
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
      const custom = isCustomPattern(pattern);
      p.name.textContent = custom ? `Custom ${pattern.slice(7)}` : PATTERNS.find((x) => x.id === pattern)!.name;
      // A painted garment has no second color (its Start from uses the one kept here).
      p.accent.row.hidden = pattern === 'plain' || custom;
      for (const [hex, chip] of p.accent.chips) chip.setAttribute('aria-pressed', String(o[g.accent] === hex));
      p.accent.name.textContent = colorName(o[g.accent]);
    }
    for (const w of this.wearSlots) w.button.setAttribute('aria-pressed', String(o[GARMENTS.find((g) => g.id === w.garment)!.pattern] === wearPattern(w.slot)));
    this.poleButtons.forEach((b, i) => b.setAttribute('aria-pressed', String((i === 0) === o.poles)));

    // Skis or the board: each side's rows, picks and stats.
    const onBoard = o.ride === 'board';
    this.rideButtons.forEach((b, i) => b.setAttribute('aria-pressed', String((i === 1) === onBoard)));
    for (const el of this.skiOnly) el.hidden = onBoard;
    for (const el of this.boardOnly) el.hidden = !onBoard;
    this.stanceButtons.forEach((b, i) => b.setAttribute('aria-pressed', String((i === 1) === (o.stance === 'goofy'))));
    if (this.onSkis()) setHints(this.foot, onBoard ? BOARD_HINTS : SKI_HINTS);
    const type = skiType(o.ski);
    const graphic = skiGraphic(o.ski, o.skiGraphic);
    this.lastGraphic.set(o.ski, graphic.id);
    const bType = boardType(o.board);
    const bGraphic = boardGraphic(o.board, o.boardGraphic);
    this.lastBoardGraphic.set(o.board, bGraphic.id);
    for (const [id, tile] of this.skiTiles) tile.setAttribute('aria-pressed', String(o.ski === id));
    for (const [id, tile] of this.boardTiles) tile.setAttribute('aria-pressed', String(o.board === id));
    for (const [id, { button, ski }] of this.graphicButtons) {
      button.hidden = onBoard || ski !== o.ski;
      button.setAttribute('aria-pressed', String(id === graphic.id));
    }
    for (const [id, { button, board }] of this.boardButtons) {
      button.hidden = !onBoard || board !== o.board;
      button.setAttribute('aria-pressed', String(id === bGraphic.id));
    }
    this.skiBlurb.textContent = onBoard ? bType.blurb : type.blurb;
    this.skiGraphicName.textContent = onBoard ? bGraphic.name : graphic.name;
    this.statNote.textContent = onBoard ? 'The mark in each bar is the park board.' : 'The mark in each bar is the park ski.';
    this.faceButtons.forEach((b, i) => b.setAttribute('aria-pressed', String((i === 1) === this.showBases)));
    for (const { canvas, base } of this.thumbs) canvas.hidden = base !== this.showBases;
    // The custom slots of the ski (or the board) being ridden.
    const riding: Gear = onBoard ? boardGear(o.board) : o.ski;
    for (const [gear, row] of this.customRows) row.hidden = gear !== riding;
    for (const c of this.customs) {
      c.button.setAttribute('aria-pressed', String(c.gear === riding && customId(c.gear, c.slot) === (onBoard ? bGraphic.id : graphic.id)));
      for (const { canvas, base } of c.thumbs) canvas.hidden = base !== this.showBases;
    }
    const stats = onBoard ? boardStats(o.board) : skiStats(o.ski);
    for (const [id, bar] of this.statBars) {
      const steps = statSteps(stats[id]);
      bar.setAttribute('aria-valuenow', String(steps));
      bar.querySelectorAll('i').forEach((seg, i) => seg.classList.toggle('on', i < steps));
    }
  }
}

/** A custom slot's Share button (shown once the slot is painted). */
function shareButton(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'ski-edit ski-share';
  b.textContent = 'Share';
  b.setAttribute('aria-label', label);
  b.hidden = true;
  b.addEventListener('click', onClick);
  return b;
}

/** Edit over Share, beside a custom slot. */
function actions(edit: HTMLElement, share: HTMLElement): HTMLElement {
  const box = document.createElement('div');
  box.className = 'ski-custom-acts';
  box.append(edit, share);
  return box;
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

/** A labelled row of segment buttons (like the poles switch), each calling its pick. */
function switchRow(name: string, className: string, options: readonly (readonly [string, () => void])[]): { row: HTMLElement; buttons: HTMLButtonElement[] } {
  const row = document.createElement('div');
  row.className = `poles-row ${className}`;
  const label = document.createElement('span');
  label.className = 'stat-name';
  label.textContent = name;
  const group = document.createElement('div');
  group.className = 'segmented poles-switch';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', name);
  const buttons = options.map(([text, onPick]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'segment';
    b.textContent = text;
    b.addEventListener('click', onPick);
    group.appendChild(b);
    return b;
  });
  row.append(label, group);
  return { row, buttons };
}

/** A small flat drawing of a stock pattern in the garment's colors, for its tile (roughly as the 3D garment paints it). */
export function patternSwatch(pattern: Pattern, base: string, accent: string): string {
  let art = '';
  if (pattern === 'stripes') art = `<rect y="5" width="30" height="4" fill="${accent}"/><rect y="12" width="30" height="4" fill="${accent}"/>`;
  else if (pattern === 'blocks') art = `<rect width="30" height="7" fill="${accent}"/>`;
  else if (pattern === 'plaid') {
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

/** A ski (or a board) seen side on, its rise exaggerated, as an SVG path in a 100 x 26 box (tip to the right), scaled so the `longest` fills it. */
function profilePath(m: SkiModel, longest: number): string {
  const half = m.length / 2;
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
  const canvas = document.createElement('canvas');
  canvas.className = 'ski-thumb';
  paintSkis(canvas, type, g, base, RACK_PX_PER_M);
  return canvas;
}

/** What a drag or the wheel on a preview window does (main points it at render/lockerStage.ts). */
export interface PreviewControl {
  grab: () => void;
  drag: (dx: number, dy: number) => void;
  release: () => void;
  zoom: (deltaY: number) => void;
}
let control: PreviewControl | null = null;

export function setPreviewControl(c: PreviewControl): void {
  control = c;
}

/**
 * The canvas the 3D preview is copied into, filling the window `view`, and
 * its 2D context (opaque: the preview covers it). The window also takes the
 * hand (milestone 23, the user's ask): a click-and-drag turns and tilts the
 * view, the wheel zooms, and it turns by itself again a few seconds after
 * (PreviewControl). The drag keeps the focus where it was (the editor's grid).
 */
export function previewCanvas(view: HTMLElement): CanvasRenderingContext2D | null {
  const canvas = document.createElement('canvas');
  canvas.className = 'locker-canvas';
  const hint = document.createElement('span');
  hint.className = 'preview-hint';
  hint.textContent = 'Drag to turn · Wheel to zoom';
  view.append(canvas, hint);
  view.classList.add('is-handled');
  let x = 0;
  let y = 0;
  let held = -1;
  view.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    view.setPointerCapture(e.pointerId);
    held = e.pointerId;
    x = e.clientX;
    y = e.clientY;
    view.classList.add('is-held');
    control?.grab();
  });
  view.addEventListener('pointermove', (e) => {
    if (e.pointerId !== held) return;
    control?.drag(e.clientX - x, e.clientY - y);
    x = e.clientX;
    y = e.clientY;
  });
  const end = (e: PointerEvent): void => {
    if (e.pointerId !== held) return;
    held = -1;
    view.classList.remove('is-held');
    control?.release();
  };
  view.addEventListener('pointerup', end);
  view.addEventListener('pointercancel', end);
  view.addEventListener('lostpointercapture', end);
  view.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      control?.zoom(e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY);
    },
    { passive: false },
  );
  view.addEventListener('contextmenu', (e) => e.preventDefault());
  return canvas.getContext('2d', { alpha: false });
}
