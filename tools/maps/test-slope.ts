// Lays out the Test slope and writes it to src/maps/test-slope.json. It was
// hand-written JSON until milestone 14, when this script took it over
// unchanged (the first part below) and added the new rails after it. Edit
// here and rerun, from the repo root:
//   node tools/maps/test-slope.ts
//
// Layout: a straight 17° slope 200 m wide, flat for its first 30 m, with
// rollers from d 350 to 410 and a runout. Lanes, left to right:
//   x -62   halfpipe
//   x -20   jumps, then a hip
//   x  20   rails and boxes, ridden on and off a kicker
//   x  62   a slalom course between netting (x 47 and 77)
//   x   2   milestone 14's polyline rails, a pole jam and a rail gap,
//           between the jumps and the rails
// Below the rails (x 20): milestone 14's wallride close-out and 3D rails.
// The slope's edges are banked from |x| 86 out: nothing to slide there.

import { writeFileSync } from 'node:fs';
import { parseMap } from '../../src/maps/loader.ts';
import { generateSlope } from '../../src/maps/terrain.ts';
import { heightAt } from '../../src/sim/terrain.ts';
import { corkscrew, deckRail, gapRail, knuckleRail, loop, poleJam, SHAPES, slideJson, wallrideCloseOut, type Json } from './railKit.ts';

const terrain = {
  type: 'generated',
  width: 200,
  length: 520,
  cellSize: 2,
  slopeDeg: 17,
  flatTop: 30,
  runout: 90,
  bermWidth: 14,
  bermHeight: 7,
  noise: 0.18,
  seed: 7,
  margin: 50,
  rollers: { start: 350, end: 410, amplitude: 0.6, spacing: 20 },
};

// ---------------------------------------------------------------- the original Test slope
const features: Json[] = [
  { type: 'start', style: 'deck', x: -20, z: -12, heading: 0, height: 0.6 },
  { type: 'start', style: 'tower', x: 20, z: -8, heading: 0, height: 7 },
  { type: 'start', style: 'ridge', x: -62, z: -12, heading: 0 },
  { type: 'start', style: 'race', x: 62, z: -36, heading: 0 },

  { type: 'halfpipe', x: -62, z: -70, yaw: 0, length: 150 },

  { type: 'jump', x: -20, z: -48, width: 5, sideWidth: 2, lipHeight: 1, lipAngle: 15, gap: 4, landingAngle: 14, knuckle: 2, transition: 4 },
  { type: 'jump', x: -20, z: -84, width: 6, sideWidth: 2.5, lipHeight: 2, lipAngle: 16, gap: 8, landingAngle: 12, transition: 6 },
  { type: 'jump', x: -20, z: -128, width: 7, sideWidth: 2.5, lipHeight: 2.2, lipAngle: 20, gap: 9, deck: false, landingHeight: 3.6, landingAngle: 12, transition: 6 },
  { type: 'jump', x: -20, z: -180, width: 7, sideWidth: 2.5, lipHeight: 3.4, lipAngle: 18, gap: 11, deck: false, landingHeight: 2.9, landingAngle: 10, transition: 6 },
  { type: 'jump', x: -20, z: -243, width: 9, sideWidth: 3, lipHeight: 4, lipAngle: 18, gap: 8, landingAngle: 10, transition: 6 },
  { type: 'kicker', x: -44, z: -306, yaw: -30, width: 5, sideWidth: 2, lipHeight: 1.4, lipAngle: 24, back: 1.5 },
  { type: 'landing', x: -32, z: -312, width: 12, sideWidth: 3, height: 2.2, angle: 16, back: 2, top: 3 },

  { type: 'box', width: 0.6, points: [{ x: 18, z: -50, height: 0 }, { x: 18, z: -53, height: 0.3 }, { x: 18, z: -62, height: 0.3 }] },
  { type: 'rail', points: [{ x: 25, z: -50, height: 0 }, { x: 25, z: -54, height: 0.4 }, { x: 25, z: -64, height: 0.4 }] },
  { type: 'kicker', x: 20, z: -84, width: 3, sideWidth: 1.5, lipHeight: 0.7, lipAngle: 20, back: 1.2 },
  { type: 'rail', points: [{ x: 20, z: -90, height: 1 }, { x: 20, z: -100, height: 1 }] },
  { type: 'rail', points: [{ x: 20, z: -130, height: 0.8 }, { x: 20, z: -140, height: 0.35 }] },
  { type: 'rail', points: [{ x: 14, z: -150, height: 0.5 }, { x: 14, z: -155, height: 1.4 }, { x: 14, z: -165, height: 0.45 }] },
  { type: 'box', width: 0.6, points: [{ x: 26, z: -150, height: 0.4 }, { x: 26, z: -155, height: 0.4 }, { x: 26, z: -159, height: 1.6 }, { x: 26, z: -166, height: 1.6 }] },
  { type: 'rail', points: [{ x: 20, z: -195, height: 0.5 }, { x: 20, z: -201, height: 0.5 }, { x: 23, z: -207, height: 0.5 }] },
  {
    type: 'rail',
    points: [
      { x: 20, z: -230, height: 0.4 },
      { x: 20, z: -231, height: 0.71 },
      { x: 20, z: -232, height: 0.97 },
      { x: 20, z: -233, height: 1.14 },
      { x: 20, z: -234, height: 1.2 },
      { x: 20, z: -235, height: 1.14 },
      { x: 20, z: -236, height: 0.97 },
      { x: 20, z: -237, height: 0.71 },
      { x: 20, z: -238, height: 0.4 },
    ],
  },

  {
    type: 'slalom',
    gates: [
      { x: 57, z: -62, width: 5 },
      { x: 67, z: -84, width: 5 },
      { x: 57, z: -106, width: 5 },
      { x: 67, z: -128, width: 5 },
      { x: 57, z: -150, width: 5 },
      { x: 67, z: -172, width: 5 },
      { x: 57, z: -194, width: 5 },
      { x: 67, z: -216, width: 5 },
      { x: 57, z: -238, width: 5 },
      { x: 67, z: -260, width: 5 },
      { x: 57, z: -282, width: 5 },
      { x: 67, z: -304, width: 5 },
    ],
  },
];

