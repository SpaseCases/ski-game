import { CONFIG } from '../config.ts';

// The three ski types, as data: each one's model (its shape, for the eye
// only: the physics treats every ski as the same length) and its graphics.
// A graphic is a list of layers painted in order onto the top sheet's grid
// of faces (and, if it has them, base layers onto the base's), so it shows
// as vertex colors on Low with no textures. A pair graphic is one picture
// across both skis. The same painter draws the Locker's thumbnails. How
// each ski rides is CONFIG.skis (multipliers on config.ts's numbers).

export type SkiId = keyof typeof CONFIG.skis;

/**
 * A spot on the ski: u along it (-1 tail end, 1 tip end), v across it (-1
 * left edge, 1 right edge, seen from above, on the base too). In a pair
 * graphic v spans both skis: -2 the left ski's left edge, 0 where the two
 * skis meet, 2 the right ski's right edge.
 */
export type UV = readonly [number, number];

/**
 * One layer of a graphic. Each paints the cells inside it and leaves the
 * rest alone. Sizes across the ski (r, size, width) are in half widths;
 * distances along the ski are measured the same way where shapes must stay
 * round (circles, checks, spirals), and in u elsewhere. `mirror` also paints
 * the layer flipped end for end, for twin tips.
 */
export type Layer = (
  | { fill: string }
  /** A box: u from..to, and v from..to (default the full width). */
  | { rect: UV; v?: UV; color: string }
  /** Bands of color in order from u = grad[0] to grad[1] (with `across`, from v = grad[0] to grad[1]). */
  | { grad: UV; colors: readonly string[]; across?: boolean }
  /**
   * Bands like grad's whose edges wave: by `amp` (in u, or in v with
   * `across`), `freq` waves across the ski (along it with `across`).
   */
  | { waves: UV; colors: readonly string[]; amp: number; freq: number; phase?: number; across?: boolean }
  /**
   * Stripes across the ski between u = stripes[0] and [1], every `period`
   * (u), `duty` of it painted, cycling through the colors. `slant` shifts
   * them along by that much u per half width across (a diagonal); with
   * `chevron` they bend into a V.
   */
  | { stripes: UV; period: number; duty: number; slant?: number; chevron?: boolean; colors: readonly string[] }
  /** A checkerboard of squares `size` across. */
  | { checks: UV; size: number; colors: readonly [string, string] }
  /** A circle (or an ellipse: [along, across] radii); `ring` keeps only an outer band that wide. */
  | { circle: UV; r: number | UV; color: string; ring?: number }
  /** A few small dots (stars, spots). */
  | { dots: readonly UV[]; r: number; color: string }
  /** A polygon with corners in (u, v). */
  | { poly: readonly UV[]; color: string }
  /** An Archimedean spiral out to radius r, `turns` times round, its arm `width` (0..1) of the gap between turns. */
  | { spiral: UV; r: number; turns: number; width: number; color: string }
) & { mirror?: boolean };

export interface SkiGraphic {
  id: string;
  name: string;
  /** The base's color (the underside; under baseLayers if it has them) and, if not the top sheet's edge color, the sidewalls. */
  base: string;
  sidewall?: string;
  /** One picture across both skis (v from -2 to 2) instead of the same on each. */
  pair?: boolean;
  layers: readonly Layer[];
  baseLayers?: readonly Layer[];
}

/** Which ski of the pair: -1 left, 1 right. */
export type Side = -1 | 1;

/** Where the ski turns up at one end: from `start` m from the middle to the end, rising `height` m on a curve of this power. */
export interface Rise {
  start: number;
  height: number;
  power: number;
}

/** A ski's shape (meters; along runs from the middle, + toward the tip). */
export interface SkiModel {
  length: number;
  thickness: number;
  /** Half widths along the ski, tail to tip: [along, half width], joined straight. */
  width: readonly UV[];
  tip: Rise;
  tail: Rise;
  /** How far (m) the tip and the tail round off seen from above (0: square). */
  tipRound: number;
  tailRound: number;
  /** How far (m) the middle of the ski sits ahead of the middle of the boot. */
  mount: number;
  /** The top sheet's grid of painted faces: rows along, columns across. */
  rows: number;
  cols: number;
}

