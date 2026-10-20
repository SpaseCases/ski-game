// Lays out the Big air map and writes it to src/maps/bigair.json. The map
// file is the source the game loads; this script is how it was authored.
// Edit here and rerun, from the repo root:
//   node tools/maps/bigair.ts
// Then ride every lane with tools/sim/line.ts (see GAME_DESIGN.md, Jump
// sizing; "start=0" drops in from the tower, a line beside a kicker rides
// round it and hucks the knuckle, and "lip=<d>" marks the ski jump's edge)
// and check for holes with tools/maps/sinks.ts.
//
// Layout: the fall line runs down -Z, d below is the distance down from the
// top (z = -d), x across (+X to the right facing down). A scaffold drop-in
// tower stands in the middle of a plateau at the top; just below it a short
// apron, where riders pick a lane, then six jumps side by side, each in a
// lane of its own (a band of terrain with its own fall line), each its own
// size and shape, left to right:
//   Ski jump  a steep in-run, a takeoff table tipped down to its edge and a long landing hill: pop at the edge to fly 60 to 80 m
//   Mellow    small, low and long: a floaty 360
//   Big       the Park's pro jump: a clean 720
//   Massive   huge all round: a 6 m lip on an 18 m wide kicker, the longest table and landing
//   Steep     narrow, with a 58° lip that throws riders high: a 720 with time to spare
//   Aerials   a 66° kicker on a little knoll: nearly straight up, for flips
// Each kicker lane is built like the Park's pro jump (tools/maps/park.ts,
// PRO): a level spot with the lane's flag, a short steep in-run, the kicker
// at the start of a table, the knuckle, a steep landing that eases off
// below, and a runout. The steeper the lip, the shorter the table and the
// steeper the landing: riders thrown high come down close and steep. The
// knuckles sit near one line across the hill, so lanes side by side stay
// near each other's height, and every lane starts as soon after the tower
// as a rider can swing out to it. The table is as wide as the lane, so
// there's room to ride round the kicker and huck the knuckle. Unlike the
// Park there's no rise above the level spot to check the speed riders bring
// from the tower: one tall enough to slow a tucked rider stops a standing
// one. Instead every landing is long and steep enough for a rider who tucked
// all the way from the tower (about 12 m/s at the flag). All six come out
// into one finish corral, which climbs to stop riders.

import { writeFileSync } from 'node:fs';
import { parseMap } from '../../src/maps/loader.ts';
import { generateSlope, solveLanes } from '../../src/maps/terrain.ts';
import { heightAt } from '../../src/sim/terrain.ts';

type Json = Record<string, unknown>;
const r2 = (v: number): number => Math.round(v * 100) / 100;
const xz = (x: number, d: number): Json => ({ x: r2(x), z: r2(-d) });
const sec = (length: number, pitch: number | undefined, ease = 20): Json =>
  pitch === undefined ? { length, ease } : { length, pitch, ease };

// ---------------------------------------------------------------- jumps
/** One big jump and its lane: lengths (m) and pitches (degrees), from the lane's top down. */
interface JumpSpec {
  name: string;
  /** Trail sign difficulty. */
  level: 'blue' | 'black' | 'double';
  /** Where the knuckle is (m further down than the others' line), so the jumps don't all line up across the hill. */
  stagger: number;
  /** The level spot at the top (the flag), and the in-run: length and pitch. */
  level0: [number, number];
  inrun: [number, number];
  /** Table: from the in-run to the knuckle, and its pitch (a ski jump's tips down to the edge). */
  table: number;
  tablePitch: number;
  /** The kicker, starting `at` m into the table; absent for a ski jump, which takes off from the table's edge. */
  kicker?: { at: number; lip: number; angle: number; back: number };
  /** Width of the kicker's full-height part (or the ski jump's track), and of the slopes down each side of it. */
  width: number;
  sideWidth: number;
  /** Distance (m) the knuckle rounds over in: long for a kicker's table (casing it rolls over), short for a ski jump's edge. */
  knuckleEase: number;
  /**
   * The landing, from the knuckle to where it eases off into the runout;
   * its steep part as stretches (length and pitch; a face that steepens
   * further down suits fast riders, who come down steeper); and the pitch
   * it eases off to below. The runout below is solved to bring the lane
   * back level with the slope beside it at the finish; it's always gentler
   * than the landing, so the snow only ever dips there (a rollover onto a
   * steeper runout would throw riders, fast by then).
   */
  landing: number;
  faces: [number, number][];
  lower: number;
}
/** Room beside the kicker (m) to ride round it along the table to the knuckle. */
const RIDE_ROUND = 4;

