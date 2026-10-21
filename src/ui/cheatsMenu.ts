import type { CheatId } from '../sim/tuning.ts';
import { addBackButton, board, setHints, type Screen } from './menus.ts';

// The Cheats screen: six switches that combine freely, laid out like a
// resort's lift status board (each row's tag reads On or Off), and the
// button that opens the live tuning panel. Cheats are never saved.

const CHEAT_TEXT: readonly (readonly [CheatId, string, string])[] = [
  ['lowGravity', 'Low gravity', 'Long, floaty airs.'],
  ['superFast', 'Super fast', 'A much higher top speed: less friction and drag, and quicker, stronger pole pushes.'],
  ['moonJump', 'Moon jump', 'Pops launch far higher.'],
  ['slowMotion', 'Slow motion', 'The whole game runs at half speed, so tricks are easier to time.'],
  ['noCrashes', 'No crashes', 'Every landing rides away. Trees and rails only stop you.'],
  ['turboSpins', 'Turbo spins', 'Spins, flips and Lincoln loops turn twice as fast.'],
];

export interface CheatsHooks {
  isOn: (id: CheatId) => boolean;
  set: (id: CheatId, on: boolean) => void;
  panelOpen: () => boolean;
  /** Opens or closes the tuning panel (the first open loads it). */
  togglePanel: () => Promise<void>;
}

export class CheatsScreen implements Screen {
  readonly el: HTMLElement;
  private readonly switches = new Map<CheatId, HTMLButtonElement>();
  private readonly panelButton: HTMLButtonElement;
  private readonly allOff: HTMLButtonElement;
  private readonly status: HTMLElement;
  private readonly hooks: CheatsHooks;

  constructor(hooks: CheatsHooks, onBack: () => void) {
    this.hooks = hooks;
    const b = board('Cheats', 'cheats-screen');
    this.el = b.el;
    addBackButton(b.head, onBack);
    b.sub.textContent = 'Mix any of them. They all switch off again next time you play.';
    b.sub.hidden = false;

    const grid = document.createElement('div');
    grid.className = 'cheat-grid';
    for (const [id, name, what] of CHEAT_TEXT) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cheat';
      const label = document.createElement('span');
      label.className = 'cheat-name';
      label.textContent = name;
      const desc = document.createElement('span');
      desc.className = 'cheat-what';
      desc.textContent = what;
      const tag = document.createElement('span');
      tag.className = 'cheat-tag';
      tag.setAttribute('aria-hidden', 'true');
      btn.append(label, desc, tag);
      btn.addEventListener('click', () => {
        this.hooks.set(id, !this.hooks.isOn(id));
        this.sync();
      });
      grid.appendChild(btn);
      this.switches.set(id, btn);
    }

    const tools = document.createElement('div');
    tools.className = 'cheat-tools';
    this.panelButton = document.createElement('button');
    this.panelButton.type = 'button';
    this.panelButton.className = 'plank plank-small';
    this.panelButton.addEventListener('click', () => void this.togglePanel());
    this.allOff = document.createElement('button');
    this.allOff.type = 'button';
    this.allOff.className = 'plank plank-small';
    this.allOff.textContent = 'Switch all off';
    this.allOff.addEventListener('click', () => {
      for (const [id] of CHEAT_TEXT) this.hooks.set(id, false);
      this.sync();
      this.status.textContent = 'Every cheat is off.';
    });
    tools.append(this.panelButton, this.allOff);
    this.status = document.createElement('p');
    this.status.className = 'board-status';
    this.status.setAttribute('aria-live', 'polite');
    const note = document.createElement('p');
    note.className = 'setting-note';
    note.textContent = 'The tuning panel changes the physics numbers themselves, live, until you reload. Its Reset button puts them back.';
    b.body.append(grid, tools, note, this.status);
    setHints(b.foot, [
      [['↑', '↓', '←', '→'], 'Choose'],
      [['Enter'], 'Switch on or off'],
      [['Esc'], 'Back'],
    ]);
  }

  enter(): HTMLElement | null {
    this.sync();
    this.status.textContent = '';
    return this.switches.get(CHEAT_TEXT[0]![0]) ?? null;
  }

  /** Shows each switch as it is now, and the panel button for whether the panel is open. */
  sync(): void {
    for (const [id] of CHEAT_TEXT) {
      const btn = this.switches.get(id)!;
      const on = this.hooks.isOn(id);
      btn.setAttribute('aria-pressed', String(on));
      btn.querySelector('.cheat-tag')!.textContent = on ? 'On' : 'Off';
    }
    this.panelButton.textContent = this.hooks.panelOpen() ? 'Close the tuning panel' : 'Open the tuning panel';
  }

  private async togglePanel(): Promise<void> {
    const opening = !this.hooks.panelOpen();
    if (opening) this.status.textContent = 'Loading the tuning panel…';
    try {
      await this.hooks.togglePanel();
      this.status.textContent = opening ? 'The tuning panel is on the right. It stays open while you ride.' : '';
    } catch (err) {
      console.error(err);
      this.status.textContent = "The tuning panel didn't load. Check the connection and try again.";
    }
    this.sync();
  }
}
