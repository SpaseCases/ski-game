// Checks a map's airbags (milestone 17) with the real simulation: every way a
// landing can crash must ride away on the pad, and every lane's jump must
// land on its pad at the speeds the lane gives.
//   node tools/sim/airbag.ts <map.json>
// 1. Drops: over each airbag's top and its face, the skier comes down in each
//    crash pose (nose up, on an edge, sideways, too hard, upside down,
//    backward, mid-flip). The same drop onto the plain snow of the in-run
//    above is the control: it should crash there, with the reason named.
// 2. Obstacle: a fence stood across a pad (on a small map built here) is
//    ridden into at speed; the same fence on snow is the control.
// 3. Lanes: from the flag above each airbag's kicker, standing and tucked,
//    rolling off and popping, holding nothing, a back flip, a spin, and both,
//    all the way to the landing. Prints the speed off the lip, the air, where
//    it landed on the pad, the speed kept and how long the pad took to let go.
// A crash on a pad, a lane jump that misses its pad, or a rider the pad
// never lets go of is a problem.

import { Quaternion, Vector3 } from 'three';
import { CONFIG } from '../../src/config.ts';
import type { Action } from '../../src/core/input.ts';
import { buildMap } from '../../src/maps/build.ts';
import { parseMap } from '../../src/maps/loader.ts';
import { onAirbag } from '../../src/maps/shapes.ts';
import type { AirbagFeature, KickerFeature } from '../../src/maps/types.ts';
import { heightAt } from '../../src/sim/terrain.ts';
import { DT, loadMap, Rider, type Sim } from './harness.ts';

const file = process.argv[2];
if (!file) throw new Error('Usage: node tools/sim/airbag.ts <map.json>');
const sim = loadMap(file);
const DEG = Math.PI / 180;
let problems = 0;

const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);
const turn = (axis: Vector3, deg: number): Quaternion => new Quaternion().setFromAxisAngle(axis, deg * DEG);

/** A way to come down: the body's rotation off the flight path, its rotation speed (rad/s, body axes), and the speed along and into the snow. */
interface Pose {
  name: string;
  trick: Quaternion;
  spin?: Vector3;
  along: number;
  down: number;
  /** The crash this is on snow ('' for one that lands there too). */
  expect: string;
}
const POSES: Pose[] = [
  { name: 'nose up 100°', trick: turn(X, 100), along: 12, down: 4, expect: 'pitch' },
  { name: 'flat on the back', trick: turn(X, 80), along: 12, down: 6, expect: 'pitch' },
  { name: 'on an edge 80°', trick: turn(Z, 80), along: 12, down: 4, expect: 'edge' },
  { name: 'sideways 90°', trick: turn(Y, 90), along: 12, down: 4, expect: 'sideways' },
  { name: 'too hard (19 m/s down)', trick: new Quaternion(), along: 6, down: 19, expect: 'impact' },
  { name: 'upside down', trick: turn(X, 180), along: 12, down: 4, expect: 'head' },
  { name: 'mid back flip', trick: turn(X, 130), spin: new Vector3(CONFIG.air.flipRate, 0, 0), along: 14, down: 5, expect: 'pitch' },
  { name: 'mid cork', trick: turn(new Vector3(1, 1, 0).normalize(), 100), spin: new Vector3(CONFIG.air.flipRate, CONFIG.air.spinRate, 0).multiplyScalar(0.25), along: 14, down: 5, expect: 'pitch' },
  { name: 'backward', trick: turn(Y, 180), along: 12, down: 4, expect: '' },
];

/** Puts the rider in the air in `pose`, heading down the hill, `height` m up and far enough back to come down at (x, z0). */
function hang(r: Rider, x: number, z0: number, pose: Pose, height: number): void {
  const g = CONFIG.skier.gravity;
  const fall = (-pose.down + Math.sqrt(pose.down * pose.down + 2 * g * height)) / g;
  const z = z0 + pose.along * fall;
  r.place(x, z, 0, 0);
  const s = r.s;
  s.grounded = false;
  s.airTime = 1;
  s.canPop = false;
  s.airFrame.identity();
  s.airHeading = 0;
  s.airPitch = 0;
  s.trick.copy(pose.trick);
  s.trickTurn = 6;
  s.spin.copy(pose.spin ?? new Vector3());
  s.spinDriven = 0;
  s.orient.copy(pose.trick);
  s.velocity.set(0, -pose.down, -pose.along);
  // The feet hang from the body's middle along the body: keep the middle over the spot.
  const up = new Vector3(0, 1, 0).applyQuaternion(s.orient);
  s.center.set(x, heightAt(r.sim.course.hf, x, z0) + height + CONFIG.air.comHeight, z);
  s.position.copy(s.center).addScaledVector(up, -CONFIG.air.comHeight);
}

