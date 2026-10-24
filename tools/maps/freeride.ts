// Lays out the Freeride mountain and writes it to src/maps/freeride.json.
// The map file is the source the game loads; this script is how it was
// authored. Edit here and rerun, from the repo root:
//   node tools/maps/freeride.ts
// Then check it: tools/maps/overview.ts draws it from above, tools/maps/sinks.ts
// finds spots a rider can't roll out of, and tools/sim/face.ts rides every run.
//
// The mountain is built around a summit at x = z = 0 (see src/maps/peak.ts).
// Four faces drop away from it, each with its own character, with a ridge
// between each pair. Positions here are mostly given along a spoke: r meters
// out from the summit, `across` meters to the right of it, facing down.
//   North face (heading 0, toward -Z)   The Steeps: couloirs between rock ribs, two cliff bands, pillows
//   East face (heading -95)             The Bowl: a corniced cirque, a pillow field below it
//   South face (heading 178)            The Glades: mellow tree runs, logs and stumps, a creek; the town at its base
//   West face (heading 88)              The Gully: rolling terrain with side hits, a long natural halfpipe
// The ridges carry wind lips and booters. Each face ends in a run-out basin
// with a finish arch and a chairlift's bottom station, and the land climbs
// past it into the hills around the mountain; the Glades end in the town,
// whose roofs, stairs, ledges and benches can all be ridden.
//
// Features that need the ground's shape (booters facing down the fall line,
// logs lying on the snow) are placed after the terrain is built, from its
// heights.

import { writeFileSync } from 'node:fs';
import { buildMap, generateTerrain } from '../../src/maps/build.ts';
import { parseMap } from '../../src/maps/loader.ts';
import type { Heightfield } from '../../src/maps/types.ts';
import { insideBounds } from '../../src/sim/bounds.ts';
import { heightAt } from '../../src/sim/terrain.ts';

type Json = Record<string, unknown>;
interface XZ {
  x: number;
  z: number;
}
const r1 = (v: number): number => Math.round(v * 10) / 10;
const DEG = Math.PI / 180;
/**
 * Every distance out from the summit below is stretched by this: the
 * layout was drawn at 1, and this sizes it so a run down any face takes a
 * player 2 to 3 minutes.
 */
const K = 1.5;

// ---------------------------------------------------------------- spokes
const sec = (length: number, pitch: number, ease = 40): Json => ({ length: length * K, pitch, ease });
/** Every spoke starts with the summit's flat top, so they all meet level. */
const TOP = { length: 20, pitch: 3, ease: 10 };

interface Spoke {
  name: string;
  heading: number;
  bend: number;
  sharp: number;
  sharpTo?: number;
  sections: Json[];
}
const SPOKES: Record<string, Spoke> = {
  north: {
    name: 'North face',
    heading: 0,
    bend: 4,
    sharp: 0,
    sections: [TOP, sec(40, 26, 24), sec(300, 39, 30), sec(80, 24, 30), sec(400, 34, 40), sec(450, 25, 60), sec(400, 16, 80), sec(150, 6, 60), sec(200, -14, 60)],
  },
  northeast: {
    name: 'Northeast ridge',
    heading: -48,
    bend: -3,
    sharp: 1.6,
    sharpTo: 700,
    sections: [TOP, sec(180, 24, 24), sec(500, 20, 60), sec(600, 16, 80), sec(400, 12, 80), sec(300, -6, 80)],
  },
  east: {
    name: 'East bowl',
    heading: -95,
    bend: 2,
    sharp: 0,
    sections: [TOP, sec(45, 18, 24), sec(260, 28, 24), sec(380, 18, 60), sec(100, 27, 40), sec(230, 31, 40), sec(450, 21, 60), sec(260, 12, 60), sec(140, 5, 60), sec(200, -14, 60)],
  },
  southeast: {
    name: 'Southeast ridge',
    heading: -140,
    bend: -4,
    sharp: 0.8,
    sharpTo: 500,
    sections: [TOP, sec(200, 21, 24), sec(600, 17, 60), sec(600, 14, 80), sec(380, 10, 80), sec(300, -6, 80)],
  },
  south: {
    name: 'South glades',
    heading: 178,
    bend: -5,
    sharp: 0,
    sections: [TOP, sec(120, 25, 24), sec(330, 22, 40), sec(600, 19, 60), sec(380, 14, 60), sec(180, 9, 60), sec(330, 4.5, 50), sec(200, -12, 60)],
  },
  southwest: {
    name: 'Southwest ridge',
    heading: 132,
    bend: 3,
    sharp: 1,
    sharpTo: 500,
    sections: [TOP, sec(200, 22, 24), sec(600, 17, 60), sec(600, 14, 80), sec(380, 10, 80), sec(300, -6, 80)],
  },
  west: {
    name: 'West gully',
    heading: 88,
    bend: 0,
    sharp: 0,
    sections: [TOP, sec(100, 27, 24), sec(380, 23, 40), sec(800, 18, 60), sec(330, 12, 60), sec(140, 5, 60), sec(200, -14, 60)],
  },
  northwest: {
    name: 'Northwest ridge',
    heading: 42,
    bend: -2,
    sharp: 1.8,
    sharpTo: 700,
    sections: [TOP, sec(180, 25, 24), sec(500, 20, 60), sec(600, 16, 80), sec(400, 12, 80), sec(300, -6, 80)],
  },
};
type SpokeId = keyof typeof SPOKES;

/** Heading (degrees) of a spoke r meters out from the summit (r before stretching). */
function angle(s: SpokeId, r: number): number {
  const k = SPOKES[s]!;
  return k.heading + (k.bend * r * K) / 1000;
}

/** World spot r meters out along a spoke (before stretching) and `across` meters to the right of it, facing down. */
function P(s: SpokeId, r: number, across = 0): XZ {
  const a = angle(s, r) * DEG;
  const rr = r * K;
  return { x: -Math.sin(a) * rr + Math.cos(a) * across, z: -Math.cos(a) * rr - Math.sin(a) * across };
}

const xz = (p: XZ): Json => ({ x: r1(p.x), z: r1(p.z) });
const xzh = (p: XZ, height: number): Json => ({ x: r1(p.x), z: r1(p.z), height });

// ---------------------------------------------------------------- elements
const elements: Json[] = [];

/** A rock rib down a spoke at `across`, with its height at each r. */
function rib(s: SpokeId, across: number, heights: [number, number][], crest = 2, side = 4): void {
  elements.push({ type: 'ridge', points: heights.map(([r, h]) => xzh(P(s, r, across), h)), crest, side, taper: 25 });
}
/**
 * A cliff band across a spoke at r, with its drop at each `across`. Drops
 * stay under about 9 m: a bigger one lands too hard even on a steep slope.
 */
function cliffs(s: SpokeId, r: number, drops: [number, number][], face = 3): void {
  const tallest = Math.max(...drops.map(([, h]) => h));
  elements.push({ type: 'cliffs', points: drops.map(([a, h]) => xzh(P(s, r, a), h)), heading: r1(angle(s, r)), face, bench: r1(2.5 * tallest + 8), taper: 12 });
}
/** A wind lip or cornice along a line of (r, across) spots on a spoke, facing `heading`. */
function lip(s: SpokeId, spots: [number, number][], heading: number, height: number, ramp: number, drop: number): void {
  elements.push({ type: 'lip', points: spots.map(([r, a]) => xz(P(s, r, a))), heading: r1(heading), height, ramp, drop, taper: 15 });
}
/** A gully along (r, across) spots on a spoke. */
function gully(s: SpokeId, spots: [number, number][], floor: number, depth: number, wall: number, taper = 40): void {
  elements.push({ type: 'gully', points: spots.map(([r, a]) => xz(P(s, r, a))), floor, depth, wall, taper });
}
function pillows(s: SpokeId, r: number, across: number, width: number, length: number, count: number, size: [number, number], height: [number, number], seed: number): void {
  const p = P(s, r, across);
  elements.push({ type: 'pillows', x: r1(p.x), z: r1(p.z), heading: r1(angle(s, r)), width, length, count, size, height, seed });
}
/**
 * A pillow line: `count` rounded steps in single file down a spoke from r
 * = top to bottom at `across`, wandering a little side to side, each 2.5 to 3.8 m tall
 * and 11 to 16 m wide.
 */
