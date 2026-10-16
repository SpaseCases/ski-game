import type { GeneratedTerrainDef, Heightfield, PitchSection, RollersDef, TerrainLane } from './types.ts';

/** How steeply (rise per meter) the scenery hillsides climb past the berms, and the slope above the top. */
const HILLSIDE_RISE = 0.45;
const TOP_RISE = 0.25;
/** Distance (m) the slope above the top takes to curve up. */
const TOP_EASE = 12;
/** Integration step (m) down the fall line. */
const STEP = 0.25;
const DEG = Math.PI / 180;

/**
 * Builds a heightfield for a slope: down the middle, either a straight slope
 * (flat at the top, a steady pitch, a runout that flattens and rises gently)
 * or a profile of sections at different pitches. Lanes then carve bands with
 * their own fall line into it, rollers add waves, and raised berms run along
 * both sides. Past the play area, scenery: hillsides climb away beyond the
 * berms and the slope carries on above and below. Random facet jitter goes
 * in `detail` (visual only).
 * Row 0 is the lowest z (the bottom); the last row is the highest (the top).
 */
export function generateSlope(def: GeneratedTerrainDef): Heightfield {
  const m = def.margin;
  const cols = Math.round((def.width + 2 * m) / def.cellSize) + 1;
  const rows = Math.round((def.length + 2 * m) / def.cellSize) + 1;
  const originX = -((cols - 1) * def.cellSize) / 2;
  const originZ = m - (rows - 1) * def.cellSize;
  const heights = new Float32Array(cols * rows);
  const detail = new Float32Array(cols * rows);
  const distanceDown = (row: number): number => -(originZ + row * def.cellSize);

  // Integrate the slope's gradient from the top down, one row at a time,
  // starting at height 0 on the top edge of the play area.
  const grade = baseGrade(def);
  const sub = Math.max(1, Math.ceil(def.cellSize / STEP));
  const drop = (g: (d: number) => number, d0: number, d1: number): number => {
    const h = (d1 - d0) / sub;
    let sum = 0;
    for (let k = 0; k < sub; k++) sum += g(d0 + (k + 0.5) * h);
    return sum * h;
  };
  const centerline = new Float32Array(rows);
  const topRow = Math.round((0 - originZ) / def.cellSize);
  let h = 0;
  for (let row = topRow; row >= 0; row--) {
    centerline[row] = h;
    h -= drop(grade, distanceDown(row), distanceDown(row - 1));
  }
  h = 0;
  for (let row = topRow; row < rows; row++) {
    centerline[row] = h;
    h += drop(grade, distanceDown(row + 1), distanceDown(row));
  }

  // Each lane's height above (or below) the slope beside it, row by row from the top.
  const lanes = solveLanes(def);
  const offsets = lanes.map((lane) => {
    const g = laneGrade(lane, grade);
    const diff = (d: number): number => g(d) - grade(d);
    const out = new Float32Array(rows);
    let o = 0;
    for (let row = rows - 1; row >= 0; row--) {
      out[row] = o;
      if (row > 0) o -= drop(diff, distanceDown(row), distanceDown(row - 1));
    }
    return out;
  });

  const rollers = new Float32Array(rows);
  for (let row = 0; row < rows; row++) {
    if (def.rollers) rollers[row] = rollerOffset(def.rollers, distanceDown(row));
  }

  const halfWidth = def.width / 2;
  for (let row = 0; row < rows; row++) {
    const base = centerline[row] ?? 0;
    const roll = rollers[row] ?? 0;
    for (let col = 0; col < cols; col++) {
      const x = originX + col * def.cellSize;
      const ax = Math.abs(x);
      const berm = smoothstep(halfWidth - def.bermWidth, halfWidth, ax);
      const out = Math.max(0, ax - halfWidth);
      const hill = HILLSIDE_RISE * out * smoothstep(0, 12, out);
      let lane = 0;
      for (let k = 0; k < lanes.length; k++) lane += laneWeight(lanes[k]!, x) * (offsets[k]![row] ?? 0);
      const i = row * cols + col;
      heights[i] = base + lane + roll * (1 - berm) + berm * berm * def.bermHeight + hill;
      detail[i] = hash2(col, row, def.seed) * def.noise * (0.15 + berm);
    }
  }

  return {
    cols,
    rows,
    cellSize: def.cellSize,
    originX,
    originZ,
    heights,
    detail,
    bounds: { minX: -halfWidth, maxX: halfWidth, minZ: -def.length, maxZ: 0, polygon: new Float32Array(0) },
  };
}

