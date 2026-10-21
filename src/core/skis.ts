import { CONFIG } from '../config.ts';

// The three ski types, as data: each one's model (its shape, for the eye
// only: the physics treats every ski as the same length) and its top sheet
// graphics. A graphic is a list of layers painted in order onto the top
// sheet's grid of faces, so it shows as vertex colors on Low with no
// textures. The same painter draws the Locker's thumbnails. How each ski
// rides is CONFIG.skis (multipliers on config.ts's numbers).

export type SkiId = keyof typeof CONFIG.skis;

/** A spot on the top sheet: u along the ski (-1 tail end, 1 tip end), v across it (-1 left edge, 1 right edge, seen from above). */
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
  /** The base (the underside) and, if not the top sheet's edge color, the sidewalls. */
  base: string;
  sidewall?: string;
  layers: readonly Layer[];
}

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
    },
    {
      id: 'park-blocks',
      name: 'Color blocks',
      base: C.navy,
      sidewall: C.ink,
      layers: [
        { fill: C.lemon },
        { stripes: [-1, 1], period: 0.24, duty: 0.5, slant: 0.09, colors: [C.tangerine, C.bubblegum, C.cobalt, C.teal] },
        { rect: [0.9, 1], color: C.ink, mirror: true },
      ],
    },
    {
      id: 'park-chevrons',
      name: 'Chevrons',
      base: C.lemon,
      layers: [
        { fill: C.navy },
        { stripes: [0.28, 0.95], period: 0.13, duty: 0.5, slant: 0.1, chevron: true, colors: [C.lemon, C.glacier], mirror: true },
        { rect: [0.95, 1], color: C.tangerine, mirror: true },
      ],
    },
  ],
};

// Big mountain graphics are long panoramas: the horizon runs along the ski,
// the sky toward its left edge (v = -1), seen from above with the tip ahead
// (in the Locker's thumbnails, the tip to the right and the sky on top).
// The boots stand on the middle, so the art leans to the ends.
const SUNSET = ['#3b2a5c', C.plum, '#a3477a', C.bubblegum, '#f0784a', '#f6a640', C.lemon];
const RANGE: readonly UV[] = [
  [-1, 0],
  [-0.9, -0.25],
  [-0.82, -0.05],
  [-0.68, -0.85],
  [-0.55, -0.15],
  [-0.45, -0.3],
  [-0.32, 0.05],
  [-0.15, -0.35],
  [0, 0],
  [0.12, -0.25],
  [0.28, 0.1],
  [0.42, -0.2],
  [0.55, 0.05],
  [0.72, -0.9],
  [0.86, -0.2],
  [0.94, -0.35],
  [1, -0.1],
  [1, 1],
  [-1, 1],
];

/** A row of pine tops along the ski, from v = `base` up by about `height`, closed down to the right edge. */
function treeline(base: number, height: number, period: number): UV[] {
  const tall = [0.75, 1, 0.6, 0.9, 1.1, 0.8, 0.95, 0.65];
  const pts: UV[] = [[-1, 1]];
  for (let i = 0, u = -1; u < 1; i++, u += period) {
    pts.push([u, base], [u + period / 2, base - height * tall[i % tall.length]!]);
  }
  pts.push([1, base], [1, 1]);
  return pts;
}

/** An owl perched on a branch at u = `at`, facing out of the ski. */
function owl(at: number): Layer[] {
  const brown = '#8a5a3a';
  const wing = '#6e4429';
  return [
    { rect: [at - 0.22, at + 0.25], v: [0.72, 0.86], color: '#5a3a22' },
    { circle: [at, 0.12], r: [0.8, 0.62], color: brown },
    { circle: [at - 0.045, 0.15], r: [0.32, 0.48], color: wing },
    { circle: [at + 0.045, 0.15], r: [0.32, 0.48], color: wing },
    { circle: [at, 0.24], r: [0.45, 0.4], color: '#d9b98a' },
    { circle: [at, -0.45], r: [0.72, 0.44], color: brown },
    { poly: [[at - 0.05, -0.72], [at - 0.045, -1], [at - 0.02, -0.8]], color: brown },
    { poly: [[at + 0.05, -0.72], [at + 0.045, -1], [at + 0.02, -0.8]], color: brown },
    { circle: [at - 0.024, -0.47], r: 0.3, color: C.lemon },
    { circle: [at + 0.024, -0.47], r: 0.3, color: C.lemon },
    { circle: [at - 0.024, -0.47], r: 0.14, color: C.ink },
    { circle: [at + 0.024, -0.47], r: 0.14, color: C.ink },
    { poly: [[at - 0.012, -0.32], [at + 0.012, -0.32], [at, -0.1]], color: C.tangerine },
    { dots: [[at - 0.016, 0.72], [at + 0.016, 0.72]], r: 0.16, color: C.tangerine },
  ];
}

