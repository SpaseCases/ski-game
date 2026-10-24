// Lays out the Slalom map and writes it to src/maps/slalom.json. The map
// file is the source the game loads; this script is how it was authored.
// Edit here and rerun, from the repo root:
//   node tools/maps/slalom.ts
// Then ride both courses with tools/sim/course.ts (every gate made, times
// in range) and check for holes with tools/maps/sinks.ts.
//
// Layout: one wide groomed run down -Z, d below is the distance down from
// the top (z = -d), x across (+X to the right facing down). Two timed
// courses run side by side between safety netting, both starting from race
// start houses on a gentle plateau at the top:
//   x -80..-40   free snow (left), then the berm
//   x -40..0     the slalom: tight gates
//   x   0..48    the giant slalom: wider, faster turns
//   x  48..80    free snow (right), then the berm
// The spawn stands between the two houses with a sign pointing to each.
// Both finish side by side at d 800, each finish zone running across its
// half of the run (free riders on that side finish too) with an arch over
// the course; below them the run climbs to stop everyone.

import { writeFileSync } from 'node:fs';
import { parseMap } from '../../src/maps/loader.ts';
import { generateSlope } from '../../src/maps/terrain.ts';
import { heightAt } from '../../src/sim/terrain.ts';

type Json = Record<string, unknown>;
const r2 = (v: number): number => Math.round(v * 100) / 100;
const xz = (x: number, d: number): Json => ({ x: r2(x), z: r2(-d) });

// ---------------------------------------------------------------- the run
/** Half the run's width (to the top of the berms), and the length of the play area. */
const HALF = 80;
const LENGTH = 970;
const sec = (length: number, pitch: number, ease = 24): Json => ({ length, pitch, ease });
/** The fall line, from the top: the plateau, the courses' pitches, the finishes, and the climb that stops riders. */
const profile = [
  sec(46, 4, 10), // the start plateau
  sec(204, 15, 22), // d 46: the upper pitch
  sec(60, 12, 30), // d 250: a flatter roll
  sec(220, 16, 30), // d 310: the steep middle
  sec(90, 12, 30), // d 530: another roll
  sec(180, 15, 26), // d 620: the last pitch
  sec(70, 3, 30), // d 800: the finishes
  sec(100, -8, 30), // d 870: climbs, to stop riders
];

// ---------------------------------------------------------------- courses
/** Corridor edges (x), the course's start house, its finish line (d), its gates' rhythm and its finish arch. */
interface CourseSpec {
  name: string;
  kind: 'slalom' | 'giant';
  left: number;
  right: number;
  house: { x: number; d: number };
  /** Middle of the course (x) at d: from the house out to its corridor's middle, then gently drifting. */
  middle: (d: number) => number;
  /**
   * First gate (d), and stretches of gates: each runs until `until` (d) with
   * its own spacing and offset, blending from the stretch before over its
   * first BLEND meters (a sudden change of rhythm at speed can't be ridden).
   */
  first: number;
  stretches: { until: number; spacing: number; offset: number }[];
  /** Distance between the gate's sides (poles, or the panels' inner poles). */
  width: number;
  finish: number;
  arch: number;
}

const ease = (a: number, b: number, d0: number, d1: number, d: number): number => {
  const t = Math.min(1, Math.max(0, (d - d0) / (d1 - d0)));
  return a + (b - a) * t * t * (3 - 2 * t);
};

const SLALOM: CourseSpec = {
  name: 'Slalom',
  kind: 'slalom',
  left: -40,
  right: 0,
  house: { x: -12, d: 38 },
  middle: (d) => ease(-12, -21, 45, 110, d) + 3.5 * Math.sin(((d - 110) / 300) * Math.PI) * ease(0, 1, 110, 160, d),
  first: 54,
  stretches: [
    { until: 250, spacing: 13.5, offset: 3.6 },
    { until: 312, spacing: 14, offset: 3.3 }, // the roll: a little more open, to carry speed
    { until: 380, spacing: 14.5, offset: 3.9 }, // round turns into the steep
    { until: 530, spacing: 13.5, offset: 3.3 }, // the steep: a little more open
    { until: 620, spacing: 11.5, offset: 2.8 }, // quick and straighter over the roll
    { until: 720, spacing: 13, offset: 3.7 },
    { until: 785, spacing: 12.5, offset: 3.1 }, // a quick finish
  ],
  width: 4.5,
  finish: 800,
  arch: 24,
};

const GIANT: CourseSpec = {
  name: 'Giant slalom',
  kind: 'giant',
  left: 0,
  right: 48,
  house: { x: 12, d: 38 },
  middle: (d) => ease(12, 24, 45, 130, d) + 4 * Math.sin(((d - 130) / 360) * Math.PI) * ease(0, 1, 130, 190, d),
  first: 64,
  stretches: [
    { until: 250, spacing: 28, offset: 5.5 },
    { until: 312, spacing: 31, offset: 5 },
    { until: 450, spacing: 27, offset: 6 },
    { until: 530, spacing: 32, offset: 7 }, // big round turns
    { until: 620, spacing: 30, offset: 5 },
    { until: 780, spacing: 27, offset: 5.8 },
  ],
  width: 6,
  finish: 800,
  arch: 28,
};

