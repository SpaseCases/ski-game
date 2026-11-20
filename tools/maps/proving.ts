// Lays out Proving Ground (milestone 17) and writes it to
// src/maps/proving.json. The map file is the source the game loads; this
// script is how it was authored. Edit here and rerun, from the repo root:
//   node tools/maps/proving.ts
// Then check it: tools/maps/sinks.ts, tools/sim/features.ts (every kind, and
// jib), tools/sim/face.ts (its runs), tools/sim/score.ts (its named gaps),
// tools/sim/airbag.ts (the progression lanes) and tools/sim/lift.ts.
//
// A small resort with a contest venue at its foot: one chairlift up the
// middle, trails between tree islands, and a base area. The fall line runs
// down -Z, and d below is the distance down from the top (z = -d).
//
//   Summit (d 0 to 70): the lift's top station, the start deck, the trail sign.
//   Upper mountain (d 70 to 550, 13°), trails left to right:
//     Superpipe (x -152) and Big Line (x -102): a superpipe and a line of large jumps
//     the lift line, in its cut through the trees (x -64)
//     Jib Alley (x -30), Rhythm (x 6), Mini Pipe (x 46): three medium lanes
//     School Yard (x 104 to 190): four progression lanes, small to XL, each
//       ending on an airbag; below it First Tracks, the easy way down
//   The Cut (d 550 to 620): a bench where every trail meets.
//   The Garden (d 620 to 810, 12°): one rail garden the three lanes funnel
//     into; a hip into a wallride on its left; First Tracks on its right.
//   The venue (d 880 to 1500, 15°), built from terrain lanes:
//     the riders' zone (a snow bar to slide, kegs, rails)
//     the Slot: two mounds with a slot between them (ride through it, gap
//       across it, slide the rail that spans it, step up onto the mounds
//       and step down off them)
//     the Hip: a spine 9 m tall whose two sides are landings, takeoffs
//       angled off it both ways, a huge quarterpipe facing each landing,
//       and a knuckle at its end
//     left of the lift, the Gauntlet: a giant step-up, a tree gap, a cannon
//       rail, a loop and one huge step-down jump
//     right of the venue, Easy Street
//   The Playground (d 1500 to 1600, 9°): quarterpipes and a volcano.
//   The base (d 1600 on): the finish arch, the lodge, the lift's bottom station.

import { writeFileSync } from 'node:fs';
import { CONFIG } from '../../src/config.ts';
import { parseMap } from '../../src/maps/loader.ts';
import { generateSlope, solveLanes } from '../../src/maps/terrain.ts';
import { heightAt } from '../../src/sim/terrain.ts';
import { deckRail, knuckleRail, loop, poleJam, SHAPES, slideJson, type TableOpts } from './railKit.ts';

type Json = Record<string, unknown>;
type Pt = [along: number, across: number, height: number];
const features: Json[] = [];
const flags: Json[] = [];
const decor: Json[] = [];
const gaps: Json[] = [];
const runs: Json[] = [];
const lanes: Json[] = [];
const r2 = (v: number): number => Math.round(v * 100) / 100;
const DEG = Math.PI / 180;

// ---------------------------------------------------------------- the mountain
/** Where each stretch starts (d, m down from the top). */
const D = {
  parks: 70, // upper mountain, 13°
  cut: 550, // the Cut, a bench
  garden: 620, // the Garden, 12°
  bench: 810, // the bench above the venue
  venue: 880, // the venue, 15°
  play: 1500, // the Playground, 9°
  base: 1600, // the base flat
  stop: 1700, // climbs, to stop riders
  end: 1770,
};
const PITCH = { top: 6, parks: 13, flat: 4, garden: 12, venue: 15, play: 9, base: 2 };
const WIDTH = 440;
const X = {
  pipe: -152,
  big: -102,
  lift: -64,
  rails: -30,
  jumps: 6,
  mini: 46,
  green: 150,
  /** The venue's middle (the Slot and the Hip), and the Gauntlet's. */
  venue: 40,
  gauntlet: -140,
};

const sec = (length: number, pitch: number | undefined, ease = 20): Json => (pitch === undefined ? { length, ease } : { length, pitch, ease });
const profile = [
  sec(D.parks, PITCH.top),
  sec(D.cut - D.parks, PITCH.parks, 30),
  sec(D.garden - D.cut, PITCH.flat, 24),
  sec(D.bench - D.garden, PITCH.garden, 24),
  sec(D.venue - D.bench, PITCH.flat, 24),
  sec(D.play - D.venue, PITCH.venue, 30),
  sec(D.base - D.play, PITCH.play, 30),
  sec(D.stop - D.base, PITCH.base, 40),
  sec(D.end - D.stop, -6, 40),
  // Past the end of the map the valley falls away again (scenery: without it the land beyond would climb for good).
  sec(400, 5, 60),
];

// ---------------------------------------------------------------- helpers
function flag(x: number, d: number, width = 26): void {
  flags.push({ x, z: -d, heading: 0, width });
}

/** Something laid along a line: how long it is down the hill, and how to put it there. */
interface Item {
  len: number;
  place: (x: number, d: number) => void;
  opts?: JumpOpts;
}

/** Lays items down a line from d, `run` m of snow between each (a number is extra snow), and returns the d past the last one. */
function line(x: number, d: number, run: number, items: (Item | number)[]): number {
  let at = d;
  for (const it of items) {
    if (typeof it === 'number') {
      at += it;
      continue;
    }
    it.place(x, at);
    at += it.len + run;
  }
  return at - run;
}

interface JumpOpts {
  lip: number;
  angle: number;
  gap: number;
  land: number;
  width?: number;
  /** False: an open gap, with the landing's own height (a step-up above the lip, a step-down below). */
  deck?: boolean;
  landingHeight?: number;
  knuckle?: number;
  transition?: number;
  dx?: number;
}

/** Length down the hill of a park jump (as maps/shapes.ts builds it). */
function jumpLength(o: JumpOpts): number {
  const takeoff = (2 * o.lip) / Math.tan(o.angle * DEG);
  const H = o.deck === false ? (o.landingHeight ?? o.lip) : o.lip;
  const s = Math.tan(o.land * DEG);
  const kt = ((o.knuckle ?? 3) + (o.transition ?? 6)) / 2;
  return takeoff + o.gap + H / s + Math.min(H / s, kt);
}

function jump(x: number, d: number, o: JumpOpts): void {
  const f: Json = {
    type: 'jump',
    x: r2(x + (o.dx ?? 0)),
    z: r2(-d),
    width: o.width ?? 8,
    sideWidth: 2.5,
    lipHeight: o.lip,
    lipAngle: o.angle,
    gap: o.gap,
    deck: o.deck ?? true,
    landingAngle: o.land,
    knuckle: o.knuckle ?? 3,
    transition: o.transition ?? 6,
  };
  if (o.deck === false) f.landingHeight = o.landingHeight ?? o.lip;
  features.push(f);
}

const J = (o: JumpOpts): Item => ({ len: jumpLength(o), place: (x, d) => jump(x, d, o), opts: o });

/** Distance from an open gap's takeoff start to the middle of its floor (as maps/shapes.ts builds it). */
function gapMiddle(o: JumpOpts): number {
  const down = Math.max(1, 1.2 * o.lip);
  const up = Math.max(1, 1.2 * (o.landingHeight ?? o.lip));
  return (2 * o.lip) / Math.tan(o.angle * DEG) + down + (o.gap - 1.5 - down - up) / 2;
}

/** A rectangle from d0 to d1 down the hill, from x0 to x1 across. */
function rect(x0: number, x1: number, d0: number, d1: number): Json[] {
  return [
    { x: r2(x0), z: r2(-d0) },
    { x: r2(x1), z: r2(-d0) },
    { x: r2(x1), z: r2(-d1) },
    { x: r2(x0), z: r2(-d1) },
  ];
}
const across = (x: number, d0: number, d1: number, half: number): Json[] => rect(x - half, x + half, d0, d1);

/**
 * An open gap jump with trees standing in its gap, two tall ones either
 * side of the flight path, and a named gap for scoring: taken off its
 * takeoff, landed past its knuckle. `scale` sizes the trees in the gap
 * against a full-grown pine (7 m).
 */
