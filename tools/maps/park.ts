// Lays out the Park and writes it to src/maps/park.json. The map file is the
// source the game loads; this script is how it was authored, so positions
// can be worked out from a few section lengths instead of typed by hand.
// Edit here and rerun, from the repo root:
//   node tools/maps/park.ts
// Then check the jumps with tools/sim/line.ts (see GAME_DESIGN.md, Jump sizing).
//
// Layout: the fall line runs down -Z, and d below is the distance down from
// the top (z = -d). Four lines run side by side the whole way down, with the
// long rail along the left edge:
//   x -128        the long rail, top to bottom
//   x -116..-72   jib line: rails and boxes, ride-on and off kickers
//   x  -62..-14   jump line: small tables at the top, large ones in the steeps
//   x   -2..62    middle: hips and step-ups, the small and the big halfpipe, a jib garden
//   x   76..128   right: medium and large tables, then the pro line's two huge jumps
// Sections stack top to bottom with flatter stretches between them, and a
// flag at the start of each section in every line.

import { writeFileSync } from 'node:fs';
import { parseMap } from '../../src/maps/loader.ts';
import { generateSlope, solveLanes } from '../../src/maps/terrain.ts';
import { heightAt } from '../../src/sim/terrain.ts';

type Json = Record<string, unknown>;
type Pt = [along: number, across: number, height: number];
const features: Json[] = [];
const flags: Json[] = [];
const decor: Json[] = [];
const r2 = (v: number): number => Math.round(v * 100) / 100;

// ---------------------------------------------------------------- sections
/** Where each stretch starts (d, m down from the top). s* are sections, f* the flats after them. */
const D = {
  s1: 60, // warm-up, 11°
  f1: 440,
  s2: 480, // main park, 13°
  f2: 820,
  s3: 860, // pro zone one, 21°
  f3: 1100,
  s4: 1180, // pro zone two, 21°
  f4: 1420,
  s5: 1480, // cruise and jib garden, 11°
  run: 1940, // finish flat, 3°
  stop: 2060, // climbs, to stop riders
  end: 2150,
};
const X = { longRail: -128, jib: -94, jump: -38, mid: 30, pro: 102 };
/** Fences between the lines. */
const FENCES = [-121, -67, -8, 69];

const sec = (length: number, pitch: number | undefined, ease = 20): Json =>
  pitch === undefined ? { length, ease } : { length, pitch, ease };

const PITCH = { top: 5, warmup: 11, main: 13, pro: 21, cruise: 11, flat: 6, finish: 3 };
const profile = [
  sec(D.s1, PITCH.top),
  sec(D.f1 - D.s1, PITCH.warmup, 40),
  sec(D.s2 - D.f1, PITCH.flat, 30),
  sec(D.f2 - D.s2, PITCH.main, 30),
  sec(D.s3 - D.f2, PITCH.flat, 30),
  sec(D.f3 - D.s3, PITCH.pro, 36),
  sec(D.s4 - D.f3, PITCH.flat, 36),
  sec(D.f4 - D.s4, PITCH.pro, 36),
  sec(D.s5 - D.f4, PITCH.flat, 36),
  sec(D.run - D.s5, PITCH.cruise, 36),
  sec(D.stop - D.run, PITCH.finish, 40),
  sec(D.end - D.stop, -6, 40),
];

// The pro line's huge jumps are mostly terrain, in a lane of their own. A
// little rise on the flat above checks the speed of anyone coming down
// from the section before, then a level spot to start from (the flag), then
// the steep in-run, the kicker at the start of a long table, the knuckle, a
// long steep landing that eases off at the bottom, and a runout. Sized with
// the headless sim (tools/sim/line.ts) for riders who tuck the in-run: from
// a standstill a clean 720 (2.28 s) gets at least 20% more air, and a full
// pop off a running start still lands on the steep part.
const PRO = {
  /** Speed-check rise and the level spot after it: length and pitch. */
  rise: [16, -10] as const,
  level: [18, 4] as const,
  /** In-run, from the level spot to the kicker. */
  inrun: [64, 21] as const,
  table: 34,
  lip: 3.5,
  lipAngle: 34,
  width: 12,
  /** Steep landing, the eased-off part below it, and the runout: length and pitch. */
  upper: [46, 46] as const,
  lower: [14, 36] as const,
  runout: [40, 6] as const,
};
/** How far the kicker sits into the table. */
const KICKER_IN = 6;

