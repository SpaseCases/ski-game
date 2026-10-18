import { terrainHeightAt } from '../sim/terrain.ts';
import { makeRamp, ProfileBuilder, SURFACE } from './shapes.ts';
import type { BuildingFeature, Feature, Heightfield, ObstacleDef, RailFeature, RampShape, TerraceFeature } from './types.ts';

// The ski town's buildings and terraces, for the simulation. A building is
// a roof you can ride (a ramp built on the snow, with sheer sides), a snow
// drift up its uphill wall to get on, a landing drift below it if it has
// one, and solid walls. A terrace is a raised plaza with a wall drop on
// every side, stairs down its front and handrails beside them. The renderer
// draws the walls, windows and steps from the same numbers (render/town.ts).

const DEG = Math.PI / 180;
/** Width (m) over which a roof's or terrace's edge drops to the snow: next to sheer. */
export const EDGE = 0.25;
/** How far (m) the walls stand in from the roof's edge (the eaves overhang them). */
export const WALL_INSET = 0.35;
/** A wall's top sits this far (m) under the roof edge, so a rider on the roof passes over it. */
const WALL_CLEAR = 0.12;
/** Longest piece (m) of a wall as an obstacle, so its top can follow a sloping roof. */
const WALL_PIECE = 2;
/**
 * Half the width (m) of a gable roof's rounded ridge: slow riders roll over
 * it (it bends too gently to throw them below about 7 m/s), faster ones
 * leave it as off a kicker.
 */
const RIDGE_ROUND = 2;
/** Steepness (degrees, against the roof) of a roof's lip at the downhill eave. */
const LIP_ANGLE = 22;
/** Handrails: height (m) above the steps, and how far they run on past the top and bottom. */
export const HANDRAIL = { height: 0.9, inset: 0.3, top: 2.5, bottom: 2 };

/** A building's or terrace's frame: the middle of its back edge, its direction along `yaw`, and its right. */
export interface TownFrame {
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  rightX: number;
  rightZ: number;
}

export function townFrame(f: { x: number; z: number; yaw: number }): TownFrame {
  const a = f.yaw * DEG;
  return { x: f.x, z: f.z, dirX: -Math.sin(a), dirZ: -Math.cos(a), rightX: Math.cos(a), rightZ: -Math.sin(a) };
}

/** World XZ of the spot `u` along a frame and `v` to its right. */
export function framePoint(t: TownFrame, u: number, v: number): { x: number; z: number } {
  return { x: t.x + t.dirX * u + t.rightX * v, z: t.z + t.dirZ * u + t.rightZ * v };
}

/** Height of the uphill eave above the snow. */
export function eaveUp(b: BuildingFeature): number {
  return b.roof === 'shed' ? b.eave + b.rise : b.eave;
}

/** Half the width (m) of a gable's rounded ridge, at most a third of the way down each side. */
function ridgeRound(b: BuildingFeature): number {
  return Math.min(RIDGE_ROUND, b.length / 6);
}

/** Slope (rise per m along the building) of the roof as it leaves the uphill eave. */
function roofSlope(b: BuildingFeature): number {
  if (b.roof === 'gable') return b.rise / (b.length / 2 - ridgeRound(b) / 2);
  if (b.roof === 'shed') return -b.rise / b.length;
  return 0;
}

/** Length (m) of the lip along the downhill end of a roof. */
export function lipLength(b: BuildingFeature): number {
  return b.lip > 0 ? (2 * b.lip) / Math.tan(LIP_ANGLE * DEG) : 0;
}

/** Height of the roof above the snow at `u` m along the building (0 at the uphill eave, `length` at the downhill one), lip included. */
export function roofHeight(b: BuildingFeature, u: number): number {
  const t = Math.min(1, Math.max(0, u / b.length));
  if (b.roof === 'gable') {
    // Straight up each side, rounded over the ridge (a parabola across its middle 2R).
    const s = roofSlope(b);
    const R = ridgeRound(b);
    const d = Math.abs(Math.min(b.length, Math.max(0, u)) - b.length / 2);
    if (d >= R) return b.eave + s * (b.length / 2 - d);
    return b.eave + b.rise - (s * d * d) / (2 * R);
  }
  const base = b.roof === 'shed' ? b.eave + b.rise * (1 - t) : b.eave;
  const k = lipLength(b);
  if (k <= 0 || u < b.length - k) return base;
  const s = (Math.min(u, b.length) - (b.length - k)) / k;
  return base + b.lip * s * s;
}

