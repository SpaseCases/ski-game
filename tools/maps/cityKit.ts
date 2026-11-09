// The City's building kit (milestone 16, reworked into a city on a hill):
// the pieces tools/maps/city.ts lays out. Everything here is written in a
// block's own frame, as the first City was: x across (+x to the right facing
// down), d down the block from its top, z = -d, yaw 0 down the block. A
// frame (`useFrame`) maps those onto the hill, so the same makers and
// templates work in a block that curves round the hill: `put` turns any
// feature written that way (railKit's too) into world coordinates.

import type { Heightfield } from '../../src/maps/types.ts';
import { heightAt } from '../../src/sim/terrain.ts';
import { poleJam, SHAPES, slideJson, type Json, type Pt } from './railKit.ts';

export type { Json, Pt };
export const DEG = Math.PI / 180;
export const r1 = (v: number): number => Math.round(v * 10) / 10;
export const r2 = (v: number): number => Math.round(v * 100) / 100;

/** A small seeded random (mulberry32), so a rerun lays out the same city. */
export function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- what the map collects
export const out = {
  features: [] as Json[],
  gaps: [] as Json[],
  decor: [] as Json[],
  notes: [] as string[],
};
/**
 * An oriented rectangle on the ground: from a spot (x, z), u0..u1 along a
 * direction and v0..v1 to its right. Buildings' outlines (with their drifts
 * and landing drifts) and the clear zones features need round them (their
 * run-ins, run-outs, a wallride's open side) are kept as these, in a grid,
 * for the checks and for packing the blocks.
 */
export interface Rect {
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  what: string;
}
const GRID = 16;
class RectGrid {
  readonly all: Rect[] = [];
  private readonly cells = new Map<number, Rect[]>();
  add(r: Rect): void {
    this.all.push(r);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const u of [r.u0, r.u1]) {
      for (const v of [r.v0, r.v1]) {
        const x = r.x + r.dirX * u - r.dirZ * v;
        const z = r.z + r.dirZ * u + r.dirX * v;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
      }
    }
    for (let cz = Math.floor((minZ - 4) / GRID); cz <= Math.floor((maxZ + 4) / GRID); cz++) {
      for (let cx = Math.floor((minX - 4) / GRID); cx <= Math.floor((maxX + 4) / GRID); cx++) {
        const k = cz * 4096 + cx;
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(r);
      }
    }
  }
  /** The first rectangle holding (x, z), `pad` m out. */
  at(x: number, z: number, pad: number): Rect | undefined {
    const list = this.cells.get(Math.floor(z / GRID) * 4096 + Math.floor(x / GRID));
    if (!list) return undefined;
    for (const r of list) {
      const dx = x - r.x;
      const dz = z - r.z;
      const u = dx * r.dirX + dz * r.dirZ;
      const v = -dx * r.dirZ + dz * r.dirX;
      if (u > r.u0 - pad && u < r.u1 + pad && v > r.v0 - pad && v < r.v1 + pad) return r;
    }
    return undefined;
  }
}
/** Buildings' roofs, drifts and landing drifts. */
export const footprints = new RectGrid();
/** Clear zones round features (and buildings' ways on and off). */
export const keeps = new RectGrid();
/** A rectangle along world heading `yaw` (degrees) from (x, z). */
export function rectAt(x: number, z: number, yaw: number, u0: number, u1: number, v0: number, v1: number, what: string): Rect {
  const a = yaw * DEG;
  return { x, z, dirX: -Math.sin(a), dirZ: -Math.cos(a), u0, u1, v0, v1, what };
}

let ground: Heightfield | null = null;
export function setGround(hf: Heightfield): void {
  ground = hf;
}
/** Height of the bare hill at a world spot. */
export function gyW(x: number, z: number): number {
  if (!ground) throw new Error('cityKit: setGround first');
  return heightAt(ground, x, z);
}

/** The random every template draws from; each part of the city sets its own (`useRandom`), so a change in one doesn't re-roll the rest. */
let rnd = random(16);
export function useRandom(seed: number): void {
  rnd = random(seed);
}
export const rand = (): number => rnd();
export const pick = <T>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)]!;
export const between = (a: number, b: number): number => a + (b - a) * rnd();

