import { CONFIG } from '../config.ts';
import type { WeatherId } from '../core/weather.ts';
import type { BuiltMap } from '../maps/build.ts';
import { AudioEngine, Voice } from './engine.ts';
import type { LoopId } from './synth.ts';
import { smooth } from './riding.ts';

// The world's sounds round the skier: the weather (a low bed of wind and a
// howl that follows the snow effects' gusts), and places that sound and
// fade with distance: spectators (the `skier` props: Big air's crowd, which
// cheers a clean landing near it), Freeride's town (its buildings), and
// the chairlifts' hum, loudest at their stations. A place is heard from the
// skier and panned by the camera's right, and its voice exists only on a
// map that has the place.

/** A place's voice: its loop, low-passed (muffled with distance) and panned. */
type PlaceId = 'crowd' | 'town' | 'lift';

export class AmbientSounds {
  private readonly engine: AudioEngine;
  private readonly ctx: AudioContext;
  private readonly bed: Voice;
  private readonly howl: Voice;
  private weather: WeatherId = 'bluebird';
  private readonly voices: Record<PlaceId, Voice | null> = { crowd: null, town: null, lift: null };

  // The map's places, flattened for a quick look each frame.
  /** Spectators bunched into cells: middle and head count. */
  private crowdX = new Float32Array(0);
  private crowdZ = new Float32Array(0);
  private crowdN = new Float32Array(0);
  private townX = new Float32Array(0);
  private townZ = new Float32Array(0);
  /** Lift cables as segments (a to b), and the stations at their ends. */
  private liftAx = new Float32Array(0);
  private liftAz = new Float32Array(0);
  private liftBx = new Float32Array(0);
  private liftBz = new Float32Array(0);
  private stationX = new Float32Array(0);
  private stationZ = new Float32Array(0);

  constructor(engine: AudioEngine, ctx: AudioContext) {
    this.engine = engine;
    this.ctx = ctx;
    const n = engine.noise;
    this.bed = new Voice(ctx, n.get('brown')!, engine.game, 'lowpass', 400, 0.7);
    this.howl = new Voice(ctx, n.get('pink')!, engine.game, 'bandpass', 500, 2);
    engine.onLoop((id) => {
      if (id === 'crowd' || id === 'town' || id === 'lift') this.syncVoices();
    });
  }

  /** The map being ridden (null: none, all quiet). */
  setMap(built: BuiltMap | null): void {
    const people: { x: number; z: number }[] = [];
    const towns: { x: number; z: number }[] = [];
    const segs: number[] = [];
    const stations: number[] = [];
    if (built) {
      for (const p of built.decor.props) if (p.kind === 'skier') people.push(...p.points);
      for (const f of built.map.features) if (f.type === 'building') towns.push({ x: f.x, z: f.z });
      for (const line of built.decor.lines) {
        if (line.kind !== 'chairlift' || line.points.length < 2) continue;
        const pts = line.points;
        for (let i = 0; i + 1 < pts.length; i++) segs.push(pts[i]!.x, pts[i]!.z, pts[i + 1]!.x, pts[i + 1]!.z);
        stations.push(pts[0]!.x, pts[0]!.z, pts[pts.length - 1]!.x, pts[pts.length - 1]!.z);
      }
    }
    // Spectators in cells, so a long fence of them is a few points, not hundreds.
    const cell = CONFIG.audio.crowd.cell;
    const cells = new Map<string, { x: number; z: number; n: number }>();
    for (const p of people) {
      const key = `${Math.floor(p.x / cell)},${Math.floor(p.z / cell)}`;
      const c = cells.get(key) ?? { x: 0, z: 0, n: 0 };
      c.x += p.x;
      c.z += p.z;
      c.n++;
      cells.set(key, c);
    }
    const list = [...cells.values()];
    this.crowdX = Float32Array.from(list, (c) => c.x / c.n);
    this.crowdZ = Float32Array.from(list, (c) => c.z / c.n);
    this.crowdN = Float32Array.from(list, (c) => c.n);
    this.townX = Float32Array.from(towns, (t) => t.x);
    this.townZ = Float32Array.from(towns, (t) => t.z);
    const ns = segs.length / 4;
    this.liftAx = Float32Array.from({ length: ns }, (_, i) => segs[i * 4]!);
    this.liftAz = Float32Array.from({ length: ns }, (_, i) => segs[i * 4 + 1]!);
    this.liftBx = Float32Array.from({ length: ns }, (_, i) => segs[i * 4 + 2]!);
    this.liftBz = Float32Array.from({ length: ns }, (_, i) => segs[i * 4 + 3]!);
    this.stationX = Float32Array.from({ length: stations.length / 2 }, (_, i) => stations[i * 2]!);
    this.stationZ = Float32Array.from({ length: stations.length / 2 }, (_, i) => stations[i * 2 + 1]!);
    this.syncVoices();
  }

  setWeather(w: WeatherId): void {
    this.weather = w;
    const t = this.ctx.currentTime;
    this.howl.filter.Q.setTargetAtTime(CONFIG.audio.weather[w].q, t, CONFIG.audio.weatherFade / 3);
  }