function TREES(gap: Item, name: string, points: number, scale: number, seed: number, solid = true): Item {
  const o = gap.opts!;
  return { ...gap, place: (x, d) => {
    gap.place(x, d);
    const at = x + (o.dx ?? 0);
    const mid = d + gapMiddle(o);
    const half = (o.width ?? 8) / 2;
    const spots: Json[] = [];
    for (let k = -2; k <= 2; k++) spots.push({ x: r2(at + (k * half) / 2.2), z: r2(-(mid + (k % 2 === 0 ? 0.7 : -0.7))) });
    decor.push({ kind: 'pine', spots, anywhere: true, solid, seed, minScale: scale * 0.85, maxScale: scale });
    decor.push({ kind: 'pine', spots: [{ x: r2(at - half - 6.5), z: r2(-mid) }, { x: r2(at + half + 6.5), z: r2(-(mid + 1)) }], anywhere: true, solid: true, seed: seed + 1, minScale: 1.5, maxScale: 1.8 });
    const lip = (2 * o.lip) / Math.tan(o.angle * DEG);
    gaps.push({ name, from: across(at, d - 3, d + lip + 1, half + 2.5), to: across(at, d + lip + o.gap, d + gap.len + 60, half + 2.5), points });
  } };
}

/** A hip: a kicker angled off the fall line from one side, and a landing in the line facing down the hill. */
function hip(x: number, d: number, side: -1 | 1, size: number): void {
  features.push({ type: 'kicker', x: r2(x - side * 12), z: r2(-d), yaw: -side * 32, width: 5, sideWidth: 2, lipHeight: r2(1.4 * size), lipAngle: 24, back: r2(1.5 * size) });
  features.push({ type: 'landing', x, z: r2(-(d - 2)), width: 12, sideWidth: 3, height: r2(2.2 * size), angle: 16, back: r2(9 * size), top: 3 });
}
const hipLength = (size: number): number => 9 * size + 3 + (2.2 * size) / Math.tan(16 * DEG) + 4 - 2;
const HIP = (side: -1 | 1, size: number): Item => ({ len: hipLength(size), place: (x, d) => hip(x, d, side, size) });

/** A wooden wallride beside the line, its foot `dx` m to one side, standing outward. */
const WALL = (dx: number, length = 18, radius = 3.4): Item => ({
  len: length,
  place: (x, d) => {
    features.push({ type: 'quarter', x: r2(x + dx), z: r2(-d), yaw: 0, side: Math.sign(dx), length, radius, wallAngle: 84, deckWidth: 0.6, back: 3.5, taper: 3.5, style: 'wood' });
  },
});

/**
 * A hip into a wallride: the hip's kicker throws riders across onto its
 * landing, and a tall wooden wall stands along the far side of that landing
 * to carry the sideways speed up.
 */
const HIP_WALL = (side: -1 | 1, size: number): Item => ({
  len: hipLength(size) + 6,
  place: (x, d) => {
    hip(x, d, side, size);
    features.push({ type: 'quarter', x: r2(x + side * 10), z: r2(-(d + 9 * size - 2)), yaw: 0, side, length: 24, radius: 4.4, wallAngle: 84, deckWidth: 0.6, back: 3.5, taper: 4, style: 'wood' });
  },
});

/** A quarterpipe across the line at 45°, throwing riders down and across toward `toward` (1 right, -1 left). */
const QP = (toward: 1 | -1, length = 56, radius = 4.5): Item => {
  const run = length * Math.SQRT1_2;
  const behind = radius + 2 + 5;
  return {
    len: run + behind * Math.SQRT1_2 + 2,
    place: (x, d) => {
      features.push({ type: 'quarter', x: r2(x - (toward * run) / 4), z: r2(-d), yaw: -toward * 45, side: -toward, length, radius, wallAngle: 82, deckWidth: 2, back: 5, taper: 8 });
    },
  };
};

type Look = 'metal' | 'tube' | 'table' | 'barrels' | 'spool' | 'ledge' | 'log';

function slide(kind: 'rail' | 'box', x: number, d: number, pts: Pt[], width = 0.6, follow = 0, look: Look = 'metal'): void {
  const f: Json = { type: kind, points: pts.map(([a, b, h]) => ({ x: r2(x + b), z: r2(-(d + a)), height: r2(h) })) };
  if (kind === 'box') f.width = width;
  if (follow > 0) f.follow = follow;
  if (look !== 'metal') f.style = look;
  features.push(f);
}

const S = (kind: 'rail' | 'box', pts: Pt[], width = 0.6, dx = 0, look: Look = 'metal'): Item => ({
  len: pts[pts.length - 1]![0],
  place: (x, d) => slide(kind, x + dx, d, pts, width, 0, look),
});
const TUBE = (pts: Pt[], dx = 0): Item => S('rail', pts, 0, dx, 'tube');
const PAIR = (...slides: [dx: number, kind: 'rail' | 'box', pts: Pt[], width?: number, look?: Look][]): Item => ({
  len: Math.max(...slides.map(([, , pts]) => pts[pts.length - 1]![0])),
  place: (x, d) => {
    for (const [dx, kind, pts, width, look] of slides) slide(kind, x + dx, d, pts, width ?? 0.6, 0, look);
  },
});
const ROW = (...items: [dx: number, item: Item][]): Item => ({
  len: Math.max(...items.map(([, it]) => it.len)),
  place: (x, d) => {
    for (const [dx, it] of items) it.place(x + dx, d);
  },
});

function kicker(x: number, d: number, lip: number, angle: number, width = 3): number {
  features.push({ type: 'kicker', x: r2(x), z: r2(-d), width, sideWidth: 1.5, lipHeight: lip, lipAngle: angle, back: 1.2 });
  return d + (2 * lip) / Math.tan(angle * DEG);
}

interface KickerOpts {
  lip?: number;
  angle?: number;
  gap?: number;
  width?: number;
  dx?: number;
  look?: Look;
}

/** A kicker onto a rail or box: the slide starts `gap` m past the lip. */
function kickerTo(kind: 'rail' | 'box', x: number, d: number, pts: Pt[], o: KickerOpts = {}): void {
  const lip = kicker(x + (o.dx ?? 0), d, o.lip ?? 0.6, o.angle ?? 10, kind === 'box' ? 3.5 : 3);
  slide(kind, x + (o.dx ?? 0), lip + (o.gap ?? 1), pts, o.width ?? 0.7, 0, o.look);
}
const K = (kind: 'rail' | 'box', pts: Pt[], o: KickerOpts = {}): Item => ({
  len: (2 * (o.lip ?? 0.6)) / Math.tan((o.angle ?? 10) * DEG) + (o.gap ?? 1) + pts[pts.length - 1]![0],
  place: (x, d) => kickerTo(kind, x, d, pts, o),
});

// Bonks sit past a long, mellow snow ramp whose lip is a little above their top, to roll onto.
const BONK = (top: number, len: number, width: number, look: Look, angle = 6): Item =>
  K('box', [[0, 0, top], [len, 0, top]], { width, look, lip: top + 0.1, angle, gap: 1.3 });
const TABLE = (len = 3.6): Item => BONK(0.75, len, 0.8, 'table');
const BARRELS = (n = 6): Item => BONK(0.62, n * 0.62, 0.9, 'barrels');
const SPOOL = (): Item => BONK(1.0, 1.6, 1.6, 'spool', 7);

/** Kicker-fed rails start at about the lip's height. */
const FED = 0.65;
const SLIDES = {
  flat: (len: number, h = 0.4): Pt[] => [[0, 0, 0], [3.5, 0, h], [len, 0, h]],
  flatDown: (len: number, h = 0.45): Pt[] => [[0, 0, 0], [3.5, 0, h], [len * 0.55, 0, h + 0.15], [len, 0, h * 0.5]],
  downFlatDown: (len: number, h = 0.5): Pt[] => [[0, 0, 0], [3.5, 0, h], [len * 0.35, 0, h * 0.6], [len * 0.6, 0, h + 0.45], [len, 0, h * 0.7]],
  kinked: (len: number, side: number, h = 0.5): Pt[] => [[0, 0, 0], [3.5, 0, h], [len * 0.45, 0, h], [len * 0.7, side, h], [len, side * 2, h * 0.7]],
  jog: (len: number, side: number, h = 0.5): Pt[] => [[0, 0, 0], [3.5, 0, h], [len * 0.4, 0, h], [len * 0.6, side, h], [len, side, h * 0.7]],
  rainbow: (len: number, base: number, rise: number, n = 8): Pt[] => [[0, 0, 0], ...SLIDES.arc(len, base, rise, n).slice(1)],
  arc: (len: number, base: number, rise: number, n = 8): Pt[] => {
    const pts: Pt[] = [];
    for (let i = 0; i <= n; i++) pts.push([len * (i / n), 0, base + rise * Math.sin((Math.PI * i) / n)]);
    return pts;
  },
  /** A C-rail curving `bend` degrees toward `side` over `len` m: riders come off it heading that way, so it needs open snow there. */
  c: (len: number, bend: number, h = 0.45, side = 1): Pt[] => {
    const k = (bend * DEG) / len;
    const pts: Pt[] = [];
    for (let s = 0; s <= len + 1e-6; s += len / Math.ceil(len)) {
      pts.push([Math.sin(k * s) / k, (side * (1 - Math.cos(k * s))) / k, s < 3.5 ? (h * s) / 3.5 : h]);
    }
    return pts;
  },
  s: (len: number, offset: number, h = 0.45): Pt[] => {
    const pts: Pt[] = [[0, 0, 0], [3.5, 0, h]];
    for (let i = 1; i <= 10; i++) {
      const t = i / 10;
      pts.push([3.5 + (len - 3.5) * t, offset * t * t * (3 - 2 * t), h]);
    }
    return pts;
  },
  fed: (len: number): Pt[] => [[0, 0, FED], [len, 0, FED]],
  fedDown: (len: number, rise = 0.35): Pt[] => [[0, 0, FED], [len * 0.45, 0, FED + rise], [len, 0, 0.45]],
};

