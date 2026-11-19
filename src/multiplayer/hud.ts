import { CHAT_MAX } from '../online/mpRules.ts';

// Multiplayer on the riding screen (milestone 27): a chip at the top saying
// which lobby and how many ride in it, or what's wrong in plain words
// (rejoining, blocked, full today); and the chat: the last few lines,
// each fading after a while, and a box the chat key opens. Typing turns the
// riding keys off until Enter or Esc. Nothing here runs per frame.

export interface ChatHooks {
  /** A line typed and sent with Enter. */
  send(text: string): void;
  /** The box opened or closed (the riding keys go off while it's open). */
  typing(on: boolean): void;
}

export class MpHud {
  private readonly chip: HTMLElement;
  private readonly log: HTMLElement;
  private readonly box: HTMLFormElement;
  private readonly input: HTMLInputElement;
  private readonly hooks: ChatHooks;
  private lines = 6;
  private show = 12;
  private open = false;

  constructor(hud: HTMLElement, hooks: ChatHooks) {
    this.hooks = hooks;
    this.chip = document.createElement('div');
    this.chip.className = 'mp-chip ride-only';
    this.chip.hidden = true;
    this.chip.setAttribute('aria-live', 'polite');
    this.log = document.createElement('div');
    this.log.className = 'mp-chat ride-only';
    this.log.setAttribute('aria-live', 'polite');
    this.box = document.createElement('form');
    this.box.className = 'mp-chat-box ride-only';
    this.box.hidden = true;
    this.input = document.createElement('input');
    this.input.className = 'text-box mp-chat-input';
    this.input.maxLength = CHAT_MAX;
    this.input.placeholder = 'Say something (Enter sends, Esc closes)';
    this.input.setAttribute('aria-label', 'Chat');
    this.input.autocomplete = 'off';
    this.box.appendChild(this.input);
    this.box.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = this.input.value;
      this.close();
      if (text.trim()) this.hooks.send(text);
    });
    // Typing is ours: no riding key, pause or menu sees it.
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });
    this.input.addEventListener('keyup', (e) => e.stopPropagation());
    this.input.addEventListener('blur', () => this.close());
    hud.append(this.chip, this.log, this.box);
  }

  setSizes(lines: number, show: number): void {
    this.lines = lines;
    this.show = show;
  }

  get typing(): boolean {
    return this.open;
  }

  /** The chip's text ('' hides it), and whether it's a problem (shown in the warning color). */
  status(text: string, problem = false): void {
    this.chip.hidden = text === '';
    this.chip.textContent = text;
    this.chip.classList.toggle('is-problem', problem);
  }

  /** A chat line (`who` empty for a note from the game). */
  line(who: string, text: string): void {
    const p = document.createElement('p');
    p.className = who ? 'mp-line' : 'mp-line is-note';
    if (who) {
      const name = document.createElement('b');
      name.textContent = who;
      p.append(name, document.createTextNode(` ${text}`));
    } else p.textContent = text;
    this.log.appendChild(p);
    while (this.log.childElementCount > this.lines) this.log.firstElementChild?.remove();
    window.setTimeout(() => p.classList.add('is-old'), this.show * 1000);
    window.setTimeout(() => p.remove(), this.show * 1000 + 1200);
  }

  /** Opens the chat box. */
  openChat(): void {
    if (this.open) return;
    this.open = true;
    this.box.hidden = false;
    this.input.value = '';
    this.hooks.typing(true);
    // After this key's own events, so the key that opened it isn't typed.
    window.setTimeout(() => this.input.focus(), 0);
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.box.hidden = true;
    this.input.blur();
    this.hooks.typing(false);
  }

  clear(): void {
    this.log.replaceChildren();
    this.close();
    this.status('');
  }

  dispose(): void {
    this.chip.remove();
    this.log.remove();
    this.box.remove();
  }
}