function pillowLine(s: SpokeId, top: number, bottom: number, across: number, count: number, seed: number): void {
  for (let i = 0; i < count; i++) {
    const rnd = (k: number): number => 0.5 + 0.5 * Math.sin(seed * 12.9898 + i * 78.233 + k * 37.719) * 0.999;
    const r = top + ((bottom - top) * i) / Math.max(1, count - 1);
    const a = across + (rnd(1) - 0.5) * 10;
    const w = 11 + 5 * rnd(2);
    const h = 2.5 + 1.3 * rnd(3);
    const drops: [number, number][] = [
      [a - w / 2, 0],
      [a - w / 4, h * 0.8],
      [a, h],
      [a + w / 4, h * 0.8],
      [a + w / 2, 0],
    ];
    elements.push({ type: 'cliffs', points: drops.map(([x, hh]) => xzh(P(s, r, x), r1(hh))), heading: r1(angle(s, r)), face: 2.5, bench: r1(2.5 * h + 6), taper: 2 });
  }
}
function bumps(s: SpokeId, r: number, across: number, radius: number, amplitude: number, wavelength: number, seed: number): void {
  const p = P(s, r, across);
  elements.push({ type: 'bumps', x: r1(p.x), z: r1(p.z), radius: radius * K, fade: radius * K * 0.35, amplitude, wavelength, seed });
}

// North face, The Steeps. Four rock ribs split the headwall into a narrow
// chute, the main couloir and an open face; a cliff band crosses the bottom
// of the headwall with the couloirs running out through a gap in it. Below
// a bench, a second band with drops of 3 to 9 m (and gaps), then pillows on
// the west side, an open apron and the forest.
rib('north', -44, [[85, 2], [140, 7], [240, 9], [330, 4]]);
rib('north', -14, [[85, 3], [150, 8], [250, 9], [335, 3]]);
rib('north', 14, [[85, 3], [150, 7], [250, 8], [335, 3]]);
rib('north', 58, [[95, 2], [160, 8], [260, 10], [320, 3]], 3, 5);
gully('north', [[90, 0], [200, 0], [345, 0]], 8, 2.5, 7, 30);
gully('north', [[90, -29], [200, -29], [345, -29]], 4, 2, 5, 30);
cliffs('north', 305, [[-175, 1], [-145, 5], [-112, 8], [-82, 6], [-58, 3]]);
cliffs('north', 305, [[32, 2], [60, 5], [92, 8], [122, 4], [150, 6], [178, 2]]);
cliffs('north', 625, [[-205, 2], [-165, 4], [-125, 3], [-95, 0], [-62, 6], [-30, 9], [2, 5], [24, 0], [60, 0], [92, 3], [130, 7], [168, 4], [205, 2]]);
pillows('north', 755, -150, 120, 140, 26, [4, 7], [1.5, 3.5], 5);
// The pillow line: snow-capped rocks stacked down the steep upper face,
// east of the cliff band. Each is a short rounded step whose top slopes
// downhill, so every drop lands on the next one's top, never on a flat.
pillowLine('north', 205, 330, 245, 9, 31);
bumps('north', 1060, 0, 320, 1.6, 46, 7);
// The apron: a low rock band with gaps, and wind-drifted lips to boost off.
cliffs('north', 1150, [[-150, 0], [-120, 3], [-90, 5], [-62, 3], [-40, 0]]);
cliffs('north', 1150, [[55, 0], [80, 4], [108, 3], [135, 0]]);
for (const [r, a] of [[970, -80], [1040, 120], [1250, -30], [1330, 70]] as const) lip('north', [[r, a - 9], [r + 2, a], [r, a + 9]], angle('north', r), 1.6, 10, 4);

// Northeast ridge: a knife-edge arête, wind lips along it facing the bowl.
lip('northeast', [[210, 8], [260, 9], [320, 8]], angle('northeast', 260) - 90, 1.8, 10, 4);
lip('northeast', [[400, 10], [470, 12], [540, 10]], angle('northeast', 470) - 90, 2.2, 12, 4);
lip('northeast', [[640, -10], [700, -12], [760, -10]], angle('northeast', 700) + 90, 2, 12, 4);
lip('northeast', [[900, 12], [950, 14], [1000, 12]], angle('northeast', 950) - 90, 2, 12, 4);

// East face, The Bowl: a cornice along the rim (with a gap to roll in
// through), the cirque itself, a little cliff island in the floor, and a
// pillow field on the rollover below it.
lip('east', [[96, -125], [80, -90], [72, -55], [70, -22]], angle('east', 75), 3.2, 14, 5);
lip('east', [[70, 22], [72, 55], [80, 90], [96, 125]], angle('east', 75), 3.2, 14, 5);
elements.push({ type: 'bowl', ...xz(P('east', 82)), heading: r1(angle('east', 82)), length: 640 * K, width: 640, depth: 60, head: 280, exit: 300 * K, rim: 160 });
cliffs('east', 520, [[40, 0], [60, 3], [85, 4], [105, 3], [125, 0]]);
pillows('east', 915, -40, 240, 200, 40, [4, 8], [1.5, 4], 9);
bumps('east', 1250, 0, 300, 1.4, 50, 11);
// Lower down: a smaller pillow cluster and a little rock band.
pillows('east', 1150, 120, 120, 100, 14, [3, 6], [1.2, 3], 21);
cliffs('east', 1330, [[-150, 0], [-125, 3], [-95, 4], [-70, 2], [-50, 0]]);

// Southeast ridge: broad, a few lips facing the glades.
lip('southeast', [[300, 12], [350, 14], [400, 12]], angle('southeast', 350) + 90, 1.8, 10, 4);
lip('southeast', [[620, 14], [680, 16], [740, 14]], angle('southeast', 680) + 90, 2.2, 12, 4);

// South face, The Glades: rolling ground through the trees, two small cliff
// bands in them, a creek gully, and the town site flattened at the bottom.
bumps('south', 1050, 0, 420, 1.8, 40, 13);
cliffs('south', 960, [[-70, 0], [-50, 2], [-25, 3], [0, 2], [20, 0]]);
cliffs('south', 1210, [[40, 0], [60, 3], [85, 4], [110, 3], [130, 0]]);
gully('south', [[880, 150], [1050, 165], [1220, 140], [1420, 155]], 6, 3, 8, 50);
cliffs('south', 1400, [[-125, 0], [-100, 3], [-70, 4], [-45, 3], [-20, 0]]);
for (const [r, a] of [[920, -90], [1100, 60], [1260, -110]] as const) lip('south', [[r, a - 8], [r + 2, a], [r, a + 8]], angle('south', r), 1.5, 9, 4);

// Southwest ridge: lips facing the gully side.
lip('southwest', [[320, -12], [380, -14], [440, -12]], angle('southwest', 380) - 90, 2, 12, 4);
lip('southwest', [[700, -14], [760, -16], [820, -14]], angle('southwest', 760) - 90, 2.4, 12, 4);
lip('southwest', [[1000, -14], [1050, -16], [1100, -14]], angle('southwest', 1050) - 90, 2, 12, 4);

