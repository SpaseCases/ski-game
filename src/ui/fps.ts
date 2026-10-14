import { CONFIG } from '../config.ts';

/** Small frame-rate readout for checking performance on real hardware. */
export interface FpsMeter {
  /** Call once per rendered frame with that frame's duration in seconds. */
  frame(frameTime: number): void;
}

export function mountFpsMeter(hud: HTMLElement): FpsMeter {
  const el = document.createElement('div');
  el.className = 'fps';
  hud.appendChild(el);

  let frames = 0;
  let elapsed = 0;
  let worst = 0;

  return {
    frame(frameTime: number): void {
      frames++;
      elapsed += frameTime;
      if (frameTime > worst) worst = frameTime;
      if (elapsed < CONFIG.debug.fpsInterval) return;

      const fps = Math.round(frames / elapsed);
      const avgMs = ((elapsed / frames) * 1000).toFixed(1);
      const worstMs = (worst * 1000).toFixed(1);
      el.textContent = `${fps} fps · ${avgMs} ms avg · ${worstMs} ms worst`;
      frames = 0;
      elapsed = 0;
      worst = 0;
    },
  };
}
