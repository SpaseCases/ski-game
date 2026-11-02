// Rail shapes and set-ups shared by the map scripts (milestone 14): polyline
// rails (wave, A-frame, double kink, flat-down-flat-down), close-outs (a rail
// into a wallride, a rail out over an open gap, a pole jam), and rails on
// park tables (along the deck, or from the knuckle down the landing).
//
// Everything here returns plain map JSON for a script to push. Positions
// follow the scripts: the fall line runs down -Z, `d` is the distance down
// from the top (z = -d), and a slide's points are [m down the hill, m to the
// right, height above the snow there]. Heights are above the snow (and any
// jump built on it), so a "flat" stretch is flatter than the slope, not level.

import { CONFIG } from '../../src/config.ts';

export type Json = Record<string, unknown>;
export type Pt = [along: number, across: number, height: number];

const DEG = Math.PI / 180;
const r2 = (v: number): number => Math.round(v * 100) / 100;

/** A rail or box straight down the hill from (x, d), as map JSON. */
export function slideJson(kind: 'rail' | 'box', x: number, d: number, pts: Pt[], o: { width?: number; follow?: number; style?: string; radius?: number } = {}): Json {
  const f: Json = { type: kind, points: pts.map(([a, b, h]) => ({ x: r2(x + b), z: r2(-(d + a)), height: r2(h) })) };
  if (kind === 'box') f.width = o.width ?? 0.6;
  if (o.follow) f.follow = o.follow;
  if (o.style) f.style = o.style;
  if (o.radius) f.radius = o.radius;
  return f;
}

/** Ridden on from the snow: up to `h` over the first 3.5 m, like every ride-on rail in the parks. */
const RIDE_ON = 3.5;

/**
 * Builds a rail from stretches after the ride-on: each [length, rise per
 * meter against the snow] (+ flatter than the slope, - steeper), with a
 * sharp kink between stretches.
 */
function stretches(h: number, parts: [length: number, rise: number][]): Pt[] {
  const pts: Pt[] = [[0, 0, 0], [RIDE_ON, 0, h]];
  let a = RIDE_ON;
  let y = h;
  for (const [len, rise] of parts) {
    a += len;
    y += len * rise;
    pts.push([a, 0, y]);
  }
  return pts;
}

/** The new polyline rails, each ridden on from the snow. */
export const SHAPES = {
  /** Rolls up and down `waves` times over its length, `amp` m either side of `h`; a point every meter. */
  wave: (len: number, h = 0.6, amp = 0.25, waves = 2): Pt[] => {
    const pts: Pt[] = [[0, 0, 0], [RIDE_ON, 0, h]];
    const n = Math.ceil(len - RIDE_ON);
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      pts.push([RIDE_ON + (len - RIDE_ON) * t, 0, h + amp * Math.sin(2 * Math.PI * waves * t)]);
    }
    return pts;
  },
  /** Up to a sharp peak in the middle and down the other side (against the slope: it climbs `rise` m over the snow). */
  aFrame: (len: number, h = 0.4, rise = 0.8): Pt[] => {
    const half = (len - RIDE_ON) / 2;
    return stretches(h, [[half, rise / half], [half, -rise / half]]);
  },
  /** Flat, down, flat: two sharp kinks. */
  doubleKink: (len: number, h = 0.45): Pt[] => {
    const l = (len - RIDE_ON) / 3;
    return stretches(h, [[l, 0.09], [l, -0.12], [l, 0.07]]);
  },
  /** Flat, down, flat, down: three sharp kinks. */
  flatDownFlatDown: (len: number, h = 0.45): Pt[] => {
    const l = (len - RIDE_ON) / 4;
    return stretches(h, [[l, 0.1], [l, -0.12], [l, 0.1], [l, -0.12]]);
  },
};

/**
 * A pole jam: a short pipe rising out of the snow at `angle` degrees to the
 * slope, up to `height` m at its end, to ride up and pop off.
 */