export interface SkiType {
  id: SkiId;
  name: string;
  /** One line on what it's good and bad at. */
  blurb: string;
  model: SkiModel;
  graphics: readonly SkiGraphic[];
}

// The palette's colors (core/outfit.ts) and a few in-between shades.
const C = {
  coal: '#2c3037',
  ink: '#1b1d21',
  topsheet: '#21252c',
  chalk: '#ece8de',
  sand: '#c8b07e',
  rust: '#a24a2a',
  tangerine: '#ff7a1a',
  lemon: '#f1c93b',
  lime: '#b8e330',
  olive: '#677a52',
  pine: '#2f5a45',
  teal: '#23898a',
  glacier: '#8cc9e0',
  cobalt: '#2f7fe0',
  navy: '#22395e',
  plum: '#6a3b74',
  lilac: '#b3a2dc',
  bubblegum: '#e2497b',
  cherry: '#d33a3f',
};

const PARK: SkiType = {
  id: 'park',
  name: 'Park',
  blurb: 'A twin tip, both ends turned up. Spins and lands just as every map was built for.',
  model: {
    length: 1.76,
    thickness: 0.022,
    width: [
      [-0.88, 0.05],
      [0.88, 0.05],
    ],
    tip: { start: 0.66, height: 0.12, power: 1.6 },
    tail: { start: 0.66, height: 0.12, power: 1.6 },
    tipRound: 0.05,
    tailRound: 0.05,
    mount: 0,
    rows: 64,
    cols: 8,
  },
  graphics: [
    {
      id: 'park-lime',
      name: 'Lime tips',
      base: C.cobalt,
      layers: [{ fill: C.topsheet }, { rect: [0.17, 0.284], color: C.bubblegum, mirror: true }, { rect: [0.75, 1], color: C.lime, mirror: true }],
    },
    {
      id: 'park-checks',
      name: 'Checkers',
      base: C.cherry,
      sidewall: C.ink,
      layers: [
        { fill: C.cherry },
        { checks: [0.42, 1], size: 0.5, colors: [C.ink, C.chalk], mirror: true },
        { rect: [0.36, 0.42], color: C.chalk, mirror: true },
      ],
      baseLayers: [{ fill: C.ink }, { checks: [-0.3, 0.3], size: 0.5, colors: [C.cherry, C.chalk] }],
    },
    {
      id: 'park-blocks',
      name: 'Color blocks',
      base: C.navy,
      sidewall: C.ink,
      pair: true,
      layers: [
        { fill: C.lemon },
        { stripes: [-1, 1], period: 0.24, duty: 0.5, slant: 0.09, colors: [C.tangerine, C.bubblegum, C.cobalt, C.teal] },
        { rect: [0.9, 1], color: C.ink, mirror: true },
      ],
      baseLayers: [{ fill: C.navy }, { stripes: [-0.9, 0.9], period: 0.24, duty: 0.5, slant: -0.09, colors: [C.lemon, C.tangerine] }],
    },
    {
      id: 'park-chevrons',
      name: 'Chevrons',
      base: C.lemon,
      pair: true,
      layers: [
        { fill: C.navy },
        { stripes: [0.28, 0.95], period: 0.13, duty: 0.5, slant: 0.07, chevron: true, colors: [C.lemon, C.glacier], mirror: true },
        { rect: [0.95, 1], color: C.tangerine, mirror: true },
      ],
      baseLayers: [{ fill: C.lemon }, { stripes: [-0.6, 0.6], period: 0.2, duty: 0.4, slant: 0.07, chevron: true, colors: [C.navy] }],
    },
  ],
};

// Big mountain graphics are pairs: each is one picture across both skis
// (v from -2 at the left ski's left edge to 2 at the right ski's right
// edge), upright with its top toward the tips, so the two skis go together.
// The boots stand on the middle, so faces and heads sit toward the tips.
const SUNSET = ['#3b2a5c', C.plum, '#a3477a', C.bubblegum, '#f0784a', '#f6a640', C.lemon];
const NIGHT = '#14203a';

