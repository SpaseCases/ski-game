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
//   South face (heading 178)            The Glades: mellow tree runs, small drops, a creek; the town site at its base
//   West face (heading 88)              The Gully: rolling terrain with side hits, a long natural halfpipe
// The ridges carry wind lips. Each face ends in a run-out basin with a
// finish, and the land climbs past it into the hills around the mountain.

import { writeFileSync } from 'node:fs';
import { generateTerrain } from '../../src/maps/build.ts';
import { parseMap } from '../../src/maps/loader.ts';
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
const K = 1.2;

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
    bend: 6,
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
    sections: [TOP, sec(120, 25, 24), sec(330, 22, 40), sec(600, 19, 60), sec(380, 14, 60), sec(180, 8, 60), sec(330, 3.5, 50), sec(200, -12, 60)],
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
    bend: 6,
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
cliffs('north', 330, [[-175, 1], [-145, 5], [-112, 8], [-82, 6], [-58, 3]]);
cliffs('north', 330, [[32, 2], [60, 5], [92, 8], [122, 4], [150, 6], [178, 2]]);
cliffs('north', 625, [[-205, 2], [-165, 4], [-125, 3], [-95, 0], [-62, 6], [-30, 9], [2, 5], [24, 0], [60, 0], [92, 3], [130, 7], [168, 4], [205, 2]]);
pillows('north', 755, -150, 120, 140, 26, [4, 7], [1.5, 3.5], 5);
bumps('north', 1060, 0, 320, 1.6, 46, 7);

// Northeast ridge: a knife-edge arête, wind lips along it facing the bowl.
lip('northeast', [[210, 8], [260, 9], [320, 8]], angle('northeast', 260) - 90, 1.8, 10, 4);
lip('northeast', [[400, 10], [470, 12], [540, 10]], angle('northeast', 470) - 90, 2.2, 12, 4);
lip('northeast', [[640, -10], [700, -12], [760, -10]], angle('northeast', 700) + 90, 2, 12, 4);

// East face, The Bowl: a cornice along the rim (with a gap to roll in
// through), the cirque itself, a little cliff island in the floor, and a
// pillow field on the rollover below it.
lip('east', [[96, -125], [80, -90], [72, -55], [70, -22]], angle('east', 75), 3.2, 14, 5);
lip('east', [[70, 22], [72, 55], [80, 90], [96, 125]], angle('east', 75), 3.2, 14, 5);
elements.push({ type: 'bowl', ...xz(P('east', 82)), heading: r1(angle('east', 82)), length: 640 * K, width: 570, depth: 55, head: 230, exit: 300 * K, rim: 150 });
cliffs('east', 520, [[40, 0], [60, 3], [85, 4], [105, 3], [125, 0]]);
pillows('east', 915, -40, 240, 200, 40, [4, 8], [1.5, 4], 9);
bumps('east', 1250, 0, 300, 1.4, 50, 11);

// Southeast ridge: broad, a few lips facing the glades.
lip('southeast', [[300, 12], [350, 14], [400, 12]], angle('southeast', 350) + 90, 1.8, 10, 4);
lip('southeast', [[620, 14], [680, 16], [740, 14]], angle('southeast', 680) + 90, 2.2, 12, 4);

// South face, The Glades: rolling ground through the trees, two small cliff
// bands in them, a creek gully, and the town site flattened at the bottom.
bumps('south', 1050, 0, 420, 1.8, 40, 13);
cliffs('south', 960, [[-70, 0], [-50, 2], [-25, 3], [0, 2], [20, 0]]);
cliffs('south', 1210, [[40, 0], [60, 3], [85, 4], [110, 3], [130, 0]]);
gully('south', [[880, 150], [1050, 165], [1220, 140], [1420, 155]], 6, 3, 8, 50);

// Southwest ridge: lips facing the gully side.
lip('southwest', [[320, -12], [380, -14], [440, -12]], angle('southwest', 380) - 90, 2, 12, 4);
lip('southwest', [[700, -14], [760, -16], [820, -14]], angle('southwest', 760) - 90, 2.4, 12, 4);

// West face, The Gully: rolling terrain with side hits everywhere, a long
// winding gully dug into it (a natural halfpipe), rollers at the bottom.
bumps('west', 760, 0, 620, 2.2, 48, 17);
gully('west', [[470, 10], [640, -6], [840, 14], [1040, 0], [1240, 12], [1360, 0]], 14, 7, 8, 60);
bumps('west', 1450, 0, 220, 1.5, 34, 19);

// Northwest ridge: lips facing west.
lip('northwest', [[230, -8], [290, -10], [350, -8]], angle('northwest', 290) - 90, 1.8, 10, 4);
lip('northwest', [[520, -12], [580, -14], [640, -12]], angle('northwest', 580) - 90, 2.2, 12, 4);

