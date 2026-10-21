import { CONFIG } from '../config.ts';

/**
 * The Back to top button shown at the finish (Enter works too), and the bar
 * that fills while R is held to go back to the top.
 */
export class RunHud {
  private readonly finish: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly hold: HTMLElement;
  private readonly holdFill: HTMLElement;
  private readonly holdLabel: HTMLElement;
  private readonly button: HTMLButtonElement;
  private holdShown = -1;

  constructor(hud: HTMLElement, onBackToTop: () => void) {
    this.finish = document.createElement('div');
    this.finish.className = 'finish-panel';
    this.finish.hidden = true;
    const title = document.createElement('div');
    title.className = 'finish-title';
    title.textContent = 'Finished!';
    this.detail = document.createElement('div');
    this.detail.className = 'finish-detail';
    this.detail.hidden = true;
    const button = document.createElement('button');
    this.button = button;
    button.type = 'button';
    button.className = 'hud-button finish-button';
    button.addEventListener('click', () => {
      button.blur();
      onBackToTop();
    });
    this.hint = document.createElement('div');
    this.hint.className = 'finish-detail finish-hint';
    this.hint.hidden = true;
    this.finish.append(title, this.detail, button, this.hint);
    hud.appendChild(this.finish);

    this.hold = document.createElement('div');
    this.hold.className = 'hold-top';
    this.hold.hidden = true;
    const label = document.createElement('div');
    this.holdLabel = label;
    const track = document.createElement('div');
    track.className = 'hold-track';
    this.holdFill = document.createElement('div');
    this.holdFill.className = 'hold-fill';
    track.appendChild(this.holdFill);
    this.hold.append(label, track);
    hud.appendChild(this.hold);
    this.setKeys('Enter', 'R');
  }

  /** The keys as bound now: Back to top at the finish (`confirm`) and respawn. */
  setKeys(confirm: string, respawn: string): void {
    this.button.replaceChildren(document.createTextNode('Back to top'));
    const kbd = document.createElement('kbd');
    kbd.textContent = confirm;
    this.button.appendChild(kbd);
    this.holdLabel.textContent = `Keep holding ${respawn}: back to top`;
  }

  /**
   * `finished`: in the finish zone. `detail`: a line under the title (the
   * run time on a timed run), or ''; `hint`: one under the button, or ''.
   * `holdTime`: seconds R has been held toward going to the top (0 if not).
   */
  update(finished: boolean, detail: string, hint: string, holdTime: number): void {
    if (this.finish.hidden === finished) this.finish.hidden = !finished;
    if (this.detail.textContent !== detail) {
      this.detail.textContent = detail;
      this.detail.hidden = detail === '';
    }
    if (this.hint.textContent !== hint) {
      this.hint.textContent = hint;
      this.hint.hidden = hint === '';
    }

    const c = CONFIG.checkpoints;
    const progress = holdTime > c.holdHintDelay ? Math.min(1, holdTime / c.holdToTop) : 0;
    const visible = progress > 0 && progress < 1;
    if (this.hold.hidden === visible) this.hold.hidden = !visible;
    // Quantize so the style only changes a few dozen times per hold.
    const step = Math.round(progress * 50);
    if (visible && step !== this.holdShown) {
      this.holdShown = step;
      this.holdFill.style.transform = `scaleX(${step / 50})`;
    }
  }
}