interface Outcome {
  crash: string;
  soft: boolean;
  /** Speed (m/s) just after touching down, and seconds until off the pad (-1: never). */
  kept: number;
  off: number;
}

/** Steps until the rider touches down, then until the pad lets go. */
function ride(r: Rider, held: readonly Action[] = []): Outcome {
  for (let t = 0; t < 8 && !r.s.grounded && !r.s.bailed; t += DT) r.step(held);
  const out: Outcome = { crash: r.s.bailed ? r.s.bailReason : '', soft: r.s.landSoft, kept: r.speed, off: -1 };
  if (r.s.bailed) return out;
  const hf = r.sim.course.hf;
  for (let t = 0; t < 20; t += DT) {
    if (!onAirbag(hf, r.s.position.x, r.s.position.z)) {
      out.off = t;
      break;
    }
    r.step([]);
    if (r.s.bailed) {
      out.crash = r.s.bailReason;
      break;
    }
  }
  return out;
}

function say(o: Outcome): string {
  if (o.crash !== '') return `CRASH (${o.crash})`;
  if (!o.soft) return `landed on snow, ${o.kept.toFixed(1)} m/s`;
  return o.off < 0 ? `kept ${o.kept.toFixed(1)} m/s, NEVER LEFT THE PAD` : `rode away: kept ${o.kept.toFixed(1)} m/s, off the pad in ${o.off.toFixed(1)} s`;
}

// ---------------------------------------------------------------- 1. drops
const bags = sim.map.features.filter((f): f is AirbagFeature => f.type === 'airbag');
if (bags.length === 0) console.log(`${file}: no airbags`);
const faceLength = (a: AirbagFeature): number => a.height / Math.tan(a.angle * DEG);
for (const [i, a] of bags.entries()) {
  const dx = -Math.sin(a.yaw * DEG);
  const dz = -Math.cos(a.yaw * DEG);
  const at = (u: number): [number, number] => [a.x + dx * u, a.z + dz * u];
  const spots: [string, number][] = [
    ['top', a.back + a.top / 2],
    ['face', a.back + a.top + a.knuckle + faceLength(a) * 0.35],
  ];
  console.log(`airbag ${i} at (${a.x}, ${a.z}): ${a.width} m wide, top ${a.height} m high and ${a.top} m long, face ${faceLength(a).toFixed(0)} m at ${a.angle}°`);
  // The control: plain snow well above the pad (the lane's in-run).
  const [cx, cz] = at(-30);
  for (const pose of POSES) {
    const r = new Rider(sim);
    hang(r, cx, cz, pose, 3);
    const control = ride(r);
    const wanted = pose.expect === '' ? control.crash === '' : control.crash !== '';
    const parts: string[] = [];
    for (const [name, u] of spots) {
      const [x, z] = at(u);
      hang(r, x, z, pose, 3);
      const o = ride(r);
      if (o.crash !== '' || !o.soft || o.off < 0) problems++;
      parts.push(`${name}: ${say(o)}`);
    }
    console.log(`  ${pose.name.padEnd(24)} snow: ${control.crash === '' ? 'lands' : `crash (${control.crash})`}${wanted ? '' : ' (unexpected)'} | ${parts.join(' | ')}`);
  }
}