/** A roller: a low, round hump of snow to pump or pop off. */
const ROLLER = (height = 0.7, width = 9): Item => {
  const up = (2 * height) / Math.tan(9 * DEG);
  return {
    len: up + 7,
    place: (x, d) => {
      features.push({ type: 'kicker', x: r2(x), z: r2(-d), width, sideWidth: 3, lipHeight: height, lipAngle: 9, back: 7, natural: true });
    },
  };
};

/** Tables that get a rail along the deck, or from the knuckle down the landing (laid after everything else). */
interface Table {
  x: number;
  d: number;
  o: TableOpts;
}
const deckTables: Table[] = [];
const knuckleTables: Table[] = [];
const RAILED = (list: Table[], it: Item): Item => ({
  ...it,
  place: (x, d) => {
    it.place(x, d);
    const o = it.opts!;
    list.push({ x: x + (o.dx ?? 0), d, o: { ...o, width: o.width ?? 8 } });
  },
});

/** Where each line's features end, for the report. */
const ends: string[] = [];
const sectionEnd = (name: string, end: number, limit: number): void => {
  ends.push(`${name} ends at d ${end.toFixed(0)} (room to ${limit})`);
  if (end > limit) throw new Error(`${name} runs past d ${limit} (to ${end.toFixed(0)})`);
};

// ---------------------------------------------------------------- the summit
const START_X = 0;
features.push({ type: 'start', style: 'deck', x: START_X, z: -16, heading: 0, height: 0.6 });
const spawn = { x: START_X, z: -16, heading: 0 };

// ---------------------------------------------------------------- School Yard: the progression lanes
// Four lanes side by side from one row of flags, small to XL. Each is an
// in-run down the slope, a kicker, and an airbag standing in for the table
// and the landing: its wall rises under the end of the takeoff, so its top
// starts right at the lip, a little lower. Bigger lanes have longer in-runs,
// so each lip is reached at its own speed from a standing start at the flag.
const LANE_TOP = 64;
interface Lane {
  name: string;
  level: 'green' | 'blue' | 'black' | 'double';
  x: number;
  /** Where the kicker starts (d). */
  kick: number;
  lip: number;
  angle: number;
  width: number;
  /** The bag: its top's length, and its face's angle against the slope. */
  top: number;
  face: number;
  color: string;
  accent: string;
}
const LANES: Lane[] = [
  { name: 'Small', level: 'green', x: 104, kick: 92, lip: 1.0, angle: 18, width: 8, top: 6, face: 4.5, color: '#33c26a', accent: '#f4f6fa' },
  { name: 'Medium', level: 'blue', x: 130, kick: 116, lip: 1.8, angle: 22, width: 10, top: 8, face: 5.5, color: '#2f6fe0', accent: '#f4f6fa' },
  { name: 'Large', level: 'black', x: 158, kick: 142, lip: 2.8, angle: 26, width: 12, top: 12, face: 6.5, color: '#1b2430', accent: '#ffc21f' },
  { name: 'XL', level: 'double', x: 190, kick: 178, lip: 4.0, angle: 32, width: 14, top: 19, face: 7, color: '#c8331f', accent: '#ffc21f' },
];
/** How far the bag's wall starts before the lip (its wall's length, so its top begins at the lip), and how much lower than the lip its top is. */
const BAG_BACK = 0.8;
const BAG_DROP = 0.12;
const bagEnds: number[] = [];
for (const l of LANES) {
  flag(l.x, LANE_TOP, l.width + 10);
  const lipAt = l.kick + (2 * l.lip) / Math.tan(l.angle * DEG);
  features.push({ type: 'kicker', x: l.x, z: r2(-l.kick), width: l.width - 3, sideWidth: 2, lipHeight: l.lip, lipAngle: l.angle, back: 1 });
  const height = r2(l.lip * (1 - BAG_DROP));
  features.push({ type: 'airbag', x: l.x, z: r2(-(lipAt - BAG_BACK)), width: l.width, sideWidth: 0.8, height, back: BAG_BACK, top: l.top, angle: l.face, knuckle: 3, transition: 5, color: l.color, accent: l.accent });
  bagEnds.push(lipAt + l.top + height / Math.tan(l.face * DEG) + 4);
  decor.push({ kind: 'sign', x: r2(l.x - l.width / 2 - 4), z: -(LANE_TOP + 6), heading: 0, header: '', lines: [{ text: l.name, level: l.level, arrow: 0 }] });
}