/** A koi at (`at`, `v`) swimming toward the tip (dir 1) or the tail (-1): tail fin, side fins, body, patches, eyes. */
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
      layers: [
        { grad: [-1, 0.2], across: true, colors: SUNSET },
        { circle: [0.42, -0.1], r: 0.8, color: '#ffe9a8' },
        { poly: RANGE, color: '#7a5f9c' },
        { poly: [[-0.68, -0.85], [-0.615, -0.5], [-0.64, -0.58], [-0.67, -0.48], [-0.7, -0.6], [-0.741, -0.5]], color: C.chalk },
        { poly: [[0.72, -0.9], [0.79, -0.55], [0.76, -0.63], [0.73, -0.52], [0.69, -0.64], [0.657, -0.55]], color: C.chalk },
        { poly: treeline(0.6, 0.45, 0.06), color: C.pine },
        { waves: [0.84, 1], across: true, colors: ['#f3d6c6'], amp: 0.06, freq: 3 },
      ],
    },
    {
      id: 'big-owl',
      name: 'Night owl',
      base: C.navy,
      layers: [
        { fill: '#14203a' },
        { waves: [-0.95, -0.1], across: true, colors: ['#1d4a55', C.teal, C.lime, C.teal, '#1d4a55'], amp: 0.22, freq: 1.6 },
        {
          dots: [[-0.95, -0.7], [-0.82, 0.05], [-0.3, -0.75], [-0.2, 0.15], [0.05, -0.8], [0.3, -0.2], [0.45, -0.85], [0.82, 0], [0.93, -0.75], [0.6, 0.25]],
          r: 0.2,
          color: C.chalk,
        },
        { circle: [0.68, -0.42], r: 0.5, color: '#f3e6a8' },
        { circle: [0.7, -0.58], r: 0.45, color: '#14203a' },
        { poly: treeline(0.62, 0.55, 0.07), color: '#0b1424' },
        ...owl(-0.6),
      ],
    },
    {
      id: 'big-koi',
      name: 'Koi pond',
      base: C.teal,
      layers: [
        { fill: '#1f6f73' },
        { circle: [0.2, 0.3], r: 0.95, ring: 0.16, color: '#3fa3a0' },
        { circle: [-0.3, -0.4], r: 0.8, ring: 0.16, color: '#3fa3a0' },
        { circle: [-0.9, 0.2], r: 0.7, ring: 0.16, color: '#3fa3a0' },
        { circle: [0.9, 0.4], r: 0.62, color: C.olive },
        { poly: [[0.9, 0.4], [0.935, 1], [0.9, 1]], color: '#1f6f73' },
        { circle: [-0.86, -0.5], r: 0.55, color: C.olive },
        { circle: [0.93, -0.55], r: 0.3, color: C.bubblegum },
        ...koi(0.55, -0.05, 1, C.tangerine, C.chalk),
        ...koi(-0.52, 0.2, -1, C.chalk, C.cherry),
      ],
    },
    {
      id: 'big-swirls',
      name: 'Wind and sun',
      base: C.tangerine,
      layers: [
        { grad: [-1, 0.5], across: true, colors: [C.cobalt, '#4f94dc', '#6fabe0', '#8cc0e2', C.glacier] },
        { circle: [0.74, -0.2], r: 0.8, color: C.lemon },
        { circle: [0.74, -0.2], r: 0.55, color: C.tangerine },
        { spiral: [0.4, -0.3], r: 0.68, turns: 1.3, width: 0.5, color: C.chalk },
        { spiral: [-0.42, -0.3], r: 0.68, turns: 1.3, width: 0.5, color: '#d8ecf6' },
        { spiral: [-0.8, -0.3], r: 0.68, turns: 1.3, width: 0.5, color: C.chalk },
        { waves: [0.35, 1], across: true, colors: [C.lime, '#7fae3a', C.olive, C.pine], amp: 0.14, freq: 2.5, phase: 1 },
        { dots: [[-0.9, 0.55], [-0.62, 0.75], [-0.35, 0.6], [0.5, 0.7], [0.66, 0.55], [0.9, 0.75]], r: 0.2, color: C.bubblegum },
        { dots: [[-0.78, 0.85], [-0.5, 0.5], [0.58, 0.85], [0.8, 0.5]], r: 0.2, color: C.lemon },
      ],
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

/** The graphic's color at (u, v); `aspect` from aspectOf. */
export function graphicColor(g: SkiGraphic, u: number, v: number, aspect: number): string {
  let color = g.base;
  for (const layer of g.layers) {
    const c = layerColor(layer, u, v, aspect) ?? (layer.mirror ? layerColor(layer, -u, v, aspect) : null);
    if (c) color = c;
  }
  return color;
}

function layerColor(L: Layer, u: number, v: number, k: number): string | null {
  if ('fill' in L) return L.fill;
  if ('rect' in L) {
    const [v0, v1] = L.v ?? [-1, 1];
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
