// Lays out Jam Park and writes it to src/maps/jampark.json. The map file is
// the source the game loads; this script is how it was authored. It started
// as a copy of tools/maps/park.ts (the Park, which stays as it was). Edit
// here and rerun, from the repo root:
//   node tools/maps/jampark.ts
// Then ride every line with tools/sim/line.ts (see GAME_DESIGN.md, Jump
// sizing), check the features with tools/sim/features.ts and the holes with
// tools/maps/sinks.ts.
//
// Layout: the fall line runs down -Z, and d below is the distance down from
// the top (z = -d). Lines run side by side the whole way down, packed with
// features that follow one another: each line is a list of features laid
// end to end with a short run between them, so the landing of one sets up
// the next. Fences between the lines are short, with openings, and low
// enough to jump, so riders can cut from line to line:
//   x -134        the long rail, top to bottom
//   x -106        jib line: rails and boxes, ride-on and off kickers
//   x  -64        combo line: rails into jumps into rails
//   x  -20        jump line: tables in a rhythm, step-ups and step-downs
//   x   26        transitions: hips, the small and the big halfpipe
//   x  100        pro line: big tables, then the two huge jumps
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
const DEG = Math.PI / 180;

// ---------------------------------------------------------------- sections
/** Where each stretch starts (d, m down from the top). s* are sections, f* the flats after them. */
const D = {
  s1: 50, // warm-up jam, 12°
  f1: 400,
  s2: 440, // main jam, 14°
  f2: 800,
  s3: 850, // pro zone, 19°
  f3: 1460,
  s4: 1510, // jib garden and finale, 11°
  run: 1850, // finish flat, 3°
  stop: 1950, // climbs, to stop riders
  end: 2030,
};
const X = { longRail: -134, jib: -106, combo: -64, jump: -20, pipe: 26, pro: 100 };
const WIDTH = 300;

const sec = (length: number, pitch: number | undefined, ease = 20): Json =>
  pitch === undefined ? { length, ease } : { length, pitch, ease };

const PITCH = { top: 6, s1: 12, s2: 14, s3: 19, s4: 11, flat: 4, finish: 3 };
const profile = [
  sec(D.s1, PITCH.top),
  sec(D.f1 - D.s1, PITCH.s1, 30),
  sec(D.s2 - D.f1, PITCH.flat, 24),
  sec(D.f2 - D.s2, PITCH.s2, 24),
  sec(D.s3 - D.f2, PITCH.flat, 24),
  sec(D.f3 - D.s3, PITCH.s3, 30),
  sec(D.s4 - D.f3, PITCH.flat, 30),
  sec(D.run - D.s4, PITCH.s4, 30),
  sec(D.stop - D.run, PITCH.finish, 40),
  sec(D.end - D.stop, -6, 40),
];

// ---------------------------------------------------------------- helpers
/** A checkpoint flag gate across a line at d. */
function flag(x: number, d: number, width = 30): void {
  flags.push({ x, z: -d, heading: 0, width });
}

/**
 * Something laid along a line: how long it is down the hill from where it
 * starts, and how to put it there. Lines are lists of these, end to end.
 */
interface Item {
  len: number;
  place: (x: number, d: number) => void;
  /** A jump's options, for things placed around it. */
  opts?: JumpOpts;
}