// ---------------------------------------------------------------- frames
/** A frame: where (x across, d down) of a block is in the world. */
export type Frame = (x: number, d: number) => [number, number];
const IDENTITY: Frame = (x, d) => [x, -d];
let frame: Frame = IDENTITY;
export function useFrame(f: Frame | null): void {
  frame = f ?? IDENTITY;
}
export const W = (x: number, d: number): [number, number] => frame(x, d);
/** World heading (degrees) of the frame's way down at (x, d). */
export function downAt(x: number, d: number): number {
  const [ax, az] = W(x, d - 0.5);
  const [bx, bz] = W(x, d + 0.5);
  return Math.atan2(-(bx - ax), -(bz - az)) / DEG;
}
/** Height of the hill at (x, d) of the frame. */
export const gy = (x: number, d: number): number => {
  const [wx, wz] = W(x, d);
  return gyW(wx, wz);
};
/** How steep (degrees) the hill falls along the frame's way down at (x, d). */
export const pitchAt = (x: number, d: number): number => Math.atan((gy(x, d - 1) - gy(x, d + 1)) / 2) / DEG;
/** A local spot as map JSON (z = -d). */
export const xz = (x: number, d: number): Json => ({ x: r2(x), z: r2(-d) });

const wrap = (a: number): number => {
  let v = ((a % 360) + 360) % 360;
  if (v > 180) v -= 360;
  return r1(v);
};

/**
 * Turns a feature written in the frame (x, z = -d, yaw 0 down) into world
 * coordinates and adds it to the map. Points of rails and boxes are mapped
 * one by one (so a long one curves with its block); anything with a single
 * spot is mapped there and turned by the frame's heading at that spot.
 */
export function put(f: Json): Json {
  const g: Json = { ...f };
  if (Array.isArray(f.points)) {
    g.points = (f.points as Json[]).map((p) => {
      const [x, z] = W(p.x as number, -(p.z as number));
      return { ...p, x: r2(x), z: r2(z) };
    });
  }
  if (typeof f.x === 'number' && typeof f.z === 'number') {
    const lx = f.x;
    const ld = -f.z;
    const [x, z] = W(lx, ld);
    g.x = r2(x);
    g.z = r2(z);
    const h = downAt(lx, ld);
    if (typeof f.yaw === 'number') g.yaw = wrap(f.yaw + h);
    if (typeof f.heading === 'number') g.heading = wrap(f.heading + h);
  }
  return pushWorld(g);
}

/** Adds a feature already in world coordinates. */
export function pushWorld(g: Json): Json {
  out.features.push(g);
  keepClear(g);
  return g;
}

/** Records a feature's outline and the clear snow it needs round it (world coordinates). */
function keepClear(g: Json): void {
  const x = g.x as number;
  const z = g.z as number;
  const yaw = g.yaw as number;
  const n = (k: string): number => (g[k] as number) || 0;
  switch (g.type) {
    case 'building': {
      const half = n('width') / 2;
      footprints.add(rectAt(x, z, yaw, -n('drift'), n('length') + n('apron'), -half, half, `building ${String(g.style)}`));
      // A way up the drift, and the run-out past the landing drift.
      if (n('drift') > 0) keeps.add(rectAt(x, z, yaw, -n('drift') - 12, -n('drift'), -half, half, 'drift run-in'));
      if (n('apron') > 0) keeps.add(rectAt(x, z, yaw, n('length') + n('apron'), n('length') + n('apron') + 40, -half - 3, half + 3, 'run-out'));
      break;
    }
    case 'terrace': {
      const run = n('stairs') > 0 ? n('height') / Math.tan((n('stairAngle') || 22) * DEG) : 0;
      const half = n('width') / 2 + 2;
      // features.ts rides on 33 m past its front: clear snow that far.
      keeps.add(rectAt(x, z, yaw, -12, n('length') + run + 34, -half, half, 'terrace'));
      break;
    }
    case 'landing':
    case 'kicker': {
      const len = n('back') + n('top') + (n('height') || n('lipHeight')) * 3 + 6;
      const half = n('width') / 2 + n('sideWidth') + 1;
      keeps.add(rectAt(x, z, yaw, -10, len + 14, -half, half, String(g.type)));
      break;
    }
    case 'quarter': {
      // Its face and the open snow it's ridden from (16 m out from the foot).
      const s = n('side');
      const reach = n('radius') + n('deckWidth') + n('back') + 1;
      // A rider leaves its far end heading back out across the open snow: room for that too.
      keeps.add(rectAt(x, z, yaw, -6, n('length') + 36, s > 0 ? -20 : -reach, s > 0 ? reach : 20, 'wallride'));
      break;
    }
    case 'rail':
    case 'box': {
      const pts = g.points as { x: number; z: number }[];
      const a = pts[0]!;
      const b = pts[pts.length - 1]!;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 0.1) break;
      const h = Math.atan2(-(b.x - a.x), -(b.z - a.z)) / DEG;
      const half = ((g.width as number) || 0.3) / 2 + 2.5;
      keeps.add(rectAt(a.x, a.z, h, -10, len + 14, -half, half, String(g.style ?? g.type)));
      break;
    }
  }
}
/** Maps a polygon written in the frame. */
export const poly = (pts: [number, number][]): Json[] =>
  pts.map(([x, d]) => {
    const [wx, wz] = W(x, d);
    return { x: r1(wx), z: r1(wz) };
  });
