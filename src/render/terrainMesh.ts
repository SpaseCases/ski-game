import { BufferAttribute, BufferGeometry, Color, Group, Mesh, MeshLambertMaterial } from 'three';
import { sampleShape, type ShapeSample } from '../maps/shapes.ts';
import { hash2 } from '../maps/terrain.ts';
import type { Heightfield } from '../maps/types.ts';

const SNOW = new Color('#f5f8fc');
const SNOW_SHADE = new Color('#c4d3e6');
/** Rock faces: a mid and a dark gray, with a little variation between facets. */
const ROCK = new Color('#7a8189');
const ROCK_DARK = new Color('#5e656d');
/** Cells per side of one terrain chunk. Each chunk is its own mesh, so chunks off screen or past the fog aren't drawn. */
const CHUNK = 24;
/** Chunks this much (m) past the view range are freed; within it they're kept, so riding back and forth doesn't rebuild them. */
const FREE_SLACK = 120;
const DEG = Math.PI / 180;
const scratch = new Color();

/**
 * The snow: a flat-shaded mesh of the heightfield plus its visual detail,
 * split into square chunks. Only chunks within the camera's view range are
 * built, nearest first and a few per frame, and ones left far behind are
 * freed, so a big mountain costs no more than what's around the rider.
 * Triangles don't share vertices, so each face gets its own color: snow,
 * or rock where it's steeper than the map's rockSlope.
 */
export class TerrainView {
  readonly group = new Group();
  private readonly hf: Heightfield;
  private readonly seed: number;
  private readonly material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  private readonly nx: number;
  private readonly nz: number;
  private readonly chunks: (Mesh | null)[];
  /** Indices of the chunks that are built. */
  private readonly built: number[] = [];

  constructor(hf: Heightfield, seed: number) {
    this.hf = hf;
    this.seed = seed;
    this.nx = Math.ceil((hf.cols - 1) / CHUNK);
    this.nz = Math.ceil((hf.rows - 1) / CHUNK);
    this.chunks = new Array<Mesh | null>(this.nx * this.nz).fill(null);
  }

  /**
   * Builds the missing chunks within `range` (m, flat across the map) of
   * (x, z), nearest first, at most `budget` of them, and frees the ones far
   * past it.
   */
  update(x: number, z: number, range: number, budget: number): void {
    const free = range + FREE_SLACK;
    for (let k = this.built.length - 1; k >= 0; k--) {
      const index = this.built[k]!;
      if (this.distance(index, x, z) <= free) continue;
      const mesh = this.chunks[index]!;
      this.group.remove(mesh);
      mesh.geometry.dispose();
      this.chunks[index] = null;
      this.built[k] = this.built[this.built.length - 1]!;
      this.built.pop();
    }
    const span = CHUNK * this.hf.cellSize;
    const c0 = Math.max(0, Math.floor((x - range - this.hf.originX) / span));
    const c1 = Math.min(this.nx - 1, Math.floor((x + range - this.hf.originX) / span));
    const r0 = Math.max(0, Math.floor((z - range - this.hf.originZ) / span));
    const r1 = Math.min(this.nz - 1, Math.floor((z + range - this.hf.originZ) / span));
    for (let n = 0; n < budget; n++) {
      let nearest = -1;
      let best = range;
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const index = r * this.nx + c;
          if (this.chunks[index]) continue;
          const d = this.distance(index, x, z);
          if (d <= best) {
            best = d;
            nearest = index;
          }
        }
      }
      if (nearest < 0) return;
      const c = nearest % this.nx;
      const r = (nearest - c) / this.nx;
      const mesh = createChunk(
        this.hf,
        this.seed,
        c * CHUNK,
        Math.min((c + 1) * CHUNK, this.hf.cols - 1),
        r * CHUNK,
        Math.min((r + 1) * CHUNK, this.hf.rows - 1),
        this.material,
      );
      this.chunks[nearest] = mesh;
      this.built.push(nearest);
      this.group.add(mesh);
    }
  }

  /** Flat distance from (x, z) to a chunk's square (0 inside it). */
  private distance(index: number, x: number, z: number): number {
    const span = CHUNK * this.hf.cellSize;
    const c = index % this.nx;
    const r = (index - c) / this.nx;
    const x0 = this.hf.originX + c * span;
    const z0 = this.hf.originZ + r * span;
    const dx = Math.max(x0 - x, 0, x - (x0 + span));
    const dz = Math.max(z0 - z, 0, z - (z0 + span));
    return Math.hypot(dx, dz);
  }
}