// ---------------------------------------------------------------- upper mountain (13°)
{
  const lim = D.cut - 4;
  for (const x of [X.pipe, X.big, X.rails, X.jumps, X.mini]) flag(x, 66 + Math.abs(x - START_X) * 0.12);

  // Jib Alley: rails and boxes side by side in pairs, ride-on and off small kickers.
  sectionEnd('Jib Alley', line(X.rails, 92, 9, [
    PAIR([-7, 'box', SLIDES.flat(12, 0.3), 0.9], [7, 'rail', SLIDES.flat(12, 0.35)]),
    S('box', SLIDES.flatDown(14, 0.35), 0.7),
    K('rail', SLIDES.fed(14)),
    PAIR([-7, 'rail', SLIDES.flatDown(15)], [7, 'box', SLIDES.flat(14), 1.0]),
    S('box', SLIDES.rainbow(10, 0.3, 0.5), 0.8),
    K('box', SLIDES.fed(13), { width: 0.8 }),
    PAIR([-7, 'rail', SLIDES.downFlatDown(17, 0.45)], [7, 'box', SLIDES.flatDown(15, 0.4), 0.8]),
    TUBE(SLIDES.flat(14, 0.7)),
    TABLE(),
    PAIR([-7, 'rail', SLIDES.kinked(20, -1)], [7, 'box', SLIDES.downFlatDown(18, 0.4), 0.8]),
    K('rail', [[0, 0, FED + 0.1], [15, 0, FED + 0.1]], { look: 'tube' }),
    S('rail', SLIDES.flat(20, 0.5)),
    BARRELS(6),
    PAIR([-7, 'rail', SLIDES.downFlatDown(18)], [7, 'rail', SLIDES.rainbow(13, 0.7, 0.6), 0, 'tube']),
    K('box', [[0, 0, FED], [7, 0, 1.0], [15, 0, 0.45]], { width: 0.8 }),
    S('rail', SLIDES.s(16, 1.2, 0.5)),
  ]), lim);

  // Rhythm: medium tables that grow down the hill, a step-up and a step-down among them.
  sectionEnd('Rhythm', line(X.jumps, 84, 11, [
    RAILED(deckTables, J({ lip: 1.3, angle: 16, gap: 5, land: 13, width: 8 })),
    RAILED(deckTables, J({ lip: 1.6, angle: 17, gap: 7, land: 13 })),
    RAILED(deckTables, J({ lip: 1.8, angle: 18, gap: 8, land: 13 })),
    RAILED(knuckleTables, J({ lip: 2, angle: 19, gap: 9, land: 13, width: 9 })),
    J({ lip: 2, angle: 20, gap: 6, deck: false, landingHeight: 2.8, land: 13, width: 9 }),
    RAILED(knuckleTables, J({ lip: 2.2, angle: 20, gap: 9, land: 14, width: 9 })),
    RAILED(knuckleTables, J({ lip: 2.4, angle: 20, gap: 10, land: 14, width: 9 })),
    J({ lip: 2.4, angle: 21, gap: 7, deck: false, landingHeight: 1.6, land: 13, width: 9 }),
    10,
    J({ lip: 2.6, angle: 21, gap: 11, land: 14, width: 10 }),
  ]), lim);

  // Mini Pipe: hips, then the mini pipe, then a table and a quarterpipe that throws riders back toward Rhythm.
  const pipe = 205;
  sectionEnd('Mini Pipe hips', line(X.mini, 90, 10, [HIP(1, 1), J({ lip: 1.4, angle: 18, gap: 7, land: 13 })]), pipe - 24 - 4);
  features.push({ type: 'halfpipe', x: X.mini, z: -pipe, yaw: 0, length: 170, floorWidth: 11, radius: 4.2, wallAngle: 80, deckWidth: 3, outerWidth: 5, dropIn: 6, entry: 12, back: 24, exit: 12 });
  sectionEnd('Mini Pipe', line(X.mini, pipe + 170 + 16, 10, [
    J({ lip: 2, angle: 19, gap: 9, land: 14, width: 9 }),
    // Riders come off the pipe's floor fast: room past the table's landing before the hip's back.
    16,
    HIP(-1, 1.1),
    QP(-1, 40, 4),
  ]), lim);

  // Big Line: large tables, sized like Jam Park's main-jam pro line, and a step-down over a stand of trees.
  sectionEnd('Big Line', line(X.big, 100, 12, [
    J({ lip: 2.4, angle: 20, gap: 11, land: 14, width: 10 }),
    J({ lip: 2.6, angle: 20, gap: 12, land: 14, width: 10 }),
    J({ lip: 2.8, angle: 21, gap: 13, land: 14, width: 11 }),
    J({ lip: 3, angle: 22, gap: 14, land: 14, width: 11 }),
    TREES(J({ lip: 3, angle: 20, gap: 9, deck: false, landingHeight: 1.8, land: 13, width: 11 }), 'Timber gap', 300, 0.4, 61),
    12,
    J({ lip: 3, angle: 22, gap: 14, land: 14, width: 11 }),
    J({ lip: 3.2, angle: 22, gap: 15, land: 14, width: 12 }),
  ]), lim);

  // The superpipe, then big jibs below it.
  const superpipe = 150;
  features.push({ type: 'halfpipe', x: X.pipe, z: -superpipe, yaw: 0, length: 220, floorWidth: 17, radius: 6.5, wallAngle: 84, deckWidth: 4, outerWidth: 8, dropIn: 8, entry: 16, back: 34, exit: 16 });
  sectionEnd('Superpipe jibs', line(X.pipe, superpipe + 220 + 24, 10, [
    PAIR([-8, 'rail', SLIDES.downFlatDown(24)], [8, 'box', SLIDES.flat(20, 0.45), 1.0]),
    K('rail', SLIDES.fed(18)),
    TUBE(SLIDES.flat(22, 0.75)),
    PAIR([-8, 'box', SLIDES.rainbow(14, 0.4, 0.7, 10), 1.0], [8, 'rail', SLIDES.kinked(22, 1)]),
  ]), lim);

  // First Tracks, below the School Yard: rollers, extra-small tables, wide boxes, and a hop over a row of saplings.
  flag(X.green, 330, 60);
  sectionEnd('First Tracks', line(X.green, 345, 10, [
    ROW([-22, ROLLER()], [0, ROLLER(0.8)], [22, ROLLER()]),
    ROW([-18, J({ lip: 0.8, angle: 12, gap: 3, land: 10, knuckle: 2, transition: 4, width: 7 })], [14, S('box', SLIDES.flat(10, 0.25), 1.2)]),
    ROW([-20, ROLLER(0.6)], [20, ROLLER(0.6)]),
    ROW([-18, S('box', SLIDES.flat(12, 0.3), 1.2)], [16, J({ lip: 1, angle: 14, gap: 4, land: 11, knuckle: 2, transition: 4, width: 7 })]),
    ROW([-22, ROLLER()], [0, ROLLER(0.9)], [22, ROLLER()]),
    ROW([-16, TREES(J({ lip: 1.1, angle: 15, gap: 4.5, deck: false, landingHeight: 1.1, land: 11, knuckle: 2, transition: 4, width: 7 }), 'Sapling gap', 150, 0.17, 71, false)], [18, S('rail', SLIDES.flat(10, 0.3))]),
  ]), lim);
}

// ---------------------------------------------------------------- the Garden (12°)
{
  const lim = D.bench - 4;
  flag(X.jumps, D.garden - 14, 60);
  flag(-130, D.garden - 14, 40);
  flag(X.green, D.garden - 14, 60);

  // One rail garden for the three lanes: everything ride-on, side by side, bonks in the middle, wallrides on both edges.
  sectionEnd('The Garden', line(X.jumps, D.garden + 8, 10, [
    PAIR([-30, 'rail', SLIDES.c(16, 30, 0.45, -1)], [-15, 'rail', SLIDES.flat(14, 0.7), 0, 'tube'], [0, 'box', SLIDES.downFlatDown(18, 0.35), 0.8], [15, 'rail', SLIDES.rainbow(12, 0.4, 0.6)], [30, 'rail', SLIDES.c(16, 30, 0.45, 1)]),
    PAIR([-22, 'rail', SLIDES.kinked(18, -1)], [-7, 'box', SLIDES.flat(16), 0.6], [8, 'rail', SLIDES.downFlatDown(18)], [23, 'box', SLIDES.rainbow(11, 0.3, 0.6), 1.0]),
    ROW([-30, TABLE()], [-11, BARRELS()], [11, SPOOL()], [30, TABLE(4)]),
    { len: 18, place: (x, d) => [WALL(-36), WALL(36)].forEach((w) => w.place(x, d)) },
    PAIR([-22, 'rail', SLIDES.flat(18, 0.45)], [-7, 'box', SLIDES.rainbow(12, 0.35, 0.6), 1.0], [8, 'rail', SLIDES.jog(18, 1.5)], [23, 'box', SLIDES.flat(16), 0.8]),
    PAIR([-28, 'box', SLIDES.flat(14, 0.35), 1.0], [-10, 'rail', SLIDES.rainbow(12, 0.4, 0.6)], [10, 'box', SLIDES.downFlatDown(18, 0.35), 0.9], [28, 'rail', SLIDES.flat(14, 0.4)]),
  ]), lim);

  // Left of the lift: a hip into a wallride, then a big table.
  sectionEnd('Hip and wall', line(-130, D.garden + 10, 14, [
    HIP_WALL(1, 1.5),
    10,
    J({ lip: 2.8, angle: 21, gap: 13, land: 14, width: 11 }),
    K('rail', SLIDES.fedDown(18, 0.45)),
  ]), lim);

  // First Tracks carries on down the right.
  sectionEnd('First Tracks (lower)', line(X.green, D.garden + 10, 12, [
    ROW([-20, ROLLER()], [0, ROLLER(0.9)], [20, ROLLER()]),
    ROW([-16, S('box', SLIDES.flat(12, 0.3), 1.2)], [16, J({ lip: 1, angle: 14, gap: 4, land: 11, knuckle: 2, transition: 4, width: 7 })]),
    ROW([-20, ROLLER(0.6)], [0, ROLLER()], [20, ROLLER(0.6)]),
    ROW([-14, J({ lip: 1.2, angle: 15, gap: 5, land: 12, knuckle: 2, transition: 4, width: 8 })], [16, S('box', SLIDES.rainbow(9, 0.25, 0.4), 1.2)]),
  ]), lim);
}

