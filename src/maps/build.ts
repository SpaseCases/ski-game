import { buildAvalanches } from '../sim/avalanche.ts';
import { buildGaps, type Gaps } from '../sim/gaps.ts';
import { buildLifts } from '../sim/lift.ts';
import { buildObstacles, type Course } from '../sim/obstacles.ts';
import { powderArea } from '../sim/powder.ts';
import { buildRace, type RaceDef } from '../sim/race.ts';
import { buildRailShapes } from '../sim/rails.ts';
import { decorObstacles, layoutDecor, type DecorLayout } from './decor.ts';
import { buildShapes, setShapes } from './shapes.ts';
import { startFrames, startObstacles, startShapes, type StartFrame } from './startGates.ts';
import { generatePeak } from './peak.ts';
import { generateSlope } from './terrain.ts';
import { townObstacles, townRails, townShapes } from './town.ts';
import type { Heightfield, MapDef, TerrainDef } from './types.ts';

/** A map turned into what the simulation rides: terrain, shapes, rails, obstacles and the timed courses. */
export interface BuiltMap {
  map: MapDef;
  hf: Heightfield;
  starts: StartFrame[];
  course: Course;
  race: RaceDef | undefined;
  /** All of the decoration; the renderer thins out scenery for lower presets. */
  decor: DecorLayout;
  /** Gaps and fences for scoring (the physics never reads them). */
  gaps: Gaps;
}

/**
 * Builds a map: terrain, the shapes built on it (jumps, pipes, raised
 * starts, roofs and terraces), rails and boxes (and handrails down the
 * stairs), and everything solid a rider can run into. The game and the
 * headless sim tools both build maps this way.
 */
export function buildMap(map: MapDef): BuiltMap {
  const hf = generateTerrain(map.terrain);
  const starts = startFrames(map.features);
  setShapes(hf, [...buildShapes(map.features), ...startShapes(starts), ...townShapes(map.features)]);
  const rails = buildRailShapes([...map.features, ...townRails(map.features)], hf);
  const decor = layoutDecor(map, hf);
  const obstacles = buildObstacles([...startObstacles(starts), ...townObstacles(map.features, hf), ...decorObstacles(decor)], hf);
  const course: Course = { hf, rails, obstacles, powder: powderArea(map) };
  const lifts = buildLifts(decor.lines, hf);
  if (lifts) course.lifts = lifts;
  const avalanches = buildAvalanches(map.avalanches, hf);
  if (avalanches) course.avalanches = avalanches;
  return { map, hf, starts, course, race: buildRace(map.features, map.finishes, hf), decor, gaps: buildGaps(map) };
}

/** The heightfield for a map's terrain: a slope, or a mountain. */
export function generateTerrain(def: TerrainDef): Heightfield {
  return def.type === 'peak' ? generatePeak(def) : generateSlope(def);
}