// The summit: a flat top for the start, where a rider can turn to face any way down.
elements.push({ type: 'flat', x: 0, z: 0, heading: 0, pitch: 0, radius: 16, blend: 18 });
// The town site at the bottom of the glades (built in milestone 5c-2).
{
  const p = P('south', 1790);
  elements.push({ type: 'flat', x: r1(p.x), z: r1(p.z), heading: r1(angle('south', 1790)), pitch: 3.5, width: 300, length: 380, blend: 60 });
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
flag('northeast', 130, 0, 16);
flag('east', 50, 0, 18); // bowl entrance
flag('east', 600, 0, 24);
flag('east', 785, -40, 20); // pillows
flag('east', 1080, 0, 24);
flag('southeast', 130, 0, 16);
flag('south', 60, 0, 18);
flag('south', 790, 0, 22);
flag('south', 1180, -30, 22);
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
  south: { r: 1650, length: 380 },
  west: { r: 1650, length: 110 },
};

const finishes: Json[] = [];
for (const [s, f] of Object.entries(FINISH) as [SpokeId, { r: number; length: number }][]) {
  const p = P(s, f.r);
  finishes.push({ x: r1(p.x), z: r1(p.z), heading: r1(angle(s, f.r)), width: 0, length: f.length });
  // The run-out basin: a broad dip around the finish zone draws in riders
  // from the whole bottom of the valley, so none are left on flat ground
  // where the valley side meets the hills around it. (The glades end on the
  // town site, which stays flat.)
  if (s === 'south') continue;
  const mid = P(s, f.r + f.length / 2 / K);
  elements.push({ type: 'dip', x: r1(mid.x), z: r1(mid.z), radius: 700, depth: 30 });
}

/**
 * The play area's edge: past each finish along the faces, and along each
 * ridge a little past the col where its spur meets the hills around the
 * mountain (so a rider coming down a ridge finds the ground rising, not a
 * wall), straight between.
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
      r = sections.slice(0, -1).reduce((sum, x) => sum + x.length, 0) + 60;
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
  size: 4900,
  cellSize: 3,
  summit: 3150,
  spokes: Object.values(SPOKES),
  roll: { amplitude: 1.2, wavelength: 90 },
  relief: { amplitude: 16, wavelength: 300 },
  elements,
  bounds: boundsPolygon(),
  rim: { inset: 50, ramp: 90, rise: 0.4 },
  rockSlope: 56,
  noise: 0.2,
  rockNoise: 0.9,
  seed: 21,
};

// ---------------------------------------------------------------- runs
// Named lines down each face, kept clear of trees, for the headless riders
// (tools/sim/face.ts), the dev panel's test spots, and trail signs later.
const runs: Json[] = [];
function run(name: string, spots: XZ[], clear = 7): void {
  runs.push({ name, points: spots.map(xz), clear });
}
const along = (s: SpokeId, list: [number, number][]): XZ[] => list.map(([r, a]) => P(s, r, a));
run('Steeps: Main couloir', along('north', [[18, 0], [62, 0], [200, 0], [340, 0], [400, 10], [520, 40], [625, 42], [760, 20], [1000, 0], [1300, 0], [1600, 0], [1800, 0]]));
run('Steeps: Narrow chute', along('north', [[18, -10], [62, -29], [200, -29], [345, -29], [400, -60], [560, -95], [640, -95], [755, -150], [900, -120], [1200, -60], [1600, -20], [1800, 0]]));
run('Steeps: Cliff line', along('north', [[18, 20], [70, 80], [200, 90], [300, 92], [400, 110], [560, 130], [640, 130], [900, 80], [1300, 30], [1800, 0]]));
run('Bowl: Cornice', along('east', [[18, -20], [55, -60], [100, -60], [300, -40], [600, -20], [800, -40], [1000, -40], [1300, 0], [1830, 0]]));
run('Bowl: Entrance', along('east', [[18, 0], [50, 0], [150, 0], [400, 30], [600, 60], [850, 120], [1100, 60], [1400, 0], [1830, 0]]));
run('Glades', along('south', [[18, 0], [60, 0], [400, 0], [790, 0], [1000, -20], [1180, -30], [1450, 0], [1720, 0]]));
run('Glades: Creek', along('south', [[18, 10], [300, 60], [700, 120], [880, 150], [1050, 165], [1220, 140], [1420, 155], [1600, 60], [1720, 0]]));
run('Gully', along('west', [[18, 0], [60, 0], [300, 10], [445, 10], [640, -6], [840, 14], [1040, 0], [1240, 12], [1360, 0], [1720, 0]]), 22);
run('Rollers', along('west', [[18, -10], [60, -40], [400, -150], [800, -170], [1200, -120], [1450, -40], [1720, 0]]));
run('Northeast ridge', [...along('northeast', [[18, 0], [130, 0], [400, 0], [700, 0]]), ...along('east', [[1000, -150], [1300, -80], [1830, 0]])]);
run('Northwest ridge', [...along('northwest', [[18, 0], [130, 0], [400, 0], [700, 0]]), ...along('west', [[1000, 150], [1300, 80], [1720, 0]])]);

// ---------------------------------------------------------------- decoration
/** Trees thin out from here up to the treeline. */
const TREELINE = 2850;
const decor: Json[] = [
  { kind: 'pine', spacing: 8, height: [0, 0, TREELINE - 90, TREELINE], slope: [0, 0, 26, 34], clumps: { size: 70, clear: 0.42 }, seed: 3, minScale: 0.8, maxScale: 1.5, solid: true },
  { kind: 'snag', spacing: 60, height: [TREELINE - 110, TREELINE - 70, TREELINE, TREELINE + 50], slope: [0, 0, 32, 40], clumps: { size: 50, clear: 0.55 }, seed: 4, minScale: 0.8, maxScale: 1.2, solid: true },
  { kind: 'rock', spacing: 6, height: [0, 0, 4000, 4000], slope: [46, 54, 90, 90], clumps: { size: 30, clear: 0.2 }, seed: 5, minScale: 1.2, maxScale: 3, solid: false },
  { kind: 'boulder', spacing: 40, height: [TREELINE - 140, TREELINE - 40, 4000, 4000], slope: [8, 14, 36, 44], clumps: { size: 80, clear: 0.5 }, seed: 6, minScale: 0.8, maxScale: 1.6, solid: true },
];

