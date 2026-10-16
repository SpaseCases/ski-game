import { insideBounds } from '../sim/bounds.ts';
import { fbm } from './peak.ts';
import { sampleShape, type ShapeSample } from './shapes.ts';
import { startFrames } from './startGates.ts';
import { hash2, smoothstep } from './terrain.ts';
import type {
  Heightfield,
  LineDecor,
  MapDef,
  ObstacleDef,
  PropDecor,
  Ramp4,
  ScatterDecor,
  ScatterKind,
  TerrainScatterDecor,
  XZ,
} from './types.ts';

// Decoration: map data expanded into placed things. Scatter sets become
// trees and rocks at jittered grid spots (deterministic, so every load looks
// the same), kept off features, rails, gates and runs. Area sets fill a
// rectangle; terrain sets cover the whole map and keep the spots whose
// height and steepness suit them. Lower quality presets thin out scenery;
// solid things are part of the course and are always kept, so a rider
// never hits something they can't see.

/** Sizes shared by the models and their obstacles (m). */
export const DECOR_SIZE = {
  fenceHeight: 1.1,
  nettingHeight: 2.4,
  barrierHeight: 1.1,
  lightPoleHeight: 8,
  floodlightHeight: 12,
  bannerWidth: 4,
  bannerHeight: 2.6,
  flagHeight: 4.5,
  groomerLength: 6,
  groomerWidth: 3.2,
  chairliftSpacing: 55,
  chairliftHeight: 10,
};

/** Per scatter kind: obstacle radius and height at scale 1. */
const SCATTER_SOLID: Record<ScatterKind, { radius: number; height: number }> = {
  pine: { radius: 0.5, height: 7 },
  snag: { radius: 0.25, height: 6 },
  rock: { radius: 0.6, height: 0.8 },
  boulder: { radius: 1.3, height: 2 },
};

/** Size (m) of the cells that sort keep-out spots, so checking a spot looks at only the few nearby. */
const KEEP_OUT_CELL = 32;

export interface ScatterItem {
  kind: ScatterKind;
  x: number;
  z: number;
  /** Radians. */
  yaw: number;
  scale: number;
  /** 0..1, for color variation. */
  tint: number;
  solid: boolean;
  /** 0..1: scenery is drawn when this is under the density. */
  rank: number;
}

export interface DecorLayout {
  scatter: ScatterItem[];
  lines: LineDecor[];
  props: PropDecor[];
}

const sample: ShapeSample = { height: 0, dhdx: 0, dhdz: 0 };

/** Places all of a map's decoration (full density; see thinDecor). */
export function layoutDecor(map: MapDef, hf: Heightfield): DecorLayout {
  const keepOut = keepOutZones(map);
  const scatter: ScatterItem[] = [];
  const lines: LineDecor[] = [];
  const props: PropDecor[] = [];
  map.decor.forEach((d) => {
    if ('spacing' in d) terrainSet(d, hf, keepOut, scatter);
    else if ('area' in d) scatterSet(d, hf, keepOut, scatter);
    else if ('heading' in d) props.push(d);
    else lines.push(d);
  });
  return { scatter, lines, props };
}

/** The layout with scenery thinned to `density` (0..1); solid things all stay. */
export function thinDecor(layout: DecorLayout, density: number): DecorLayout {
  return { ...layout, scatter: layout.scatter.filter((t) => t.solid || t.rank <= density) };
}

/** Spots decoration stays clear of, sorted into cells. */
class KeepOut {
  private readonly cells = new Map<number, number[]>();

  /** Keeps a circle of radius r around (x, z) clear. */
  add(x: number, z: number, r: number): void {
    for (let i = Math.floor((x - r) / KEEP_OUT_CELL); i <= Math.floor((x + r) / KEEP_OUT_CELL); i++) {
      for (let j = Math.floor((z - r) / KEEP_OUT_CELL); j <= Math.floor((z + r) / KEEP_OUT_CELL); j++) {
        const key = cellKey(i, j);
        const list = this.cells.get(key);
        if (list) list.push(x, z, r);
        else this.cells.set(key, [x, z, r]);
      }
    }
  }

  /** Circles every `spacing` meters along a polyline. */
  addLine(points: readonly XZ[], r: number, spacing: number): void {
    for (const p of alongLine(points, spacing)) this.add(p.x, p.z, r);
  }

  clear(x: number, z: number): boolean {
    const list = this.cells.get(cellKey(Math.floor(x / KEEP_OUT_CELL), Math.floor(z / KEEP_OUT_CELL)));
    if (!list) return true;
    for (let i = 0; i < list.length; i += 3) {
      if ((x - list[i]!) ** 2 + (z - list[i + 1]!) ** 2 < list[i + 2]! ** 2) return false;
    }
    return true;
  }
}