/** A row of pine tops across both skis, from u = `base` up by about `height`, closed down to u = `bottom`. */
function forest(base: number, height: number, bottom: number): UV[] {
  const tall = [0.75, 1, 0.6, 0.9, 1.1, 0.8, 0.95, 0.65];
  const pts: UV[] = [[bottom, -2]];
  for (let i = 0, v = -2; v < 2; i++, v += 0.5) pts.push([base, v], [base + height * tall[i % tall.length]!, v + 0.25]);
  pts.push([base, 2], [bottom, 2]);
  return pts;
}

/** An owl across both skis, an eye on each, perched on a branch. */
function owl(): Layer[] {
  const brown = '#8a5a3a';
  const wing = '#6e4429';
  return [
    { rect: [-0.36, -0.31], color: '#5a3a22' },
    { circle: [0.12, 0], r: [4.6, 1.75], color: brown },
    { circle: [0.08, -1.55], r: [3.8, 0.45], color: wing },
    { circle: [0.08, 1.55], r: [3.8, 0.45], color: wing },
    { circle: [0.05, 0], r: [3.4, 1.1], color: '#d9b98a' },
    { dots: [[0.2, -0.5], [0.2, 0.5], [0.08, 0], [-0.04, -0.55], [-0.04, 0.55], [-0.14, 0]], r: 0.2, color: '#b8946a' },
    { circle: [0.56, 0], r: [2.6, 1.75], color: brown },
    { poly: [[0.68, -1.55], [0.8, -1.9], [0.72, -1.0]], color: brown },
    { poly: [[0.68, 1.55], [0.8, 1.9], [0.72, 1.0]], color: brown },
    { circle: [0.57, -0.8], r: [1.15, 0.85], color: '#c49a6c' },
    { circle: [0.57, 0.8], r: [1.15, 0.85], color: '#c49a6c' },
    { circle: [0.58, -0.8], r: 0.62, color: C.lemon },
    { circle: [0.58, 0.8], r: 0.62, color: C.lemon },
    { circle: [0.58, -0.8], r: 0.3, color: C.ink },
    { circle: [0.58, 0.8], r: 0.3, color: C.ink },
    { poly: [[0.5, -0.3], [0.5, 0.3], [0.42, 0]], color: C.tangerine },
    { dots: [[-0.3, -0.4], [-0.3, 0.4], [-0.3, -0.75], [-0.3, 0.75]], r: 0.2, color: C.tangerine },
  ];
}

/** A koi centered at (`at`, `v`) swimming toward the tip (dir 1) or the tail (-1): tail fin, side fins, body, patches, eyes. */
function koi(at: number, v: number, dir: number, body: string, patch: string): Layer[] {
  const back = at - dir * 0.15;
  return [
    { poly: [[back + dir * 0.02, v], [back - dir * 0.05, v - 0.65], [back - dir * 0.02, v], [back - dir * 0.05, v + 0.65]], color: body },
    { poly: [[at + dir * 0.05, v - 0.3], [at + dir * 0.01, v - 0.95], [at - dir * 0.01, v - 0.3]], color: body },
    { poly: [[at + dir * 0.05, v + 0.3], [at + dir * 0.01, v + 0.95], [at - dir * 0.01, v + 0.3]], color: body },
    { circle: [at, v], r: [2.2, 0.55], color: body },
    { circle: [at + dir * 0.04, v - 0.15], r: 0.32, color: patch },
    { circle: [at - dir * 0.05, v + 0.12], r: 0.28, color: patch },
    { dots: [[at + dir * 0.125, v - 0.25], [at + dir * 0.125, v + 0.25]], r: 0.13, color: C.ink },
  ];
}

