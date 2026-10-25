import { BufferAttribute, BufferGeometry, Color, Group, Mesh, MeshLambertMaterial } from 'three';
import { pipeHalfWidth, quarterWidth, sampleShape, SURFACE, type ShapeSample } from '../maps/shapes.ts';
import { hash2 } from '../maps/terrain.ts';
import type { Heightfield, PipeShape, QuarterShape, RailShape, RampShape, TerrainShape } from '../maps/types.ts';
import { createRailMesh } from './railMesh.ts';
import { renderedHeightAt } from './terrainMesh.ts';
import { litByPools } from './lightPools.ts';

// Shapes are snow, with dyed blue lines along park lips (and along the top
// of a halfpipe's or quarterpipe's walls) so they read from a distance.
// Start decks and wallride faces are wood. Ramps (jumps, decks, roofs,
// drifts, terraces) and quarters are merged into one mesh per 64 m tile;
// each halfpipe is its own mesh.
const SNOW = new Color('#f7f9fd');
const SNOW_SHADE = new Color('#c9d6e8');
const LIP_LINE = new Color('#3f7fe0');
const WOOD = new Color('#a87443');
const WOOD_DARK = new Color('#8f5f35');
const WOOD_MID = WOOD.clone().lerp(WOOD_DARK, 0.5);
const LIP_LINE_WIDTH = 0.6;
/** Plank width (m) on wooden decks. */
const PLANK = 0.3;
/** Grid spacing (m) of ramp meshes where they curve, fine enough for a round takeoff, and where they run straight. */
const RAMP_STEP = 0.5;
const RAMP_STEP_STRAIGHT = 2;
/** Curved stretches longer than RAMP_LONG (m) use steps of RAMP_STEP_LONG. */
const RAMP_LONG = 9;
const RAMP_STEP_LONG = 1;
/** Pipe grid: steps along it (fine near the ends, coarse in the middle), and facets per wall transition. */
const PIPE_STEP_FINE = 1;
const PIPE_STEP = 2;
const PIPE_TRANSITION_STEPS = 14;
/** Size (m) of a tile of merged ramp meshes. */
const TILE = 64;

const material = litByPools(
  new MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
    // Where a shape meets the slope the two surfaces coincide; draw the shape on top.
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  }),
);

/**
 * Builds meshes for every feature in the map, from the same shapes the
 * physics uses: ramps and pipes from the heightfield's shapes, rails and
 * boxes from their slide lines.
 */
export function createFeatureMeshes(hf: Heightfield, rails: readonly RailShape[]): Group {
  const group = new Group();
  const tiles = new Map<string, Tris>();
  for (const [i, shape] of (hf.shapes ?? []).entries()) {
    if (shape.kind === 'pipe') {
      const t: Tris = { positions: [], colors: [] };
      createPipe(shape, hf, i, t);
      group.add(toMesh(t));
      continue;
    }
    const key = `${Math.floor((shape.minX + shape.maxX) / 2 / TILE)},${Math.floor((shape.minZ + shape.maxZ) / 2 / TILE)}`;
    let t = tiles.get(key);
    if (!t) {
      t = { positions: [], colors: [] };
      tiles.set(key, t);
    }
    if (shape.kind === 'quarter') createQuarter(shape, hf, i, t);
    else createRamp(shape, hf, i, t);
  }
  for (const t of tiles.values()) if (t.positions.length > 0) group.add(toMesh(t));
  if (rails.length > 0) group.add(createRailMesh(rails, hf));
  return group;
}

/** Triangles collected for one mesh: positions and colors, three numbers a vertex. */
interface Tris {
  positions: number[];
  colors: number[];
}

function toMesh(t: Tris): Mesh {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(t.positions), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(t.colors), 3));
  // No normals: flat shading works them out per face on the GPU.
  geometry.computeBoundingSphere();
  const mesh = new Mesh(geometry, material);
  mesh.matrixAutoUpdate = false;
  return mesh;
}

/** Face color for one cell of a shape's grid, or false to leave the cell out. */
type FaceColor = (a: number, b: number, tri: number, out: Color) => boolean;

/** Where a grid lies: its origin, the direction its first axis runs, and the one to its right. */
interface GridFrame {
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  rightX: number;
  rightZ: number;
}

/**
 * A grid laid over the snow: vertex (a, b) sits at us[a] along the frame
 * (the shape's own, unless given) and vs[b] to its right, on the drawn
 * terrain plus this shape's height, so its edges meet the slope seamlessly.
 * Where another shape is higher, that one's mesh covers this one, matching
 * the sim's "highest wins".
 */