// West face, The Gully: rolling terrain with side hits everywhere, a long
// winding gully dug into it (a natural halfpipe), rollers at the bottom.
bumps('west', 760, 0, 620, 2.2, 48, 17);
gully('west', [[470, 10], [640, -6], [840, 14], [1040, 0], [1240, 12], [1360, 0]], 14, 7, 8, 60);
bumps('west', 1450, 0, 220, 1.5, 34, 19);
// A creek down the rollers, and lips to boost off beside it.
gully('west', [[1300, -180], [1420, -200], [1560, -170]], 5, 2.5, 7, 40);
for (const [r, a] of [[1000, -220], [1150, -160]] as const) lip('west', [[r, a - 9], [r + 2, a], [r, a + 9]], angle('west', r), 1.6, 10, 4);

// Northwest ridge: lips facing west.
lip('northwest', [[230, -8], [290, -10], [350, -8]], angle('northwest', 290) - 90, 1.8, 10, 4);
lip('northwest', [[520, -12], [580, -14], [640, -12]], angle('northwest', 580) - 90, 2.2, 12, 4);
// Where the ridge's rounded end meets the hills, tip it down toward the North valley so it can't hold a hollow.
{
  const p = P('northwest', 1600, 150);
  elements.push({ type: 'dip', x: r1(p.x), z: r1(p.z), radius: 350, depth: 18 });
}

// The summit: a flat top for the start, where a rider can turn to face any way down.
elements.push({ type: 'flat', x: 0, z: 0, heading: 0, pitch: 0, radius: 16, blend: 18 });
// The town at the bottom of the glades: a broad flat at the same pitch as
// the glades' run-out, so riders roll through it at jibbing speed. Places
// in town are given as T(u, v): u m down the town from its top edge, v m
// across to the right (facing down).
const TOWN = { r: 1790, width: 320, length: 400, pitch: 4.5 };
const TH = angle('south', TOWN.r);
function T(u: number, v = 0): XZ {
  const c = P('south', TOWN.r);
  const a = TH * DEG;
  const uu = u - TOWN.length / 2;
  return { x: c.x - Math.sin(a) * uu + Math.cos(a) * v, z: c.z - Math.cos(a) * uu - Math.sin(a) * v };
}
{
  const c = T(TOWN.length / 2);
  elements.push({ type: 'flat', ...xz(c), heading: r1(TH), pitch: TOWN.pitch, width: TOWN.width, length: TOWN.length, blend: 60 });
}

// ---------------------------------------------------------------- flags
// Gates across each face's main lines, near the top and on shoulders lower
// down, so a respawn puts a rider back on the line they were riding.
const flags: Json[] = [];
function flag(s: SpokeId, r: number, across: number, width: number): void {
  const p = P(s, r, across);
  flags.push({ x: r1(p.x), z: r1(p.z), heading: r1(angle(s, r)), width });
}
flag('north', 62, 0, 14); // main couloir
flag('north', 62, -29, 10); // narrow chute
flag('north', 70, 80, 16); // big face
flag('north', 400, -40, 18);
flag('north', 400, 90, 18);
flag('north', 870, 0, 24);
flag('north', 180, 245, 18); // pillow line
flag('northeast', 130, 0, 16);
flag('east', 50, 0, 18); // bowl entrance
flag('east', 600, 0, 24);
flag('east', 785, -40, 20); // pillows
flag('east', 1080, 0, 24);
flag('southeast', 130, 0, 16);
flag('south', 60, 0, 18);
flag('south', 790, 0, 22);
flag('south', 1180, -30, 22);
// The top of town, across the street and the drifts up to the roofs on either side.
{
  const p = T(14);
  flags.push({ ...xz(p), heading: r1(TH), width: 64 });
}
flag('southwest', 130, 0, 16);
flag('west', 60, 0, 18);
flag('west', 445, 10, 18); // gully top
flag('west', 1300, -60, 22);
flag('northwest', 130, 0, 16);

// ---------------------------------------------------------------- finishes and bounds
/** Where each face's finish line crosses its run-out (r, before stretching), and how far past it the basin runs to the edge. */
const FINISH: Partial<Record<SpokeId, { r: number; length: number }>> = {
  north: { r: 1730, length: 110 },
  east: { r: 1765, length: 110 },
  // The bottom of town (u 335), to just past the town's bottom edge.
  south: { r: (TOWN.r * K + 335 - TOWN.length / 2) / K, length: 90 },
  west: { r: 1650, length: 110 },
};
/** Where the town's finish line crosses the town (u), and its arch's width. */
const TOWN_FINISH = 335;
const ARCH = 18;

const finishes: Json[] = [];
for (const [s, f] of Object.entries(FINISH) as [SpokeId, { r: number; length: number }][]) {
  if (s === 'south') {
    // Across the whole bottom of town, with the arch over the main street.
    const p = T(TOWN_FINISH);
    finishes.push({ ...xz(p), heading: r1(TH), width: TOWN.width - 20, length: f.length, arch: { ...xz(p), width: ARCH } });
    continue;
  }
  // A wide zone across the basin floor (sized below), with the arch where the runs come together.
  const p = P(s, f.r);
  finishes.push({ x: r1(p.x), z: r1(p.z), heading: r1(angle(s, f.r)), width: 0, length: f.length, arch: { x: r1(p.x), z: r1(p.z), width: ARCH } });
  // The run-out basin: a broad dip around the finish zone draws in riders
  // from the whole bottom of the valley, so none are left on flat ground
  // where the valley side meets the hills around it. (The glades end in the
  // town, which stays flat.)
  const mid = P(s, f.r + f.length / 2 / K);
  elements.push({ type: 'dip', x: r1(mid.x), z: r1(mid.z), radius: 875, depth: 35 });
}

/**
 * The play area's edge: past each finish along the faces, and along each
 * ridge a little short of the col where its spur meets the hills around the
 * mountain, so the rim of hills lifts the end of the ridge and a rider
 * coming down it finds the ground rising ahead and falling away to either
 * side, not a wall or a hollow. Straight between.
 */
function boundsPolygon(): XZ[] {
  const reach: { a: number; r: number }[] = [];
  for (const s of Object.keys(SPOKES) as SpokeId[]) {
    const f = FINISH[s];
    let r: number;
    if (f) {
      r = f.r * K + f.length;
    } else {
      // The col: where the spoke's last section (the climb) starts.
      const sections = SPOKES[s]!.sections as { length: number }[];
      r = sections.slice(0, -1).reduce((sum, x) => sum + x.length, 0) - 60;
    }
    reach.push({ a: ((angle(s, r / K) % 360) + 360) % 360, r });
  }
  reach.sort((p, q) => p.a - q.a);
  const out: XZ[] = [];
  for (let i = 0; i < reach.length; i++) {
    const a = reach[i]!;
    const b = reach[(i + 1) % reach.length]!;
    const span = (((b.a - a.a) % 360) + 360) % 360;
    const steps = Math.ceil(span / 3);
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const ang = (a.a + span * t) * DEG;
      const r = a.r + (b.r - a.r) * t;
      out.push({ x: r1(-Math.sin(ang) * r), z: r1(-Math.cos(ang) * r) });
    }
  }
  return out;
}

const terrain = {
  type: 'peak',
  size: 6200,
  cellSize: 3,
  summit: 3150,
  spokes: Object.values(SPOKES),
  roll: { amplitude: 1.2, wavelength: 90 },
  relief: { amplitude: 16, wavelength: 300 },
  elements,
  bounds: boundsPolygon(),
  rim: { inset: 80, ramp: 90, rise: 0.4 },
  rockSlope: 56,
  noise: 0.2,
  rockNoise: 0.9,
  seed: 21,
};