const spawn = { x: -20, z: -12, heading: 0 };
const flags: Json[] = [
  { x: -20, z: -75, heading: 0, width: 22 },
  { x: 22, z: -118, heading: 0, width: 18 },
  { x: -20, z: -175, heading: 0, width: 22 },
];
const finishes = [{ x: 0, z: -440, heading: 0, width: 190, length: 70 }];

const decor: Json[] = [
  { kind: 'pine', area: { x: -128, z: -250, width: 46, length: 640 }, count: 650, seed: 3, minScale: 0.8, maxScale: 1.5 },
  { kind: 'pine', area: { x: 114, z: -250, width: 16, length: 640 }, count: 220, seed: 5, minScale: 0.8, maxScale: 1.4 },
  { kind: 'pine', area: { x: 144, z: -250, width: 12, length: 640 }, count: 160, seed: 6, minScale: 0.9, maxScale: 1.5 },
  { kind: 'rock', area: { x: -125, z: -250, width: 50, length: 640 }, count: 70, seed: 8, minScale: 0.6, maxScale: 1.6 },
  { kind: 'boulder', area: { x: 125, z: -250, width: 45, length: 640 }, count: 40, seed: 9, minScale: 0.8, maxScale: 1.6 },

  { kind: 'pine', area: { x: -72.5, z: -290, width: 25, length: 90 }, count: 40, seed: 21, minScale: 0.7, maxScale: 1.2, solid: true },
  { kind: 'snag', area: { x: -72.5, z: -290, width: 25, length: 90 }, count: 6, seed: 22, minScale: 0.8, maxScale: 1.1, solid: true },
  { kind: 'rock', area: { x: -72.5, z: -290, width: 25, length: 90 }, count: 10, seed: 23, minScale: 0.6, maxScale: 1.2, solid: true },
  { kind: 'boulder', area: { x: -72.5, z: -290, width: 25, length: 90 }, count: 4, seed: 24, minScale: 0.8, maxScale: 1.1, solid: true },

  { kind: 'fence', points: [{ x: -39, z: -42 }, { x: -39, z: -228 }] },
  { kind: 'netting', points: [{ x: 47, z: -44 }, { x: 47, z: -322 }] },
  { kind: 'netting', points: [{ x: 77, z: -44 }, { x: 77, z: -322 }] },
  { kind: 'dyeLine', points: [{ x: 51, z: -46 }, { x: 51, z: -316 }] },
  { kind: 'dyeLine', points: [{ x: 73, z: -46 }, { x: 73, z: -316 }] },
  { kind: 'barrier', points: [{ x: -33, z: -276 }, { x: -33, z: -300 }] },
  { kind: 'barrier', points: [{ x: -7, z: -276 }, { x: -7, z: -300 }] },
  { kind: 'bunting', points: [{ x: -34, z: -2 }, { x: -27, z: -2 }, { x: -13, z: -2 }, { x: -6, z: -2 }] },
  { kind: 'chairlift', points: [{ x: 129, z: 40 }, { x: 129, z: -560 }] },

  { kind: 'banner', points: [{ x: -32, z: -110 }, { x: -8, z: -160 }], heading: 90 },
  { kind: 'banner', points: [{ x: -8, z: -110 }], heading: 90, color: '#ff7a1a' },
  { kind: 'lightPole', points: [{ x: 36, z: -45 }, { x: 36, z: -85 }, { x: 36, z: -125 }, { x: 36, z: -165 }, { x: 36, z: -205 }, { x: 36, z: -245 }], heading: -90 },
  { kind: 'floodlight', points: [{ x: -37, z: -262 }], heading: -90 },
  { kind: 'floodlight', points: [{ x: -3, z: -288 }], heading: 90 },
  { kind: 'flag', points: [{ x: 11, z: -3 }, { x: 29, z: -3 }, { x: 8, z: -14 }, { x: 32, z: -14 }], heading: 0 },
  { kind: 'groomer', points: [{ x: 84, z: -470 }], heading: 30 },
];
const gaps: Json[] = [];

