import { BufferAttribute, BufferGeometry, Color, Group, Mesh, MeshLambertMaterial } from 'three';
import { pipeHalfWidth, sampleShape, type ShapeSample } from '../maps/shapes.ts';
import { hash2 } from '../maps/terrain.ts';
import type { Heightfield, PipeShape, RailShape, RampShape, TerrainShape } from '../maps/types.ts';
import { createRailMesh } from './railMesh.ts';
import { renderedHeightAt } from './terrainMesh.ts';

// Shapes are snow, with dyed blue lines along lips (and along the top of a
// halfpipe's walls) so they read from a distance. Start decks are wood.
const SNOW = new Color('#f7f9fd');
const SNOW_SHADE = new Color('#c9d6e8');
const LIP_LINE = new Color('#3f7fe0');
const WOOD = new Color('#a87443');
const WOOD_DARK = new Color('#8f5f35');
const LIP_LINE_WIDTH = 0.6;
/** Plank width (m) on wooden decks. */
const PLANK = 0.3;
/** Grid spacing (m) of ramp meshes, fine enough for a round takeoff. */
const RAMP_STEP = 0.5;
/** Pipe grid: steps along it (fine near the ends, coarse in the middle), and facets per wall transition. */
const PIPE_STEP_FINE = 1;
const PIPE_STEP = 2;
const PIPE_TRANSITION_STEPS = 14;

const material = new MeshLambertMaterial({
  vertexColors: true,
  flatShading: true,
  // Where a shape meets the slope the two surfaces coincide; draw the shape on top.
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
});

/**
 * Builds meshes for every feature in the map, from the same shapes the
 * physics uses: ramps and pipes from the heightfield's shapes, rails and
 * boxes from their slide lines.
 */
export function createFeatureMeshes(hf: Heightfield, rails: readonly RailShape[]): Group {
  const group = new Group();
  for (const [i, shape] of (hf.shapes ?? []).entries()) {
    group.add(shape.kind === 'ramp' ? createRamp(shape, hf, i) : createPipe(shape, hf, i));
  }
  if (rails.length > 0) group.add(createRailMesh(rails, hf));
  return group;
}

/** Face color for one cell of a shape's grid. */
type FaceColor = (a: number, b: number, tri: number, out: Color) => void;

/**
 * A grid laid over the snow: vertex (a, b) sits at world (x, z) from
 * `place`, on the drawn terrain plus this shape's height, so its edges meet
 * the slope seamlessly. Where another shape is higher, that one's mesh
 * covers this one, matching the sim's "highest wins".
 */
function gridMesh(
  shape: TerrainShape,
  hf: Heightfield,
  us: readonly number[],
  vs: readonly number[],
  color: FaceColor,
): Mesh {
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
      const x = shape.x + shape.dirX * u + shape.rightX * v;
      const z = shape.z + shape.dirZ * u + shape.rightZ * v;
      const k = a * (nv + 1) + b;
      gx[k] = x;
      gy[k] = renderedHeightAt(hf, x, z) + (sampleShape(shape, x, z, sample) ? sample.height : 0);
      gz[k] = z;
    }
  }

  const positions = new Float32Array(nu * nv * 18);
  const colors = new Float32Array(nu * nv * 18);
  let p = 0;
  let c = 0;
  const face = new Color();
  const vertex = (a: number, b: number): void => {
    const k = a * (nv + 1) + b;
    positions[p++] = gx[k] ?? 0;
    positions[p++] = gy[k] ?? 0;
    positions[p++] = gz[k] ?? 0;
  };
  const paint = (a: number, b: number, tri: number): void => {
    color(a, b, tri, face);
    for (let k = 0; k < 3; k++) {
      colors[c++] = face.r;
      colors[c++] = face.g;
      colors[c++] = face.b;
    }
  };

  // a runs along the shape and b to its right; this order winds each
  // triangle counter-clockwise seen from above, so faces point up.
  for (let a = 0; a < nu; a++) {
    for (let b = 0; b < nv; b++) {
      vertex(a, b);
      vertex(a + 1, b + 1);
      vertex(a + 1, b);
      paint(a, b, 0);
      vertex(a, b);
      vertex(a, b + 1);
      vertex(a + 1, b + 1);
      paint(a, b, 1);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const mesh = new Mesh(geometry, material);
  mesh.matrixAutoUpdate = false;
  return mesh;
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

function createRamp(r: RampShape, hf: Heightfield, seed: number): Mesh {
  // Grid lines land exactly on every knot, so a lip stays a sharp edge.
  const us = [r.ku[0] ?? 0];
  for (let k = 1; k < r.ku.length; k++) steps(us, r.ku[k - 1] ?? 0, r.ku[k] ?? 0, RAMP_STEP);
  const edge = r.sides ? r.halfWidth + r.sideWidth : r.halfWidth;
  const vs = [-edge];
  if (r.sides) steps(vs, -edge, -r.halfWidth, RAMP_STEP);
  steps(vs, -r.halfWidth, r.halfWidth, RAMP_STEP);
  if (r.sides) steps(vs, r.halfWidth, edge, RAMP_STEP);

  return gridMesh(r, hf, us, vs, (a, b, tri, out) => {
    const uMid = ((us[a] ?? 0) + (us[a + 1] ?? 0)) / 2;
    let k = 1;
    while (k < r.ku.length - 1 && uMid > (r.ku[k] ?? 0)) k++;
    if (r.wood[k]) {
      out.copy(Math.floor(uMid / PLANK) % 2 === 0 ? WOOD : WOOD_DARK);
    } else if (r.lips.some((lip) => uMid > lip - LIP_LINE_WIDTH && uMid < lip)) {
      out.copy(LIP_LINE);
    } else {
      snowShade(a, b, tri, seed + 211, out);
    }
  });
}

function createPipe(s: PipeShape, hf: Heightfield, seed: number): Mesh {
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

  return gridMesh(s, hf, us, vs, (a, b, tri, out) => {
    const vMid = Math.abs(((vs[b] ?? 0) + (vs[b + 1] ?? 0)) / 2);
    const uMid = ((us[a] ?? 0) + (us[a + 1] ?? 0)) / 2;
    const coping = vMid > top && vMid < top + LIP_LINE_WIDTH && uMid > s.dropIn;
    const dropEdge = uMid > s.dropIn - LIP_LINE_WIDTH && uMid < s.dropIn && vMid < top;
    if (coping || dropEdge) out.copy(LIP_LINE);
    else snowShade(a, b, tri, seed + 307, out);
  });
}