// ---------------------------------------------------------------- the ground, for placing features
// Features don't change the terrain, so it's built once here, alone, and
// the features that follow the ground are placed on it.
const ground: Heightfield = generateTerrain(
  parseMap({
    name: 'Freeride',
    terrain,
    features: [],
    spawn: { x: 0, z: 0, heading: 0 },
    flags: [],
    finishes: [{ x: 0, z: 0, heading: 0, width: 1, length: 1 }],
    colors: { sky: '#000000', fog: '#000000' },
  }).terrain,
);
const gy = (p: XZ): number => heightAt(ground, p.x, p.z);
/** The way straight down at p (a heading, degrees) and how steep it is there (degrees), measured over `span` m. */
function fall(p: XZ, span = 6): { heading: number; slope: number } {
  const gx = (gy({ x: p.x + span, z: p.z }) - gy({ x: p.x - span, z: p.z })) / (2 * span);
  const gz = (gy({ x: p.x, z: p.z + span }) - gy({ x: p.x, z: p.z - span })) / (2 * span);
  return { heading: Math.atan2(gx, gz) / DEG, slope: Math.atan(Math.hypot(gx, gz)) / DEG };
}
/** The spot `d` m from p along heading h (degrees). */
const ahead = (p: XZ, h: number, d: number): XZ => ({ x: p.x - Math.sin(h * DEG) * d, z: p.z - Math.cos(h * DEG) * d });

// ---------------------------------------------------------------- features
const start = { type: 'start', style: 'ridge', x: 0, z: 0, heading: 0 };
const features: Json[] = [start];
const warnings: string[] = [];

// ---- the town
// The main street runs down the middle (v from -10 to 10): benches, a
// ledge and a kicker to a rail above the plaza; the plaza across the
// street, with a stair set and handrails down its front; a kinked rail,
// ledges and a booter below it; the finish arch at the bottom. Left of the
// street, a row of shops whose flat roofs step down, reached up a drift at
// the top, with a gap over an alley and a landing drift at the end, and
// another row below the plaza. Right of it, chalets whose gable roofs kick
// riders off their ridges onto landing drifts, and the lodge with a roof
// to drop off. More chalets stand in the trees round the edge of town.
const TY = r1(TH);
/** A building with the uphill edge of its roof u m down the town, centered v m across. */
function building(u: number, v: number, b: Json): void {
  features.push({ type: 'building', ...xz(T(u, v)), yaw: TY, ...b });
}
const townPts = (pts: [number, number, number][]): Json[] => pts.map(([u, v, hh]) => xzh(T(u, v), hh));
function townBox(style: string, width: number, pts: [number, number, number][]): void {
  features.push({ type: 'box', style, width, points: townPts(pts) });
}
function townRail(pts: [number, number, number][], style = 'metal'): void {
  features.push({ type: 'rail', style, points: townPts(pts) });
}
/** A kicker down the street at u, v, and a rail (or box, `width` > 0) from just past its lip, `length` m long, ending `drop` m lower than it starts. */
function townKickerRail(u: number, v: number, length: number, drop = 0, width = 0): void {
  const lip = 0.6;
  const angle = 14;
  const lipAt = u + (2 * lip) / Math.tan(angle * DEG);
  features.push({ type: 'kicker', ...xz(T(u, v)), yaw: TY, width: 2.6, sideWidth: 1.2, lipHeight: lip, lipAngle: angle });
  const a = lipAt + 1;
  const pts: [number, number, number][] = drop > 0 ? [[a, v, lip], [a + length / 2, v, lip], [a + length, v, lip - drop]] : [[a, v, lip], [a + length, v, lip]];
  if (width > 0) townBox('ledge', width, pts);
  else townRail(pts);
}

// The rooftops, left of the street: each shop's roof a little lower than the last.
const ROOF = { v: -22, width: 14 };
building(48, ROOF.v, { length: 16, width: ROOF.width, eave: 3.8, roof: 'flat', drift: 16, style: 'shop', color: '#c8553d', front: 'right', sign: 'Bakery' });
building(64, ROOF.v, { length: 16, width: ROOF.width, eave: 3.35, roof: 'flat', style: 'shop', color: '#3f7fbf', front: 'right', sign: 'Ski shop' });
building(80, ROOF.v, { length: 16, width: ROOF.width, eave: 2.9, roof: 'flat', lip: 0.4, style: 'shop', color: '#e0b84a', front: 'right', sign: 'Cafe' });
// (a 4 m alley, gapped from the cafe's lip onto a roof 0.8 m lower)
building(100, ROOF.v, { length: 16, width: ROOF.width, eave: 2.4, roof: 'shed', rise: 0.4, style: 'shop', color: '#6a8f5a', front: 'right', sign: 'Rentals' });
building(116, ROOF.v, { length: 14, width: ROOF.width, eave: 2.3, roof: 'flat', apron: 14, style: 'shop', color: '#e8e0d0', front: 'right', sign: 'Books' });
// Below the plaza, another row: up a drift, two steps down, a landing drift.
building(188, ROOF.v, { length: 14, width: ROOF.width, eave: 3.8, roof: 'flat', drift: 15, style: 'shop', color: '#b8483a', front: 'right', sign: 'Pizza' });
building(202, ROOF.v, { length: 14, width: ROOF.width, eave: 3.3, roof: 'flat', style: 'shop', color: '#4f6fa8', front: 'right', sign: 'Outfitters' });
building(216, ROOF.v, { length: 14, width: ROOF.width, eave: 2.9, roof: 'shed', rise: 0.5, apron: 13, style: 'shop', color: '#d9a441', front: 'right', sign: 'Market' });

// Chalets, right of the street: up the drift, up the roof, off the ridge, down the landing drift.
const chalet = (u: number, v: number, color: string, size = 1): void =>
  building(u, v, { length: 12 * size, width: 11 * size, eave: 3.0, roof: 'gable', rise: 2.2 * size, drift: 12, apron: 20, style: 'chalet', color, front: v > 0 ? 'left' : 'right' });
chalet(50, 25, '#7a4f2c');
chalet(96, 27, '#8a5a32');
// The lodge: up a long drift onto its flat roof, and down the landing drift below.
building(190, 30, { length: 28, width: 22, eave: 4.2, roof: 'flat', drift: 17, apron: 16, style: 'lodge', color: '#7a5a3a', front: 'left', sign: 'Lodge' });
chalet(250, 26, '#6e4a2e');
/**
 * A building standing side-on to the street: its near end at `edge` (v),
 * its length running away from the street, `width` m along it centered on
 * u, so the door faces the street and the gables face up and down it.
 * Taller than the ones you ride, for a skyline.
 */
function sideOn(u: number, edge: number, b: Json): void {
  const yaw = r1(TH + (edge < 0 ? 90 : -90));
  features.push({ type: 'building', ...xz(T(u, edge)), yaw, front: 'up', ...b });
}
const tall = (u: number, edge: number, color: string, eave = 6.4, sign = ''): void =>
  sideOn(u, edge, { length: 14, width: 15, eave, roof: 'gable', rise: 3.8, style: sign ? 'shop' : 'chalet', color, sign, chimney: true });