/** A rectangle across x ± half from d0 to d1, as a gap polygon. */
export const rect = (x: number, d0: number, d1: number, half: number): Json[] => poly([[x - half, d0], [x + half, d0], [x + half, d1], [x - half, d1]]);

/** Is (x, z) inside any building's outline (with its drifts), `pad` m out? */
export function insideBuilding(x: number, z: number, pad = 0.3): Rect | undefined {
  return footprints.at(x, z, pad);
}
/** Is (x, z) in any feature's clear zone, `pad` m out? */
export function inKeep(x: number, z: number, pad = 0): Rect | undefined {
  return keeps.at(x, z, pad);
}

// ---------------------------------------------------------------- colors and names
export const SHOP_COLORS = ['#c8553d', '#3f7fbf', '#e0b84a', '#6a8f5a', '#e8e0d0', '#b8483a', '#4f6fa8', '#d9a441', '#7a8f9f', '#a65f8a'];
export const BLOCK_COLORS = ['#9a5b45', '#b8735a', '#8c6f5a', '#c9b48e', '#7d8590', '#a8a29a', '#6e7c8c', '#b9a27e', '#8a4f3d', '#d0c4ac', '#5f6b78', '#a7826a'];
export const OLD_COLORS = ['#d8c9a8', '#cdb48a', '#e2d6bc', '#b99a72', '#c8a27a', '#d9b98f', '#a88a6a', '#e6dcc6', '#c47f5a', '#9c6b4e'];
export const TOWER_COLORS = ['#8d9aa8', '#a7b0b8', '#6f7a86', '#b9bfc5', '#7f8b84'];
export const HOUSE_COLORS = ['#7a4f2c', '#8a5a32', '#6e4a2e', '#9a6a3c', '#d8cbb0', '#c9b48e', '#b5523b', '#5d7a8c', '#e1d3b1'];
export const BRICK_COLORS = ['#8a4f3d', '#9a5b45', '#7a463a', '#a5614a', '#6e4436'];
export const SHOP_SIGNS = ['Bakery', 'Cafe', 'Books', 'Records', 'Deli', 'Noodles', 'Hardware', 'Florist', 'Barber', 'Bikes', 'Tea', 'Pizza', 'Diner', 'Market', 'Gallery', 'Bagels', 'Toys', 'Grocer', 'Tune shop', 'Outfitters', 'Rentals', 'Soup', 'Tailor', 'Laundry', 'Cheese', 'Optician', 'Pharmacy', 'Bistro', 'Thrift', 'Comics'];

export type Side = 'W' | 'E' | 'N' | 'S';
/** A building's `front` for a door facing frame side `s` (W left, E right, N up, S down), for its local yaw (0 runs down, 180 up). */
export function front(s: Side, yaw: 0 | 180): string {
  const down = { W: 'left', E: 'right', N: 'up', S: 'down' } as const;
  const up = { W: 'right', E: 'left', N: 'down', S: 'up' } as const;
  return (yaw === 0 ? down : up)[s];
}