function gridMesh(shape: TerrainShape, hf: Heightfield, us: readonly number[], vs: readonly number[], color: FaceColor, out: Tris, frame: GridFrame = shape): void {
  const nu = us.length - 1;
  const nv = vs.length - 1;
  const sample: ShapeSample = { height: 0, dhdx: 0, dhdz: 0 };
  const gx = new Float32Array((nu + 1) * (nv + 1));
  const gy = new Float32Array((nu + 1) * (nv + 1));
  const gz = new Float32Array((nu + 1) * (nv + 1));
  for (let a = 0; a <= nu; a++) {
    for (let b = 0; b <= nv; b++) {
      const u = us[a] ?? 0;
      const v = vs[b] ?? 0;
      const x = frame.x + frame.dirX * u + frame.rightX * v;
      const z = frame.z + frame.dirZ * u + frame.rightZ * v;
      const k = a * (nv + 1) + b;
      gx[k] = x;
      gy[k] = renderedHeightAt(hf, x, z) + (sampleShape(shape, x, z, sample) ? sample.height : 0);
      gz[k] = z;
    }
  }

  const face = new Color();
  const { positions, colors } = out;
  const vertex = (a: number, b: number): void => {
    const k = a * (nv + 1) + b;
    positions.push(gx[k] ?? 0, gy[k] ?? 0, gz[k] ?? 0);
  };
  const paint = (): void => {
    for (let k = 0; k < 3; k++) colors.push(face.r, face.g, face.b);
  };

  // a runs along the shape and b to its right; this order winds each
  // triangle counter-clockwise seen from above, so faces point up.
  for (let a = 0; a < nu; a++) {
    for (let b = 0; b < nv; b++) {
      if (color(a, b, 0, face)) {
        vertex(a, b);
        vertex(a + 1, b + 1);
        vertex(a + 1, b);
        paint();
      }
      if (color(a, b, 1, face)) {
        vertex(a, b);
        vertex(a, b + 1);
        vertex(a + 1, b + 1);
        paint();
      }
    }
  }
}

function snowShade(a: number, b: number, tri: number, seed: number, out: Color): void {
  const t = 0.5 + 0.5 * hash2(a * 2 + tri, b, seed);
  out.copy(SNOW).lerp(SNOW_SHADE, t * t * 0.35);
}

/** Splits [from, to] into steps of at most `step`, appending to `out` (without `from`). */
function steps(out: number[], from: number, to: number, step: number): void {
  const n = Math.max(1, Math.ceil((to - from) / step));
  for (let i = 1; i <= n; i++) out.push(from + ((to - from) * i) / n);
}

/** True when knot segment k (from knot k - 1 to k) of a ramp is a straight line (a roof, a deck, a stair). */
function straight(r: RampShape, k: number): boolean {
  const len = (r.ku[k] ?? 0) - (r.ku[k - 1] ?? 0);
  const m = ((r.kh[k] ?? 0) - (r.kh[k - 1] ?? 0)) / len;
  return Math.abs((r.kOut[k - 1] ?? 0) - m) < 1e-3 && Math.abs((r.kIn[k] ?? 0) - m) < 1e-3;
}

function createRamp(r: RampShape, hf: Heightfield, seed: number, out: Tris): void {
  // Grid lines land exactly on every knot, so a lip stays a sharp edge.
  const us = [r.ku[0] ?? 0];
  for (let k = 1; k < r.ku.length; k++) {
    // Long gentle curves (drifts, landing drifts) bend slowly enough for a coarser grid than a lip.
    const len = (r.ku[k] ?? 0) - (r.ku[k - 1] ?? 0);
    steps(us, r.ku[k - 1] ?? 0, r.ku[k] ?? 0, straight(r, k) ? RAMP_STEP_STRAIGHT : len > RAMP_LONG ? RAMP_STEP_LONG : RAMP_STEP);
  }
  const edge = r.sides ? r.halfWidth + r.sideWidth : r.halfWidth;
  const vs = [-edge];
  if (r.sides) steps(vs, -edge, -r.halfWidth, RAMP_STEP);
  steps(vs, -r.halfWidth, r.halfWidth, RAMP_STEP_STRAIGHT);
  if (r.sides) steps(vs, r.halfWidth, edge, RAMP_STEP);

  gridMesh(
    r,
    hf,
    us,
    vs,
    (a, b, tri, color) => {
      const uMid = ((us[a] ?? 0) + (us[a + 1] ?? 0)) / 2;
      let k = 1;
      while (k < r.ku.length - 1 && uMid > (r.ku[k] ?? 0)) k++;
      const surface = r.surface[k];
      if (surface === SURFACE.hidden) return false;
      if (surface === SURFACE.wood) {
        color.copy(Math.floor(uMid / PLANK) % 2 === 0 ? WOOD : WOOD_DARK);
      } else if (r.lips.some((lip) => uMid > lip - LIP_LINE_WIDTH && uMid < lip)) {
        color.copy(LIP_LINE);
      } else {
        snowShade(a, b, tri, seed + 211, color);
      }
      return true;
    },
    out,
  );
}