// Behind the rooftops and the chalets, a row of taller houses and hotels each side.
for (const [u, color] of [[52, '#6e4a2e'], [74, '#d8cbb0'], [96, '#7a4f2c'], [118, '#9a6a3c'], [196, '#7a4f2c'], [218, '#c9b48e'], [240, '#6e4a2e']] as const) tall(u, -36, color);
for (const [u, color] of [[60, '#8a5a32'], [84, '#e2d6bd'], [108, '#6e4a2e'], [132, '#7a4f2c'], [205, '#d8cbb0'], [228, '#8a5a32'], [252, '#6e4a2e']] as const) tall(u, 46, color);
// The bottom of the street: two shops facing it, a hotel behind each.
tall(316, -16, '#c8553d', 5.2, 'Tune shop');
tall(322, 16, '#3f7fbf', 5.2, 'Sports');
tall(300, -36, '#e2d6bd', 7.2);
tall(322, 36, '#7a4f2c', 7.2);
// Round the edge of town, in the trees.
for (const [u, v, color, size] of [
  [30, 70, '#7a4f2c', 1],
  [110, 76, '#6e4a2e', 1.15],
  [175, 72, '#8a5a32', 1],
  [240, 80, '#7a4f2c', 1.1],
  [60, -68, '#6e4a2e', 1],
  [150, -70, '#8a5a32', 1.15],
  [225, -72, '#7a4f2c', 1],
  [290, -66, '#6e4a2e', 1],
  [290, 70, '#8a5a32', 1],
] as const) {
  chalet(u, v, color, size);
}

// The plaza across the street, level with the snow at its back and 2 m above it at the front.
const PLAZA = { u: 150, length: 26, width: 26, height: 2 };
features.push({ type: 'terrace', ...xz(T(PLAZA.u)), yaw: TY, length: PLAZA.length, width: PLAZA.width, height: PLAZA.height, stairs: 6, stairAngle: 30, handrails: true });

// The street's jibs.
for (const u of [62, 90, 120]) for (const v of [-8.5, 8.5]) townBox('bench', 0.5, [[u, v, 0.45], [u + 2.4, v, 0.45]]);
townBox('ledge', 0.6, [[95, 0, 0], [98, 0, 0.5], [110, 0, 0.5]]);
townKickerRail(126, 3, 14);
// On the plaza: benches either side of a planter.
for (const v of [-10, 10]) townBox('bench', 0.5, [[PLAZA.u + 6, v, 0.45], [PLAZA.u + 8.4, v, 0.45]]);
townBox('ledge', 1.2, [[PLAZA.u + 10, 7, 0.45], [PLAZA.u + 18, 7, 0.45]]);
// Below the plaza: a kinked rail, ledges down both sides, and a booter to finish.
townKickerRail(198, 0, 16, 0.4);
for (const v of [-9, 9]) townBox('ledge', 0.5, [[232, v, 0.45], [252, v, 0.45]]);
features.push({ type: 'jump', natural: true, ...xz(T(278)), yaw: TY, width: 8, sideWidth: 4, lipHeight: 1.2, lipAngle: 22, gap: 6, deck: true, landingAngle: 22, knuckle: 3, transition: 7 });

// ---- natural features
// Across every face: fallen trees to slide (ride on at the tip, off the
// root end), stumps and flat rocks to pop onto, booters dug into ridges,
// the gully floor and the open slopes (facing down the fall line, with a
// landing of their own where the slope below is too gentle), and a few
// built jumps and rails. Each is checked by tools/sim/features.ts.
/** A booter at p: a natural kicker facing down the fall line there (turned `turn` degrees), landing on the slope below; or, given `land`, a jump with a landing of its own. */
function booter(p: XZ, lip: number, angle: number, o: { turn?: number; width?: number; land?: { gap: number; angle: number } } = {}): void {
  const yaw = r1(fall(p, 10).heading + (o.turn ?? 0));
  const base = { natural: true, ...xz(p), yaw, width: o.width ?? 6, sideWidth: 3, lipHeight: lip, lipAngle: angle };
  // A table: come up short and it's the deck, not the landing's back side.
  if (o.land) features.push({ type: 'jump', ...base, gap: o.land.gap, deck: true, landingAngle: o.land.angle, knuckle: 3, transition: 8 });
  else features.push({ type: 'kicker', ...base, back: r1(lip * 2.5) });
}
/**
 * A fallen tree from its tip at p (level with the snow, to ride straight
 * on) `length` m down the fall line (turned `turn` degrees), its root end
 * lifted `root` m off the snow on its root plate. Warns if the snow rises
 * over it anywhere between.
 */
function log(p: XZ, length: number, o: { turn?: number; root?: number; radius?: number } = {}): void {
  const h = fall(p, 8).heading + (o.turn ?? 0);
  const q = ahead(p, h, length);
  const root = o.root ?? 0.6;
  const ya = gy(p);
  const yb = gy(q) + root;
  for (let t = 0.1; t < 1; t += 0.1) {
    const m = { x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t };
    const over = ya + (yb - ya) * t - gy(m);
    if (over < 0.4 * t * root) warnings.push(`log at (${p.x.toFixed(0)}, ${p.z.toFixed(0)}) dips into the snow ${(t * length).toFixed(0)} m along (${over.toFixed(2)} m)`);
    if (over > 1.6) warnings.push(`log at (${p.x.toFixed(0)}, ${p.z.toFixed(0)}) stands ${over.toFixed(1)} m off the snow ${(t * length).toFixed(0)} m along`);
  }
  features.push({ type: 'rail', style: 'log', radius: o.radius ?? 0.3, points: [xzh(p, 0), xzh(q, root)] });
}
/** A tree stump at p, `height` m tall, to pop onto. */
function stump(p: XZ, height = 0.7, radius = 0.45): void {
  const h = fall(p).heading;
  features.push({ type: 'box', style: 'stump', width: radius * 2, points: [xzh(ahead(p, h, -radius * 0.9), height), xzh(ahead(p, h, radius * 0.9), height)] });
}
/** A flat-topped rock down the fall line from p, with a drift kicking up to it: ride up, slide its top, drop off. */
function rockJib(p: XZ, length: number, width: number, height: number): void {
  const h = fall(p, 8).heading;
  const lipAngle = 11;
  const lipAt = (2 * height) / Math.tan(lipAngle * DEG);
  // The rock starts just past the kicker's short back, a little lower than its lip, so riders come down onto it.
  features.push({ type: 'kicker', natural: true, ...xz(p), yaw: r1(h), width: width + 0.4, sideWidth: 1.5, lipHeight: height, lipAngle, back: 0.5 });
  const a = ahead(p, h, lipAt + 0.8);
  features.push({ type: 'box', style: 'rock', width, points: [xzh(a, height), xzh(ahead(a, h, length), height)] });
}
const at = (s: SpokeId, r: number, a: number): XZ => P(s, r, a);

