import { CONFIG } from '../config.ts';

/** Advances the simulation by exactly `dt` seconds. */
export type StepFn = (dt: number) => void;

/**
 * Draws a frame. `alpha` (0..1) is how far real time has moved past the last
 * simulation step, for interpolating between the previous and current state.
 */
export type RenderFn = (alpha: number, frameTime: number) => void;

/**
 * Fixed-timestep loop: the simulation runs at CONFIG.sim.stepHz no matter the
 * display rate, and rendering happens once per animation frame.
 */
export function startLoop(step: StepFn, render: RenderFn): void {
  const dt = 1 / CONFIG.sim.stepHz;
  let accumulator = 0;
  let last = -1;

  const frame = (now: number): void => {
    requestAnimationFrame(frame);

    if (last < 0) last = now;
    let frameTime = (now - last) / 1000;
    last = now;
    if (frameTime > CONFIG.sim.maxFrameTime) frameTime = CONFIG.sim.maxFrameTime;

    accumulator += frameTime;
    while (accumulator >= dt) {
      step(dt);
      accumulator -= dt;
    }

    render(accumulator / dt, frameTime);
  };

  requestAnimationFrame(frame);
}