// ---------------------------------------------------------------- milestone 14: new rails
// Everything new goes after the original features and flags, so the old
// rails keep their numbers (tools/sim reports them by index).

// Polyline rails and close-outs, one after another down a lane of their own
// between the jumps (x -20) and the rails (x 20).
const A = 2;
flags.push({ x: A, z: -38, heading: 0, width: 14 });
features.push(slideJson('rail', A, 45, SHAPES.wave(18)));
features.push(slideJson('rail', A, 75, SHAPES.aFrame(14)));
features.push(slideJson('rail', A, 100, SHAPES.doubleKink(20)));
features.push(slideJson('rail', A, 132, SHAPES.flatDownFlatDown(22)));
features.push(poleJam(A, 168));
{
  const g = gapRail(A, 185);
  features.push(...g.features);
  gaps.push(g.gap);
}
// Below the big jump, between its landing and the rail lane (clear of both run-outs), a rail into a wallride.
features.push(...wallrideCloseOut(-14, 255, 1));

// A deck rail and a knuckle-down rail on two of the jumps.
features.push(deckRail(-20, 84, { lip: 2, angle: 16, gap: 8, land: 12, width: 6 }, 1));
features.push(knuckleRail(-20, 243, { lip: 4, angle: 18, gap: 8, land: 10, width: 9, transition: 6 }, -1));

const map = { name: 'Test Slope', terrain, features, spawn, flags, finishes, decor, ...(gaps.length ? { gaps } : {}), colors: { sky: '#9fc3e6', fog: '#dce8f3' } };

// 3D rails below the rail lane, laid on the snow's own heights: a loop
// right below it (riders off its last rail come down beside its way in) and a
// corkscrew past the wallride, turning across the hill to the right.
{
  const hf = generateSlope(parseMap(map).terrain);
  const ground = (x: number, z: number): number => heightAt(hf, x, z);
  flags.push({ x: 22, z: -244, heading: 0, width: 14 });
  features.push(loop(22, 250, ground));
  features.push(corkscrew(8, 285, ground, { side: 1 }));
}
parseMap(map);
console.log(`${features.length} features, ${flags.length} flags, ${gaps.length} named gaps`);
writeFileSync('src/maps/test-slope.json', JSON.stringify(map, null, 1) + '\n');
console.log('wrote src/maps/test-slope.json');