// ---------------------------------------------------------------- buildings
/** An x across that may follow a line down the block (a street's edge): a number, or x at each d. */
export type X = number | ((d: number) => number);
export const xAt = (x: X, d: number): number => (typeof x === 'number' ? x : x(d));

/** Local yaw (degrees, 0 down the frame at d) of the straight line from (x0, d0) to (x1, d1). */
function yawBetween(x0: number, d0: number, x1: number, d1: number): number {
  const [ax, az] = W(x0, d0);
  const [bx, bz] = W(x1, d1);
  return Math.atan2(-(bx - ax), -(bz - az)) / DEG - downAt(x0, d0);
}

/** A rideable building (a shop or house) whose roof follows the slope: its roof's uphill edge centered at (x, d), its length along the line x. */
export function shop(x: X, d: number, b: Json): Json | null {
  const len = b.length as number;
  const x0 = xAt(x, d);
  // Its roof, drift and landing drift must be clear of other buildings and of features' clear zones (a run-out may
  // lead straight up its drift: chained houses).
  const drift = (b.drift as number) || 0;
  const apron = (b.apron as number) || 0;
  const half = (b.width as number) / 2;
  for (let u = -drift; u <= len + apron + 1e-6; u += 2.5) {
    for (let v = -half; v <= half + 1e-6; v += half / 2) {
      const [px, pz] = W(xAt(x, d + Math.max(0, Math.min(len, u))) + v, d + u);
      const k = keeps.at(px, pz, 0);
      if (footprints.at(px, pz, -0.3) || (k && !(drift > 0 && k.what === 'run-out'))) return null;
    }
  }
  return put({ type: 'building', ...xz(x0, d), yaw: r1(yawBetween(x0, d, xAt(x, d + len), d + len)), drift: 0, apron: 0, lip: 0, rise: 0, chimney: false, sign: '', ...b });
}

/**
 * A building nobody rides (a mid-rise, a tower), standing level: from d to
 * d + length down the line x, at least `eave` tall at its uphill wall. It's
 * laid out turned uphill with a shed roof as high above its downhill end as
 * the hill drops along it, so the roof is level.
 */
export function highrise(x: X, d: number, length: number, width: number, eave: number, style: string, color: string, door: Side, sign = '', extra: Json = {}): Json {
  const xa = xAt(x, d + length);
  const xb = xAt(x, d);
  const [ax, az] = W(xa, d + length);
  const [bx, bz] = W(xb, d);
  const rise = Math.max(0, gyW(bx, bz) - gyW(ax, az));
  const yaw = yawBetween(xa, d + length, xb, d);
  return put({ type: 'building', ...xz(xa, d + length), yaw: r1(yaw), length: r1(length), width: r1(width), eave: r1(eave), roof: 'shed', rise: r2(rise), drift: 0, apron: 0, lip: 0, chimney: false, style, color, front: front(door, 180), sign, ...extra });
}

/** A terrace (a plaza with a wall drop on every side) from (x, d) down `length`, level, `extra` m higher at its front; stairs down its front. Returns its height at the front. */
export function terrace(x: number, d: number, length: number, width: number, stairs: number, o: { extra?: number; stairAngle?: number; handrails?: boolean; height?: number } = {}): number {
  const height = o.height ?? Math.max(0.3, gy(x, d) - gy(x, d + length) + (o.extra ?? 0));
  put({ type: 'terrace', ...xz(x, d), yaw: 0, length, width, height: r2(height), stairs, stairAngle: o.stairAngle ?? 22, handrails: o.handrails ?? stairs > 0 });
  return height;
}

/** A box or rail through [x, d, height above the snow] points. */
export function box(style: string, width: number, pts: [number, number, number][]): void {
  put({ type: 'box', style, width, points: pts.map(([x, d, h]) => ({ x: r2(x), z: r2(-d), height: r2(h) })) });
}
export function rail(pts: [number, number, number][], style = 'metal'): void {
  put({ type: 'rail', style, points: pts.map(([x, d, h]) => ({ x: r2(x), z: r2(-d), height: r2(h) })) });
}
/** A railKit slide down the frame from (x, d). */
export function slide(kind: 'rail' | 'box', x: number, d: number, pts: Pt[], o: { width?: number; style?: string; radius?: number } = {}): void {
  put(slideJson(kind, x, d, pts, o));
}

