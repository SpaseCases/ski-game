// Rides a bot down a Park line doing a scripted trick off each jump, then
// over a kicker onto a rail, with scoring stepped exactly as the game steps
// it, and prints every scoring event and the combo totals. Checks scores
// without a browser. On the Park it then rides milestone 10's cases:
// rotations (reversed spins, a reversed tail butter, spin + Lincoln, five
// and six flips with Turbo spins and Low gravity) and, on Jam Park, gaps (an
// open gap, the Cat gap, a rail transfer, a fence hop), and last Freeride's
// named gaps (milestone 15), then the City's roof gaps (milestone 16).
//   node tools/sim/score.ts [map.json] [x] [--tricks a,b,c] [--verbose]
// Defaults: the Park, its x = -38 line of tables. Tricks (cycled, one per
// jump): 360, 540, 720, cork540, cork720, backflip, frontflip, rodeo, misty,
// lincoln, straight, and any of those with +<grab> (see GRAB_KEYS), or a
// grab alone.

import { GRAB_ACTIONS, type Action, type GrabAction } from '../../src/core/input.ts';
import { comboMult, comboTotal, createScore, endCombo, scoreEvent, stepScore } from '../../src/sim/score.ts';
import { wrapAngle } from '../../src/sim/skier.ts';
import { setCheat, TUNING, type CheatId } from '../../src/sim/tuning.ts';
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
  stepScore(score, r.prev, r.s, r.sim.course.rails, r.sim.gaps, r.sim.hf, DT);
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

// ---------------------------------------------------------------- milestone 10

