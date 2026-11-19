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
  /** Whether a name is the developer's nickname (core/devUnlock.ts): then the code box shows. */
  isDev: (name: string) => Promise<boolean>;
  /** The developer's code as saved on this computer, and saving it. */
  devCode: () => string;
  setDevCode: (code: string) => void;
  /** Asks the Worker whether it takes the code. */
  checkDevCode: (code: string) => Promise<'ok' | 'wrong' | 'offline'>;
}

const NAME_NOTE = 'A nickname, not your real name. 3 to 16 letters, digits, spaces, - and _.';
const DEV_NOTE = 'Saved on this computer. Only the developer has one.';
/** How long after typing the name is checked against the developer's (a slow hash). */
const DEV_DELAY_MS = 300;

export class TitleScreen extends PlankScreen {
  private readonly nameInput: HTMLInputElement;
  private readonly nameNote: HTMLElement;
  private readonly actions: TitleActions;
  /** The developer's code box (milestone 24), shown only under the developer's nickname. */
  private readonly devBox: HTMLElement;
  private readonly devInput: HTMLInputElement;
  private readonly devNote: HTMLElement;
  private devTimer = 0;
  private devToken = 0;

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
    // The developer's code, under the name box only when the name is the developer's nickname.
    this.devBox = document.createElement('div');
    this.devBox.className = 'dev-box';
    this.devBox.hidden = true;
    const devRow = document.createElement('label');
    devRow.className = 'name-row';
    const devLabel = document.createElement('span');
    devLabel.className = 'name-label';
    devLabel.textContent = 'Dev code';
    this.devInput = document.createElement('input');
    this.devInput.type = 'password';
    this.devInput.className = 'text-box name-input';
    this.devInput.maxLength = 200;
    this.devInput.autocomplete = 'off';
    this.devInput.spellcheck = false;
    devRow.append(devLabel, this.devInput);
    this.devNote = document.createElement('p');
    this.devNote.className = 'name-note';
    this.devNote.setAttribute('aria-live', 'polite');
    this.devBox.append(devRow, this.devNote);
    box.append(row, this.nameNote, this.devBox);
    this.list.after(box);
    this.nameInput.addEventListener('input', () => this.typed());
    this.nameInput.addEventListener('blur', () => this.done());
    this.devInput.addEventListener('input', () => this.actions.setDevCode(this.devInput.value.trim()));
    this.devInput.addEventListener('change', () => this.checkCode());
  }

  enter(): HTMLElement | null {
    this.syncName();
    this.checkDev(this.actions.name(), 0);
    return super.enter();
  }

  /** Enter in the name box keeps it and goes back to the planks (in the code box, it checks the code there too). */
  onKey(e: KeyboardEvent): boolean {
    if (e.target === this.devInput && e.key === 'Enter') {
      this.list.querySelector('button')?.focus();
      return true;
    }
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
    this.checkDev(this.actions.name(), DEV_DELAY_MS);
  }

  /** Shows the code box when `name` is the developer's nickname (after `delay` ms: the hash is slow), else hides it. */
  private checkDev(name: string, delay: number): void {
    clearTimeout(this.devTimer);
    const token = ++this.devToken;
    const run = (): void => {
      this.actions.isDev(name).then(
        (dev) => {
          if (token !== this.devToken) return;
          const was = !this.devBox.hidden;
          this.devBox.hidden = !dev;
          if (dev && !was) {
            this.devInput.value = this.actions.devCode();
            this.devNote.textContent = DEV_NOTE;
            this.devNote.classList.remove('is-problem');
          }
        },
        () => {},
      );
    };
    if (delay > 0) this.devTimer = window.setTimeout(run, delay);
    else run();
  }

  /** The code box was left changed: the Worker says whether it takes the code. */
  private checkCode(): void {
    const code = this.devInput.value.trim();
    if (!code) {
      this.devNote.textContent = DEV_NOTE;
      this.devNote.classList.remove('is-problem');
      return;
    }
    this.devNote.textContent = 'Checking…';
    void this.actions.checkDevCode(code).then((answer) => {
      if (this.devInput.value.trim() !== code) return;
      this.devNote.textContent = answer === 'ok' ? 'Code accepted. Remove shows on marketplace items.' : answer === 'wrong' ? 'The Worker refused that code.' : "Can't check it now (offline); it's saved.";
      this.devNote.classList.toggle('is-problem', answer === 'wrong');
    });
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
  /** The full trail map (milestone 21: the trail-map key only shows and hides the corner map). */
  trailMap: () => void;
  /** The multiplayer lobby you're in (milestone 27). */
  lobby: () => void;
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
  private readonly lobby: HTMLButtonElement;
  private readonly actions: PauseActions;
  private readonly onResume: () => void;
  private resumeKey: (code: string) => boolean = () => false;

  constructor(actions: PauseActions) {
    super('Paused', 'pause-screen');
    this.sub.hidden = false;
    this.resume = this.addItem('Resume', actions.resume);
    this.respawn = this.addItem('Respawn', actions.respawn);
    this.addItem('Back to top', actions.backToTop);
    this.addItem('Trail map', actions.trailMap);
    // Milestone 27: the multiplayer lobby you're in (shown only while in one).
    this.lobby = this.addItem('Lobby', actions.lobby);
    this.lobby.hidden = true;
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

  /** Shows the Lobby plank while in a multiplayer lobby. */
  setLobby(on: boolean): void {
    this.lobby.hidden = !on;
  }

  /** The map name under the heading, and the keys shown on the planks (as bound now). */
  setInfo(mapName: string, resumeKeys: readonly string[], respawnKey: string, isPauseKey: (code: string) => boolean): void {
    this.sub.textContent = mapName;
    setPlankKeys(this.resume, resumeKeys);
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
