// Lays out the City and writes it to src/maps/city.json (milestone 16). The
// map file is the source the game loads; this script is how it was
// authored. Edit here and rerun, from the repo root:
//   node tools/maps/city.ts
// Then check it: tools/maps/sinks.ts (stuck spots), tools/sim/features.ts
// (every jump, kicker, quarter, building, terrace and jib), tools/sim/face.ts
// (rides each avenue to the finish), tools/sim/score.ts (its City section
// rides the five named roof gaps), tools/maps/overview.ts (a top-down PNG).
//
// A snowed-in city down a steep hill, open to ride any way: five avenues
// run down the fall line, near-flat cross streets run across it every
// 220 m, and between them are blocks of buildings with their own alleys,
// courtyards, stair streets, plazas and roofs. Positions are x across (+x to
// the right facing down) and d down the hill from the top (z = -d).
//   d    0 to   40   the top plaza and the start deck, among the old town's small houses
//   d   40 to 1140   five rows of blocks at 12 to 16°, a cross street (3.5°) above each
//   d 1140 to 1590   downtown at 5°: towers, tower plazas, the Tower gap
//   d 1590 to 1680   the square, the finish line across the whole city and its arch
//   d 1680 to 1770   a run-out climbing to stop riders
// The buildings grow taller down the hill: small shops and houses at the
// top, mid-rises lower down, glass towers downtown. Both outer edges are
// outskirts of small houses (the play area's edge is a snow bank there).
//
// Every block is built from one of a few templates (rooftops, stair street,
// plaza, alley; downtown: tower plaza, garage), so each avenue passes a mix.
// Rideable roofs follow the slope like Freeride's town; the buildings nobody
// rides (mid-rises and towers) get a shed roof turned uphill so they stand
// level, their downhill walls taller.

import { writeFileSync } from 'node:fs';
import { buildMap } from '../../src/maps/build.ts';
import { parseMap } from '../../src/maps/loader.ts';
import { generateSlope } from '../../src/maps/terrain.ts';
import { heightAt } from '../../src/sim/terrain.ts';
import { poleJam, SHAPES, slideJson, type Json, type Pt } from './railKit.ts';

const DEG = Math.PI / 180;
const r1 = (v: number): number => Math.round(v * 10) / 10;
const r2 = (v: number): number => Math.round(v * 100) / 100;

/** A small seeded random (mulberry32), so a rerun lays out the same city. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = random(16);
const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)]!;
const between = (a: number, b: number): number => a + (b - a) * rand();

// ---------------------------------------------------------------- the grid
const WIDTH = 640;
/** The avenues' middles, west to east, and their names (runs, signs). */
const AVES = [-240, -120, 0, 120, 240];
const AVE_NAMES = ['Ridge Avenue', 'Market Street', 'Main Street', 'Lantern Avenue', 'Foundry Row'];
/** Half an avenue's width curb to curb, and the sidewalk: buildings start at LINE from its middle. */
const AVE = { half: 13, walk: 3 };
const LINE = AVE.half + AVE.walk;
/** Cross streets: where each starts (d) and how wide it is. */
const CROSS = [40, 260, 480, 700, 920, 1140, 1370];
const STREET = 24;
/** Pitch (degrees) of the five rows of blocks, then downtown's, the cross streets', the top plaza's. */
const PITCH = [12, 14, 16, 14, 13];
const DOWNTOWN_PITCH = 5;
const STREET_PITCH = 3.5;
const TOP = { length: 40, pitch: 3 };
/** The square (finish), and the run-out climbing past it to the end of the play area. */
const SQUARE = { top: 1590, bottom: 1680, pitch: 3 };
const END = 1770;
const CLIMB = -9;
/** Where a pitch change eases in (m, centered on the change). */
const EASE = 20;

interface Row {
  top: number;
  bottom: number;
  pitch: number;
  /** 0 to 4 the steep rows, 5 and 6 downtown. */
  index: number;
}
const ROWS: Row[] = CROSS.map((c, i) => ({ top: c + STREET, bottom: CROSS[i + 1] ?? SQUARE.top, pitch: PITCH[i] ?? DOWNTOWN_PITCH, index: i }));

// ---------------------------------------------------------------- terrain
const sec = (length: number, pitch: number, ease = EASE): Json => ({ length, pitch, ease });
const profile: Json[] = [sec(TOP.length, TOP.pitch, 0)];
for (const row of ROWS) {
  profile.push(sec(STREET, STREET_PITCH));
  profile.push(sec(row.bottom - row.top, row.pitch));
}
profile.push(sec(SQUARE.bottom - SQUARE.top, SQUARE.pitch));
profile.push(sec(END - SQUARE.bottom, CLIMB, 30));

const terrain = {
  type: 'generated',
  width: WIDTH,
  length: END,
  cellSize: 4,
  profile,
  bermWidth: 14,
  bermHeight: 5,
  noise: 0.06,
  seed: 16,
  // Wide, so the far stand-in of the ground (render/backdrop.ts, round the heightfield's middle) reaches the whole city: the skyline stands on it.
  margin: 600,
  hills: { amplitude: 4, wavelength: 160 },
};
const spawn = { x: 0, z: -16, heading: 0 };
const ground = generateSlope(
  parseMap({ name: 'City', terrain, features: [], spawn, flags: [], finishes: [{ x: 0, z: -1630, heading: 0, width: 100, length: 50 }], decor: [], colors: { sky: '#000000', fog: '#000000' } }).terrain as never,
);
/** Height of the bare slope at (x, d). */
const gy = (x: number, d: number): number => heightAt(ground, x, -d);
/** The slope's pitch (degrees) down the fall line at (x, d). */
const pitchAt = (x: number, d: number): number => Math.atan((gy(x, d - 1) - gy(x, d + 1)) / 2) / DEG;

