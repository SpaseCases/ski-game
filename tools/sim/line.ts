// Rides straight down a map from a standing start, hitting every jump and
// kicker on the way, and reports each air: takeoff speed, airtime, where it
// landed against the jump's knuckle and landing face, and how hard. This
// checks jumps at the speed their in-runs naturally reach, one after another.
//   node tools/sim/line.ts <map.json> <x> <from d> <to d> [stand|tuck] [pop|nopop] [720]
// d is the distance down the slope (z = -d). "stand" holds no keys; "tuck"
// holds ↑ (crouched, less drag). "pop" releases ↑ just before each lip (a
// full pop after a tuck); "nopop" releases it 8 m early. "720" spins a 720
// off every lip 3.5 m or taller (the huge jumps). "start=<x>" starts at that x
// instead (a shared start, like a tower) and steers onto the line at x. A
// kicker in a lane of terrain (a table, then a steep landing) is reported
// against the knuckle and landing the terrain makes; ridden beside such a
// kicker (round it, along the table), the knuckle is the takeoff: a knuckle
// huck, popped with "pop". "speed=<d>[,<d>...]"
// reports the speed passing each of those d; "v0=<m/s>" starts moving at that
// speed instead of standing; "brake=<m/s>" brakes down to that speed before
// each takeoff (a controlled huck). "lip=<d>" adds a takeoff with no kicker
// (a ski jump's edge), reported against the landing hill below it. After a crash the rider
// starts again from a standstill 15 m further down.

import type { Action } from '../../src/core/input.ts';
import { heightAt } from '../../src/sim/terrain.ts';
import { TUNING } from '../../src/sim/tuning.ts';
import { DT, jumpLayout, loadMap, Rider } from './harness.ts';

const [file, xArg, fromArg, toArg] = process.argv.slice(2);
if (!file || xArg === undefined || fromArg === undefined || toArg === undefined) {
  throw new Error('Usage: node tools/sim/line.ts <map.json> <x> <from d> <to d> [stand|tuck] [pop|nopop] [720]');
}
const flagsArg = process.argv.slice(6);
const tuck = flagsArg.includes('tuck');
const pop = !flagsArg.includes('nopop');
const spin = flagsArg.includes('720');
const startArg = flagsArg.find((f) => f.startsWith('start='));
const startX = startArg ? Number(startArg.slice(6)) : undefined;
const speedArg = flagsArg.find((f) => f.startsWith('speed='));
const v0Arg = flagsArg.find((f) => f.startsWith('v0='));
const v0 = v0Arg ? Number(v0Arg.slice(3)) : 0;
const brakeArg = flagsArg.find((f) => f.startsWith('brake='));
const brakeTo = brakeArg ? Number(brakeArg.slice(6)) : Infinity;
const speedAt = speedArg ? speedArg.slice(6).split(',').map(Number) : [];
const x = Number(xArg);
const from = Number(fromArg);
const to = Number(toArg);
const sim = loadMap(file);
const hf = sim.course.hf;
const DEG = Math.PI / 180;

/** Takeoffs on this line: where each lip is (d), and the jump it belongs to (for landing reports). */
interface Lip {
  d: number;
  name: string;
  height: number;
  /** d of the knuckle, landing face start and end, and where the landing ends; absent for a kicker. */
  knuckle?: number;
  faceStart?: number;
  faceEnd?: number;
  end?: number;
}
const lips: Lip[] = [];
const pitchAt = (d: number): number => Math.atan(heightAt(hf, x, -d + 0.5) - heightAt(hf, x, -d - 0.5)) / DEG;

/**
 * The landing the terrain makes past a kicker's back (d): the knuckle where
 * the table rolls over (the snow passes 12°), the steep face (within 4° of
 * its steepest), and the end where it eases back under 12°. Absent when the
 * snow past the kicker never steepens (a kicker on an ordinary slope).
 */
