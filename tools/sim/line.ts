// Rides straight down a map from a standing start, hitting every jump and
// kicker on the way, and reports each air: takeoff speed, airtime, where it
// landed against the jump's knuckle and landing face, and how hard. This
// checks jumps at the speed their in-runs naturally reach, one after another.
//   node tools/sim/line.ts <map.json> <x> <from d> <to d> [stand|tuck] [pop|nopop] [720]
// d is the distance down the slope (z = -d). "stand" holds no keys; "tuck"
// holds ↑ (crouched, less drag). "pop" releases ↑ just before each lip (a
// full pop after a tuck); "nopop" releases it 8 m early. "720" spins a 720
// off every lip 3.5 m or taller (the huge jumps). After a crash the rider starts again from a
// standstill 15 m further down.

import { CONFIG } from '../../src/config.ts';
import type { Action } from '../../src/core/input.ts';
import { heightAt } from '../../src/sim/terrain.ts';
import { DT, jumpLayout, loadMap, Rider } from './harness.ts';

const [file, xArg, fromArg, toArg] = process.argv.slice(2);
if (!file || xArg === undefined || fromArg === undefined || toArg === undefined) {
  throw new Error('Usage: node tools/sim/line.ts <map.json> <x> <from d> <to d> [stand|tuck] [pop|nopop] [720]');
}
const flagsArg = process.argv.slice(6);
const tuck = flagsArg.includes('tuck');
const pop = !flagsArg.includes('nopop');
const spin = flagsArg.includes('720');
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
sim.map.features.forEach((f, i) => {
  if ((f.type !== 'jump' && f.type !== 'kicker') || Math.abs(f.yaw) > 1 || Math.abs(f.x - x) > f.width / 2) return;
  const start = -f.z;
  if (f.type === 'kicker') {
    lips.push({ d: start + (2 * f.lipHeight) / Math.tan(f.lipAngle * DEG), name: `kicker ${i}`, height: f.lipHeight });
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
lips.sort((a, b) => a.d - b.d);

const r = new Rider(sim);
r.place(x, -from, 0, 0);
let takeoffAt = -1;
let takeoffD = 0;
let takeoffSpeed = 0;
let turned = 0;
let spinning = false;
let topSpeed = 0;
let crashes = 0;
const pitchAt = (d: number): number => Math.atan(heightAt(hf, x, -d + 0.5) - heightAt(hf, x, -d - 0.5)) / DEG;
console.log(`${file}: x=${x} from d=${from} to ${to}, ${tuck ? 'tucked' : 'standing'}, ${pop ? 'popping at each lip' : 'no pop'}${spin ? ', spinning 720s' : ''}`);

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
  } else if (spinning) {
    const rate = Math.abs(r.s.spin.y);
    if (turned + (rate * rate) / (2 * CONFIG.air.rotateStop) >= 4 * Math.PI) spinning = false;
    else keys.push('left');
  }
  r.step(keys);
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