// ---------------------------------------------------------------- what goes in the map
const features: Json[] = [];
const gaps: Json[] = [];
const decor: Json[] = [];
const flags: Json[] = [];
const runs: Json[] = [];
const notes: string[] = [];
const xz = (x: number, d: number): Json => ({ x: r1(x), z: r1(-d) });

const SHOP_COLORS = ['#c8553d', '#3f7fbf', '#e0b84a', '#6a8f5a', '#e8e0d0', '#b8483a', '#4f6fa8', '#d9a441', '#7a8f9f', '#a65f8a'];
const BLOCK_COLORS = ['#9a5b45', '#b8735a', '#8c6f5a', '#c9b48e', '#7d8590', '#a8a29a', '#6e7c8c', '#b9a27e', '#8a4f3d', '#d0c4ac', '#5f6b78', '#a7826a'];
const TOWER_COLORS = ['#8d9aa8', '#a7b0b8', '#6f7a86', '#b9bfc5', '#7f8b84'];
const SHOP_SIGNS = ['Bakery', 'Cafe', 'Books', 'Records', 'Deli', 'Noodles', 'Hardware', 'Florist', 'Barber', 'Bikes', 'Tea', 'Pizza', 'Diner', 'Market', 'Gallery', 'Bagels', 'Toys', 'Grocer', 'Tune shop', 'Outfitters', 'Rentals', 'Soup', 'Tailor', 'Laundry'];

type Side = 'W' | 'E' | 'N' | 'S';
/** A building's `front` for a door facing world side `s`, for its yaw (0 runs down the hill, 180 up it). */
function front(s: Side, yaw: 0 | 180): string {
  const down = { W: 'left', E: 'right', N: 'up', S: 'down' } as const;
  const up = { W: 'right', E: 'left', N: 'down', S: 'up' } as const;
  return (yaw === 0 ? down : up)[s];
}

/** A building's footprint (roof edge), for the checks at the end: x0..x1 across, d0..d1 down. */
interface Footprint {
  x0: number;
  x1: number;
  d0: number;
  d1: number;
}
const footprints: Footprint[] = [];

/** A rideable building (a shop or house) whose roof follows the slope: its roof's uphill edge centered at (x, d). */
function shop(x: number, d: number, b: Json): void {
  features.push({ type: 'building', ...xz(x, d), yaw: 0, ...b });
  const len = b.length as number;
  const w = (b.width as number) / 2;
  footprints.push({ x0: x - w, x1: x + w, d0: d, d1: d + len });
}

/**
 * A building nobody rides (a mid-rise or a tower), standing level: from d
 * to d + length down the hill, centered at x, at least `eave` tall at its
 * uphill wall. It's laid out turned uphill with a shed roof as high above
 * its downhill end as the slope drops along it, so the roof is level.
 */
function highrise(x: number, d: number, length: number, width: number, eave: number, style: 'block' | 'tower', color: string, door: Side, sign = ''): void {
  const rise = Math.max(0, gy(x, d) - gy(x, d + length));
  features.push({ type: 'building', ...xz(x, d + length), yaw: 180, length: r1(length), width: r1(width), eave: r1(eave), roof: 'shed', rise: r2(rise), style, color, front: front(door, 180), sign });
  footprints.push({ x0: x - width / 2, x1: x + width / 2, d0: d, d1: d + length });
}

/** A terrace (a plaza with a wall drop on every side) from (x, d) down `length`, level on the slope, `extra` m higher at its front; stairs `stairs` wide down its front. */
function terrace(x: number, d: number, length: number, width: number, stairs: number, extra = 0, stairAngle = 22): number {
  const height = length * Math.tan(pitchAt(x, d + length / 2) * DEG) + extra;
  features.push({ type: 'terrace', ...xz(x, d), yaw: 0, length, width, height: r2(height), stairs, stairAngle, handrails: stairs > 0 });
  return height;
}

/** A box or rail through [x, d, height above the snow] points. */
function box(style: string, width: number, pts: [number, number, number][]): void {
  features.push({ type: 'box', style, width, points: pts.map(([x, d, h]) => ({ x: r2(x), z: r2(-d), height: r2(h) })) });
}
function rail(pts: [number, number, number][], style = 'metal'): void {
  features.push({ type: 'rail', style, points: pts.map(([x, d, h]) => ({ x: r2(x), z: r2(-d), height: r2(h) })) });
}

/** A snow bank (a plow pile or a landing below a drop): rising from (x, d) along `yaw` (0 down the hill), its face falling away beyond its top. */
function bank(x: number, d: number, yaw: number, width: number, o: { height?: number; back?: number; top?: number; angle?: number; side?: number } = {}): void {
  const height = o.height ?? BANK.height;
  features.push({
    type: 'landing',
    ...xz(x, d),
    yaw,
    width: r1(width),
    sideWidth: o.side ?? BANK.side,
    height,
    angle: o.angle ?? BANK.angle,
    back: o.back ?? BANK.back,
    top: o.top ?? BANK.top,
    knuckle: BANK.knuckle,
    transition: BANK.transition,
    natural: true,
  });
}
/** A plow bank along a curb: 1.3 m of snow (tall enough to read as a bank from the street), an eased back from the street, a short top, its face toward the sidewalk. */
const BANK = { height: 1.3, back: 2.6, top: 0.8, angle: 26, knuckle: 0.6, transition: 1.5, side: 4, from: 6.5 };

// ---------------------------------------------------------------- street furniture and small features
// Each maker lays one feature (or a small set) with its top end at (x, d) and
// returns how far down the hill it reaches. Templates string them down a
// strip of a block.
type Maker = (x: number, d: number) => number;
/**
 * How far (m) to one side of a strip's middle the bonks stand: the middle
 * stays clear, so a rider coming off a stair set or a rail straight down
 * the strip never runs into the side of something to pop onto.
 */
