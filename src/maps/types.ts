// Map data shapes. Maps are plain data: a heightfield plus a list of features.
// World axes: +Y is up, downhill runs toward -Z, and +X is to the rider's
// right when facing downhill.

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
  /** Gentler area at the bottom. */
  runout: number;
  /** Raised banks along both sides. */
  bermWidth: number;
  bermHeight: number;
  /** Random height jitter so flat shading shows facets. */
  noise: number;
  seed: number;
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

export type Feature = BoxFeature;

export interface SpawnDef {
  x: number;
  z: number;
  /** Heading in degrees; 0 faces downhill (-Z). */
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
  heights: Float32Array;
}
