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

export type Feature = BoxFeature | JumpFeature;

export interface SpawnDef {
  x: number;
  z: number;
  /** Heading in degrees; 0 faces downhill (-Z), positive turns left. */
  heading: number;
}

export interface MapDef {
  name: string;
  terrain: TerrainDef;
  features: Feature[];
  spawn: SpawnDef;
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