/** Lays items down a line from d, `run` m of snow between each, and returns the d past the last one. */
function line(x: number, d: number, run: number, items: (Item | number)[]): number {
  let at = d;
  for (const it of items) {
    // A number is extra snow before the next item.
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
  /** Offset across from the line (m, right). */
  dx?: number;
}

/** Length down the hill of a park jump: takeoff, gap, then the landing's knuckle, face and transition (as maps/shapes.ts builds it). */
function jumpLength(o: JumpOpts): number {
  const takeoff = (2 * o.lip) / Math.tan(o.angle * DEG);
  const H = o.deck === false ? (o.landingHeight ?? o.lip) : o.lip;
  const s = Math.tan(o.land * DEG);
  const kt = ((o.knuckle ?? 3) + (o.transition ?? 6)) / 2;
  return takeoff + o.gap + H / s + Math.min(H / s, kt);
}

/** A park jump whose takeoff starts at (x, d), straight down the hill. */
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

/** Distance from an open gap's takeoff start to the middle of its floor, where the slope shows between the takeoff's back and the landing's (as maps/shapes.ts builds it). */
function gapMiddle(o: JumpOpts): number {
  const down = Math.max(1, 1.2 * o.lip);
  const up = Math.max(1, 1.2 * (o.landingHeight ?? o.lip));
  return (2 * o.lip) / Math.tan(o.angle * DEG) + down + (o.gap - 1.5 - down - up) / 2;
}

/** An open gap jump with something parked across the middle of its gap. */
function OVER(gap: Item, kind: 'groomer'): Item {
  const o = gap.opts!;
  return { ...gap, place: (x, d) => {
    gap.place(x, d);
    decor.push({ kind, points: [{ x: r2(x + (o.dx ?? 0)), z: r2(-(d + gapMiddle(o))) }], heading: 90 });
  } };
}

/**
 * A hip: a kicker angled off the fall line from one side, and a landing in
 * the line facing down the hill. Its back is long and gentle, so riding
 * straight down the line just rolls over it.
 */
function hip(x: number, d: number, side: -1 | 1, size: number): void {
  features.push({ type: 'kicker', x: r2(x - side * 12), z: r2(-d), yaw: -side * 32, width: 5, sideWidth: 2, lipHeight: r2(1.4 * size), lipAngle: 24, back: r2(1.5 * size) });
  features.push({ type: 'landing', x, z: r2(-(d - 2)), width: 12, sideWidth: 3, height: r2(2.2 * size), angle: 16, back: r2(9 * size), top: 3 });
}

const HIP = (side: -1 | 1, size: number): Item => ({
  len: 9 * size + 3 + (2.2 * size) / Math.tan(16 * DEG) + 4 - 2,
  place: (x, d) => hip(x, d, side, size),
});

/**
 * A wallride beside the line: a wooden wall whose foot runs straight down
 * the hill `dx` m to one side of the line, standing outward. Swing into it at
 * a shallow angle to ride along it; hit it harder, or pop, to air off it.
 */
const WALL = (dx: number, length = 18, radius = 3.4): Item => ({
  len: length,
  place: (x, d) => {
    features.push({ type: 'quarter', x: r2(x + dx), z: r2(-d), yaw: 0, side: Math.sign(dx), length, radius, wallAngle: 84, deckWidth: 0.6, back: 3.5, taper: 3.5, style: 'wood' });
  },
});

/**
 * A quarterpipe across the line at 45°: riding straight down the line meets
 * its wall at 45°, a quarter of the way along it, airs off it and comes back
 * down onto the wall still ahead (a fast rider flies 30 m along it), then
 * away along it, down and across the hill toward `toward` (1 right, -1
 * left), into the line beside if you like.
 */
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

/** A rail or box straight down the hill from d: points as [m down from d, m to the right, height above the snow]. */
/** How a slide looks: a park rail or box, a fat tube, or a bonk feature (see RailStyle and BoxStyle). */
type Look = 'metal' | 'tube' | 'table' | 'barrels' | 'spool';

function slide(kind: 'rail' | 'box', x: number, d: number, pts: Pt[], width = 0.6, follow = 0, look: Look = 'metal'): void {
  const f: Json = { type: kind, points: pts.map(([a, b, h]) => ({ x: r2(x + b), z: r2(-(d + a)), height: r2(h) })) };
  if (kind === 'box') f.width = width;
  if (follow > 0) f.follow = follow;
  if (look !== 'metal') f.style = look;
  features.push(f);
}

/** A ride-on rail or box as a line item, `dx` m right of the line. */
const S = (kind: 'rail' | 'box', pts: Pt[], width = 0.6, dx = 0, look: Look = 'metal'): Item => ({
  len: pts[pts.length - 1]![0],
  place: (x, d) => slide(kind, x + dx, d, pts, width, 0, look),
});

/** A ride-on tube (a fat painted pipe) as a line item. */
const TUBE = (pts: Pt[], dx = 0): Item => S('rail', pts, 0, dx, 'tube');

/** Ride-on slides side by side across the line, each [dx, kind, points, width, look]: the line item is as long as the longest. */
const PAIR = (...slides: [dx: number, kind: 'rail' | 'box', pts: Pt[], width?: number, look?: Look][]): Item => ({
  len: Math.max(...slides.map(([, , pts]) => pts[pts.length - 1]![0])),
  place: (x, d) => {
    for (const [dx, kind, pts, width, look] of slides) slide(kind, x + dx, d, pts, width ?? 0.6, 0, look);
  },
});

/** Line items side by side across the line, each [dx, item]: as long as the longest. */
const ROW = (...items: [dx: number, item: Item][]): Item => ({
  len: Math.max(...items.map(([, it]) => it.len)),
  place: (x, d) => {
    for (const [dx, it] of items) it.place(x + dx, d);
  },
});

/** A small kicker straight down at (x, d), for jumping onto a rail or box. Returns the d of its lip. */
function kicker(x: number, d: number, lip: number, angle: number, width = 3): number {
  features.push({ type: 'kicker', x: r2(x), z: r2(-d), width, sideWidth: 1.5, lipHeight: lip, lipAngle: angle, back: 1.2 });
  return d + (2 * lip) / Math.tan((angle * Math.PI) / 180);
}

interface KickerOpts {
  lip?: number;
  angle?: number;
  gap?: number;
  width?: number;
  dx?: number;
  look?: Look;
}

/**
 * A kicker onto a rail or box: the slide starts `gap` m past the lip. Low
 * and mellow by default, so rolling off it at speed drops onto the slide
 * instead of flying over it.
 */
function kickerTo(kind: 'rail' | 'box', x: number, d: number, pts: Pt[], o: KickerOpts = {}): void {
  const lip = kicker(x + (o.dx ?? 0), d, o.lip ?? 0.6, o.angle ?? 10, kind === 'box' ? 3.5 : 3);
  slide(kind, x + (o.dx ?? 0), lip + (o.gap ?? 1), pts, o.width ?? 0.7, 0, o.look);
}

const K = (kind: 'rail' | 'box', pts: Pt[], o: KickerOpts = {}): Item => ({
  len: (2 * (o.lip ?? 0.6)) / Math.tan((o.angle ?? 10) * DEG) + (o.gap ?? 1) + pts[pts.length - 1]![0],
  place: (x, d) => kickerTo(kind, x, d, pts, o),
});

// Bonk features: a picnic table (slide its top), a row of barrels lying
// across the line (slide along their tops), and a cable spool standing on
// end (slide or bonk across its top). They're short, so a rail's kicker
// would throw a fast rider clean over them: each sits past a long, mellow
// snow ramp whose lip is a little above its top (clear of the ramp's back,
// which a box's height would otherwise be measured from), to roll onto.
const BONK = (top: number, len: number, width: number, look: Look, angle = 6): Item =>
  K('box', [[0, 0, top], [len, 0, top]], { width, look, lip: top + 0.1, angle, gap: 1.3 });
const TABLE = (len = 3.6): Item => BONK(0.75, len, 0.8, 'table');
const BARRELS = (n = 6): Item => BONK(0.62, n * 0.62, 0.9, 'barrels');
const SPOOL = (): Item => BONK(1.0, 1.6, 1.6, 'spool', 7);

// Slide shapes (the first point at height 0 is a ride-on from the snow).
// "Flat" runs parallel to the snow, "down" drops toward it. Kinked rails
// kink gently (a 1 m step each time), away from the rest of their line, so
// fast riders come off them into open snow, not into a fence; in the middle
// of a line, a jog steps across and runs on straight.
const SLIDES = {
  flat: (len: number, h = 0.4): Pt[] => [[0, 0, 0], [3.5, 0, h], [len, 0, h]],
  flatDown: (len: number, h = 0.45): Pt[] => [[0, 0, 0], [3.5, 0, h], [len * 0.55, 0, h + 0.15], [len, 0, h * 0.5]],
  downFlatDown: (len: number, h = 0.5): Pt[] => [[0, 0, 0], [3.5, 0, h], [len * 0.35, 0, h * 0.6], [len * 0.6, 0, h + 0.45], [len, 0, h * 0.7]],
  kinked: (len: number, side: number, h = 0.5): Pt[] => [[0, 0, 0], [3.5, 0, h], [len * 0.45, 0, h], [len * 0.7, side, h], [len, side * 2, h * 0.7]],
  /** Kinked sideways and back: steps `side` m across and runs on straight, so the line carries on past it. */
  jog: (len: number, side: number, h = 0.5): Pt[] => [[0, 0, 0], [3.5, 0, h], [len * 0.4, 0, h], [len * 0.6, side, h], [len, side, h * 0.7]],
  rainbow: (len: number, base: number, rise: number, n = 8): Pt[] => [[0, 0, 0], ...SLIDES.arc(len, base, rise, n).slice(1)],
  /** An arc starting in the air at `base` (for jumping onto). */
  arc: (len: number, base: number, rise: number, n = 8): Pt[] => {
    const pts: Pt[] = [];
    for (let i = 0; i <= n; i++) pts.push([len * (i / n), 0, base + rise * Math.sin((Math.PI * i) / n)]);
    return pts;
  },
  /**
   * A C-rail: curving `bend` degrees in all (toward `side`, 1 right, -1 left)
   * over `len` m along it, ridden on from the snow, a point every meter.
   * Riders come off its end heading `bend` degrees across the hill, so it
   * needs open snow that way: in the middle of a line, bending toward the
   * side with the most room before the next fence, with room after it.
   */
  c: (len: number, bend: number, h = 0.45, side = 1): Pt[] => {
    const k = (bend * DEG) / len;
    const pts: Pt[] = [];
    for (let s = 0; s <= len + 1e-6; s += len / Math.ceil(len)) {
      pts.push([Math.sin(k * s) / k, (side * (1 - Math.cos(k * s))) / k, s < 3.5 ? (h * s) / 3.5 : h]);
    }
    return pts;
  },
  /** An S-rail: eases `offset` m across over its length and runs on straight, ridden on from the snow. */
  s: (len: number, offset: number, h = 0.45): Pt[] => {
    const pts: Pt[] = [[0, 0, 0], [3.5, 0, h]];
    for (let i = 1; i <= 10; i++) {
      const t = i / 10;
      pts.push([3.5 + (len - 3.5) * t, offset * t * t * (3 - 2 * t), h]);
    }
    return pts;
  },
  /** Kicker-fed: level at the lip's height. */
  fed: (len: number): Pt[] => [[0, 0, FED], [len, 0, FED]],
  /** Kicker-fed, rising a little then dropping toward the snow. */
  fedDown: (len: number, rise = 0.35): Pt[] => [[0, 0, FED], [len * 0.45, 0, FED + rise], [len, 0, 0.45]],
};
/** Kicker-fed rails start at about the lip's height, so a slow rider can't hit the front and a fast one still comes down onto it. */
const FED = 0.65;

// The pro line's huge jumps are mostly terrain, in a lane of their own. A
// rise on the flat above checks the speed of anyone coming down from the
// section before, then a level spot to start from (the flag), then the
// steep in-run, the kicker at the start of a long table, the knuckle, a
// long steep landing that eases off at the bottom, and a runout.
const PRO = {
  /** Speed-check rise and the level spot after it: length and pitch. */
  rise: [30, -12] as const,
  level: [16, 4] as const,
  /** In-run, from the level spot to the kicker. */
  inrun: [40, 26] as const,
  table: 28,
  lip: 3.5,
  lipAngle: 30,
  width: 12,
  /** Steep landing, steeper still further down (where the longest flights come down at their steepest), the eased-off part below it, and the runout: length and pitch. */
  upper: [36, 46] as const,
  steep: [24, 54] as const,
  lower: [14, 38] as const,
  runout: [40, 6] as const,
};
/** How far the kicker sits into the table. */
const KICKER_IN = 6;

/** A huge jump in the pro line, for a stretch from d0 to d1: its lane, kicker and flag. */
function proJump(d0: number, d1: number): Json {
  const start = d0 - PRO.rise[0] - PRO.level[0];
  const tableAt = d0 + PRO.inrun[0];
  features.push({ type: 'kicker', x: X.pro, z: -(tableAt + KICKER_IN), width: PRO.width, sideWidth: 4, lipHeight: PRO.lip, lipAngle: PRO.lipAngle, back: 3 });
  flag(X.pro, d0 - PRO.level[0] / 2, 36);
  const used = d0 + PRO.inrun[0] + PRO.table + PRO.upper[0] + PRO.steep[0] + PRO.lower[0] + PRO.runout[0] - start;
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
      ...(PRO.steep[0] > 0 ? [sec(PRO.steep[0], PRO.steep[1], 14)] : []),
      sec(PRO.lower[0], PRO.lower[1], 16),
      sec(PRO.runout[0], PRO.runout[1], 40),
      sec(d1 - start - used, undefined, 30),
    ],
  };
}