const OFF = 2.5;
let sideFlip = 1;
/** Set: every bonk goes to this side of its strip (an avenue's lane: toward the street's middle, off the curb banks). */
let towardSide: number | null = null;
const side = (): number => towardSide ?? (sideFlip = -sideFlip);

const BENCH = { width: 0.5, height: 0.45, length: 2.4 };
const PLANTER = { width: 1.2, height: 0.6, length: 3.2 };
const BARRIER = { width: 0.6, height: 0.8, length: 10 };
/** A parked car: its width, length, the gap to the next one, and its shape as [m along, height above the snow]: hood, windshield, roof, back window, trunk. */
const CAR = { width: 1.8, length: 4.3, gap: 0.4, shape: [[0, 0.9], [1.0, 0.95], [1.5, 1.45], [2.9, 1.45], [3.4, 0.95], [4.3, 0.9]] as [number, number][] };
const DUMPSTER = { width: 1.6, height: 1.3, length: 2.2 };
/** A ledge, and how far either side of a strip's middle the pair stands (clear of a stair set's handrails below, 2.7 m out). */
const LEDGE = { width: 0.6, height: 0.5, length: 11, off: 4 };
/** A kicker onto a rail: the kicker's lip, angle and size. */
const KICK = { lip: 0.6, angle: 14, width: 2.6, side: 1.2 };

const makers: Record<string, Maker> = {
  kinkedRail: (x, d) => {
    features.push(slideJson('rail', x, d, SHAPES.doubleKink(14)));
    return 14;
  },
  downRail: (x, d) => {
    features.push(slideJson('rail', x, d, SHAPES.flatDownFlatDown(16)));
    return 16;
  },
  aFrame: (x, d) => {
    features.push(slideJson('rail', x, d, SHAPES.aFrame(12)));
    return 12;
  },
  ledges: (x, d) => {
    // Two ledges side by side: one ridden on from the snow, one to pop onto.
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
    // A run of street barriers end to end beside the strip's middle (kept clear), to bonk or slide. (With gaps between them,
    // a slow rider sliding off one dropped into the side of the next.)
    const v = OFF * side();
    box('barrier', BARRIER.width, [[x + v, d, BARRIER.height], [x + v, d + BARRIER.length, BARRIER.height]]);
    return BARRIER.length;
  },
  cars: (x, d) => {
    // Two cars parked bumper to bumper, snowed over: slide the hoods, roofs and trunks.
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
    features.push(poleJam(x, d, 1.2, 25));
    return 3;
  },
  kickerRail: (x, d) => {
    const lipAt = (2 * KICK.lip) / Math.tan(KICK.angle * DEG);
    features.push({ type: 'kicker', ...xz(x, d), yaw: 0, width: KICK.width, sideWidth: KICK.side, lipHeight: KICK.lip, lipAngle: KICK.angle, natural: true });
    const a = d + lipAt + 1;
    rail([[x, a, KICK.lip], [x, a + 12, KICK.lip]]);
    return lipAt + 13;
  },
  stairs: (x, d) => {
    // A stair set with handrails down both sides, from a little plaza level on the slope.
    const length = 12;
    const h = terrace(x, d, length, 14, 6, 0);
    return length + h / Math.tan(22 * DEG) + 3;
  },
  bigStairs: (x, d) => {
    const length = 14;
    const h = terrace(x, d, length, 16, 7, 0.8);
    return length + h / Math.tan(22 * DEG) + 3;
  },
  dropBank: (x, d) => {
    // Drop onto a bank: a plaza level on the slope, 3.5 m above it at its
    // front, no stairs; below its front wall a bank to land on.
    const p = pitchAt(x, d + 8);
    const length = Math.max(10, Math.min(18, 3.5 / Math.tan(p * DEG)));
    const h = terrace(x, d, length, 12, 0, 0);
    bank(x, d + length + 0.4, 0, 12, { height: Math.min(1.6, h * 0.45), back: 0.8, top: 1.2, angle: 26, side: 2 });
    return length + 10;
  },
};

/** Makers that lay something to pop onto (its end stands above the snow), which a rider must not meet straight off the feature before. */
const POP_ON = new Set(['planters', 'benches', 'barriers', 'barrels', 'ledges', 'cars', 'dumpster']);
/** Clear snow (m) before something to pop onto: a rider off a stair set, a drop or a rail lands and rides this far before needing to steer. */
const CLEAR_BEFORE = 26;

/** Lays makers down a strip from d0 to d1 at x, `gap` m apart (CLEAR_BEFORE before one to pop onto), as far as they fit. */
function strip(x: number, d0: number, d1: number, list: string[], gap = 7, belowLaunch = false): void {
  let d = d0;
  // `belowLaunch`: the strip starts just below a stair set, so its first item needs the clear snow too.
  let first = !belowLaunch;
  for (const name of list) {
    const maker = makers[name];
    if (!maker) throw new Error(`no maker ${name}`);
    if (!first && POP_ON.has(name)) d += Math.max(0, CLEAR_BEFORE - gap);
    if (d + 18 > d1) break;
    d += maker(x, d) + gap;
    first = false;
  }
}

// ---------------------------------------------------------------- blocks
interface Block {
  x0: number;
  x1: number;
  row: Row;
  col: number;
}
/** How tall (eave, m) the buildings nobody rides stand in each row: at least, and up to this much more. */
const TALL: [number, number][] = [
  [5, 2],
  [8, 3],
  [10, 4],
  [13, 5],
  [15, 6],
  [18, 8],
  [20, 8],
];
const tallFor = (row: Row): number => {
  const [a, b] = TALL[row.index]!;
  return a + rand() * b;
};