// ---------------------------------------------------------------- the venue (15°)
/** The Slot: two mounds either side of the venue's middle, a slot between them. */
const SLOT = {
  start: 985,
  /** Each mound's middle from the venue's, its top's width, and the bank down its sides. */
  off: 17,
  width: 22,
  blend: 4,
  /** The rise up onto the mound, its deck, and the drop off its end: length and pitch. */
  rise: [22, -5] as const,
  deck: 42,
  drop: [28, 30] as const,
};
/** The Hip: a spine down the venue's middle whose banks are landings. */
const HIPS = {
  start: 1150,
  width: 12,
  blend: 26,
  rise: [32, -7] as const,
  deck: 84,
  drop: [34, 31] as const,
  /** The quarterpipes facing the landings: how far out their feet run, their length and radius. */
  quarter: { off: 66, length: 78, radius: 7 },
};
{
  const v = X.venue;
  flag(v, D.venue - 22, 70);

  // The riders' zone: a snow bar to slide (its kegs beside it), and a few rails.
  sectionEnd('Riders zone', line(v, D.venue + 8, 10, [
    ROW(
      [-24, K('box', [[0, 0, 1.0], [10, 0, 1.0]], { width: 1.3, look: 'ledge', lip: 1.1, angle: 8, gap: 1.3 })],
      [-8, S('rail', SLIDES.flat(14, 0.45))],
      [8, S('rail', SLIDES.downFlatDown(18))],
      [24, BARRELS(7)],
    ),
    ROW([-16, S('box', SLIDES.rainbow(11, 0.3, 0.6), 1.0)], [0, SPOOL()], [16, S('rail', SLIDES.kinked(18, 1))]),
  ]), SLOT.start - 30);
  decor.push({ kind: 'hut', points: [{ x: v - 31, z: -(D.venue + 20) }], heading: -90 });
  decor.push({ kind: 'person', points: [{ x: v - 28, z: -(D.venue + 24) }, { x: v - 28.5, z: -(D.venue + 28) }, { x: v - 34, z: -(D.venue + 30) }, { x: v + 30, z: -(D.venue + 22) }, { x: v + 31.5, z: -(D.venue + 25) }], heading: 90 });
  decor.push({ kind: 'bunting', points: [{ x: v - 34, z: -(D.venue + 16) }, { x: v - 22, z: -(D.venue + 14) }, { x: v - 22, z: -(D.venue + 34) }, { x: v - 34, z: -(D.venue + 34) }] });

  // The Slot's mounds: each a lane that climbs onto a deck, runs level with the slope, and drops off its end.
  const s = SLOT;
  const deckFrom = s.start + s.rise[0];
  const deckTo = deckFrom + s.deck;
  for (const side of [-1, 1] as const) {
    const x = v + side * s.off;
    lanes.push({ x, width: s.width, blend: s.blend, start: s.start, endEase: 20, sections: [sec(s.rise[0], s.rise[1], 8), sec(s.deck, PITCH.venue, 8), sec(s.drop[0], s.drop[1], 8), sec(30, undefined, 20)] });
    // A step-up onto the mound, and a step-down off its end.
    features.push({ type: 'kicker', x, z: -(s.start - 19), width: 7, sideWidth: 2, lipHeight: 1.8, lipAngle: 24, back: 2.2 });
    gaps.push({ name: 'Step-up', from: across(x, s.start - 22, s.start - 9, 6), to: across(x, s.start + 2, deckTo, s.width / 2 + 2), points: 300 });
    // Off the deck's outer half: its inner half is the way across the slot.
    features.push({ type: 'kicker', x: x + side * 4, z: -(deckTo - 10), width: 7, sideWidth: 2, lipHeight: 1.0, lipAngle: 12, back: 1.4 });
    gaps.push({ name: 'Step-down', from: across(x + side * 4, deckTo - 15, deckTo + 3, 6), to: across(x, deckTo + 5, deckTo + 70, s.width / 2 + 6), points: 300 });
  }
  // Across the slot: a kicker on each deck's inner edge, heading for the other deck, and a rail from deck to deck.
  const inner = s.off - s.width / 2;
  // Angled 60° off the fall line, so riders keep the speed they ride the deck with.
  const kick = { lip: 1.2, angle: 22, yaw: 60 };
  const reach = (2 * kick.lip) / Math.tan(kick.angle * DEG);
  const out = reach * Math.sin(kick.yaw * DEG) + 0.5;
  features.push({ type: 'kicker', x: r2(v - inner - out), z: -(deckFrom + 20), yaw: -kick.yaw, width: 5, sideWidth: 1.5, lipHeight: kick.lip, lipAngle: kick.angle, back: 1 });
  features.push({ type: 'kicker', x: r2(v + inner + out), z: -(deckFrom + 28), yaw: kick.yaw, width: 5, sideWidth: 1.5, lipHeight: kick.lip, lipAngle: kick.angle, back: 1 });
  // Taken off a deck's inner half (each kicker sits in it), landed anywhere on the other deck.
  const deckL = rect(v - s.off - s.width / 2, v - inner + 1, deckFrom - 2, deckTo + 18);
  const deckR = rect(v + inner - 1, v + s.off + s.width / 2, deckFrom - 2, deckTo + 18);
  // Each takeoff area's middle is its kicker's, and each landing area's middle lies along that kicker's heading
  // (tools/sim/score.ts rides from one middle toward the other).
  const mid = reach / 2;
  const kx = inner + 0.5 + mid * Math.sin(kick.yaw * DEG);
  const far = (s.off + kx) / Math.tan(kick.yaw * DEG);
  const zone = (side: -1 | 1, d: number): void => {
    const at = d + mid * Math.cos(kick.yaw * DEG);
    const from = rect(v + side * (kx - 5), v + side * (kx + 5), at - 8, at + 8);
    const to = side < 0 ? deckR : deckL;
    gaps.push({ name: 'Slot gap', from, to: [...to.slice(0, 2).map((p) => ({ ...p, z: r2(-(at + far - 24)) })), ...to.slice(2).map((p) => ({ ...p, z: r2(-(at + far + 24)) }))], points: 500 });
  };
  zone(-1, deckFrom + 20);
  zone(1, deckFrom + 28);
  // The rail spans the slot at the head of the decks, clear of both transfers' flight.
  const span = deckFrom + 3;
  features.push({ type: 'rail', style: 'tube', points: [[v - inner - 9, 0], [v - inner - 5.5, 0.5], [v + inner + 5.5, 0.5], [v + inner + 9, 0]].map(([x, height]) => ({ x: r2(x!), z: -span, height })) });
  flag(v, HIPS.start - 34, 80);

  // The Hip: a spine whose banks are the landings. One straight kicker at
  // its head, then takeoffs angled off it to each side in turn (the last
  // pair steeper, for height), each lip at the deck's edge.
  const h = HIPS;
  lanes.push({ x: v, width: h.width, blend: h.blend, start: h.start, endEase: 24, sections: [sec(h.rise[0], h.rise[1], 8), sec(h.deck, PITCH.venue, 8), sec(h.drop[0], h.drop[1], 8), sec(36, undefined, 24)] });
  const hipFrom = h.start + h.rise[0];
  const hipTo = hipFrom + h.deck;
  features.push({ type: 'kicker', x: v, z: -(hipFrom + 6), width: 6, sideWidth: 2, lipHeight: 1.8, lipAngle: 20, back: 2 });
  const takeoff = (d: number, side: -1 | 1, lip: number, angle: number, yaw: number): void => {
    const len = (2 * lip) / Math.tan(angle * DEG);
    // Start so the lip's middle is on the deck's edge.
    const x = v + side * (h.width / 2 - 0.5 - len * Math.sin(yaw * DEG));
    features.push({ type: 'kicker', x: r2(x), z: r2(-d), yaw: -side * yaw, width: 5.5, sideWidth: 1.5, lipHeight: lip, lipAngle: angle, back: 2 });
  };
  /** A takeoff and its named gap: off the spine around it, onto that side's bank, the areas' middles along its heading. */
  const hipGap = (d: number, side: -1 | 1, lip: number, angle: number, yaw: number): void => {
    takeoff(d, side, lip, angle, yaw);
    const len = (2 * lip) / Math.tan(angle * DEG);
    const at = d + (len / 2) * Math.cos(yaw * DEG);
    const x0 = h.width / 2 + 1;
    const x1 = h.width / 2 + h.blend + 14;
    // The landing area's middle, along the takeoff's heading from its own middle.
    const kx = h.width / 2 - 0.5 - (len / 2) * Math.sin(yaw * DEG);
    const far = ((x0 + x1) / 2 - kx) / Math.tan(yaw * DEG);
    gaps.push({
      name: 'Hip',
      from: across(v, at - 8, at + 8, h.width / 2 + 1),
      to: rect(v + side * (side > 0 ? x0 : x1), v + side * (side > 0 ? x1 : x0), at + far - 34, at + far + 34),
      points: 400,
    });
  };
  hipGap(hipFrom + 24, -1, 2.2, 28, 32);
  hipGap(hipFrom + 38, 1, 2.2, 28, 32);
  hipGap(hipFrom + 54, -1, 2.8, 36, 36);
  hipGap(hipFrom + 68, 1, 2.8, 36, 36);
  for (const side of [-1, 1] as const) {
    // A huge quarterpipe facing the landing.
    features.push({ type: 'quarter', x: v + side * h.quarter.off, z: -(hipFrom + 34), yaw: 0, side, length: h.quarter.length, radius: h.quarter.radius, wallAngle: 80, deckWidth: 3, back: 8, taper: 10 });
  }
  // The knuckle at the spine's end: a low kicker just before it, and the long face below.
  features.push({ type: 'kicker', x: v, z: -(hipTo - 11), width: 7, sideWidth: 2, lipHeight: 1.0, lipAngle: 12, back: 1.4 });
  gaps.push({ name: 'Knuckle', from: across(v, hipTo - 16, hipTo + 4, 6), to: across(v, hipTo + 5, hipTo + 100, 22), points: 350 });
}