/** A plow bank along a curb, 1.3 m of snow, an eased back, a short top. */
export const BANK = { height: 1.3, back: 2.6, top: 0.8, angle: 26, knuckle: 0.6, transition: 1.5, side: 4 };
/** A snow bank (a plow pile, a landing below a drop, a drift against a wall): rising from (x, d) along local `yaw` (0 down), its face falling away beyond its top. */
export function bank(x: number, d: number, yaw: number, width: number, o: { height?: number; back?: number; top?: number; angle?: number; side?: number } = {}): void {
  put({
    type: 'landing',
    ...xz(x, d),
    yaw,
    width: r1(width),
    sideWidth: o.side ?? BANK.side,
    height: o.height ?? BANK.height,
    angle: o.angle ?? BANK.angle,
    back: o.back ?? BANK.back,
    top: o.top ?? BANK.top,
    knuckle: BANK.knuckle,
    transition: BANK.transition,
    natural: true,
  });
}

/**
 * A wallride drawn as a building's own wall (style 'wall'): its face curves
 * up out of the snow to 80° toward the wall, its foot WALL_FOOT out from the
 * roof's edge (`wallrideOn` lays one on a building as laid).
 */
export const WALLRIDE = { length: 18, radius: 3.4, angle: 80, deck: 0.6, back: 0.9, taper: 3.5, before: 6, past: 14 };
/** How far the foot stands out from the roof's edge: the transition, the deck and a strip under the eaves (drawn as the wall's plinth). */
const WALL_FOOT = WALLRIDE.radius * Math.sin(WALLRIDE.angle * DEG) + WALLRIDE.deck + WALLRIDE.back;
/** A column's building: from d0 to d1 down its block, its color, and the building as laid (world coordinates). */
export type Segment = [number, number, string, Json];

/**
 * A wallride on a building's long wall, the one facing world spot
 * (towardX, towardZ): its foot WALL_FOOT out from the roof's edge, running
 * down the hill along the wall from `before` m below its uphill end.
 */
export function wallrideOn(g: Json, towardX: number, towardZ: number, color: string, length = WALLRIDE.length): void {
  const a = (g.yaw as number) * DEG;
  const dx = -Math.sin(a);
  const dz = -Math.cos(a);
  const rx = Math.cos(a);
  const rz = -Math.sin(a);
  const L = g.length as number;
  const half = (g.width as number) / 2;
  const x0 = g.x as number;
  const z0 = g.z as number;
  const mx = x0 + (dx * L) / 2;
  const mz = z0 + (dz * L) / 2;
  const s = Math.sign((towardX - mx) * rx + (towardZ - mz) * rz) || 1;
  // Which end is uphill: the wallride starts there and runs down.
  const upEnd = gyW(x0, z0) > gyW(x0 + dx * L, z0 + dz * L) ? 0 : L;
  const way = upEnd === 0 ? 1 : -1;
  const u = upEnd + way * WALLRIDE.before;
  const off = half + WALL_FOOT;
  const fx = x0 + dx * u + rx * s * off;
  const fz = z0 + dz * u + rz * s * off;
  const tx = dx * way;
  const tz = dz * way;
  const yaw = Math.atan2(-tx, -tz) / DEG;
  // The wall is to the quarter's right (1) or left (-1), seen along its way.
  const qrx = -tz;
  const qrz = tx;
  const side = Math.sign(-s * (rx * qrx + rz * qrz)) || 1;
  pushWorld({ type: 'quarter', x: r2(fx), z: r2(fz), yaw: r1(yaw), side, length, radius: WALLRIDE.radius, wallAngle: WALLRIDE.angle, deckWidth: WALLRIDE.deck, back: WALLRIDE.back, taper: WALLRIDE.taper, style: 'wall', color });
}

