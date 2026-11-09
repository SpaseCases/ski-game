// Lays out the City and writes it to src/maps/city.json (milestone 16,
// reworked into a city on a hill). The map file is the source the game
// loads; this script is how it was authored. Edit here and rerun, from the
// repo root:
//   node tools/maps/city.ts
// Then check it: tools/maps/sinks.ts (stuck spots), tools/sim/features.ts
// (every jump, kicker, quarter, building, terrace and jib), tools/sim/face.ts
// (rides each run from the plaza to a finish), tools/sim/score.ts (its City
// section rides the named gaps and the wallrides), tools/maps/overview.ts.
// The building kit (frames, makers, buildings) is tools/maps/cityKit.ts.
//
// A snowed-in city on a hill, open to ride any way, like Freeride: the old
// town's walled plaza on the summit, and the city spilling down every side
// of the hill to four finish squares round its foot. Ring roads wind round
// the hill along the contours; radial streets wind down it from the plaza's
// gates, doubling at each ring as the city widens (8, then 16, then 32);
// between them are blocks of buildings, alleys, courtyards and stair streets.
// Headings follow the game's: 0 straight down from the start (south, here),
// +90 to its left (east), 180 behind (north), -90 right (west).
//   South: downtown, towers at the foot.
//   East: the rail quarter (the station, the elevated line, warehouses, the garage, a building site).
//   North: the old town spilling down (the cathedral, the viaduct, the funicular).
//   West: homes, the park and its frozen fountain, the church.

import { writeFileSync } from 'node:fs';
import { buildMap, generateTerrain } from '../../src/maps/build.ts';
import { parseMap } from '../../src/maps/loader.ts';
import type { Heightfield } from '../../src/maps/types.ts';
import { heightAt } from '../../src/sim/terrain.ts';
import * as K from './cityKit.ts';
import { DEG, out, r1, r2, type Json } from './cityKit.ts';

// ---------------------------------------------------------------- the hill
const SUMMIT = 300;
/** The walled plaza on the summit: level out to PLAZA m from the middle. */
const PLAZA = 50;
/** The ring roads: middle radius (m from the summit), width, and how far each winds in and out (3 times round). */
const RINGS = [
  { r: 152, width: 14, wind: 7, phase: 0.4 },
  { r: 278, width: 14, wind: 8, phase: 1.7 },
  { r: 412, width: 16, wind: 9, phase: 2.9 },
  // The boulevard round the foot, through the four finish squares.
  { r: 548, width: 20, wind: 6, phase: 4.2 },
];
/** The four faces: heading, name, and the pitch down each (sections out from the summit, as a spoke's). */
type FaceId = 'S' | 'E' | 'N' | 'W';
const FACES: Record<FaceId, { heading: number; name: string }> = {
  S: { heading: 0, name: 'Downtown' },
  E: { heading: 90, name: 'Rail quarter' },
  N: { heading: 180, name: 'Old town' },
  W: { heading: -90, name: 'Hillside homes' },
};
const sec = (length: number, pitch: number, ease = 30): Json => ({ length, pitch, ease });
const TOP = { length: PLAZA, pitch: 1, ease: 0 };
/** Where each face's finish square sits (m from the summit). */
const FOOT = 590;
const SPOKES: Json[] = [
  // Downtown: steep streets, then easing into the flatter towers at the foot.
  { name: 'Downtown', heading: 0, bend: 0, sharp: 0, sharpTo: 1, sections: [TOP, sec(40, 10, 20), sec(250, 14), sec(40, 10), sec(170, 6), sec(80, 2.5), sec(200, -9, 40)] },
  { name: 'Rail quarter', heading: 90, bend: 0, sharp: 0, sharpTo: 1, sections: [TOP, sec(40, 10, 20), sec(300, 13.5), sec(60, 8), sec(100, 5), sec(90, 2.5), sec(200, -9, 40)] },
  { name: 'Old town', heading: 180, bend: 0, sharp: 0, sharpTo: 1, sections: [TOP, sec(40, 11, 20), sec(350, 15), sec(60, 7), sec(40, 4), sec(90, 2.5), sec(200, -9, 40)] },
  { name: 'Hillside homes', heading: -90, bend: 0, sharp: 0, sharpTo: 1, sections: [TOP, sec(40, 10, 20), sec(380, 12.5), sec(70, 5), sec(100, 2.5), sec(200, -9, 40)] },
  // Spurs between the faces: a little less drop, so the foot of each side drains toward its own square.
  ...[45, 135, -135, -45].map((h) => ({ name: `Spur ${h}`, heading: h, bend: 0, sharp: 0.4, sharpTo: 500, sections: [TOP, sec(40, 9, 20), sec(330, 12), sec(140, 6), sec(60, 4), sec(200, -9, 40)] })),
];
/** How far the play area reaches out from the summit: past the finish squares on the faces, a little short of that on the spurs. */
function boundsPolygon(): Json[] {
  const pts: Json[] = [];
  for (let a = 0; a < 360; a += 3) {
    const toFace = Math.abs(((a + 45) % 90) - 45); // 0 on a face, 45 on a spur
    const r = 650 - 60 * Math.sin((toFace / 45) * (Math.PI / 2)) ** 2;
    pts.push({ x: r1(-Math.sin(a * DEG) * r), z: r1(-Math.cos(a * DEG) * r) });
  }
  return pts;
}
const ringR = (i: number, theta: number): number => {
  const g = RINGS[i]!;
  return g.r + g.wind * Math.sin(3 * theta * DEG + g.phase);
};
const polar = (theta: number, r: number): Json => ({ x: r1(-Math.sin(theta * DEG) * r), z: r1(-Math.cos(theta * DEG) * r) });

// ---------------------------------------------------------------- streets
// Radial streets wind down the hill from where they start (the plaza's
// gates, then each ring road): each swings `amp` m either way over `wave` m.
interface Street {
  theta: number;
  from: number;
  width: number;
  amp: number;
  wave: number;
  main: boolean;
}
const streets: Street[] = [];
for (let k = 0; k < 8; k++) streets.push({ theta: k * 45, from: PLAZA, width: 16, amp: k % 2 === 0 ? 5 : 9, wave: 300, main: true });
for (let k = 0; k < 8; k++) streets.push({ theta: 22.5 + k * 45, from: RINGS[0]!.r, width: 12, amp: k % 2 === 0 ? -8 : 8, wave: 240, main: false });
for (let k = 0; k < 16; k++) streets.push({ theta: 11.25 + k * 22.5, from: RINGS[2]!.r, width: 10, amp: k % 2 === 0 ? 6 : -6, wave: 200, main: false });
/** A street's heading (degrees) from the summit at r. */
const streetAt = (s: Street, r: number): number => s.theta + (s.amp * Math.sin((2 * Math.PI * Math.max(0, r - s.from)) / s.wave)) / Math.max(r, 1) / DEG;
const streetPoints = (s: Street, r0: number, r1: number, step = 6): Json[] => {
  const pts: Json[] = [];
  for (let r = r0; r <= r1 + 1e-6; r += step) pts.push(polar(streetAt(s, r), r));
  return pts;
};
/** Sidewalk (m) between a street's edge and the buildings. */
const WALK = 2;

const elements: Json[] = [];
// The summit plaza, level.
elements.push({ type: 'flat', x: 0, z: 0, heading: 0, pitch: 0, radius: PLAZA, blend: 14 });
// The ring roads: roads cut level across the hill (but for a little crossfall), banks back to the slope.
RINGS.forEach((g, i) => {
  const pts: Json[] = [];
  for (let a = 0; a <= 366; a += 3) pts.push(polar(a, ringR(i, a)));
  elements.push({ type: 'track', points: pts, width: g.width, bank: 6, smooth: 36, crossfall: 0.3, taper: 0 });
});
// The four finish squares: broad and nearly level.
for (const f of Object.values(FACES)) {
  elements.push({ type: 'flat', ...polar(f.heading, FOOT), heading: f.heading, pitch: 2, width: 150, length: 90, blend: 60 });
}

// The old town's sunken street: the North street cut 6 m into the hill where the viaduct crosses it.
const VIADUCT = { r: 345, span: 40, pier: 7, width: 7, height: 0.3 };
{
  const s = streets.find((t) => t.main && t.theta === 180)!;
  elements.push({ type: 'gully', points: streetPoints(s, VIADUCT.r - 48, VIADUCT.r + 48, 4), floor: 10, depth: 6, wall: 4, taper: 40 });
}

