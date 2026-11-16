// Rides a map's chairlifts (milestone 17) with the real simulation: skis
// into each one's loading gate, waits for a chair, rides it up and gets off
// at the top, then does it again holding the confirm key to skip.
//   node tools/sim/lift.ts <map.json>
// Prints how long the wait and the ride took, the top speed on the line, how
// far the skier sat from the chair's seat at worst (it should be nothing:
// both follow the one clock), where the top let them off, and that they
// then ride away down the hill. A ride that never boards, never gets off,
// or ends in a crash is a problem.

import type { Action } from '../../src/core/input.ts';
import { chairAt, LIFT, type ChairSpot } from '../../src/sim/lift.ts';
import { DT, loadMap, Rider } from './harness.ts';

const file = process.argv[2];
if (!file) throw new Error('Usage: node tools/sim/lift.ts <map.json>');
const sim = loadMap(file);
const lifts = sim.course.lifts;
let problems = 0;
if (!lifts) console.log(`${file}: no chairlift to ride`);

for (const [i, path] of (lifts?.paths ?? []).entries()) {
  const length = Math.hypot(path.top.x - path.bottom.x, path.top.z - path.bottom.z);
  console.log(
    `lift ${i}: ${length.toFixed(0)} m from (${path.bottom.x}, ${path.bottom.z}) to (${path.top.x}, ${path.top.z}), ${path.towers.length} towers, ` +
      `${path.chairs} chairs ${path.interval.toFixed(1)} s apart, a lap takes ${(path.period / 60).toFixed(1)} min unhurried`,
  );
  for (const skip of [false, true]) {
    const r = new Rider(sim);
    // From 12 m to the outside of the loading point, riding in at walking pace.
    const side = { x: -path.dirZ, z: path.dirX };
    r.place(path.loadX + side.x * 12, path.loadZ + side.z * 12, (Math.atan2(side.x, side.z) * 180) / Math.PI, 4);
    let wait = 0;
    let ride = 0;
    let top = 0;
    let gap = 0;
    let boarded = false;
    const spot: ChairSpot = { x: 0, y: 0, z: 0, yaw: 0, s: 0 };
    let t = 0;
    for (; t < 400; t += DT) {
      const held: Action[] = skip && r.s.liftChair >= 0 && ride > 4 ? ['confirm'] : [];
      r.step(held);
      const s = r.s;
      if (s.bailed) break;
      if (s.lift >= 0 && s.liftChair === -1) wait += DT;
      if (s.lift >= 0 && s.liftChair >= 0) {
        boarded = true;
        ride += DT;
        top = Math.max(top, r.speed);
        chairAt(path, lifts!.clock, s.liftChair, spot);
        const seat = LIFT.seats[LIFT.seats.length - 1]!;
        const sx = spot.x + Math.cos(spot.yaw) * seat - Math.sin(spot.yaw) * LIFT.feetAhead;
        const sz = spot.z - Math.sin(spot.yaw) * seat - Math.cos(spot.yaw) * LIFT.feetAhead;
        gap = Math.max(gap, Math.hypot(s.position.x - sx, s.position.z - sz, s.position.y - (spot.y - LIFT.hang - LIFT.feetBelow)));
      }
      if (boarded && s.lift < 0) break;
    }
    const s = r.s;
    const off = { x: s.position.x, z: s.position.z, heading: (s.yaw * 180) / Math.PI };
    const got = boarded && s.lift < 0 && !s.bailed;
    // Then ride away for 6 s.
    const from = s.position.z;
    for (let k = 0; k < 6 && got; k += DT) r.step([]);
    const away = from - r.s.position.z;
    const ok = got && !r.s.bailed && away > 5;
    if (!ok) problems++;
    console.log(
      `  ${skip ? 'skipped after 4 s' : 'ridden'}: ${boarded ? `waited ${wait.toFixed(1)} s, rode ${ride.toFixed(1)} s (top ${top.toFixed(1)} m/s, at most ${gap.toFixed(2)} m off the seat)` : 'NEVER BOARDED'}` +
        `${got ? `, off at (${off.x.toFixed(1)}, ${off.z.toFixed(1)}) heading ${off.heading.toFixed(0)}°, then ${away.toFixed(0)} m down the hill in 6 s at ${r.speed.toFixed(1)} m/s` : boarded ? ', NEVER GOT OFF' : ''}` +
        `${r.s.bailed ? ` CRASH (${r.s.bailReason})` : ''}`,
    );
  }
}
console.log(problems === 0 ? 'no problems' : `${problems} problem${problems === 1 ? '' : 's'}`);
