import { CONFIG } from '../config.ts';
import type { WeatherId } from '../core/weather.ts';
import type { BuiltMap } from '../maps/build.ts';
import type { RailShape } from '../maps/types.ts';
import type { SkierState } from '../sim/skier.ts';
import { AmbientSounds } from './ambience.ts';
import { AudioEngine } from './engine.ts';
import { RidingSounds } from './riding.ts';
import type { ShotId } from './synth.ts';

// The game's sound, as main.ts sees it (GAME_DESIGN.md, Audio): the
// skier's riding sounds, the world's ambience and the menus' clicks, all
// made procedurally (audio/synth.ts). Nothing is made or heard before the
// player's first key press or click. It reads the sim's state like the
// render layer does; the sim knows nothing of it.

export class GameAudio {
  readonly engine: AudioEngine;
  private riding: RidingSounds | null = null;
  private ambient: AmbientSounds | null = null;
  private built: BuiltMap | null = null;
  private weather: WeatherId = 'bluebird';
  /** When the last pointer press and menu click were (ms), to keep a focus tick from doubling a click. */
  private lastPointer = -Infinity;
  private lastClick = -Infinity;

  constructor(masterVolume: number, sfxVolume: number, muted: boolean) {
    this.engine = new AudioEngine(masterVolume, sfxVolume, muted);
    this.engine.onStart((ctx) => {
      this.riding = new RidingSounds(this.engine, ctx);
      this.ambient = new AmbientSounds(this.engine, ctx);
      this.riding.onCleanLanding = (x, z) => this.ambient?.cheer(x, z);
      this.ambient.setMap(this.built);
      this.ambient.setWeather(this.weather);
    });
  }

  /**
   * Starts listening: for the first gesture (on `win`), and for menu picks
   * under `hud`: a soft click when a button is pressed (by mouse or key),
   * and a much quieter tick when keyboard focus moves in a menu.
   */
  attach(win: Window, hud: HTMLElement): void {
    this.engine.attach(win);
    hud.addEventListener('pointerdown', () => (this.lastPointer = performance.now()), true);
    hud.addEventListener('click', (e) => {
      if (!(e.target instanceof Element) || !e.target.closest('button, a, input')) return;
      this.lastClick = performance.now();
      this.engine.play('click', 1, null, true);
    });
    hud.addEventListener('focusin', (e) => {
      if (!(e.target instanceof Element) || !e.target.closest('.menu')) return;
      const now = performance.now();
      if (now - this.lastPointer < CONFIG.audio.tickAfterPointer * 1000 || now - this.lastClick < 100) return;
      this.engine.play('tick', 1, null, true);
    });
  }

  setVolume(master: number, sfx: number, muted: boolean): void {
    this.engine.setVolume(master, sfx, muted);
  }

  /** The map being ridden, for its places (crowd, town, lifts); null for none. */
  setMap(built: BuiltMap | null): void {
    this.built = built;
    this.ambient?.setMap(built);
  }

  setWeather(w: WeatherId): void {
    this.weather = w;
    this.ambient?.setWeather(w);
  }

  /** One sim step, from `prev` to `s`. */
  step(prev: SkierState, s: SkierState, rails: readonly RailShape[]): void {
    if (this.engine.running) this.riding?.step(prev, s, rails);
  }

  /**
   * Each frame: whether the game waits (its sounds fade out), the game's
   * speed (Slow motion lowers every game sound's pitch), the skier, the
   * camera's right along (rx, rz) for panning, the wind's gust, and powder.
   */
  frame(waiting: boolean, pitch: number, s: SkierState, rails: readonly RailShape[], rx: number, rz: number, gust: number, powder: boolean): void {
    const e = this.engine;
    e.setWaiting(waiting || this.built === null);
    // Kept up while the game waits (its bus is silent then), so a weather picked from the pause menu is there on resume.
    if (!e.running || !this.riding || !this.ambient) return;
    e.pitch = pitch;
    this.riding.update(s, rails, powder, pitch);
    this.ambient.update(s.position.x, s.position.z, rx, rz, gust, pitch);
  }

  /** A combo ended: banked, banked as a new best, or lost. */
  combo(how: 'bank' | 'best' | 'lost'): void {
    this.engine.play(how, 1, null, true);
  }

  /** Dev: plays any one-shot. */
  play(id: ShotId, strength = 1): void {
    this.engine.play(id, strength);
  }

  /** Dev readout: the context's state and the gain each continuous sound is heading for. */
  voices(): Record<string, number | string> {
    return { state: this.engine.ctx?.state ?? 'none', pitch: this.engine.pitch, ...this.riding?.levels(), ...this.ambient?.levels() };
  }
}