const terrain = {
  type: 'peak',
  // Wide, so the far stand-in of the ground (render/backdrop.ts, round the heightfield's middle) reaches past the whole city: the skyline stands on it.
  size: 2200,
  cellSize: 4,
  summit: SUMMIT,
  spokes: SPOKES,
  roll: { amplitude: 1.2, wavelength: 120 },
  relief: { amplitude: 2.5, wavelength: 260 },
  elements,
  bounds: boundsPolygon(),
  rim: { inset: 40, ramp: 50, rise: 0.35, ease: 260 },
  rockSlope: 60,
  noise: 0.06,
  rockNoise: 0,
  seed: 16,
};
const DUMMY = { spawn: { x: 0, z: 0, heading: 0 }, flags: [], finishes: [{ x: 0, z: 0, heading: 0, width: 1, length: 1 }], colors: { sky: '#000000', fog: '#000000' } };
const ground: Heightfield = generateTerrain(parseMap({ name: 'City', terrain, features: [], ...DUMMY }).terrain);
K.setGround(ground);
const gw = (x: number, z: number): number => heightAt(ground, x, z);

// ---------------------------------------------------------------- blocks
type Line = [number, number][];
interface Block {
  face: FaceId;
  /** 0 the old town inside the first ring, then 1, 2, 3 out to the boulevard. */
  band: number;
  /** Heading (degrees) of its middle at its top. */
  theta: number;
  /** Its top and bottom (m from the summit) and depth. */
  r0: number;
  r1: number;
  depth: number;
  /** Half its width (m) at d down it, to the sidewalks. */
  hw: (d: number) => number;
  frame: K.Frame;
  /** Its open line, for its run. */
  line?: Line;
}
const faceOf = (theta: number): FaceId => {
  const a = (((theta + 45) % 360) + 360) % 360;
  return (['S', 'E', 'N', 'W'] as const)[Math.floor(a / 90)]!;
};
const BAND_EDGES = [PLAZA + 9, ...RINGS.map((g) => g.r)];
const blocks: Block[] = [];
for (let band = 0; band < 4; band++) {
  const inner = BAND_EDGES[band]!;
  const here = streets.filter((s) => s.from <= inner + 1).sort((a, b) => a.theta - b.theta);
  for (let i = 0; i < here.length; i++) {
    const R = here[i]!;
    const L = here[(i + 1) % here.length]!;
    const lift = L.theta < R.theta ? 360 : 0;
    const left = (r: number): number => streetAt(L, r) + lift;
    const right = (r: number): number => streetAt(R, r);
    // Top and bottom: clear of the ring roads (they wind) across the whole block.
    let r0 = band === 0 ? inner : -Infinity;
    let r1 = Infinity;
    for (let t = 0; t <= 1; t += 0.05) {
      const a = R.theta + (L.theta + lift - R.theta) * t;
      if (band > 0) r0 = Math.max(r0, ringR(band - 1, a) + RINGS[band - 1]!.width / 2 + 3 + WALK);
      r1 = Math.min(r1, ringR(band, a) - RINGS[band]!.width / 2 - 3 - WALK);
    }
    const mid = (r: number): number => (left(r) + right(r)) / 2;
    const hw = (d: number): number => {
      const r = r0 + d;
      return (r * (left(r) - right(r)) * DEG) / 2 - Math.max(L.width, R.width) / 2 - WALK;
    };
    const frame: K.Frame = (x, d) => {
      const r = r0 + d;
      const t = (mid(r) - x / r / DEG) * DEG;
      return [-Math.sin(t) * r, -Math.cos(t) * r];
    };
    const theta = mid(r0);
    blocks.push({ face: faceOf(theta), band, theta, r0, r1, depth: r1 - r0, hw, frame });
  }
}

// ---------------------------------------------------------------- block templates
// Each lays a block in its own frame (x across from its middle, d down from
// its top) and returns its open line for the runs. A column of buildings
// follows a street's edge (`edgeX`), so it curves with the street.
const edgeX = (b: Block, side: -1 | 1, inset: number): ((d: number) => number) => (d) => side * (b.hw(d) - inset);
const STYLE_COLORS: Record<FaceId, readonly string[]> = { S: K.BLOCK_COLORS, E: K.BRICK_COLORS, N: K.OLD_COLORS, W: K.BLOCK_COLORS };

/** How tall (eave, m) the buildings nobody rides stand: by band (out from the summit) and face. */
function tallFor(b: Block): number {
  const base = b.face === 'S' ? [7, 9, 12, 16][b.band]! : b.face === 'N' ? [6, 7, 8, 9][b.band]! : [6, 8, 9, 10][b.band]!;
  return base + K.rand() * (b.face === 'S' ? 3 + 2 * b.band : 3);
}

/** Is a building from d to d + len down the line x, `width` across, clear of other buildings and of features' clear zones? */
function clearFor(x: K.X, d: number, len: number, width: number): boolean {
  for (let u = 0; u <= len + 1e-6; u += len / Math.ceil(len / 2.5)) {
    const cx = K.xAt(x, d + u);
    for (let v = -width / 2; v <= width / 2 + 1e-6; v += width / Math.ceil(width / 2.5)) {
      const [px, pz] = K.W(cx + v, d + u);
      if (K.insideBuilding(px, pz, 0.6) || K.inKeep(px, pz, 0.3)) return false;
    }
  }
  return true;
}

/** A column of buildings nobody rides down one side of a block, alleys between; returns their spans and colors. */
function column(b: Block, side: -1 | 1, width: number, d0: number, d1: number, o: { gap?: number; min?: number; max?: number; shops?: boolean; colors?: readonly string[]; inset?: number; middle?: number } = {}): K.Segment[] {
  const out: K.Segment[] = [];
  let d = d0;
  const gap = o.gap ?? 6;
  const inset = o.inset ?? 0;
  const x = edgeX(b, side, inset + width / 2);
  while (d < d1 - 10) {
    const len = Math.min(d1 - d, K.between(o.min ?? 18, o.max ?? 32));
    if (len < 10) break;
    // Leave the block's middle open (`middle` m across) all along the building, and keep off other buildings and features' clear zones.
    if (Math.min(b.hw(d), b.hw(d + len)) - inset - width < (o.middle ?? 0) / 2 || !clearFor(x, d, len, width)) {
      d += 4;
      continue;
    }
    const color = K.pick(o.colors ?? STYLE_COLORS[b.face]);
    const sign = o.shops && K.rand() < 0.6 ? K.pick(K.SHOP_SIGNS) : '';
    const g = K.highrise(x, d, len, width, tallFor(b), 'block', color, side < 0 ? 'E' : 'W', sign);
    out.push([d, d + len, color, g]);
    // Mostly attached (a party wall between neighbors), now and then an alley.
    d += len + (o.gap !== undefined ? gap : K.rand() < 0.35 ? 6 : 0.8);
  }
  return out;
}

/** Inner rows where the block is wide: buildings backing onto the edge column across a service alley (wallrides on the alley's walls). */
const ALLEY = 7;
function pack(b: Block, outer: number, d0: number, d1: number, middle = 24): void {
  for (const side of [-1, 1] as const) {
    const w = K.between(12, 18);
    column(b, side, w, d0, d1, { inset: outer + ALLEY, middle, min: 24, max: 46, gap: 5, shops: true });
  }
}

