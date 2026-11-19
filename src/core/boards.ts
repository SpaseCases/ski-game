import { CONFIG } from '../config.ts';
import { aspectOf, CUSTOM_SLOTS, graphicColor, RIDER_GRAPHICS, statsFrom, type Layer, type SkiGraphic, type SkiModel, type SkiStat, type UV } from './skis.ts';

// The snowboards (milestone 22), as data in the ski's format (core/skis.ts),
// so the ski painter and render/skiModel.ts build them and the Locker's rack
// paints them: three types like the skis, each with its shape, its feel
// (CONFIG.boards: multipliers in place of the ski's) and three stock
// graphics. A board graphic paints one board (v from -1 at its left edge to
// 1 at its right, seen from above with the nose toward the tip end, u = 1);
// pictures stand upright with their top toward v = -1, which is the top of
// the Locker's rack (the nose to the right). Since milestone 23 each board
// type also has CUSTOM_SLOTS custom graphics painted in the editor
// (core/customSkis.ts fills CUSTOM_BOARDS), found by id like the stock ones.

export type BoardId = keyof typeof CONFIG.boards;

export interface BoardType {
  id: BoardId;
  name: string;
  /** One line on what it's good and bad at. */
  blurb: string;
  model: SkiModel;
  graphics: readonly SkiGraphic[];
}

const C = {
  coal: '#2c3037',
  ink: '#1b1d21',
  topsheet: '#21252c',
  chalk: '#ece8de',
  lemon: '#f1c93b',
  tangerine: '#ff7a1a',
  lime: '#b8e330',
  pine: '#2f5a45',
  teal: '#23898a',
  glacier: '#8cc9e0',
  cobalt: '#2f7fe0',
  navy: '#22395e',
  plum: '#6a3b74',
  bubblegum: '#e2497b',
  cherry: '#d33a3f',
};

/**
 * The park board (milestone 22 part 1's one board): a 1.54 m twin tip, 25
 * cm at the waist and a little wider at the contact points, both ends
 * kicked up the same.
 */
const PARK: BoardType = {
  id: 'park',
  name: 'Park',
  blurb: 'A twin, both ends kicked up the same. Rides the same either way and spins just as every map was built for.',
  model: {
    length: 1.54,
    thickness: 0.014,
    width: [
      [-0.77, 0.15],
      [-0.56, 0.146],
      [0, 0.125],
      [0.56, 0.146],
      [0.77, 0.15],
    ],
    tip: { start: 0.58, height: 0.075, power: 2 },
    tail: { start: 0.58, height: 0.075, power: 2 },
    tipRound: 0.13,
    tailRound: 0.13,
    mount: 0,
    rows: 40,
    cols: 12,
  },
  graphics: [
    {
      id: 'board-park-stripes',
      name: 'Stripes',
      base: '#2f7fe0',
      sidewall: '#1b1d21',
      layers: [
        { fill: '#21252c' },
        { stripes: [-0.36, 0.36], period: 0.18, duty: 0.35, slant: 0.12, colors: ['#ff7a1a', '#f1c93b'] },
        { rect: [0.8, 1], color: '#b8e330', mirror: true },
      ],
      baseLayers: [{ fill: '#2f7fe0' }, { rect: [-0.12, 0.12], color: '#ece8de' }],
    },
    {
      id: 'board-park-checks',
      name: 'Checkers',
      base: C.cherry,
      sidewall: C.ink,
      layers: [
        { fill: C.cherry },
        { checks: [0.46, 1], size: 0.67, colors: [C.ink, C.chalk], mirror: true },
        { rect: [0.36, 0.46], color: C.chalk, mirror: true },
      ],
      baseLayers: [{ fill: C.ink }, { checks: [-0.3, 0.3], size: 0.67, colors: [C.cherry, C.chalk] }],
    },
    {
      id: 'board-park-blocks',
      name: 'Color blocks',
      base: C.navy,
      sidewall: C.ink,
      layers: [
        { fill: C.lemon },
        { stripes: [-0.92, 0.92], period: 0.3, duty: 0.5, slant: 0.16, colors: [C.tangerine, C.bubblegum, C.cobalt, C.teal] },
        { rect: [0.92, 1], color: C.ink, mirror: true },
      ],
      baseLayers: [{ fill: C.navy }, { stripes: [-0.8, 0.8], period: 0.3, duty: 0.5, slant: -0.16, colors: [C.lemon, C.tangerine] }],
    },
  ],
};

// Freeride graphics are hand-drawn pictures across the whole board, in the
// spirit of artist-series boards, upright with the sky toward v = -1.
const DUSK = ['#3b2a5c', C.plum, '#a3477a', C.bubblegum, '#f0784a', '#f6a640'];
const NIGHT = '#14203a';

