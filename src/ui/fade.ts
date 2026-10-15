import { CONFIG } from '../config.ts';

/**
 * Full-screen fade for respawning after a crash: fades to dark, runs a
 * callback while the screen is covered, then fades back in.
 */
export class Fader {
  private readonly el: HTMLElement;
  private alpha = 0;
  /** +1 fading out, -1 fading in, 0 idle. */
  private dir = 0;
  private onCovered: (() => void) | null = null;

  constructor(hud: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'fade';
    hud.appendChild(this.el);
  }

  get busy(): boolean {
    return this.dir !== 0;
  }

  /** Starts fading out; `onCovered` runs once the screen is fully covered. */
  fadeOut(onCovered: () => void): void {
    if (this.dir === 1) return;
    this.dir = 1;
    this.onCovered = onCovered;
  }

  /** Cancels a fade-out in progress and fades back in from wherever it got to. */
  reveal(): void {
    this.onCovered = null;
    this.dir = this.alpha > 0 ? -1 : 0;
  }

  update(frameTime: number): void {
    if (this.dir === 0) return;
    this.alpha += (this.dir * frameTime) / CONFIG.bail.fadeTime;
    if (this.alpha >= 1) {
      this.alpha = 1;
      this.dir = -1;
      const done = this.onCovered;
      this.onCovered = null;
      done?.();
    } else if (this.alpha <= 0) {
      this.alpha = 0;
      this.dir = 0;
    }
    this.el.style.opacity = String(this.alpha);
  }
}