/** Roof rows: rideable shops whose flat roofs step down the block from a drift, with an alley gap; returns where the row ends. */
const ROOF_GAP = { alley: 5, points: 250 };
function roofRow(b: Block, side: -1 | 1, d0: number, d1: number, o: { gapName?: string; colors?: readonly string[]; w?: number } = {}): number {
  const w = o.w ?? 12;
  const x = edgeX(b, side, w / 2);
  const door: K.Side = side < 0 ? 'W' : 'E';
  // Each roof lower than the last; the last one onto a landing drift. As many as fit, the last given the landing drift.
  // The lip roof is 16 m: a ride from 12 m back on it (tools/sim/score.ts) starts past the step down onto it. So are
  // the roofs after it: the last is ridden (tools/sim/features.ts) from 15 m back, on the roof before it.
  const lengths = [14, 16, 16, 16, 14];
  const eaves = [4.4, 4.0, 3.4, 2.8, 2.4];
  const APRON = 12;
  const DRIFT = 13;
  const spots = (alley: boolean): number[] => {
    const at: number[] = [];
    let d = d0 + DRIFT;
    for (let i = 0; i < lengths.length; i++) {
      at.push(d);
      d += lengths[i]! + (i === 1 && alley ? ROOF_GAP.alley : 0);
    }
    return at;
  };
  const fit = (at: number[]): number => {
    let n = lengths.length;
    while (n > 1 && at[n - 1]! + lengths[n - 1]! + APRON > d1) n--;
    return n;
  };
  // With a named gap, it needs two roofs past the alley (the last is ridden from the one before it); without one, no alley.
  let at = spots(o.gapName !== undefined);
  let n = fit(at);
  const gap = o.gapName !== undefined && n >= 4;
  if (!gap) {
    at = spots(false);
    n = fit(at);
  }
  const laid: Json[] = [];
  for (let i = 0; i < n; i++) {
    const extra: Json = i === 0 ? { drift: DRIFT } : {};
    if (i === 1 && gap) extra.lip = 0.45;
    if (i === n - 1) extra.apron = APRON;
    const g = K.shop(x, at[i]!, { length: lengths[i]!, width: w, eave: eaves[i]!, roof: 'flat', style: 'shop', color: K.pick(o.colors ?? K.SHOP_COLORS), front: K.front(door, 0), sign: K.rand() < 0.7 ? K.pick(K.SHOP_SIGNS) : '', ...extra });
    if (!g) break;
    laid.push(g);
  }
  if (gap && laid.length >= 3) {
    // From the last 7 m of the lip roof to the roofs past the alley and the landing drift: on the roofs as laid.
    const lip = laid[1]!;
    out.gaps.push({ name: o.gapName, from: roofRect(lip, lengths[1]! - 7, lengths[1]! + 0.2, 0), to: [...roofRect(laid[2]!, 0, (laid[2]!.length as number) + 16, 1)], points: ROOF_GAP.points });
  }
  return laid.length ? at[laid.length - 1]! + lengths[laid.length - 1]! + APRON : d0;
}
/** A rectangle on a laid building's roof (world): from u0 to u1 along it, `pad` m wider than it either side. */
function roofRect(g: Json, u0: number, u1: number, pad: number): Json[] {
  const a = (g.yaw as number) * DEG;
  const dx = -Math.sin(a);
  const dz = -Math.cos(a);
  const half = (g.width as number) / 2 + pad;
  const p = (u: number, v: number): Json => ({ x: r1((g.x as number) + dx * u - dz * v), z: r1((g.z as number) + dz * u + dx * v) });
  return [p(u0, -half), p(u0, half), p(u1, half), p(u1, -half)];
}
const xAt = K.xAt;

/** A stair street: columns of buildings either side, stair sets and rails down the middle. */
function stairStreet(b: Block): Line {
  column(b, -1, 18, 6, b.depth - 4, { shops: true, min: 24, max: 44 });
  const right = column(b, 1, 18, 12, b.depth - 4, { shops: true, min: 24, max: 44 });
  K.wallrides(right, 0, 1);
  pack(b, 18, 8, b.depth - 4);
  K.strip(0, 6, b.depth - 4, K.pick([
    ['stairs8', 'planters', 'kinkSet', 'ledges', 'stairs5', 'kinkedRail'],
    ['stairs12', 'ledges', 'hubba', 'benches', 'stairs20', 'barriers'],
    ['hubba', 'planters', 'stairs16', 'benches', 'bigKinkSet'],
    ['bigKinkSet', 'ledges', 'stairs12', 'planters', 'stairs5'],
  ]), 6);
  return [[0, 2], [0, b.depth - 2]];
}

/** Roofs down one side (a roof row with an alley gap), buildings down the other, a courtyard of features between. */
function rooftops(b: Block, gapName?: string): Line {
  const s: -1 | 1 = K.rand() < 0.5 ? -1 : 1;
  roofRow(b, s, 0, b.depth - 2, { gapName, colors: b.face === 'N' ? K.OLD_COLORS : K.SHOP_COLORS });
  const other = column(b, (-s) as -1 | 1, 16, 8, b.depth - 4, { shops: true, min: 24, max: 44 });
  K.wallrides(other, s * 4, 1);
  column(b, (-s) as -1 | 1, 14, 8, b.depth - 4, { inset: 16 + ALLEY, middle: 30, min: 22, max: 40 });
  const cx = s * 4;
  K.strip(cx, 8, b.depth - 6, K.pick([
    ['kinkedRail', 'planters', 'ledges', 'benches', 'downRail', 'barriers', 'poleJam'],
    ['ledges', 'kickerRail', 'planters', 'aFrame', 'benches', 'dropBank', 'barrels'],
  ]));
  return [[cx, 2], [cx, b.depth - 2]];
}

/** An alley: two columns of mid-rises, a wide alley between with wallrides on both walls. */
function alley(b: Block): Line {
  // The alley stays at least 30 m wide: room to ride into the wallrides from either side of the features down its middle.
  const w = Math.max(10, Math.min(28, b.hw(0) - 15));
  const west = column(b, -1, w, 4, b.depth - 4, { gap: 8, min: 36, max: 50, shops: true });
  const east = column(b, 1, w, 4, b.depth - 4, { gap: 8, min: 36, max: 50, shops: true });
  K.wallrides(west, 0, 2);
  K.wallrides(east, 0, 1, 1);
  K.strip(0, 30, b.depth - 6, K.pick([['barriers', 'poleJam', 'kinkedRail'], ['dumpster', 'downRail', 'barriers'], ['cars', 'aFrame', 'dumpster']]), 18);
  return [[0, 2], [0, b.depth - 2]];
}

/** A courtyard: an open block of trees, benches, planters, rails and drops; buildings at its bottom corners. */
function courtyard(b: Block): Line {
  const D = b.depth;
  K.highrise(edgeX(b, -1, 10), D - 40, 36, 20, tallFor(b), 'block', K.pick(STYLE_COLORS[b.face]), 'W', K.pick(K.SHOP_SIGNS));
  K.highrise(edgeX(b, 1, 10), D - 40, 36, 20, tallFor(b), 'block', K.pick(STYLE_COLORS[b.face]), 'E', K.pick(K.SHOP_SIGNS));
  for (const side of [-1, 1] as const) column(b, side, 12, 4, D - 46, { shops: true, min: 14, max: 22, gap: 4, middle: 40 });
  K.strip(-12, 8, D - 44, K.pick([['benches', 'kinkedRail', 'planters', 'dropBank'], ['planters', 'downRail', 'benches', 'ledges']]));
  K.strip(12, 14, D - 44, K.pick([['ledges', 'planters', 'aFrame', 'benches'], ['dropBank', 'benches', 'kinkedRail', 'planters']]));
  K.strip(0, D - 40, D - 2, ['stairs8', 'planters']);
  // Trees in a bed down the middle.
  const spots: Json[] = [];
  for (let d = 14; d < D - 48; d += 9) spots.push(...K.poly([[0, d]]));
  trees(spots, 300 + out.decor.length, 0.7, 1.1);
  return [[-12, 2], [-12, D - 46], [0, D - 40], [0, D - 2]];
}

/** Tree spots clear of every building and every feature's clear zone (3 m round each). */
const treesClear = (spots: Json[]): Json[] => spots.filter((p) => !K.insideBuilding(p.x as number, p.z as number, 3) && !K.inKeep(p.x as number, p.z as number, 3));
/** Adds a set of trees (if any spots are left clear). */
function trees(spots: Json[], seed: number, min: number, max: number): void {
  const clear = treesClear(spots);
  if (clear.length > 0) out.decor.push({ kind: 'pine', spots: clear, seed, minScale: min, maxScale: max, solid: true });
}

/** Houses: two columns of gable-roofed houses (ridden like Freeride's chalets: up a drift, off the ridge, onto a landing drift), a lane between. */
function houses(b: Block): Line {
  for (const side of [-1, 1] as const) {
    const x = edgeX(b, side, 7);
    // Ridden like Freeride's chalets, except out on the easing foot of the hill (a pop off the ridge there flies past the landing drift).
    const ride = b.band < 3;
    for (let d = 14; d + 10 + 12 + 20 < b.depth; d += 58) {
      K.shop(x, d + 10, { length: 12, width: 11, eave: 3, roof: 'gable', rise: 2.2, drift: ride ? 12 : 0, apron: ride ? 20 : 0, style: 'chalet', color: K.pick(K.HOUSE_COLORS), front: K.front(side < 0 ? 'E' : 'W', 0), chimney: false });
    }
  }
  // A second row of houses where the block is wide.
  for (const side of [-1, 1] as const) {
    for (let d = 40; d + 10 + 12 + 20 < b.depth; d += 58) {
      if (b.hw(d) < 52 || !clearFor(edgeX(b, side, 26), d - 12, 54, 13)) continue;
      K.shop(edgeX(b, side, 26), d + 10, { length: 12, width: 11, eave: 3.2, roof: 'gable', rise: 2.4, drift: b.band < 3 ? 12 : 0, apron: b.band < 3 ? 20 : 0, style: 'chalet', color: K.pick(K.HOUSE_COLORS), front: K.front(side < 0 ? 'W' : 'E', 0), chimney: false });
    }
  }
  const spots: Json[] = [];
  for (let d = 20; d < b.depth - 10; d += 17) for (const s of [-1, 1]) spots.push(...K.poly([[s * (b.hw(d) - 16), d]]));
  trees(spots, 400 + out.decor.length, 0.7, 1.2);
  K.strip(0, 10, b.depth - 4, K.pick([['benches', 'kinkedRail', 'stairs5', 'planters'], ['poleJam', 'cars', 'downRail'], ['planters', 'aFrame', 'stairs8']]), 10);
  return [[0, 2], [0, b.depth - 2]];
}

