import type { SkiGraphic, SkiModel } from './skis.ts';

// The snowboard (milestone 22), as data in the ski's format (core/skis.ts),
// so the ski painter and render/skiModel.ts build it: a twin-tip park board,
// 1.54 m long, 25 cm at the waist and a little wider at the contact points,
// both ends kicked up the same. One stock graphic for now; part 2 adds the
// Locker's board graphics.

export const BOARD_MODEL: SkiModel = {
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
};

/** Half the board's width at the bindings (m): its edges' distance from the middle. */
export const BOARD_HALF_WIDTH = 0.125;

export const BOARD_GRAPHIC: SkiGraphic = {
  id: 'board-stock',
  name: 'Stock',
  base: '#2f7fe0',
  sidewall: '#1b1d21',
  layers: [
    { fill: '#21252c' },
    { stripes: [-0.36, 0.36], period: 0.18, duty: 0.35, slant: 0.12, colors: ['#ff7a1a', '#f1c93b'] },
    { rect: [0.8, 1], color: '#b8e330', mirror: true },
  ],
  baseLayers: [{ fill: '#2f7fe0' }, { rect: [-0.12, 0.12], color: '#ece8de' }],
};