/** A mountain range along the board: peaks at (u, v) pairs, closed down to v = 1. */
function range(peaks: readonly UV[]): UV[] {
  return [[-1, 1], ...peaks, [1, 1]];
}

/** Pine trees along the board, standing on v = `ground`, every `gap` in u. */
function pines(from: number, to: number, gap: number, ground: number, color: string): Layer[] {
  const tall = [0.95, 1.2, 0.8, 1.1, 1.3, 0.9, 1.05];
  const out: Layer[] = [];
  for (let i = 0, u = from; u <= to + 1e-9; i++, u += gap) {
    const h = 0.95 * tall[i % tall.length]!;
    out.push({ poly: [[u - gap * 0.45, ground], [u + gap * 0.45, ground], [u, ground - h]], color });
  }
  return out;
}

const FREERIDE: BoardType = {
  id: 'freeride',
  name: 'Freeride',
  blurb: 'Longer and wider, a long rising nose, set back. Drops bigger and lands forgiving; spins slower, but a 720 still fits.',
  model: {
    length: 1.62,
    thickness: 0.015,
    width: [
      [-0.81, 0.146],
      [-0.6, 0.147],
      [0, 0.132],
      [0.62, 0.154],
      [0.81, 0.156],
    ],
    tip: { start: 0.4, height: 0.095, power: 1.6 },
    tail: { start: 0.66, height: 0.045, power: 2 },
    tipRound: 0.17,
    tailRound: 0.08,
    mount: 0.04,
    rows: 42,
    cols: 12,
  },
  graphics: [
    {
      id: 'board-free-dusk',
      name: 'Range at dusk',
      base: C.navy,
      sidewall: C.ink,
      layers: [
        { grad: [-1, 0.5], colors: DUSK, across: true },
        { circle: [0.32, -0.3], r: 0.42, color: C.lemon },
        { poly: range([[-0.8, 0.15], [-0.55, -0.35], [-0.3, 0.05], [-0.05, -0.2], [0.15, 0.1], [0.45, -0.45], [0.75, 0.05], [0.95, -0.1]]), color: '#6a4a7a' },
        { poly: range([[-0.9, 0.3], [-0.65, -0.05], [-0.4, 0.4], [-0.15, 0.0], [0.1, 0.35], [0.35, 0.1], [0.6, 0.45], [0.85, 0.15]]), color: '#3b2a5c' },
        { poly: [[-0.65, -0.05], [-0.71, 0.12], [-0.59, 0.12]], color: C.chalk },
        { poly: [[-0.15, 0.0], [-0.21, 0.16], [-0.09, 0.16]], color: C.chalk },
        { poly: [[0.35, 0.1], [0.29, 0.25], [0.41, 0.25]], color: C.chalk },
      ],
      baseLayers: [{ fill: C.navy }, { grad: [-0.2, 0.2], colors: [C.bubblegum, '#f0784a', '#f6a640'], across: true }],
    },
    {
      id: 'board-free-night',
      name: 'Night forest',
      base: C.pine,
      sidewall: C.ink,
      layers: [
        { fill: NIGHT },
        { dots: [[-0.85, -0.7], [-0.6, -0.3], [-0.42, -0.75], [-0.2, -0.45], [0.05, -0.8], [0.18, -0.25], [0.78, -0.2], [0.9, -0.7]], r: 0.12, color: C.chalk },
        { circle: [0.5, -0.5], r: 0.42, color: '#f3efd8' },
        { circle: [0.56, -0.62], r: 0.36, color: NIGHT },
        ...pines(-0.92, 0.92, 0.18, 0.78, C.pine),
        { rect: [-1, 1], v: [0.72, 1], color: '#c9d6e6' },
      ],
      baseLayers: [{ fill: C.pine }, ...pines(-0.6, 0.6, 0.3, 0.9, '#3d7358')],
    },
    {
      id: 'board-free-wave',
      name: 'Big wave',
      base: C.navy,
      sidewall: C.ink,
      layers: [
        { waves: [-1, 1], colors: [C.glacier, C.chalk, C.teal, C.cobalt, C.navy], amp: 0.22, freq: 2.2, across: true },
        { spiral: [0.62, -0.1], r: 0.95, turns: 2.4, width: 0.45, color: C.chalk },
      ],
      baseLayers: [{ fill: C.navy }, { waves: [-0.5, 0.5], colors: [C.teal, C.glacier], amp: 0.15, freq: 3, across: true }],
    },
  ],
};