// Left to right across the hill, from the ones that drop least to the ones
// that drop most, so lanes side by side are never far apart in height. In-runs
// are short and steep: a level spot, then straight down to the table.
const JUMPS: JumpSpec[] = [
  {
    // A ski jump: a steep in-run onto a takeoff table that tips down to its
    // edge, no kicker, then a long landing hill that steepens the way the
    // flight curves down, so riders skim it all the way and land soft.
    name: 'Ski jump',
    level: 'double',
    stagger: -2,
    level0: [8, 4],
    inrun: [46, 35],
    table: 8,
    tablePitch: 11,
    width: 8,
    sideWidth: 0,
    knuckleEase: 6,
    landing: 150,
    faces: [[8, 18], [8, 28], [8, 36], [100, 42]],
    lower: 32,
  },
  {
    name: 'Mellow',
    level: 'blue',
    stagger: -8,
    level0: [8, 4],
    inrun: [32, 28],
    table: 30,
    tablePitch: 2,
    kicker: { at: 6, lip: 2.2, angle: 22, back: 3 },
    width: 9,
    sideWidth: 3,
    knuckleEase: 16,
    landing: 110,
    faces: [[34, 38], [36, 44]],
    lower: 44,
  },
  {
    name: 'Big',
    level: 'black',
    stagger: 0,
    level0: [8, 4],
    inrun: [38, 32],
    table: 34,
    tablePitch: 2,
    kicker: { at: 6, lip: 3.5, angle: 32, back: 3 },
    width: 12,
    sideWidth: 4,
    knuckleEase: 16,
    landing: 100,
    faces: [[40, 46], [36, 51]],
    lower: 42,
  },
  {
    name: 'Massive',
    level: 'double',
    stagger: 2,
    level0: [8, 4],
    inrun: [50, 34],
    table: 46,
    tablePitch: 2,
    kicker: { at: 6, lip: 6, angle: 34, back: 3 },
    width: 18,
    sideWidth: 5,
    knuckleEase: 16,
    landing: 96,
    faces: [[30, 48], [48, 53]],
    lower: 40,
  },
  {
    // A really steep lip (a takeoff isn't a wall however steep: CONFIG.air.wallAngle).
    name: 'Steep',
    level: 'double',
    stagger: 2,
    level0: [8, 4],
    inrun: [40, 30],
    table: 16,
    tablePitch: 2,
    kicker: { at: 5, lip: 4.6, angle: 58, back: 3 },
    width: 8,
    sideWidth: 3,
    knuckleEase: 8,
    landing: 90,
    faces: [[30, 58], [40, 61]],
    lower: 42,
  },
  {
    // Freestyle aerials: a short in-run onto a little knoll, and a kicker so
    // steep it throws riders nearly straight up, with time for flips.
    name: 'Aerials',
    level: 'double',
    stagger: 4,
    level0: [8, 4],
    inrun: [30, 28],
    table: 14,
    tablePitch: 2,
    kicker: { at: 4, lip: 4, angle: 66, back: 2.5 },
    width: 7,
    sideWidth: 2.5,
    knuckleEase: 8,
    landing: 90,
    faces: [[26, 60], [30, 63]],
    lower: 44,
  },
];

// Each lane's full-strength band is its kicker, the slopes down its sides,
// and the ride-round each side. Lanes meet their neighbors bank to bank:
// the bank between two lanes blends the snow straight from one to the
// other (the slope beside them never shows), so the banks stay gentle
// however far apart the lanes' heights are. The outer lanes reach out
// under the berms.
/** Width of the bank between each lane and the next: widest where their heights differ most. */
const BANKS = [38, 38, 38, 38, 38];
const halfOf = (j: JumpSpec): number => j.width / 2 + j.sideWidth + (j.kicker ? RIDE_ROUND : 4);
/** Each lane's middle (x), centered across the hill. */
const LANE_X: number[] = (() => {
  const xs: number[] = [];
  let x = 0;
  JUMPS.forEach((j, i) => {
    if (i > 0) x += halfOf(JUMPS[i - 1]!) + BANKS[i - 1]! + halfOf(j);
    xs.push(x);
  });
  const mid = (xs[0]! + xs[xs.length - 1]!) / 2;
  return xs.map((v) => Math.round(v - mid));
})();
/** Half the play area's width (to the top of the berms). */
const HALF = Math.max(...JUMPS.map((j, i) => Math.abs(LANE_X[i]!) + halfOf(j))) + 16;
/** The lane's band (x and width): the outer ones reach past the berm. */
function band(i: number): { x: number; width: number } {
  const x = LANE_X[i]!;
  const h = halfOf(JUMPS[i]!);
  if (i > 0 && i < JUMPS.length - 1) return { x, width: 2 * h };
  const inner = Math.abs(x) - h;
  const outer = HALF + 8;
  return { x: (Math.sign(x) * (inner + outer)) / 2, width: outer - inner };
}
/** Between lane i and the next (x): the middle of the bank. */
const between = (i: number): number => (LANE_X[i]! + halfOf(JUMPS[i]!) + LANE_X[i + 1]! - halfOf(JUMPS[i + 1]!)) / 2;