function cellKey(i: number, j: number): number {
  return (i + 32768) * 65536 + (j + 32768);
}

/** Gates, flags, finish zones, the spawn, start gates, rails, slalom gates and runs. */
function keepOutZones(map: MapDef): KeepOut {
  const zones = new KeepOut();
  const lineOf = (x: number, z: number, heading: number, width: number, r: number): void => {
    const h = (heading * Math.PI) / 180;
    zones.addLine(
      [
        { x: x - (Math.cos(h) * width) / 2, z: z + (Math.sin(h) * width) / 2 },
        { x: x + (Math.cos(h) * width) / 2, z: z - (Math.sin(h) * width) / 2 },
      ],
      r,
      r,
    );
  };
  for (const f of map.flags) lineOf(f.x, f.z, f.heading, f.width, 4);
  // Finish zones are run-outs: all clear.
  for (const f of map.finishes) {
    const h = (f.heading * Math.PI) / 180;
    for (let along = 0; along <= f.length; along += 6) lineOf(f.x - Math.sin(h) * along, f.z - Math.cos(h) * along, f.heading, f.width, 4);
  }
  zones.add(map.spawn.x, map.spawn.z, 6);
  for (const s of startFrames(map.features)) zones.add(s.x, s.z, 9);
  for (const f of map.features) {
    if (f.type === 'rail' || f.type === 'box') zones.addLine(f.points, 3, 2);
    else if (f.type === 'slalom') for (const g of f.gates) lineOf(g.x, g.z, g.heading, g.width, 3);
  }
  for (const run of map.runs) if (run.clear > 0) zones.addLine(run.points, run.clear, Math.max(1, run.clear / 2));
  return zones;
}

/** Scatters an area set: one spot per grid cell, jittered. Lower presets keep the ones ranked under their density. */
function scatterSet(d: ScatterDecor, hf: Heightfield, keepOut: KeepOut, out: ScatterItem[]): void {
  const { area } = d;
  const cell = Math.sqrt((area.width * area.length) / Math.max(1, d.count));
  const nx = Math.max(1, Math.round(area.width / cell));
  const nz = Math.max(1, Math.round(area.length / cell));
  const cw = area.width / nx;
  const cl = area.length / nz;
  const x0 = area.x - area.width / 2;
  const z0 = area.z - area.length / 2;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const r = (k: number): number => 0.5 + 0.5 * hash2(i * 7 + k, j * 13 + k * 3, d.seed);
      const x = x0 + (i + 0.1 + 0.8 * r(1)) * cw;
      const z = z0 + (j + 0.1 + 0.8 * r(2)) * cl;
      if (!onMap(hf, x, z) || !clear(x, z, hf, keepOut)) continue;
      out.push({
        kind: d.kind,
        x,
        z,
        yaw: r(3) * Math.PI * 2,
        scale: d.minScale + (d.maxScale - d.minScale) * r(4),
        tint: r(5),
        solid: d.solid,
        rank: r(0),
      });
    }
  }
}

/**
 * Places a terrain set: a candidate spot per `spacing` over the whole map,
 * kept with a chance that follows how well its height, steepness and stand
 * suit it, so trees thin out toward the treeline and the edges of clearings.
 */
function terrainSet(d: TerrainScatterDecor, hf: Heightfield, keepOut: KeepOut, out: ScatterItem[]): void {
  const width = (hf.cols - 1) * hf.cellSize;
  const length = (hf.rows - 1) * hf.cellSize;
  const nx = Math.max(1, Math.round(width / d.spacing));
  const nz = Math.max(1, Math.round(length / d.spacing));
  const cw = width / nx;
  const cl = length / nz;
  // Stands: noise over the ground, kept where it's above a level that leaves about `clear` of it open.
  const level = (d.clumps.clear - 0.5) * 0.7;
  const at = { h: 0, slope: 0 };
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const r = (k: number): number => 0.5 + 0.5 * hash2(i * 7 + k, j * 13 + k * 3, d.seed);
      const x = hf.originX + (i + 0.1 + 0.8 * r(1)) * cw;
      const z = hf.originZ + (j + 0.1 + 0.8 * r(2)) * cl;
      gridSample(hf, x, z, at);
      let w = ramp(d.height, at.h) * ramp(d.slope, at.slope);
      if (w <= 0) continue;
      if (d.clumps.clear > 0) w *= smoothstep(level - 0.08, level + 0.08, fbm(x / d.clumps.size, z / d.clumps.size, d.seed + 7));
      if (r(0) >= w || !clear(x, z, hf, keepOut)) continue;
      out.push({
        kind: d.kind,
        x,
        z,
        yaw: r(3) * Math.PI * 2,
        scale: d.minScale + (d.maxScale - d.minScale) * r(4),
        tint: r(5),
        solid: d.solid && insideBounds(hf.bounds, x, z),
        rank: r(6),
      });
    }
  }
}

