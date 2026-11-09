// Rides a map's 3D rails (loops and corkscrews, milestone 14) from the snow
// at a sweep of speeds with the real simulation, and checks that the skis
// stay on exactly when they should: once a 3D rail has turned past upright
// (CONFIG.rails.uprightCos) they're held on while speed squared times its
// bend is at least gravity's pull off it.
//   node tools/sim/loop.ts <map.json> [--speeds 8,9,10,...]
// For each 3D rail and speed it prints the speed and what it needed where
// the rider was most upside down, how far round its up turned, where it let
// go (if it did), and what scoring named. A ride that went all the way round
// while short of the pull anywhere, or let go while it had enough, is a
// problem.

import { CONFIG } from '../../src/config.ts';
import { railFrame, railUp } from '../../src/sim/rails.ts';
import { createScore, scoreEvent, stepScore } from '../../src/sim/score.ts';
import { DT, loadMap, Rider } from './harness.ts';
import { Vector3 } from 'three';

const args = process.argv.slice(2);
const file = args[0];
if (!file) throw new Error('Usage: node tools/sim/loop.ts <map.json> [--speeds a,b,c]');
const at = args.indexOf('--speeds');
const speeds = at >= 0 ? args[at + 1]!.split(',').map(Number) : [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
const sim = loadMap(file);
const g = CONFIG.skier.gravity;
const DEG = 180 / Math.PI;
let problems = 0;

const pos = new Vector3();
const dir = new Vector3();
const up = new Vector3();

sim.course.rails.forEach((rail, i) => {
  if (!rail.ups) return;
  // Start 4 m back from its first point, heading along its first stretch, on the snow.
  const p = rail.points;
  const hx = p[3]! - p[0]!;
  const hz = p[5]! - p[2]!;
  const len = Math.hypot(hx, hz);
  const heading = Math.atan2(-hx, -hz) * DEG;
  const x = p[0]! - (hx / len) * 4;
  const z = p[2]! - (hz / len) * 4;
  console.log(`${rail.look} ${i} at (${p[0]!.toFixed(0)}, ${p[2]!.toFixed(0)}), ${rail.length.toFixed(0)} m:`);
  for (const v of speeds) {
    const r = new Rider(sim);
    r.place(x, z, heading, v);
    const score = createScore();
    let mounted = false;
    let turn = 0;
    let worst = Infinity; // lowest up.y while on it
    let topSpeed = 0;
    let topNeeds = 0;
    let minMargin = Infinity; // lowest speed² × bend + g × up.y while on it
    let letGo = '';
    let crash = '';
    let finished = false;
    let leftAt = -1;
    const names: string[] = [];
    let seen = 0;
    while (r.t < 10) {
      const was = r.s.rail === i;
      if (was) {
        // What holds the skis on here, where this step starts (as slideRail weighs it).
        const sAt = r.s.railS;
        const bend = railUp(rail, sAt, railFrame(rail, sAt, pos, dir), up, dir);
        const v2 = r.s.railSpeed * r.s.railSpeed;
        if (up.y < CONFIG.rails.uprightCos) minMargin = Math.min(minMargin, v2 * bend + g * up.y);
        if (up.y < worst) {
          worst = up.y;
          topSpeed = Math.abs(r.s.railSpeed);
          topNeeds = up.y < 0 && bend > 0 ? Math.sqrt((-g * up.y) / bend) : 0;
        }
      }
      r.step([]);
      stepScore(score, r.prev, r.s, sim.course.rails, sim.gaps, sim.hf, DT);
      for (; seen < score.seq; seen++) {
        const e = scoreEvent(score, seen);
        if (e && e.kind === 'trick') names.push(e.name);
      }
      const on = r.s.rail === i;
      if (on) {
        mounted = true;
        if (was) turn += Math.acos(Math.min(1, r.prev.normal.dot(r.s.normal)));
      }
      if (was && !on) {
        leftAt = r.t;
        // Off an end: this step would have carried it past.
        const end = r.prev.railS + r.prev.railSpeed * DT;
        if (end >= rail.length || end <= 0) finished = end >= rail.length;
        else if (r.s.rail < 0 && !r.s.grounded) letGo = `let go ${(turn * DEG).toFixed(0)}° round`;
        else if (r.s.rail < 0) letGo = `onto the snow ${(turn * DEG).toFixed(0)}° round`;
      }
      if (r.s.bailed) {
        crash = r.s.bailReason;
        break;
      }
      if (leftAt >= 0 && r.t > leftAt + 1.5) break;
    }
    // Held on exactly when it should: all the way round only with the pull covered everywhere; let go only without it.
    const round = turn * DEG >= CONFIG.score.loopTurn;
    let verdict = '';
    if (!mounted) {
      verdict = 'MISSED';
      problems++;
    } else if (round && minMargin < -1e-6) {
      verdict = 'WRONG: round while short of the pull';
      problems++;
    } else if (letGo.startsWith('let go') && minMargin >= 0) {
      verdict = 'WRONG: let go with the pull covered';
      problems++;
    }
    const top = `top ${topSpeed.toFixed(1)} m/s, needs ${topNeeds.toFixed(1)}`;
    const how = finished ? 'rode it out' : letGo || 'still on';
    console.log(
      `  ${String(v).padStart(2)} m/s: ${top}, turned ${(turn * DEG).toFixed(0)}°, ${how}${crash ? `, CRASH (${crash})` : ''}${names.length ? ` — ${names.join(' + ')}` : ''}${verdict ? `  ${verdict}` : ''}`,
    );
  }
});
console.log(problems === 0 ? 'no problems' : `${problems} problem${problems === 1 ? '' : 's'}`);
