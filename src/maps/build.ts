import { buildObstacles, type Course } from '../sim/obstacles.ts';
import { buildRace, type RaceDef } from '../sim/race.ts';
import { buildRailShapes } from '../sim/rails.ts';
import { decorObstacles, layoutDecor } from './decor.ts';
import { buildShapes } from './shapes.ts';
import { startFrames, startObstacles, startShapes, type StartFrame } from './startGates.ts';
import { generateSlope } from './terrain.ts';
import type { Heightfield, MapDef } from './types.ts';

/** A map turned into what the simulation rides: terrain, shapes, rails, obstacles and the race course. */
export interface BuiltMap {
  map: MapDef;
  hf: Heightfield;
  starts: StartFrame[];
  course: Course;
  race: RaceDef | undefined;
}

/**
 * Builds a map: terrain, the shapes built on it (jumps, pipes, raised
 * starts), rails and boxes, and everything solid a rider can run into. The
 * game and the headless sim tools both build maps this way.
 */
export function buildMap(map: MapDef): BuiltMap {
  const hf = generateSlope(map.terrain);
  const starts = startFrames(map.features);
  hf.shapes = [...buildShapes(map.features), ...startShapes(starts)];
  const rails = buildRailShapes(map.features, hf);
  // Solid decoration is the same at every density, so the full layout gives it.
  const obstacles = buildObstacles([...startObstacles(starts), ...decorObstacles(layoutDecor(map, hf, 1))], hf);
  return { map, hf, starts, course: { hf, rails, obstacles }, race: buildRace(map.features, hf) };
}