/** 0 below a, rising to 1 at b, 1 to c, falling to 0 at d. */
function ramp(r: Ramp4, v: number): number {
  if (v < r[1]) return v <= r[0] ? 0 : smoothstep(r[0], r[1], v);
  if (v > r[2]) return v >= r[3] ? 0 : 1 - smoothstep(r[2], r[3], v);
  return 1;
}

/** Height and steepness (degrees) of the grid at the sample nearest (x, z): quick, for placing things. */
function gridSample(hf: Heightfield, x: number, z: number, out: { h: number; slope: number }): void {
  const col = Math.min(hf.cols - 2, Math.max(1, Math.round((x - hf.originX) / hf.cellSize)));
  const row = Math.min(hf.rows - 2, Math.max(1, Math.round((z - hf.originZ) / hf.cellSize)));
  const i = row * hf.cols + col;
  const h = hf.heights;
  const c2 = 2 * hf.cellSize;
  out.h = h[i]!;
  out.slope = (Math.atan(Math.hypot((h[i + 1]! - h[i - 1]!) / c2, (h[i + hf.cols]! - h[i - hf.cols]!) / c2)) * 180) / Math.PI;
}

function onMap(hf: Heightfield, x: number, z: number): boolean {
  return x >= hf.originX && x <= hf.originX + (hf.cols - 1) * hf.cellSize && z >= hf.originZ && z <= hf.originZ + (hf.rows - 1) * hf.cellSize;
}

function clear(x: number, z: number, hf: Heightfield, keepOut: KeepOut): boolean {
  if (!keepOut.clear(x, z)) return false;
  for (const s of hf.shapes ?? []) {
    if (sampleShape(s, x, z, sample) && sample.height > 0.02) return false;
  }
  return true;
}

/** Evenly spaced spots along a polyline, `spacing` apart, including both ends. */
export function alongLine(points: readonly XZ[], spacing: number): XZ[] {
  const out: XZ[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.z - a.z) / spacing));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  }
  return out;
}

/** The solid parts of the decoration, for the simulation. */
export function decorObstacles(layout: DecorLayout): ObstacleDef[] {
  const out: ObstacleDef[] = [];
  const S = DECOR_SIZE;
  const post = (p: XZ, radius: number, height: number): void => {
    out.push({ ax: p.x, az: p.z, bx: p.x, bz: p.z, radius, height });
  };
  for (const t of layout.scatter) {
    if (!t.solid) continue;
    const solid = SCATTER_SOLID[t.kind];
    post(t, solid.radius * t.scale, solid.height * t.scale);
  }
  for (const l of layout.lines) {
    const height = l.kind === 'fence' ? S.fenceHeight : l.kind === 'netting' ? S.nettingHeight : l.kind === 'barrier' ? S.barrierHeight : 0;
    if (height > 0) {
      for (let i = 1; i < l.points.length; i++) {
        const a = l.points[i - 1]!;
        const b = l.points[i]!;
        out.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, radius: 0.08, height });
      }
    } else if (l.kind === 'chairlift') {
      for (const p of alongLine(l.points, S.chairliftSpacing)) post(p, 0.4, S.chairliftHeight);
    }
  }
  for (const p of layout.props) {
    const h = (p.heading * Math.PI) / 180;
    const rx = Math.cos(h);
    const rz = -Math.sin(h);
    for (const at of p.points) {
      if (p.kind === 'lightPole') post(at, 0.15, S.lightPoleHeight);
      else if (p.kind === 'floodlight') post(at, 0.45, S.floodlightHeight);
      else if (p.kind === 'flag') post(at, 0.06, S.flagHeight);
      else if (p.kind === 'banner') {
        for (const side of [-1, 1]) post({ x: at.x + rx * side * (S.bannerWidth / 2), z: at.z + rz * side * (S.bannerWidth / 2) }, 0.08, S.bannerHeight);
      } else if (p.kind === 'groomer') {
        const dx = -Math.sin(h) * (S.groomerLength / 2 - S.groomerWidth / 2);
        const dz = -Math.cos(h) * (S.groomerLength / 2 - S.groomerWidth / 2);
        out.push({ ax: at.x - dx, az: at.z - dz, bx: at.x + dx, bz: at.z + dz, radius: S.groomerWidth / 2, height: 3 });
      }
    }
  }
  return out;
}