/** A column of buildings nobody rides down one side of a block, alleys between: x0..x1 across, from d0 to d1. */
function buildingColumn(b: Block, x0: number, x1: number, d0: number, d1: number, door: Side, o: { gap?: number; min?: number; max?: number; shops?: boolean } = {}): [number, number][] {
  const out: [number, number][] = [];
  let d = d0;
  const gap = o.gap ?? 7;
  while (d < d1 - 12) {
    const len = Math.min(d1 - d, between(o.min ?? 22, o.max ?? 38));
    if (len < 12) break;
    const sign = o.shops && rand() < 0.6 ? pick(SHOP_SIGNS) : '';
    highrise((x0 + x1) / 2, d, len, x1 - x0, tallFor(b.row), 'block', pick(BLOCK_COLORS), door, sign);
    out.push([d, d + len]);
    d += len + gap;
  }
  return out;
}

/**
 * Wallrides on a column of buildings' wall at x (`side` as wallride()):
 * on up to `most` of its buildings long enough to leave WALLRIDE.past m of
 * wall beyond the wallride's end, so a rider thrown over the coping comes
 * down beside the wall, not into the alley after it.
 */
function wallrides(segments: [number, number][], wallX: number, side: 1 | -1, most: number, skip = 0): void {
  let n = 0;
  for (const [i, [d0, d1]] of segments.entries()) {
    if (i < skip || n >= most) continue;
    const length = Math.min(WALLRIDE.length, d1 - d0 - WALLRIDE.before - WALLRIDE.past);
    if (length < WALLRIDE.length) continue; // shorter ones end with the rider still on the wall, heading into it
    wallride(wallX, side, d0 + WALLRIDE.before, length);
    n++;
  }
}

/**
 * Rooftops: a row of low shops along one avenue edge whose flat roofs step
 * down the block, ridden from a drift at the top, with an alley gap (named)
 * between two of them and a landing drift below; then a second row lower
 * down, the last roof either dropping to the snow or (the Street gap)
 * kicking over the cross street onto a plow pile. Mid-rises down the other
 * edge, and a courtyard of features between.
 */
function rooftops(b: Block, edge: 'W' | 'E', o: { alleyGap?: string; streetGap?: boolean }): number {
  const { row } = b;
  const w = 14;
  const x = edge === 'W' ? b.x0 + w / 2 : b.x1 - w / 2;
  const door: Side = edge;
  const d = row.top;
  const roof = (u: number, len: number, eave: number, extra: Json): void =>
    shop(x, d + u, { length: len, width: w, eave, roof: 'flat', style: 'shop', color: pick(SHOP_COLORS), front: front(door, 0), sign: pick(SHOP_SIGNS), ...extra });
  // The first row: up the drift, along four roofs, over the alley, down the landing drift.
  roof(22, 16, 4.4, { drift: 14 });
  roof(38, 16, 4.0, { lip: o.alleyGap ? 0.45 : 0 });
  const alley = o.alleyGap ? ROOF_GAP.alley : 0;
  roof(54 + alley, 16, 3.4, {});
  roof(70 + alley, 14, 2.6, { roof: 'shed', rise: 0.4 });
  roof(84 + alley, 16, 2.3, { apron: 14 });
  if (o.alleyGap) {
    const from = rect(x, d + 47, d + 54.2, w / 2);
    const to = rect(x, d + 54 + alley, d + 54 + alley + 34, w / 2 + 1);
    gaps.push({ name: o.alleyGap, from, to, points: ROOF_GAP.alleyPoints });
  }
  // The second row.
  const second = 128;
  const high = o.streetGap ? STREET_GAP.eave + 1 : 4.2;
  roof(second, 16, high, { drift: o.streetGap ? 18 : 14 });
  roof(second + 16, 14, high - 0.45, {});
  if (o.streetGap) {
    // The last roof ends at the bottom of the block, with a lip over the cross street.
    const len = row.bottom - (d + second + 30) - STREET_GAP.short;
    roof(second + 30, len, STREET_GAP.eave, { lip: STREET_GAP.lip });
    const lipD = row.bottom - STREET_GAP.short;
    const pile = lipD + STREET_GAP.pileAt;
    bank(x, pile, 0, w + 6, { height: STREET_GAP.pile, back: 3, top: 1.5, angle: STREET_GAP.face, side: 3 });
    gaps.push({ name: 'Street gap', from: rect(x, lipD - 8, lipD + 0.2, w / 2), to: rect(x, pile + 4.5, pile + 4.5 + 45, w / 2 + 3), points: STREET_GAP.points });
  } else {
    roof(second + 30, 16, high - 0.9, { apron: 13 });
  }
  // Mid-rises down the other edge, and the courtyard between.
  const far = edge === 'W' ? [b.x1 - 26, b.x1] : [b.x0, b.x0 + 26];
  const column = buildingColumn(b, far[0]!, far[1]!, row.top + 6, row.bottom - 6, edge === 'W' ? 'E' : 'W', { shops: true, min: 30, max: 44 });
  const cx = edge === 'W' ? (b.x0 + w + b.x1 - 26) / 2 : (b.x0 + 26 + b.x1 - w) / 2;
  strip(cx, row.top + 8, row.bottom - 8, pick([
    ['kinkedRail', 'planters', 'ledges', 'benches', 'downRail', 'barriers', 'poleJam', 'stairs'],
    ['ledges', 'kickerRail', 'planters', 'aFrame', 'benches', 'dropBank', 'barrels'],
  ]));
  // A wallride on the mid-rises' wall facing the courtyard.
  wallrides(column, edge === 'W' ? b.x1 - 26 : b.x0 + 26, edge === 'W' ? 1 : -1, 1, 1);
  return cx;
}
/** The named roof gaps' sizes and points. */
const ROOF_GAP = { alley: 5, alleyPoints: 250 };
/** The Street gap: the lip roof stops this far above the cross street, its eave and lip, the pile's back this far past the lip, its height and face, and its points. */
const STREET_GAP = { short: 2, eave: 4.6, lip: 0.6, pileAt: 9, pile: 2.2, face: 20, points: 500 };