if (sim.map.name === 'Park') {
  /** Speed 25 m before the lip of the cases' jump: it lands on the landing, not the flat past it. */
  const SPEED = 23;
  type Axis = 'spin' | 'flip' | 'lincoln' | 'total';
  /** Hold `key` until the rotation about `axis` since its phase began would coast to a stop at `deg`. */
  type Hold = [key: Action, axis: Axis, deg: number];
  const axisAngle = (axis: Axis): number => (axis === 'spin' ? score.air.spin : axis === 'flip' ? score.air.flip : axis === 'lincoln' ? score.air.lincoln : score.air.total);
  const axisRate = (r: Rider, axis: Axis): number => {
    const w = r.s.spin;
    return axis === 'spin' ? w.y : axis === 'flip' ? w.x : axis === 'lincoln' ? w.z : w.length();
  };
  /** Rides on, braking, until the combo banks (or reports a crash). */
  const settle = (r: Rider): void => {
    for (let i = 0; i < 12 / DT && (i < 0.5 / DT || score.active || !r.s.grounded); i++) {
      step(r, r.s.grounded ? ['down'] : []);
      if (r.s.bailed) {
        console.log(`  crashed (${r.s.bailReason})`);
        endCombo(score, r.s);
        return;
      }
    }
  };
  const withCheats = (cheats: CheatId[], ride: () => void): void => {
    for (const c of cheats) setCheat(c, true);
    ride();
    for (const c of cheats) setCheat(c, false);
  };
  /**
   * Off a jump on the x = -38 line, placed 25 m before its lip at `speed`
   * (tucked, popped at the lip), flying `phases` one after another: each
   * phase's holds run together, and the next phase waits for the rotation
   * to stop (a reversal starts from rest).
   */
  const airCase = (label: string, lip: Lip, speed: number, phases: Hold[][], cheats: CheatId[] = []): void => {
    console.log(`${label} (${lip.name}, ${speed} m/s${cheats.length ? `, ${cheats.join(' + ')}` : ''}):`);
    withCheats(cheats, () => {
      const r2 = new Rider(sim);
      r2.t = r.t;
      r2.place(lineX, -(lip.d - 25), 0, speed);
      while (r2.s.grounded && -r2.s.position.z < lip.d + 5) step(r2, lip.d - -r2.s.position.z > 0.25 ? ['up'] : []);
      let phase = -1;
      let from: number[] = [];
      let done: boolean[] = [];
      const begin = (): void => {
        phase++;
        from = (phases[phase] ?? []).map(([, axis]) => axisAngle(axis));
        done = (phases[phase] ?? []).map(() => false);
      };
      begin();
      const t0 = r2.t;
      while (!r2.s.grounded && !r2.s.bailed) {
        const holds = phases[phase];
        const keys: Action[] = [];
        if (holds) {
          holds.forEach(([key, axis, deg], i) => {
            if (done[i]) return;
            const w = axisRate(r2, axis);
            if (Math.abs(axisAngle(axis) - from[i]!) + (w * w) / (2 * TUNING.air.rotateStop) < (deg * Math.PI) / 180) keys.push(key);
            else done[i] = true;
          });
          if (keys.length === 0 && r2.s.spin.length() < 0.05) begin();
        }
        step(r2, keys);
      }
      const a = score.air;
      const deg = (x: number): string => `${Math.round((x * 180) / Math.PI)}°`;
      console.log(`  ${(r2.t - t0).toFixed(2)} s in the air; turned (net) spin ${deg(a.spin)}, flip ${deg(a.flip)}, Lincoln ${deg(a.lincoln)}, ${deg(a.total)} in all`);
      if (r2.s.bailed) {
        console.log(`  crashed (${r2.s.bailReason})`);
        endCombo(score, r2.s);
      } else settle(r2);
      r.t = r2.t;
    });
  };
  const lip = (name: string): Lip => {
    const l = lips.find((x) => x.name === name);
    if (!l) throw new Error(`no ${name} on the line`);
    return l;
  };

  // A run that turns back counts only its whole 180s (no grace), so the bot turns a little past each.
  console.log('milestone 10 rotations:');
  const big = lip('jump 75');
  airCase('a 180, then reverse 180', big, SPEED, [[['left', 'spin', 190]], [['right', 'spin', 180]]]);
  airCase('a 360, then reverse 180', big, SPEED, [[['left', 'spin', 370]], [['right', 'spin', 180]]], ['lowGravity']);
  airCase('wiggling 120 left, 120 right (no rotation counts)', big, SPEED, [[['left', 'spin', 120]], [['right', 'spin', 120]]]);
  airCase('a back flip, then a front flip', big, SPEED, [[['down', 'flip', 370]], [['up', 'flip', 360]]], ['lowGravity']);
  airCase('spin + Lincoln (← with Q): a flat spin', big, SPEED, [[['left', 'total', 720], ['lincolnLeft', 'total', 720]]]);
  airCase('spin + flip (← with ↓): a cork', big, SPEED, [[['left', 'total', 720], ['down', 'total', 720]]], ['noCrashes']);
  airCase('a Lincoln-heavy mix short of a loop: a flat spin', big, SPEED, [[['lincolnLeft', 'lincoln', 250], ['left', 'spin', 200]]], ['noCrashes']);
  airCase('five back flips', big, SPEED, [[['down', 'flip', 1800]]], ['turboSpins', 'lowGravity']);
  airCase('six back flips', big, SPEED, [[['down', 'flip', 2160]]], ['turboSpins', 'lowGravity']);
  airCase('six rodeos 540 (↓ with ←)', big, SPEED, [[['down', 'flip', 2160], ['left', 'spin', 540]]], ['turboSpins', 'lowGravity', 'noCrashes']);

  // A reversed tail butter: pivot ← 180 on the tails, let the turn stop, pivot → 180 back, then let go.
  {
    console.log('a tail butter 180, then reverse 180 (x=30, 8 m/s):');
    const rb = new Rider(sim);
    rb.t = r.t;
    rb.place(30, -30, 0, 8);
    for (let i = 0; i < 0.5 / DT; i++) step(rb, []);
    for (let i = 0; i < 0.2 / DT; i++) step(rb, ['grabLeftTail']);
    for (const [key, deg] of [['left', 180], ['right', 180]] as const) {
      const from = score.butter.turn;
      for (let i = 0; i < 3 / DT; i++) {
        const w = rb.s.yawRate;
        if (Math.abs(score.butter.turn - from) + (w * w) / (2 * TUNING.skier.butterSpinResponse) >= (deg * Math.PI) / 180) break;
        step(rb, ['grabLeftTail', key]);
      }
      for (let i = 0; i < 3 / DT && Math.abs(rb.s.yawRate) > 0.05; i++) step(rb, ['grabLeftTail']);
    }
    for (let i = 0; i < 0.3 / DT; i++) step(rb, ['grabLeftTail']);
    settle(rb);
    r.t = rb.t;
  }

  // Gaps on Jam Park.
  const jam = loadMap('src/maps/jampark.json');
  console.log(`milestone 10 gaps on Jam Park (${jam.gaps.zones.length} gap zones, ${jam.gaps.fences.length / 4} fence runs):`);
  /** Straight down the hill at a jump, placed 8 m before its takeoff at `speed`, tucked and popped at its lip, flying `keys` (by air time). */
  const jumpCase = (label: string, f: number, speed: number, keys: (t: number) => Action[]): void => {
    const j = jam.map.features[f];
    if (j?.type !== 'jump') throw new Error(`feature ${f} is not a jump`);
    const lipD = -j.z + jumpLayout(j).lip;
    console.log(`${label} (jump ${f}, ${speed} m/s):`);
    const rj = new Rider(jam);
    rj.t = r.t;
    rj.place(j.x, j.z + 8, 0, speed);
    while (rj.s.grounded && -rj.s.position.z < lipD + 5) step(rj, lipD - -rj.s.position.z > 0.25 ? ['up'] : []);
    const t0 = rj.t;
    while (!rj.s.grounded && !rj.s.bailed) step(rj, keys(rj.t - t0));
    const land = -rj.s.position.z - (-j.z + jumpLayout(j).knuckle);
    console.log(`  ${(rj.t - t0).toFixed(2)} s in the air, landed ${land.toFixed(1)} m past the knuckle`);
    if (rj.s.bailed) {
      console.log(`  crashed (${rj.s.bailReason})`);
      endCombo(score, rj.s);
    } else settle(rj);
    r.t = rj.t;
  };
  const cat = jam.gaps.zones.find((z) => z.named);
  const openGaps = jam.map.features.flatMap((f, i) => (f.type === 'jump' && !f.deck && Math.abs(f.yaw) < 1 ? [i] : []));
  const catJump = openGaps.find((i) => {
    const f = jam.map.features[i]!;
    return cat !== undefined && f.type === 'jump' && f.x > cat.box[0]! && f.x < cat.box[1]! && f.z > cat.box[2]! && f.z < cat.box[3]!;
  });
  const plainGap = openGaps.find((i) => i !== catJump && (jam.map.features[i] as { x: number }).x === -20);
  if (plainGap !== undefined) jumpCase('an open gap, straight', plainGap, 18, () => []);
  if (catJump !== undefined) jumpCase('the Cat gap, straight', catJump, 21, () => []);

  // A transfer: the tall tube where the jib and combo lines cross, its gap flown onto its second half.
  {
    const tube = jam.course.rails.findIndex((rail) => rail.look === 'tube' && Math.abs(rail.points[0]! - -64) < 0.5);
    const rail = jam.course.rails[tube];
    if (rail) {
      console.log(`a transfer: the tall tube's gap (rail ${tube}), from the snow at 16 m/s:`);
      const rt = new Rider(jam);
      rt.t = r.t;
      rt.place(rail.points[0]!, rail.points[2]! + 6, 0, 16);
      for (let i = 0; i < 15 / DT; i++) {
        step(rt, []);
        if (rt.s.bailed) {
          console.log(`  crashed (${rt.s.bailReason})`);
          endCombo(score, rt.s);
          break;
        }
        if (rt.t > 3 && rt.s.grounded && rt.s.rail < 0 && !score.active) break;
      }
      settle(rt);
      r.t = rt.t;
    }
  }

  // A fence hop: across the fence between the combo and jump lines, popped from beside it.
  {
    const f = jam.gaps.fences;
    let at = -1;
    for (let i = 0; i < f.length; i += 4) if (f[i] === -42 && f[i + 1]! < -500 && f[i + 1]! > -560) at = i;
    if (at >= 0) {
      const z = f[at + 1]! - 5;
      console.log(`a fence hop: the fence at x=-42 from z=${f[at + 1]} to ${f[at + 3]}, popped from 4 m beside it at 10 m/s:`);
      const rh = new Rider(jam);
      rh.t = r.t;
      rh.place(-46, z, -40, 10);
      while (rh.s.grounded && rh.s.position.x < -42 - 2.5) step(rh, ['up']);
      while (rh.s.grounded) step(rh, []);
      while (!rh.s.grounded && !rh.s.bailed) step(rh, []);
      console.log(`  landed at x=${rh.s.position.x.toFixed(1)}, ${score.air.time.toFixed(2)} s in the air`);
      if (rh.s.bailed) {
        console.log(`  crashed (${rh.s.bailReason})`);
        endCombo(score, rh.s);
      } else settle(rh);
      r.t = rh.t;
    }
  }
}