// ---------------------------------------------------------------- start and map
const start = { type: 'start', style: 'ridge', x: 0, z: 0, heading: 0 };
const spawn = { x: 0, z: 0, heading: 0 };

function mapJson(): Json {
  return {
    name: 'Freeride',
    terrain,
    features: [start],
    spawn,
    flags,
    finishes,
    decor,
    runs,
    colors: { sky: '#6fa6dd', fog: '#d6e4f1' },
  };
}

// ---------------------------------------------------------------- report
// Finish widths: across the basin floor, out to where it rises 12 m above the middle.
{
  const t0 = performance.now();
  const hf = generateTerrain(parseMap({ ...mapJson(), finishes: finishes.map((f) => ({ ...f, width: 10 })) }).terrain);
  console.log(`terrain ${hf.cols}×${hf.rows} built in ${((performance.now() - t0) / 1000).toFixed(2)} s`);
  for (const [i, [s, f]] of (Object.entries(FINISH) as [SpokeId, { r: number }][]).entries()) {
    const mid = heightAt(hf, P(s, f.r).x, P(s, f.r).z);
    const edge = (side: number): number => {
      let a = 0;
      while (a < 300) {
        const p = P(s, f.r, side * a);
        if (heightAt(hf, p.x, p.z) > mid + 12) break;
        a += 2;
      }
      return a;
    };
    finishes[i]!.width = Math.min(edge(-1), edge(1)) * 2;
  }
}
const map = mapJson();
const parsed = parseMap(map);
const hf = generateTerrain(parsed.terrain);
const h = (p: XZ): number => heightAt(hf, p.x, p.z);
for (const s of Object.keys(SPOKES) as SpokeId[]) {
  const marks = [100, 400, 800, 1200, 1600];
  const f = FINISH[s];
  const base = f ? `, finish at ${h(P(s, f.r)).toFixed(0)} m (${(h(P(s, 0)) - h(P(s, f.r))).toFixed(0)} m below the summit)` : '';
  console.log(`${SPOKES[s]!.name.padEnd(16)} ${marks.map((r) => `${(r * K).toFixed(0)}: ${h(P(s, r)).toFixed(0)}`).join('  ')}${base}`);
}
parsed.flags.forEach((f, i) => {
  const a = f.heading * DEG;
  const ahead = h({ x: f.x - Math.sin(a) * 4, z: f.z - Math.cos(a) * 4 });
  const behind = h({ x: f.x + Math.sin(a) * 4, z: f.z + Math.cos(a) * 4 });
  console.log(`  flag ${i + 1}: ${h(f).toFixed(0)} m, ${(Math.atan((behind - ahead) / 8) / DEG).toFixed(0)}° down its heading`);
});
console.log(`${elements.length} terrain elements, ${flags.length} flags, ${finishes.length} finishes (${parsed.finishes.map((f) => f.width).join(', ')} m wide), ${runs.length} runs`);
writeFileSync('src/maps/freeride.json', JSON.stringify(map, null, 1) + '\n');
console.log('wrote src/maps/freeride.json');