function terrainLanding(back: number, edge?: number): Pick<Lip, 'knuckle' | 'faceStart' | 'faceEnd' | 'end'> {
  // Past the foot of the kicker's back, onto the table (or, given an edge, that is the knuckle).
  let from = back;
  while (edge === undefined && pitchAt(from) > 8 && from < back + 10) from += 0.25;
  const table = pitchAt(from + 1);
  let knuckle = edge ?? -1;
  for (let d = from; knuckle < 0 && d < from + 80; d += 0.25) {
    if (pitchAt(d) > Math.max(12, table + 8)) knuckle = d;
  }
  if (knuckle < 0) return {};
  let steepest = 0;
  let end = knuckle;
  for (let d = knuckle; d < knuckle + 150 && pitchAt(d) >= 12; d += 0.25) {
    steepest = Math.max(steepest, pitchAt(d));
    end = d;
  }
  let faceStart = knuckle;
  let faceEnd = knuckle;
  for (let d = knuckle; d <= end; d += 0.25) {
    if (pitchAt(d) < steepest - 4) continue;
    if (faceStart === knuckle) faceStart = d;
    faceEnd = d;
  }
  return { knuckle, faceStart, faceEnd, end };
}
sim.map.features.forEach((f, i) => {
  if ((f.type !== 'jump' && f.type !== 'kicker') || Math.abs(f.yaw) > 1) return;
  const start = -f.z;
  const off = Math.abs(f.x - x);
  if (f.type === 'kicker' && off > f.width / 2 + f.sideWidth && off < f.width / 2 + f.sideWidth + 12) {
    // Beside the kicker: if the snow past it makes a table and landing, its knuckle is a takeoff.
    const landing = terrainLanding(start + (2 * f.lipHeight) / Math.tan(f.lipAngle * DEG) + f.back);
    if (landing.knuckle !== undefined) lips.push({ d: landing.knuckle, name: `knuckle of kicker ${i}`, height: 0, ...landing });
    return;
  }
  if (off > f.width / 2) return;
  if (f.type === 'kicker') {
    const lip = start + (2 * f.lipHeight) / Math.tan(f.lipAngle * DEG);
    lips.push({ d: lip, name: `kicker ${i} (lip ${f.lipHeight} m)`, height: f.lipHeight, ...terrainLanding(lip + f.back) });
  } else {
    const g = jumpLayout(f);
    lips.push({
      d: start + g.lip,
      name: `jump ${i} (${f.deck ? 'table' : 'gap'} ${f.gap} m, lip ${f.lipHeight} m)`,
      height: f.lipHeight,
      knuckle: start + g.knuckle,
      faceStart: start + g.faceStart,
      faceEnd: start + g.faceEnd,
      end: start + g.end,
    });
  }
});
for (const f of flagsArg.filter((a) => a.startsWith('lip='))) {
  const d = Number(f.slice(4));
  lips.push({ d, name: `takeoff at d=${d}`, height: 0, ...terrainLanding(d, d) });
}
lips.sort((a, b) => a.d - b.d);

const r = new Rider(sim);
r.place(startX ?? x, -from, 0, v0);
let takeoffAt = -1;
let takeoffD = 0;
let takeoffSpeed = 0;
let turned = 0;
let spinning = false;
let topSpeed = 0;
let crashes = 0;
console.log(`${file}: x=${x} from d=${from} to ${to}, ${tuck ? 'tucked' : 'standing'}, ${pop ? 'popping at each lip' : 'no pop'}${spin ? ', spinning 720s' : ''}${startX !== undefined ? `, starting at x=${startX}` : ''}${v0 > 0 ? `, moving at ${v0} m/s` : ''}`);