/** Where each line's features end in each section, for the report. */
const ends: string[] = [];
const sectionEnd = (name: string, end: number, limit: number): void => {
  ends.push(`${name} ends at d ${end.toFixed(0)} (room to ${limit})`);
  if (end > limit) throw new Error(`${name} runs past d ${limit} (to ${end.toFixed(0)})`);
};

// ---------------------------------------------------------------- start
const START_X = -20;
features.push({ type: 'start', style: 'deck', x: START_X, z: -14, heading: 0, height: 0.6 });
const spawn = { x: START_X, z: -14, heading: 0 };

// ---------------------------------------------------------------- the long rail
// Ride on at the top, along the left edge, off at the finish flat.
slide('rail', X.longRail, 45, [[0, 0, 0], [5, 0, 0.5], [D.run - 55, 0, 0.5], [D.run - 51, 0, 0]], 0, 4);

// ---------------------------------------------------------------- S1 warm-up jam (12°)
// Small stuff to warm up on, already in combos. Lines start lower the
// further they are from the start deck, so there's room to swing out to them.
{
  const lim = D.f1 - 8;
  for (const x of [X.jib, X.combo, X.jump, X.pipe, X.pro]) flag(x, D.s1 - 8 + Math.abs(x - START_X) * 0.35);

  sectionEnd('S1 jib', line(X.jib, 95, 9, [
    PAIR([-7, 'box', SLIDES.flat(12, 0.3), 0.9], [7, 'rail', SLIDES.flat(12, 0.35)]),
    S('box', SLIDES.flatDown(14, 0.35), 0.7),
    K('rail', SLIDES.fed(14)),
    PAIR([-7, 'rail', SLIDES.flatDown(15)], [7, 'box', SLIDES.flat(14), 1.0]),
    S('box', SLIDES.rainbow(10, 0.3, 0.5), 0.8),
    WALL(6, 16),
    K('box', SLIDES.fed(13), { width: 0.8 }),
    PAIR([-7, 'rail', SLIDES.downFlatDown(17, 0.45)], [7, 'box', SLIDES.flatDown(15, 0.4), 0.8]),
    S('rail', SLIDES.c(15, 24, 0.4, 1)),
    12,
    TUBE(SLIDES.flat(14, 0.7)),
    TABLE(),
  ]), lim);

  sectionEnd('S1 combo', line(X.combo, 75, 10, [
    S('box', SLIDES.flat(12, 0.3), 1.0),
    J({ lip: 1.2, angle: 15, gap: 5, land: 13, knuckle: 2, transition: 4 }),
    S('rail', SLIDES.s(15, 1.5)),
    J({ lip: 1.5, angle: 16, gap: 6, land: 13 }),
    K('box', SLIDES.fed(12), { width: 0.8 }),
    J({ lip: 1.8, angle: 17, gap: 7, land: 13 }),
    S('rail', SLIDES.rainbow(11, 0.35, 0.5)),
    WALL(-5, 16),
    J({ lip: 2, angle: 18, gap: 8, land: 13 }),
  ]), lim);

  sectionEnd('S1 jump', line(X.jump, 50, 10, [
    J({ lip: 1, angle: 15, gap: 4, land: 13, knuckle: 2, transition: 4, width: 7 }),
    J({ lip: 1.3, angle: 16, gap: 5, land: 13, width: 7 }),
    J({ lip: 1.6, angle: 17, gap: 7, land: 13 }),
    J({ lip: 1.8, angle: 18, gap: 8, land: 13 }),
    J({ lip: 2, angle: 18, gap: 6, deck: false, landingHeight: 2.6, land: 13 }),
    J({ lip: 2, angle: 19, gap: 9, land: 13 }),
    J({ lip: 2.2, angle: 19, gap: 6, deck: false, landingHeight: 1.6, land: 12 }),
    J({ lip: 2, angle: 18, gap: 9, land: 13 }),
  ]), lim);

  // Hips and quarterpipes in turn; the quarters throw riders across toward the jump line.
  sectionEnd('S1 transitions', line(X.pipe, 80, 10, [
    HIP(1, 1),
    J({ lip: 1.4, angle: 18, gap: 7, land: 13 }),
    QP(-1, 50, 4),
    J({ lip: 1.8, angle: 18, gap: 9, land: 13 }),
    HIP(-1, 1.1),
    QP(-1),
  ]), lim);

  sectionEnd('S1 pro', line(X.pro, 110, 11, [
    J({ lip: 1.8, angle: 18, gap: 8, land: 13, width: 9 }),
    J({ lip: 2.2, angle: 19, gap: 10, land: 13, width: 9 }),
    J({ lip: 2.4, angle: 20, gap: 11, land: 13, width: 10 }),
    J({ lip: 2.2, angle: 20, gap: 6, deck: false, landingHeight: 1.6, land: 12, width: 10 }),
    J({ lip: 2.4, angle: 20, gap: 11, land: 13, width: 10 }),
    J({ lip: 2.2, angle: 19, gap: 10, land: 13, width: 10 }),
  ]), lim);
}

