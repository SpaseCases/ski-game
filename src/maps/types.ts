// Map data shapes. Maps are plain data: a heightfield plus a list of features.
// World axes: +Y is up, and on a slope downhill runs toward -Z, with +X to
// the rider's right when facing downhill (a mountain falls away from its
// summit in every direction). Headings follow Three.js: 0 faces -Z and
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

/** A stretch of the fall line at one pitch. */
export interface PitchSection {
  /** Length down the fall line (m). */
  length: number;
  /**
   * Pitch in degrees, downhill positive (negative climbs). On a lane's last
   * section it can be left out: it's then solved so the lane ends level with
   * the slope beside it.
   */
  pitch?: number;
  /** Distance (m) the pitch takes to ease in from the one before, centered where this section starts. */
  ease: number;
}

/**
 * A band down the slope with its own fall line: steeper for a halfpipe or a
 * big jump's landing, flatter for a rail garden. It starts level with the
 * slope beside it and ends level again, so lines can cross at both ends; in
 * between, banks blend it into its neighbors.
 */
export interface TerrainLane {
  /** Middle of the band across the slope (X), and its full-strength width. */
  x: number;
  width: number;
  /** Width of the bank on each side where it blends into the slope beside it. */
  blend: number;
  /** Distance down the slope where the band starts. */
  start: number;
  sections: PitchSection[];
  /** Distance (m) the pitch takes to ease back to the slope's at the end. */
  endEase: number;
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
  /**
   * A straight slope (used when there's no profile): its pitch in degrees, a
   * flat area at the top before the pitch starts, and an area at the bottom
   * that flattens out and then rises gently to stop the rider.
   */
  slopeDeg: number;
  flatTop: number;
  runout: number;
  /**
   * Varied pitch: the fall line as sections from the top down. Past the last
   * one its pitch carries on (make it climb to stop riders at the bottom).
   */
  profile?: PitchSection[];
  /** Bands with their own fall line (see TerrainLane). */
  lanes?: TerrainLane[];
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
  /**
   * Folds in that scenery (spurs and hollows), growing over the first 60 m
   * past the play area: half their height (m) and their wavelength (m).
   * Absent: smooth hillsides.
   */
  hills?: { amplitude: number; wavelength: number };
}

/**
 * One spoke of a mountain: a line from the summit down a face (or along a
 * ridge between two faces), with its own fall line as pitch sections
 * measured out from the summit. Between two spokes the height blends from
 * one to the other, so faces drop away below the ridges beside them.
 */
export interface SpokeDef {
  name: string;
  /** Heading (degrees) from the summit, at the summit; 0 runs toward -Z. */
  heading: number;
  /** Degrees the spoke swings left per km out from the summit (curved valleys and ridges). */
  bend: number;
  /**
   * How sharp the crest (or valley) is across the spoke at the summit: 0
   * rounds it (a U-shaped valley floor, a broad ridge), up to 2 for a
   * knife-edge ridge or a V-shaped valley. It fades to round by `sharpTo` (m out).
   */
  sharp: number;
  sharpTo: number;
  /** Pitch sections out from the summit; past the last one its pitch carries on. */
  sections: PitchSection[];
}

/** A point on a terrain element's line, with a height (what it means depends on the element). */
export interface HeightPoint {
  x: number;
  z: number;
  height: number;
}

/** A raised crest along a line: a rock rib between chutes, an arête, a spine. */
export interface RidgeElement {
  type: 'ridge';
  /** The crest line; each point's height is the crest's height there above the slope. */
  points: HeightPoint[];
  /** Half the width of the crest's top, and the width of each side falling away from it. */
  crest: number;
  side: number;
  /** Length over which it grows from nothing at each end. */
  taper: number;
}

/** A channel dug down a line: a gully (a natural halfpipe), or a narrow chute. */
export interface GullyElement {
  type: 'gully';
  points: XZ[];
  /** Width of the flat floor, depth below the slope, and width of each curved wall. */
  floor: number;
  depth: number;
  wall: number;
  taper: number;
}

/**
 * A cliff band: a line across the slope where the snow drops away. Above the
 * line the slope rolls over into a bench; heights vary along it, and a
 * height of 0 leaves a gap to ride through.
 */