  /**
   * Sets the ambience for a skier at (x, z) with the camera's right along
   * (rx, rz), the wind at `gust` (the snow effects' share of its mean), at
   * game speed `pitch`.
   */
  update(x: number, z: number, rx: number, rz: number, gust: number, pitch: number): void {
    const a = CONFIG.audio;
    const w = a.weather[this.weather];
    const g = gust - 1;
    const fade = a.weatherFade / 3;
    this.bed.set(w.bed, w.bedFreq, pitch, 0, fade);
    this.howl.set(w.howl * Math.max(0, 1 + w.gustGain * g), w.howlFreq * (1 + w.gustFreq * g), pitch, 0, fade);

    const pan = a.pan;
    // The crowd: louder the more spectators stand near, toward where most of them are.
    const crowd = this.voices.crowd;
    if (crowd) {
      const c = a.crowd;
      let heard = 0;
      let side = 0;
      let nearest = Infinity;
      for (let i = 0; i < this.crowdX.length; i++) {
        const dx = this.crowdX[i]! - x;
        const dz = this.crowdZ[i]! - z;
        const d = Math.hypot(dx, dz);
        nearest = Math.min(nearest, d);
        const k = this.crowdN[i]! * (1 - smooth(c.near, c.far, d));
        heard += k;
        if (d > 1) side += (k * (dx * rx + dz * rz)) / d;
      }
      const close = 1 - smooth(c.near, c.far, nearest);
      crowd.set(c.gain * Math.min(1, Math.sqrt(heard / c.full)), 1500 + 6500 * close, pitch, heard > 0 ? (pan * side) / heard : 0, 0.2);
    }
    // The town: by the nearest building.
    const town = this.voices.town;
    if (town) {
      const c = a.town;
      let best = Infinity;
      let side = 0;
      for (let i = 0; i < this.townX.length; i++) {
        const dx = this.townX[i]! - x;
        const dz = this.townZ[i]! - z;
        const d = Math.hypot(dx, dz);
        if (d < best) {
          best = d;
          side = d > 1 ? (dx * rx + dz * rz) / d : 0;
        }
      }
      const close = 1 - smooth(c.near, c.far, best);
      town.set(c.gain * close, 1500 + 6500 * close, pitch, pan * side, 0.2);
    }
    // The lifts: by the nearest cable, or louder by a station.
    const lift = this.voices.lift;
    if (lift) {
      const c = a.lift;
      let loud = 0;
      let side = 0;
      for (let i = 0; i < this.liftAx.length; i++) {
        const ax = this.liftAx[i]!;
        const az = this.liftAz[i]!;
        const ex = this.liftBx[i]! - ax;
        const ez = this.liftBz[i]! - az;
        const len2 = ex * ex + ez * ez;
        const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / len2)) : 0;
        const dx = ax + ex * t - x;
        const dz = az + ez * t - z;
        const d = Math.hypot(dx, dz);
        const k = 1 - smooth(c.near, c.far, d);
        if (k > loud) {
          loud = k;
          side = d > 1 ? (dx * rx + dz * rz) / d : 0;
        }
      }
      for (let i = 0; i < this.stationX.length; i++) {
        const dx = this.stationX[i]! - x;
        const dz = this.stationZ[i]! - z;
        const d = Math.hypot(dx, dz);
        const k = c.station * (1 - smooth(c.stationNear, c.stationFar, d));
        if (k > loud) {
          loud = k;
          side = d > 1 ? (dx * rx + dz * rz) / d : 0;
        }
      }
      lift.set(c.gain * loud, 900 + 3000 * Math.min(1, loud), pitch, pan * side, 0.2);
    }
  }

  /** A clean landing at (x, z): the crowd cheers if it came down near spectators. */
  cheer(x: number, z: number): void {
    const crowd = this.voices.crowd;
    if (!crowd) return;
    const a = CONFIG.audio;
    let nearest = Infinity;
    let count = 0;
    for (let i = 0; i < this.crowdX.length; i++) {
      const d = Math.hypot(this.crowdX[i]! - x, this.crowdZ[i]! - z);
      nearest = Math.min(nearest, d);
      if (d < a.cheer.range) count += this.crowdN[i]!;
    }
    if (nearest > a.cheer.range) return;
    const k = (1 - smooth(a.crowd.near, a.cheer.range, nearest)) * Math.min(1, 0.4 + count / a.crowd.full);
    // Into the crowd's pan, so the cheer comes from where they stand.
    this.engine.play('cheer', k, crowd.panner);
  }

  /** The gains the ambience is heading for (dev readout). */
  levels(): Record<string, number> {
    return {
      weatherBed: this.bed.level,
      weatherHowl: this.howl.level,
      crowd: this.voices.crowd?.level ?? 0,
      town: this.voices.town?.level ?? 0,
      lift: this.voices.lift?.level ?? 0,
    };
  }

  /** Makes the voices this map's places need (once their loops are made) and drops the rest. */
  private syncVoices(): void {
    const want: Record<PlaceId, boolean> = { crowd: this.crowdX.length > 0, town: this.townX.length > 0, lift: this.liftAx.length > 0 };
    for (const id of ['crowd', 'town', 'lift'] as const) {
      const loop = this.engine.loops.get(id as LoopId);
      if (want[id] && loop && !this.voices[id]) {
        this.voices[id] = new Voice(this.ctx, loop, this.engine.game, 'lowpass', 2000, 0.7, true);
      } else if (!want[id] && this.voices[id]) {
        this.voices[id]!.stop();
        this.voices[id] = null;
      }
    }
  }
}