// ---------------------------------------------------------------- S2 main jam (14°)
{
  const lim = D.f2 - 8;
  for (const x of [X.jib, X.combo, X.jump, X.pro]) flag(x, D.s2 - 15);
  flag(X.pipe, D.s2 - 15, 34);

  sectionEnd('S2 jib', line(X.jib, D.s2 + 10, 9, [
    PAIR([-8, 'rail', SLIDES.downFlatDown(18)], [8, 'box', SLIDES.flat(16, 0.45), 0.9]),
    K('rail', [[0, 0, FED + 0.1], [15, 0, FED + 0.1]], { look: 'tube' }),
    PAIR([-8, 'rail', SLIDES.kinked(20, -1)], [8, 'box', SLIDES.downFlatDown(18, 0.4), 0.8]),
    S('rail', SLIDES.c(18, 24, 0.45, 1)),
    14,
    BARRELS(6),
    S('rail', SLIDES.flat(20, 0.5)),
    WALL(-6),
    PAIR([-8, 'rail', SLIDES.kinked(20, -1)], [8, 'rail', SLIDES.rainbow(13, 0.7, 0.6), 0, 'tube']),
    K('box', [[0, 0, FED], [7, 0, 1.0], [15, 0, 0.45]], { width: 0.8 }),
    S('rail', SLIDES.downFlatDown(22)),
  ]), lim);

  sectionEnd('S2 combo', line(X.combo, D.s2 + 8, 10, [
    S('rail', SLIDES.downFlatDown(18)),
    J({ lip: 2.2, angle: 19, gap: 9, land: 14, width: 9 }),
    S('rail', SLIDES.jog(18, 1.5)),
    J({ lip: 2, angle: 20, gap: 6, deck: false, landingHeight: 3, land: 13, width: 9 }),
    S('box', SLIDES.downFlatDown(16, 0.4), 0.9),
    WALL(5),
    ROW([-5, TABLE()], [5, SPOOL()]),
    J({ lip: 2.6, angle: 20, gap: 11, land: 14, width: 9 }),
    S('box', SLIDES.rainbow(12, 0.35, 0.6), 1.0),
  ]), lim);

  // Tables, then a gap jump, a step-up and a step-down: open gaps with
  // nothing to land on short, sized for the 14 to 20 m/s riders carry here
  // (like the tables, popped faster than ~21 m/s they fly onto the next takeoff).
  sectionEnd('S2 jump', line(X.jump, D.s2 + 6, 11, [
    J({ lip: 2.2, angle: 20, gap: 9, land: 14, width: 9 }),
    J({ lip: 2.4, angle: 20, gap: 10, land: 14, width: 9 }),
    J({ lip: 2.6, angle: 21, gap: 11, land: 14, width: 9 }),
    J({ lip: 2.6, angle: 24, gap: 12, deck: false, landingHeight: 2.6, land: 15, width: 10 }),
    J({ lip: 2.4, angle: 24, gap: 8, deck: false, landingHeight: 3.6, land: 14, width: 10 }),
    J({ lip: 3, angle: 22, gap: 9, deck: false, landingHeight: 1.8, land: 13, width: 10 }),
    // The step-down's short landing would throw a fast pop onto the next takeoff.
    16,
    J({ lip: 2.4, angle: 20, gap: 10, land: 14, width: 9 }),
  ]), lim);

  // Hips and a table into the small halfpipe, which ends on the flat: its fast exit has nothing to land on.
  const pipe2 = D.s2 + 150;
  sectionEnd('S2 transitions', line(X.pipe, D.s2 + 8, 10, [
    HIP(1, 1.2),
    J({ lip: 2.2, angle: 18, gap: 10, land: 14, width: 9 }),
    HIP(-1, 1.2),
  ]), pipe2 - 26 - 6);
  features.push({ type: 'halfpipe', x: X.pipe, z: -pipe2, yaw: 0, length: 150, floorWidth: 12, radius: 4.6, wallAngle: 82, deckWidth: 3, outerWidth: 6, dropIn: 6, entry: 12, back: 26, exit: 12 });
  sectionEnd('S2 halfpipe', pipe2 + 150 + 12, lim);

  sectionEnd('S2 pro', line(X.pro, D.s2 + 6, 12, [
    J({ lip: 2.6, angle: 20, gap: 12, land: 14, width: 10 }),
    J({ lip: 2.8, angle: 21, gap: 13, land: 14, width: 11 }),
    J({ lip: 3, angle: 20, gap: 8, deck: false, landingHeight: 1.8, land: 13, width: 11 }),
    J({ lip: 3, angle: 22, gap: 14, land: 14, width: 11 }),
    J({ lip: 3.2, angle: 22, gap: 15, land: 14, width: 12 }),
  ]), lim);
}