/** A rectangle across x ± half from d0 to d1, as a gap polygon. */
function rect(x: number, d0: number, d1: number, half: number): Json[] {
  return [xz(x - half, d0), xz(x + half, d0), xz(x + half, d1), xz(x - half, d1)];
}

/**
 * A wallride on a building's wall: wooden boards curving up to 80° beside
 * the wall at x (the roof's edge), its foot running down the hill from d,
 * the wall to its `side` (1: the wall is east of the foot).
 */
function wallride(wallX: number, side: 1 | -1, d: number, length = WALLRIDE.length): void {
  const foot = wallX - side * WALLRIDE.off;
  features.push({ type: 'quarter', ...xz(foot, d), yaw: 0, side, length, radius: WALLRIDE.radius, wallAngle: WALLRIDE.angle, deckWidth: WALLRIDE.deck, back: WALLRIDE.back, taper: WALLRIDE.taper, style: 'wood' });
}
/** A wallride's size, and how far its foot stands out from the building's roof edge (its transition, deck and a clear strip under the eaves). */
const WALLRIDE = { length: 18, radius: 3.4, angle: 80, deck: 0.6, back: 2, taper: 3.5, off: 3.4 * Math.sin(80 * DEG) + 0.6 + 0.9, before: 6, past: 14 };

/** A stair street: a pedestrian street of stair sets and handrails down the block's middle, mid-rises either side. */
function stairStreet(b: Block): number {
  const { row } = b;
  const cx = (b.x0 + b.x1) / 2;
  buildingColumn(b, b.x0, b.x0 + 28, row.top + 4, row.bottom - 4, 'W', { shops: true });
  buildingColumn(b, b.x1 - 28, b.x1, row.top + 10, row.bottom - 4, 'E', { shops: true });
  strip(cx, row.top + 6, row.bottom - 4, pick([
    ['stairs', 'planters', 'bigStairs', 'ledges', 'stairs', 'benches', 'stairs', 'kinkedRail'],
    ['bigStairs', 'ledges', 'stairs', 'planters', 'bigStairs', 'barriers', 'stairs'],
  ]), 6);
  return cx;
}

/** A plaza: an open block of trees, benches, planters, rails and a drop onto a bank; mid-rises at its two bottom corners. */
function plaza(b: Block): number {
  const { row } = b;
  const cx = (b.x0 + b.x1) / 2;
  highrise(b.x0 + 11, row.bottom - 46, 40, 22, tallFor(row), 'block', pick(BLOCK_COLORS), 'W', pick(SHOP_SIGNS));
  highrise(b.x1 - 11, row.bottom - 46, 40, 22, tallFor(row), 'block', pick(BLOCK_COLORS), 'E', pick(SHOP_SIGNS));
  strip(cx - 14, row.top + 8, row.bottom - 50, pick([['benches', 'kinkedRail', 'planters', 'dropBank', 'barrels'], ['planters', 'downRail', 'benches', 'ledges']]));
  strip(cx + 14, row.top + 14, row.bottom - 50, pick([['ledges', 'planters', 'aFrame', 'benches', 'kickerRail'], ['dropBank', 'benches', 'kinkedRail', 'planters']]));
  strip(cx, row.bottom - 44, row.bottom - 4, ['stairs', 'planters']);
  // Trees in two beds down the plaza's middle.
  for (const k of [0, 1]) {
    const d = row.top + 30 + k * 60;
    decor.push({ kind: 'pine', area: { x: r1(cx), z: r1(-(d + 12)), width: 8, length: 22 }, count: 6, seed: 300 + decor.length, minScale: 0.7, maxScale: 1.1, solid: true });
  }
  return cx - 14;
}

/** An alley: two rows of mid-rises with a wide alley between, wallrides on both walls, barriers, barrels, rails. */
function alley(b: Block): number {
  const { row } = b;
  const w = 32;
  const west = buildingColumn(b, b.x0, b.x0 + w, row.top + 4, row.bottom - 4, 'W', { gap: 8, min: 40, max: 56, shops: true });
  const east = buildingColumn(b, b.x1 - w, b.x1, row.top + 4, row.bottom - 4, 'E', { gap: 8, min: 40, max: 56, shops: true });
  wallrides(west, b.x0 + w, -1, 2);
  wallrides(east, b.x1 - w, 1, 1, 1);
  const cx = (b.x0 + b.x1) / 2;
  strip(cx, row.top + 40, row.bottom - 6, pick([['barriers', 'poleJam', 'kinkedRail'], ['dumpster', 'downRail', 'barriers']]), 22);
  return cx;
}

/**
 * Downtown: a glass tower at the back of the block, its plaza beside it
 * (stairs and handrails down its front, ledges and planters on it), a
 * mid-rise in the other corner.
 */
function towerBlock(b: Block, side: 'W' | 'E', height: number): number {
  const { row } = b;
  const tw = 34;
  const tx = side === 'W' ? b.x0 + tw / 2 + 2 : b.x1 - tw / 2 - 2;
  highrise(tx, row.top + 70, 40, tw, height, 'tower', pick(TOWER_COLORS), side === 'W' ? 'E' : 'W');
  highrise(side === 'W' ? b.x1 - 15 : b.x0 + 15, row.top + 8, 36, 28, tallFor(row), 'block', pick(BLOCK_COLORS), side === 'W' ? 'E' : 'W', pick(SHOP_SIGNS));
  const px = side === 'W' ? b.x1 - 24 : b.x0 + 24;
  // The tower plaza: 26 m level on the slope, stairs down its front.
  const h = terrace(px, row.top + 58, 26, 22, 8, 0);
  box('ledge', LEDGE.width, [[px - 9, row.top + 62, LEDGE.height], [px - 9, row.top + 80, LEDGE.height]]);
  box('planter', PLANTER.width, [[px + 8, row.top + 64, PLANTER.height], [px + 8, row.top + 70, PLANTER.height]]);
  const below = row.top + 58 + 26 + h / Math.tan(22 * DEG) + 6;
  strip(px, below, row.bottom - 6, pick([['kinkedRail', 'planters', 'barriers'], ['ledges', 'benches', 'downRail']]), 7, true);
  strip((b.x0 + b.x1) / 2, row.top + 10, row.top + 54, ['benches', 'planters']);
  // The open middle: the corner mid-rise stands above the plaza.
  return (b.x0 + b.x1) / 2;
}