/** A huge jump in the pro line, for a section of the steeps from d0 to d1: its lane, kicker and flag. */
function proJump(d0: number, d1: number): Json {
  const start = d0 - PRO.rise[0] - PRO.level[0];
  const tableAt = d0 + PRO.inrun[0];
  features.push({ type: 'kicker', x: X.pro, z: -(tableAt + KICKER_IN), width: PRO.width, sideWidth: 4, lipHeight: PRO.lip, lipAngle: PRO.lipAngle, back: 3 });
  flag(X.pro, d0 - PRO.level[0] / 2, 36);
  const used = d0 + PRO.inrun[0] + PRO.table + PRO.upper[0] + PRO.lower[0] + PRO.runout[0] - start;
  return {
    x: X.pro,
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
      sec(PRO.lower[0], PRO.lower[1], 16),
      sec(PRO.runout[0], PRO.runout[1], 40),
      sec(d1 - start - used, undefined, 30),
    ],
  };
}

// ---------------------------------------------------------------- helpers
/** A checkpoint flag gate across a line at d. */
function flag(x: number, d: number, width = 30): void {
  flags.push({ x, z: -d, heading: 0, width });
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
}

/** A park jump whose takeoff starts at (x, d), straight down the hill. */
function jump(x: number, d: number, o: JumpOpts): void {
  const f: Json = {
    type: 'jump',
    x,
    z: -d,
    width: o.width ?? 7,
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

/**
 * A hip: a kicker angled off the fall line from one side, and a landing in
 * the line facing down the hill. Its back is long and gentle, so riding
 * straight down the line just rolls over it.
 */
function hip(x: number, d: number, side: -1 | 1, size: number): void {
  features.push({ type: 'kicker', x: x - side * 12, z: -d, yaw: -side * 32, width: 5, sideWidth: 2, lipHeight: 1.4 * size, lipAngle: 24, back: 1.5 * size });
  features.push({ type: 'landing', x, z: -(d - 2), width: 12, sideWidth: 3, height: 2.2 * size, angle: 16, back: 9 * size, top: 3 });
}

/** A rail or box straight down the hill from d: points as [m down from d, m to the right, height above the snow]. */
function slide(kind: 'rail' | 'box', x: number, d: number, pts: Pt[], width = 0.6, follow = 0): void {
  const f: Json = { type: kind, points: pts.map(([a, b, h]) => ({ x: r2(x + b), z: r2(-(d + a)), height: r2(h) })) };
  if (kind === 'box') f.width = width;
  if (follow > 0) f.follow = follow;
  features.push(f);
}

/** A small kicker straight down at (x, d), for jumping onto a rail or box. Returns the d of its lip. */
function kicker(x: number, d: number, lip: number, angle: number, width = 3): number {
  features.push({ type: 'kicker', x, z: -d, width, sideWidth: 1.5, lipHeight: lip, lipAngle: angle, back: 1.2 });
  return d + (2 * lip) / Math.tan((angle * Math.PI) / 180);
}

/**
 * A kicker onto a rail or box: the slide starts `gap` m past the lip. Low
 * and mellow by default, so rolling off it at speed drops onto the slide
 * instead of flying over it.
 */
function kickerTo(kind: 'rail' | 'box', x: number, d: number, pts: Pt[], o: { lip?: number; angle?: number; gap?: number; width?: number } = {}): void {
  const lip = kicker(x, d, o.lip ?? 0.6, o.angle ?? 10, kind === 'box' ? 3.5 : 3);
  slide(kind, x, lip + (o.gap ?? 1), pts, o.width ?? 0.7);
}

// Slide shapes (the first point at height 0 is a ride-on from the snow).
// "Flat" runs parallel to the snow, "down" drops toward it.
const SLIDES = {
  flat: (len: number, h = 0.4): Pt[] => [[0, 0, 0], [3.5, 0, h], [len, 0, h]],
  flatDown: (len: number, h = 0.45): Pt[] => [[0, 0, 0], [3.5, 0, h], [len * 0.55, 0, h + 0.15], [len, 0, h * 0.5]],
  downFlatDown: (len: number, h = 0.5): Pt[] => [[0, 0, 0], [3.5, 0, h], [len * 0.35, 0, h * 0.6], [len * 0.6, 0, h + 0.45], [len, 0, h * 0.7]],
  kinked: (len: number, side: number, h = 0.5): Pt[] => [[0, 0, 0], [3.5, 0, h], [len * 0.45, 0, h], [len * 0.7, side, h], [len, side * 2, h * 0.7]],
  rainbow: (len: number, base: number, rise: number, n = 8): Pt[] => [[0, 0, 0], ...SLIDES.arc(len, base, rise, n).slice(1)],
  /** An arc starting in the air at `base` (for jumping onto). */
  arc: (len: number, base: number, rise: number, n = 8): Pt[] => {
    const pts: Pt[] = [];
    for (let i = 0; i <= n; i++) pts.push([len * (i / n), 0, base + rise * Math.sin((Math.PI * i) / n)]);
    return pts;
  },
};
/** Kicker-fed rails start at about the lip's height, so a slow rider can't hit the front and a fast one still comes down onto it. */
const FED = 0.65;

// ---------------------------------------------------------------- start
features.push({ type: 'start', style: 'deck', x: -70, z: -14, heading: 0, height: 0.6 });
const spawn = { x: -70, z: -14, heading: 0 };

// ---------------------------------------------------------------- the long rail
// Ride on at the top, along the left edge, off at the finish flat.
slide('rail', X.longRail, 45, [[0, 0, 0], [5, 0, 0.5], [D.run - 55, 0, 0.5], [D.run - 51, 0, 0]], 0, 4);

// ---------------------------------------------------------------- S1 warm-up (11°)
{
  const d0 = D.s1;
  for (const x of [X.jib, X.jump, X.mid, X.pro]) flag(x, d0 + 7);
  const j = X.jib;
  slide('box', j - 8, d0 + 28, SLIDES.flat(14, 0.3), 0.8);
  slide('rail', j + 8, d0 + 28, SLIDES.flat(14));
  slide('box', j, d0 + 70, SLIDES.flatDown(15, 0.35), 0.6);
  slide('rail', j - 9, d0 + 112, SLIDES.flatDown(16));
  slide('box', j + 9, d0 + 112, SLIDES.flat(15), 1.0);
  kickerTo('rail', j, d0 + 161, [[0, 0, FED], [15, 0, FED]]);
  slide('rail', j - 8, d0 + 210, SLIDES.flat(18, 0.5));
  kickerTo('box', j + 8, d0 + 210, [[0, 0, FED], [14, 0, FED]]);
  slide('box', j, d0 + 259, SLIDES.rainbow(10, 0.3, 0.5), 0.8);
  slide('rail', j - 8, d0 + 308, SLIDES.downFlatDown(18, 0.45));
  slide('box', j + 8, d0 + 308, SLIDES.flatDown(16, 0.4), 0.8);

  jump(X.jump, d0 + 35, { lip: 1, angle: 15, gap: 4, land: 13, knuckle: 2, transition: 4, width: 6 });
  jump(X.jump, d0 + 91, { lip: 1.3, angle: 16, gap: 6, land: 13, width: 6 });
  jump(X.jump, d0 + 154, { lip: 1.6, angle: 17, gap: 7, land: 13 });
  jump(X.jump, d0 + 217, { lip: 1.8, angle: 18, gap: 8, land: 13 });
  jump(X.jump, d0 + 273, { lip: 1.6, angle: 18, gap: 8, land: 13 });
  jump(X.jump, d0 + 322, { lip: 1.8, angle: 19, gap: 8, land: 13 });

  hip(X.mid, d0 + 42, 1, 1);
  jump(X.mid, d0 + 105, { lip: 1.4, angle: 18, gap: 7, land: 13 });
  hip(X.mid, d0 + 168, -1, 1);
  jump(X.mid, d0 + 231, { lip: 1.8, angle: 18, gap: 9, land: 13 });
  hip(X.mid, d0 + 301, 1, 1);

  jump(X.pro, d0 + 49, { lip: 1.8, angle: 18, gap: 8, land: 13, width: 8 });
  jump(X.pro, d0 + 119, { lip: 2.2, angle: 19, gap: 10, land: 13, width: 8 });
  jump(X.pro, d0 + 196, { lip: 2.4, angle: 20, gap: 11, land: 13, width: 8 });
  jump(X.pro, d0 + 266, { lip: 2.2, angle: 20, gap: 6, deck: false, landingHeight: 1.6, land: 12, width: 8 });
  jump(X.pro, d0 + 322, { lip: 2.2, angle: 19, gap: 10, land: 13, width: 8 });
}

// ---------------------------------------------------------------- S2 main park (13°)
{
  const d0 = D.s2;
  for (const x of [X.jib, X.jump, X.mid, X.pro]) flag(x, d0 - 15);
  const j = X.jib;
  kickerTo('rail', j - 9, d0 + 22, [[0, 0, FED], [6, 0, 0.75], [15, 0, 0.4]]);
  kickerTo('box', j + 9, d0 + 22, [[0, 0, FED], [7, 0, 1.0], [15, 0, 0.45]]);
  slide('rail', j, d0 + 79, SLIDES.downFlatDown(21));
  slide('rail', j - 9, d0 + 137, SLIDES.kinked(21, 1.8));
  slide('box', j + 9, d0 + 137, SLIDES.downFlatDown(18, 0.4), 0.8);
  kickerTo('box', j, d0 + 194, SLIDES.arc(14, FED, 0.45), { width: 0.9 });
  slide('rail', j - 8, d0 + 252, SLIDES.kinked(22, -1.5));
  kickerTo('rail', j + 8, d0 + 252, [[0, 0, FED], [5, 0, 0.9], [10, 0, 1.0], [16, 0, 0.45]]);

  jump(X.jump, d0 + 29, { lip: 2, angle: 20, gap: 9, land: 14, width: 8 });
  jump(X.jump, d0 + 101, { lip: 2.2, angle: 22, gap: 6, deck: false, landingHeight: 3.2, land: 13, width: 8 });
  jump(X.jump, d0 + 173, { lip: 3, angle: 19, gap: 7, deck: false, landingHeight: 2.2, land: 12, width: 8 });
  jump(X.jump, d0 + 245, { lip: 2.6, angle: 21, gap: 12, land: 14, width: 9 });

  features.push({ type: 'halfpipe', x: X.mid, z: -(d0 + 29), yaw: 0, length: 150, floorWidth: 12, radius: 4.6, wallAngle: 82, deckWidth: 3, outerWidth: 6, dropIn: 6, entry: 12, back: 26, exit: 12 });
  jump(X.mid, d0 + 205, { lip: 2, angle: 16, gap: 10, land: 14, width: 8 });
  hip(X.mid, d0 + 300, 1, 1.2);

  jump(X.pro, d0 + 29, { lip: 2.4, angle: 20, gap: 11, land: 14, width: 9 });
  jump(X.pro, d0 + 108, { lip: 2.8, angle: 21, gap: 13, land: 14, width: 10 });
  jump(X.pro, d0 + 187, { lip: 3, angle: 20, gap: 8, deck: false, landingHeight: 1.8, land: 13, width: 10 });
  jump(X.pro, d0 + 266, { lip: 3, angle: 22, gap: 14, land: 14, width: 10 });
}

// ---------------------------------------------------------------- S3 pro zone one (21°)
const lanes: Json[] = [];
{
  const d0 = D.s3;
  for (const x of [X.jib, X.jump, X.mid]) flag(x, d0 - 20);
  const j = X.jib;
  slide('rail', j - 8, d0 + 40, SLIDES.flat(24, 0.5));
  slide('box', j + 8, d0 + 40, SLIDES.flat(20), 0.9);
  kickerTo('box', j, d0 + 120, [[0, 0, FED], [8, 0, 1.0], [18, 0, 0.5]], { width: 0.8 });
  slide('rail', j - 8, d0 + 190, SLIDES.rainbow(14, 0.5, 0.8, 10));
  slide('rail', j + 8, d0 + 190, SLIDES.downFlatDown(26));

  jump(X.jump, d0 + 50, { lip: 2.2, angle: 14, gap: 14, land: 14, width: 9, transition: 10 });
  jump(X.jump, d0 + 160, { lip: 2.6, angle: 14, gap: 16, land: 14, width: 10, transition: 10 });

  features.push({ type: 'halfpipe', x: X.mid, z: -(d0 + 14), yaw: 0, length: 210, floorWidth: 17, radius: 6.5, wallAngle: 84, deckWidth: 4, outerWidth: 8, dropIn: 8, entry: 16, back: 34, exit: 16 });

  lanes.push(proJump(d0, D.f3));
}

// ---------------------------------------------------------------- S4 pro zone two (21°)
{
  const d0 = D.s4;
  for (const x of [X.jib, X.jump, X.mid]) flag(x, d0 - 20);
  const j = X.jib;
  slide('box', j - 8, d0 + 40, SLIDES.flat(22, 0.45), 1.0);
  kickerTo('rail', j + 8, d0 + 40, [[0, 0, FED], [18, 0, FED]]);
  slide('rail', j, d0 + 120, SLIDES.kinked(26, 2));
  slide('box', j - 8, d0 + 190, SLIDES.rainbow(14, 0.4, 0.8, 10), 1.0);
  slide('rail', j + 8, d0 + 190, SLIDES.flat(30, 0.5));

  jump(X.jump, d0 + 50, { lip: 2.6, angle: 14, gap: 16, land: 14, width: 10, transition: 10 });
  jump(X.jump, d0 + 160, { lip: 2.8, angle: 15, gap: 11, deck: false, landingHeight: 2.0, land: 14, width: 10, transition: 10 });

  hip(X.mid + 14, d0 + 40, -1, 1);
  jump(X.mid, d0 + 140, { lip: 2.4, angle: 14, gap: 15, land: 14, width: 10, transition: 10 });

  lanes.push(proJump(d0, D.f4));
}

// ---------------------------------------------------------------- S5 cruise and jib garden (11°)
{
  const d0 = D.s5;
  for (const x of [X.jib, X.jump, X.mid, X.pro]) flag(x, d0 - 15);
  const j = X.jib;
  slide('box', j - 9, d0 + 27, SLIDES.flat(15, 0.35), 0.8);
  slide('rail', j + 9, d0 + 27, SLIDES.kinked(22, 1.5));
  kickerTo('rail', j, d0 + 82, SLIDES.arc(14, FED, 0.45));
  slide('box', j - 8, d0 + 136, SLIDES.downFlatDown(21, 0.4), 0.9);
  slide('rail', j + 8, d0 + 136, SLIDES.downFlatDown(20));
  kickerTo('box', j, d0 + 197, [[0, 0, FED], [7, 0, 1.0], [15, 0, 0.45]], { width: 0.8 });
  slide('rail', j, d0 + 258, SLIDES.flat(16, 0.5));
  kickerTo('rail', j - 8, d0 + 320, [[0, 0, FED], [15, 0, FED]]);
  slide('box', j + 8, d0 + 320, SLIDES.flat(16), 0.9);
  slide('rail', j, d0 + 381, SLIDES.rainbow(12, 0.4, 0.6));

  jump(X.jump, d0 + 41, { lip: 2, angle: 19, gap: 9, land: 14, width: 8 });
  jump(X.jump, d0 + 116, { lip: 2.2, angle: 22, gap: 6, deck: false, landingHeight: 3.0, land: 13, width: 8 });
  jump(X.jump, d0 + 190, { lip: 2.4, angle: 20, gap: 10, land: 14, width: 8 });
  hip(X.jump, d0 + 258, 1, 1.1);
  jump(X.jump, d0 + 326, { lip: 2, angle: 19, gap: 9, land: 14, width: 8 });
  jump(X.jump, d0 + 388, { lip: 1.6, angle: 18, gap: 7, land: 13, width: 8 });

  // Middle: a jib garden, everything ride-on and side by side.
  const m = X.mid;
  slide('box', m - 18, d0 + 34, SLIDES.flat(14, 0.3), 1.2);
  slide('rail', m - 6, d0 + 34, SLIDES.flat(14));
  slide('box', m + 6, d0 + 34, SLIDES.downFlatDown(19, 0.35), 0.8);
  slide('rail', m + 18, d0 + 34, SLIDES.rainbow(12, 0.4, 0.6));
  slide('rail', m - 12, d0 + 95, SLIDES.kinked(19, 1.6));
  slide('box', m + 12, d0 + 95, SLIDES.flat(16), 0.6);
  kickerTo('rail', m, d0 + 150, [[0, 0, FED], [15, 0, FED]]);
  slide('box', m - 14, d0 + 204, SLIDES.rainbow(10, 0.3, 0.6), 1.0);
  slide('rail', m + 14, d0 + 204, SLIDES.downFlatDown(21));
  kickerTo('box', m, d0 + 258, [[0, 0, FED], [14, 0, FED]], { width: 0.8 });
  slide('rail', m - 12, d0 + 320, SLIDES.flat(18, 0.45));
  slide('box', m + 12, d0 + 320, SLIDES.rainbow(12, 0.35, 0.6), 1.0);
  jump(X.mid, d0 + 381, { lip: 1.8, angle: 18, gap: 8, land: 13, width: 8 });

  jump(X.pro, d0 + 41, { lip: 2, angle: 19, gap: 9, land: 14, width: 9 });
  jump(X.pro, d0 + 122, { lip: 2.4, angle: 20, gap: 11, land: 14, width: 9 });
  jump(X.pro, d0 + 204, { lip: 2.2, angle: 21, gap: 6, deck: false, landingHeight: 2.8, land: 13, width: 9 });
  jump(X.pro, d0 + 279, { lip: 1.8, angle: 18, gap: 8, land: 13, width: 9 });
  jump(X.pro, d0 + 347, { lip: 2.2, angle: 20, gap: 10, land: 14, width: 9 });
  jump(X.pro, d0 + 401, { lip: 1.6, angle: 18, gap: 7, land: 13, width: 9 });
}

const finish = { x: 0, z: -(D.run + 20), heading: 0, width: 270, length: 90 };

// ---------------------------------------------------------------- terrain
const terrain = {
  type: 'generated',
  width: 280,
  length: D.end,
  cellSize: 3,
  bermWidth: 14,
  bermHeight: 6,
  noise: 0.18,
  seed: 11,
  margin: 70,
  profile,
  lanes,
};

// ---------------------------------------------------------------- decoration
// Orange fences between the lines, open at each flat so riders can switch lines.
const sections: [number, number][] = [
  [D.s1 + 20, D.f1 - 5],
  [D.s2 + 5, D.f2 - 5],
  [D.s3 + 5, D.f3 - 5],
  [D.s4 + 5, D.f4 - 5],
  [D.s5 + 5, D.run - 10],
];
for (const x of FENCES) {
  for (const [a, b] of sections) decor.push({ kind: 'fence', points: [{ x, z: -a }, { x, z: -b }] });
}
// Light poles beside the outer fences of the jump and pro lines.
for (const x of [-67, 69]) {
  const pts: Json[] = [];
  for (let d = D.s2 + 20; d < D.f4; d += 60) pts.push({ x: x + 1.2 * Math.sign(x), z: -d });
  decor.push({ kind: 'lightPole', points: pts, heading: x < 0 ? 90 : -90 });
}
// Floodlight towers on the fences between the lines, aimed down the hill (lit at night), staggered fence to fence.
FENCES.slice(1).forEach((x, i) => {
  const pts: Json[] = [];
  for (const [a, b] of sections) for (let d = a + 12 + i * 37; d < b - 10; d += 110) pts.push({ x, z: -d });
  decor.push({ kind: 'floodlight', points: pts, heading: 0 });
});
// Plain banners at the top of each section, on the flats between the lines.
for (const d of [D.s1 + 6, D.s2 - 24, D.s3 - 30, D.s4 - 30, D.s5 - 24]) {
  decor.push({ kind: 'banner', points: [{ x: -67, z: -d }, { x: 69, z: -d }], heading: 0, color: '#ff7a1a' });
  decor.push({ kind: 'banner', points: [{ x: -8, z: -d }], heading: 0 });
}
// The start: bunting and flags around the deck.
decor.push({ kind: 'bunting', points: [{ x: -86, z: -3 }, { x: -78, z: -3 }, { x: -62, z: -3 }, { x: -54, z: -3 }] });
decor.push({ kind: 'flag', points: [{ x: -80, z: -4 }, { x: -60, z: -4 }, { x: -84, z: -18 }, { x: -56, z: -18 }], heading: 0 });
// Finish banners.
decor.push({ kind: 'banner', points: [{ x: -100, z: -(D.run + 12) }, { x: -40, z: -(D.run + 12) }, { x: 40, z: -(D.run + 12) }, { x: 100, z: -(D.run + 12) }], heading: 0 });
// Groomers parked to the side: on the flat between the pro zones, and at the bottom.
decor.push({ kind: 'groomer', points: [{ x: 132, z: -(D.f3 + 40) }], heading: 60 });
decor.push({ kind: 'groomer', points: [{ x: -110, z: -(D.run + 80) }], heading: -40 });
// A chairlift up the hillside on the right, out of reach.
decor.push({ kind: 'chairlift', points: [{ x: 192, z: 60 }, { x: 192, z: -(D.end + 60) }] });
// Trees and rocks on the hillsides on both sides.
const len = D.end + 140;
const midZ = -(D.end / 2);
decor.push({ kind: 'pine', area: { x: -185, z: midZ, width: 70, length: len }, count: 2600, seed: 3, minScale: 0.8, maxScale: 1.5 });
decor.push({ kind: 'pine', area: { x: 168, z: midZ, width: 28, length: len }, count: 800, seed: 5, minScale: 0.8, maxScale: 1.4 });
decor.push({ kind: 'pine', area: { x: 205, z: midZ, width: 18, length: len }, count: 450, seed: 6, minScale: 0.9, maxScale: 1.5 });
decor.push({ kind: 'rock', area: { x: -180, z: midZ, width: 70, length: len }, count: 260, seed: 8, minScale: 0.6, maxScale: 1.6 });
decor.push({ kind: 'boulder', area: { x: 180, z: midZ, width: 60, length: len }, count: 140, seed: 9, minScale: 0.8, maxScale: 1.6 });
decor.push({ kind: 'snag', area: { x: -175, z: midZ, width: 50, length: len }, count: 60, seed: 10, minScale: 0.8, maxScale: 1.2 });

const map = { name: 'Park', terrain, features, spawn, flags, finishes: [finish], decor, colors: { sky: '#8fbde9', fog: '#d9e7f3' } };

// ---------------------------------------------------------------- report
const parsed = parseMap(map);
const hf = generateSlope(parsed.terrain);
for (const lane of solveLanes(parsed.terrain)) {
  const end = lane.sections.reduce((a, s) => a + s.length, lane.start);
  let lo = 0;
  let hi = 0;
  for (let d = lane.start; d < end; d += 2) {
    const o = heightAt(hf, lane.x, -d) - heightAt(hf, X.jib, -d);
    lo = Math.min(lo, o);
    hi = Math.max(hi, o);
  }
  console.log(`lane x=${lane.x} d ${lane.start}–${end}: last pitch ${lane.sections.at(-1)?.pitch?.toFixed(1)}°, ${hi.toFixed(1)} m above / ${(-lo).toFixed(1)} m below the slope beside it`);
}
console.log(`${features.length} features, ${flags.length} flags, ${decor.length} decoration sets; ${(heightAt(hf, X.jib, 0) - heightAt(hf, X.jib, -D.run)).toFixed(0)} m drop to the finish`);
writeFileSync('src/maps/park.json', JSON.stringify(map, null, 1) + '\n');
console.log('wrote src/maps/park.json');