/**
 * Where a building's chimney stands: `u` along it and `v` across (just
 * down from a gable's ridge, toward one end), and its foot and top above
 * the snow.
 */
export function chimneySpot(b: BuildingFeature): { u: number; v: number; foot: number; top: number } {
  const u = b.roof === 'gable' ? b.length / 2 + 1.2 : b.length * 0.35;
  const v = b.width / 2 - 2;
  const peak = b.roof === 'gable' ? b.eave + b.rise : roofHeight(b, 0);
  return { u, v, foot: roofHeight(b, u) - 0.4, top: peak + 1.2 };
}

/** How far (m) a terrace's stairs reach out past its front edge. */
export function stairRun(t: TerraceFeature): number {
  return t.height / Math.tan(t.stairAngle * DEG);
}

/** The roofs, drifts, terraces and stairs, as ramps on the snow. */
export function townShapes(features: readonly Feature[]): RampShape[] {
  const out: RampShape[] = [];
  for (const f of features) {
    if (f.type === 'building') buildingShapes(f, out);
    else if (f.type === 'terrace') terraceShapes(f, out);
  }
  return out;
}

function buildingShapes(b: BuildingFeature, out: RampShape[]): void {
  const t = townFrame(b);
  const s1 = roofSlope(b);
  const up = eaveUp(b);
  // The roof: a sheer rise at the uphill wall, the roof itself, a sheer drop at the downhill wall.
  const roof = new ProfileBuilder().to(EDGE, up, 0, s1);
  const k = lipLength(b);
  if (b.roof === 'gable') {
    // Up the near side, round over the ridge, down the far side.
    const R = ridgeRound(b);
    const shoulder = b.eave + s1 * (b.length / 2 - R);
    roof.to(b.length / 2 - R, shoulder, s1, s1).to(2 * R, shoulder, -s1, -s1).to(b.length / 2 - R, b.eave, -s1, 0);
  } else if (k > 0) {
    // A lip of snow kicking up off the downhill eave: a parabola from the roof's slope.
    const m = s1 + Math.tan(LIP_ANGLE * DEG);
    roof.to(b.length - k, up + s1 * (b.length - k), s1, s1).to(k, b.eave + b.lip, m, 0);
  } else {
    roof.to(b.length, b.eave, s1, 0);
  }
  roof.ease(EDGE, 0);
  const o = framePoint(t, -EDGE, 0);
  out.push(makeRamp(o.x, o.z, b.yaw, b.width, EDGE, roof, false));

  // A drift up to the uphill eave, arriving at the roof's own slope (level onto a shed roof), with soft sides.
  const side = Math.max(2, up * 0.6);
  if (b.drift > 0) {
    const p = new ProfileBuilder();
    const arrive = Math.max(0, s1);
    p.to(b.drift, up, arrive, arrive).ease(EDGE, 0);
    const d = framePoint(t, -b.drift, 0);
    out.push(makeRamp(d.x, d.z, b.yaw, b.width, side, p));
  }
  // A landing drift down from the downhill eave, leaving it at the roof's slope.
  if (b.apron > 0) {
    const leave = b.roof === 'gable' ? -s1 : s1;
    const p = new ProfileBuilder().to(EDGE, b.eave, 0, leave).to(b.apron, 0, 0, 0);
    const a = framePoint(t, b.length - EDGE, 0);
    out.push(makeRamp(a.x, a.z, b.yaw, b.width, Math.max(2, b.eave * 0.6), p));
  }
}

function terraceShapes(f: TerraceFeature, out: RampShape[]): void {
  const t = townFrame(f);
  // The top rises steadily from the snow at the back to `height` at the front (level on a slope that falls that fast).
  const m = f.height / f.length;
  const top = new ProfileBuilder();
  top.mOut[0] = m;
  top.to(f.length, f.height, m, m).ease(EDGE, 0);
  out.push(makeRamp(f.x, f.z, f.yaw, f.width, EDGE, top, false));
  if (f.stairs > 0) {
    // Stairs: from the front edge straight down at their angle, with a rounded foot. Drawn as steps by the renderer.
    const s = Math.tan(f.stairAngle * DEG);
    const foot = 0.05;
    const p = new ProfileBuilder()
      .to(0.6, f.height, 0, -s)
      .to((f.height - foot) / s, foot, -s, -s, SURFACE.hidden)
      .to(0.3, 0, 0, 0, SURFACE.hidden);
    const o = framePoint(t, f.length - 0.6, 0);
    out.push(makeRamp(o.x, o.z, f.yaw, f.stairs, 0.12, p, false));
  }
}