const features: Json[] = [];
const flags: Json[] = [];
const decor: Json[] = [];
const runs: Json[] = [];
const finishes: Json[] = [];
const lanes: Json[] = [];

/** Where things are down each lane (d), and its middle and half width (x). */
interface LaneAt {
  x: number;
  half: number;
  flag: number;
  inrun: number;
  table: number;
  lip: number;
  knuckle: number;
  landingEnd: number;
}
const at: LaneAt[] = [];

// The tower: the rider stands on its platform, 12 m up, and drops in down
// its 32° in-run onto the plateau, reaching the snow about 28 m on.
const TOWER_D = 14;
/**
 * The soonest a lane can start (d): after the foot of the tower, and
 * further down the farther out it is, so a rider has room to swing out to it.
 */
const soonest = (x: number): number => 42 + 0.4 * Math.abs(x);
/** From a lane's start to its knuckle. */
const toKnuckle = (j: JumpSpec): number => j.level0[0] + j.inrun[0] + j.table;
/**
 * The knuckles all sit near one line across the hill (each staggered off
 * it a little), so lanes side by side stay near each other's height: the
 * bigger jumps' lanes start just below the tower, the smaller ones lower.
 * The line is as high as it can be with every lane starting no sooner than it can.
 */
const KNUCKLE = Math.max(...JUMPS.map((j, i) => soonest(LANE_X[i]!) + toKnuckle(j) - j.stagger));
const startOf = (j: JumpSpec): number => Math.round(KNUCKLE + j.stagger - toKnuckle(j));
/** Every lane's level spot. */
const TOP = JUMPS[0]!.level0[0];
/** Where the last lane starts. */
const LAST_LANE = Math.max(...JUMPS.map(startOf));
const landingEndOf = (j: JumpSpec): number => startOf(j) + toKnuckle(j) + j.landing;
/** Where the finish corral starts (d), a long runout below the landings. And the play area's length. */
const FINISH = Math.ceil((Math.max(...JUMPS.map(landingEndOf)) + 100) / 10) * 10;
const LENGTH = FINISH + 240;
/** Pitch of the slope beyond the lanes, from the apron to the finish (what the hillsides follow, and what the lanes' runouts are solved to meet). */
const BELOW = 29.5;

// The fall line beside the lanes: the plateau the tower stands on, the
// apron, then the jumps (the lanes blend into each other and set the snow
// there), the finish corral, and a climb that stops riders.
const profile = [
  sec(44, 1, 10), // the plateau and the tower: nearly level, so the tower's deck (built parallel to the snow) holds a standing rider
  sec(LAST_LANE + TOP - 44, 4, 16), // d 44: the apron, down to the last lane's level spot
  sec(FINISH - LAST_LANE - TOP, BELOW, 40), // in-runs, tables, landings and runouts
  sec(60, 3, 30), // the finish corral
  sec(LENGTH - FINISH - 60, -16, 30), // climbs, to stop riders
];