/** Wallrides on a column of buildings' open side (facing the frame's (x, d) spot): on up to `most` of them long enough for a full one with room past it. */
export function wallrides(segments: Segment[], openX: number, most: number, skip = 0): void {
  let n = 0;
  for (const [i, [d0, d1, color, g]] of segments.entries()) {
    if (i < skip || n >= most) continue;
    if (d1 - d0 - WALLRIDE.before - WALLRIDE.past < WALLRIDE.length) continue; // shorter ones end with the rider still on the wall, heading into it
    const [tx, tz] = W(openX, (d0 + d1) / 2);
    wallrideOn(g, tx, tz, color);
    n++;
  }
}

// ---------------------------------------------------------------- street furniture and small features
// Each maker lays one feature (or a small set) with its top end at (x, d)
// and returns how far down it reaches. Templates string them down a strip.
export type Maker = (x: number, d: number) => number;
/** How far (m) to one side of a strip's middle the bonks stand: the middle stays clear. */
export const OFF = 2.5;
let sideFlip = 1;
/** Set: every bonk goes to this side of its strip. */
export let towardSide: number | null = null;
export function setToward(s: number | null): void {
  towardSide = s;
}
const side = (): number => towardSide ?? (sideFlip = -sideFlip);

export const BENCH = { width: 0.5, height: 0.45, length: 2.4 };
export const PLANTER = { width: 1.2, height: 0.6, length: 3.2 };
export const BARRIER = { width: 0.6, height: 0.8, length: 10 };
export const CAR = { width: 1.8, length: 4.3, gap: 0.4, shape: [[0, 0.9], [1.0, 0.95], [1.5, 1.45], [2.9, 1.45], [3.4, 0.95], [4.3, 0.9]] as [number, number][] };
export const DUMPSTER = { width: 1.6, height: 1.3, length: 2.2 };
export const LEDGE = { width: 0.6, height: 0.5, length: 11, off: 4 };
export const KICK = { lip: 0.6, angle: 14, width: 2.6, side: 1.2 };
/** Height (m) of one stair: a set of n stairs drops n × this. */
export const STAIR = 0.18;

/** Stairs' width, where their handrails stand (across from the middle), how high, and how far they run along the plaza before the steps. */
const STAIRS_WIDE = 6;
const RAIL_V = STAIRS_WIDE / 2 - 0.3;
const HAND = 0.9;
const RUN_ON = 6;

/**
 * Two stair sets with a landing between, a kinked handrail down the whole
 * way (flat, down, flat, down, flat) on one side and a plain one on the other
 * for each set. Returns how far down it reaches.
 */
function doubleSet(x: number, d: number, n1: number, n2: number): number {
  const p = Math.max(4, pitchAt(x, d + 8));
  const h1 = n1 * STAIR;
  const h2 = n2 * STAIR;
  const len1 = Math.max(12, Math.min(22, h1 / Math.tan(p * DEG)));
  terrace(x, d, len1, 14, STAIRS_WIDE, { height: h1, handrails: false });
  const run1 = h1 / Math.tan(22 * DEG);
  const d2 = d + len1 + run1;
  const len2 = 7;
  terrace(x, d2, len2, 14, STAIRS_WIDE, { height: h2, handrails: false });
  const run2 = h2 / Math.tan(22 * DEG);
  const end = d2 + len2 + run2;
  // The kinked one, all the way down.
  rail([[x - RAIL_V, d + len1 - RUN_ON, HAND], [x - RAIL_V, d + len1, HAND], [x - RAIL_V, d2, HAND], [x - RAIL_V, d2 + len2, HAND], [x - RAIL_V, end, HAND], [x - RAIL_V, end + 2, HAND]], 'handrail');
  // Plain ones on the other side of each set.
  rail([[x + RAIL_V, d + len1 - RUN_ON, HAND], [x + RAIL_V, d + len1, HAND], [x + RAIL_V, d2, HAND], [x + RAIL_V, d2 + 1.5, HAND]], 'handrail');
  rail([[x + RAIL_V, d2 + len2 - 4, HAND], [x + RAIL_V, d2 + len2, HAND], [x + RAIL_V, end, HAND], [x + RAIL_V, end + 2, HAND]], 'handrail');
  return end - d + 3;
}