// South, the Glades: a line of logs down the west side, stumps and rocks in the trees, small booters, and a park stop near the bottom.
const LOG_JAM = -125;
for (const [r, a, len, turn] of [
  [860, LOG_JAM, 11, 4],
  [935, LOG_JAM - 6, 12, -6],
  [1005, LOG_JAM + 4, 10, 3],
  [1175, LOG_JAM, 12, -4],
  [1250, LOG_JAM - 5, 11, 6],
  [1330, LOG_JAM + 3, 12, -3],
] as const) {
  log(at('south', r, a), len, { turn });
}
for (const [r, a, len, turn] of [
  [900, -200, 10, 20],
  [1120, 40, 9, -15],
  [1290, 200, 11, 10],
  [1390, -40, 10, -8],
] as const) {
  log(at('south', r, a), len, { turn, root: 0.5 });
}
for (const [r, a, hgt] of [
  [1145, -70, 0.7],
  [1150, -55, 0.8],
  [1158, -40, 0.65],
  [1165, -25, 0.75],
  [1400, 60, 0.7],
  [1410, 78, 0.8],
  [1404, 95, 0.6],
] as const) {
  stump(at('south', r, a), hgt);
}
rockJib(at('south', 1300, 95), 7, 2.2, 0.7);
rockJib(at('south', 1030, -175), 6.5, 2, 0.6);
booter(at('south', 905, 30), 1.2, 22);
booter(at('south', 1262, -45), 1.1, 20, { land: { gap: 7, angle: 20 } });
booter(at('south', 1345, 85), 1, 20, { land: { gap: 6, angle: 19 } });
// The park stop: a table, a kicker to a rail, and a ride-on box, side by side.
{
  const s: SpokeId = 'south';
  const yaw = r1(angle(s, 1480));
  const table = at(s, 1478, -95);
  features.push({ type: 'jump', ...xz(table), yaw, width: 6, sideWidth: 3, lipHeight: 1.2, lipAngle: 24, gap: 6, deck: true, landingAngle: 22, knuckle: 3, transition: 7 });
  const k = at(s, 1480, -70);
  features.push({ type: 'kicker', ...xz(k), yaw, width: 2.6, sideWidth: 1.2, lipHeight: 0.6, lipAngle: 14 });
  const lipAt = (2 * 0.6) / Math.tan(14 * DEG);
  const a = ahead(k, yaw, lipAt + 1);
  features.push({ type: 'rail', points: [xzh(a, 0.6), xzh(ahead(a, yaw, 14), 0.6)] });
  const b = at(s, 1476, -50);
  features.push({ type: 'box', width: 0.6, points: [xzh(b, 0), xzh(ahead(b, yaw, 3), 0.5), xzh(ahead(b, yaw, 13), 0.5)] });
}

// North, the Steeps: booters on the apron below the cliffs, logs and stumps in the forest at the bottom.
booter(at('north', 955, 0), 1.3, 20);
booter(at('north', 1085, 60), 1.2, 20);
booter(at('north', 1240, 150), 1.1, 19);
for (const [r, a, len, turn] of [
  [1300, 60, 12, 5],
  [1380, 150, 11, -6],
  [1440, 200, 12, 4],
  [1520, 60, 10, -10],
  [1360, -10, 11, 8],
] as const) {
  log(at('north', r, a), len, { turn });
}
for (const [r, a] of [
  [1500, -20],
  [1510, -5],
  [1520, 10],
] as const) {
  stump(at('north', r, a), 0.75);
}
rockJib(at('north', 1335, 125), 7, 2.4, 0.7);

// East, the Bowl: booters on the bowl's floor, logs and stumps in the trees below, a hip near the bottom.
booter(at('east', 610, 60), 1.3, 22);
booter(at('east', 690, -60), 1.2, 21);
for (const [r, a, len, turn] of [
  [1180, -150, 11, 6],
  [1260, -200, 12, -5],
  [1350, 80, 11, 4],
  [1430, -150, 10, -8],
] as const) {
  log(at('east', r, a), len, { turn });
}
for (const [r, a] of [
  [1540, -60],
  [1552, -45],
  [1546, -30],
] as const) {
  stump(at('east', r, a), 0.7);
}
// A hip: a kicker angled off the fall line, landing on a built landing beside it.
{
  const k = at('east', 1580, -90);
  const f = fall(k, 10);
  const yaw = r1(f.heading - 30);
  features.push({ type: 'kicker', ...xz(k), yaw, width: 5, sideWidth: 2.5, lipHeight: 1.2, lipAngle: 21 });
  const lipAt = (2 * 1.2) / Math.tan(21 * DEG);
  // Its landing starts just past the lip, so coming up short lands on its flat top.
  const l = ahead(k, yaw, lipAt + 1);
  features.push({ type: 'landing', ...xz(l), yaw: r1(f.heading), width: 7, sideWidth: 3, height: 1.5, angle: 22, back: 2.5, top: 3, knuckle: 3, transition: 7 });
}

// West, the Gully: booters on the gully's floor, side hits off the rollers, logs, and a big step-down jump near the bottom.
booter(at('west', 700, -3), 1.1, 18, { width: 7 });
booter(at('west', 1110, 3), 1.1, 18, { width: 7 });
booter(at('west', 905, -150), 1.2, 22, { turn: 15 });
booter(at('west', 1160, -205), 1.2, 22, { turn: -15 });
for (const [r, a, len, turn] of [
  [1300, -110, 12, 4],
  [1380, -250, 11, -5],
  [1450, -150, 12, 6],
  [1260, 80, 10, -4],
] as const) {
  log(at('west', r, a), len, { turn });
}
{
  const p = at('west', 1430, -60);
  const yaw = r1(fall(p, 10).heading);
  features.push({ type: 'jump', ...xz(p), yaw, width: 8, sideWidth: 3, lipHeight: 1.6, lipAngle: 24, gap: 9, deck: false, landingHeight: 1.2, landingAngle: 24, knuckle: 3, transition: 8 });
  const r = at('west', 1505, 70);
  const ry = r1(fall(r, 10).heading);
  features.push({ type: 'rail', points: [xzh(r, 0), xzh(ahead(r, ry, 3), 0.55), xzh(ahead(r, ry, 15), 0.55), xzh(ahead(r, ry, 22), 0.25)] });
}

// The ridges: booters just off the crest, facing down into the faces either side.
for (const [s, r, a] of [
  ['northeast', 430, 32],
  ['northeast', 820, -32],
  ['southeast', 460, -30],
  ['southeast', 900, 32],
  ['southwest', 500, 30],
  ['southwest', 950, -30],
  ['northwest', 450, -32],
  ['northwest', 860, 30],
] as const) {
  booter(at(s, r, a), 1.4, 22);
}

// ---------------------------------------------------------------- runs
// Named lines down each face, kept clear of trees, for the headless riders
// (tools/sim/face.ts), the dev panel's test spots, the trail signs and the trail map.
const runs: Json[] = [];
function run(name: string, spots: XZ[], clear = 7): void {
  runs.push({ name, points: spots.map(xz), clear });
}
const along = (s: SpokeId, list: [number, number][]): XZ[] => list.map(([r, a]) => P(s, r, a));
const inTown = (list: [number, number][]): XZ[] => list.map(([u, v]) => T(u, v));
/** Down the main street from the top of town to past the finish. */
const MAIN_STREET: [number, number][] = [[6, 0], [40, 0], [80, -3], [118, -5], [150, -5], [176, -5], [196, 4], [230, 4], [270, 0], [300, 0], [350, 0]];
run('Steeps: Main couloir', along('north', [[18, 0], [62, 0], [200, 0], [340, 0], [400, 10], [520, 40], [625, 42], [760, 20], [1000, 0], [1300, 0], [1600, 0], [1800, 0]]));
run('Steeps: Narrow chute', along('north', [[18, -10], [62, -29], [200, -29], [345, -29], [400, -60], [560, -95], [640, -95], [755, -150], [900, -120], [1200, -60], [1600, -20], [1800, 0]]));
run('Steeps: Pillow line', along('north', [[18, 20], [70, 80], [130, 200], [165, 245], [270, 245], [340, 245], [420, 230], [520, 205], [700, 180], [900, 120], [1300, 30], [1800, 0]]));
run('Steeps: Cliff line', along('north', [[18, 20], [70, 80], [200, 90], [300, 92], [400, 110], [560, 130], [640, 130], [900, 80], [1300, 30], [1800, 0]]));
run('Bowl: Cornice', along('east', [[18, -20], [55, -60], [100, -60], [300, -40], [600, -20], [800, -40], [1000, -40], [1300, 0], [1830, 0]]));
run('Bowl: Entrance', along('east', [[18, 0], [50, 0], [150, 0], [400, 30], [600, 60], [850, 120], [1100, 60], [1400, 0], [1830, 0]]));
run('Glades', [...along('south', [[18, 0], [60, 0], [400, 0], [790, 0], [1000, -20], [1180, -30], [1450, 0], [1640, 0]]), ...inTown(MAIN_STREET)]);
run('Glades: Creek', [...along('south', [[18, 10], [300, 60], [700, 120], [880, 150], [1050, 165], [1220, 140], [1420, 155], [1600, 60], [1640, 20]]), ...inTown(MAIN_STREET)]);
run('Glades: Log jam', [...along('south', [[18, -6], [300, -60], [700, -110], [850, LOG_JAM], [1345, LOG_JAM], [1420, -70], [1468, -50], [1500, -50], [1560, -20], [1640, 0]]), ...inTown(MAIN_STREET)]);
run('Gully', along('west', [[18, 0], [60, 0], [300, 10], [445, 10], [640, -6], [840, 14], [1040, 0], [1240, 12], [1360, 0], [1720, 0]]), 22);
run('Rollers', along('west', [[18, -10], [60, -40], [400, -150], [800, -170], [1200, -120], [1450, -40], [1720, 0]]));
run('Northeast ridge', [...along('northeast', [[18, 0], [130, 0], [400, 0], [700, 0]]), ...along('east', [[1000, -150], [1300, -80], [1830, 0]])]);
run('Northwest ridge', [...along('northwest', [[18, 0], [130, 0], [400, 0], [700, 0]]), ...along('west', [[1000, 150], [1300, 80], [1720, 0]])]);
// In town, from the bottom of the glades above it.
run('Main street', [P('south', 1580, 0), ...inTown(MAIN_STREET)], 12);
run('Rooftops', [P('south', 1580, -12), ...inTown([[6, -8], [26, ROOF.v], [48, ROOF.v], [100, ROOF.v], [131, ROOF.v], [146, ROOF.v], [176, ROOF.v], [188, ROOF.v], [230, ROOF.v], [243, ROOF.v], [270, -12], [300, -6], [350, -4]])], 6);
run('Chalets', [P('south', 1580, 12), ...inTown([[6, 10], [30, 25], [50, 25], [80, 26], [96, 27], [123, 27], [160, 28], [190, 30], [234, 30], [250, 26], [277, 22], [295, 11], [350, 6]])], 6);