/** Warehouses: long flat-roofed sheds up drifts (the roof is a long cruise with a gap to the next), a yard of features between. */
function warehouses(b: Block): Line {
  const s: -1 | 1 = K.rand() < 0.5 ? -1 : 1;
  const w = Math.min(22, b.hw(0) - 6);
  const x = edgeX(b, s, w / 2);
  let d = 4;
  let eave = 5.2;
  while (d + 14 + 20 + 12 < b.depth) {
    const len = Math.min(b.depth - d - 14 - 12, K.between(28, 40));
    if (len < 20) break;
    K.shop(x, d + 14, { length: len, width: w, eave, roof: 'flat', drift: 14, apron: 12, style: 'shop', color: K.pick(K.BRICK_COLORS), front: K.front(s < 0 ? 'E' : 'W', 0), sign: K.rand() < 0.4 ? 'Freight' : '' });
    d += 14 + len + 12 + 18;
    eave = Math.max(4, eave - 0.4);
  }
  const other = column(b, (-s) as -1 | 1, 16, 6, b.depth - 4, { colors: K.BRICK_COLORS, min: 26, max: 44 });
  K.wallrides(other, -s * 2, 1);
  column(b, (-s) as -1 | 1, 16, 6, b.depth - 4, { colors: K.BRICK_COLORS, inset: 16 + ALLEY, middle: 28 });
  const cx = -s * 2;
  K.strip(cx, 8, b.depth - 4, K.pick([['barrels', 'kickerRail', 'dumpster', 'downRail'], ['barriers', 'poleJam', 'cars', 'kinkedRail'], ['dumpster', 'aFrame', 'barrels', 'dropBank']]));
  return [[cx, 2], [cx, b.depth - 2]];
}

/** Downtown: a glass tower at the back of the block, its plaza beside it (stairs and handrails down its front), a mid-rise above. */
let towersLaid = 0;
function towerBlock(b: Block): Line {
  const s: -1 | 1 = K.rand() < 0.5 ? -1 : 1;
  // Narrow enough to leave the plaza room on its other side.
  const tw = Math.min(26, b.hw(40) - 12);
  // The first two downtown towers are the twisted glass one and the art-deco one; the rest glass, now and then another of either.
  const look = towersLaid === 0 ? 0.9 : towersLaid === 1 ? 0.7 : K.rand();
  towersLaid++;
  K.highrise(edgeX(b, s, tw / 2), 36, Math.min(40, b.depth - 40), tw, 40 + K.rand() * 60, look < 0.6 ? 'tower' : look < 0.8 ? 'deco' : 'twist', look < 0.6 || look >= 0.8 ? K.pick(K.TOWER_COLORS) : K.pick(['#c9b48e', '#b9a27e', '#d0c4ac']), s < 0 ? 'E' : 'W');
  const px = -s * Math.max(4, b.hw(30) - 22);
  K.highrise(edgeX(b, s, 12), 4, 26, 24, tallFor(b), 'block', K.pick(K.BLOCK_COLORS), s < 0 ? 'E' : 'W', K.pick(K.SHOP_SIGNS));
  const run = 36;
  const h = K.terrace(px, run, 22, 20, 8);
  K.box('ledge', K.LEDGE.width, [[px - 8, run + 3, K.LEDGE.height], [px - 8, run + 18, K.LEDGE.height]]);
  const below = run + 22 + h / Math.tan(22 * DEG) + 6;
  K.strip(px, below, b.depth - 4, K.pick([['kinkedRail', 'planters', 'barriers'], ['ledges', 'benches', 'downRail']]), 7, true);
  K.strip(0, 6, 30, ['benches']);
  column(b, (-s) as -1 | 1, 16, 34, b.depth - 4, { inset: 0, min: 24, max: 36, middle: 30 });
  return [[0, 2], [0, 30], [px, run - 4], [px, b.depth - 2]];
}

/** The old town: crooked lanes of small houses (rideable roofs stepping down), a stair lane in the middle. */
function oldTown(b: Block): Line {
  // Small houses along both edges: rideable shed roofs following the slope.
  for (const side of [-1, 1] as const) {
    const w = 9;
    const x = edgeX(b, side, w / 2);
    // The first house's drift starts clear of the plaza's wall above.
    // A row of up to five roofs, each lower than the last (a hop over a narrow lane now and then), the last onto a landing drift.
    // Its drift (13 m, as gentle as the first City's) starts clear of the plaza's wall above.
    let d = 27;
    const eaves = [4.6, 4.2, 3.8, 3.4, 3.0];
    for (const [i, eave] of eaves.entries()) {
      // 16 m or so: the last is ridden (tools/sim/features.ts) from 15 m back, on the house before it.
      const len = K.between(15.5, 17);
      const last = i === eaves.length - 1 || d + len + 10 + 17 > b.depth;
      if (d + len + 10 > b.depth || b.hw(d) < 10) break;
      if (!K.shop(x, d, { length: len, width: w, eave, roof: 'flat', style: 'shop', color: K.pick(K.OLD_COLORS), front: K.front(side < 0 ? 'E' : 'W', 0), sign: K.rand() < 0.5 ? K.pick(K.SHOP_SIGNS) : '', drift: i === 0 ? 13 : 0, apron: last ? 10 : 0 })) break;
      // Now and then a hop over a narrow lane, never just before the last roof (ridden from the one before it).
      const nextLast = i + 1 === eaves.length - 1 || d + len + 2.5 + 17 + 10 + 17 > b.depth;
      d += len + (!nextLast && K.rand() < 0.3 ? 2.5 : 0);
      if (last) break;
    }
  }
  column(b, -1, 10, 16, b.depth - 4, { inset: 9 + 5, middle: 24, min: 12, max: 20, gap: 4, colors: K.OLD_COLORS });
  column(b, 1, 10, 20, b.depth - 4, { inset: 9 + 5, middle: 24, min: 12, max: 20, gap: 4, colors: K.OLD_COLORS });
  K.strip(0, 10, b.depth - 4, K.pick([['stairs5', 'planters', 'stairs8', 'benches'], ['hubba', 'barrels', 'stairs5'], ['kinkedRail', 'stairs8', 'planters']]), 6);
  return [[0, 2], [0, b.depth - 2]];
}

/** Which template each block gets: by face and band, a few named gaps placed in particular blocks. */
const tpl = random0(23);
function random0(seed: number): () => number {
  return K.random(seed);
}
const GAP_NAMES: Record<string, string> = {
  // (N1's middle block holds the cathedral.)
  'N2': 'Old town alley gap',
  'S2': 'Market alley gap',
  'E2': 'Freight alley gap',
  'W1': 'Hillside alley gap',
};
const usedGap = new Set<string>();
function template(b: Block): (b: Block) => Line {
  const own = special.get(b);
  if (own) return own;
  const key = `${b.face}${b.band}`;
  const r = tpl();
  if (b.band === 0) return oldTown;
  if (GAP_NAMES[key] && !usedGap.has(key)) {
    usedGap.add(key);
    return (bb) => rooftops(bb, GAP_NAMES[key]);
  }
  switch (b.face) {
    case 'S':
      if (b.band === 3) return towerBlock;
      return r < 0.35 ? stairStreet : r < 0.6 ? alley : r < 0.8 ? rooftops : courtyard;
    case 'E':
      return r < 0.45 ? warehouses : r < 0.65 ? alley : r < 0.85 ? stairStreet : rooftops;
    case 'N':
      return r < 0.45 ? oldTown : r < 0.7 ? stairStreet : r < 0.85 ? rooftops : courtyard;
    case 'W':
      return r < 0.5 ? houses : r < 0.7 ? courtyard : r < 0.85 ? stairStreet : rooftops;
  }
}
/**
 * Packs what's left of a block with buildings (5 m alleys between them):
 * anywhere clear of its open line, its features and the buildings, drifts
 * and landing drifts already there.
 */