while (r.t < 600) {
  const d = -r.s.position.z;
  if (d >= to) break;
  const next = lips.find((l) => l.d > d - 0.5);
  const keys: Action[] = [];
  if (r.s.grounded || r.s.rail >= 0) {
    const toLip = next ? next.d - d : Infinity;
    const release = pop ? 0.25 : 8;
    const crouchFor = r.speed * 0.4;
    if (tuck ? toLip > release : pop && toLip > release && toLip < release + crouchFor) keys.push('up');
    if (r.speed > brakeTo && toLip < 40 && toLip > release + crouchFor) keys.push('down');
    if (startX !== undefined && r.s.grounded && d > from + 30 && toLip > 25) {
      // Clear of the start (a tower's deck is narrow), steer onto the line: aim at a point on it 25 m ahead.
      // Not near a lip, where carving into it would set off a spin.
      const off = x - r.s.position.x;
      const err = Math.atan2(-off, 25) - r.s.yaw;
      const rate = 3 * err;
      if (rate > 0.02 && r.s.yawRate < rate) keys.push('left');
      else if (rate < -0.02 && r.s.yawRate > rate) keys.push('right');
    }
  } else if (spinning) {
    const rate = Math.abs(r.s.spin.y);
    if (turned + (rate * rate) / (2 * TUNING.air.rotateStop) >= 4 * Math.PI) spinning = false;
    else keys.push('left');
  }
  r.step(keys);
  for (const at of speedAt) if (d < at && -r.s.position.z >= at) console.log(`  passing d=${at}: ${r.speed.toFixed(1)} m/s`);
  topSpeed = Math.max(topSpeed, r.speed);
  if (takeoffAt >= 0) turned += Math.abs(r.s.spin.y) * DT;

  if (takeoffAt < 0 && !r.s.grounded && r.s.rail < 0) {
    takeoffAt = r.t;
    takeoffD = d;
    takeoffSpeed = r.speed;
    turned = 0;
    spinning = false;
  }
  if (takeoffAt >= 0 && !r.s.grounded && spin && !spinning && turned === 0) {
    // Commit to a 720 only on a real air: one launched off a lip.
    const lip = lips.find((l) => Math.abs(l.d - takeoffD) < 2);
    if (lip && lip.height >= 3.5) spinning = true;
  }
  let reported = false;
  if (takeoffAt >= 0 && (r.s.grounded || r.s.rail >= 0)) {
    reported = r.s.bailed;
    const air = r.t - takeoffAt - DT;
    const at = -r.s.position.z;
    if (air > 0.25) {
      const lip = lips.find((l) => Math.abs(l.d - takeoffD) < 2);
      let where = `d=${at.toFixed(1)} (${pitchAt(at).toFixed(0)}° snow)`;
      if (lip?.knuckle !== undefined && lip.faceStart !== undefined && lip.faceEnd !== undefined && lip.end !== undefined) {
        where +=
          at < lip.knuckle
            ? `, ${(lip.knuckle - at).toFixed(1)} m short of the knuckle`
            : at < lip.faceStart
              ? ', on the knuckle'
              : at <= lip.faceEnd
                ? `, ${(((at - lip.faceStart) / Math.max(0.1, lip.faceEnd - lip.faceStart)) * 100).toFixed(0)}% down the face`
                : at <= lip.end
                  ? ', on the transition'
                  : `, ${(at - lip.end).toFixed(1)} m past the landing`;
      }
      const verdict = r.s.bailed ? `CRASH (${r.s.bailReason})` : 'clean';
      const spun = spin && turned > Math.PI ? `, spun ${((turned * 180) / Math.PI).toFixed(0)}°` : '';
      console.log(
        `  ${(lip?.name ?? `air at d=${takeoffD.toFixed(0)}`).padEnd(38)} off ${takeoffSpeed.toFixed(1)} m/s, ${air.toFixed(2)} s, lands ${where}, ${r.s.landImpact.toFixed(1)} m/s in, ${verdict}${spun}`,
      );
    }
    takeoffAt = -1;
  }
  if (r.s.bailed) {
    if (!reported) console.log(`  crashed at d=${(-r.s.position.z).toFixed(1)} (${r.s.bailReason})`);
    crashes++;
    const t = r.t;
    r.place(x, r.s.position.z - 15, 0, 0);
    r.t = t;
    takeoffAt = -1;
  }
}
const d = -r.s.position.z;
console.log(`reached d=${d.toFixed(0)} after ${r.t.toFixed(1)} s with ${crashes} crash${crashes === 1 ? '' : 'es'}, now ${r.speed.toFixed(1)} m/s, top speed ${topSpeed.toFixed(1)} m/s`);
