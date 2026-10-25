// Rides a bot down a Park line doing a scripted trick off each jump, then
// over a kicker onto a rail, with scoring stepped exactly as the game steps
// it, and prints every scoring event and the combo totals. Checks scores
// without a browser.
//   node tools/sim/score.ts [map.json] [x] [--tricks a,b,c] [--verbose]
// Defaults: the Park, its x = -38 line of tables. Tricks (cycled, one per
// jump): 360, 540, 720, cork540, cork720, backflip, frontflip, rodeo, misty,
// lincoln, straight, and any of those with +<grab> (see GRAB_KEYS), or a
// grab alone.

import { GRAB_ACTIONS, type Action, type GrabAction } from '../../src/core/input.ts';
import { comboMult, comboTotal, createScore, endCombo, scoreEvent, stepScore } from '../../src/sim/score.ts';
import { wrapAngle } from '../../src/sim/skier.ts';
import { TUNING } from '../../src/sim/tuning.ts';
import { multText, pointsText, trickTags, trickText } from '../../src/ui/scoreText.ts';
import { DT, jumpLayout, loadMap, Rider } from './harness.ts';

const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const plain = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--tricks'));
const file = plain[0] ?? 'src/maps/park.json';
const lineX = Number(plain[1] ?? -38);
const verbose = args.includes('--verbose');
const script = (
  option('--tricks') ?? '360,360+mute,backflip,rjapan,360,540+safety,360,180,lincoln,frontflip,720,cork720,360+rtail,cork720,rodeo,360,540+safety,straight,360'
).split(',');

const sim = loadMap(file);
const DEG = Math.PI / 180;
const score = createScore();
let banked = 0;
let best = 0;
let lost = 0;
let seen = 0;

/** Prints the scoring events made since the last call. */
function report(r: Rider): void {
  for (; seen < score.seq; seen++) {
    const ev = scoreEvent(score, seen);
    if (!ev) continue;
    const t = `t=${r.t.toFixed(2).padStart(6)}s`;
    if (ev.kind === 'trick') {
      const tags = trickTags(ev);
      console.log(`  ${t}  ${trickText(ev).padEnd(34)} +${pointsText(ev.points).padEnd(6)} ${tags.padEnd(26)} combo ${pointsText(score.base)} ${multText(comboMult(score))}, timer ${score.timer.toFixed(1)} s`);
    } else if (ev.kind === 'bank') {
      banked++;
      best = Math.max(best, ev.total);
      console.log(`  ${t}  BANKED ${pointsText(ev.total)}${ev.tainted ? ' (cheats on: no best)' : ''}`);
    } else {
      lost++;
      console.log(`  ${t}  LOST ${pointsText(ev.total)}`);
    }
  }
}

/** Steps the rider and the scoring together, the way the game's loop does. */
function step(r: Rider, keys: Action[]): void {
  r.step(keys);
  stepScore(score, r.prev, r.s, sim.course.rails, DT);
  report(r);
}

// ---------------------------------------------------------------- tricks

interface Trick {
  /** Keys held to rotate, and which rotation stops it (radians). */
  keys: Action[];
  axis: 'spin' | 'flip' | 'lincoln' | 'total';
  target: number;
  grab: GrabAction | null;
}

// Short names: mute, safety, japan, tail (left hand) and rmute and so on, plus
// every grab in GRAB_ACTIONS by its name without the prefix, lowercased
// (leftnose, rightnose, seaman, daffy, ironcross, spreadeagle...).
const GRAB_KEYS: Record<string, GrabAction> = {
  mute: 'grabLeftMute',
  safety: 'grabLeftSafety',
  japan: 'grabLeftJapan',
  tail: 'grabLeftTail',
  rmute: 'grabRightMute',
  rsafety: 'grabRightSafety',
  rjapan: 'grabRightJapan',
  rtail: 'grabRightTail',
};
for (const g of GRAB_ACTIONS) GRAB_KEYS[g.replace(/^(grab|style)/, '').toLowerCase()] ??= g;

