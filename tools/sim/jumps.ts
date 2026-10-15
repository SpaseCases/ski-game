// Rides straight at every jump in a map, at a few approach speeds, with no
// pop and with a full pop, and reports the airtime and where each one lands
// against the jump's knuckle and landing face. Use it to size jumps.
//   node tools/sim/jumps.ts <map.json> [speeds, default 10,14,18]
// "40% down the face" means 40% of the way down the straight landing face;
// landings past the end are on the slope beyond it (rough, not a crash).

import { DT, jumpLayout as layout, loadMap, Rider } from './harness.ts';

const file = process.argv[2];
if (!file) throw new Error('Usage: node tools/sim/jumps.ts <map.json> [speeds]');
const speeds = (process.argv[3] ?? '10,14,18').split(',').map(Number);
const sim = loadMap(file);
const DEG = Math.PI / 180;
/** How far before the takeoff the run-up starts (m). */
const RUN_UP = 20;

sim.map.features.forEach((f, index) => {
  if (f.type !== 'jump') return;
  const g = layout(f);
  const yaw = f.yaw * DEG;
  const dirX = -Math.sin(yaw);
  const dirZ = -Math.cos(yaw);
  console.log(
    `jump ${index} at (${f.x}, ${f.z}): lip ${f.lipHeight} m at ${f.lipAngle}°, ${f.deck ? 'deck' : 'gap'} ${f.gap} m, landing ${f.landingHeight} m at ${f.landingAngle}°, ` +
      `face ${g.faceStart.toFixed(1)}–${g.faceEnd.toFixed(1)} m past the takeoff start`,
  );
  for (const speed of speeds) {
    for (const pop of [false, true]) {
      const r = new Rider(sim);
      r.place(f.x - dirX * RUN_UP, f.z - dirZ * RUN_UP, f.yaw, speed);
      let takeoff = -1;
      let takeoffSpeed = 0;
      let result = 'never left the snow';
      while (r.t < 12) {
        const along = (r.s.position.x - f.x) * dirX + (r.s.position.z - f.z) * dirZ;
        // Full crouch on the run-up, released just before the lip.
        const keys = pop && along < g.lip - 0.2 && along > g.lip - 0.2 - r.speed * 0.4 ? (['up'] as const) : [];
        r.step(keys);
        if (takeoff < 0 && !r.s.grounded) {
          takeoff = r.t;
          takeoffSpeed = r.speed;
        }
        if (takeoff >= 0 && r.s.grounded) {
          const at = (r.s.position.x - f.x) * dirX + (r.s.position.z - f.z) * dirZ;
          const where =
            at < g.knuckle
              ? `on the deck, ${(g.knuckle - at).toFixed(1)} m short of the knuckle`
              : at < g.faceStart
                ? 'on the knuckle'
                : at <= g.faceEnd
                  ? `on the face, ${(((at - g.faceStart) / Math.max(0.1, g.faceEnd - g.faceStart)) * 100).toFixed(0)}% down it`
                  : at <= g.end
                    ? 'on the transition'
                    : `${(at - g.end).toFixed(1)} m past the end`;
          const verdict = r.s.bailed ? `CRASH (${r.s.bailReason})` : 'clean';
          result = `off at ${takeoffSpeed.toFixed(1)} m/s, ${(r.t - takeoff - DT).toFixed(2)} s in the air, lands ${where}, ${r.s.landImpact.toFixed(1)} m/s into the snow, ${verdict}`;
          break;
        }
      }
      console.log(`  ${speed} m/s run-up, ${pop ? 'full pop' : 'no pop  '}: ${result}`);
    }
  }
});
