import { WEATHER_NAMES, WEATHERS, type WeatherId } from '../core/weather.ts';

// The weather pickers: a row of pictogram tiles under each map card (like
// a resort's conditions board), and the pause menu's Weather plank, which
// steps through them. One pick for every map, so every picker shows it.

/** Simple stroke pictograms, drawn in the text color on a 24 × 24 grid. */
const ICONS: Readonly<Record<WeatherId, string>> = {
  bluebird:
    '<circle cx="12" cy="12" r="4.2"/>' +
    '<path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  overcast: '<path d="M6.5 18.5h11a3.6 3.6 0 0 0 .4-7.2 5.5 5.5 0 0 0-10.6-1.2A4.2 4.2 0 0 0 6.5 18.5z"/>',
  blizzard:
    '<path d="M3 7.5h11.5a2.5 2.5 0 1 0-2.4-3.2M3 12h16a2.6 2.6 0 1 1-2.5 3.3M3 16.5h8"/>' +
    '<path d="M15 19.5l1.4 1.4M16.4 19.5L15 20.9M5.5 20l1.4 1.4M6.9 20l-1.4 1.4"/>',
  night: '<path d="M15.5 3.8a8.2 8.2 0 1 0 4.7 12.6A7 7 0 0 1 15.5 3.8z"/><path d="M18 5.5v3M16.5 7h3"/>',
};

/** A weather's pictogram as an inline SVG. */
export function weatherIcon(w: WeatherId): string {
  return `<svg class="weather-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[w]}</svg>`;
}

export interface WeatherHooks {
  get: () => WeatherId;
  set: (w: WeatherId) => void;
}

/** The row under a map card: a tile per weather and the picked one's name. */
export class WeatherRow {
  readonly el: HTMLElement;
  private readonly tiles = new Map<WeatherId, HTMLButtonElement>();
  private readonly name: HTMLElement;

  /** `onPick`: after a tile is picked (so every row can show it). */
  constructor(hooks: WeatherHooks, onPick: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'weather-row';
    const group = document.createElement('div');
    group.className = 'weather-tiles';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Weather');
    for (const w of WEATHERS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'weather-tile';
      b.title = WEATHER_NAMES[w];
      b.setAttribute('aria-label', WEATHER_NAMES[w]);
      b.innerHTML = weatherIcon(w);
      b.addEventListener('click', () => {
        hooks.set(w);
        onPick();
      });
      group.appendChild(b);
      this.tiles.set(w, b);
    }
    this.name = document.createElement('span');
    this.name.className = 'weather-name';
    this.el.append(group, this.name);
    this.sync(hooks.get());
  }

  sync(w: WeatherId): void {
    for (const [id, b] of this.tiles) b.setAttribute('aria-pressed', String(id === w));
    this.name.textContent = WEATHER_NAMES[w];
  }
}

/** Fills the pause menu's Weather plank's right side: the picked weather between step marks. */
export function setPlankWeather(plank: HTMLElement, w: WeatherId): void {
  const box = plank.querySelector('.plank-keys');
  if (!box) return;
  box.innerHTML =
    `<span class="weather-step" aria-hidden="true">‹</span>` +
    `<span class="weather-value">${weatherIcon(w)}<span>${WEATHER_NAMES[w]}</span></span>` +
    `<span class="weather-step" aria-hidden="true">›</span>`;
  plank.setAttribute('aria-label', `Weather: ${WEATHER_NAMES[w]}`);
}