// ---------------------------------------------------------------- trail signs
// At each fork, a sign facing the riders coming down to it, a board per
// run with its difficulty and an arrow the way it goes.
/** Difficulty from a run's steepest stretch (over 20 m) after the sign, unless given. */
const LEVELS: Record<string, string> = { 'Main street': 'green', Rooftops: 'blue', Chalets: 'blue' };
function levelOf(name: string, pts: XZ[], from: number): string {
  if (LEVELS[name]) return LEVELS[name]!;
  let steepest = 0;
  for (let i = Math.max(1, from); i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    for (let d = 0; d + 20 <= len; d += 10) {
      const p = { x: a.x + ((b.x - a.x) * d) / len, z: a.z + ((b.z - a.z) * d) / len };
      const q = { x: a.x + ((b.x - a.x) * (d + 20)) / len, z: a.z + ((b.z - a.z) * (d + 20)) / len };
      steepest = Math.max(steepest, Math.atan((gy(p) - gy(q)) / 20) / DEG);
    }
  }
  return steepest < 16 ? 'green' : steepest < 25 ? 'blue' : steepest < 36 ? 'black' : 'double';
}
const decor: Json[] = [];
/** A sign at p facing `heading` (degrees), naming these runs (shown without the face's name before a colon). */
function sign(p: XZ, heading: number, header: string, names: string[]): void {
  const lines = names.map((name) => {
    const r = runs.find((x) => x.name === name) as { name: string; points: { x: number; z: number }[] } | undefined;
    if (!r) throw new Error(`sign: no run ${name}`);
    const pts = r.points;
    // Where the run goes from here: its point nearest the sign, then 45 m on.
    let best = 0;
    pts.forEach((q, i) => {
      if (Math.hypot(q.x - p.x, q.z - p.z) < Math.hypot(pts[best]!.x - p.x, pts[best]!.z - p.z)) best = i;
    });
    let target = pts[pts.length - 1]!;
    for (let i = best; i < pts.length; i++) {
      if (Math.hypot(pts[i]!.x - p.x, pts[i]!.z - p.z) > 45) {
        target = pts[i]!;
        break;
      }
    }
    const bearing = Math.atan2(-(target.x - p.x), -(target.z - p.z)) / DEG;
    const turn = ((((bearing - heading) % 360) + 540) % 360) - 180;
    const text = name.includes(': ') ? name.slice(name.indexOf(': ') + 2) : name;
    return { text, level: levelOf(name, pts, best), arrow: turn > 18 ? -1 : turn < -18 ? 1 : 0 };
  });
  decor.push({ kind: 'sign', ...xz(p), heading: r1(heading), header, lines });
}
// The summit: one sign at the top of each face.
sign(P('north', 9, -7), angle('north', 9), 'The Steeps', ['Steeps: Main couloir', 'Steeps: Narrow chute', 'Steeps: Pillow line', 'Steeps: Cliff line']);
sign(P('east', 9, 7), angle('east', 9), 'The Bowl', ['Bowl: Cornice', 'Bowl: Entrance', 'Northeast ridge']);
sign(P('south', 9, -7), angle('south', 9), 'The Glades', ['Glades', 'Glades: Creek', 'Glades: Log jam']);
sign(P('west', 9, 7), angle('west', 9), 'The Gully', ['Gully', 'Rollers', 'Northwest ridge']);
// Down the faces, where runs part.
sign(P('north', 48, 40), angle('north', 48), '', ['Steeps: Pillow line', 'Steeps: Cliff line']);
sign(P('north', 345, -8), angle('north', 345), '', ['Steeps: Main couloir', 'Steeps: Narrow chute']);
sign(P('south', 40, 14), angle('south', 40), '', ['Glades: Log jam', 'Glades', 'Glades: Creek']);
sign(P('west', 40, -14), angle('west', 40), '', ['Gully', 'Rollers']);
// The top of town.
sign(T(16, -9), TH, 'Town', ['Main street', 'Rooftops', 'Chalets']);

// ---------------------------------------------------------------- decoration
/** Trees thin out from here up to the treeline (as far below the summit as the layout is stretched). */
const TREELINE = 2775;
// Forests: big dense stands with open ground between them, where a few
// pines stand alone; groves of bare white aspens lower down. Rock breaks
// out of every steep face, with crags standing out of the cliffs.
decor.push(
  { kind: 'pine', spacing: 10, height: [0, 0, TREELINE - 90, TREELINE], slope: [0, 0, 26, 34], clumps: { size: 220, clear: 0.72 }, seed: 3, minScale: 0.8, maxScale: 1.5, solid: true },
  { kind: 'pine', spacing: 34, height: [0, 0, TREELINE - 60, TREELINE + 20], slope: [0, 0, 28, 36], clumps: { size: 60, clear: 0.2 }, seed: 13, minScale: 0.9, maxScale: 1.6, solid: true },
  { kind: 'aspen', spacing: 10, height: [TREELINE - 650, TREELINE - 550, TREELINE - 300, TREELINE - 200], slope: [0, 0, 22, 30], clumps: { size: 80, clear: 0.9 }, seed: 23, minScale: 0.8, maxScale: 1.25, solid: true },
  { kind: 'snag', spacing: 60, height: [TREELINE - 110, TREELINE - 70, TREELINE, TREELINE + 50], slope: [0, 0, 32, 40], clumps: { size: 50, clear: 0.55 }, seed: 4, minScale: 0.8, maxScale: 1.2, solid: true },
  { kind: 'rock', spacing: 6, height: [0, 0, 4000, 4000], slope: [44, 52, 90, 90], clumps: { size: 30, clear: 0.15 }, seed: 5, minScale: 1.3, maxScale: 3.2, solid: false },
  { kind: 'crag', spacing: 13, height: [0, 0, 4000, 4000], slope: [48, 56, 90, 90], clumps: { size: 40, clear: 0.3 }, seed: 8, minScale: 0.7, maxScale: 1.4, solid: true },
  { kind: 'boulder', spacing: 40, height: [TREELINE - 140, TREELINE - 40, 4000, 4000], slope: [8, 14, 36, 44], clumps: { size: 80, clear: 0.5 }, seed: 6, minScale: 0.8, maxScale: 1.6, solid: true },
);