/** A yeti across both skis, waving with both arms, an eye on each ski. */
function yeti(): Layer[] {
  const fur = '#eef3f7';
  const shade = '#cfe0ec';
  const skin = '#7db8dc';
  return [
    { rect: [-0.62, -0.25], v: [-1.45, -0.3], color: fur },
    { rect: [-0.62, -0.25], v: [0.3, 1.45], color: fur },
    { circle: [-0.62, -0.9], r: [0.9, 0.75], color: shade },
    { circle: [-0.62, 0.9], r: [0.9, 0.75], color: shade },
    { poly: [[0.3, -1.5], [0.64, -1.95], [0.72, -1.7], [0.38, -1.05]], color: fur },
    { poly: [[0.3, 1.5], [0.64, 1.95], [0.72, 1.7], [0.38, 1.05]], color: fur },
    { circle: [0.71, -1.82], r: 0.32, color: skin },
    { circle: [0.71, 1.82], r: 0.32, color: skin },
    { circle: [0.1, 0], r: [4.8, 1.8], color: fur },
    { circle: [0.05, 0], r: [3.0, 1.1], color: '#dde8f0' },
    { dots: [[0.32, -1.3], [0.2, 1.4], [-0.05, -1.5], [-0.12, 1.2], [0.36, 1.0], [0.12, -1.0]], r: 0.24, color: shade },
    { poly: [[0.68, -1.2], [0.82, -1.85], [0.71, -0.95]], color: C.sand },
    { poly: [[0.68, 1.2], [0.82, 1.85], [0.71, 0.95]], color: C.sand },
    { circle: [0.56, 0], r: [2.4, 1.6], color: fur },
    { circle: [0.55, 0], r: [1.5, 1.05], color: skin },
    { dots: [[0.6, -0.42], [0.6, 0.42]], r: 0.2, color: C.ink },
    { circle: [0.5, 0], r: [0.4, 0.6], color: C.navy },
  ];
}

/** Yeti footprints walking down the bases: left feet on the left ski, right feet on the right. */
function footprints(): Layer[] {
  const out: Layer[] = [];
  for (let i = 0, u = 0.8; u > -0.95; i++, u -= 0.22) {
    const v = i % 2 === 0 ? -1 : 1;
    out.push({ circle: [u, v], r: [1.2, 0.55], color: '#8fb4cc' }, { dots: [[u + 0.105, v - 0.35], [u + 0.115, v], [u + 0.105, v + 0.35]], r: 0.2, color: '#8fb4cc' });
  }
  return out;
}