/**
 * A stair set of `n` stairs from a little plaza level on the slope, handrails
 * down both sides (or a hubba ledge down one side, or a kinked handrail over
 * two sets with a landing between). Returns how far down it reaches.
 */
function stairSet(x: number, d: number, n: number, o: { width?: number; hubba?: boolean } = {}): number {
  const p = Math.max(4, pitchAt(x, d + 8));
  const drop = n * STAIR;
  // The plaza: as long as the slope needs to stand `drop` m above it at its front, 12 to 26 m (its top
  // slopes down a little where the slope is steeper, or up a little to a big set on gentle ground).
  const length = Math.max(12, Math.min(26, drop / Math.tan(p * DEG)));
  const width = o.width ?? 14;
  const h = terrace(x, d, length, width, STAIRS_WIDE, { height: drop, handrails: false });
  const run = h / Math.tan(22 * DEG);
  // Handrails down both sides (one beside a hubba): flat along the plaza for RUN_ON m, down the steps, flat on the snow.
  for (const v of o.hubba ? [-RAIL_V] : [-RAIL_V, RAIL_V]) {
    rail([[x + v, d + length - RUN_ON, HAND], [x + v, d + length, HAND], [x + v, d + length + run, HAND], [x + v, d + length + run + 2, HAND]], 'handrail');
  }
  if (o.hubba) {
    // A hubba: a concrete ledge down beside the stairs, from the plaza's front edge to the foot.
    const v = 3.6;
    box('ledge', LEDGE.width, [[x + v, d + length - 2, 0.5], [x + v, d + length + 0.2, 0.5], [x + v, d + length + run + 0.4, 0.5], [x + v, d + length + run + 2.2, 0.25]]);
  }
  return length + run + 3;
}

export const makers: Record<string, Maker> = {
  kinkedRail: (x, d) => {
    slide('rail', x, d, SHAPES.doubleKink(14));
    return 14;
  },
  downRail: (x, d) => {
    slide('rail', x, d, SHAPES.flatDownFlatDown(16));
    return 16;
  },
  aFrame: (x, d) => {
    slide('rail', x, d, SHAPES.aFrame(12));
    return 12;
  },
  ledges: (x, d) => {
    box('ledge', LEDGE.width, [[x - LEDGE.off, d, 0], [x - LEDGE.off, d + 1.5, LEDGE.height], [x - LEDGE.off, d + LEDGE.length, LEDGE.height]]);
    box('ledge', LEDGE.width, [[x + LEDGE.off, d + 2, LEDGE.height], [x + LEDGE.off, d + LEDGE.length, LEDGE.height]]);
    return LEDGE.length;
  },
  planters: (x, d) => {
    box('planter', PLANTER.width, [[x - 2.2, d, PLANTER.height], [x - 2.2, d + PLANTER.length, PLANTER.height]]);
    box('planter', PLANTER.width, [[x + 2.2, d + 5, PLANTER.height], [x + 2.2, d + 5 + PLANTER.length, PLANTER.height]]);
    return 5 + PLANTER.length;
  },
  benches: (x, d) => {
    for (const [v, b] of [[-2, 0], [2, 3.5]] as const) box('bench', BENCH.width, [[x + v, d + b, BENCH.height], [x + v, d + b + BENCH.length, BENCH.height]]);
    return 3.5 + BENCH.length;
  },
  barriers: (x, d) => {
    const v = OFF * side();
    box('barrier', BARRIER.width, [[x + v, d, BARRIER.height], [x + v, d + BARRIER.length, BARRIER.height]]);
    return BARRIER.length;
  },
  cars: (x, d) => {
    const v = OFF * side();
    for (const at of [0, CAR.length + CAR.gap]) box('car', CAR.width, CAR.shape.map(([u, h]) => [x + v, d + at + u, h] as [number, number, number]));
    return 2 * CAR.length + CAR.gap;
  },
  dumpster: (x, d) => {
    const v = OFF * side();
    box('dumpster', DUMPSTER.width, [[x + v, d, DUMPSTER.height], [x + v, d + DUMPSTER.length, DUMPSTER.height]]);
    return DUMPSTER.length;
  },
  barrels: (x, d) => {
    const v = OFF * side();
    box('barrels', 1.4, [[x + v, d, 0.6], [x + v, d + 3, 0.6]]);
    return 3;
  },
  poleJam: (x, d) => {
    put(poleJam(x, d, 1.2, 25));
    return 3;
  },
  kickerRail: (x, d) => {
    const lipAt = (2 * KICK.lip) / Math.tan(KICK.angle * DEG);
    put({ type: 'kicker', ...xz(x, d), yaw: 0, width: KICK.width, sideWidth: KICK.side, lipHeight: KICK.lip, lipAngle: KICK.angle, natural: true });
    const a = d + lipAt + 1;
    rail([[x, a, KICK.lip], [x, a + 12, KICK.lip]]);
    return lipAt + 13;
  },
  stairs5: (x, d) => stairSet(x, d, 5),
  stairs8: (x, d) => stairSet(x, d, 8),
  stairs12: (x, d) => stairSet(x, d, 12, { width: 16 }),
  stairs16: (x, d) => stairSet(x, d, 16, { width: 16 }),
  stairs20: (x, d) => stairSet(x, d, 20, { width: 18 }),
  hubba: (x, d) => stairSet(x, d, 10, { hubba: true }),
  kinkSet: (x, d) => doubleSet(x, d, 8, 7),
  bigKinkSet: (x, d) => doubleSet(x, d, 12, 10),
  dropBank: (x, d) => {
    // Drop onto a bank: a plaza level on the slope, about 3.5 m above it at its front, no stairs; below its front wall a bank to land on.
    const p = Math.max(5, pitchAt(x, d + 8));
    const length = Math.max(10, Math.min(18, 3.5 / Math.tan(p * DEG)));
    const h = terrace(x, d, length, 14, 0);
    bank(x, d + length + 0.4, 0, 14, { height: Math.min(1.6, h * 0.45), back: 0.8, top: 1.2, angle: 26, side: 2 });
    return length + 10;
  },
};