function parseTrick(text: string): Trick {
  const [move = '', grabName] = text.split('+');
  let grab: GrabAction | null = grabName ? (GRAB_KEYS[grabName] ?? null) : null;
  const spin = (deg: number, extra: Action[] = [], axis: Trick['axis'] = 'spin'): Trick => ({ keys: ['left', ...extra], axis, target: deg * DEG, grab });
  switch (move) {
    case '180':
    case '360':
    case '540':
    case '720':
    case '900':
      return spin(Number(move));
    case 'cork540':
      return spin(540, ['down'], 'total');
    case 'cork720':
      return spin(720, ['down'], 'total');
    case 'backflip':
      return { keys: ['down'], axis: 'flip', target: 360 * DEG, grab };
    case 'frontflip':
      return { keys: ['up'], axis: 'flip', target: 360 * DEG, grab };
    case 'lincoln':
      return { keys: ['lincolnLeft'], axis: 'lincoln', target: 360 * DEG, grab };
    case 'rodeo':
      return { keys: ['down', 'left'], axis: 'flip', target: 360 * DEG, grab };
    case 'misty':
      return { keys: ['up', 'left'], axis: 'flip', target: 360 * DEG, grab };
    case 'straight':
      return { keys: [], axis: 'spin', target: 0, grab };
    default:
      grab = GRAB_KEYS[move] ?? null;
      if (!grab) throw new Error(`Unknown trick "${text}"`);
      return { keys: [], axis: 'spin', target: 0, grab };
  }
}

/** Keys for one step in the air: rotate until the rotation would coast to the target, and hold the grab mid-air. */
function airKeys(r: Rider, trick: Trick, turned: number, air: number): Action[] {
  const s = r.s;
  const keys: Action[] = [];
  const w = trick.axis === 'spin' ? Math.abs(s.spin.y) : trick.axis === 'flip' ? Math.abs(s.spin.x) : trick.axis === 'lincoln' ? Math.abs(s.spin.z) : s.spin.length();
  if (trick.target > 0 && turned + (w * w) / (2 * TUNING.air.rotateStop) < trick.target) keys.push(...trick.keys);
  if (trick.grab && air > 0.15 && air < 0.95) keys.push(trick.grab);
  return keys;
}

// ---------------------------------------------------------------- the line

interface Lip {
  d: number;
  name: string;
}
const lips: Lip[] = [];
sim.map.features.forEach((f, i) => {
  if (f.type !== 'jump' || Math.abs(f.yaw) > 1 || Math.abs(f.x - lineX) > f.width / 2) return;
  lips.push({ d: -f.z + jumpLayout(f).lip, name: `jump ${i}` });
});
lips.sort((a, b) => a.d - b.d);
if (lips.length === 0) throw new Error(`No jumps on the line x=${lineX}`);