/**
 * The garage and the Tower gap: a parking garage with a long drift up its
 * uphill end, a flat roof and a lip, a gap over an alley onto a lower
 * building's roof that slopes down to a landing drift.
 */
function garageBlock(b: Block): Line {
  const { row } = b;
  const cx = (b.x0 + b.x1) / 2;
  const g = TOWER_GAP;
  const d = row.top + 6;
  shop(cx, d + g.drift, { length: g.roof, width: g.width, eave: g.eave, roof: 'flat', drift: g.drift, lip: g.lip, style: 'shop', color: '#8f969c', front: front('W', 0), sign: 'Parking' });
  const lipD = d + g.drift + g.roof;
  const land = lipD + g.gap;
  shop(cx, land, { length: g.lower, width: g.width + 4, eave: g.lowEave, roof: 'shed', rise: g.lowRise, apron: g.apron, style: 'shop', color: pick(SHOP_COLORS), front: front('E', 0), sign: pick(SHOP_SIGNS) });
  gaps.push({ name: 'Tower gap', from: rect(cx, lipD - 8, lipD + 0.2, g.width / 2), to: rect(cx, land, land + g.lower + g.apron + 10, g.width / 2 + 3), points: g.points });
  notes.push(`Tower gap: lip at d ${r1(lipD)}, eave ${g.eave} + lip ${g.lip}, gap ${g.gap} m onto a roof ${g.lowEave + g.lowRise} m up`);
  // Towers either side of it.
  highrise(b.x0 + 16, row.top + 20, 36, 28, 46 + rand() * 20, 'tower', pick(TOWER_COLORS), 'E');
  highrise(b.x1 - 16, row.top + 100, 40, 28, 52 + rand() * 24, 'tower', pick(TOWER_COLORS), 'W');
  strip(cx, land + g.lower + g.apron + 8, row.bottom - 6, ['kinkedRail', 'planters', 'benches']);
  // Round the garage's east side, then back to the middle below its landing drift (the tower lower down stands east).
  return [[cx + 20, 2], [cx + 20, d - row.top + g.drift + g.roof + g.gap + g.lower - 4], [cx, land - row.top + g.lower + g.apron + 6], [cx, row.bottom - row.top - 2]];
}
/** The Tower gap's garage: its drift and roof (m), roof width and eave, lip; the gap; the lower roof (length, eave, shed rise) and its landing drift. */
const TOWER_GAP = { drift: 34, roof: 26, width: 18, eave: 7.5, lip: 0.6, gap: 8, lower: 22, lowEave: 3.2, lowRise: 1.2, apron: 16, points: 600 };

// ---------------------------------------------------------------- laying out the blocks
const COLS: [number, number][] = [];
for (let i = 0; i + 1 < AVES.length; i++) COLS.push([AVES[i]! + LINE, AVES[i + 1]! - LINE]);

/** A block's open line: straight down at x, or waypoints [x, m down from the row's top]. */
type Line = number | [number, number][];
type Template = (b: Block) => Line;
const GRID: Template[][] = [
  [(b) => rooftops(b, 'W', { alleyGap: 'Old town alley gap' }), plaza, stairStreet, alley],
  [stairStreet, alley, (b) => rooftops(b, 'E', { alleyGap: 'Market alley gap' }), plaza],
  // The Street gap's roofs on the west edge, so it lands in the plaza's open west side below.
  [(b) => rooftops(b, 'W', { streetGap: true }), alley, plaza, stairStreet],
  [plaza, stairStreet, alley, (b) => rooftops(b, 'E', { alleyGap: 'Foundry alley gap' })],
  [(b) => rooftops(b, 'W', {}), plaza, stairStreet, alley],
  [(b) => towerBlock(b, 'W', 92), garageBlock, (b) => towerBlock(b, 'E', 108), (b) => towerBlock(b, 'W', 74)],
  [(b) => towerBlock(b, 'E', 64), (b) => towerBlock(b, 'W', 118), (b) => towerBlock(b, 'E', 86), (b) => towerBlock(b, 'W', 58)],
];
/** Each block's open line (x) down it, by row and column, for the block runs. */
const LINES: Line[][] = ROWS.map((row, r) => COLS.map(([x0, x1], c) => GRID[r]![c]!({ x0, x1, row, col: c })));

// ---------------------------------------------------------------- the avenues
// Plow banks along both curbs (open at every cross street and wherever an
// alley or drift meets the street), and in each block a few features in the
// lanes either side of a clear middle: barriers, a ledge, a kinked rail.
const LANE = 5.5;
AVES.forEach((X, a) => {
  ROWS.forEach((row, r) => {
    for (const s of [-1, 1] as const) {
      const yaw = s > 0 ? -90 : 90;
      // Two banks per side, a gap between them at the middle of the block.
      const mid = (row.top + row.bottom) / 2;
      for (const [d0, d1] of [[row.top + 6, mid - 6], [mid + 6, row.bottom - 6]] as const) {
        bank(X + s * BANK.from, (d0 + d1) / 2, yaw, d1 - d0);
      }
    }
    // Street features: on alternate sides of the clear middle.
    const s = (a + r) % 2 === 0 ? 1 : -1;
    const lane = X + s * LANE;
    const list = row.index >= 5 ? ['ledges', 'cars'] : pick([['barriers', 'kinkedRail'], ['ledges', 'cars', 'downRail'], ['kickerRail', 'benches'], ['planters', 'aFrame']]);
    towardSide = -s;
    strip(lane, row.top + 14, row.bottom - 20, list, 40);
    towardSide = null;
  });
});