JUMPS.forEach((j, i) => {
  const x = LANE_X[i]!;
  const half = halfOf(j);
  const start = startOf(j);
  const flagD = start + j.level0[0] / 2;
  const inrun = start + j.level0[0];
  const table = inrun + j.inrun[0];
  const k = j.kicker;
  const kickerAt = table + (k?.at ?? 0);
  const knuckle = table + j.table;
  const lip = k ? kickerAt + (2 * k.lip) / Math.tan((k.angle * Math.PI) / 180) : knuckle;
  const landingEnd = knuckle + j.landing;
  at.push({ x, half, flag: flagD, inrun, table, lip, knuckle, landingEnd });

  if (k) features.push({ type: 'kicker', x, z: -kickerAt, width: j.width, sideWidth: j.sideWidth, lipHeight: k.lip, lipAngle: k.angle, back: k.back });
  flags.push({ ...xz(x, flagD), heading: 0, width: 2 * half - 2 });
  lanes.push({
    ...band(i),
    blend: Math.max(BANKS[i - 1] ?? 0, BANKS[i] ?? 0),
    start,
    endEase: 30,
    sections: [
      sec(j.level0[0], j.level0[1], 8),
      sec(j.inrun[0], j.inrun[1], 16),
      sec(j.table, j.tablePitch, j.kicker ? 20 : 12),
      // A well-rounded knuckle: casing it, or riding round the kicker to huck it, rolls over rather than trips.
      ...j.faces.map(([length, pitch], n) => sec(length, pitch, n === 0 ? j.knuckleEase : 14)),
      sec(j.landing - j.faces.reduce((a, [length]) => a + length, 0), j.lower, 16),
      sec(FINISH - landingEnd, undefined, 30),
    ],
  });
  runs.push({ name: j.name, points: [xz(0, 16), xz(x, flagD), xz(x, landingEnd), xz(x, FINISH + 20)], clear: 0 });
});

// ---------------------------------------------------------------- start and finish
features.push({ type: 'start', style: 'tower', ...xz(0, TOWER_D), heading: 0, height: 12 });
const spawn = { ...xz(0, TOWER_D), heading: 0 };

// One finish zone per lane, side by side across the corral, each with an arch over its lane.
const edges = [-HALF, ...JUMPS.slice(0, -1).map((_, i) => between(i)), HALF];
at.forEach((a, i) => {
  const left = edges[i]!;
  const right = edges[i + 1]!;
  finishes.push({ ...xz((left + right) / 2, FINISH), heading: 0, width: right - left, length: 70, arch: { ...xz(a.x, FINISH), width: Math.min(28, 2 * a.half - 4) } });
});