const features: Json[] = [];
const finishes: Json[] = [];
const runs: Json[] = [];
const decor: Json[] = [];

const BLEND = 30;

/** The course's gates, alternating sides of its middle; the first one swings toward the corridor's middle. */
function gates(c: CourseSpec): { x: number; d: number }[] {
  const out: { x: number; d: number }[] = [];
  const toward = Math.sign((c.left + c.right) / 2 - c.house.x) || 1;
  let side = toward;
  let d = c.first;
  let from = c.first;
  c.stretches.forEach((s, i) => {
    const before = c.stretches[i - 1] ?? s;
    const blend = (a: number, b: number): number => ease(a, b, from, from + BLEND, d);
    while (d <= s.until) {
      out.push({ x: c.middle(d) + side * blend(before.offset, s.offset), d });
      side = -side;
      d += blend(before.spacing, s.spacing);
    }
    from = s.until;
  });
  return out;
}

for (const c of [SLALOM, GIANT]) {
  const gs = gates(c);
  features.push({ type: 'start', style: 'race', x: c.house.x, z: -c.house.d, heading: 0, course: c.name });
  features.push({ type: 'slalom', name: c.name, kind: c.kind, gates: gs.map((g) => ({ ...xz(g.x, g.d), heading: 0, width: c.width })) });
  // The finish zone runs across the whole half of the run (so free riders on that side finish too), its arch over the course.
  const zoneLeft = c.left < 0 ? -HALF : 0;
  const zoneRight = c.left < 0 ? 0 : HALF;
  const archX = c.middle(c.finish);
  finishes.push({
    ...xz((zoneLeft + zoneRight) / 2, c.finish),
    heading: 0,
    width: zoneRight - zoneLeft,
    length: 70,
    arch: { ...xz(archX, c.finish), width: c.arch },
    course: c.name,
  });
  runs.push({ name: c.name, points: [xz(c.house.x, c.house.d), ...gs.map((g) => xz(g.x, g.d)), xz(archX, c.finish + 20)], clear: 0 });
  console.log(`${c.name}: ${gs.length} gates from d ${gs[0]!.d.toFixed(0)} to ${gs[gs.length - 1]!.d.toFixed(0)}, finish at d ${c.finish}`);
}

const spawn = { x: 0, z: -12, heading: 0 };

// ---------------------------------------------------------------- decoration
// Safety netting along both sides of each course (one line between them),
// open at the top for the start houses and at the bottom into each finish.
const net = (x: number, d0: number, d1: number): void => {
  decor.push({ kind: 'netting', points: [xz(x, d0), xz(x, d1)] });
};
net(SLALOM.left, 34, SLALOM.finish + 64);
net(0, 50, GIANT.finish + 70);
net(GIANT.right, 34, GIANT.finish + 70);
// Blue lines dyed in the snow down each course, a few meters inside the netting.
for (const c of [SLALOM, GIANT]) {
  for (const x of [c.left + 3, c.right - 3]) decor.push({ kind: 'dyeLine', points: [xz(x, c.house.d + 8), xz(x, c.finish - 2)] });
}