export interface CliffsElement {
  type: 'cliffs';
  /** The cliff's foot line; each point's height is the drop there. */
  points: HeightPoint[];
  /** Heading (degrees) riders go over it. */
  heading: number;
  /** Horizontal width of the drop, and length of the bench above it. */
  face: number;
  bench: number;
  taper: number;
}

/**
 * A wind lip or cornice along a line: a ramp up on the windward side to a
 * sharp crest, then a steep drop on the lee side (toward `heading`).
 */
export interface LipElement {
  type: 'lip';
  points: XZ[];
  heading: number;
  height: number;
  /** Length of the windward ramp, and horizontal width of the lee drop. */
  ramp: number;
  drop: number;
  taper: number;
}

/** A cirque: a bowl dug into a face, U-shaped from above with a curved headwall at the back, opening downhill. */
export interface BowlElement {
  type: 'bowl';
  /** Middle of its top edge (the rim at the back). */
  x: number;
  z: number;
  /** Heading (degrees) it opens toward. */
  heading: number;
  length: number;
  width: number;
  depth: number;
  /** Width of the headwall at the back, length of the floor's rise back to the slope at the front, and width of the side walls. */
  head: number;
  exit: number;
  rim: number;
}

/** A field of pillows: rounded snow-capped rocks, steeper on their downhill side. */
export interface PillowsElement {
  type: 'pillows';
  /** Middle of the field, the heading downhill, and its size. */
  x: number;
  z: number;
  heading: number;
  width: number;
  length: number;
  count: number;
  /** Radius range (m) and height range (m) of the pillows. */
  size: [number, number];
  height: [number, number];
  seed: number;
}

/** Rolling terrain in a round area: smooth bumps and side hits. */
export interface BumpsElement {
  type: 'bumps';
  x: number;
  z: number;
  /** Full strength within radius - fade, none past radius. */
  radius: number;
  fade: number;
  /** Half the crest-to-trough height, and the distance between bumps. */
  amplitude: number;
  wavelength: number;
  seed: number;
}

/** A broad, shallow dip that draws the ground around it in: a run-out basin where a face's lines come together. */
export interface DipElement {
  type: 'dip';
  x: number;
  z: number;
  radius: number;
  /** How far the middle sinks; the dip eases out to nothing at the radius. */
  depth: number;
}

/**
 * A flat pad: a ledge for a flag, the summit's start area, a town site. The
 * snow blends into a plane through the terrain's height at the middle,
 * tilted down `heading` by `pitch` degrees.
 */
export interface FlatElement {
  type: 'flat';
  x: number;
  z: number;
  heading: number;
  pitch: number;
  /** A circle of this radius, or (when 0) a width × length rectangle. */
  radius: number;
  width: number;
  length: number;
  /** Distance over which it blends back into the terrain around it. */
  blend: number;
}

export type TerrainElement =
  | RidgeElement
  | GullyElement
  | CliffsElement
  | LipElement
  | BowlElement
  | PillowsElement
  | BumpsElement
  | DipElement
  | FlatElement;

/**
 * A mountain built around a summit at x = z = 0: spokes give each face and
 * ridge its fall line, then terrain elements are laid on top, in order.
 */
export interface PeakTerrainDef {
  type: 'peak';
  /** Side (m) of the square heightfield, centered on the summit. */
  size: number;
  cellSize: number;
  /** Height (m) of the summit. */
  summit: number;
  /** Spokes in any order (sorted by heading when built). */
  spokes: SpokeDef[];
  /** Gentle undulation everywhere: half its height (m) and its wavelength (m). */
  roll: { amplitude: number; wavelength: number };
  /**
   * Big, slow folds over the faces (spurs and hollows), the same way. They
   * scale with the steepness of the ground under them, so run-outs stay smooth.
   */
  relief: { amplitude: number; wavelength: number };
  elements: TerrainElement[];
  /** Where the skier can go: a polygon around the summit (each ray out from the summit crosses it once). */
  bounds: XZ[];
  /**
   * The hills around the mountain: the ground starts climbing `inset` m
   * inside the bounds, steepening over `ramp` m to a grade of `rise`, so
   * riders near the edge roll back in rather than meet a wall.
   */
  rim: { inset: number; ramp: number; rise: number };
  /**
   * Ground steeper than this (degrees, measured over a few meters) is drawn
   * as rock, except gully walls and wind lips, which are always snow.
   */
  rockSlope: number;
  /** Visual-only facet jitter (m) on snow, and the extra on rock. */
  noise: number;
  rockNoise: number;
  seed: number;
}

