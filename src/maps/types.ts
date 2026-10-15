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
  /**
   * Scenery terrain around the play area (m on every side): hillsides past
   * the berms, more slope above the top and below the runout. The skier
   * stays inside width × length.
   */
  margin: number;
}

export type TerrainDef = GeneratedTerrainDef;

/** A point on the snow. */
export interface XZ {
  x: number;
  z: number;
}

/** A point on a rail or box: where it is, and how high its top is above the snow there. */
export interface RailPoint {
  x: number;
  z: number;
  height: number;
}

/**
 * A metal rail: a polyline the rider slides along, on posts down to the snow.
 * Flat, down, flat-down, kinked and rainbow rails are all just different
 * points. A first point at height 0 starts at snow level: ride straight on.
 */
export interface RailFeature {
  type: 'rail';
  points: RailPoint[];
}

/** A box: a wide wooden-sided deck along a polyline, like a rail. */
export interface BoxFeature {
  type: 'box';
  width: number;
  points: RailPoint[];
}

/**
 * A park jump: a curved takeoff up to a sharp lip, then either a deck at lip
 * height (a table) or an open gap, then a landing whose rounded knuckle eases
 * into a straight face and back into the slope. Heights are measured from
 * the slope underneath, angles in degrees relative to it.
 */
export interface JumpFeature {
  type: 'jump';
  /** Where the takeoff starts (center of its front edge). */
  x: number;
  z: number;
  /** Heading in degrees the rider jumps toward; 0 faces downhill (-Z). */
  yaw: number;
  /** Width of the full-height part; the sides slope away over sideWidth. */
  width: number;
  sideWidth: number;
  lipHeight: number;
  lipAngle: number;
  /** Distance from the lip to the knuckle, where the landing starts to round over. */
  gap: number;
  /**
   * True: the gap is a deck at lip height (a table). False: an open gap; the
   * takeoff drops off behind its lip and the landing rises from the slope.
   */
  deck: boolean;
  /** Height of the landing's top. Above the lip is a step-up, below a step-down. A deck uses the lip height. */
  landingHeight: number;
  /** Steepness of the landing face. */
  landingAngle: number;
  /** Lengths over which the knuckle rounds over, and the face eases back into the slope. */
  knuckle: number;
  transition: number;
}

/** A takeoff with no landing (into a rail, or a hip). Its back drops to the slope. */
export interface KickerFeature {
  type: 'kicker';
  x: number;
  z: number;
  yaw: number;
  width: number;
  sideWidth: number;
  lipHeight: number;
  lipAngle: number;
  /** Length of the back side, from the lip down to the slope. */
  back: number;
}

/** A landing on its own (a hip's landing, or after a natural drop). */
export interface LandingFeature {
  type: 'landing';
  /** Start of its back side (the uphill end). */
  x: number;
  z: number;
  /** Heading in degrees its face points down; 0 faces downhill. */
  yaw: number;
  width: number;
  sideWidth: number;
  /** Height of its top above the slope, and steepness of its face. */
  height: number;
  angle: number;
  /** Length of the back side rising to the top, and of the flat top before the knuckle. */
  back: number;
  top: number;
  knuckle: number;
  transition: number;
}

/**
 * A halfpipe dug along the slope: a flat floor between two walls that curve
 * up (quarter circles) to near vertical, flat decks along their tops, and a
 * drop-in deck across the top end that the rider rolls onto and drops into.
 */
export interface HalfpipeFeature {
  type: 'halfpipe';
  /** Middle of the top end (where the drop-in deck starts). */
  x: number;
  z: number;
  yaw: number;
  /** From the drop-in deck to the bottom end. */
  length: number;
  floorWidth: number;
  /** Radius of the wall transitions, and the wall angle at the top in degrees. */
  radius: number;
  wallAngle: number;
  /** Flat deck along each wall top, and the bank outside it down to the slope. */
  deckWidth: number;
  outerWidth: number;
  /** Flat drop-in deck at the top end, the ramp from it down to the floor, and the approach up onto it. */
  dropIn: number;
  entry: number;
  back: number;
  /** Length over which the walls fade out at the bottom end. */
  exit: number;
}

/** One slalom gate: two poles, and the rider must pass between them. */
export interface SlalomGateDef {
  /** Middle of the gate. */
  x: number;
  z: number;
  /** Heading in degrees riders pass through it; 0 faces downhill. */
  heading: number;
  /** Distance between the poles. */
  width: number;
}

/** A slalom course: gates in order, poles alternating red and blue. */
export interface SlalomFeature {
  type: 'slalom';
  gates: SlalomGateDef[];
}