export function poleJam(x: number, d: number, height = 1.2, angle = 25, radius = 0.1): Json {
  const run = height / Math.tan(angle * DEG);
  return slideJson('rail', x, d, [[0, 0, 0], [run, 0, height]], { style: 'tube', radius });
}

/**
 * A rail into a wallride: a ride-on rail from (x, d) heading `angle` degrees
 * across the hill toward `side` (1 right, -1 left), ending at the foot of a
 * wooden wall that stands beside the line, its middle where the rail ends.
 * Slide off the end straight up the wall.
 */
export function wallrideCloseOut(x: number, d: number, side: 1 | -1, o: { length?: number; height?: number; angle?: number; wall?: number } = {}): Json[] {
  const len = o.length ?? 12;
  const h = o.height ?? 0.45;
  const a = (o.angle ?? 35) * DEG;
  const pts: Pt[] = [[0, 0, 0], [RIDE_ON, 0, h], [len, 0, h]].map(([u, , ht]) => [u * Math.cos(a), side * u * Math.sin(a), ht] as Pt);
  const end = pts[pts.length - 1]!;
  const wall = o.wall ?? 18;
  return [
    slideJson('rail', x, d, pts),
    {
      type: 'quarter',
      x: r2(x + end[1] + side * 0.2),
      z: r2(-(d + end[0] - wall / 2)),
      yaw: 0,
      side,
      length: wall,
      radius: 3.4,
      wallAngle: 84,
      deckWidth: 0.6,
      back: 3.5,
      taper: 3.5,
      style: 'wood',
    },
  ];
}

/**
 * A rail out over an open gap: ridden on from the snow at (x, d), it climbs
 * away from the slope and stops in the air; `gap` m past its end a landing's
 * steep back rises to a flat top and its face. Slide off the end (or pop)
 * and clear the gap; short of it, the back of the landing is in the way.
 * Returns the rail, the landing, and a named gap for scoring ("Rail gap").
 */
export function gapRail(x: number, d: number, o: { length?: number; gap?: number; end?: number; landing?: number; width?: number } = {}): { features: Json[]; gap: Json } {
  const len = o.length ?? 11;
  const gap = o.gap ?? 2.5;
  const end = o.end ?? 1.6;
  const H = o.landing ?? 0.8;
  const width = o.width ?? 7;
  const back = 1.5;
  const top = 3;
  const face = 14;
  const rail = slideJson('rail', x, d, [[0, 0, 0], [RIDE_ON, 0, 0.5], [len, 0, end]]);
  const at = d + len + gap;
  const landing = { type: 'landing', x: r2(x), z: r2(-at), yaw: 0, width, sideWidth: 2.5, height: H, angle: face, back, top, knuckle: 2, transition: 6 };
  const half = width / 2 + 2.5;
  const box = (d0: number, d1: number, w: number): Json[] => [
    { x: r2(x - w), z: r2(-d0) },
    { x: r2(x + w), z: r2(-d0) },
    { x: r2(x + w), z: r2(-d1) },
    { x: r2(x - w), z: r2(-d1) },
  ];
  const faceLen = H / Math.tan(face * DEG);
  return {
    features: [rail, landing],
    gap: { name: 'Rail gap', from: box(d + len - 4, d + len + 1, 1.5), to: box(at + back, at + back + top + faceLen + 60, half), points: CONFIG.score.gapPoints },
  };
}

/** A park table's size, as the scripts' jump() takes it. */
export interface TableOpts {
  lip: number;
  angle: number;
  gap: number;
  land: number;
  width?: number;
  knuckle?: number;
  transition?: number;
}

/** Distances along a table jump from its takeoff's start (as maps/shapes.ts builds it): the lip, the knuckle, the bottom of the face. */
function tableAt(o: TableOpts): { lip: number; knuckle: number; face: number } {
  const lip = (2 * o.lip) / Math.tan(o.angle * DEG);
  const knuckle = lip + o.gap;
  const s = Math.tan(o.land * DEG);
  const k = o.knuckle ?? 3;
  const t = o.transition ?? 6;
  const face = Math.max(0, o.lip / s - (k + t) / 2);
  return { lip, knuckle, face: knuckle + k + face };
}

