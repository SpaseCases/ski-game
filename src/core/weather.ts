import { readStored, writeStored } from './storage.ts';

// The weather: one pick for every map, remembered locally (a wiped or
// blocked storage just means bluebird). Its look is in CONFIG.weather and
// render/weather.ts.

export type WeatherId = 'bluebird' | 'overcast' | 'blizzard' | 'night';
export const WEATHERS: readonly WeatherId[] = ['bluebird', 'overcast', 'blizzard', 'night'];

export const WEATHER_NAMES: Readonly<Record<WeatherId, string>> = {
  bluebird: 'Bluebird',
  overcast: 'Overcast',
  blizzard: 'Blizzard',
  night: 'Night',
};

const KEY = 'weather.v1';

function isWeather(value: unknown): value is WeatherId {
  return typeof value === 'string' && (WEATHERS as readonly string[]).includes(value);
}

/** The remembered pick, or bluebird. */
export function loadWeather(): WeatherId {
  const saved = readStored(KEY);
  return isWeather(saved) ? saved : 'bluebird';
}

export function saveWeather(w: WeatherId): void {
  writeStored(KEY, w);
}

/** The weather named in the URL (?weather=night), which wins over the saved one for this visit. */
export function urlWeather(): WeatherId | null {
  const w = new URLSearchParams(window.location.search).get('weather');
  return isWeather(w) ? w : null;
}

/** The weather after (`step` 1) or before (-1) `w`, round the list. */
export function stepWeather(w: WeatherId, step: number): WeatherId {
  const i = WEATHERS.indexOf(w);
  return WEATHERS[(i + step + WEATHERS.length) % WEATHERS.length]!;
}
