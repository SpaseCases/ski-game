import { NAME_MAX, NAME_PROBLEM_TEXT, nameProblem, tidyName } from '../core/playerName.ts';
import { stepWeather, type WeatherId } from '../core/weather.ts';
import { board, plank, setHints, setPlankKeys, type Screen } from './menus.ts';
import { setPlankWeather } from './weatherPicker.ts';

// The two bottom screens: the title (before any map is loaded) and the pause
// menu (Esc or P while riding). Both are a sign board of planks; the title
// also has the box for the name scores post under on the leaderboards. Later
// milestones add their own planks (Cheats, the Locker, Weather) with
// addItem, so neither needs rebuilding.

const MENU_KEYS = new Set(['Enter', ' ', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/** A board of planks; picking one runs its action. */
class PlankScreen implements Screen {
  readonly el: HTMLElement;
  protected readonly sub: HTMLElement;
  protected readonly list: HTMLElement;
  protected readonly foot: HTMLElement;

  constructor(heading: string, className: string) {
    const b = board(heading, className);
    this.el = b.el;
    this.sub = b.sub;
    this.foot = b.foot;
    this.list = document.createElement('div');
    this.list.className = 'plank-list';
    b.body.appendChild(this.list);
    setHints(this.foot, [
      [['↑', '↓'], 'Choose'],
      [['Enter'], 'Pick'],
    ]);
  }

  /** Adds a plank, before the one named `before` if given. Returns it. */
  addItem(label: string, onPick: () => void, before?: string): HTMLButtonElement {
    const item = plank(label, onPick);
    item.dataset.item = label;
    const next = before ? this.list.querySelector(`[data-item="${before}"]`) : null;
    this.list.insertBefore(item, next);
    return item;
  }

  enter(): HTMLElement | null {
    return this.list.querySelector('button');
  }
}

export interface TitleActions {
  play: () => void;
  locker: () => void;
  settings: () => void;
  cheats: () => void;
  leaderboards: () => void;
  /** The saved board name ('' for none), and saving a checked one. */
  name: () => string;
  setName: (name: string) => void;
  /** The name box was left or Enter pressed in it, with this name saved ('' for none). */
  nameDone: (name: string) => void;
}

const NAME_NOTE = 'A nickname, not your real name. 3 to 16 letters, digits, spaces, - and _.';

export class TitleScreen extends PlankScreen {
  private readonly nameInput: HTMLInputElement;
  private readonly nameNote: HTMLElement;
  private readonly actions: TitleActions;

  constructor(actions: TitleActions) {
    super('Park Laps', 'title-screen');
    this.actions = actions;
    this.sub.textContent = 'Freeskiing in a terrain park, on a big mountain, through race gates and off a big air tower.';
    this.sub.hidden = false;
    this.addItem('Play', actions.play);
    this.addItem('Locker', actions.locker);
    this.addItem('Settings', actions.settings);
    this.addItem('Cheats', actions.cheats);
    this.addItem('Leaderboards', actions.leaderboards);

    // The board name: saved as it's typed whenever it passes the checks;
    // left with a problem, it goes back to the saved one.
    const box = document.createElement('div');
    box.className = 'name-box';
    const row = document.createElement('label');
    row.className = 'name-row';
    const label = document.createElement('span');
    label.className = 'name-label';
    label.textContent = 'Board name';
    this.nameInput = document.createElement('input');
    this.nameInput.type = 'text';
    this.nameInput.className = 'text-box name-input';
    this.nameInput.maxLength = NAME_MAX;
    this.nameInput.autocomplete = 'off';
    this.nameInput.spellcheck = false;
    this.nameInput.placeholder = 'None yet';
    row.append(label, this.nameInput);
    this.nameNote = document.createElement('p');
    this.nameNote.className = 'name-note';
    this.nameNote.id = 'name-note';
    this.nameNote.setAttribute('aria-live', 'polite');
    this.nameInput.setAttribute('aria-describedby', this.nameNote.id);
    box.append(row, this.nameNote);
    this.list.after(box);
    this.nameInput.addEventListener('input', () => this.typed());
    this.nameInput.addEventListener('blur', () => this.done());
  }

  enter(): HTMLElement | null {
    this.syncName();
    return super.enter();
  }

  /** Enter in the name box keeps it and goes back to the planks. */
  onKey(e: KeyboardEvent): boolean {
    if (e.target !== this.nameInput || e.key !== 'Enter') return false;
    this.typed();
    // Focus leaves the box, and its blur finishes the name (see done).
    this.list.querySelector('button')?.focus();
    return true;
  }

  /** Leaving the box: it shows the saved name again, and the game hears which name that is. */
  private done(): void {
    this.syncName();
    this.actions.nameDone(this.actions.name());
  }

  private typed(): void {
    const name = tidyName(this.nameInput.value);
    const problem = name === '' ? null : nameProblem(name);
    if (!problem) this.actions.setName(name);
    this.nameNote.textContent = problem ? NAME_PROBLEM_TEXT[problem] : NAME_NOTE;
    this.nameNote.classList.toggle('is-problem', problem !== null);
  }

  /** The box shows the saved name. */
  private syncName(): void {
    this.nameInput.value = this.actions.name();
    this.nameNote.textContent = NAME_NOTE;
    this.nameNote.classList.remove('is-problem');
  }
}

export interface PauseActions {
  resume: () => void;
  respawn: () => void;
  backToTop: () => void;
  maps: () => void;
  locker: () => void;
  settings: () => void;
  cheats: () => void;
  leaderboards: () => void;
  /** Leaves the map for the title. */
  mainMenu: () => void;
  /** The weather picked, and picking another (it changes behind the menu at once). */
  weather: () => WeatherId;
  setWeather: (w: WeatherId) => void;
}

export class PauseScreen extends PlankScreen {
  private readonly resume: HTMLButtonElement;
  private readonly respawn: HTMLButtonElement;
  private readonly weather: HTMLButtonElement;
  private readonly actions: PauseActions;
  private readonly onResume: () => void;
  private resumeKey: (code: string) => boolean = () => false;

  constructor(actions: PauseActions) {
    super('Paused', 'pause-screen');
    this.sub.hidden = false;
    this.resume = this.addItem('Resume', actions.resume);
    this.respawn = this.addItem('Respawn', actions.respawn);
    this.addItem('Back to top', actions.backToTop);
    // Enter steps to the next weather, and left and right step either way.
    this.weather = this.addItem('Weather', () => this.stepWeather(1));
    this.weather.classList.add('weather-plank');
    this.addItem('Map select', actions.maps);
    this.addItem('Leaderboards', actions.leaderboards);
    this.addItem('Locker', actions.locker);
    this.addItem('Settings', actions.settings);
    this.addItem('Cheats', actions.cheats);
    this.addItem('Main menu', actions.mainMenu);
    setHints(this.foot, [
      [['↑', '↓'], 'Choose'],
      [['Enter'], 'Pick'],
      [['Esc'], 'Resume'],
    ]);
    this.onResume = actions.resume;
    this.actions = actions;
  }

  enter(): HTMLElement | null {
    setPlankWeather(this.weather, this.actions.weather());
    return super.enter();
  }

  private stepWeather(step: number): void {
    const w = stepWeather(this.actions.weather(), step);
    this.actions.setWeather(w);
    setPlankWeather(this.weather, w);
  }

  /** The map name under the heading, and the keys shown on the planks (as bound now). */
  setInfo(mapName: string, pauseKey: string, respawnKey: string, isPauseKey: (code: string) => boolean): void {
    this.sub.textContent = mapName;
    setPlankKeys(this.resume, [pauseKey, 'Esc']);
    setPlankKeys(this.respawn, [respawnKey]);
    this.resumeKey = isPauseKey;
  }

  /** The pause key closes the menu again, like Esc (unless it's one the menu itself uses). */
  onKey(e: KeyboardEvent): boolean {
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && document.activeElement === this.weather) {
      if (!e.repeat) this.stepWeather(e.key === 'ArrowLeft' ? -1 : 1);
      return true;
    }
    if (e.repeat || MENU_KEYS.has(e.key) || !this.resumeKey(e.code)) return false;
    this.onResume();
    return true;
  }
}