/** How far across from a table's middle its rails sit: on the full-height deck, 1 m in from where its sides start. */
const tableSide = (o: TableOpts, side: 1 | -1): number => side * ((o.width ?? 7) / 2 - 1);

/** Height (m) of a table's rail above its deck or landing. */
const TABLE_RAIL = 0.35;

/**
 * A deck rail on a table whose takeoff starts at (x, d): along the deck to
 * one side, from just past the lip to the knuckle. Ridden on off the deck,
 * or landed on off the lip.
 */
export function deckRail(x: number, d: number, o: TableOpts, side: 1 | -1): Json {
  const t = tableAt(o);
  const run = t.knuckle - t.lip - 1;
  const ramp = Math.min(1.2, run / 3);
  return slideJson('rail', x + tableSide(o, side), d + t.lip + 1, [[0, 0, 0], [ramp, 0, TABLE_RAIL], [run, 0, TABLE_RAIL]], { follow: 1 });
}

/**
 * A knuckle-down rail on a table whose takeoff starts at (x, d): from the
 * end of the deck over the knuckle and down the landing's face, to one side.
 * Coming up short on the deck, slide it down to the landing.
 */
export function knuckleRail(x: number, d: number, o: TableOpts, side: 1 | -1): Json {
  const t = tableAt(o);
  const start = Math.max(t.lip + 1, t.knuckle - 4);
  return slideJson('rail', x + tableSide(o, side), d + start, [[0, 0, 0], [1.2, 0, TABLE_RAIL], [t.face - start, 0, TABLE_RAIL]], { follow: 1 });
}

// ---------------------------------------------------------------- 3D rails
// A 3D rail gives every point its own up: the way the skier's body points
// while sliding it. A loop or corkscrew turns its up all the way round, and
// the skier stays on while fast enough (see CONFIG.rails, slideRail).

/** The snow's height at (x, z): the map's heightAt, for turning world points into heights above the snow. */
export type Ground = (x: number, z: number) => number;

/** A point of a 3D rail in the slope's own frame: along it (m, down the hill), across (m, right), off it (m, along its normal), and its up in the same frame. */
type Local = [a: number, c: number, n: number, up: [number, number, number]];

/**
 * Lays a 3D rail's points, given in the slope's frame (tilted to the snow's
 * pitch between d and d + `span` at x) from (x, d), as map JSON with each
 * point's height above the snow and its up direction.
 */
function place3d(x: number, d: number, span: number, ground: Ground, local: Local[], style: string): Json {
  const y0 = ground(x, -d);
  const p = Math.atan2(y0 - ground(x, -(d + span)), span);
  // The slope's frame: A down it, C to the right, N off it (world x y z).
  const A = [0, -Math.sin(p), -Math.cos(p)];
  const C = [1, 0, 0];
  const N = [0, Math.cos(p), -Math.sin(p)];
  const at = (a: number, c: number, n: number, i: number): number => a * A[i]! + c * C[i]! + n * N[i]!;
  const r3 = (v: number): number => Math.round(v * 1000) / 1000;
  /** Radius (m) of a 3D rail's tube: a little fatter than a park rail. */
  const TUBE = 0.06;
  const points = local.map(([a, c, n, up]) => {
    const px = x + at(a, c, n, 0);
    const py = y0 + at(a, c, n, 1);
    const pz = -d + at(a, c, n, 2);
    const u = [0, 1, 2].map((i) => at(up[0], up[1], up[2], i));
    const len = Math.hypot(u[0]!, u[1]!, u[2]!);
    return { x: r3(px), z: r3(pz), height: r3(py - ground(px, pz)), up: u.map((v) => r3(v / len)) };
  });
  return { type: 'rail', style, radius: TUBE, points };
}