const CORRIDOR = 5;
const REJ = { corridor: 0, building: 0, feature: 0, placed: 0, width: 0 };
function infill(b: Block, from: number): void {
  const line = b.line!;
  const lineX = (d: number): number => {
    for (let i = 1; i < line.length; i++) {
      const [x0, d0] = line[i - 1]!;
      const [x1, d1] = line[i]!;
      if (d <= d1 || i === line.length - 1) return x0 + (x1 - x0) * Math.min(1, Math.max(0, (d - d0) / Math.max(1e-6, d1 - d0)));
    }
    return line[0]![0];
  };
  const style = b.face;
  for (let d = 6; d < b.depth - 12; d += 3) {
    for (let x = -b.hw(d) + 2; x < b.hw(d) - 8; x += 3) {
      const len = b.face === 'W' ? K.between(12, 16) : K.between(14, 26);
      const w = b.face === 'W' ? K.between(10, 13) : b.face === 'N' ? K.between(9, 13) : K.between(11, 17);
      const cx = x + w / 2;
      if (d + len > b.depth - 4) continue;
      if (cx + w / 2 > Math.min(b.hw(d), b.hw(d + len)) || cx - w / 2 < -Math.min(b.hw(d), b.hw(d + len))) { REJ.width++; continue; }
      let ok = true;
      for (let u = 0; u <= len && ok; u += len / 3) if (Math.abs(cx - lineX(d + u)) < w / 2 + CORRIDOR) ok = false;
      if (!ok) { REJ.corridor++; continue; }
      const samples: [number, number][] = [];
      for (let u = 0; u <= len + 1e-6; u += len / Math.ceil(len / 2.5)) for (let v = -w / 2; v <= w / 2 + 1e-6; v += w / Math.ceil(w / 2.5)) samples.push(K.W(cx + v, d + u));
      if (samples.some(([px, pz]) => K.insideBuilding(px, pz, 1.2))) { REJ.building++; continue; }
      if (samples.some(([px, pz]) => K.inKeep(px, pz, 0.5))) { REJ.feature++; continue; }
      REJ.placed++;
      if (style === 'W' && K.rand() < 0.7) {
        K.shop(cx, d, { length: len - 4, width: w, eave: 3, roof: 'gable', rise: 2.2, style: 'chalet', color: K.pick(K.HOUSE_COLORS), front: K.front(K.rand() < 0.5 ? 'E' : 'W', 0) });
      } else if (K.rand() < 0.35) {
        K.shop(cx, d, { length: len, width: w, eave: K.between(3.2, 5), roof: 'flat', style: 'shop', color: K.pick(style === 'N' ? K.OLD_COLORS : K.SHOP_COLORS), front: K.front(K.rand() < 0.5 ? 'E' : 'W', 0), sign: K.pick(K.SHOP_SIGNS) });
      } else {
        K.highrise(cx, d, len, w, tallFor(b), 'block', K.pick(STYLE_COLORS[style]), K.rand() < 0.5 ? 'E' : 'W', K.rand() < 0.4 ? K.pick(K.SHOP_SIGNS) : '');
      }
      x += w + 0.6;
    }
  }
}
// ---------------------------------------------------------------- landmarks
// A few blocks get a landmark of their own instead of a template; the
// structures that span streets (the viaduct over the old town's sunken
// street) go in first, their clear zones keeping the blocks off them.
const angleOff = (a: number, b: number): number => Math.abs(((((a - b) % 360) + 540) % 360) - 180);
const blockNear = (theta: number, band: number): Block => blocks.filter((b) => b.band === band).sort((p, q) => angleOff(p.theta, theta) - angleOff(q.theta, theta))[0]!;
const special = new Map<Block, (b: Block) => Line>();
/** Landmark blocks left as laid out (no packing): the park. */
const open = new Set<Block>();
/** A street's own frame: x across from its middle (+x to the right going down), d down from r0. */
const streetFrame = (s: Street, r0: number): K.Frame => (x, d) => {
  const r = r0 + d;
  const t = (streetAt(s, r) - x / r / DEG) * DEG;
  return [-Math.sin(t) * r, -Math.cos(t) * r];
};
const mainStreet = (theta: number): Street => streets.find((s) => s.main && angleOff(s.theta, theta) < 1)!;

/** A landmark down the middle of a block, a stair set below its front, rows of buildings down both sides. */
function landmarkBlock(o: { len: number; width: number; eave: number; style: string; color: string; from?: number; stairs?: string; colors?: readonly string[]; sign?: string }): (b: Block) => Line {
  return (b) => {
    const from = o.from ?? 14;
    const w = Math.min(o.width, 2 * Math.min(b.hw(from), b.hw(from + o.len)) - 26);
    K.highrise(0, from, o.len, w, o.eave, o.style, o.color, 'S', o.sign ?? '');
    // Room behind the stairs' plaza for a run-up (features.ts rides it from 8 m back).
    const foot = from + o.len + 10;
    const reach = o.stairs ? K.makers[o.stairs]!(0, foot) : 0;
    for (const side of [-1, 1] as const) column(b, side, 12, 4, b.depth - 4, { colors: o.colors ?? STYLE_COLORS[b.face], middle: w + 16, shops: true });
    const by = w / 2 + 4;
    return [[by, 2], [by, foot - 6], [0, foot - 1], [0, Math.min(b.depth - 2, foot + reach + 2)], [0, b.depth - 2]];
  };
}

// The cathedral at the top of the old town: its nave down the block, two spires over its front, a grand set of twenty stairs below.
special.set(blockNear(180, 1), landmarkBlock({ len: 44, width: 32, eave: 15, style: 'church', color: '#cfc2a4', from: 12, stairs: 'stairs20', colors: K.OLD_COLORS }));
// A parish church among the hillside homes.
special.set(blockNear(-78.75, 1), landmarkBlock({ len: 30, width: 18, eave: 10, style: 'church', color: '#d8cbb0', stairs: 'stairs8' }));
// The domed civic hall over downtown's square, a broad stair set down its front.
special.set(blockNear(5.6, 3), landmarkBlock({ len: 36, width: 30, eave: 13, style: 'civic', color: '#d9cfb8', stairs: 'stairs12', sign: '' }));
// The train station in the rail quarter, under its arched roof, its stairs down to the boulevard.
special.set(blockNear(95.6, 3), (b) => {
  const line = landmarkBlock({ len: 52, width: 30, eave: 8, style: 'depot', color: '#8a4f3d', from: 10, stairs: 'stairs12', colors: K.BRICK_COLORS })(b);
  out.decor.push({ kind: 'waterTower', points: K.poly([[-(b.hw(20) - 6), 8]]), heading: r1(K.downAt(0, 8)) });
  return line;
});

// The parking garage and the Garage gap: up a long drift onto its top deck, off its lip over an alley onto a lower roof that slopes to a landing drift.
const GARAGE = { drift: 28, roof: 24, width: 18, eave: 7, lip: 0.6, gap: 8, lower: 20, lowEave: 3.2, lowRise: 1.2, apron: 16, points: 600 };
special.set(blockNear(78.75, 2), (b) => {
  const g = GARAGE;
  const d = 4;
  K.shop(0, d + g.drift, { length: g.roof, width: g.width, eave: g.eave, roof: 'flat', drift: g.drift, lip: g.lip, style: 'garage', color: '#9a9992', front: K.front('W', 0), sign: '' });
  const lipD = d + g.drift + g.roof;
  const land = lipD + g.gap;
  K.shop(0, land, { length: g.lower, width: g.width + 4, eave: g.lowEave, roof: 'shed', rise: g.lowRise, apron: g.apron, style: 'shop', color: K.pick(K.BRICK_COLORS), front: K.front('E', 0), sign: 'Parts' });
  out.gaps.push({ name: 'Garage gap', from: K.rect(0, lipD - 8, lipD + 0.2, g.width / 2), to: K.rect(0, land, land + g.lower + g.apron + 10, g.width / 2 + 3), points: g.points });
  for (const side of [-1, 1] as const) column(b, side, 12, 4, b.depth - 4, { colors: K.BRICK_COLORS, middle: g.width + 30, shops: true });
  // The block's line runs well clear of the garage's lip and the drop off its side.
  const by = g.width / 2 + 8;
  return [[by, 2], [by, land + g.lower + g.apron], [0, Math.min(b.depth - 2, land + g.lower + g.apron + 12)], [0, b.depth - 2]];
});

// The building site: a half-built building to ride (up its drift, along its top slab, off onto a landing drift), a tower crane,
// scaffolding, pipes laid out to slide, jersey barriers, a dumpster.
special.set(blockNear(101.25, 1), (b) => {
  K.shop(0, 18, { length: 22, width: 16, eave: 5.5, roof: 'flat', drift: 16, apron: 14, style: 'site', color: '#a3a29c', front: K.front('W', 0) });
  out.decor.push({ kind: 'crane', points: K.poly([[-(b.hw(30) - 7), 30]]), heading: r1(K.downAt(0, 30) + 30) });
  out.decor.push({ kind: 'scaffold', points: K.poly([[9, 20], [9, 38]]), height: 6 });
  const pipes = 4 + 18 + 22 + 14 + 22;
  K.slide('rail', 12, pipes, [[0, 0, 0], [3.5, 0, 0.5], [14, 0, 0.5]], { style: 'tube', radius: 0.35 });
  K.slide('rail', -12, pipes + 4, [[0, 0, 0], [3.5, 0, 0.5], [12, 0, 0.6]], { style: 'tube', radius: 0.35 });
  K.setToward(1);
  K.makers.barriers!(-6, pipes + 26);
  K.setToward(null);
  for (const side of [-1, 1] as const) column(b, side, 12, 4, b.depth - 4, { colors: K.BRICK_COLORS, middle: 46 });
  return [[0, 2], [0, b.depth - 2]];
});