/** Makers that lay something to pop onto (its end stands above the snow), which a rider must not meet straight off the feature before. */
const POP_ON = new Set(['planters', 'benches', 'barriers', 'barrels', 'ledges', 'cars', 'dumpster']);
/** Makers a rider comes off fast and airborne (stairs, drops): clear snow after them too. */
const LAUNCH = new Set(['stairs5', 'stairs8', 'stairs12', 'stairs16', 'stairs20', 'hubba', 'kinkSet', 'bigKinkSet', 'dropBank']);
/** Clear snow (m) before something to pop onto. */
export const CLEAR_BEFORE = 26;
/** Clear snow (m) after stairs or a drop before the next stairs or drop. */
export const AFTER_LAUNCH = 24;

/** Is there a building within 6 m either side of a strip at x, over the 30 m from d? */
function blockedAt(x: number, d: number): boolean {
  for (let u = -2; u <= 30; u += 3) {
    for (const v of [-6, -3, 0, 3, 6]) {
      const [px, pz] = W(x + v, d + u);
      if (insideBuilding(px, pz, 0.5) || keeps.at(px, pz, 0.5)?.what === 'wallride') return true;
    }
  }
  return false;
}

/** Lays makers down a strip from d0 to d1 at x, `gap` m apart (CLEAR_BEFORE before one to pop onto), as far as they fit. */
export function strip(x: number, d0: number, d1: number, list: string[], gap = 7, belowLaunch = false): void {
  let d = d0;
  let first = !belowLaunch;
  let afterLaunch = belowLaunch;
  for (const name of list) {
    const maker = makers[name];
    if (!maker) throw new Error(`no maker ${name}`);
    if ((!first || afterLaunch) && POP_ON.has(name)) d += Math.max(0, CLEAR_BEFORE - gap);
    // Off stairs or a drop a rider flies on and drifts a little across: room before the next plaza or drop.
    else if (afterLaunch && LAUNCH.has(name)) d += Math.max(0, AFTER_LAUNCH - gap);
    // Skip ahead past any building standing in the way.
    while (d + 18 <= d1 && blockedAt(x, d)) d += 4;
    if (d + 18 > d1) break;
    d += maker(x, d) + gap;
    first = false;
    afterLaunch = LAUNCH.has(name);
  }
}