// The Gauntlet, left of the lift: a giant step-up, a tree gap, a cannon rail, a loop, and one huge step-down jump.
/** The huge jump's lane (Jam Park's pro jump: a speed-check rise, a level spot, a steep in-run, a table, a long steep landing). */
const PRO = {
  rise: [30, -12] as const,
  level: [16, 4] as const,
  inrun: [40, 26] as const,
  table: 28,
  lip: 3.5,
  lipAngle: 30,
  width: 12,
  upper: [36, 46] as const,
  steep: [24, 54] as const,
  lower: [14, 38] as const,
  runout: [40, 6] as const,
  kickerIn: 6,
};
/** Where the loop goes (laid last, on the snow's own heights). */
const LOOP = { x: X.gauntlet + 24, d: 0 };
{
  const g = X.gauntlet;
  flag(g, D.venue - 22, 60);
  const cannon: Item = {
    len: 11 + 4.2 + 2 + 3 + 1.8 / Math.tan(16 * DEG) + 4,
    place: (x, d) => {
      // A fat pipe rising away from the snow to 3 m at its end, a gap, then a landing: slide up it and off the end.
      features.push(slideJson('rail', x, d, [[0, 0, 0], [2.5, 0, 0.5], [11, 0, 3]], { style: 'tube', radius: 0.14 }));
      const at = d + 11 + 4.2;
      features.push({ type: 'landing', x: r2(x), z: r2(-at), yaw: 0, width: 9, sideWidth: 2.5, height: 1.8, angle: 16, back: 2, top: 3, knuckle: 2, transition: 6 });
      gaps.push({ name: 'Cannon', from: across(x, d + 6.5, d + 12, 1.5), to: across(x, at + 2, at + 80, 7), points: 350 });
    },
  };
  const stepUp = J({ lip: 2.6, angle: 26, gap: 8, deck: false, landingHeight: 4.6, land: 16, width: 11 });
  const end = line(g, D.venue + 10, 14, [
    { ...stepUp, place: (x, d) => {
      stepUp.place(x, d);
      const lip = (2 * 2.6) / Math.tan(26 * DEG);
      gaps.push({ name: 'Giant step-up', from: across(x, d - 3, d + lip + 1, 8), to: across(x, d + lip + 6, d + stepUp.len + 60, 8), points: 400 });
    } },
    12,
    TREES(J({ lip: 2.8, angle: 22, gap: 13, deck: false, landingHeight: 2.8, land: 16, width: 11 }), 'Tree gap', 400, 0.42, 81),
    12,
    cannon,
  ]);
  LOOP.d = end + 14;
  // The Big One: the huge jump's lane, from below the loop to the Playground.
  const d0 = LOOP.d + 20 + PRO.rise[0] + PRO.level[0] + 26;
  const start = d0 - PRO.rise[0] - PRO.level[0];
  const tableAt = d0 + PRO.inrun[0];
  sectionEnd('Gauntlet', start, 1230);
  features.push({ type: 'kicker', x: g, z: -(tableAt + PRO.kickerIn), width: PRO.width, sideWidth: 4, lipHeight: PRO.lip, lipAngle: PRO.lipAngle, back: 3 });
  flag(g, d0 - PRO.level[0] / 2, 36);
  const used = d0 + PRO.inrun[0] + PRO.table + PRO.upper[0] + PRO.steep[0] + PRO.lower[0] + PRO.runout[0] - start;
  lanes.push({
    x: g,
    width: 34,
    blend: 26,
    start,
    endEase: 30,
    sections: [
      sec(PRO.rise[0], PRO.rise[1], 8),
      sec(PRO.level[0], PRO.level[1], 8),
      sec(PRO.inrun[0], PRO.inrun[1], 20),
      sec(PRO.table, 2, 16),
      sec(PRO.upper[0], PRO.upper[1], 10),
      sec(PRO.steep[0], PRO.steep[1], 14),
      sec(PRO.lower[0], PRO.lower[1], 16),
      sec(PRO.runout[0], PRO.runout[1], 40),
      sec(D.play - 6 - start - used, undefined, 30),
    ],
  });
  gaps.push({ name: 'The Big One', from: across(g, tableAt, tableAt + PRO.kickerIn + 15, 9), to: across(g, tableAt + PRO.table, tableAt + PRO.table + 130, 18), points: 600 });
}

// Easy Street, right of the venue: the easy way down. Its own lane of
// terrain steps down the hill in benches and short pitches, like a real
// green run, with a roller or a small feature on each bench.
{
  const x = 166;
  flag(x, D.venue - 22, 50);
  const BENCH = [78, 9] as const;
  const STEP = [42, 25] as const;
  const from = D.venue + 16;
  const sections: Json[] = [];
  let at = from;
  let k = 0;
  while (at + BENCH[0] + STEP[0] < D.play - 70) {
    sections.push(sec(BENCH[0], BENCH[1], 18), sec(STEP[0], STEP[1], 18));
    const d = at + 26;
    const items: [number, Item][][] = [
      [[-12, ROLLER()], [12, ROLLER(0.6)]],
      [[-12, S('box', SLIDES.flat(12, 0.3), 1.2)], [12, ROLLER(0.9)]],
      [[-12, ROLLER(0.8)], [12, J({ lip: 1, angle: 14, gap: 4, land: 11, knuckle: 2, transition: 4, width: 7 })]],
      [[-12, J({ lip: 1.2, angle: 15, gap: 5, land: 12, knuckle: 2, transition: 4, width: 8 })], [12, S('box', SLIDES.flat(12, 0.3), 1.2)]],
    ];
    ROW(...items[k % items.length]!).place(x, d);
    at += BENCH[0] + STEP[0];
    k++;
  }
  sections.push(sec(D.play - 20 - at, undefined, 30));
  lanes.push({ x, width: 46, blend: 10, start: from, endEase: 30, sections });
  ends.push(`Easy Street: ${k} benches from d ${from} to ${at}`);
}

// ---------------------------------------------------------------- the Playground (9°)
{
  flag(X.venue - 20, D.play - 16, 120);
  // Quarterpipes across the way down, each throwing riders toward the next, and a volcano between them.
  line(X.venue + 34, D.play + 6, 8, [QP(-1, 40, 3.6)]);
  line(X.venue - 86, D.play + 6, 8, [QP(1, 40, 3.6)]);
  features.push({ type: 'landing', x: X.venue - 26, z: -(D.play + 22), width: 7, sideWidth: 6, height: 2.6, angle: 22, back: 9, top: 2.4, knuckle: 2, transition: 4 });
  features.push(poleJam(X.venue - 12, D.play + 50));
  features.push(slideJson('rail', X.venue - 40, D.play + 52, SHAPES.aFrame(14)));
  line(X.gauntlet + 10, D.play + 20, 10, [PAIR([-10, 'box', SLIDES.flat(14, 0.35), 1.2], [10, 'rail', SHAPES.wave(16)])]);
}

// ---------------------------------------------------------------- milestone 14 kit rails on tables
deckTables.forEach((t, i) => features.push(deckRail(t.x, t.d, t.o, i % 2 === 0 ? 1 : -1)));
knuckleTables.forEach((t, i) => features.push(knuckleRail(t.x, t.d, t.o, i % 2 === 0 ? -1 : 1)));

