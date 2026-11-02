// Rides straight over every drop of a peak map's cliff bands (milestone 15's
// steeps zone) with the real simulation, and prints each drop, the air and
// the impact against the landing limit (powder's or groomed snow's).
//   node tools/sim/cliffs.ts <map.json> [--min m] [--caps 12,16,20]
// --min: only bands whose tallest drop is at least this (default 12 m).
// --caps: speed caps (m/s); the rider brakes above each on the way in.
// The rider starts 10 m above each band's bench at the cap's speed, heading
// over the band, and steers to hold that heading (a chute's last stretch
// above its air is straight enough for that).

import type { CliffsElement } from '../../src/maps/types.ts';
import { wrapAngle } from '../../src/sim/skier.ts';
import { heightAt } from '../../src/sim/terrain.ts';
import { TUNING } from '../../src/sim/tuning.ts';
import { loadMap, Rider } from './harness.ts';

const args = process.argv.slice(2);
const file = args[0];
if (!file) throw new Error('Usage: node tools/sim/cliffs.ts <map.json> [--min m] [--caps 12,16,20]');
const option = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const min = Number(option('--min') ?? 12);
const caps = (option('--caps') ?? '12,16,20').split(',').map(Number);
const sim = loadMap(file);
const terrain = sim.map.terrain;
if (terrain.type !== 'peak') throw new Error(`${file} has no peak terrain`);
const DEG = Math.PI / 180;
/** Start this far (m) above the band's bench. */
const RUN_IN = 10;
/** A drop counts from this height (m) after the band's taper. */
const COUNTED = 3;

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

let problems = 0;
let rides = 0;
const L = TUNING.landing;
console.log(`${file}: cliff bands with a drop of ${min} m or more, speed caps ${caps.join(', ')} m/s`);
terrain.elements.forEach((e, index) => {
  if (e.type !== 'cliffs') return;
  const band = e as CliffsElement;
  const tallest = Math.max(...band.points.map((p) => p.height));
  if (tallest < min) return;
  const a = band.heading * DEG;
  const dx = -Math.sin(a);
  const dz = -Math.cos(a);
  // Distance along the band's line to each point, for its taper.
  const at = [0];
  for (let i = 1; i < band.points.length; i++) at.push(at[i - 1]! + Math.hypot(band.points[i]!.x - band.points[i - 1]!.x, band.points[i]!.z - band.points[i - 1]!.z));
  const total = at[at.length - 1]!;
  const centre = band.points.reduce((s, p) => ({ x: s.x + p.x / band.points.length, z: s.z + p.z / band.points.length }), { x: 0, z: 0 });
  console.log(`band ${index} at (${centre.x.toFixed(0)}, ${centre.z.toFixed(0)}), heading ${band.heading}°, bench ${band.bench} m`);
  band.points.forEach((p, i) => {
    const taper = band.taper > 0 ? smoothstep(0, band.taper, at[i]!) * smoothstep(0, band.taper, total - at[i]!) : 1;
    const drop = p.height * taper;
    if (drop < COUNTED) return;
    const cells: string[] = [];
    for (const cap of caps) {
      const r = new Rider(sim);
      const back = band.bench + RUN_IN;
      r.place(p.x - dx * back, p.z - dz * back, band.heading, cap);
      let off: { y: number; t: number; v: number } | null = null;
      let cell = 'no air';
      let bad = true;
      while (r.t < 40) {
        const keys: ('left' | 'right' | 'down')[] = [];
        if (r.s.grounded) {
          const err = wrapAngle(a - r.s.yaw);
          if (err > 0.03) keys.push('left');
          else if (err < -0.03) keys.push('right');
          if (r.speed > cap) keys.push('down');
        }
        r.step(keys);
        const q = r.s.position;
        if (!r.s.grounded && !r.s.bailed && !off) off = { y: q.y, t: r.t, v: r.speed };
        if (off && (r.s.grounded || r.s.bailed)) {
          const air = r.t - off.t;
          // A hop that lands above the band (on its bench) isn't the drop.
          const past = (q.x - p.x) * dx + (q.z - p.z) * dz;
          if ((air > 0.4 && past > 0) || r.s.bailed) {
            const limit = r.s.landPowder ? L.impactMax * L.powderImpact : L.impactMax;
            const fell = off.y - q.y;
            cell = `${air.toFixed(1)} s, fell ${fell.toFixed(0)} m, ${r.s.landImpact.toFixed(1)}/${limit.toFixed(0)} m/s ${r.s.landPowder ? 'powder' : 'GROOMED'}${r.s.bailed ? ` CRASH (${r.s.bailReason})` : ''}`;
            bad = r.s.bailed;
            break;
          }
          off = null;
        }
        if (r.s.bailed) {
          cell = `CRASH before the band (${r.s.bailReason})`;
          break;
        }
        // Well past the band with no air: it rolled off.
        if (r.s.grounded && (q.x - p.x) * dx + (q.z - p.z) * dz > 30) break;
      }
      rides++;
      if (bad) problems++;
      cells.push(`${cap}: ${cell}`);
    }
    const ground = heightAt(sim.course.hf, p.x, p.z);
    console.log(`  ${drop.toFixed(1)} m drop at (${p.x.toFixed(0)}, ${p.z.toFixed(0)}, ${ground.toFixed(0)} m)  ${cells.join(' | ')}`);
  });
});
console.log(`${rides} rides, ${problems} problem${problems === 1 ? '' : 's'}`);