export type TerrainDef = GeneratedTerrainDef | PeakTerrainDef;

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
 * What a rail is: a park rail (metal, on posts), a handrail (metal, on
 * posts down stairs), or a fallen tree (a log lying on the snow; wood).
 */
export type RailStyle = 'metal' | 'handrail' | 'log';

/**
 * A rail: a polyline the rider slides along. Flat, down, flat-down, kinked
 * and rainbow rails are all just different points. A first point at height
 * 0 starts at snow level: ride straight on.
 */
export interface RailFeature {
  type: 'rail';
  points: RailPoint[];
  /**
   * Follow the snow: extra points every `follow` meters, with heights
   * blended between the given ones, so a long rail bends with the slope
   * instead of cutting straight between its points. 0 keeps the points as given.
   */
  follow: number;
  style: RailStyle;
  /** Radius (m) of the tube or log; 0 uses the style's own (CONFIG.rails.radius, or a log's). */
  radius: number;
}

/**
 * What a box is: a park box (wooden sides, a metal deck), a concrete ledge,
 * a bench, a flat-topped rock, or a tree stump.
 */
export type BoxStyle = 'wood' | 'ledge' | 'bench' | 'rock' | 'stump';

/** A box: a wide deck along a polyline, like a rail. */
export interface BoxFeature {
  type: 'box';
  width: number;
  points: RailPoint[];
  follow: number;
  style: BoxStyle;
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
  /** A booter dug out of the snow: no dyed lip line. */
  natural: boolean;
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
  natural: boolean;
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
  natural: boolean;
}

/**
 * Roofs: a gable whose ridge runs across the building (so riding down its
 * length goes up one slope, over the ridge and down the other), a shed roof
 * sloping down the building's length, or a flat roof.
 */
export type RoofStyle = 'gable' | 'shed' | 'flat';
/** How a building looks: a timber chalet, a painted shop, a stone-based lodge, a lift station. */
export type BuildingStyle = 'chalet' | 'shop' | 'lodge' | 'station';

/**
 * A building whose snowy roof can be ridden: up a snow drift against its
 * uphill wall, along the roof, and off the downhill eave (a drop), or down
 * a landing drift piled below it. Its walls are solid. Heights are above
 * the snow under it; the length runs along `yaw`, usually down the hill.
 */
export interface BuildingFeature {
  type: 'building';
  /** Middle of the uphill edge of the roof. */
  x: number;
  z: number;
  yaw: number;
  /** The roof's size along yaw and across it (the walls stand a little inside). */
  length: number;
  width: number;
  /** Wall height at the downhill eave. */
  eave: number;
  roof: RoofStyle;
  /** Gable: ridge height above the eaves. Shed: how much higher the uphill eave is. */
  rise: number;
  /** Length (m) of a snow drift up the uphill wall to the eave; 0 for none (a plain wall). */
  drift: number;
  /** Length (m) of a landing drift down from the downhill eave; 0 for none (a drop). */
  apron: number;
  /** Height (m) of a snow lip kicking up along the downhill eave of a flat or shed roof (for gaps to the next roof); 0 for none. */
  lip: number;
  style: BuildingStyle;
  /** Wall color. */
  color: string;
  /** Which side the door, shop windows and sign face, seen riding down its length. */
  front: 'left' | 'right' | 'up' | 'down';
  /** Words on the sign over the door, or '' for none. */
  sign: string;
  /** A stone chimney on the roof, smoking (only on roofs nobody rides). */
  chimney: boolean;
}

/**
 * A raised plaza or deck: its back meets the snow, its top runs level (or
 * at `pitch` degrees down its length) so it stands `height` above the snow
 * at its front, a wall drop on every side. Stairs can lead down the front,
 * with handrails down both sides of them.
 */