const BIG: SkiType = {
  id: 'big',
  name: 'Big mountain',
  blurb: 'Long and wide, with a long rockered nose. Takes bigger drops and forgives a sloppy landing; spins and flips come round slower.',
  model: {
    length: 1.94,
    thickness: 0.024,
    width: [
      [-0.97, 0.064],
      [-0.84, 0.07],
      [0.02, 0.062],
      [0.8, 0.074],
      [0.97, 0.066],
    ],
    tip: { start: 0.3, height: 0.13, power: 2.4 },
    tail: { start: 0.76, height: 0.045, power: 1.6 },
    tipRound: 0.08,
    tailRound: 0.06,
    mount: 0.04,
    rows: 120,
    cols: 12,
  },
  graphics: [
    {
      id: 'big-alpenglow',
      name: 'Alpenglow',
      base: '#3b2a5c',
      pair: true,
      layers: [
        { grad: [1, -0.1], colors: SUNSET },
        { circle: [0.3, 1.1], r: 1, color: '#ffe9a8' },
        { poly: [[-0.3, -2], [0, -2], [0.12, -1.4], [0.22, -1.15], [0.36, -0.6], [0.6, 0.1], [0.48, 0.6], [0.36, 0.95], [0.22, 1.5], [0.08, 2], [-0.3, 2]], color: '#7a5f9c' },
        { poly: [[0.6, 0.1], [0.48, 0.6], [0.36, 0.95], [0.22, 1.5], [0.08, 2], [-0.3, 2], [-0.3, 0.4], [0.15, 0.35], [0.35, 0.3]], color: '#5a4678' },
        { poly: [[0.6, 0.1], [0.48, 0.6], [0.455, 0.42], [0.47, 0.2], [0.43, -0.05], [0.46, -0.3], [0.42, -0.42], [0.36, -0.6]], color: C.chalk },
        { poly: forest(-0.4, 0.13, -0.64), color: C.pine },
        { grad: [-0.64, -1], colors: ['#f6a640', '#f0784a', '#a3477a', C.plum, '#3b2a5c'] },
        { stripes: [-0.95, -0.68], period: 0.06, duty: 0.25, colors: ['#ffd9a0'] },
      ],
      baseLayers: [{ fill: '#3b2a5c' }, { stripes: [-0.9, 0.9], period: 0.16, duty: 0.4, slant: 0.05, chevron: true, colors: [C.bubblegum, C.tangerine, C.lemon] }],
    },
    {
      id: 'big-owl',
      name: 'Night owl',
      base: C.navy,
      pair: true,
      layers: [
        { fill: NIGHT },
        { waves: [0.74, 1], colors: ['#1d4a55', C.teal, C.lime, C.teal, '#1d4a55'], amp: 0.04, freq: 0.6 },
        {
          dots: [[0.95, 0.6], [0.86, 1.6], [0.78, -0.4], [0.7, 1.2], [0.4, -1.8], [0.3, 1.85], [-0.45, -1.4], [-0.5, 0.9], [0.88, -1.7], [0.66, 0.2]],
          r: 0.2,
          color: C.chalk,
        },
        { circle: [0.9, -1.2], r: 0.55, color: '#f3e6a8' },
        { circle: [0.915, -0.95], r: 0.5, color: NIGHT },
        { poly: forest(-0.66, 0.16, -1), color: '#0b1424' },
        ...owl(),
      ],
      baseLayers: [
        { fill: NIGHT },
        { dots: [[0.85, -1.5], [0.7, 1.4], [0.45, -0.6], [0.2, 1.6], [-0.1, -1.3], [-0.4, 0.5], [-0.7, -1.6], [-0.85, 1.2]], r: 0.22, color: C.chalk },
        { circle: [0.55, 0], r: 1.3, color: '#f3e6a8' },
      ],
    },
    {
      id: 'big-koi',
      name: 'Koi pond',
      base: C.teal,
      pair: true,
      layers: [
        { fill: '#1f6f73' },
        { circle: [0.72, 0.6], r: 1.9, ring: 0.2, color: '#3fa3a0' },
        { circle: [0.72, 0.6], r: 1.1, ring: 0.2, color: '#3fa3a0' },
        { circle: [-0.7, -0.7], r: 1.7, ring: 0.2, color: '#3fa3a0' },
        { circle: [0.92, 1.2], r: 0.6, color: C.olive },
        { poly: [[0.92, 1.2], [0.96, 2], [0.91, 2]], color: '#1f6f73' },
        { circle: [-0.92, -1.3], r: 0.55, color: C.olive },
        { circle: [-0.85, 1.3], r: 0.5, color: C.olive },
        { circle: [0.9, -1.4], r: 0.35, color: C.bubblegum },
        ...koi(0.5, -1, 1, C.tangerine, C.chalk),
        ...koi(-0.5, 1, -1, C.chalk, C.cherry),
      ],
      baseLayers: [{ fill: '#174f54' }, { circle: [0, 0], r: 2.6, ring: 0.3, color: '#e8a33c' }, { circle: [0, 0], r: 1.6, ring: 0.3, color: '#e8a33c' }],
    },
    {
      id: 'big-yeti',
      name: 'Yeti',
      base: '#bcd6e6',
      pair: true,
      layers: [
        { grad: [1, -0.6], colors: [C.cobalt, '#4f94dc', '#6fabe0', '#8cc0e2', C.glacier] },
        { spiral: [0.88, -1.05], r: 0.8, turns: 1.4, width: 0.5, color: C.chalk },
        { spiral: [0.88, 1.05], r: 0.8, turns: 1.4, width: 0.5, color: '#d8ecf6' },
        { dots: [[0.95, 0], [0.78, -0.3], [0.62, 1.35], [0.45, -1.8], [0.2, 1.85], [-0.1, -1.85], [-0.4, 1.8], [0.75, 0.6]], r: 0.22, color: C.chalk },
        { waves: [-0.62, -1], colors: ['#e6eff6', '#cfdeea'], amp: 0.03, freq: 1.5 },
        ...yeti(),
      ],
      baseLayers: [{ fill: '#bcd6e6' }, ...footprints()],
    },
  ],
};