// ---------------------------------------------------------------- 2. an obstacle on a pad
{
  const fence = (x: number): Record<string, unknown> => ({ kind: 'fence', points: [{ x: x - 5, z: -70 }, { x: x + 5, z: -70 }] });
  const small: Sim = buildMap(
    parseMap({
      name: 'Airbag fence',
      terrain: { type: 'generated', width: 120, length: 200, cellSize: 2, slopeDeg: 12, flatTop: 10, runout: 30, bermWidth: 8, bermHeight: 3, noise: 0, seed: 1 },
      features: [{ type: 'airbag', x: 20, z: -50, width: 14, height: 2, top: 30, angle: 10 }],
      spawn: { x: 0, z: -10, heading: 0 },
      flags: [],
      finishes: [{ x: 0, z: -180, heading: 0, width: 100, length: 15 }],
      decor: [fence(20), fence(-20)],
      colors: { sky: '#8fbde9', fog: '#d9e7f3' },
    }),
  );
  const into = (x: number): string => {
    const r = new Rider(small);
    r.place(x, -66, 0, 13);
    for (let t = 0; t < 1.2 && !r.s.bailed; t += DT) r.step([]);
    const on = onAirbag(small.course.hf, r.s.position.x, r.s.position.z);
    if (on && r.s.bailed) problems++;
    return r.s.bailed ? `${on ? 'CRASH' : 'crash'} (${r.s.bailReason})` : `stopped by it, no crash (${r.speed.toFixed(1)} m/s)`;
  };
  console.log(`a fence ridden into at 13 m/s: on snow: ${into(-20)} | on a pad: ${into(20)}`);
}

// ---------------------------------------------------------------- 3. the lanes
const TRICKS: [string, Action[]][] = [
  ['no trick', []],
  ['back flips', ['down']],
  ['spins', ['left']],
  ['cork', ['down', 'left']],
];
for (const [i, a] of bags.entries()) {
  const kicker = sim.map.features.find((f): f is KickerFeature => f.type === 'kicker' && Math.abs(f.x - a.x) < 1 && f.z > a.z && f.z - a.z < 40);
  if (!kicker) {
    console.log(`airbag ${i}: no kicker above it`);
    continue;
  }
  const flag = sim.map.flags.filter((f) => Math.abs(f.x - a.x) < 2 && f.z > kicker.z).sort((p, q) => p.z - q.z)[0];
  const startZ = flag ? flag.z : kicker.z + 30;
  const lipZ = kicker.z - (2 * kicker.lipHeight) / Math.tan(kicker.lipAngle * DEG);
  const padEnd = a.z - (a.back + a.top + faceLength(a) + a.transition);
  console.log(`lane ${i} at x ${a.x}: ${(startZ - kicker.z).toFixed(0)} m in-run to a ${kicker.lipHeight} m lip at ${kicker.lipAngle}°, pad ${(a.z - padEnd).toFixed(0)} m long`);
  for (const stance of ['stand', 'tuck'] as const) {
    for (const pop of [false, true]) {
      const parts: string[] = [];
      let head = '';
      for (const [name, keys] of TRICKS) {
        const r = new Rider(sim);
        r.place(a.x, startZ, 0, 0);
        let off = 0;
        let air = 0;
        // Down the in-run: poling off the flag, then standing or tucked (↑ crouches); let ↑ go just before the lip to pop.
        for (let t = 0; t < 40 && r.s.grounded && !r.s.bailed; t += DT) {
          const z = r.s.position.z;
          const before = z - lipZ;
          const held: Action[] = [];
          if (r.speed < 4) held.push('pole');
          if (stance === 'tuck' && r.speed >= 4) held.push('pole');
          if (pop && before > 0.25 && before < 14) held.push('up');
          r.step(held);
          off = r.speed;
        }
        while (!r.s.grounded && !r.s.bailed && air < 8) {
          r.step(keys);
          air += DT;
        }
        const s = r.s;
        const where = s.landSoft ? `${(s.position.z - padEnd).toFixed(0)} m from the pad's end` : s.position.z > a.z ? 'SHORT of the pad' : 'PAST the pad';
        const o = ride(r);
        if (o.crash !== '' || !o.soft || o.off < 0) problems++;
        head = `off at ${off.toFixed(1)} m/s`;
        parts.push(`${name}: ${air.toFixed(2)} s, ${where}, ${say(o)}`);
      }
      console.log(`  ${stance}${pop ? ' + pop' : ''}, ${head}:\n    ${parts.join('\n    ')}`);
    }
  }
}

console.log(problems === 0 ? 'no problems' : `${problems} problem${problems === 1 ? '' : 's'}`);