// ---------------------------------------------------------------- the base
const finish = { x: 20, z: -(D.base + 14), heading: 0, width: WIDTH - 40, length: 84, arch: { x: 20, z: -(D.base + 14), width: 44 } };
/** The chairlift: bottom station on the base flat, top station on the summit. */
const LIFT = { bottom: D.base + 68, top: 26 };
decor.push({ kind: 'chairlift', ride: true, points: [{ x: X.lift, z: -LIFT.bottom }, { x: X.lift, z: -LIFT.top }] });
// The base village, along the bottom of the finish flat, out of the way down: the lodge on the right with a rental
// shop beside it, a cafe by the lift, ski racks and people in front of each, a groomer and snowmobiles parked.
const VILLAGE = D.base + 62;
features.push({ type: 'building', x: 172, z: -(VILLAGE - 26), yaw: 0, length: 26, width: 40, eave: 5.5, roof: 'gable', rise: 4, style: 'lodge', color: '#7a5a3a', front: 'up', sign: 'Lodge', chimney: true });
features.push({ type: 'building', x: 118, z: -VILLAGE, yaw: 0, length: 14, width: 22, eave: 3.6, roof: 'gable', rise: 2.6, style: 'shop', color: '#3d6f9e', front: 'up', sign: 'Rentals' });
features.push({ type: 'building', x: -124, z: -(VILLAGE - 4), yaw: 0, length: 14, width: 20, eave: 3.6, roof: 'gable', rise: 2.6, style: 'chalet', color: '#a87443', front: 'up', sign: 'Cafe', chimney: true });
features.push({ type: 'building', x: 62, z: -(VILLAGE + 4), yaw: 0, length: 10, width: 14, eave: 3.2, roof: 'gable', rise: 2.2, style: 'shop', color: '#b8452f', front: 'up', sign: 'Tickets' });
decor.push({ kind: 'skiRack', points: [{ x: 150, z: -(VILLAGE - 32) }, { x: 160, z: -(VILLAGE - 32) }, { x: 112, z: -(VILLAGE - 5) }, { x: -130, z: -(VILLAGE - 9) }], heading: 0 });
decor.push({
  kind: 'person',
  points: [
    [146, -30], [148, -34], [165, -31], [183, -30], [108, -6], [124, -5], [129, -7], [-118, -9], [-128, -11], [56, -2], [66, -3],
    [-8, -44], [-10, -41], [48, -44], [52, -42], [51, -46], [-84, -4], [-86, -7], [20, -8], [24, -6], [-30, -10],
  ].map(([x, d]) => ({ x: x!, z: -(VILLAGE + d!) })),
  heading: 180,
});
decor.push({ kind: 'skier', points: [{ x: 90, z: -(VILLAGE - 16) }, { x: 10, z: -(VILLAGE - 12) }, { x: -44, z: -(LIFT.bottom - 12) }, { x: -96, z: -(VILLAGE - 14) }], heading: 160 });
decor.push({ kind: 'groomer', points: [{ x: 200, z: -(VILLAGE + 14) }], heading: -60 });
decor.push({ kind: 'snowmobile', points: [{ x: -92, z: -(LIFT.bottom + 4) }, { x: -95, z: -(LIFT.bottom + 7) }, { x: 84, z: -(VILLAGE + 2) }], heading: 30, color: '#c8331f' });
decor.push({ kind: 'banner', points: [-150, -110, 110, 150].map((x) => ({ x, z: -(D.base + 10) })), heading: 0, color: '#ff7a1a' });
decor.push({ kind: 'flag', points: [{ x: -6, z: -(D.base + 12) }, { x: 46, z: -(D.base + 12) }, { x: 96, z: -(VILLAGE - 10) }, { x: 140, z: -(VILLAGE - 10) }, { x: -102, z: -(VILLAGE - 12) }], heading: 0 });
decor.push({ kind: 'bunting', points: [{ x: 96, z: -(VILLAGE - 10) }, { x: 118, z: -(VILLAGE - 12) }, { x: 140, z: -(VILLAGE - 10) }] });
decor.push({ kind: 'streetLamp', points: [{ x: 100, z: -(VILLAGE - 14) }, { x: 136, z: -(VILLAGE - 34) }, { x: 40, z: -(VILLAGE - 2) }, { x: -100, z: -(VILLAGE - 16) }, { x: -40, z: -(VILLAGE + 2) }], heading: 0 });
// The lift's maze: a fence down the uphill side of the loading point, so riders come to it from the outside, and one behind it.
decor.push({ kind: 'fence', points: [{ x: X.lift - 6.5, z: -(LIFT.bottom - 30) }, { x: X.lift - 6.5, z: -(LIFT.bottom - 8) }] });
decor.push({ kind: 'fence', points: [{ x: X.lift - 20, z: -(LIFT.bottom + 6) }, { x: X.lift - 4, z: -(LIFT.bottom + 6) }] });
decor.push({ kind: 'fence', points: [{ x: X.lift + 8, z: -(LIFT.bottom - 30) }, { x: X.lift + 8, z: -(LIFT.bottom + 6) }] });

// ---------------------------------------------------------------- the summit's scenery
decor.push({ kind: 'bunting', points: [{ x: START_X - 16, z: -5 }, { x: START_X - 8, z: -5 }, { x: START_X + 8, z: -5 }, { x: START_X + 16, z: -5 }] });
decor.push({ kind: 'flag', points: [{ x: START_X - 10, z: -6 }, { x: START_X + 10, z: -6 }], heading: 0 });
decor.push({ kind: 'hut', points: [{ x: X.lift + 16, z: -12 }], heading: 180 });
decor.push({ kind: 'mast', points: [{ x: X.lift + 22, z: -8 }], heading: 0 });
decor.push({
  kind: 'sign', x: 22, z: -44, heading: 0, header: 'Proving Ground',
  lines: [
    { text: 'Superpipe', level: 'black', arrow: -1 },
    { text: 'Big Line', level: 'black', arrow: -1 },
    { text: 'Jib Alley', level: 'blue', arrow: 0 },
    { text: 'Rhythm', level: 'blue', arrow: 0 },
    { text: 'Mini Pipe', level: 'blue', arrow: 1 },
    { text: 'School Yard', level: 'green', arrow: 1 },
  ],
});
decor.push({
  kind: 'sign', x: 88, z: -(D.cut + 30), heading: 0, header: 'The Cut',
  lines: [
    { text: 'Hip and Wall', level: 'black', arrow: -1 },
    { text: 'The Garden', level: 'blue', arrow: 0 },
    { text: 'First Tracks', level: 'green', arrow: 1 },
  ],
});
decor.push({
  kind: 'sign', x: 108, z: -(D.bench + 30), heading: 0, header: 'The Venue',
  lines: [
    { text: 'Gauntlet', level: 'double', arrow: -1 },
    { text: 'The Slot', level: 'black', arrow: 0 },
    { text: 'The Hip', level: 'double', arrow: 0 },
    { text: 'Easy Street', level: 'green', arrow: 1 },
  ],
});

// ---------------------------------------------------------------- trees
// Tree islands between the trails (solid: part of the course), then forest
// on the hillsides. Each stand has its own seed, so changing one never
// re-places another.
let islandSeed = 200;
/** Length (m) of the pieces an island is laid in, each with its own width. */
const ISLAND_PIECE = 16;
/**
 * A stand of pines from x0 to x1 and d0 to d1, about one every `each` m².
 * Its edges wander: laid in short pieces, each pulled in from x0 and x1 by
 * up to `wander` m (never pushed out, so the trails keep their room), so
 * the tree line curves like a cut trail's rather than running ruler-straight.
 * `rib` (m) also raises the ground under it into a rib between the trails,
 * its banks reaching `bank` m out each side (`pitch` is the slope's there).
 */
function island(x0: number, x1: number, d0: number, d1: number, o: { each?: number; wander?: number; rib?: number; bank?: number; pitch?: number } = {}): void {
  const each = o.each ?? 36;
  const wander = o.wander ?? Math.min(7, (x1 - x0) / 4);
  const seed = islandSeed;
  const pull = (d: number, k: number): number => wander * (0.5 + 0.3 * Math.sin(d / 37 + seed * 1.7 + k * 2.1) + 0.2 * Math.sin(d / 14 + seed * 0.6 + k));
  for (let d = d0; d < d1 - 1; d += ISLAND_PIECE) {
    const e = Math.min(d1, d + ISLAND_PIECE);
    // Tapered ends: the last pieces narrow to a point.
    const taper = Math.min(1, (d - d0 + ISLAND_PIECE) / 40, (d1 - d) / 40);
    const mid = (x0 + x1) / 2;
    const a = mid + (x0 + pull(d, 0) - mid) * taper;
    const b = mid + (x1 - pull(d, 1) - mid) * taper;
    const width = b - a;
    if (width < 2) continue;
    const area = { x: r2((a + b) / 2), z: r2(-(d + e) / 2), width: r2(width), length: e - d };
    decor.push({ kind: 'pine', area, count: Math.max(1, Math.round((width * (e - d)) / each)), seed: islandSeed++, minScale: 0.8, maxScale: 1.5, solid: true });
    if (islandSeed % 3 === 0) decor.push({ kind: 'aspen', area, count: Math.max(1, Math.round((width * (e - d)) / (each * 4))), seed: islandSeed++, minScale: 0.8, maxScale: 1.2, solid: true });
  }
  if (o.rib) {
    // The rib: the ground climbs `rib` m over its first stretch, runs with the slope, and comes back level at its end.
    const bank = o.bank ?? 10;
    const pitch = o.pitch ?? PITCH.parks;
    const up = 40;
    const rise = Math.atan(Math.tan(pitch * DEG) - o.rib / up) / DEG;
    lanes.push({ x: r2((x0 + x1) / 2), width: Math.max(2, x1 - x0 - 2 * bank), blend: bank, start: d0 + 6, endEase: 16, sections: [sec(up, r2(rise), 16), sec(d1 - d0 - up - 60, pitch, 16), sec(48, undefined, 16)] });
  }
}
const STRETCHES: [number, number][] = [
  [88, D.cut - 2],
  [D.garden + 2, D.bench - 2],
  [D.venue + 4, D.play - 20],
];
const STRETCH_PITCH = [PITCH.parks, PITCH.garden, PITCH.venue];
STRETCHES.forEach(([a, b], i) => {
  // The lift's island, on a rib of its own (the lift line is cut along its crest).
  island(-84, -46, a, b, { rib: 4.5, bank: 10, pitch: STRETCH_PITCH[i] });
  // Left edge, and the right.
  island(-206, -186, a, b, { wander: 8 });
  island(196, 206, Math.max(a, 300), b, { wander: 5 });
});
// Between the Mini Pipe and the School Yard, then between the Garden and First Tracks.
island(70, 92, 88, D.cut - 2, { rib: 3.5, bank: 8, pitch: PITCH.parks });
island(72, 92, D.garden + 2, D.bench - 2, { rib: 3, bank: 8, pitch: PITCH.garden });
// Either side of the base, framing the village.
island(-206, -150, D.play + 30, D.base + 96, { wander: 12, each: 40 });
island(196, 206, D.play + 10, D.base + 20, { wander: 4 });
// Between the venue and Easy Street.
island(122, 138, D.venue + 4, D.play - 20, { rib: 3, bank: 6, pitch: PITCH.venue, wander: 3 });