// ---------------------------------------------------------------- decoration
// Spectator fencing down both sides of every lane from the table down, open at the bottom into the corral.
const fenceOff = (a: LaneAt): number => a.half + 0.5;
for (const a of at) {
  for (const side of [-1, 1]) {
    decor.push({ kind: 'fence', points: [xz(a.x + side * fenceOff(a), a.table + 4), xz(a.x + side * fenceOff(a), FINISH - 6)] });
  }
}
// The ski jump: two tracks dyed down its in-run to the edge, a line across
// the landing hill every 10 m out from the edge (from 30 m), and a board
// beside the hill every 20 m saying how far.
JUMPS.forEach((j, i) => {
  if (j.kicker) return;
  const a = at[i]!;
  for (const side of [-1, 1]) decor.push({ kind: 'dyeLine', points: [xz(a.x + side * 0.7, a.inrun + 2), xz(a.x + side * 0.7, a.knuckle - 0.5)] });
  for (let m = 30; m <= 110; m += 10) {
    decor.push({ kind: 'dyeLine', points: [xz(a.x - a.half + 1, a.knuckle + m), xz(a.x + a.half - 1, a.knuckle + m)] });
    if (m % 20 === 0) decor.push({ kind: 'sign', ...xz(a.x + (a.x < 0 ? 1 : -1) * (fenceOff(a) + 3), a.knuckle + m), heading: 0, header: `${m} m`, lines: [] });
  }
});
// Spectators behind the fences: along the tables (the best seats), and at the foot of the landings.
let seed = 7;
const rand = (): number => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};
for (const a of at) {
  for (const side of [-1, 1]) {
    const pts: Json[] = [];
    for (let d = a.table + 8; d < a.knuckle - 2; d += 3.2 + rand() * 2) pts.push(xz(a.x + side * (fenceOff(a) + 1.4 + rand() * 1.2), d));
    for (let d = a.landingEnd - 6; d < FINISH - 10; d += 3 + rand() * 2.5) pts.push(xz(a.x + side * (fenceOff(a) + 1.4 + rand() * 1.4), d));
    decor.push({ kind: 'skier', points: pts, heading: side * 90 });
  }
}
// Floodlights outside the outer lanes and on the banks between the lanes, beside the knuckles and the landings.
const lights: Json[] = [];
const lightX = [-HALF + 10, ...JUMPS.slice(0, -1).map((_, i) => between(i)), HALF - 10];
lightX.forEach((x, i) => {
  const near = at[Math.min(i, at.length - 1)]!;
  for (const d of [near.knuckle - 20, near.knuckle + 40]) lights.push(xz(x, d));
});
decor.push({ kind: 'floodlight', points: lights.filter((_, i) => i % 2 === 0), heading: 0 });
decor.push({ kind: 'floodlight', points: lights.filter((_, i) => i % 2 === 1), heading: 0 });
// Floodlights up at the tower too, facing down the hill.
decor.push({ kind: 'floodlight', points: [xz(-14, 30), xz(14, 30)], heading: 0 });
// Banners at the top of each table, just outside the fences (the ride-round runs inside them), and along the fences beside the knuckles.
for (const a of at) {
  decor.push({ kind: 'banner', points: [xz(a.x - fenceOff(a) - 2.4, a.table + 3), xz(a.x + fenceOff(a) + 2.4, a.table + 3)], heading: 0, color: '#1f6fd6' });
  decor.push({ kind: 'banner', points: [xz(a.x - fenceOff(a) - 0.8, a.knuckle - 6), xz(a.x + fenceOff(a) + 0.8, a.knuckle - 6)], heading: a.x < 0 ? -90 : 90, color: '#ff7a1a' });
}
// Flags: a row along the top of the apron, beside every lane's level spot, and round the corral.
decor.push({ kind: 'flag', points: [xz(-30, 46), xz(-18, 44), xz(18, 44), xz(30, 46)], heading: 0 });
for (const a of at) decor.push({ kind: 'flag', points: [xz(a.x - a.half - 1, a.flag + 4), xz(a.x + a.half + 1, a.flag + 4)], heading: 0 });
decor.push({ kind: 'flag', points: edges.map((x, i) => xz(i === 0 ? x + 16 : i === edges.length - 1 ? x - 16 : x, FINISH + 6)), heading: 0 });
// Bunting off the tower and across the top of the apron.
decor.push({ kind: 'bunting', points: [xz(-30, 40), xz(-8, 36), xz(8, 36), xz(30, 40)] });
// A sign beside the foot of the tower's in-run naming the lanes.
decor.push({
  kind: 'sign',
  ...xz(-6, 46),
  heading: 0,
  header: 'Big air',
  lines: JUMPS.map((j, i) => ({ text: j.name, level: j.level, arrow: LANE_X[i]! < 0 ? -1 : 1 })),
});
// Judges' huts and a groomer at the sides of the corral, a snowmobile up top.
decor.push({ kind: 'hut', points: [xz(-HALF + 6, FINISH - 20)], heading: -90 });
decor.push({ kind: 'hut', points: [xz(HALF - 6, FINISH - 20)], heading: 90 });
decor.push({ kind: 'hut', points: [xz(-22, 22)], heading: 0 });
decor.push({ kind: 'groomer', points: [xz(HALF - 10, FINISH + 74)], heading: -50 });
decor.push({ kind: 'snowmobile', points: [xz(26, 18)], heading: 150 });
decor.push({ kind: 'snowmobile', points: [xz(-HALF + 10, FINISH + 44)], heading: 30 });
// Chairlifts up the hillsides, out of reach.
decor.push({ kind: 'chairlift', points: [xz(-HALF - 30, LENGTH + 40), xz(-HALF - 30, -110)] });
decor.push({ kind: 'chairlift', points: [xz(HALF + 36, LENGTH - 20), xz(HALF + 36, -60)] });
// Stands of pines on both hillsides, thick close to the run, with clearings between, over scattered trees.
const treeLen = LENGTH + 500;
const treeMid = LENGTH / 2;
for (const side of [-1, 1]) {
  for (let d = -80; d < LENGTH + 80; d += 50) {
    for (let k = 0; k < 3; k++) {
      if (rand() < 0.3) continue;
      const w = 22 + rand() * 40;
      const l = 30 + rand() * 55;
      const x = side * (HALF + 18 + w / 2 + k * 42 + rand() * 20);
      const count = Math.round(w * l * (0.006 + rand() * 0.012));
      decor.push({ kind: 'pine', area: { ...xz(x, d + rand() * 30), width: r2(w), length: r2(l) }, count, seed: 100 + decor.length, minScale: 0.8, maxScale: 1.5 });
    }
  }
  decor.push({ kind: 'pine', area: { ...xz(side * (HALF + 130), treeMid), width: 200, length: treeLen }, count: 420, seed: side < 0 ? 3 : 5, minScale: 0.8, maxScale: 1.4 });
}
decor.push({ kind: 'aspen', area: { ...xz(-HALF - 10, treeMid), width: 18, length: LENGTH }, count: 90, seed: 11, minScale: 0.8, maxScale: 1.2 });
decor.push({ kind: 'aspen', area: { ...xz(HALF + 10, treeMid), width: 18, length: LENGTH }, count: 90, seed: 12, minScale: 0.8, maxScale: 1.2 });
decor.push({ kind: 'snag', area: { ...xz(-HALF - 70, treeMid), width: 80, length: treeLen }, count: 50, seed: 13, minScale: 0.8, maxScale: 1.2 });
decor.push({ kind: 'boulder', area: { ...xz(HALF + 70, treeMid), width: 90, length: treeLen }, count: 80, seed: 14, minScale: 0.8, maxScale: 1.6 });
decor.push({ kind: 'rock', area: { ...xz(-HALF - 70, treeMid), width: 90, length: treeLen }, count: 100, seed: 15, minScale: 0.6, maxScale: 1.4 });