// The park and its frozen fountain: a round stone rim to slide (round and round), a statue, benches and trees.
open.add(blockNear(-78.75, 2));
special.set(blockNear(-78.75, 2), (b) => {
  const cy = Math.round(b.depth * 0.45);
  out.decor.push({ kind: 'fountain', points: K.poly([[0, cy]]), heading: 0 });
  const rim: [number, number, number][] = [];
  for (let a = 0; a <= 360; a += 15) rim.push([Math.sin(a * DEG) * 6.3, cy + Math.cos(a * DEG) * 6.3, 0.75]);
  K.box('ledge', 0.7, rim);
  out.decor.push({ kind: 'statue', points: K.poly([[-16, cy - 26]]), heading: r1(K.downAt(0, cy)) });
  K.box('bench', K.BENCH.width, [[-12, cy - 4, K.BENCH.height], [-12, cy - 4 + K.BENCH.length, K.BENCH.height]]);
  K.box('bench', K.BENCH.width, [[12, cy + 2, K.BENCH.height], [12, cy + 2 + K.BENCH.length, K.BENCH.height]]);
  K.strip(18, 8, cy - 14, ['ledges', 'planters'], 8);
  K.strip(-18, cy + 14, b.depth - 4, ['kinkedRail', 'benches'], 8);
  const spots: Json[] = [];
  for (let d = 6; d < b.depth - 4; d += 8) for (const s of [-1, 1]) spots.push(...K.poly([[s * (b.hw(d) - 3), d]]));
  for (let d = 10; d < b.depth - 8; d += 14) spots.push(...K.poly([[(d % 28 < 14 ? -1 : 1) * 26, d]]));
  trees(spots, 700, 0.8, 1.3);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    out.decor.push({ kind: 'person', points: K.poly([[Math.sin(a) * 9.5, cy + Math.cos(a) * 9.5]]), heading: r1(K.downAt(0, cy) + (i * 37) % 360), color: '#b8483a' });
  }
  return [[-9, 2], [-9, b.depth - 2]];
});

// The viaduct: an arched stone bridge along the hill over the old town's sunken street. Ride down the street under its
// arches, or along its parapets across the street, the rim to the far rim (named: "Viaduct rail").
{
  const s = mainStreet(180);
  const r = VIADUCT.r;
  const f = streetFrame(s, r);
  K.useFrame((x, d) => f(-d, x));
  // In this frame x runs down the hill and d across it (to the street's left going down): the viaduct runs along d.
  const half = VIADUCT.span / 2;
  const deckEnds = [-half, half].map((d) => K.gy(0, d) + VIADUCT.height);
  const deckAt = (d: number): number => deckEnds[0]! + ((deckEnds[1]! - deckEnds[0]!) * (d + half)) / (2 * half);
  out.decor.push({ kind: 'viaduct', points: K.poly([[0, -half], [0, -VIADUCT.pier], [0, VIADUCT.pier], [0, half]]), height: VIADUCT.height });
  for (const side of [-1, 1]) {
    const x = side * (VIADUCT.width / 2 - 0.4);
    const pts: [number, number, number][] = [];
    for (let d = -half - 2; d <= half + 2 + 1e-6; d += 2) pts.push([x, d, Math.max(0.6, deckAt(Math.max(-half, Math.min(half, d))) + 1.0 - K.gy(x, d))]);
    K.box('parapet', 0.5, pts);
  }
  // Its ends reach into the blocks either side: keep them clear, and the way on and off.
  K.keeps.add(K.rectAt(...(K.W(0, -half - 24) as [number, number]), r1(K.downAt(0, 0)), 0, 2 * half + 48, -VIADUCT.width / 2 - 3, VIADUCT.width / 2 + 3, 'viaduct'));
  K.useFrame(null);
}

blocks.forEach((b, i) => {
  K.useFrame(b.frame);
  K.useRandom(1000 + i);
  const from = out.features.length;
  b.line = template(b)(b);
  K.useRandom(5000 + i);
  if (!open.has(b)) infill(b, from);
});
K.useFrame(null);

console.log('infill', JSON.stringify(REJ));
// ---------------------------------------------------------------- the summit plaza
// The start deck facing downtown, the clock tower behind it, the citadel's
// walls round the plaza with a gate (and two towers) at each main street.
K.useRandom(7);
K.put({ type: 'start', style: 'deck', x: 0, z: 8, heading: 0, height: 0.6 });
// The clock tower behind the start, seen from all over town.
K.highrise(0, -38, 10, 10, 28, 'clock', '#cdb48a', 'S', '');
K.box('planter', K.PLANTER.width, [[-10, -2, K.PLANTER.height], [-10, 1.2, K.PLANTER.height]]);
K.box('planter', K.PLANTER.width, [[10, -2, K.PLANTER.height], [10, 1.2, K.PLANTER.height]]);
const WALL_R = PLAZA + 5;
const GATE = 16;
const CITADEL = { thick: 4, eave: 5.5, turret: 5.5, turretEave: 11, ledge: PLAZA - 4 };
for (let k = 0; k < 8; k++) {
  // The wall from one gate's turret to the next, in straight stretches round the plaza.
  const a0 = k * 45 + (GATE / 2 + CITADEL.turret) / WALL_R / DEG;
  const a1 = (k + 1) * 45 - (GATE / 2 + CITADEL.turret) / WALL_R / DEG;
  const n = 4;
  for (let i = 0; i < n; i++) {
    const p = polar(a0 + ((a1 - a0) * i) / n, WALL_R);
    const q = polar(a0 + ((a1 - a0) * (i + 1)) / n, WALL_R);
    const len = Math.hypot((q.x as number) - (p.x as number), (q.z as number) - (p.z as number));
    const dx = ((q.x as number) - (p.x as number)) / len;
    const dz = ((q.z as number) - (p.z as number)) / len;
    // A rigid frame along the stretch: d from p toward q.
    K.useFrame((x, d) => [(p.x as number) + dx * d - dz * x, (p.z as number) + dz * d + dx * x]);
    K.highrise(0, 0, len + 0.6, CITADEL.thick, CITADEL.eave, 'rampart', '#b9ad98', 'N');
  }
  // A turret either side of the gate.
  for (const side of [-1, 1]) {
    const a = k * 45 + (side * (GATE / 2 + CITADEL.turret / 2)) / WALL_R / DEG;
    const c = polar(a, WALL_R);
    const h = a * DEG;
    K.useFrame((x, d) => [(c.x as number) - Math.sin(h) * (d - CITADEL.turret / 2) + Math.cos(h) * x, (c.z as number) - Math.cos(h) * (d - CITADEL.turret / 2) - Math.sin(h) * x]);
    K.highrise(0, 0, CITADEL.turret, CITADEL.turret, CITADEL.turretEave, 'turret', '#b9ad98', 'S');
  }
  K.useFrame(null);
  // Inside, a stone ledge along the foot of the wall to slide.
  const b0 = k * 45 + (GATE / 2 + 2) / CITADEL.ledge / DEG;
  const b1 = (k + 1) * 45 - (GATE / 2 + 2) / CITADEL.ledge / DEG;
  const pts: Json[] = [];
  for (let a = b0; a <= b1 + 1e-6; a += (b1 - b0) / 6) pts.push({ ...polar(a, CITADEL.ledge), height: 0.6 });
  out.features.push({ type: 'box', style: 'ledge', width: 1, points: pts });
}
// The plaza: people about, benches and trees between the gates, a statue facing the way down to downtown.
for (let k = 0; k < 8; k++) {
  const a = k * 45 + 22.5;
  if (k === 3 || k === 4) continue; // behind the start: the clock tower
  if (k === 1) out.decor.push({ kind: 'statue', points: [polar(a, 30)], heading: r1(a + 180) });
  else K.put({ type: 'box', style: 'bench', width: K.BENCH.width, points: [{ ...polar(a - 3, 34), height: K.BENCH.height }, { ...polar(a + 3, 34), height: K.BENCH.height }] });
  out.decor.push({ kind: 'pine', spots: [polar(a - 8, 40), polar(a + 8, 40)], seed: 60 + k, minScale: 0.8, maxScale: 1.1, solid: true });
  for (let i = 0; i < 3; i++) out.decor.push({ kind: 'person', points: [polar(a + (i - 1) * 6 + K.rand() * 3, 24 + K.rand() * 14)], heading: r1(K.rand() * 360) });
}

