// Butters, ridden headless: presses and pivots on the snow, and pops out of
// them, against plain riding at the same speeds.
//   node tools/sim/butter.ts [map.json] [x] [d] [speeds, default 5,8,12]
// Rides straight down from (x, d) (default: the Park's middle line near the
// top) and for each speed reports:
// - a 180 and a 360 pivoted on the tails (tail grab + ←) and on the tips:
//   how long the pivot takes, the speed before and after, how far the
//   direction of travel swung, and whether the skier ends up switch;
// - a pop from a full crouch: plain, out of a tail press (an ollie), and out
//   of a pivoting tail press with ← let go at takeoff (the pivot carries on
//   as spin): airtime, height, how far the skier turned, and the landing.
import type { Action } from '../../src/core/input.ts';
import { DT, loadMap, Rider } from './harness.ts';

const args = process.argv.slice(2);
const file = args[0] ?? 'src/maps/park.json';
const x = Number(args[1] ?? 30);
const d = Number(args[2] ?? 30);
const speeds = (args[3] ?? '5,8,12').split(',').map(Number);
const sim = loadMap(file);
const DEG = 180 / Math.PI;

function travelHeading(r: Rider): number {
  const v = r.s.velocity;
  return Math.atan2(-v.x, -v.z);
}

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** Rides straight for a moment at `speed`, so the skier is settled on the snow. */
function settle(speed: number): Rider {
  const r = new Rider(sim);
  r.place(x, -d, 0, speed);
  for (let i = 0; i < 30; i++) r.step();
  return r;
}

/** Pivots `degrees` on the `end` (tail or nose) holding ←, then lets go and rides 1 s. */
function pivot(speed: number, end: 'tail' | 'nose', degrees: number): string {
  const r = settle(speed);
  const press: Action = end === 'tail' ? 'grabLeftTail' : 'grabLeftNose';
  const v0 = r.speed;
  const travel0 = travelHeading(r);
  let turned = 0;
  let yaw = r.s.yaw;
  let t = 0;
  while (turned < degrees / DEG && t < 6 && !r.s.bailed) {
    r.step([press, 'left']);
    turned += wrap(r.s.yaw - yaw);
    yaw = r.s.yaw;
    t += DT;
  }
  // Let the pivot settle out of the press before riding on.
  for (let i = 0; i < 20; i++) r.step([press]);
  const v1 = r.speed;
  const swing = wrap(travelHeading(r) - travel0) * DEG;
  const backwards = r.s.velocity.x * Math.sin(r.s.yaw) + r.s.velocity.z * Math.cos(r.s.yaw) > 0;
  for (let i = 0; i < 120; i++) r.step();
  const crashed = r.s.bailed ? `, crashed (${r.s.bailReason})` : '';
  return `${end} ${degrees}: ${t.toFixed(2)} s, ${v0.toFixed(1)} -> ${v1.toFixed(1)} m/s, travel swung ${swing.toFixed(0)}°, ${backwards ? 'switch' : 'forwards'}${crashed}`;
}

/**
 * Crouches 0.4 s then pops: plain, out of a tail press (an ollie), or out of
 * a tail press while pivoting left, letting go of ← at takeoff so only the
 * carried spin turns the skier. Reports the air and how far it turned.
 */
function pop(speed: number, kind: 'plain' | 'ollie' | 'ollie spinning'): string {
  const r = settle(speed);
  const held: Action[] = kind === 'plain' ? ['up'] : kind === 'ollie' ? ['grabLeftTail', 'up'] : ['grabLeftTail', 'left', 'up'];
  for (let i = 0; i < Math.round(0.4 / DT); i++) r.step(held);
  const startY = r.s.position.y;
  r.step();
  let air = 0;
  let top = 0;
  let turned = 0;
  while (!r.s.grounded && !r.s.bailed && air < 5) {
    r.step();
    air += DT;
    top = Math.max(top, r.s.position.y - startY);
    turned += r.s.spin.y * DT;
  }
  const crash = r.s.bailed ? `, crashed (${r.s.bailReason})` : ', landed';
  return `${kind}: ${air.toFixed(2)} s in the air, ${top.toFixed(2)} m up, turned ${(turned * DEG).toFixed(0)}°${crash}`;
}

console.log(`${file}: butters from x=${x}, d=${d}`);
for (const speed of speeds) {
  console.log(`at ${speed} m/s`);
  for (const [end, deg] of [
    ['tail', 180],
    ['nose', 180],
    ['tail', 360],
    ['nose', 360],
  ] as const) {
    console.log(`  ${pivot(speed, end, deg)}`);
  }
  for (const kind of ['plain', 'ollie', 'ollie spinning'] as const) console.log(`  ${pop(speed, kind)}`);
}