/** Straight in from the snow over `lead` m to `h` above it (a ride-on), along +a, ending at a = 0. */
function leadIn(lead: number, h: number): Local[] {
  return [[-lead, 0, 0, [0, 0, 1]], [-lead + RIDE_ON, 0, h, [0, 0, 1]]];
}

/** Straight out from (0, c, h) along +a over `lead` m, back down to the snow over its last 3.5 m. */
function leadOut(lead: number, c: number, h: number): Local[] {
  return [[lead - RIDE_ON, c, h, [0, 0, 1]], [lead, c, 0, [0, 0, 1]]];
}

/**
 * A loop-de-loop down the hill from (x, d): ridden on from the snow, a
 * vertical circle of radius `radius` standing on the slope (its bottom `h`
 * above the snow), drifting `drift` m right over the turn so its way out
 * passes beside its way in, then straight out and back down to the snow.
 * Points every 360/`sides` degrees round the circle.
 */
export function loop(x: number, d: number, ground: Ground, o: { radius?: number; h?: number; drift?: number; lead?: number; sides?: number } = {}): Json {
  const R = o.radius ?? 3;
  const h = o.h ?? 0.5;
  const w = o.drift ?? 1.4;
  const lead = o.lead ?? 7;
  const n = o.sides ?? 40;
  const pts: Local[] = [...leadIn(lead, h)];
  for (let k = 0; k <= n; k++) {
    const t = (2 * Math.PI * k) / n;
    // Up points at the circle's middle.
    pts.push([R * Math.sin(t), (w * k) / n, h + R * (1 - Math.cos(t)), [-Math.sin(t), 0, Math.cos(t)]]);
  }
  pts.push(...leadOut(lead, w, h));
  return place3d(x, d, 2 * R + 2 * lead, ground, pts.map(([a, c, nn, up]) => [a + lead, c, nn, up] as Local), 'loop');
}

/**
 * A corkscrew down the hill from (x, d): ridden on from the snow, one turn
 * of a helix of radius `radius` round an axis `h` + `radius` above the
 * snow, `length` m along it, ridden on the inside (up points at the axis),
 * then straight out and back down to the snow. Its axis runs across the
 * hill toward `side` (1 right, -1 left), turned so the helix starts and
 * ends heading straight down the hill: it first curves the other way.
 */
export function corkscrew(x: number, d: number, ground: Ground, o: { radius?: number; length?: number; h?: number; lead?: number; side?: 1 | -1; steps?: number } = {}): Json {
  const R = o.radius ?? 3;
  const L = o.length ?? 24;
  const h = o.h ?? 0.5;
  const lead = o.lead ?? 7;
  const side = o.side ?? 1;
  const n = o.steps ?? 48;
  const pitch = L / (2 * Math.PI);
  // The helix first curves away from `side`, its tangent at the start this
  // far off its axis: turn everything back by that much, so the start heads
  // along +a and the axis leans toward `side`.
  const bend = -side;
  const phi = Math.atan2(bend * R, pitch);
  const turn = (u: number, v: number): [number, number] => [u * Math.cos(phi) + v * Math.sin(phi), -u * Math.sin(phi) + v * Math.cos(phi)];
  const helix: Local[] = [];
  for (let k = 0; k <= n; k++) {
    const t = (2 * Math.PI * k) / n;
    const [a, c] = turn(pitch * t, bend * R * Math.sin(t));
    // Up points at the axis.
    const [ua, uc] = turn(0, -bend * Math.sin(t));
    helix.push([a, c, h + R * (1 - Math.cos(t)), [ua, uc, Math.cos(t)]]);
  }
  const end = helix[helix.length - 1]!;
  const pts: Local[] = [...leadIn(lead, h), ...helix, ...leadOut(lead, 0, h).map(([a, c, nn, up]) => [end[0] + a, end[1] + c, nn, up] as Local)];
  const span = end[0] + 2 * lead;
  return place3d(x, d, span, ground, pts.map(([a, c, nn, up]) => [a + lead, c, nn, up] as Local), 'corkscrew');
}