console.log(`${file}: the line at x=${lineX}, tucked, popping each lip, ${lips.length} jumps`);
const r = new Rider(sim);
r.place(lineX, -(lips[0]!.d - 60), 0, 8);
let next = 0;
let turned = 0;
let airStart = -1;
let trick = parseTrick(script[0]!);
const end = lips[lips.length - 1]!.d + 80;
while (r.t < 400 && -r.s.position.z < end) {
  const s = r.s;
  const d = -s.position.z;
  while (next < lips.length && lips[next]!.d < d - 0.5) next++;
  const lip = lips[next];
  let keys: Action[] = [];
  if (s.grounded && s.rail < 0) {
    const toLip = lip ? lip.d - d : Infinity;
    // Tuck, releasing just before the lip for a full pop.
    if (toLip > 0.25) keys.push('up');
    // Hold the line, riding either way round (after a 540 it rides switch).
    const backwards = s.velocity.x * Math.sin(s.yaw) + s.velocity.z * Math.cos(s.yaw) > 0;
    if (toLip > 6 && s.landTime > 0.4) {
      const want = Math.atan2(-(lineX - s.position.x), 25) + (backwards ? Math.PI : 0);
      const err = wrapAngle(want - s.yaw);
      const rate = 3 * err * (backwards ? -1 : 1);
      if (rate > 0.03 && s.yawRate * (backwards ? -1 : 1) < rate) keys.push(backwards ? 'right' : 'left');
      else if (rate < -0.03 && s.yawRate * (backwards ? -1 : 1) > rate) keys.push(backwards ? 'left' : 'right');
    }
  } else if (!s.grounded && airStart >= 0) {
    keys = airKeys(r, trick, turned, r.t - airStart);
  }
  step(r, keys);
  if (!r.s.grounded && airStart < 0) {
    airStart = r.t;
    turned = 0;
    if (verbose) console.log(`  t=${r.t.toFixed(2)}s off ${lip?.name ?? `d=${d.toFixed(0)}`} at ${r.speed.toFixed(1)} m/s: ${script[next % script.length]}`);
  }
  if (airStart >= 0) {
    const w = r.s.spin;
    turned += (trick.axis === 'spin' ? Math.abs(w.y) : trick.axis === 'flip' ? Math.abs(w.x) : trick.axis === 'lincoln' ? Math.abs(w.z) : w.length()) * DT;
  }
  if (airStart >= 0 && r.s.grounded) {
    airStart = -1;
    const L = r.s;
    if (verbose) console.log(`    landed: pitch ${(L.landPitch / DEG).toFixed(0)}°, roll ${(L.landRoll / DEG).toFixed(0)}°, sideways ${(L.landSide / DEG).toFixed(0)}°, ${L.landImpact.toFixed(1)} m/s in${L.bailed ? `, CRASH (${L.bailReason})` : ''}`);
    // The next jump's trick (by jump, so a crash doesn't shift the script).
    const at = lips.findIndex((l) => l.d > -r.s.position.z);
    trick = parseTrick(script[(at < 0 ? lips.length : at) % script.length]!);
  }
  if (r.s.bailed && r.s.bailTime > 0.5) {
    const t = r.t;
    endCombo(score, r.s);
    r.place(lineX, r.s.position.z - 15, 0, 6);
    r.t = t;
    airStart = -1;
  }
}
// Let the last combo run out.
for (let i = 0; i < 8 / DT && score.active; i++) step(r, []);

// ---------------------------------------------------------------- a rail

const kicker = sim.map.features.findIndex((f) => f.type === 'kicker' && f.x < -90 && f.x > -100 && f.z < -215 && f.z > -228);
if (kicker >= 0) {
  const f = sim.map.features[kicker]!;
  if (f.type !== 'kicker') throw new Error('unreachable');
  for (const [label, turn] of [
    ['kicker to rail, straight', false],
    ['kicker to rail, turned sideways', true],
  ] as const) {
    console.log(`kicker ${kicker} to its rail at 10 m/s, ${label.split(', ')[1]}:`);
    const back = 8;
    const t0 = r.t;
    r.place(f.x + Math.sin(f.yaw * DEG) * back, f.z + Math.cos(f.yaw * DEG) * back, f.yaw, 10);
    r.t = t0;
    let started = false;
    while (r.t - t0 < 12) {
      const keys: Action[] = [];
      // Turn sideways on the rail, and back to straight before its end.
      const rail = sim.course.rails[r.s.rail];
      if (turn && rail) {
        // Turn toward the angle wanted, letting go in time for the turn to stop on it.
        const want = r.s.railS > rail.length * 0.8 ? 0 : Math.PI / 2;
        const w = r.s.yawRate;
        const coast = r.s.railAngle + (Math.sign(w) * w * w) / (2 * TUNING.rails.turnAccel);
        if (coast < want - 0.05) keys.push('left');
        else if (coast > want + 0.05) keys.push('right');
      }
      step(r, keys);
      if (r.s.bailed) {
        console.log(`  crashed (${r.s.bailReason})`);
        endCombo(score, r.s);
        break;
      }
      started ||= score.active;
      if (started && !score.active) break;
    }
  }
}