// Signs at the top: one at the spawn pointing to each course, and one naming each by its start house.
decor.push({
  kind: 'sign',
  ...xz(0, 21),
  heading: 0,
  header: 'Race courses',
  lines: [
    { text: 'Slalom', level: 'black', arrow: -1 },
    { text: 'Giant slalom', level: 'black', arrow: 1 },
  ],
});
for (const c of [SLALOM, GIANT]) {
  const out = Math.sign(c.house.x);
  decor.push({ kind: 'sign', ...xz(c.house.x + out * 4, c.house.d - 4), heading: 0, header: c.name, lines: [] });
}
// The start plateau: bunting, flags, timing huts beside each house, a ski rack and a snowmobile.
decor.push({ kind: 'bunting', points: [xz(-30, 30), xz(-18, 31), xz(18, 31), xz(30, 30)] });
decor.push({ kind: 'flag', points: [xz(-8, 6), xz(8, 6), xz(-24, 26), xz(24, 26)], heading: 0 });
decor.push({ kind: 'hut', points: [xz(-26, 36)], heading: 90 });
decor.push({ kind: 'hut', points: [xz(26, 36)], heading: -90 });
decor.push({ kind: 'skiRack', points: [xz(-6, 4)], heading: 0 });
decor.push({ kind: 'snowmobile', points: [xz(40, 12)], heading: 150 });
// At the finishes: banners along the corral, a timing hut, spectators and parked sleds.
for (const c of [SLALOM, GIANT]) {
  const outer = c.left < 0 ? c.left : c.right;
  const side = Math.sign(outer);
  decor.push({ kind: 'banner', points: [xz(outer - side * 1.2, c.finish - 30), xz(outer - side * 1.2, c.finish + 12)], heading: side * 90, color: c.kind === 'giant' ? '#2f62d0' : '#d8342c' });
  decor.push({ kind: 'hut', points: [xz(outer + side * 6, c.finish + 6)], heading: -side * 90 });
  decor.push({ kind: 'skier', points: [xz(outer + side * 3, c.finish - 18), xz(outer + side * 3.5, c.finish - 12), xz(outer + side * 2.8, c.finish - 6), xz(outer + side * 3.2, c.finish + 20)], heading: side * 90 });
  decor.push({ kind: 'flag', points: [xz(outer + side * 2, c.finish - 40), xz(outer + side * 2, c.finish + 30)], heading: 0 });
}
decor.push({ kind: 'snowmobile', points: [xz(-60, SLALOM.finish + 30)], heading: 30 });
decor.push({ kind: 'groomer', points: [xz(66, GIANT.finish + 50)], heading: -50 });
decor.push({ kind: 'groomer', points: [xz(-66, 420)], heading: 20 });
// Two chairlifts up the hillsides, out of reach, and trees off the run.
decor.push({ kind: 'chairlift', points: [xz(-122, LENGTH + 60), xz(-122, -70)] });
decor.push({ kind: 'chairlift', points: [xz(124, LENGTH - 40), xz(124, 120)] });
// Stands of pines of every size up both hillsides, with clearings between,
// over scattered trees.
const treeLen = LENGTH + 500;
const treeMid = LENGTH / 2;
let seed = 1;
const rand = (): number => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};
for (const side of [-1, 1]) {
  for (let d = -60; d < LENGTH + 60; d += 55) {
    for (let k = 0; k < 3; k++) {
      if (rand() < 0.3) continue;
      const w = 25 + rand() * 45;
      const l = 35 + rand() * 60;
      const x = side * (96 + w / 2 + k * 45 + rand() * 25);
      const count = Math.round(w * l * (0.006 + rand() * 0.012));
      decor.push({ kind: 'pine', area: { ...xz(x, d + rand() * 30), width: r2(w), length: r2(l) }, count, seed: 100 + decor.length, minScale: 0.8, maxScale: 1.5 });
    }
  }
  decor.push({ kind: 'pine', area: { ...xz(side * 210, treeMid), width: 200, length: treeLen }, count: 450, seed: side < 0 ? 3 : 5, minScale: 0.8, maxScale: 1.4 });
}
decor.push({ kind: 'aspen', area: { ...xz(-100, treeMid), width: 24, length: LENGTH }, count: 160, seed: 11, minScale: 0.8, maxScale: 1.2 });
decor.push({ kind: 'aspen', area: { ...xz(104, treeMid), width: 24, length: LENGTH }, count: 160, seed: 12, minScale: 0.8, maxScale: 1.2 });
decor.push({ kind: 'snag', area: { ...xz(-150, treeMid), width: 80, length: treeLen }, count: 60, seed: 13, minScale: 0.8, maxScale: 1.2 });
decor.push({ kind: 'boulder', area: { ...xz(150, treeMid), width: 90, length: treeLen }, count: 90, seed: 14, minScale: 0.8, maxScale: 1.6 });
decor.push({ kind: 'rock', area: { ...xz(-150, treeMid), width: 90, length: treeLen }, count: 120, seed: 15, minScale: 0.6, maxScale: 1.4 });

// ---------------------------------------------------------------- terrain
const terrain = {
  type: 'generated',
  width: HALF * 2,
  length: LENGTH,
  cellSize: 3,
  bermWidth: 12,
  bermHeight: 5,
  // Groomed: barely any facet jitter.
  noise: 0.08,
  seed: 21,
  margin: 320,
  // Spurs and hollows on the hillsides, so the valley's sides (and the forests on them, seen far off) aren't flat planes.
  hills: { amplitude: 22, wavelength: 210 },
  profile,
};
const peaks = { seed: 19, count: 12, rings: 3, distance: [12000, 30000], base: -900, height: [1400, 3000], snowLine: 500 };

// Floodlight towers outside the netting, aimed across each course (lit at night), staggered side to side.
// After the trees: their seeds count the decoration before them.
for (const [x, heading, from] of [
  [SLALOM.left - 18, -90, 40],
  [GIANT.right + 18, 90, 80],
] as const) {
  const pts: Json[] = [];
  for (let d = from; d < SLALOM.finish + 20; d += 80) pts.push(xz(x, d));
  decor.push({ kind: 'floodlight', points: pts, heading });
}

const map = {
  name: 'Slalom',
  terrain,
  features,
  spawn,
  flags: [],
  finishes,
  decor,
  runs,
  colors: { sky: '#7fb2e6', fog: '#dce9f5' },
  peaks,
};

// ---------------------------------------------------------------- report
const parsed = parseMap(map);
const hf = generateSlope(parsed.terrain);
const drop = (d0: number, d1: number, x: number): string => (heightAt(hf, x, -d0) - heightAt(hf, x, -d1)).toFixed(0);
console.log(`Slalom: ${drop(SLALOM.house.d, SLALOM.finish, -20)} m drop; Giant slalom: ${drop(GIANT.house.d, GIANT.finish, 24)} m drop`);
writeFileSync('src/maps/slalom.json', JSON.stringify(map, null, 1) + '\n');
console.log('wrote src/maps/slalom.json');
