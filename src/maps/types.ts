// Map data shapes. Maps are plain data: a heightfield plus a list of features.
// World axes: +Y is up, downhill runs toward -Z, and +X is to the rider's
// right when facing downhill. Headings follow Three.js: 0 faces -Z and
// positive angles turn left (counter-clockwise seen from above).

/** A run of smooth rollers across the slope. Distances are measured down from the top. */
export interface RollersDef {
  start: number;
  end: number;
  /** Half the crest-to-trough height. */
  amplitude: number;
  /** Distance between crests. */
  spacing: number;
}

/** Parameters for a procedurally generated slope. All lengths in meters. */
export interface GeneratedTerrainDef {
  type: 'generated';
  /** Across the slope (X). */
  width: number;
  /** Down the slope (Z), from z = 0 at the top to z = -length at the bottom. */
  length: number;
  /** Distance between heightfield samples. */
  cellSize: number;
  /** Main pitch of the slope in degrees. */
  slopeDeg: number;
  /** Flat area at the top before the pitch starts. */
  flatTop: number;
  /** Area at the bottom that flattens out and then rises gently to stop the rider. */
  runout: number;
  /** Raised banks along both sides. */
  bermWidth: number;
  bermHeight: number;
  /** Visual-only height jitter so flat shading shows facets. Physics ignores it. */
  noise: number;
  seed: number;
  rollers?: RollersDef;
}

export type TerrainDef = GeneratedTerrainDef;

/** A flat box the rider can slide on. Sits on the snow, pitched to match the slope. */
export interface BoxFeature {
  type: 'box';
  x: number;
  z: number;
  length: number;
  width: number;
  height: number;
  /** Heading in degrees; 0 runs the box along the Z axis. */
  yaw: number;
}

/**
 * A park jump shaped into the snow: a curved takeoff ramp up to a lip, a deck
 * that follows the slope at lip height, then a landing that eases back down
 * to the slope. Heights are measured from the slope underneath.
 */
export interface JumpFeature {
  type: 'jump';
  /** Where the takeoff ramp starts (center of its front edge). */
  x: number;
  z: number;
  /** Heading in degrees the rider jumps toward; 0 faces downhill (-Z). */
  yaw: number;
  /** Width of the full-height part; the sides slope away over sideWidth. */
  width: number;
  sideWidth: number;
  /** Lip height above the slope, and the lip angle in degrees relative to the slope. */
  lipHeight: number;
  lipAngle: number;
  /** Deck length after the lip, then the length of the landing down to the slope. */
  deckLength: number;
  landingLength: number;
}

/** A point on a rail: where it is, and how high its top is above the snow there. */
export interface RailPoint {
  x: number;
  z: number;
  height: number;
}

/**
 * A metal rail: a polyline the rider slides along, on posts down to the snow.
 * Flat, down, and flat-down rails are all just different points.
 */
export interface RailFeature {
  type: 'rail';
  points: RailPoint[];
}

export type Feature = BoxFeature | JumpFeature | RailFeature;

export interface SpawnDef {
  x: number;
  z: number;
  /** Heading in degrees; 0 faces downhill (-Z), positive turns left. */
  heading: number;
}

/**
 * A checkpoint gate: a flag pole at each end of a line across the run.
 * Riding through it, in its direction, saves it as the respawn point, which
 * is the middle of the line, facing `heading`.
 */
export interface FlagDef {
  /** Middle of the gate. */
  x: number;
  z: number;
  /** Heading in degrees riders pass through it; 0 faces downhill (-Z). */
  heading: number;
  /** Distance between the two poles. */
  width: number;
}

/** The finish: a rectangle on the snow. Entering it offers Back to top. */
export interface FinishDef {
  /** Middle of the line where the zone starts (its uphill edge). */
  x: number;
  z: number;
  /** Heading in degrees the zone extends from that line; 0 faces downhill (-Z). */
  heading: number;
  /** Size across, and how far it runs on past the line. */
  width: number;
  length: number;
}

export interface MapDef {
  name: string;
  terrain: TerrainDef;
  features: Feature[];
  spawn: SpawnDef;
  flags: FlagDef[];
  finish: FinishDef;
  colors: {
    sky: string;
    fog: string;
  };
}

/** Height samples on a regular grid. Row-major: heights[row * cols + col]. */
export interface Heightfield {
  cols: number;
  rows: number;
  cellSize: number;
  /** World X of column 0. */
  originX: number;
  /** World Z of row 0. */
  originZ: number;
  /** The snow surface the simulation rides on. */
  heights: Float32Array;
  /** Optional visual-only offsets added to the rendered mesh, same layout as heights. */
  detail?: Float32Array;
  /** Jumps added on top of the heights, sampled exactly so lips stay sharp. */
  jumps?: JumpShape[];
}

/** A jump feature with its derived dimensions, ready for sampling. */
export interface JumpShape {
  x: number;
  z: number;
  /** Unit direction of the jump (along) and to its right (across), in XZ. */
  dirX: number;
  dirZ: number;
  rightX: number;
  rightZ: number;
  halfWidth: number;
  sideWidth: number;
  lipHeight: number;
  /** Distances along the jump: lip, end of deck, end of landing. */
  lipAt: number;
  deckEnd: number;
  landingEnd: number;
}

/**
 * Something to slide on (a rail or a box), built from its feature for the
 * simulation: the line along its top that the skis ride, in world space.
 */
export interface RailShape {
  kind: 'rail' | 'box';
  /** Points along the top, x y z per point. */
  points: Float32Array;
  /** Distance along the top (3D) from the first point to each point. */
  dist: Float32Array;
  /** Total length along the top. */
  length: number;
  /** Half the width of the top: the rail's radius, or half the box's width. */
  halfWidth: number;
}