console.log(`${banked} banked, ${lost} lost; best combo ${pointsText(best)}; last state: ${score.active ? `live, ${pointsText(comboTotal(score))}` : 'no combo'}`);

// ---------------------------------------------------------------- milestone 15

// A map's named gaps: off each one's takeoff toward its landing, at three
// speeds. Last, after everything above (so its lines stay as they were):
// Freeride's (the four cat gaps and the log gap, milestone 15), then the
// City's five roof gaps (milestone 16).
function rideNamedGaps(file: string, label: string, speeds: readonly number[], back = 40): void {
  const fr = loadMap(file);
  const named = fr.gaps.zones.filter((z) => z.named);
  console.log(`${label} (${named.length}):`);
  const centre = (poly: Float32Array): { x: number; z: number } => {
    let x = 0;
    let z = 0;
    for (let i = 0; i < poly.length; i += 2) {
      x += poly[i]!;
      z += poly[i + 1]!;
    }
    return { x: x / (poly.length / 2), z: z / (poly.length / 2) };
  };
  /** Brakes to a stop on the snow until the combo banks (as milestone 10's cases do). */
  const settle = (rs: Rider): void => {
    for (let i = 0; i < 12 / DT && (i < 0.5 / DT || score.active || !rs.s.grounded); i++) {
      step(rs, rs.s.grounded ? ['down'] : []);
      if (rs.s.bailed) {
        console.log(`  crashed (${rs.s.bailReason})`);
        endCombo(score, rs.s);
        return;
      }
    }
  };
  let scored = 0;
  let rides = 0;
  for (const zone of named) {
    const a = centre(zone.from);
    const b = centre(zone.to);
    const heading = Math.atan2(-(b.x - a.x), -(b.z - a.z));
    for (const speed of speeds) {
      console.log(`${zone.name} at ${speed} m/s, from ${back} m above its takeoff:`);
      const before = score.seq;
      const rf = new Rider(fr);
      rf.t = r.t;
      rf.place(a.x + Math.sin(heading) * back, a.z + Math.cos(heading) * back, heading / DEG, speed);
      let flew = false;
      for (let i = 0; i < 12 / DT && !rf.s.bailed; i++) {
        const err = wrapAngle(heading - rf.s.yaw);
        step(rf, rf.s.grounded ? (err > 0.03 ? ['left'] : err < -0.03 ? ['right'] : []) : []);
        if (!rf.s.grounded) flew = true;
        if (flew && rf.s.grounded && rf.s.airTime === 0 && !score.active) break;
        if (flew && rf.s.grounded && i * DT > 6) break;
      }
      if (rf.s.bailed) {
        console.log(`  crashed (${rf.s.bailReason})`);
        endCombo(score, rf.s);
      } else settle(rf);
      rides++;
      for (let k = before; k < score.seq; k++) if (scoreEvent(score, k)?.kind === 'trick' && trickText(scoreEvent(score, k)!).includes(zone.name)) scored++;
      r.t = rf.t;
    }
  }
  console.log(`${scored} of ${rides} rides scored their gap`);
}
if (sim.map.name === 'Park') {
  rideNamedGaps('src/maps/freeride.json', 'milestone 15 named gaps on Freeride', [14, 18, 22]);
  // From the takeoff roof itself: further back, the hops between roofs come first.
  rideNamedGaps('src/maps/city.json', 'milestone 16 named roof gaps on the City', [12, 16, 20], 12);
}