const CARVING: SkiType = {
  id: 'carving',
  name: 'Carving',
  blurb: 'Narrow underfoot with a deep sidecut. Holds an edge and its speed through the turns; lands stiff, spins slow and gets twitchy riding switch.',
  model: {
    length: 1.72,
    thickness: 0.02,
    width: [
      [-0.86, 0.049],
      [-0.7, 0.05],
      [0, 0.034],
      [0.68, 0.056],
      [0.86, 0.05],
    ],
    tip: { start: 0.7, height: 0.055, power: 1.8 },
    tail: { start: 0.86, height: 0, power: 1 },
    tipRound: 0.07,
    tailRound: 0,
    mount: 0,
    rows: 64,
    cols: 8,
  },
  graphics: [
    {
      id: 'carving-redline',
      name: 'Redline',
      base: C.ink,
      sidewall: C.ink,
      layers: [
        { fill: C.chalk },
        { stripes: [0.25, 0.86], period: 0.1, duty: 0.55, slant: 0.12, colors: [C.cherry] },
        { rect: [0.86, 1], color: C.cherry },
        { rect: [-1, 1], v: [-0.2, 0.2], color: C.ink },
        { rect: [-1, -0.82], color: C.ink },
      ],
      baseLayers: [{ fill: C.cherry }, { stripes: [-0.85, 0.85], period: 0.25, duty: 0.18, slant: 0.15, colors: [C.chalk] }],
    },
    {
      id: 'carving-cobalt',
      name: 'Blue fade',
      base: C.cobalt,
      sidewall: C.ink,
      layers: [
        { grad: [1, -1], colors: [C.cobalt, '#2a6cc4', '#2557a6', C.navy, '#1e2c48', C.ink] },
        { stripes: [-0.9, 0.9], period: 0.2, duty: 0.2, slant: 0.16, colors: [C.chalk] },
        { rect: [-1, 1], v: [0.72, 1], color: C.lime },
      ],
    },
    {
      id: 'carving-gold',
      name: 'Gold rush',
      base: C.ink,
      sidewall: C.lemon,
      layers: [
        { fill: C.ink },
        { grad: [0.15, 1], colors: [C.ink, '#3d3320', '#6e5a28', '#a07e2a', C.sand, C.lemon] },
        { stripes: [-0.95, -0.35], period: 0.09, duty: 0.4, slant: 0.07, chevron: true, colors: [C.sand] },
        { rect: [-1, -0.95], color: C.lemon },
      ],
      baseLayers: [{ fill: C.ink }, { stripes: [-0.9, 0.9], period: 0.12, duty: 0.35, slant: 0.07, chevron: true, colors: [C.lemon] }],
    },
    {
      // A pair: the speed stripes run on from one ski to the other, and each ski's outside edge is lined.
      id: 'carving-carbon',
      name: 'Carbon',
      base: C.cherry,
      sidewall: C.ink,
      pair: true,
      layers: [
        { fill: '#202328' },
        { stripes: [-1, 1], period: 0.125, duty: 0.5, slant: 0.06, colors: ['#2c3138'] },
        { stripes: [0.4, 0.9], period: 0.25, duty: 0.3, slant: 0.12, colors: [C.cherry] },
        { rect: [-1, 1], v: [-2, -1.72], color: C.chalk },
        { rect: [-1, 1], v: [1.72, 2], color: C.chalk },
        { rect: [0.9, 1], color: C.cherry },
      ],
      baseLayers: [{ fill: C.cherry }, { rect: [0.75, 1], color: C.chalk }, { rect: [-1, -0.9], color: C.ink }],
    },
  ],
};

export const SKI_TYPES: readonly SkiType[] = [PARK, BIG, CARVING];

export function skiType(id: SkiId): SkiType {
  return SKI_TYPES.find((s) => s.id === id) ?? PARK;
}

/** The graphic with this id on that ski, or the ski's first. */
export function skiGraphic(id: SkiId, graphic: string): SkiGraphic {
  const type = skiType(id);
  return type.graphics.find((g) => g.id === graphic) ?? type.graphics[0]!;
}