/** Handrails down both sides of each terrace's stairs: flat on the terrace, down the steps, flat on the snow below. */
export function townRails(features: readonly Feature[]): RailFeature[] {
  const out: RailFeature[] = [];
  for (const f of features) {
    if (f.type !== 'terrace' || f.stairs <= 0 || !f.handrails) continue;
    const t = townFrame(f);
    const run = stairRun(f);
    for (const side of [-1, 1]) {
      const v = side * (f.stairs / 2 - HANDRAIL.inset);
      const at = (u: number): { x: number; z: number; height: number } => ({ ...framePoint(t, u, v), height: HANDRAIL.height });
      out.push({
        type: 'rail',
        style: 'handrail',
        radius: 0,
        follow: 0,
        points: [at(f.length - HANDRAIL.top), at(f.length), at(f.length + run), at(f.length + run + HANDRAIL.bottom)],
      });
    }
  }
  return out;
}

/** The solid walls: under each roof's edges (not where a drift covers one), and each terrace's sides and front. */
export function townObstacles(features: readonly Feature[], hf: Heightfield): ObstacleDef[] {
  const out: ObstacleDef[] = [];
  /** A wall from (u0, v0) to (u1, v1) in frame t, standing to `height(u)` above the snow, in pieces. */
  const wall = (t: TownFrame, u0: number, v0: number, u1: number, v1: number, height: (u: number) => number, radius = 0.1): void => {
    const len = Math.hypot(u1 - u0, v1 - v0);
    const n = Math.max(1, Math.ceil(len / WALL_PIECE));
    for (let k = 0; k < n; k++) {
      const ua = u0 + ((u1 - u0) * k) / n;
      const ub = u0 + ((u1 - u0) * (k + 1)) / n;
      const a = framePoint(t, ua, v0 + ((v1 - v0) * k) / n);
      const b = framePoint(t, ub, v0 + ((v1 - v0) * (k + 1)) / n);
      const ga = terrainHeightAt(hf, a.x, a.z);
      const gb = terrainHeightAt(hf, b.x, b.z);
      const top = Math.min(ga + height(ua), gb + height(ub)) - WALL_CLEAR;
      if (top - Math.max(ga, gb) < 0.35) continue; // low enough to step over
      out.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, radius, height: 0, y0: Math.min(ga, gb) - 0.5, y1: top });
    }
  };
  for (const f of features) {
    if (f.type === 'building') {
      const t = townFrame(f);
      const v = f.width / 2 + EDGE;
      const h = (u: number): number => roofHeight(f, u);
      for (const side of [-1, 1]) wall(t, 0, side * v, f.length, side * v, h);
      if (f.drift <= 0) wall(t, -EDGE, -v, -EDGE, v, () => eaveUp(f));
      if (f.apron <= 0) wall(t, f.length + EDGE, -v, f.length + EDGE, v, () => f.eave);
      if (f.chimney) {
        const c = chimneySpot(f);
        const p = framePoint(t, c.u, c.v);
        const g = terrainHeightAt(hf, p.x, p.z);
        out.push({ ax: p.x, az: p.z, bx: p.x, bz: p.z, radius: 0.45, height: 0, y0: g + c.foot, y1: g + c.top });
      }
    } else if (f.type === 'terrace') {
      const t = townFrame(f);
      const v = f.width / 2 + EDGE;
      const h = (u: number): number => (f.height * Math.max(0, u)) / f.length;
      for (const side of [-1, 1]) wall(t, 0, side * v, f.length, side * v, h);
      const u = f.length + EDGE;
      if (f.stairs > 0) {
        const gap = f.stairs / 2 + 0.35;
        wall(t, u, -v, u, -gap, () => f.height);
        wall(t, u, gap, u, v, () => f.height);
      } else {
        wall(t, u, -v, u, v, () => f.height);
      }
    }
  }
  return out;
}