// ---------------------------------------------------------------- S3 pro zone (19°)
/**
 * The transfer rails where the jib and combo lines cross (see below): they
 * start at d, run `run` m straight, then `along` m down while moving `across`
 * m toward the other line. Heights of the low rail and the tall one, the gap
 * in the tall one, and how much lower its second half is.
 */
const CROSS = { d: D.s3 + 480, run: 8, along: 64, across: 36, low: 0.3, high: 1.3, gap: 4, drop: 0.35 };
const lanes: Json[] = [];
{
  const lim = D.f3 - 8;
  for (const x of [X.jib, X.combo, X.jump, X.pipe]) flag(x, D.s3 - 20);

  sectionEnd('S3 jib', line(X.jib, D.s3 + 10, 10, [
    PAIR([-8, 'rail', SLIDES.flat(22, 0.5)], [8, 'box', SLIDES.flat(20), 0.9]),
    K('box', [[0, 0, FED], [8, 0, 1.0], [18, 0, 0.5]], { width: 0.8 }),
    PAIR([-8, 'rail', SLIDES.rainbow(14, 0.5, 0.8, 10)], [8, 'rail', SLIDES.downFlatDown(24)]),
    K('rail', SLIDES.fed(18)),
    PAIR([-8, 'box', SLIDES.flat(20, 0.45), 1.0], [8, 'rail', SLIDES.kinked(24, 1)]),
    S('rail', SLIDES.c(22, 24, 0.5, 1)),
    14,
    TUBE(SLIDES.flat(24, 0.75)),
    K('box', SLIDES.fedDown(18, 0.45), { width: 0.9 }),
    PAIR([-8, 'rail', SLIDES.downFlatDown(26)], [8, 'box', SLIDES.rainbow(14, 0.4, 0.7, 10), 1.0]),
    S('rail', SLIDES.flatDown(26, 0.5)),
    WALL(-6, 22, 4.2),
    K('rail', SLIDES.fed(20)),
    PAIR([-8, 'box', SLIDES.flatDown(22, 0.45), 0.9], [8, 'rail', SLIDES.flat(24, 0.5)]),
  ]), lim);

  // Big tables, sized for the 19 to 25 m/s riders carry here: popped at
  // natural speed they land on the face, tucked a little past it, and
  // rolled off without a pop they land on the deck.
  const BIG = (lip: number, gap: number): Item => J({ lip, angle: 14, gap, land: 17, width: 11 });
  // Open gaps (gap jumps, step-ups and step-downs) for 20 m/s and up: short of that, there's nothing to land on.
  const GAP = (lip: number, gap: number, landingHeight: number, land = 17): Item =>
    J({ lip, angle: 14, gap, deck: false, landingHeight, land, width: 11 });
  sectionEnd('S3 combo', line(X.combo, D.s3 + 8, 14, [
    K('rail', SLIDES.fedDown(18, 0.45), { angle: 10 }),
    BIG(3.4, 22),
    S('rail', SLIDES.downFlatDown(24)),
    BIG(3.6, 24),
    S('box', SLIDES.flat(20, 0.45), 1.0),
    GAP(3.6, 14, 4.2, 18),
    10,
    S('rail', SLIDES.rainbow(16, 0.5, 0.8, 10)),
    GAP(3.4, 14, 3.4),
  ]), lim);

  // Big open gaps after the first tables, once riders carry 20 m/s or more:
  // a gap jump over a parked groomer, a step-up and a step-down. Each has
  // extra snow after it: popped at 27 m/s they fly well past the landing.
  sectionEnd('S3 jump', line(X.jump, D.s3 + 6, 14, [
    BIG(3.2, 20),
    BIG(3.4, 22),
    OVER(GAP(3.4, 14, 3.4), 'groomer'),
    10,
    BIG(3.6, 24),
    GAP(3.6, 14, 4.2, 18),
    10,
    GAP(3.2, 14, 2.4, 16),
    10,
    BIG(3.4, 22),
  ]), lim);

  const pipe3 = D.f3 - 8 - 16 - 210;
  // Big tables down to the big halfpipe, which ends on the flat. No hips in
  // the steeps: riders come off the small pipe's straight floor fast, and at
  // that speed a hip's landing throws them like a kicker.
  sectionEnd('S3 transitions', line(X.pipe, D.s3 + 8, 14, [
    BIG(3.4, 22),
    BIG(3.2, 20),
    BIG(3.6, 24),
  ]), pipe3 - 34 - 6);
  features.push({ type: 'halfpipe', x: X.pipe, z: -pipe3, yaw: 0, length: 210, floorWidth: 17, radius: 6.5, wallAngle: 84, deckWidth: 4, outerWidth: 8, dropIn: 8, entry: 16, back: 34, exit: 16 });

  // Lines cross: below the jib and combo lines two transfer rails swap them.
  // A low rail runs from the jib line down and across to the combo line, and
  // a tall tube from the combo line back to the jib line, with a gap where it
  // passes over the low rail: riders on it fly the gap over the other rail
  // onto its second half, set a little lower so it catches them at any speed
  // from about 14 m/s. Both stop short of the other line's middle, so riders
  // staying on their own line ride clear of them (6 m to their side).
  {
    const { d, run, along, across, low, high, gap, drop } = CROSS;
    const slope = across / along;
    // Each ends straight down the hill, so riders come off it beside the other line, heading down it.
    const end = run + along;
    const out = end + 6;
    slide('rail', X.jib, d, [[0, 0, 0], [4, 0, low], [run, 0, low], [end, across, low], [out, across, low], [out + 3, across, 0]], 0, 4);
    const cross = run + ((X.combo - X.jib) / 2) * (along / across);
    const half = (gap / 2) * (along / Math.hypot(along, across));
    const at = (a: number): number => -(a - run) * slope;
    slide('rail', X.combo, d, [[0, 0, 0], [run, 0, high], [cross - half, at(cross - half), high]], 0, 4, 'tube');
    slide('rail', X.combo, d, [[cross + half, at(cross + half), high - drop], [end, -across, high - drop], [out, -across, high - drop], [out + 4, -across, 0]], 0, 4, 'tube');
  }

  // Two huge jumps, one below the other; each lane ends back level with the slope before the next starts.
  const second = D.s3 + 345;
  lanes.push(proJump(D.s3, second - PRO.rise[0] - PRO.level[0]));
  lanes.push(proJump(second, D.f3 + 25));
}