// ------------------------------------------------------------- the model

/** Half width (m) of the ski at `along` m from its middle, rounded off at the ends. */
export function halfWidthAt(m: SkiModel, along: number): number {
  const w = m.width;
  let hw = w[w.length - 1]![1];
  if (along <= w[0]![0]) hw = w[0]![1];
  else {
    for (let i = 1; i < w.length; i++) {
      const [a1, h1] = w[i]!;
      if (along > a1) continue;
      const [a0, h0] = w[i - 1]!;
      hw = h0 + ((h1 - h0) * (along - a0)) / (a1 - a0 || 1);
      break;
    }
  }
  const half = m.length / 2;
  const round = along > 0 ? m.tipRound : m.tailRound;
  const into = Math.abs(along) - (half - round);
  if (round > 0 && into > 0) hw *= Math.max(0.3, Math.sqrt(Math.max(0, 1 - (into / round) ** 2)));
  return hw;
}

/** Height (m) of the ski's base above flat snow at `along` m from its middle. */
export function riseAt(m: SkiModel, along: number): number {
  const r = along > 0 ? m.tip : m.tail;
  const half = m.length / 2;
  const t = Math.max(0, (Math.abs(along) - r.start) / Math.max(1e-6, half - r.start));
  return r.height * Math.min(1, t) ** r.power;
}

/** How many half widths long the ski is: lengths along it in the same units as across, for round shapes. */
export function aspectOf(m: SkiModel): number {
  const mean = m.width.reduce((sum, [, hw]) => sum + hw, 0) / m.width.length;
  return m.length / 2 / mean;
}

// ----------------------------------------------------------- the painter

/**
 * Draws one ski of a pair seen from above (or its base, seen from above
 * through the ski), tip to the right and its left edge on top, painted
 * cell by cell like the 3D ski: `put(x, y, hex)` for each pixel inside its
 * outline, at `pxPerM` pixels per meter, from x = 0, its middle on y = `mid`.
 */
export function drawSki(type: SkiType, g: SkiGraphic, side: Side, base: boolean, pxPerM: number, mid: number, put: (x: number, y: number, hex: string) => void): void {
  const m = type.model;
  const half = m.length / 2;
  const aspect = aspectOf(m);
  const w = Math.round(m.length * pxPerM);
  for (let px = 0; px < w; px++) {
    const along = -half + ((px + 0.5) / w) * m.length;
    const row = Math.min(m.rows - 1, Math.floor(((along + half) / m.length) * m.rows));
    const u = ((row + 0.5) / m.rows) * 2 - 1;
    const hw = halfWidthAt(m, along) * pxPerM;
    for (let py = Math.ceil(mid - hw - 0.5); py < mid + hw; py++) {
      const col = Math.min(m.cols - 1, Math.max(0, Math.floor(((py + 0.5 - (mid - hw)) / (2 * hw)) * m.cols)));
      put(px, py, graphicColor(g, u, -1 + (2 * col + 1) / m.cols, aspect, side, base));
    }
  }
}

/** The graphic's color at (u, v) on the `side` ski's top sheet, or its base; `aspect` from aspectOf. */
export function graphicColor(g: SkiGraphic, u: number, v: number, aspect: number, side: Side = 1, base = false): string {
  let color = g.base;
  const layers = base ? (g.baseLayers ?? []) : g.layers;
  if (g.pair) v += side;
  for (const layer of layers) {
    const c = layerColor(layer, u, v, aspect) ?? (layer.mirror ? layerColor(layer, -u, v, aspect) : null);
    if (c) color = c;
  }
  return color;
}