// ---------------------------------------------------------------- terrain
const terrain = {
  type: 'generated',
  width: HALF * 2,
  length: LENGTH,
  cellSize: 3,
  bermWidth: 12,
  bermHeight: 5,
  noise: 0.1,
  seed: 31,
  margin: 320,
  // Spurs and hollows on the hillsides, so the forests on them (seen far off) aren't flat planes.
  hills: { amplitude: 22, wavelength: 210 },
  profile,
  lanes,
};
const peaks = { seed: 29, count: 12, rings: 3, distance: [12000, 30000], base: -900, height: [1400, 3000], snowLine: 500 };

const map = {
  name: 'Big air',
  terrain,
  features,
  spawn,
  flags,
  finishes,
  decor,
  runs,
  colors: { sky: '#86b8ea', fog: '#dbe8f4' },
  peaks,
};

// ---------------------------------------------------------------- report
const parsed = parseMap(map);
const hf = generateSlope(parsed.terrain);
const flat = generateSlope(parseMap({ ...map, terrain: { ...terrain, lanes: [] } }).terrain);
solveLanes(parsed.terrain).forEach((lane, i) => {
  const j = JUMPS[i]!;
  const a = at[i]!;
  const end = lane.sections.reduce((s, x) => s + x.length, lane.start);
  let lo = 0;
  let hi = 0;
  for (let d = lane.start; d < end + 20; d += 2) {
    const o = heightAt(hf, a.x, -d) - heightAt(flat, a.x, -d);
    lo = Math.min(lo, o);
    hi = Math.max(hi, o);
  }
  const drop = heightAt(hf, a.x, -a.knuckle) - heightAt(hf, a.x, -a.landingEnd);
  console.log(
    `${j.name.padEnd(7)} x=${a.x} (±${a.half}): flag d ${a.flag}, lip d ${a.lip.toFixed(1)}, knuckle d ${a.knuckle}, landing to d ${a.landingEnd} (${drop.toFixed(1)} m down), last pitch ${lane.sections.at(-1)?.pitch?.toFixed(1)}°, ${hi.toFixed(1)} m above / ${(-lo).toFixed(1)} m below the plain slope`,
  );
});
// The steepest bank across the slope, between lanes.
let bank = 0;
let bankAt = '';
for (let d = Math.min(...at.map((a) => a.flag)); d < FINISH + 20; d += 2) {
  for (let x = -HALF + 14; x < HALF - 14; x += 2) {
    const g = Math.abs(heightAt(hf, x + 1, -d) - heightAt(hf, x - 1, -d)) / 2;
    if (Math.atan(g) > bank) {
      bank = Math.atan(g);
      bankAt = `x ${x}, d ${d}`;
    }
  }
}
console.log(`run-in from the foot of the tower to the lip: mean ${(at.reduce((a, l) => a + l.lip, 0) / at.length - 42).toFixed(0)} m, ${at.map((l) => (l.lip - 42).toFixed(0)).join(' / ')}`);
console.log(`steepest bank across the slope: ${((bank * 180) / Math.PI).toFixed(0)}° at ${bankAt}`);
console.log(`${features.length} features, ${flags.length} flags, ${decor.length} decoration sets; ${(heightAt(hf, 0, -TOWER_D) - heightAt(hf, 0, -FINISH)).toFixed(0)} m drop from the tower to the finish`);
writeFileSync('src/maps/bigair.json', JSON.stringify(map, null, 1) + '\n');
console.log('wrote src/maps/bigair.json');