// ---------------------------------------------------------------- S4 jib garden and finale (11°)
{
  const lim = D.run - 6;
  for (const x of [X.jib, X.combo, X.jump, X.pipe, X.pro]) flag(x, D.s4 - 15);

  sectionEnd('S4 jib', line(X.jib, D.s4 + 8, 9, [
    PAIR([-9, 'box', SLIDES.flat(15, 0.35), 0.8], [9, 'rail', SLIDES.kinked(20, 1)]),
    K('rail', SLIDES.arc(14, FED, 0.45)),
    PAIR([-8, 'box', SLIDES.downFlatDown(20, 0.4), 0.9], [8, 'rail', SLIDES.downFlatDown(20)]),
    K('box', [[0, 0, FED], [7, 0, 1.0], [15, 0, 0.45]], { width: 0.8 }),
    S('rail', SLIDES.s(16, 1.2, 0.5)),
    PAIR([-8, 'rail', SLIDES.flatDown(16)], [8, 'box', SLIDES.flat(16), 0.9]),
    S('rail', SLIDES.c(16, 24, 0.45, 1)),
    14,
    TUBE(SLIDES.rainbow(14, 0.7, 0.7)),
  ]), lim);

  // The combo and jump lines meet in a jib garden: everything ride-on, side by side.
  sectionEnd('S4 garden', line((X.combo + X.jump) / 2, D.s4 + 8, 10, [
    PAIR([-30, 'rail', SLIDES.c(16, 30, 0.45, 1)], [-15, 'rail', SLIDES.flat(14, 0.7), 0, 'tube'], [0, 'box', SLIDES.downFlatDown(18, 0.35), 0.8], [15, 'rail', SLIDES.rainbow(12, 0.4, 0.6)], [30, 'rail', SLIDES.c(16, 30, 0.45, 1)]),
    PAIR([-22, 'rail', SLIDES.kinked(18, -1)], [-7, 'box', SLIDES.flat(16), 0.6], [8, 'rail', SLIDES.downFlatDown(18)], [23, 'box', SLIDES.rainbow(11, 0.3, 0.6), 1.0]),
    PAIR([-30, 'rail', SLIDES.flatDown(16)], [0, 'rail', SLIDES.rainbow(16, 0.7, 0.9, 10), 0, 'tube'], [30, 'rail', SLIDES.flat(16, 0.45)]),
    PAIR([-15, 'box', SLIDES.rainbow(10, 0.3, 0.6), 1.0], [15, 'rail', SLIDES.downFlatDown(20)]),
    // A row of bonks, clear of the combo and jump lines that cross the garden (at -22 and +22 from its middle).
    ROW([-30, TABLE()], [-11, BARRELS()], [11, SPOOL()], [30, TABLE(4)]),
    // Wallrides on both edges of the garden.
    { len: 18, place: (x, d) => [WALL(-32), WALL(32)].forEach((w) => w.place(x, d)) },
    PAIR([-22, 'rail', SLIDES.flat(18, 0.45)], [-7, 'box', SLIDES.rainbow(12, 0.35, 0.6), 1.0], [8, 'rail', SLIDES.jog(18, 1.5)], [23, 'box', SLIDES.flat(16), 0.8]),
    J({ lip: 1.8, angle: 18, gap: 8, land: 13, width: 10 }),
    PAIR([-24, 'box', SLIDES.flat(14, 0.35), 1.0], [-8, 'rail', SLIDES.rainbow(12, 0.4, 0.6)], [8, 'box', SLIDES.downFlatDown(18, 0.35), 0.9], [24, 'rail', SLIDES.flat(14, 0.4)]),
  ]), lim);

  // The first table in each line here is big, with room past it: riders come
  // off the big pipe and the pro lanes fast.
  sectionEnd('S4 transitions', line(X.pipe, D.s4 + 20, 10, [
    // Off the big pipe's floor riders can be flying: long ride-on jibs first, which take any speed.
    PAIR([-6, 'box', SLIDES.flat(20, 0.4), 1.2], [6, 'rail', SLIDES.flatDown(22)]),
    J({ lip: 3, angle: 16, gap: 18, land: 17, width: 10 }),
    40,
    QP(-1),
    J({ lip: 2, angle: 19, gap: 9, land: 14, width: 9 }),
    HIP(-1, 1.1),
    J({ lip: 2.2, angle: 20, gap: 10, land: 14, width: 9 }),
  ]), lim);

  sectionEnd('S4 pro', line(X.pro, D.s4 + 25, 12, [
    J({ lip: 3.2, angle: 15, gap: 20, land: 18, width: 11 }),
    20,
    J({ lip: 2.4, angle: 20, gap: 11, land: 14, width: 10 }),
    J({ lip: 2.2, angle: 21, gap: 6, deck: false, landingHeight: 2.8, land: 13, width: 10 }),
    J({ lip: 2.4, angle: 20, gap: 11, land: 14, width: 10 }),
    J({ lip: 1.8, angle: 18, gap: 8, land: 13, width: 10 }),
  ]), lim);
}