// ---------------------------------------------------------------- finishes, flags, runs
const finishes = (Object.entries(FACES) as [FaceId, { heading: number; name: string }][]).map(([, f]) => ({
  ...polar(f.heading, FOOT - 45),
  heading: f.heading,
  width: 320,
  length: 90,
  arch: { ...polar(f.heading, FOOT - 40), width: 24 },
}));
const flags: Json[] = [];
for (const s of streets.filter((t) => t.main)) {
  for (const [i, g] of RINGS.entries()) {
    if (i === 3) continue;
    const r = ringR(i, s.theta) - g.width / 2 - 4;
    flags.push({ ...polar(streetAt(s, r), r), heading: r1(streetAt(s, r)), width: 14 });
  }
}
const runs: Json[] = [];
// Down each main street from its gate.
for (const s of streets.filter((t) => t.main)) {
  const pts = streetPoints(s, PLAZA - 10, RINGS[3]!.r, 20);
  const face = FACES[faceOf(s.theta)];
  if (Math.abs(((s.theta - face.heading + 540) % 360) - 180) > 5) {
    // A diagonal street: along the boulevard to its side's square.
    const dir = ((((face.heading - s.theta) % 360) + 540) % 360) - 180;
    for (let t = 8; Math.abs(t) <= 45; t += 8) pts.push(polar(s.theta + Math.sign(dir) * t, ringR(3, s.theta + Math.sign(dir) * t)));
  }
  pts.push(polar(face.heading, FOOT));
  runs.push({ name: `${face.name}: ${['South', 'Southeast', 'East', 'Northeast', 'North', 'Northwest', 'West', 'Southwest'][Math.round(s.theta / 45) % 8]} Street`, points: pts, clear: 6 });
}
// Through the blocks: one line from each old-town block down through a block in each band below it.
blocks.filter((b) => b.band === 0).forEach((top) => {
  const pts: Json[] = [];
  let theta = top.theta;
  for (let band = 0; band < 4; band++) {
    const b = band === 0 ? top : blocks.filter((c) => c.band === band).sort((p, q) => Math.abs(((p.theta - theta + 540) % 360) - 180) - Math.abs(((q.theta - theta + 540) % 360) - 180))[0]!;
    theta = b.theta;
    K.useFrame(b.frame);
    pts.push(...K.poly(b.line!));
  }
  K.useFrame(null);
  const face = FACES[top.face];
  pts.push(polar(face.heading + (((theta - face.heading + 540) % 360) - 180) * 0.3, FOOT));
  runs.push({ name: `${face.name}: blocks ${r1(top.theta)}`, points: pts, clear: 3 });
});

// ---------------------------------------------------------------- street life
// Vehicles parked along the ring roads (buses at their shelters, trams on
// the tracks round the second ring, each with a plow pile up to its roof),
// plow trucks on the main streets, street furniture and people on the
// sidewalks, traffic lights and signs at the crossings, the elevated line
// round the rail quarter, the funicular up the old town's side, a skybridge
// downtown. Everything keeps off the buildings, the features' clear zones
// and the runs.
K.useRandom(4242);
/** Distance from (x, z) to the nearest run's line. */
function nearRun(x: number, z: number): number {
  let best = Infinity;
  for (const run of runs) {
    const pts = run.points as { x: number; z: number }[];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
      best = Math.min(best, Math.hypot(x - a.x - dx * t, z - a.z - dz * t));
    }
  }
  return best;
}
/** Is a spot free for a prop: off buildings, features' clear zones and (by `run` m) the runs? */
const free = (x: number, z: number, pad = 1, run = 5): boolean => !K.insideBuilding(x, z, pad) && !K.inKeep(x, z, pad) && nearRun(x, z) > run;
/** A ring road's frame: x out from the hill (+), d round it (clockwise seen from above, toward lower headings). */
const ringFrame = (i: number): K.Frame => (x, d) => {
  const g = RINGS[i]!;
  const theta = -(d / g.r) / DEG;
  const r = ringR(i, theta) + x;
  return [-Math.sin(theta * DEG) * r, -Math.cos(theta * DEG) * r];
};
const ringD = (i: number, theta: number): number => -theta * DEG * RINGS[i]!.r;

/** A vehicle (a box along the line from d to d + length, x out) with a plow pile at its uphill-most end, up to its roof. */
function vehicle(style: string, x: number, d: number, length: number, width: number, shape: [number, number][]): boolean {
  const pts = shape.map(([u, h]) => [x, d + u * length, h] as [number, number, number]);
  for (const [px, pd] of [[x, d - 9], [x, d], [x, d + length / 2], [x, d + length]] as const) {
    const [wx, wz] = K.W(px, pd);
    if (!free(wx, wz, 1.5, 7)) return false;
  }
  const top = Math.max(...shape.map(([, h]) => h));
  K.bank(x, d - 8.6, 0, width + 0.6, { height: top + 0.15, back: 7.5, top: 1.2, angle: 40, side: 1.5 });
  K.box(style, width, pts);
  return true;
}
const COACH = (h: number): [number, number][] => [[0, h], [1, h]];
const PLOW_SHAPE: [number, number][] = [[0, 0.9], [0.1, 1.2], [0.17, 2.8], [0.42, 2.8], [0.44, 2.4], [1, 2.4]];

// Trams on the tracks round the second ring, buses at shelters on the first and third.
out.decor.push({ kind: 'tramTracks', points: Array.from({ length: 122 }, (_, k) => polar(k * 3, ringR(1, k * 3) + 3)) });
let vehicles = 0;
for (const theta of [101.25, -78.75, 191.25, 11.25]) {
  K.useFrame(ringFrame(1));
  if (vehicle('tram', 3, ringD(1, theta), 14, 2.4, COACH(3.2))) vehicles++;
}
for (const [ring, theta] of [[0, 33.75], [0, 213.75], [0, 123.75], [2, -33.75], [2, 146.25], [2, 56.25]] as const) {
  K.useFrame(ringFrame(ring));
  const g = RINGS[ring]!;
  const x = g.width / 2 - 2;
  const d = ringD(ring, theta);
  if (vehicle('bus', x, d, 11, 2.5, COACH(3.0))) {
    vehicles++;
    const [wx, wz] = K.W(x + 4.2, d + 3);
    if (free(wx, wz, 1, 3)) K.box('shelter', 1.6, [[x + 4.2, d + 3, 2.5], [x + 4.2, d + 7, 2.5]]);
  }
}
// A plow truck on each face's main street, near the top of town, at the side of the street.
for (const f of Object.values(FACES)) {
  const s = mainStreet(f.heading);
  K.useFrame(streetFrame(s, 100));
  if (vehicle('plow', 4.6, 0, 8, 2.5, PLOW_SHAPE)) vehicles++;
}
K.useFrame(null);

// Street furniture and people along the main streets' sidewalks; traffic lights where they cross the ring roads, stop signs where the side streets do.
const FURNITURE: [string, number, number, number][] = [
  ['hydrant', 0.45, 0.45, 0.8],
  ['newsBox', 0.5, 0.45, 1.1],
  ['bin', 0.9, 0.9, 1.0],
  ['bikeRack', 0.6, 3.2, 0.8],
  ['bollards', 0.3, 5.6, 0.9],
  ['bench', 0.5, 2.4, 0.45],
];
let furniture = 0;
let people = 0;
for (const s of streets) {
  const r0 = s.from + 8;
  const rEnd = RINGS[3]!.r - 12;
  K.useFrame(streetFrame(s, r0));
  for (let d = 0, k = 0; d < rEnd - r0; d += 13, k++) {
    for (const side of [-1, 1]) {
      const x = side * (s.width / 2 + 1.1);
      const [wx, wz] = K.W(x, d);
      if (!free(wx, wz, 1.2, 6)) continue;
      const roll = K.rand();
      if (roll < 0.28) {
        const [style, width, length, h] = FURNITURE[(k + (side > 0 ? 3 : 0)) % FURNITURE.length]!;
        const [ex, ez] = K.W(x, d + length);
        if (!free(ex, ez, 1.2, 6)) continue;
        K.box(style, width, [[x, d, h], [x, d + length, h]]);
        furniture++;
      } else if (roll < 0.55) {
        out.decor.push({ kind: 'person', points: K.poly([[x + side * 0.3, d]]), heading: r1(K.downAt(x, d) + (K.rand() < 0.5 ? 0 : 180) + (K.rand() - 0.5) * 60) });
        people++;
      }
    }
  }
}
K.useFrame(null);
let signals = 0;
for (const s of streets) {
  for (const [i, g] of RINGS.entries()) {
    if (s.from > g.r - 1 || i === 3) continue;
    for (const [side, out_] of [[-1, -1], [1, 1]] as const) {
      const r = ringR(i, s.theta) + out_ * (g.width / 2 + 2);
      const t = streetAt(s, r) + (side * (s.width / 2 + 1.5)) / r / DEG;
      const p = polar(t, r);
      if (!free(p.x as number, p.z as number, 1, 6)) continue;
      const kind = s.main ? 'trafficLight' : K.pick(['stopSign', 'yieldSign', 'noParking']);
      out.decor.push({ kind, points: [p], heading: r1(streetAt(s, r) + (out_ > 0 ? 180 : 0)) });
      signals++;
    }
  }
}

