import { sampleShape, type ShapeSample } from './shapes.ts';
import { startFrames } from './startGates.ts';
import { hash2 } from './terrain.ts';
import type {
  Heightfield,
  LineDecor,
  MapDef,
  ObstacleDef,
  PropDecor,
  ScatterDecor,
  ScatterKind,
  XZ,
} from './types.ts';

// Decoration: map data expanded into placed things. Scatter sets become
// trees and rocks at jittered grid spots (deterministic, so every load looks
// the same), kept off features, rails and gates. Lower quality presets thin
// out scenery sets; solid sets are part of the course and are always kept,
// so a rider never hits something they can't see.

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
}

export interface DecorLayout {
  scatter: ScatterItem[];
  lines: LineDecor[];
  props: PropDecor[];
}

const sample: ShapeSample = { height: 0, dhdx: 0, dhdz: 0 };

/** Places a map's decoration at a density (0..1) for scenery. */
export function layoutDecor(map: MapDef, hf: Heightfield, density: number): DecorLayout {
  const keepOut = keepOutZones(map);
  const scatter: ScatterItem[] = [];
  const lines: LineDecor[] = [];
  const props: PropDecor[] = [];
  map.decor.forEach((d) => {
    if ('area' in d) scatterSet(d, d.solid ? 1 : density, hf, keepOut, scatter);
    else if ('heading' in d) props.push(d);
    else lines.push(d);
  });
  return { scatter, lines, props };
}

/** Spots (x, z, radius) decoration stays clear of: gates, flags, the finish line, rails and start gates. */
function keepOutZones(map: MapDef): number[] {
  const zones: number[] = [];
  const add = (x: number, z: number, r: number): void => {
    zones.push(x, z, r);
  };
  const lineOf = (x: number, z: number, heading: number, width: number, r: number): void => {
    const h = (heading * Math.PI) / 180;
    const n = Math.max(1, Math.ceil(width / r));
    for (let i = 0; i <= n; i++) {
      const v = -width / 2 + (width * i) / n;
      add(x + Math.cos(h) * v, z - Math.sin(h) * v, r);
    }
  };
  for (const f of map.flags) lineOf(f.x, f.z, f.heading, f.width, 4);
  lineOf(map.finish.x, map.finish.z, map.finish.heading, map.finish.width, 4);
  add(map.spawn.x, map.spawn.z, 6);
  for (const s of startFrames(map.features)) add(s.x, s.z, 9);
  for (const f of map.features) {
    if (f.type === 'rail' || f.type === 'box') {
      for (let i = 1; i < f.points.length; i++) {
        const a = f.points[i - 1]!;
        const b = f.points[i]!;
        const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 2));
        for (let k = 0; k <= n; k++) add(a.x + ((b.x - a.x) * k) / n, a.z + ((b.z - a.z) * k) / n, 3);
      }
    } else if (f.type === 'slalom') {
      for (const g of f.gates) lineOf(g.x, g.z, g.heading, g.width, 3);
    }
  }
  return zones;
}

/**
 * Scatters a set over its area: one spot per grid cell, jittered, with
 * `density` of the cells kept (by hash, so thinning keeps the same ones).
 */
function scatterSet(d: ScatterDecor, density: number, hf: Heightfield, keepOut: number[], out: ScatterItem[]): void {
  const { area } = d;
  const cell = Math.sqrt((area.width * area.length) / Math.max(1, d.count));
  const nx = Math.max(1, Math.round(area.width / cell));
  const nz = Math.max(1, Math.round(area.length / cell));
  const cw = area.width / nx;
  const cl = area.length / nz;
  const x0 = area.x - area.width / 2;
  const z0 = area.z - area.length / 2;
  const maxX = hf.originX + (hf.cols - 1) * hf.cellSize;
  const maxZ = hf.originZ + (hf.rows - 1) * hf.cellSize;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const r = (k: number): number => 0.5 + 0.5 * hash2(i * 7 + k, j * 13 + k * 3, d.seed);
      if (r(0) > density) continue;
      const x = x0 + (i + 0.1 + 0.8 * r(1)) * cw;
      const z = z0 + (j + 0.1 + 0.8 * r(2)) * cl;
      if (x < hf.originX || x > maxX || z < hf.originZ || z > maxZ) continue;
      if (!clear(x, z, hf, keepOut)) continue;
      out.push({
        kind: d.kind,
        x,
        z,
        yaw: r(3) * Math.PI * 2,
        scale: d.minScale + (d.maxScale - d.minScale) * r(4),
        tint: r(5),
        solid: d.solid,
      });
    }
  }
}

function clear(x: number, z: number, hf: Heightfield, keepOut: number[]): boolean {
  for (let i = 0; i < keepOut.length; i += 3) {
    const r = keepOut[i + 2] ?? 0;
    if (Math.hypot(x - (keepOut[i] ?? 0), z - (keepOut[i + 1] ?? 0)) < r) return false;
  }
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