/**
 * Start gate styles: a wooden start deck under a banner arch (park), a
 * scaffold drop-in tower (big air), a ridgetop start with a line of flags
 * and a hut (freeride), a race start house with a timing wand (slalom).
 */
export type StartStyle = 'deck' | 'tower' | 'ridge' | 'race';

export interface StartFeature {
  type: 'start';
  style: StartStyle;
  /** Where the rider stands, facing `heading` (degrees; 0 faces downhill). */
  x: number;
  z: number;
  heading: number;
  /** Deck or tower platform height above the snow. */
  height: number;
}

export type Feature =
  | BoxFeature
  | RailFeature
  | JumpFeature
  | KickerFeature
  | LandingFeature
  | HalfpipeFeature
  | SlalomFeature
  | StartFeature;

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

/** Things scattered over an area. */
export type ScatterKind = 'pine' | 'snag' | 'rock' | 'boulder';
/** Things built along a line. */
export type LineKind = 'fence' | 'netting' | 'barrier' | 'dyeLine' | 'bunting' | 'chairlift';
/** Single props, one at each point. */
export type PropKind = 'lightPole' | 'floodlight' | 'banner' | 'flag' | 'groomer';

/** An axis-aligned rectangle on the snow: its middle and size. */
export interface AreaDef {
  x: number;
  z: number;
  width: number;
  length: number;
}

export interface ScatterDecor {
  kind: ScatterKind;
  area: AreaDef;
  /** How many at full density. */
  count: number;
  seed: number;
  minScale: number;
  maxScale: number;
  /**
   * Solid ones crash a rider who runs into them, so they're part of the
   * course: every quality preset keeps all of them. Others are scenery, and
   * lower presets thin them out.
   */
  solid: boolean;
}

export interface LineDecor {
  kind: LineKind;
  points: XZ[];
}

export interface PropDecor {
  kind: PropKind;
  points: XZ[];
  /** Heading in degrees the props face; 0 faces downhill. */
  heading: number;
  /** Main color (banners, flags); flags pick their own when absent. */
  color?: string;
}

export type DecorDef = ScatterDecor | LineDecor | PropDecor;

export interface MapDef {
  name: string;
  terrain: TerrainDef;
  features: Feature[];
  spawn: SpawnDef;
  flags: FlagDef[];
  finish: FinishDef;
  decor: DecorDef[];
  colors: {
    sky: string;
    fog: string;
  };
}

/**
 * Something solid on the course (a tree, a fence, a hut wall): a capsule
 * seen from above, from a to b (the same point for something round) with a
 * radius, standing `height` above the snow.
 */
export interface ObstacleDef {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  radius: number;
  height: number;
}

/** The part of the map the skier can reach. */
export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
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
  /** Where the skier can go; the rest is scenery. */
  bounds: Bounds;
  /** Shapes built on top of the slope (jumps, pipes, decks), sampled exactly so lips stay sharp. */
  shapes?: TerrainShape[];
}

/**
 * A ramp built on the slope: a profile along its length (knots joined by
 * cubic Hermite curves, so a lip can be a crease) that eases off at the
 * sides. Jumps, kickers, landings, start decks and towers are all ramps.
 */
export interface RampShape {
  kind: 'ramp';
  /** Where the profile's u = 0 is, and its unit direction (along) and right (across) in XZ. */
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  rightX: number;
  rightZ: number;
  halfWidth: number;
  sideWidth: number;
  /** Knots: distance along, height, slope arriving and slope leaving. */
  ku: Float32Array;
  kh: Float32Array;
  kIn: Float32Array;
  kOut: Float32Array;
  /** Per knot: the stretch arriving at it is wood (a start deck), not snow. */
  wood: Uint8Array;
  /** Distances along where a lip is dyed blue. */
  lips: number[];
  /** Draw the side slopes as snow. Structures (towers, decks) draw boards instead. */
  sides: boolean;
  /** Bounding box in world XZ. */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** A halfpipe with its dimensions worked out (see HalfpipeFeature). */
export interface PipeShape {
  kind: 'pipe';
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  rightX: number;
  rightZ: number;
  /** Heading in radians riders travel down it. */
  heading: number;
  floorHalf: number;
  radius: number;
  /** Width of each transition seen from above, and the wall height. */
  transition: number;
  height: number;
  deckWidth: number;
  outerWidth: number;
  length: number;
  dropIn: number;
  entry: number;
  back: number;
  exit: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export type TerrainShape = RampShape | PipeShape;

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