// The City's wallrides (milestone 16): into each one at 25° from 6 m out,
// aiming for its middle (as features.ts does), at 12 m/s; a ride on its
// wooden face scores "Wallride" when the skis leave it.
if (sim.map.name === 'Park') {
  const city = loadMap('src/maps/city.json');
  // Since the city on a hill, the City's wallrides are drawn as their buildings' walls (style 'wall').
  const walls = city.map.features.filter((f) => f.type === 'quarter' && (f.style === 'wood' || f.style === 'wall'));
  console.log(`milestone 16 wallrides on the City (${walls.length}), at 12 m/s, 25° into each:`);
  let scored = 0;
  for (const q of walls) {
    if (q.type !== 'quarter') continue;
    const h = q.yaw * DEG;
    const out = 6;
    const u0 = q.length / 2 - out / Math.tan(25 * DEG);
    const x = q.x - Math.sin(h) * u0 - Math.cos(h) * q.side * out;
    const z = q.z - Math.cos(h) * u0 + Math.sin(h) * q.side * out;
    const before = score.seq;
    const rw = new Rider(city);
    rw.t = r.t;
    rw.place(x, z, q.yaw - q.side * 25, 12);
    for (let i = 0; i < 4 / DT && !rw.s.bailed; i++) step(rw, []);
    endCombo(score, rw.s);
    let name = '';
    for (let k = before; k < score.seq; k++) {
      const ev = scoreEvent(score, k);
      if (ev?.kind === 'trick' && ev.name === 'Wallride') name = `${ev.name} ${ev.meters.toFixed(1)} m, ${ev.points}`;
    }
    if (name) scored++;
    console.log(`  (${q.x.toFixed(0)}, ${q.z.toFixed(0)}): ${rw.s.bailed ? `crashed (${rw.s.bailReason}) ` : ''}${name || 'no wallride'}`);
    r.t = rw.t;
  }
  console.log(`${scored} of ${walls.length} wallrides scored`);
}