// The elevated line round the rail quarter, above the third ring's outer edge, pillars every 24 m.
{
  const pts: Json[] = [];
  const r = (theta: number): number => ringR(2, theta) + RINGS[2]!.width / 2 - 1.5;
  for (let a = 52; a <= 128; a += (24 / RINGS[2]!.r) / DEG) pts.push(polar(a, r(a)));
  out.decor.push({ kind: 'elevated', points: pts, height: 7.5 });
}
// The funicular up the old town's northeast side: tracks along the street's edge from the plaza to the boulevard.
{
  const s = mainStreet(135);
  const pts: Json[] = [];
  for (let r = PLAZA + 12; r <= RINGS[3]!.r - 12; r += 15) pts.push(polar(streetAt(s, r) - (s.width / 2 - 1.2) / r / DEG, r));
  out.decor.push({ kind: 'funicular', points: pts });
}
// A skybridge downtown between the two closest tall towers across a street.
{
  const towers = out.features.filter((f) => f.type === 'building' && (f.style === 'tower' || f.style === 'deco' || f.style === 'twist') && (f.eave as number) > 40);
  const mid = (f: Json): [number, number] => {
    const a = (f.yaw as number) * DEG;
    return [(f.x as number) - (Math.sin(a) * (f.length as number)) / 2, (f.z as number) - (Math.cos(a) * (f.length as number)) / 2];
  };
  let best: [Json, Json, number] | null = null;
  for (let i = 0; i < towers.length; i++) {
    for (let j = i + 1; j < towers.length; j++) {
      const [ax, az] = mid(towers[i]!);
      const [bx, bz] = mid(towers[j]!);
      const gap = Math.hypot(bx - ax, bz - az) - ((towers[i]!.width as number) + (towers[j]!.width as number)) / 2;
      if (gap > 10 && gap < 40 && (!best || gap < best[2])) best = [towers[i]!, towers[j]!, gap];
    }
  }
  if (best) {
    const [ax, az] = mid(best[0]);
    const [bx, bz] = mid(best[1]);
    const len = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / len;
    const uz = (bz - az) / len;
    const ha = (best[0].width as number) / 2;
    const hb = (best[1].width as number) / 2;
    out.decor.push({ kind: 'skybridge', points: [{ x: r1(ax + ux * ha), z: r1(az + uz * ha) }, { x: r1(bx - ux * hb), z: r1(bz - uz * hb) }], height: 32 });
    out.notes.push(`skybridge: ${r1(best[2])} m between towers ${r1(ax)},${r1(az)} and ${r1(bx)},${r1(bz)}`);
  }
}
out.notes.push(`street life: ${vehicles} vehicles, ${furniture} pieces of furniture, ${people} people, ${signals} signals and signs`);

// ---------------------------------------------------------------- decoration
// Street lamps along the ring roads and down the main streets.
const lamp = (theta: number, r: number, heading: number, color: string): void => {
  const p = polar(theta, r);
  // Never on a building, a drift, or in a feature's way.
  if (K.insideBuilding(p.x as number, p.z as number, 1) || K.inKeep(p.x as number, p.z as number, 1.5)) return;
  out.decor.push({ kind: 'streetLamp', points: [p], heading: r1(heading), color });
};
RINGS.forEach((g, i) => {
  for (let a = 0, k = 0; a < 360; a += (32 / ringR(i, a)) / DEG, k++) {
    const s = k % 2 === 0 ? -1 : 1;
    lamp(a, ringR(i, a) + s * (g.width / 2 + 1), a + (s > 0 ? 180 : 0), i === 3 ? '#ff7a1a' : '#33c26a');
  }
});
for (const s of streets.filter((t) => t.main)) {
  let k = 0;
  for (let r = PLAZA + 14; r < RINGS[3]!.r - 10; r += 25, k++) {
    const side = k % 2 === 0 ? 1 : -1;
    const t = streetAt(s, r) + (side * (s.width / 2 + 1)) / r / DEG;
    lamp(t, r, streetAt(s, r) + side * 90, '#2f7de1');
  }
}
out.decor.push({ kind: 'sign', x: -12, z: 18, heading: 0, header: 'City', lines: Object.values(FACES).map((f) => ({ text: f.name, level: 'blue', arrow: f.heading === 0 ? 0 : f.heading === 90 ? -1 : f.heading === -90 ? 1 : 0 })) });

// ---------------------------------------------------------------- report and checks
const count = (t: string): number => out.features.filter((f) => f.type === t).length;
console.log(`City: ${out.features.length} features (${count('building')} buildings, ${count('terrace')} terraces, ${count('rail')} rails, ${count('box')} boxes, ${count('kicker')} kickers, ${count('landing')} banks, ${count('quarter')} wallrides), ${out.gaps.length} named gaps, ${flags.length} flags, ${runs.length} runs, ${blocks.length} blocks`);
for (const [id, f] of Object.entries(FACES)) {
  const p = polar(f.heading, FOOT);
  console.log(`${id} ${f.name}: drop to the square ${(SUMMIT - gw(p.x as number, p.z as number)).toFixed(0)} m`);
}
for (const n of out.notes) console.log(n);
let clashes = 0;
for (const f of out.features) {
  if (f.type !== 'rail' && f.type !== 'box' && f.type !== 'kicker' && f.type !== 'quarter' && f.type !== 'terrace') continue;
  const pts = (f.points as { x: number; z: number }[] | undefined) ?? [{ x: f.x as number, z: f.z as number }];
  for (const p of pts) {
    if (K.insideBuilding(p.x, p.z)) {
      clashes++;
      if (clashes <= 12) console.log(`clash: ${f.type} ${String(f.style ?? '')} at (${p.x}, ${p.z})`);
      break;
    }
  }
}
// Buildings on the roads.
let onRoad = 0;
for (const f of out.features) {
  if (f.type !== 'building') continue;
  const x = f.x as number;
  const z = f.z as number;
  const r = Math.hypot(x, z);
  const a = Math.atan2(-x, -z) / DEG;
  for (const [i, g] of RINGS.entries()) if (Math.abs(r - ringR(i, a)) < g.width / 2 + 2) onRoad++;
}
let blocked = 0;
for (const r of K.keeps.all) {
  // The middle of the zone's first stretch and its far end.
  for (const [u, v] of [[(r.u0 + r.u1) / 2, (r.v0 + r.v1) / 2], [r.u1 - 2, (r.v0 + r.v1) / 2], [r.u0 + 2, (r.v0 + r.v1) / 2]] as const) {
    const px = r.x + r.dirX * u - r.dirZ * v;
    const pz = r.z + r.dirZ * u + r.dirX * v;
    const hit = K.insideBuilding(px, pz, -0.2);
    if (hit && hit.what.startsWith('building') && !(r.what === 'wallride')) {
      blocked++;
      if (blocked <= 10) console.log(`blocked: ${r.what} at (${r1(px)}, ${r1(pz)}) by a ${hit.what}`);
      break;
    }
  }
}
console.log(`${clashes} features inside a building, ${onRoad} building corners on a ring road, ${blocked} clear zones with a building in them`);

// ---------------------------------------------------------------- the map
const map = {
  name: 'City',
  terrain,
  features: out.features,
  spawn: { x: 0, z: 8, heading: 0 },
  flags,
  finishes,
  decor: out.decor,
  runs,
  gaps: out.gaps,
  colors: { sky: '#8fb6e0', fog: '#d6e2ef' },
  peaks: { seed: 16, count: 13, rings: 3, distance: [7000, 22000], base: -500, height: [900, 2400], snowLine: 300 },
};
const t0 = performance.now();
const built = buildMap(parseMap(map));
console.log(`built in ${(performance.now() - t0).toFixed(0)} ms: ${built.hf.cols}x${built.hf.rows} cells, ${built.hf.shapes?.length ?? 0} shapes, ${built.course.rails.length} rails`);
void r2;
writeFileSync('src/maps/city.json', `${JSON.stringify(map)}\n`);
console.log('wrote src/maps/city.json');