function layerColor(L: Layer, u: number, v: number, k: number): string | null {
  if ('fill' in L) return L.fill;
  if ('rect' in L) {
    const [v0, v1] = L.v ?? [-Infinity, Infinity];
    return within(u, L.rect) && v >= v0 && v <= v1 ? L.color : null;
  }
  if ('grad' in L) {
    const t = ((L.across ? v : u) - L.grad[0]) / (L.grad[1] - L.grad[0]);
    return t >= 0 && t <= 1 ? L.colors[Math.min(L.colors.length - 1, Math.floor(t * L.colors.length))]! : null;
  }
  if ('waves' in L) {
    const [a, b] = L.waves;
    const span = Math.abs(b - a);
    const t = ((L.across ? v : u) - a) / (b - a) + (L.amp / span) * Math.sin(Math.PI * L.freq * (L.across ? u : v) + (L.phase ?? 0));
    if (t < 0 || t >= 1) return null;
    return L.colors[Math.floor(t * L.colors.length)]!;
  }
  if ('stripes' in L) {
    if (!within(u, L.stripes)) return null;
    const p = (u + (L.slant ?? 0) * (L.chevron ? Math.abs(v) : v)) / L.period;
    const i = Math.floor(p);
    if (p - i >= L.duty) return null;
    const n = L.colors.length;
    return L.colors[((i % n) + n) % n]!;
  }
  if ('checks' in L) {
    if (!within(u, L.checks)) return null;
    const i = Math.floor((u * k) / L.size);
    const j = Math.floor((v + 1) / L.size);
    return L.colors[(i + j) & 1]!;
  }
  if ('circle' in L) {
    const [ra, rb] = typeof L.r === 'number' ? [L.r, L.r] : L.r;
    const d = Math.hypot(((u - L.circle[0]) * k) / ra, (v - L.circle[1]) / rb);
    const inner = L.ring ? 1 - L.ring / Math.min(ra, rb) : -1;
    return d <= 1 && d >= inner ? L.color : null;
  }
  if ('dots' in L) {
    for (const [du, dv] of L.dots) if (Math.hypot((u - du) * k, v - dv) <= L.r) return L.color;
    return null;
  }
  if ('poly' in L) return insidePoly(L.poly, u, v) ? L.color : null;
  // A spiral: inside its radius, on the arm when the distance out, in turns,
  // is just past the angle round, in turns.
  const dx = (u - L.spiral[0]) * k;
  const dy = v - L.spiral[1];
  const r = Math.hypot(dx, dy);
  if (r > L.r) return null;
  const turns = (r / L.r) * L.turns - Math.atan2(dy, dx) / (2 * Math.PI);
  return turns - Math.floor(turns) < L.width ? L.color : null;
}

function within(u: number, [a, b]: UV): boolean {
  return u >= Math.min(a, b) && u <= Math.max(a, b);
}

function insidePoly(pts: readonly UV[], u: number, v: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ui, vi] = pts[i]!;
    const [uj, vj] = pts[j]!;
    if (vi > v !== vj > v && u < ((uj - ui) * (v - vi)) / (vj - vi) + ui) inside = !inside;
  }
  return inside;
}

// ------------------------------------------------------------- the stats

export type SkiStat = 'spins' | 'landings' | 'topSpeed' | 'grip';
export const SKI_STATS: readonly { readonly id: SkiStat; readonly name: string }[] = [
  { id: 'spins', name: 'Spins' },
  { id: 'landings', name: 'Landings' },
  { id: 'topSpeed', name: 'Top speed' },
  { id: 'grip', name: 'Grip' },
];

/**
 * How the ski compares with the park ski (1), from its multipliers: spins
 * from the spin and flip rates, landings from the hardest impact and the
 * nose angle it lands, top speed from ski friction and air drag (top speed
 * goes as one over their square root), and grip from the grip and turn rate at speed.
 */
export function skiStats(id: SkiId): Record<SkiStat, number> {
  const s = CONFIG.skis[id] as Record<string, Record<string, number> | undefined>;
  const m = (block: string, key: string): number => s[block]?.[key] ?? 1;
  return {
    spins: (m('air', 'spinRate') + m('air', 'flipRate')) / 2,
    landings: (m('landing', 'impactMax') + m('landing', 'pitchMax')) / 2,
    topSpeed: 1 / Math.sqrt(m('skier', 'skiFriction') * ((m('skier', 'dragStand') + m('skier', 'dragCrouch')) / 2)),
    grip: (m('skier', 'grip') + m('skier', 'turnRateFast')) / 2,
  };
}