/** Gradient (drop per meter, downhill positive) of the middle of the slope at distance d down from the top. */
function baseGrade(def: GeneratedTerrainDef): (d: number) => number {
  const profile = def.profile;
  if (profile) {
    const top = Math.tan((profile[0]?.pitch ?? 0) * DEG);
    return (d) => {
      if (d < 0) return top + (-TOP_RISE - top) * smoothstep(0, -TOP_EASE, d);
      return Math.tan(sectionPitch(profile, 0, d, profile[0]?.pitch ?? 0) * DEG);
    };
  }
  const pitch = Math.tan(def.slopeDeg * DEG);
  return (d) => {
    if (d < 0) return -TOP_RISE * smoothstep(0, -TOP_EASE, d);
    const start = smoothstep(def.flatTop - TOP_EASE, def.flatTop + TOP_EASE, d);
    const runout = smoothstep(def.length - def.runout - TOP_EASE, def.length - TOP_EASE, d);
    return pitch * start * (1 - 1.6 * runout);
  };
}

/**
 * Pitch (degrees) at distance d along sections that start at `start`: it
 * begins at `before` and eases into each section's pitch in turn. Sections
 * must have their pitch set.
 */
export function sectionPitch(sections: readonly PitchSection[], start: number, d: number, before: number): number {
  let p = before;
  let at = start;
  for (const s of sections) {
    if (d < at - s.ease / 2) break;
    p += ((s.pitch ?? 0) - p) * smoothstep(at - s.ease / 2, at + s.ease / 2, d);
    at += s.length;
  }
  return p;
}

/** Where a lane's sections end (before it eases back to the slope beside it). */
function laneEnd(lane: TerrainLane): number {
  return lane.sections.reduce((at, s) => at + s.length, lane.start);
}

/** Gradient of a lane's own fall line: the slope's, easing into the lane's sections and back out at the end. */
function laneGrade(lane: TerrainLane, base: (d: number) => number): (d: number) => number {
  const end = laneEnd(lane);
  return (d) => {
    const outside = Math.atan(base(d)) / DEG;
    let p = sectionPitch(lane.sections, lane.start, d, outside);
    p += (outside - p) * smoothstep(end - lane.endEase / 2, end + lane.endEase / 2, d);
    return Math.tan(p * DEG);
  };
}

/**
 * The map's lanes with every pitch filled in: a last section without one
 * gets the pitch that brings the lane back level with the slope beside it.
 */
export function solveLanes(def: GeneratedTerrainDef): TerrainLane[] {
  const base = baseGrade(def);
  return (def.lanes ?? []).map((lane, index) => {
    const last = lane.sections[lane.sections.length - 1];
    if (!last || last.pitch !== undefined) return lane;
    const from = lane.start - (lane.sections[0]?.ease ?? 0) / 2;
    const to = laneEnd(lane) + lane.endEase / 2;
    const offsetAtEnd = (pitch: number): number => {
      const trial: TerrainLane = { ...lane, sections: [...lane.sections.slice(0, -1), { ...last, pitch }] };
      const g = laneGrade(trial, base);
      let o = 0;
      for (let d = from; d < to; d += STEP) o -= (g(d + STEP / 2) - base(d + STEP / 2)) * STEP;
      return o;
    };
    // Steeper is lower, so the offset falls as the pitch rises: bisect.
    let lo = -40;
    let hi = 60;
    if (offsetAtEnd(lo) < 0 || offsetAtEnd(hi) > 0) {
      throw new Error(`Map: terrain.lanes[${index}] can't get back level with the slope; make its last section longer`);
    }
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (offsetAtEnd(mid) > 0) lo = mid;
      else hi = mid;
    }
    return { ...lane, sections: [...lane.sections.slice(0, -1), { ...last, pitch: (lo + hi) / 2 }] };
  });
}

/** How much of a lane's height applies at x: all of it across its width, easing to none over its banks. */
function laneWeight(lane: TerrainLane, x: number): number {
  const a = Math.abs(x - lane.x) - lane.width / 2;
  return a <= 0 ? 1 : 1 - smoothstep(0, lane.blend, a);
}

/** Sine rollers that fade in and out over half a spacing at each end. */
function rollerOffset(r: RollersDef, d: number): number {
  if (d <= r.start || d >= r.end) return 0;
  const half = r.spacing / 2;
  const fade = smoothstep(r.start, r.start + half, d) * (1 - smoothstep(r.end - half, r.end, d));
  return r.amplitude * Math.sin((2 * Math.PI * (d - r.start)) / r.spacing) * fade;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Deterministic integer hash mapped to [-1, 1]. */
export function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 982451653)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}
