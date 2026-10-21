import { CONFIG } from '../config.ts';
import { TUNING } from '../sim/tuning.ts';

/** Advances the simulation by exactly `dt` seconds. */
export type StepFn = (dt: number) => void;

/**
 * Draws a frame. `alpha` (0..1) is how far real time has moved past the last
 * simulation step, for interpolating between the previous and current state.
 */
export type RenderFn = (alpha: number, frameTime: number) => void;

/**
 * Fixed-timestep loop: the simulation runs at CONFIG.sim.stepHz no matter the
 * display rate, and rendering happens once per animation frame. Real time
 * is scaled by TUNING.sim.timeScale on its way into the accumulator (Slow
 * motion), so the sim still steps at stepHz, just fewer times. While
 * `paused()` is true no step runs and no time builds up: the accumulator
 * holds still, so the drawn frame (and its interpolation) stays put.
 */
export function startLoop(step: StepFn, render: RenderFn, paused: () => boolean): void {
  const dt = 1 / CONFIG.sim.stepHz;
  let accumulator = 0;
  let last = -1;

  const frame = (now: number): void => {
    requestAnimationFrame(frame);

    if (last < 0) last = now;
    let frameTime = (now - last) / 1000;
    last = now;
    if (frameTime > CONFIG.sim.maxFrameTime) frameTime = CONFIG.sim.maxFrameTime;

    if (!paused()) accumulator += frameTime * TUNING.sim.timeScale;
    while (accumulator >= dt) {
      step(dt);
      accumulator -= dt;
    }

    render(accumulator / dt, frameTime);
  };

  requestAnimationFrame(frame);
}
