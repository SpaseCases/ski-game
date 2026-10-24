import { Color } from 'three';
import { CONFIG } from '../config.ts';
import type { WeatherId } from '../core/weather.ts';
import type { MapDef } from '../maps/types.ts';

// A weather's look on a map: its sky and fog colors (the map's own mixed
// toward the weather's, or the map's override), its lights, and the numbers
// the rest of the render layer reads from CONFIG.weather.

/** Sky and fog before any map is loaded (the title). */
const DEFAULT_SKY = '#9fc3e6';
const DEFAULT_FOG = '#dce8f3';

export type WeatherDef = (typeof CONFIG.weather)[WeatherId];

export interface WeatherLook {
  id: WeatherId;
  def: WeatherDef;
  sky: Color;
  fog: Color;
  sun: Color;
  sunIntensity: number;
  hemiSky: Color;
  hemiGround: Color;
  hemiIntensity: number;
  /** Multipliers on the far ranges' sky light and sunlight (see Backdrop). */
  peaksLight: Color;
  peaksSun: Color;
  /** Multiplies the color of blowing and falling snow, and the spray's glow. */
  fxTint: Color;
}

/** The look of weather `id` on `map` (null: before any map, the default colors). */
export function weatherLook(id: WeatherId, map: MapDef | null): WeatherLook {
  const def = CONFIG.weather[id];
  const own = id === 'bluebird' ? undefined : map?.weather?.[id];
  const sky = own?.sky ? new Color(own.sky) : new Color(map?.colors.sky ?? DEFAULT_SKY).lerp(new Color(def.sky.to), def.sky.mix);
  const fog = own?.fog ? new Color(own.fog) : new Color(map?.colors.fog ?? DEFAULT_FOG).lerp(new Color(def.fog.to), def.fog.mix);
  return {
    id,
    def,
    sky,
    fog,
    sun: new Color(def.sun),
    sunIntensity: def.sunIntensity,
    // The sky light keeps the map's own sky color unless the weather sets one (a deeper sky overhead doesn't tint the snow).
    hemiSky: new Color(def.hemiSky ?? map?.colors.sky ?? DEFAULT_SKY),
    hemiGround: new Color(def.hemiGround),
    hemiIntensity: def.hemiIntensity,
    peaksLight: new Color(def.peaks.light),
    peaksSun: new Color(def.peaks.sun),
    fxTint: new Color(def.fxTint),
  };
}

/** How far the camera sees in a weather: see setViewRange. */
export interface ViewRange {
  far: number;
  fogStart: number;
  hazeEnd: number;
  /** False when the weather pulls the view in to a wall of snow: nothing past it shows but the sky. */
  clear: boolean;
}

/**
 * A preset's view range (`range`) in weather `id`. `peaks`: the map has far
 * ranges, so the haze can reach past the far plane; elsewhere it ends there.
 */
export function weatherRange(id: WeatherId, range: { far: number; fogStart: number; hazeEnd: number }, peaks: boolean): ViewRange {
  const w = CONFIG.weather[id];
  if (w.view) {
    const far = Math.min(range.far, w.view.far);
    return { far, fogStart: Math.min(w.view.fogStart, far), hazeEnd: far, clear: false };
  }
  const far = range.far;
  const hazeEnd = peaks ? Math.max(far, range.hazeEnd * w.haze.hazeEnd) : far;
  return { far, fogStart: Math.min(range.fogStart * w.haze.fogStart, far), hazeEnd, clear: true };
}