// Orange fence between the School Yard's lanes at the flags, and netting below the Big One's landing.
for (let i = 0; i < LANES.length - 1; i++) {
  const x = (LANES[i]!.x + LANES[i]!.width / 2 + LANES[i + 1]!.x - LANES[i + 1]!.width / 2) / 2;
  decor.push({ kind: 'fence', points: [{ x: r2(x), z: -(LANE_TOP - 4) }, { x: r2(x), z: -(LANE_TOP + 22) }] });
}
// Floodlights along the islands' edges, aimed across the trails (lit at night), and light poles down First Tracks.
{
  const spots = (x: number, from: number, to: number, step: number): Json[] => {
    const pts: Json[] = [];
    for (let d = from; d < to; d += step) pts.push({ x, z: -d });
    return pts;
  };
  for (const [a, b] of STRETCHES) {
    decor.push({ kind: 'floodlight', points: spots(-47, a + 30, b, 90), heading: -90 });
    decor.push({ kind: 'floodlight', points: spots(-83, a + 75, b, 90), heading: 90 });
  }
  decor.push({ kind: 'floodlight', points: spots(71, 120, D.cut - 10, 90), heading: 90 });
  decor.push({ kind: 'floodlight', points: spots(91, 160, 330, 80), heading: -90 });
  decor.push({ kind: 'floodlight', points: spots(123, D.venue + 40, D.play - 20, 90), heading: 90 });
  decor.push({ kind: 'lightPole', points: spots(200, 360, D.play, 70), heading: 90 });
  decor.push({ kind: 'floodlight', points: [{ x: -40, z: -(D.play + 40) }, { x: 110, z: -(D.play + 40) }, { x: -150, z: -(D.base + 4) }, { x: 120, z: -(D.base + 4) }], heading: 0 });
}
// Banners over the top of each stretch, and the park's rules board style signs at the gates.
for (const d of [D.parks + 8, D.garden - 4, D.venue - 6]) decor.push({ kind: 'banner', points: [{ x: -84, z: -d }, { x: 70, z: -d }], heading: 0, color: '#ff7a1a' });

// Forest on the hillsides either side, and a second chairlift up the far hillside (scenery).
const len = D.end + 140;
const midZ = -(D.end / 2);
decor.push({ kind: 'pine', area: { x: -262, z: midZ, width: 74, length: len }, count: 2100, seed: 3, minScale: 0.8, maxScale: 1.5 });
decor.push({ kind: 'pine', area: { x: 262, z: midZ, width: 74, length: len }, count: 2100, seed: 5, minScale: 0.8, maxScale: 1.5 });
decor.push({ kind: 'rock', area: { x: -260, z: midZ, width: 70, length: len }, count: 160, seed: 8, minScale: 0.6, maxScale: 1.6 });
decor.push({ kind: 'boulder', area: { x: 260, z: midZ, width: 70, length: len }, count: 110, seed: 9, minScale: 0.8, maxScale: 1.6 });
decor.push({ kind: 'snag', area: { x: 258, z: midZ, width: 60, length: len }, count: 50, seed: 10, minScale: 0.8, maxScale: 1.2 });

// ---------------------------------------------------------------- runs
// Named trails, for the trail map and the headless rides (tools/sim/face.ts).
const run = (name: string, pts: [x: number, d: number][]): void => {
  runs.push({ name, points: pts.map(([x, d]) => ({ x, z: -d })), clear: 0 });
};
const home: [number, number][] = [[20, D.play + 30], [20, D.base + 40]];
run('Jib Alley', [[X.rails, 60], [X.rails, D.cut - 20], [X.jumps - 4, D.garden], [X.jumps - 4, D.bench], [X.venue, D.venue + 60], [X.venue, D.play - 30], ...home]);
run('Rhythm', [[X.jumps, 60], [X.jumps, D.cut - 20], [X.jumps + 15, D.garden], [X.jumps + 15, D.bench], [X.venue + SLOT.off, D.venue + 70], [X.venue + SLOT.off, 1090], [X.venue + 44, 1160], [X.venue + 44, D.play - 30], ...home]);
run('Mini Pipe', [[X.mini, 62], [X.mini, D.cut - 20], [X.jumps + 30, D.garden], [X.jumps + 30, D.bench], [X.venue - SLOT.off, D.venue + 70], [X.venue - SLOT.off, 1090], [X.venue - 44, 1160], [X.venue - 44, D.play - 30], ...home]);
run('Big Line', [[X.big, 66], [X.big, D.cut - 10], [-130, D.garden], [-130, D.bench], [X.gauntlet, D.venue], [X.gauntlet, D.play - 20], [-60, D.play + 40], [-20, D.base + 40]]);
run('Superpipe', [[X.pipe, 70], [X.pipe, D.cut - 10], [-116, D.garden], [-116, D.bench], [X.gauntlet + 16, D.venue], [X.gauntlet + 16, 1130], [X.gauntlet + 26, 1200], [X.gauntlet + 30, D.play - 20], [-60, D.play + 40], [-20, D.base + 40]]);
run('School Yard and First Tracks', [[117, 62], [117, 260], [X.green, 335], [X.green, D.bench], [165, D.venue], [165, D.play - 20], [110, D.play + 50], [60, D.base + 40]]);

// ---------------------------------------------------------------- terrain
const terrain = {
  type: 'generated',
  width: WIDTH,
  length: D.end,
  cellSize: 3,
  bermWidth: 14,
  bermHeight: 6,
  noise: 0.18,
  seed: 17,
  margin: 70,
  profile,
  lanes,
  hills: { amplitude: 20, wavelength: 200 },
};
// The foothills stay low for 1.2 km past the map's ground, so they stand back from the base.
const peaks = { seed: 41, count: 12, rings: 3, distance: [12000, 30000], base: -900, height: [1400, 3000], snowLine: 500, clear: 1200 };
const map = { name: 'Proving Ground', terrain, features, spawn, flags, finishes: [finish], decor, runs, colors: { sky: '#7fb4e6', fog: '#d6e6f4' }, peaks, gaps };

// ---------------------------------------------------------------- the loop
// Laid last, on the snow's own heights, in the Gauntlet beside the cannon's landing.
{
  const hf = generateSlope(parseMap(map).terrain);
  features.push(loop(LOOP.x, LOOP.d, (x, z) => heightAt(hf, x, z)));
}

// ---------------------------------------------------------------- report
const parsed = parseMap(map);
const hf = generateSlope(parsed.terrain);
for (const lane of solveLanes(parsed.terrain)) {
  const end = lane.sections.reduce((a, s) => a + s.length, lane.start);
  let lo = 0;
  let hi = 0;
  const beside = lane.x + lane.width / 2 + lane.blend + 4;
  for (let d = lane.start; d < end; d += 2) {
    const o = heightAt(hf, lane.x, -d) - heightAt(hf, beside, -d);
    lo = Math.min(lo, o);
    hi = Math.max(hi, o);
  }
  console.log(`lane x=${lane.x} d ${lane.start}–${end}: last pitch ${lane.sections.at(-1)?.pitch?.toFixed(1)}°, ${hi.toFixed(1)} m above / ${(-lo).toFixed(1)} m below the slope beside it`);
}
for (const e of ends) console.log(e);
console.log(`airbags end at d ${bagEnds.map((d) => d.toFixed(0)).join(', ')}; loop at d ${LOOP.d.toFixed(0)}; airbag keeps ${CONFIG.airbag.keep} of the speed`);
console.log(`${features.length} features, ${flags.length} flags, ${decor.length} decoration sets, ${gaps.length} named gaps; ${(heightAt(hf, 0, 0) - heightAt(hf, 0, -D.base)).toFixed(0)} m drop to the base`);
writeFileSync('src/maps/proving.json', JSON.stringify(map, null, 1) + '\n');
console.log('wrote src/maps/proving.json');