// The town's street furniture: lamps (each with a banner) down both sides, bunting across, banners at the top.
{
  const lampsAt = [44, 62, 80, 98, 116, 134, 188, 206, 224, 242, 260, 278, 296, 314];
  decor.push({ kind: 'streetLamp', points: lampsAt.map((u) => xz(T(u, -11.5))), heading: r1(TH + 90), color: '#2f7de1' });
  decor.push({ kind: 'streetLamp', points: lampsAt.map((u) => xz(T(u, 11.5))), heading: r1(TH - 90), color: '#ff7a1a' });
  decor.push({ kind: 'streetLamp', points: [xz(T(PLAZA.u + 1, -14.5)), xz(T(PLAZA.u + 1, 14.5))], heading: r1(TH + 180), color: '#33c26a' });
  for (const u of [62, 116, 224, 296]) decor.push({ kind: 'bunting', points: [xz(T(u, -11.5)), xz(T(u, 11.5))] });
  decor.push({ kind: 'banner', points: [xz(T(30, -13)), xz(T(30, 13))], heading: r1(TH + 180), color: '#c8331f' });
  decor.push({ kind: 'hut', points: [xz(T(352, -48))], heading: r1(TH + 90) });
  decor.push({ kind: 'groomer', points: [xz(T(372, 58))], heading: r1(TH + 70) });
  // People about town: in front of the shops, on the plaza, waiting at the lift; their skis in racks; snowmobiles parked at the base.
  const spots = (list: [number, number][]): Json[] => list.map(([u, v]) => xz(T(u, v)));
  decor.push({ kind: 'skier', points: spots([[74, -13.2], [92, -13.2], [PLAZA.u + 4, -11], [PLAZA.u + 5.2, -10.1], [230, -13.2], [314, -13.3], [350, -40], [352, -42.6]]), heading: r1(TH - 90) });
  decor.push({ kind: 'skier', points: spots([[PLAZA.u + 21, 11.2], [212, 15.2], [214, 15.6], [322, 13.3], [358, 30], [360, 32.2]]), heading: r1(TH + 90) });
  decor.push({ kind: 'skiRack', points: spots([[70, -13.3], [88, -13.3]]), heading: r1(TH - 90) });
  decor.push({ kind: 'skiRack', points: spots([[205, 15.3]]), heading: r1(TH + 90) });
  decor.push({ kind: 'snowmobile', points: spots([[356, -58], [359.5, -60.5]]), heading: r1(TH + 30), color: '#c8331f' });
  decor.push({ kind: 'snowmobile', points: spots([[362, 50], [364.5, 53.5]]), heading: r1(TH - 20), color: '#2f6fe0' });
}

// Chairlifts up each face, from a station by its finish to one high on the face, clear of the runs.
const lift = (a: XZ, b: XZ): void => {
  decor.push({ kind: 'chairlift', points: [xz(a), xz(b)] });
};
lift(T(368, -78), P('south', 560, -190));
lift(P('east', 1720, 150), P('east', 760, 270));
lift(P('north', 1700, 230), P('north', 980, 330));
lift(P('west', 1640, 170), P('west', 820, 290));

// ---------------------------------------------------------------- the map
const spawn = { x: 0, z: 0, heading: 0 };
/** The ranges far around the mountain, past the end of its terrain. */
const peaks = { seed: 7, count: 13, rings: 3, distance: [13000, 32000], base: 1500, height: [3000, 4800], snowLine: 2250 };

function mapJson(): Json {
  return {
    name: 'Freeride',
    terrain,
    features,
    spawn,
    flags,
    finishes,
    decor,
    runs,
    colors: { sky: '#6fa6dd', fog: '#d6e4f1' },
    peaks,
    // Off the named runs the mountain is powder; the town is groomed.
    powder: { groomed: [{ ...xz(T(TOWN.length / 2)), heading: r1(TH), width: TOWN.width, length: TOWN.length }] },
  };
}

// ---------------------------------------------------------------- report
// Finish widths: across the basin floor, out to where it rises 12 m above the middle (the town's spans the town).
for (const [i, [s, f]] of (Object.entries(FINISH) as [SpokeId, { r: number }][]).entries()) {
  if (s === 'south') continue;
  const mid = gy(P(s, f.r));
  const edge = (side: number): number => {
    let a = 0;
    while (a < 300) {
      if (gy(P(s, f.r, side * a)) > mid + 12) break;
      a += 2;
    }
    return a;
  };
  finishes[i]!.width = Math.min(edge(-1), edge(1)) * 2;
}
const map = mapJson();
const t0 = performance.now();
const built = buildMap(parseMap(map));
console.log(`built in ${((performance.now() - t0) / 1000).toFixed(2)} s`);
const hf = built.hf;
const h = (p: XZ): number => heightAt(hf, p.x, p.z);
for (const s of Object.keys(SPOKES) as SpokeId[]) {
  const marks = [100, 400, 800, 1200, 1600];
  const f = FINISH[s];
  const base = f ? `, finish at ${h(P(s, f.r)).toFixed(0)} m (${(h(P(s, 0)) - h(P(s, f.r))).toFixed(0)} m below the summit)` : '';
  console.log(`${SPOKES[s]!.name.padEnd(16)} ${marks.map((r) => `${(r * K).toFixed(0)}: ${h(P(s, r)).toFixed(0)}`).join('  ')}${base}`);
}
built.map.flags.forEach((f, i) => {
  const a = f.heading * DEG;
  const fore = h({ x: f.x - Math.sin(a) * 4, z: f.z - Math.cos(a) * 4 });
  const behind = h({ x: f.x + Math.sin(a) * 4, z: f.z + Math.cos(a) * 4 });
  console.log(`  flag ${i + 1}: ${h(f).toFixed(0)} m, ${(Math.atan((behind - fore) / 8) / DEG).toFixed(0)}° down its heading`);
});
// Everything built must be inside the play area.
for (const f of built.map.features) {
  const p = 'x' in f ? f : 'points' in f ? f.points[0]! : null;
  if (p && !insideBounds(hf.bounds, p.x, p.z)) warnings.push(`${f.type} at (${p.x.toFixed(0)}, ${p.z.toFixed(0)}) is outside the play area`);
}
const count = (t: string): number => built.map.features.filter((f) => f.type === t).length;
console.log(
  `${elements.length} terrain elements, ${flags.length} flags, ${finishes.length} finishes (${built.map.finishes.map((f) => f.width).join(', ')} m wide), ${runs.length} runs; ` +
    `${count('building')} buildings, ${count('terrace')} terraces, ${count('jump')} jumps, ${count('kicker')} kickers, ${count('rail')} rails, ${count('box')} boxes; ` +
    `${built.course.obstacles.count} obstacles, ${built.decor.scatter.length} scatter, ${built.decor.signs.length} signs`,
);
for (const w of warnings) console.log(`WARNING: ${w}`);
writeFileSync('src/maps/freeride.json', JSON.stringify(map, null, 1) + '\n');
console.log('wrote src/maps/freeride.json');
