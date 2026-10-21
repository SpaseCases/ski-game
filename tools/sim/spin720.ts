// Measures how long a clean 720 takes at the current spin values (the ski's, with --ski):
// hold a spin key from takeoff, let go when the remaining turn equals the
// distance it takes to slow to a stop, and time until the spin has stopped.
// 720 jumps need at least 20% more airtime than this (GAME_DESIGN.md, Jump sizing).
//   node tools/sim/spin720.ts [--ski big]

import { TUNING } from '../../src/sim/tuning.ts';
import { DT } from './harness.ts';

const a = TUNING.air;
const target = 4 * Math.PI;

function time720(startRate: number): number {
  let rate = startRate;
  let turned = 0;
  let t = 0;
  let holding = true;
  while (t < 10) {
    // Let go once the slowdown alone will finish the turn.
    if (holding && turned + (rate * rate) / (2 * a.rotateStop) >= target) holding = false;
    rate = holding ? Math.min(a.spinRate, rate + a.rotateAccel * DT) : Math.max(0, rate - a.rotateStop * DT);
    turned += rate * DT;
    t += DT;
    if (!holding && rate === 0) break;
  }
  return t;
}

const plain = time720(0);
const preloaded = time720(a.spinPreload);
console.log(`spinRate ${a.spinRate} rad/s, rotateAccel ${a.rotateAccel}, rotateStop ${a.rotateStop}`);
console.log(`clean 720 from a standing start: ${plain.toFixed(2)} s (720 jumps need ${(plain * 1.2).toFixed(2)} s of air)`);
console.log(`holding the spin key at takeoff (+${a.spinPreload} rad/s preload): ${preloaded.toFixed(2)} s`);