// ---------------------------------------------------------------- the top of town
// Small shops and houses round the start plaza, between the avenues' heads
// (a square kept open round the start deck), their doors on the top cross
// street; benches and planters on the plaza, cars parked on the street.
const TOP_SQUARE = 30;
const top = random(91);
const topPick = <T>(list: readonly T[]): T => list[Math.floor(top() * list.length)]!;
for (const [c0, c1] of COLS) {
  const x0 = c0 > 0 ? Math.max(c0, TOP_SQUARE) : c0;
  const x1 = c1 < 0 ? Math.min(c1, -TOP_SQUARE) : c1;
  const n = (x1 - x0) > 60 ? 3 : 2;
  const gap = 6;
  const w = (x1 - x0 - gap * (n - 1)) / n;
  for (let i = 0; i < n; i++) {
    const x = x0 + w / 2 + i * (w + gap);
    highrise(x, 4, 26, w, 5.5 + top() * 3, 'block', topPick(BLOCK_COLORS), 'S', top() < 0.7 ? topPick(SHOP_SIGNS) : '');
  }
}
box('planter', PLANTER.width, [[-9, 5, PLANTER.height], [-9, 5 + PLANTER.length, PLANTER.height]]);
box('planter', PLANTER.width, [[9, 5, PLANTER.height], [9, 5 + PLANTER.length, PLANTER.height]]);
box('bench', BENCH.width, [[10, 24, BENCH.height], [10, 24 + BENCH.length, BENCH.height]]);
for (const x of [-180, -62, 62, 180]) makers.cars!(x, CROSS[0]! + 4);

// ---------------------------------------------------------------- the outskirts
// Both edges past the outer avenues: small houses whose gable roofs ride
// like Freeride's chalets (up a drift, off the ridge, onto a landing drift),
// trees between them; outside the play area, more houses and forest.
const CHALET_COLORS = ['#7a4f2c', '#8a5a32', '#6e4a2e', '#9a6a3c', '#d8cbb0', '#c9b48e'];
for (const s of [-1, 1] as const) {
  const x = s * (AVES[4]! + LINE + 18);
  ROWS.forEach((row, r) => {
    if (r >= 5) return;
    for (const u of [20, 110]) {
      shop(x, row.top + u, { length: 12, width: 11, eave: 3, roof: 'gable', rise: 2.2, drift: 12, apron: 20, style: 'chalet', color: pick(CHALET_COLORS), front: front(s > 0 ? 'W' : 'E', 0) });
    }
  });
  decor.push({ kind: 'pine', area: { x: r1(s * 292), z: -600, width: 12, length: 1100 }, count: 60, seed: 500 + decor.length, minScale: 0.8, maxScale: 1.4, solid: true });
}

// Scenery past the edges: houses up the hillsides, the old town above the top, towers past the bottom.
const scenery = random(77);
for (const s of [-1, 1] as const) {
  for (let d = -60; d < END + 60; d += 34) {
    const x = s * (WIDTH / 2 + 30 + scenery() * 50);
    const len = 12 + scenery() * 6;
    highrise(x, d, len, 12 + scenery() * 6, d > SQUARE.top - 200 ? 18 + scenery() * 30 : 4 + scenery() * 4, d > SQUARE.top - 200 ? 'block' : 'block', pick(d > SQUARE.top - 200 ? BLOCK_COLORS : CHALET_COLORS), s > 0 ? 'W' : 'E');
  }
}
for (let x = -WIDTH / 2 + 30; x < WIDTH / 2 - 20; x += 46) {
  highrise(x + scenery() * 10, -44 - scenery() * 20, 14, 18, 5 + scenery() * 3, 'block', pick(CHALET_COLORS), 'S');
}
for (const [x, h] of [[-250, 140], [-170, 96], [-90, 160], [-10, 124], [70, 178], [150, 110], [230, 150], [300, 90]] as const) {
  highrise(x, END + 30 + scenery() * 40, 30, 30, h, 'tower', pick(TOWER_COLORS), 'N');
}
decor.push({ kind: 'pine', area: { x: -440, z: -800, width: 120, length: 1900 }, count: 900, seed: 41, minScale: 0.9, maxScale: 1.6 });
decor.push({ kind: 'pine', area: { x: 440, z: -800, width: 120, length: 1900 }, count: 900, seed: 42, minScale: 0.9, maxScale: 1.6 });

// ---------------------------------------------------------------- start, square, flags, runs
features.unshift({ type: 'start', style: 'deck', x: 0, z: -16, heading: 0, height: 0.6 });
// The square: a big tree, the finish arch over Main Street, the finish line across the whole city.
decor.push({ kind: 'pine', spots: [xz(-60, 1636), xz(60, 1636)], seed: 9, minScale: 2.6, maxScale: 3, solid: true });
const finish = { x: 0, z: -(SQUARE.top + 40), heading: 0, width: WIDTH - 30, length: 70, arch: { x: 0, z: -(SQUARE.top + 12), width: 30 } };

// A flag across each avenue at the top of every row.
for (const X of AVES) for (const row of ROWS) flags.push({ ...xz(X, row.top + 2), heading: 0, width: 20 });