// Carving graphics are race style: speed stripes, fades, a split.
const CARVING: BoardType = {
  id: 'carving',
  name: 'Carving',
  blurb: 'Directional, a deep sidecut and a low flat tail. Holds an edge and keeps its speed; stiff landings, slower spins, twitchy fakie.',
  model: {
    length: 1.58,
    thickness: 0.014,
    width: [
      [-0.79, 0.138],
      [-0.6, 0.143],
      [0, 0.118],
      [0.6, 0.146],
      [0.79, 0.142],
    ],
    tip: { start: 0.6, height: 0.06, power: 2 },
    tail: { start: 0.7, height: 0.025, power: 2 },
    tipRound: 0.14,
    tailRound: 0.05,
    mount: 0.02,
    rows: 40,
    cols: 12,
  },
  graphics: [
    {
      id: 'board-carve-speed',
      name: 'Speed stripes',
      base: C.cherry,
      sidewall: C.ink,
      layers: [
        { fill: C.coal },
        { stripes: [-0.85, 0.3], period: 0.15, duty: 0.5, slant: 0.28, colors: [C.cherry, C.tangerine, C.lemon] },
        { rect: [0.78, 1], color: C.cherry },
      ],
      baseLayers: [{ fill: C.cherry }, { rect: [-0.9, 0.9], v: [-0.2, 0.2], color: C.chalk }],
    },
    {
      id: 'board-carve-fade',
      name: 'Fade',
      base: C.navy,
      sidewall: C.navy,
      layers: [
        { grad: [-1, 1], colors: [C.navy, C.cobalt, '#5ea8ea', C.glacier, C.chalk] },
        { rect: [-0.85, 0.85], v: [-0.12, 0.12], color: C.lemon },
      ],
      baseLayers: [{ fill: C.navy }, { grad: [-1, 1], colors: [C.navy, C.cobalt] }],
    },
    {
      id: 'board-carve-split',
      name: 'Split',
      base: C.ink,
      sidewall: C.ink,
      layers: [
        { fill: C.cherry },
        { poly: [[-1, -1], [0.18, -1], [-0.18, 1], [-1, 1]], color: C.ink },
        { poly: [[0.18, -1], [0.26, -1], [-0.1, 1], [-0.18, 1]], color: C.chalk },
        { rect: [0.9, 1], color: C.chalk },
      ],
      baseLayers: [{ fill: C.ink }, { rect: [0.6, 1], color: C.cherry }],
    },
  ],
};

export const BOARD_TYPES: readonly BoardType[] = [PARK, FREERIDE, CARVING];

/** Half the park board's width at the bindings (m): its edges' distance from the middle (the snow track's least half width). */
export const BOARD_HALF_WIDTH = 0.125;

export function boardType(id: BoardId): BoardType {
  return BOARD_TYPES.find((t) => t.id === id) ?? PARK;
}

/**
 * The player's own graphics on each board (milestone 23), CUSTOM_SLOTS each,
 * null until a slot is first painted. core/customSkis.ts fills them.
 */
export const CUSTOM_BOARDS: Record<BoardId, (SkiGraphic | null)[]> = {
  park: Array<SkiGraphic | null>(CUSTOM_SLOTS).fill(null),
  freeride: Array<SkiGraphic | null>(CUSTOM_SLOTS).fill(null),
  carving: Array<SkiGraphic | null>(CUSTOM_SLOTS).fill(null),
};

/** The graphic with this id on that board (a stock one or a painted custom slot), or the board's first. */
export function boardGraphic(id: BoardId, graphic: string): SkiGraphic {
  const type = boardType(id);
  return type.graphics.find((g) => g.id === graphic) ?? CUSTOM_BOARDS[type.id].find((g) => g?.id === graphic) ?? RIDER_GRAPHICS.get(graphic) ?? type.graphics[0]!;
}

/** How the board compares with the park board (1), as the skis' stat bars (core/skis.ts skiStats). */
export function boardStats(id: BoardId): Record<SkiStat, number> {
  return statsFrom(CONFIG.boards[id] as Record<string, Record<string, number> | undefined>);
}

/** A board graphic's main color (the color on most of its top sheet), for the leaderboard's tiny rider. */
export function mainColor(type: BoardType, g: SkiGraphic): string {
  const aspect = aspectOf(type.model);
  const count = new Map<string, number>();
  let best = g.base;
  let most = 0;
  for (let i = 0; i < 20; i++) {
    for (let j = 0; j < 6; j++) {
      const c = graphicColor(g, -0.95 + i * 0.1, -0.83 + j * 0.33, aspect);
      const n = (count.get(c) ?? 0) + 1;
      count.set(c, n);
      if (n > most) [best, most] = [c, n];
    }
  }
  return best;
}