function createChunk(
  hf: Heightfield,
  seed: number,
  c0: number,
  c1: number,
  r0: number,
  r1: number,
  material: MeshLambertMaterial,
): Mesh {
  const cells = (c1 - c0) * (r1 - r0);
  const positions = new Float32Array(cells * 18);
  const colors = new Float32Array(cells * 18);
  // Rock where a face is steeper than this: its normal's up part is under it.
  const rockUp = hf.rockSlope === undefined ? -1 : Math.cos(hf.rockSlope * DEG);
  let p = 0;
  let c = 0;

  const vertex = (col: number, row: number): void => {
    const i = row * hf.cols + col;
    positions[p++] = hf.originX + col * hf.cellSize;
    positions[p++] = (hf.heights[i] ?? 0) + (hf.detail?.[i] ?? 0);
    positions[p++] = hf.originZ + row * hf.cellSize;
  };
  const faceColor = (col: number, row: number, tri: number): void => {
    const t = 0.5 + 0.5 * hash2(col * 2 + tri, row, seed + 101);
    if (rockUp >= 0 && faceUp(positions, p - 9) < rockUp + 0.06 * (t - 0.5)) {
      scratch.copy(ROCK).lerp(ROCK_DARK, t);
    } else {
      scratch.copy(SNOW).lerp(SNOW_SHADE, t * t * 0.4);
    }
    for (let k = 0; k < 3; k++) {
      colors[c++] = scratch.r;
      colors[c++] = scratch.g;
      colors[c++] = scratch.b;
    }
  };

  for (let row = r0; row < r1; row++) {
    for (let col = c0; col < c1; col++) {
      // Counter-clockwise from above so faces point up.
      vertex(col, row);
      vertex(col + 1, row + 1);
      vertex(col + 1, row);
      faceColor(col, row, 0);

      vertex(col, row);
      vertex(col, row + 1);
      vertex(col + 1, row + 1);
      faceColor(col, row, 1);
    }
  }

  // No normals: flat shading works them out per face on the GPU. Once the
  // chunk is on the GPU its arrays aren't needed here, so they're let go.
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3).onUpload(releaseArray));
  geometry.setAttribute('color', new BufferAttribute(colors, 3).onUpload(releaseArray));
  geometry.computeBoundingSphere();
  const mesh = new Mesh(geometry, material);
  mesh.matrixAutoUpdate = false;
  return mesh;
}

/** The up part of the unit normal of the triangle whose three corners start at positions[at]. */
function faceUp(positions: Float32Array, at: number): number {
  const ax = positions[at + 3]! - positions[at]!;
  const ay = positions[at + 4]! - positions[at + 1]!;
  const az = positions[at + 5]! - positions[at + 2]!;
  const bx = positions[at + 6]! - positions[at]!;
  const by = positions[at + 7]! - positions[at + 1]!;
  const bz = positions[at + 8]! - positions[at + 2]!;
  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;
  return Math.abs(ny) / Math.hypot(nx, ny, nz);
}

function releaseArray(this: BufferAttribute): void {
  this.array = new Float32Array(0);
}

/**
 * Height of the drawn snow (the flat triangles above, including the visual
 * detail) at world (x, z). Used to sit other meshes exactly on the snow.
 */
export function renderedHeightAt(hf: Heightfield, x: number, z: number): number {
  const gx = Math.min(Math.max((x - hf.originX) / hf.cellSize, 0), hf.cols - 1);
  const gz = Math.min(Math.max((z - hf.originZ) / hf.cellSize, 0), hf.rows - 1);
  const col = Math.min(Math.floor(gx), hf.cols - 2);
  const row = Math.min(Math.floor(gz), hf.rows - 2);
  const fx = gx - col;
  const fz = gz - row;
  const h = (c: number, r: number): number => {
    const i = r * hf.cols + c;
    return (hf.heights[i] ?? 0) + (hf.detail?.[i] ?? 0);
  };
  const h00 = h(col, row);
  const h11 = h(col + 1, row + 1);
  // Matches the triangle split in createTerrainMesh.
  if (fx >= fz) {
    const h10 = h(col + 1, row);
    return h00 + fx * (h10 - h00) + fz * (h11 - h10);
  }
  const h01 = h(col, row + 1);
  return h00 + fz * (h01 - h00) + fx * (h11 - h01);
}

const shapeSample: ShapeSample = { height: 0, dhdx: 0, dhdz: 0 };

/** Height the shapes (jumps, pipes, decks) add at world (x, z): the highest one wins, as in the sim. */
export function shapeHeightAt(hf: Heightfield, x: number, z: number): number {
  let top = 0;
  const shapes = hf.shapes;
  if (shapes) {
    for (let i = 0; i < shapes.length; i++) {
      if (sampleShape(shapes[i]!, x, z, shapeSample)) top = Math.max(top, shapeSample.height);
    }
  }
  return top;
}

/** Height of everything drawn as snow at world (x, z): the terrain facets plus any shapes on them. */
export function drawnHeightAt(hf: Heightfield, x: number, z: number): number {
  return renderedHeightAt(hf, x, z) + shapeHeightAt(hf, x, z);
}