function createPipe(s: PipeShape, hf: Heightfield, seed: number, out: Tris): void {
  const us = [-s.back];
  steps(us, -s.back, s.dropIn + s.entry, PIPE_STEP_FINE);
  steps(us, s.dropIn + s.entry, s.length - s.exit, PIPE_STEP);
  steps(us, s.length - s.exit, s.length, PIPE_STEP_FINE);

  // Across: the transitions are split by equal angles, so the steep top of
  // each wall gets as many facets as its gentle bottom.
  const top = s.floorHalf + s.transition;
  const deck = top + s.deckWidth;
  const half: number[] = [0];
  steps(half, 0, s.floorHalf, 1.5);
  const wall = Math.asin(s.transition / s.radius);
  for (let i = 1; i <= PIPE_TRANSITION_STEPS; i++) {
    half.push(s.floorHalf + s.radius * Math.sin((wall * i) / PIPE_TRANSITION_STEPS));
  }
  half.push(top + LIP_LINE_WIDTH);
  steps(half, top + LIP_LINE_WIDTH, deck, 1.5);
  steps(half, deck, pipeHalfWidth(s), 1);
  const vs = [...half.slice(1).reverse().map((v) => -v), ...half];

  gridMesh(
    s,
    hf,
    us,
    vs,
    (a, b, tri, color) => {
      const vMid = Math.abs(((vs[b] ?? 0) + (vs[b + 1] ?? 0)) / 2);
      const uMid = ((us[a] ?? 0) + (us[a + 1] ?? 0)) / 2;
      const coping = vMid > top && vMid < top + LIP_LINE_WIDTH && uMid > s.dropIn;
      const dropEdge = uMid > s.dropIn - LIP_LINE_WIDTH && uMid < s.dropIn && vMid < top;
      if (coping || dropEdge) color.copy(LIP_LINE);
      else snowShade(a, b, tri, seed + 307, color);
      return true;
    },
    out,
  );
}

/** Steps along a quarter: fine over its tapered ends, coarser between. */
const QUARTER_STEP_FINE = 0.75;

function createQuarter(q: QuarterShape, hf: Heightfield, seed: number, out: Tris): void {
  const us = [0];
  steps(us, 0, q.taper, QUARTER_STEP_FINE);
  steps(us, q.taper, q.length - q.taper, PIPE_STEP);
  steps(us, q.length - q.taper, q.length, QUARTER_STEP_FINE);
  // Across, from the foot: the transition split by equal angles, the coping, the deck and the bank behind.
  const vs = [0];
  const wall = Math.asin(q.transition / q.radius);
  for (let i = 1; i <= PIPE_TRANSITION_STEPS; i++) vs.push(q.radius * Math.sin((wall * i) / PIPE_TRANSITION_STEPS));
  const coping = Math.min(LIP_LINE_WIDTH, q.deckWidth);
  vs.push(q.transition + coping);
  steps(vs, q.transition + coping, q.transition + q.deckWidth, 1.5);
  steps(vs, q.transition + q.deckWidth, quarterWidth(q), 1);
  // gridMesh winds faces to point up for a grid whose second axis runs to its right; a wall on the left is laid out mirrored.
  const leftHanded = q.rightX * q.dirZ - q.rightZ * q.dirX > 0;
  const across = leftHanded ? vs.map((v) => -v).reverse() : vs;
  const frame: GridFrame = { x: q.x, z: q.z, dirX: q.dirX, dirZ: q.dirZ, rightX: leftHanded ? -q.rightX : q.rightX, rightZ: leftHanded ? -q.rightZ : q.rightZ };
  // Wallride boards run along the wall: one plank per facet up the face.
  gridMesh(
    q,
    hf,
    us,
    across,
    (a, b, tri, color) => {
      const lo = Math.abs(across[b] ?? 0);
      const hi = Math.abs(across[b + 1] ?? 0);
      const vMid = (lo + hi) / 2;
      if (vMid > q.transition && vMid < q.transition + coping) color.copy(LIP_LINE);
      else if (q.wood && vMid <= q.transition) {
        const facet = leftHanded ? across.length - 2 - b : b;
        color.copy(facet === PIPE_TRANSITION_STEPS - 1 ? WOOD_DARK : facet % 2 === 0 ? WOOD : WOOD_MID);
      } else snowShade(a, b, tri, seed + 401, color);
      return true;
    },
    out,
    frame,
  );
}