export interface TerraceFeature {
  type: 'terrace';
  /** Middle of the back edge. */
  x: number;
  z: number;
  yaw: number;
  length: number;
  width: number;
  /** Height above the snow at the front edge. */
  height: number;
  /** Width of the stairs down the middle of the front (0: none), and their steepness (degrees). */
  stairs: number;
  stairAngle: number;
  handrails: boolean;
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

/** One gate: the rider must pass between its two sides. */
export interface SlalomGateDef {
  /** Middle of the gate. */
  x: number;
  z: number;
  /** Heading in degrees riders pass through it; 0 faces downhill. */
  heading: number;
  /** The opening: distance between the poles (for a giant slalom gate, between the panels' inner poles). */
  width: number;
}

/**
 * What a course's gates are: slalom gates (a single pole each side, bending
 * when clipped) or giant slalom gates (each side a plain panel between two
 * poles, which tips over as one when hit).
 */
export type GateKind = 'slalom' | 'giant';

/**
 * A timed course's gates, in order, alternating red and blue. A race start
 * and finishes naming the same course time it (see StartFeature.course and
 * FinishDef.course); several features with one name join into one course.
 */
export interface SlalomFeature {
  type: 'slalom';
  /** The course's name, shown on the race HUD; '' goes with a race start that names no course. */
  name: string;
  kind: GateKind;
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
  /** A race start: the course (SlalomFeature.name) its timing wand starts; '' for the gates that name none. */
  course: string;
}

export type Feature =
  | BoxFeature
  | RailFeature
  | JumpFeature
  | KickerFeature
  | LandingFeature
  | HalfpipeFeature
  | SlalomFeature
  | StartFeature
  | BuildingFeature
  | TerraceFeature;

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

/**
 * The finish: a rectangle on the snow. Entering it offers Back to top. It's
 * marked by a checkered banner across its whole line, or, on a wide run-out
 * basin, by a finish arch standing over the main line into it.
 */
export interface FinishDef {
  /** Middle of the line where the zone starts (its uphill edge). */
  x: number;
  z: number;
  /** Heading in degrees the zone extends from that line; 0 faces downhill (-Z). */
  heading: number;
  /** Size across, and how far it runs on past the line. */
  width: number;
  length: number;
  /** The arch: its middle and width, facing the zone's heading. Absent: the banner spans the whole line. */
  arch?: { x: number; z: number; width: number };
  /**
   * The timed course (SlalomFeature.name) whose clock this finish stops.
   * Absent: it stops none of the courses that have finishes of their own,
   * and any course that has none.
   */
  course?: string;
}

/** Things scattered over an area. */
export type ScatterKind = 'pine' | 'aspen' | 'snag' | 'rock' | 'boulder' | 'crag';
/** Things built along a line. */
export type LineKind = 'fence' | 'netting' | 'barrier' | 'dyeLine' | 'bunting' | 'chairlift';
/** Single props, one at each point. */
export type PropKind = 'lightPole' | 'floodlight' | 'banner' | 'flag' | 'groomer' | 'streetLamp' | 'hut' | 'snowmobile' | 'skier' | 'skiRack';

/** A run's difficulty, for trail signs: easy, intermediate, advanced, expert. */
export type RunLevel = 'green' | 'blue' | 'black' | 'double';

/** One board on a trail sign: a run's name, its difficulty, and which way it goes (-1 left, 0 ahead, 1 right). */
export interface SignLine {
  text: string;
  level: RunLevel;
  arrow: number;
}

/** A trail sign at a fork: boards on a post, facing riders coming down toward `heading`. */
export interface SignDecor {
  kind: 'sign';
  x: number;
  z: number;
  heading: number;
  /** A board on top naming the area (a face, the town), or ''. */
  header: string;
  lines: SignLine[];
}

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

/** A range for terrain placement: none below a, ramping up to full at b, full to c, none past d. */
export type Ramp4 = [number, number, number, number];

/**
 * Things placed by the terrain: candidate spots on a jittered grid over the
 * whole map, kept where the height and steepness suit them (trees thinning
 * to a treeline, rocks on steep ground), gathered into stands with
 * clearings between. Ones a rider can reach (inside the bounds) are solid if
 * the set is, and always drawn; ones outside are scenery that lower presets
 * thin out.
 */
export interface TerrainScatterDecor {
  kind: ScatterKind;
  /** Average distance (m) between candidate spots. */
  spacing: number;
  /** Heights (m) and steepness (degrees) where they grow. */
  height: Ramp4;
  slope: Ramp4;
  /** Stands and clearings: the size (m) of a stand, and the share of the ground left clear (0..1). */
  clumps: { size: number; clear: number };
  seed: number;
  minScale: number;
  maxScale: number;
  solid: boolean;
  /** How far (m) past the edge of the play area scenery copies still grow; farther is never seen. */
  reach: number;
}

export type DecorDef = ScatterDecor | TerrainScatterDecor | LineDecor | PropDecor | SignDecor;

/**
 * Mountain ranges far around the map, past the end of its terrain: drawn
 * behind everything, hazy with distance. Peaks stand in rings between
 * `distance` (m from the map's middle), rising from `base` to `height` (m).
 */
export interface PeaksDef {
  seed: number;
  /** Peaks per ring, and rings. */
  count: number;
  rings: number;
  distance: [number, number];
  base: number;
  height: [number, number];
  /** Snow line (m): rock below it, snow above. */
  snowLine: number;
}

/**
 * A named line down the map (a run): ridden by the headless tools, offered
 * as a test spot, and kept clear of trees for `clear` meters on each side.
 */
export interface RunDef {
  name: string;
  points: XZ[];
  clear: number;
}

export interface MapDef {
  name: string;
  /** False: no combo scoring on this map (the Slalom, which has its race timer). Default true. */
  scoring?: boolean;
  terrain: TerrainDef;
  features: Feature[];
  spawn: SpawnDef;
  flags: FlagDef[];
  /** Finish zones: one at the bottom of each way down. */
  finishes: FinishDef[];
  decor: DecorDef[];
  runs: RunDef[];
  colors: {
    sky: string;
    fog: string;
  };
  /** Distant mountains around the map, or none. */
  peaks?: PeaksDef;
  /** Snow off the named runs is powder (Freeride); without this the whole map is groomed. */
  powder?: PowderDef;
  /**
   * This map's own sky and fog colors in other weathers, in place of those
   * CONFIG.weather derives from `colors` (which are its bluebird look).
   */
  weather?: Partial<Record<'overcast' | 'blizzard' | 'night', { sky?: string; fog?: string }>>;
}

/**
 * Where a map's snow is powder: everywhere but its named runs (within each
 * run's `clear`) and these groomed patches (a town).
 */
export interface PowderDef {
  groomed: GroomedPatch[];
}

/** A rectangle of groomed snow: its middle, the heading its length runs along (degrees), and its size. */
export interface GroomedPatch {
  x: number;
  z: number;
  heading: number;
  width: number;
  length: number;
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
  /** World heights of its bottom and top, when they aren't the snow at its ends (a wall under a roof). */
  y0?: number;
  y1?: number;
}

/** The part of the map the skier can reach: a rectangle, cut down to a polygon when there is one. */
export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** The polygon's corners as x, z, x, z..., or empty. */
  polygon: Float32Array;
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
  /** Visual only: how rocky each sample is drawn, 0 (snow) to 255 (rock); absent, all snow. Same layout as heights. */
  rock?: Uint8Array;
  /** Shapes built on top of the slope (jumps, pipes, decks, roofs), sampled exactly so lips stay sharp. Set with setShapes. */
  shapes?: TerrainShape[];
  /** The shapes sorted into square cells (see setShapes), so a sample looks at only the few nearby. */
  shapeCells?: ShapeCells;
}