const finish = { x: 0, z: -(D.run + 20), heading: 0, width: WIDTH - 10, length: 90 };

// ---------------------------------------------------------------- terrain
const terrain = {
  type: 'generated',
  width: WIDTH,
  length: D.end,
  cellSize: 3,
  bermWidth: 14,
  bermHeight: 6,
  noise: 0.18,
  seed: 13,
  margin: 70,
  profile,
  lanes,
};

// ---------------------------------------------------------------- decoration
// Orange fences between the lines: short runs with openings, so riders can
// cut across (and jump them: they're only as tall as they look).
const FENCE_X = [-121, -85, -42, 3];
const sections: [number, number][] = [
  [D.s1 + 40, D.f1 - 5],
  [D.s2 + 5, D.f2 - 5],
  [D.s3 + 5, D.f3 - 5],
  [D.s4 + 5, D.run - 10],
];
/** Fence runs, and the openings between them. */
const FENCE_RUN = 30;
const FENCE_OPEN = 40;
/**
 * Where there's no fence: between the combo and jump lines at the jib
 * garden, which spans both, and between the transitions and jump lines
 * where the quarterpipes throw riders across.
 */
const fenced = (x: number, a: number): boolean => !(x === -42 && a >= D.s4) && !(x === 3 && (a < D.f1 || a >= D.s4));
/** Nor where the transfer rails cross between the jib and combo lines (from d0 to d1), down to the end of the section: riders can cut back to their own line after them. */
const crossing = (x: number, d0: number, d1: number): boolean => x === -85 && d1 > CROSS.d - 10 && d0 < D.f3;
FENCE_X.forEach((x, i) => {
  for (const [a, b] of sections) {
    if (!fenced(x, a)) continue;
    for (let d = a + (i % 2) * 20; d < b - 10; d += FENCE_RUN + FENCE_OPEN) {
      const e = Math.min(b, d + FENCE_RUN);
      if (!crossing(x, d, e)) decor.push({ kind: 'fence', points: [{ x, z: -d }, { x, z: -e }] });
    }
  }
});
// The pro line's own fence on its left, beside the pipes, and light poles along its right.
for (const [a, b] of sections) decor.push({ kind: 'fence', points: [{ x: 60, z: -a }, { x: 60, z: -b }] });
{
  const pts: Json[] = [];
  for (let d = D.s2 + 20; d < D.f3; d += 60) pts.push({ x: 140, z: -d });
  decor.push({ kind: 'lightPole', points: pts, heading: -90 });
}
// Floodlight towers between the lines, aimed down the hill (lit at night):
// in the fence openings' line but on the fences' runs, so they never stand in a crossing.
FENCE_X.forEach((x, i) => {
  const pts: Json[] = [];
  for (const [a, b] of sections) {
    if (!fenced(x, a)) continue;
    for (let d = a + (i % 2) * 20 + FENCE_RUN / 2 + (i % 2 ? 70 : 0); d < b - 10; d += 2 * (FENCE_RUN + FENCE_OPEN)) {
      if (!crossing(x, d, d)) pts.push({ x, z: -d });
    }
  }
  decor.push({ kind: 'floodlight', points: pts, heading: 0 });
});
// Plain banners at the top of each section, on the flats between the lines.
for (const d of [D.s1 + 20, D.s2 - 24, D.s3 - 30, D.s4 - 24]) {
  decor.push({ kind: 'banner', points: [{ x: -85, z: -d }, { x: 60, z: -d }], heading: 0, color: '#ff7a1a' });
  decor.push({ kind: 'banner', points: [{ x: 3, z: -d }], heading: 0 });
}
// The start: bunting and flags around the deck.
decor.push({ kind: 'bunting', points: [{ x: START_X - 16, z: -3 }, { x: START_X - 8, z: -3 }, { x: START_X + 8, z: -3 }, { x: START_X + 16, z: -3 }] });
decor.push({ kind: 'flag', points: [{ x: START_X - 10, z: -4 }, { x: START_X + 10, z: -4 }, { x: START_X - 14, z: -18 }, { x: START_X + 14, z: -18 }], heading: 0 });
// Finish banners, in the gaps between the lines.
decor.push({ kind: 'banner', points: [...FENCE_X, 60].map((x) => ({ x, z: -(D.run + 12) })), heading: 0 });
// Groomers parked to the side: on the flat between the pro zone and the garden, and at the bottom.
decor.push({ kind: 'groomer', points: [{ x: 142, z: -(D.f3 + 30) }], heading: 60 });
decor.push({ kind: 'groomer', points: [{ x: -110, z: -(D.run + 80) }], heading: -40 });
// A chairlift up the hillside on the right, out of reach.
decor.push({ kind: 'chairlift', points: [{ x: 202, z: 60 }, { x: 202, z: -(D.end + 60) }] });
// Trees and rocks on the hillsides on both sides.
const len = D.end + 140;
const midZ = -(D.end / 2);
decor.push({ kind: 'pine', area: { x: -195, z: midZ, width: 70, length: len }, count: 2300, seed: 3, minScale: 0.8, maxScale: 1.5 });
decor.push({ kind: 'pine', area: { x: 178, z: midZ, width: 28, length: len }, count: 700, seed: 5, minScale: 0.8, maxScale: 1.4 });
decor.push({ kind: 'pine', area: { x: 215, z: midZ, width: 18, length: len }, count: 400, seed: 6, minScale: 0.9, maxScale: 1.5 });
decor.push({ kind: 'rock', area: { x: -190, z: midZ, width: 70, length: len }, count: 230, seed: 8, minScale: 0.6, maxScale: 1.6 });
decor.push({ kind: 'boulder', area: { x: 190, z: midZ, width: 60, length: len }, count: 120, seed: 9, minScale: 0.8, maxScale: 1.6 });
decor.push({ kind: 'snag', area: { x: -185, z: midZ, width: 50, length: len }, count: 50, seed: 10, minScale: 0.8, maxScale: 1.2 });