// ---------------------------------------------------------------- a long rail

// The longest rail (the Park's runs top to bottom): ride onto it and slide
// it to its end. Its points stop at railMax m; the combo timer holds on it.
const longest = sim.course.rails.reduce((best, rail, i, all) => (rail.length > (all[best]?.length ?? 0) ? i : best), -1);
const long = sim.course.rails[longest];
if (long && long.length > 100) {
  const p = long.points;
  const heading = (Math.atan2(-(p[3]! - p[0]!), -(p[5]! - p[2]!)) * 180) / Math.PI;
  console.log(`the longest rail (${long.length.toFixed(0)} m): onto it from the snow, to its end:`);
  const t0 = r.t;
  r.place(p[0]! + Math.sin((heading * Math.PI) / 180) * 6, p[2]! + Math.cos((heading * Math.PI) / 180) * 6, heading, 7);
  r.t = t0;
  let started = false;
  while (r.t - t0 < 300) {
    step(r, []);
    if (r.s.bailed) {
      console.log(`  crashed (${r.s.bailReason})`);
      endCombo(score, r.s);
      break;
    }
    started ||= score.active;
    if (started && !score.active) break;
  }
}

// ---------------------------------------------------------------- butters

// On the Park's middle line near the top at 8 m/s: a tail butter 180, a nose
// butter 360 and a tail press with no pivot, with a moment's riding between
// each; then from the same start an ollie 180 (a tail press, crouched,
// popped, spun in the air).
if (sim.map.name === 'Park') {
  console.log('butters on the Park at x=30, 8 m/s:');
  const t0 = r.t;
  r.place(30, -30, 0, 8);
  r.t = t0;
  const ride = (seconds: number, keys: Action[] = []): void => {
    for (let i = 0; i < seconds / DT; i++) step(r, keys);
  };
  /** Presses `end` and pivots ← until the turn would coast to `deg`, then holds the press a moment. */
  const pivot = (end: GrabAction, deg: number): void => {
    ride(0.2, [end]);
    for (let i = 0; i < 3 / DT; i++) {
      const w = r.s.yawRate;
      if (Math.abs(score.butter.turn) + (w * w) / (2 * TUNING.skier.butterSpinResponse) >= (deg * Math.PI) / 180) break;
      step(r, [end, 'left']);
    }
    ride(0.4, [end]);
  };
  ride(0.5);
  pivot('grabLeftTail', 180);
  ride(1);
  pivot('grabLeftNose', 360);
  ride(1);
  ride(1.2, ['grabLeftTail']);
  for (let i = 0; i < 8 / DT && score.active; i++) step(r, []);
  // A fresh start (the line runs into features further down).
  const t1 = r.t;
  r.place(30, -30, 0, 8);
  r.t = t1;
  ride(0.5);
  // The ollie: press the tails and crouch, let go of ↑ to pop, then spin a 180 (a pop off the flat is too short for a 360).
  ride(0.6, ['grabLeftTail', 'up']);
  step(r, ['grabLeftTail']);
  const trick180 = parseTrick('180');
  let turnedAir = 0;
  for (let i = 0; i < 3 / DT && !r.s.grounded; i++) {
    step(r, airKeys(r, trick180, turnedAir, 0));
    turnedAir += Math.abs(r.s.spin.y) * DT;
  }
  for (let i = 0; i < 8 / DT && score.active; i++) step(r, []);
  if (r.s.bailed) console.log(`  crashed (${r.s.bailReason})`);
}

console.log(`${banked} banked, ${lost} lost; best combo ${pointsText(best)}; last state: ${score.active ? `live, ${pointsText(comboTotal(score))}` : 'no combo'}`);