/** A grid over the map: for each cell, its slice of `items` (indices into the shapes). */
export interface ShapeCells {
  cell: number;
  originX: number;
  originZ: number;
  cols: number;
  rows: number;
  start: Int32Array;
  items: Int32Array;
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
  /** Per knot: what the stretch arriving at it is (see SURFACE): snow, wood (a start deck), or drawn elsewhere (stairs). */
  surface: Uint8Array;
  /** Distances along where a lip is dyed blue. */
  lips: number[];
  /**
   * Each takeoff's stretch (distance along where it starts curving up, and
   * its lip), as pairs. However steep, a takeoff face isn't a wall (see
   * CONFIG.air.wallAngle): it launches the rider the way it points.
   */
  takeoffs: number[];
  /** Draw the side slopes as snow. Structures (towers, decks, roofs) draw their own sides. */
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
  /** How it's drawn. */
  look: RailStyle | BoxStyle;
  /** What the skis slide on: metal slides faster than wood or stone. */
  metal: boolean;
  /** Points along the top, x y z per point. */
  points: Float32Array;
  /** Distance along the top (3D) from the first point to each point. */
  dist: Float32Array;
  /** Total length along the top. */
  length: number;
  /** Half the width of the top: the rail's radius, or half the box's width. */
  halfWidth: number;
  /** Bounding box of the line seen from above, for skipping rails far from the rider. */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
