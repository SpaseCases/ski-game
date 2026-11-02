import { MAPS, type MapEntry, type MapId } from '../maps/registry.ts';
import { mapArt } from './mapArt.ts';
import { WeatherRow, type WeatherHooks } from './weatherPicker.ts';
import { addBackButton, board, setHints, type Screen } from './menus.ts';

/**
 * The map select: a card per map, picked with the arrow keys and Enter or
 * with the mouse. Each card has a picture, the map's name and what's on it,
 * and the weather picker under it (one pick for every map, so every
 * card's row shows it). A Leaderboards button by Back opens the board of
 * the card last focused.
 */
export class MapSelect implements Screen {
  readonly el: HTMLElement;
  private readonly status: HTMLElement;
  private readonly picks = new Map<MapId, HTMLButtonElement>();
  private readonly options = new Map<MapId, HTMLElement>();
  private current: MapId | null = null;
  private focusOn: MapId = MAPS[0]!.id;
  private busy = false;
  private readonly weatherRows: WeatherRow[] = [];
  private readonly weather: WeatherHooks;
  /** The card focused last, for the Leaderboards button. */
  private picked: MapId = MAPS[0]!.id;

  /** `onPick`: a map's card was chosen. `onBack`: the Back button. `weather`: the weather picked and picking it. `onBoards`: the Leaderboards button, with the card focused last. */
  constructor(onPick: (entry: MapEntry) => void, onBack: () => void, weather: WeatherHooks, onBoards: (id: MapId) => void) {
    this.weather = weather;
    const b = board('Choose a map', 'maps-screen');
    this.el = b.el;
    const boards = document.createElement('button');
    boards.type = 'button';
    boards.className = 'board-back board-link';
    boards.textContent = 'Leaderboards';
    boards.addEventListener('click', () => onBoards(this.picked));
    b.head.appendChild(boards);
    addBackButton(b.head, onBack);

    const grid = document.createElement('div');
    grid.className = 'map-grid';
    for (const entry of MAPS) {
      const card = document.createElement('div');
      card.className = 'map-card';
      card.dataset.id = entry.id;
      const pick = document.createElement('button');
      pick.type = 'button';
      pick.className = 'map-pick';
      if (!entry.load) pick.setAttribute('aria-disabled', 'true');
      pick.innerHTML =
        `<span class="map-art">${mapArt(entry.id)}</span>` +
        `<span class="map-text"><span class="map-name">${entry.name}</span>` +
        `<span class="map-blurb">${entry.blurb}</span></span>` +
        `<span class="map-badge">${entry.load ? '' : 'Coming soon'}</span>`;
      pick.addEventListener('focus', () => (this.picked = entry.id));
      pick.addEventListener('click', () => {
        if (entry.load && !this.busy) onPick(entry);
      });
      const opts = document.createElement('div');
      opts.className = 'map-options';
      if (entry.load) {
        const row = new WeatherRow(weather, () => this.syncWeather());
        this.weatherRows.push(row);
        opts.appendChild(row.el);
      }
      card.append(pick, opts);
      grid.appendChild(card);
      this.picks.set(entry.id, pick);
      this.options.set(entry.id, opts);
    }

    this.status = document.createElement('p');
    this.status.className = 'board-status';
    this.status.setAttribute('aria-live', 'polite');
    b.body.append(grid, this.status);
    setHints(b.foot, [
      [['←', '→', '↑', '↓'], 'Choose'],
      [['Enter'], 'Ride'],
      [['Esc'], 'Back'],
    ]);
  }

  /** Before showing: the map being ridden (null if none) and the one to focus when none is. */
  prepare(current: MapId | null, suggested: MapId): void {
    this.current = current;
    this.focusOn = current ?? suggested;
    this.picked = this.focusOn;
  }

  enter(): HTMLElement | null {
    this.busy = false;
    for (const [id, pick] of this.picks) {
      const badge = pick.querySelector('.map-badge');
      if (badge && pick.getAttribute('aria-disabled') !== 'true') badge.textContent = id === this.current ? 'Riding now' : '';
      pick.classList.toggle('is-current', id === this.current);
      pick.classList.remove('is-loading');
    }
    this.status.textContent = '';
    this.syncWeather();
    return this.picks.get(this.focusOn) ?? null;
  }

  canGoBack(): boolean {
    return !this.busy;
  }

  /** A row under a map's card for its options (after the weather). */
  addCardOption(id: MapId, el: HTMLElement): void {
    this.options.get(id)?.appendChild(el);
  }

  /** Shows the picked weather on every card. */
  syncWeather(): void {
    const w = this.weather.get();
    for (const row of this.weatherRows) row.sync(w);
  }

  /** Marks a card as loading (or clears it, with null) and says so under the cards. */
  setLoading(id: MapId | null): void {
    this.busy = id !== null;
    for (const [cid, pick] of this.picks) pick.classList.toggle('is-loading', cid === id);
    const entry = MAPS.find((m) => m.id === id);
    this.status.textContent = entry ? `Loading ${entry.name}…` : '';
  }

  /** Shows a problem under the cards (a map that failed to load). */
  setError(message: string): void {
    this.setLoading(null);
    this.status.textContent = message;
  }
}
