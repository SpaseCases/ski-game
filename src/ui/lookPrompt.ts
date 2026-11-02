import { lookSvg } from '../online/look.ts';
import { board, plank, setHints, type Screen } from './menus.ts';

// The sign that comes up after a board name is entered on the title, when a
// look is saved online under that name: load it (replacing this computer's
// outfit and custom skis) or keep this computer's. Part of the lazy
// leaderboard chunk.

export class LookPrompt implements Screen {
  readonly el: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly preview: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly load: HTMLButtonElement;
  private onLoad: () => void = () => {};
  private onKeep: () => void = () => {};

  constructor() {
    const b = board('Saved look', 'look-prompt');
    this.el = b.el;
    this.sub = b.sub;
    this.sub.hidden = false;
    const card = document.createElement('div');
    card.className = 'look-card';
    this.preview = document.createElement('span');
    this.preview.className = 'look-preview';
    this.detail = document.createElement('p');
    this.detail.className = 'look-detail';
    card.append(this.preview, this.detail);
    const list = document.createElement('div');
    list.className = 'plank-list';
    this.load = plank('Load it', () => this.onLoad());
    list.append(this.load, plank('Keep mine', () => this.onKeep()));
    b.body.append(card, list);
    setHints(b.foot, [
      [['↑', '↓'], 'Choose'],
      [['Enter'], 'Pick'],
      [['Esc'], 'Keep mine'],
    ]);
  }

  /** Before opening: whose look, its tiny skier (a 13-character look), how many custom skis it has, and the two answers. */
  ask(name: string, look: string, customSkis: number, onLoad: () => void, onKeep: () => void): void {
    this.sub.textContent = `A look is saved online under “${name}”.`;
    this.preview.innerHTML = lookSvg(look);
    const skis = customSkis === 0 ? 'no custom skis' : customSkis === 1 ? '1 custom ski' : `${customSkis} custom skis`;
    this.detail.textContent = `Its outfit and ${skis}. Loading it replaces the outfit and custom skis on this computer. Keep yours, and the next time you close the Locker your look replaces it online.`;
    this.onLoad = onLoad;
    this.onKeep = onKeep;
  }

  enter(): HTMLElement | null {
    return this.load;
  }
}
