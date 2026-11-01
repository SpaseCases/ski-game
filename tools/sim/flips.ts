// Sweeps when a trick key is let go off a jump and prints the landing
// windows: for each moment the key is let go (one sim step apart), whether
// the skier lands (clean or sketchy) or crashes, and how far it rotated.
// A wider window is a more forgiving landing (milestone 9's pitch tuning).
//   node tools/sim/flips.ts [map.json] [jump] [speed] [--tricks back,front,spin]
// Defaults: the Park's jump 48 (a table on the x = -38 line) at 16 m/s.
// Every ride pops at the lip (crouched from the run-up, let go 0.2 m before
// it), then holds the trick key from takeoff:
// - back: ↓, a back flip.
// - front: ↑, a front flip, on "Pop with: Space": the pop key crouches and
//   pops while ↑ is held from 1 m before the lip, so the flip starts at takeoff.
// - spin: ←, a spin.

import type { Action } from '../../src/core/input.ts';
import type { JumpFeature } from '../../src/maps/types.ts';
import { sketchyLanding } from '../../src/sim/score.ts';
import { DT, jumpLayout, loadMap, Rider } from './harness.ts';

const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const plain = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const file = plain[0] ?? 'src/maps/park.json';
const index = Number(plain[1] ?? 48);
const speed = Number(plain[2] ?? 16);
const tricks = (option('--tricks') ?? 'back,front,spin').split(',') as Trick[];
const sim = loadMap(file);
const jump = sim.map.features[index];
if (jump?.type !== 'jump') throw new Error(`Feature ${index} of ${file} isn't a jump`);
const DEG = Math.PI / 180;

type Trick = 'back' | 'front' | 'spin';
const TRICK: Record<Trick, { name: string; key: Action; unit: string }> = {
  back: { name: 'back flip (↓)', key: 'down', unit: 'flips' },
  front: { name: 'front flip (↑, popping with Space)', key: 'up', unit: 'flips' },
  spin: { name: 'spin (←)', key: 'left', unit: '°' },
};

interface Result {
  /** Crash reason, or '' for a landing. */
  crash: string;
  sketchy: boolean;
  /** Rotation about the trick's axis by the landing (turns for flips, degrees for spins). */
  turned: number;
  air: number;
}

/**
 * Rides at the jump and pops; holds the trick key from takeoff until
 * `release` s after it (never, if negative), and rides out the landing.
 */
function attempt(j: JumpFeature, trick: Trick, release: number): Result {
  const lip = jumpLayout(j).lip;
  const back = 25;
  const dx = -Math.sin(j.yaw * DEG);
  const dz = -Math.cos(j.yaw * DEG);
  const x = j.x - dx * back;
  const z = j.z - dz * back;
  const r = new Rider(sim);
  r.popWithUp = trick !== 'front';
  const pop: Action = r.popWithUp ? 'up' : 'pop';
  r.place(x, z, j.yaw, speed);
  let takeoff = -1;
  let turned = 0;
  while (r.t < 10) {
    const along = (r.s.position.x - x) * dx + (r.s.position.z - z) * dz;
    const keys: Action[] = [];
    if (takeoff < 0) {
      if (r.s.grounded && along < back + lip - 0.2) keys.push(pop);
      if (trick === 'front' && along > back + lip - 1) keys.push('up');
    } else if (release < 0 || r.t - takeoff < release) {
      keys.push(TRICK[trick].key);
    }
    r.step(keys);
    if (takeoff < 0 && !r.s.grounded) takeoff = r.t - DT;
    if (takeoff < 0) continue;
    turned += Math.abs(trick === 'spin' ? r.s.spin.y : r.s.spin.x) * DT;
    if (r.s.bailed) return { crash: r.s.bailReason, sketchy: false, turned: turnedIn(trick, turned), air: r.t - takeoff };
    if (r.s.grounded) {
      const air = r.t - takeoff - DT;
      return { crash: '', sketchy: sketchyLanding(r.s, air, false), turned: turnedIn(trick, turned), air };
    }
  }
  return { crash: 'never landed', sketchy: false, turned: turnedIn(trick, turned), air: r.t - takeoff };
}

function turnedIn(trick: Trick, rad: number): number {
  return trick === 'spin' ? rad / DEG : rad / (2 * Math.PI);
}

const f = jump;
const straight = attempt(f, 'back', 0);
console.log(`${file} jump ${index} (${f.x.toFixed(0)}, ${f.z.toFixed(0)}) at ${speed} m/s, popped: ${straight.air.toFixed(2)} s air with no trick`);

for (const trick of tricks) {
  const t = TRICK[trick];
  if (!t) throw new Error(`Unknown trick "${trick}": back, front or spin`);
  console.log(`${t.name}, held from takeoff and let go after t s:`);
  // One result per step of release time; runs of the same outcome are one line.
  const results: { release: number; r: Result }[] = [];
  for (let i = 0; i * DT <= straight.air + 0.5; i++) results.push({ release: i * DT, r: attempt(f, trick, i * DT) });
  let start = 0;
  for (let i = 1; i <= results.length; i++) {
    const a = results[start]!;
    const b = results[i];
    if (b && b.r.crash === a.r.crash && (a.r.crash !== '' || Math.round(b.r.turned * 2) === Math.round(a.r.turned * 2) || trick === 'spin')) continue;
    const run = results.slice(start, i);
    const from = run[0]!.release;
    const to = run[run.length - 1]!.release;
    const span = `t ${from.toFixed(2)}–${to.toFixed(2)} s`;
    if (a.r.crash) {
      console.log(`  ${span}: crash (${a.r.crash})`);
    } else {
      const lo = run[0]!.r.turned;
      const hi = run[run.length - 1]!.r.turned;
      const amount = trick === 'spin' ? `${lo.toFixed(0)}–${hi.toFixed(0)}°` : `${lo.toFixed(2)}–${hi.toFixed(2)} ${t.unit}`;
      const clean = run.filter((x) => !x.r.sketchy);
      const cleanText = clean.length ? `, clean ${clean[0]!.release.toFixed(2)}–${clean[clean.length - 1]!.release.toFixed(2)} s` : ', all sketchy';
      console.log(`  ${span}: LANDS ${amount}, window ${(run.length * DT).toFixed(2)} s${cleanText}`);
    }
    start = i;
  }
}
