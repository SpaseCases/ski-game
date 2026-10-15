// Checks every small kicker in a map at set approach speeds, riding in
// straight from 6 m before it with no keys held:
// - a kicker angled off the fall line is a hip: reports the air and landing,
//   with and without a full pop;
// - a straight kicker with a lip under 1.2 m feeds a rail or box: reports
//   whether rolling off it catches the slide.
//   node tools/sim/kickers.ts <map.json> [speeds, default 6,10,14,18,22]

import { DT, loadMap, Rider } from './harness.ts';

const file = process.argv[2];
if (!file) throw new Error('Usage: node tools/sim/kickers.ts <map.json> [speeds]');
const speeds = (process.argv[3] ?? '6,10,14,18,22').split(',').map(Number);
const sim = loadMap(file);
const DEG = Math.PI / 180;

sim.map.features.forEach((k, i) => {
  if (k.type !== 'kicker') return;
  const hip = Math.abs(k.yaw) > 1;
  if (!hip && k.lipHeight >= 1.2) return;
  const a = k.yaw * DEG;
  const dirX = -Math.sin(a);
  const dirZ = -Math.cos(a);
  const lip = (2 * k.lipHeight) / Math.tan(k.lipAngle * DEG);
  const results: string[] = [];
  for (const speed of speeds) {
    for (const pop of hip ? [false, true] : [false]) {
      const r = new Rider(sim);
      r.place(k.x - dirX * 6, k.z - dirZ * 6, k.yaw, speed);
      let off = -1;
      let caught = false;
      let result = hip ? 'no air' : 'MISSED';
      while (r.t < 6) {
        const along = (r.s.position.x - k.x) * dirX + (r.s.position.z - k.z) * dirZ;
        if (!hip && along > lip + 30) break;
        r.step(pop && along < lip - 0.2 && along > lip - 0.2 - r.speed * 0.4 ? ['up'] : []);
        if (r.s.bailed) {
          result = `CRASH (${r.s.bailReason})`;
          break;
        }
        if (!hip && r.s.rail >= 0) {
          caught = true;
          result = 'caught';
          break;
        }
        if (off < 0 && !r.s.grounded) off = r.t;
        if (hip && off >= 0 && r.s.grounded) {
          result = `${(r.t - off - DT).toFixed(1)} s, ${r.s.landImpact.toFixed(0)} m/s in`;
          break;
        }
      }
      results.push(`${speed}${pop ? ' pop' : ''}: ${caught ? 'caught' : result}`);
    }
  }
  console.log(`${hip ? 'hip' : 'kicker to rail'} ${i} at (${k.x}, ${k.z}): ${results.join(' | ')}`);
});
