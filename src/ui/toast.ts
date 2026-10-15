import { CONFIG } from '../config.ts';

/** A short message near the top of the screen that fades away by itself ("Checkpoint set"). */
export class Toast {
  private readonly el: HTMLElement;
  private left = 0;

  constructor(hud: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'toast';
    this.el.setAttribute('role', 'status');
    this.el.hidden = true;
    hud.appendChild(this.el);
  }

  show(text: string): void {
    this.el.textContent = text;
    this.el.hidden = false;
    this.left = CONFIG.checkpoints.toastTime;
  }

  update(frameTime: number): void {
    if (this.left <= 0) return;
    this.left -= frameTime;
    if (this.left <= 0) this.el.hidden = true;
  }
}