// A run down each column of blocks, through every block's open line (its
// stair street, courtyard, plaza, alley or tower plaza), crossing over at
// each cross street: the headless rider's check of the blocks themselves.
const BLOCK_RUNS = ['Blocks: West', 'Blocks: Middle west', 'Blocks: Middle east', 'Blocks: East'];
const lineAt = (line: Line, row: Row): [number, number][] => (typeof line === 'number' ? [[line, 2], [line, row.bottom - row.top - 2]] : line);
COLS.forEach((_, c) => {
  const pts: Json[] = [xz(lineAt(LINES[0]![c]!, ROWS[0]!)[0]![0], CROSS[0]! + STREET / 2)];
  ROWS.forEach((row, r) => {
    const way = lineAt(LINES[r]![c]!, row);
    for (const [x, d] of way) pts.push(xz(x, row.top + d));
    const next = r + 1 < ROWS.length ? lineAt(LINES[r + 1]![c]!, ROWS[r + 1]!)[0]![0] : undefined;
    if (next !== undefined) pts.push(xz(next, row.bottom + STREET / 2));
  });
  const last = lineAt(LINES[ROWS.length - 1]![c]!, ROWS[ROWS.length - 1]!);
  pts.push(xz(last[last.length - 1]![0], SQUARE.top + 60));
  runs.push({ name: BLOCK_RUNS[c], points: pts, clear: 3 });
});

for (const [i, X] of AVES.entries()) {
  const pts = [xz(X, 52)];
  for (let d = 200; d < SQUARE.top + 60; d += 200) pts.push(xz(X, d));
  pts.push(xz(X, SQUARE.top + 60));
  runs.push({ name: AVE_NAMES[i], points: pts, clear: 10 });
}

// ---------------------------------------------------------------- decoration
// Street lamps down every avenue every 25 m on alternate sides, and along
// every cross street; a sign at the top naming the avenues.
for (const X of AVES) {
  const west: Json[] = [];
  const east: Json[] = [];
  let i = 0;
  for (let d = 50; d < SQUARE.top; d += 25, i++) (i % 2 === 0 ? west : east).push(xz(X - (LINE - 1), d));
  for (const p of east) p.x = r1((p.x as number) + 2 * (LINE - 1));
  decor.push({ kind: 'streetLamp', points: west, heading: -90, color: '#2f7de1' });
  decor.push({ kind: 'streetLamp', points: east, heading: 90, color: '#ff7a1a' });
}
for (const c of CROSS) {
  const pts: Json[] = [];
  for (let x = -WIDTH / 2 + 30; x < WIDTH / 2 - 20; x += 40) if (AVES.every((X) => Math.abs(x - X) > LINE + 4)) pts.push(xz(x, c + STREET - 1));
  decor.push({ kind: 'streetLamp', points: pts, heading: 0, color: '#33c26a' });
}
for (const X of AVES) for (const c of [CROSS[1]!, CROSS[3]!, CROSS[5]!]) decor.push({ kind: 'bunting', points: [xz(X - AVE.half, c + 6), xz(X + AVE.half, c + 6)] });
// Beside the start deck, out of the way of riders dropping in.
decor.push({ kind: 'sign', ...xz(-12, 30), heading: 0, header: 'City', lines: AVE_NAMES.map((name, i) => ({ text: name, level: 'blue', arrow: Math.sign(AVES[i]!) })) });

// ---------------------------------------------------------------- the map
const map = {
  name: 'City',
  terrain,
  features,
  spawn,
  flags,
  finishes: [finish],
  decor,
  runs,
  gaps,
  colors: { sky: '#8fb6e0', fog: '#d6e2ef' },
  peaks: { seed: 16, count: 13, rings: 3, distance: [7000, 22000], base: -500, height: [900, 2400], snowLine: 300 },
};

// ---------------------------------------------------------------- report
const t0 = performance.now();
const built = buildMap(parseMap(map));
const ms = performance.now() - t0;
const count = (t: string): number => features.filter((f) => f.type === t).length;
console.log(`City: ${features.length} features (${count('building')} buildings, ${count('terrace')} terraces, ${count('rail')} rails, ${count('box')} boxes, ${count('kicker')} kickers, ${count('landing')} banks, ${count('quarter')} wallrides), ${gaps.length} named gaps, ${flags.length} flags, ${runs.length} runs`);
console.log(`built in ${ms.toFixed(0)} ms: ${built.hf.cols}x${built.hf.rows} cells, ${built.hf.shapes?.length ?? 0} shapes, ${built.course.rails.length} rails, ${built.decor.scatter.length} scatter`);
console.log(`drop top to square: ${(gy(0, 0) - gy(0, SQUARE.top)).toFixed(0)} m`);
for (const n of notes) console.log(n);

// Rails, boxes, kickers, banks and wallrides must stand clear of every building.
const inside = (x: number, d: number, pad = 0.3): Footprint | undefined => footprints.find((f) => x > f.x0 - pad && x < f.x1 + pad && d > f.d0 - pad && d < f.d1 + pad);
let clashes = 0;
for (const f of features) {
  if (f.type !== 'rail' && f.type !== 'box' && f.type !== 'kicker' && f.type !== 'quarter') continue;
  const pts = (f.points as { x: number; z: number }[] | undefined) ?? [{ x: f.x as number, z: f.z as number }];
  for (const p of pts) {
    const hit = inside(p.x, -p.z);
    if (hit) {
      clashes++;
      if (clashes <= 12) console.log(`clash: ${f.type} ${String(f.style ?? '')} at (${p.x}, d ${-p.z}) inside a building ${hit.x0.toFixed(0)}..${hit.x1.toFixed(0)}, d ${hit.d0.toFixed(0)}..${hit.d1.toFixed(0)}`);
      break;
    }
  }
}
console.log(`${clashes} features inside a building`);

writeFileSync('src/maps/city.json', `${JSON.stringify(map)}\n`);
console.log('wrote src/maps/city.json');