const map = { name: 'Jam Park', terrain, features, spawn, flags, finishes: [finish], decor, colors: { sky: '#8fbde9', fog: '#d9e7f3' } };

// ---------------------------------------------------------------- report
const parsed = parseMap(map);
const hf = generateSlope(parsed.terrain);
for (const lane of solveLanes(parsed.terrain)) {
  const end = lane.sections.reduce((a, s) => a + s.length, lane.start);
  let lo = 0;
  let hi = 0;
  for (let d = lane.start; d < end; d += 2) {
    const o = heightAt(hf, lane.x, -d) - heightAt(hf, X.jump, -d);
    lo = Math.min(lo, o);
    hi = Math.max(hi, o);
  }
  console.log(`lane x=${lane.x} d ${lane.start}–${end}: last pitch ${lane.sections.at(-1)?.pitch?.toFixed(1)}°, ${hi.toFixed(1)} m above / ${(-lo).toFixed(1)} m below the slope beside it`);
}
for (const e of ends) console.log(e);
console.log(`${features.length} features, ${flags.length} flags, ${decor.length} decoration sets; ${(heightAt(hf, X.jump, 0) - heightAt(hf, X.jump, -D.run)).toFixed(0)} m drop to the finish`);
writeFileSync('src/maps/jampark.json', JSON.stringify(map, null, 1) + '\n');
console.log('wrote src/maps/jampark.json');
