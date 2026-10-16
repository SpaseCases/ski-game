import { BufferAttribute, BufferGeometry, Color, Group, Mesh, MeshLambertMaterial } from 'three';
import { sampleShape, type ShapeSample } from '../maps/shapes.ts';
import { hash2 } from '../maps/terrain.ts';
import type { Heightfield } from '../maps/types.ts';

const SNOW = new Color('#f5f8fc');
const SNOW_SHADE = new Color('#c4d3e6');
/** Rock faces: a mid and a dark gray, with a little variation between facets. */
const ROCK = new Color('#7a8189');
const ROCK_DARK = new Color('#5e656d');
/** Cells per side of a near chunk (72 m at 3 m cells). Each chunk is its own mesh, so chunks off screen aren't drawn. */
const CHUNK = 24;
/** Near chunks per side of a far chunk: the same ground drawn coarsely as one mesh, when it's far away. */
const GROUP = 4;
/** Far chunks whose nearest point is closer than this (m) are drawn as their near chunks instead. */
const SPLIT = 330;
/** With distant detail on, near chunks farther than this (m) use every other sample. */
const DETAIL = 200;
/** Far chunks use every FAR_STEP-th sample. */
const FAR_STEP = 4;
/** Chunks this much (m) past the view range are freed; within it they're kept, so riding back and forth doesn't rebuild them. */
const FREE_SLACK = 120;
const scratch = new Color();

/**
 * The snow: a flat-shaded mesh of the heightfield plus its visual detail,
 * in square chunks built around the camera, nearest first and a few per
 * frame, and freed once left far behind, so a big mountain costs no more
 * than what's in view. With a long view range, ground in the distance is
 * drawn coarser: near chunks past DETAIL use every other sample, and past
 * SPLIT a far chunk covers 4 × 4 near chunks with every fourth sample in
 * one mesh. Chunks of different coarseness can leave hairline cracks where
 * they meet, so then every chunk hangs a skirt down from its edges to hide
 * them. Triangles don't share vertices, so each face gets its own color:
 * snow, or rock where the heightfield says the ground is rock.
 */
export class TerrainView {
  readonly group = new Group();
  private readonly hf: Heightfield;
  private readonly seed: number;
  private readonly material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  /** Near chunks across and down, and far chunks across and down. */
  private readonly nx: number;
  private readonly nz: number;
  private readonly gx: number;
  private readonly gz: number;
  private readonly near: (Mesh | null)[];
  /** The sample step each built near chunk used (1 or 2). */
  private readonly nearStep: Uint8Array;
  private readonly far: (Mesh | null)[];
  private readonly builtNear: number[] = [];
  private readonly builtFar: number[] = [];
  /** Per-update scratch: the far chunks in range and their distances, nearest first. */
  private readonly order: Int32Array;
  private readonly orderDist: Float64Array;
  /** Coarser ground in the distance (and skirts to hide the seams), for long view ranges. */
  private lod = false;

  constructor(hf: Heightfield, seed: number) {
    this.hf = hf;
    this.seed = seed;
    this.nx = Math.ceil((hf.cols - 1) / CHUNK);
    this.nz = Math.ceil((hf.rows - 1) / CHUNK);
    this.gx = Math.ceil(this.nx / GROUP);
    this.gz = Math.ceil(this.nz / GROUP);
    this.near = new Array<Mesh | null>(this.nx * this.nz).fill(null);
    this.nearStep = new Uint8Array(this.nx * this.nz);
    this.far = new Array<Mesh | null>(this.gx * this.gz).fill(null);
    this.order = new Int32Array(this.gx * this.gz);
    this.orderDist = new Float64Array(this.gx * this.gz);
  }

  /**
   * Builds what's missing within `range` (m, flat across the map) of
   * (x, z), nearest first, at most `budget` chunks, and frees what's far
   * past it. Coarser distant ground is used when the range reaches past SPLIT.
   */
  update(x: number, z: number, range: number, budget: number): void {
    const lod = range > SPLIT;
    if (lod !== this.lod) {
      // Skirts come and go with distant detail: start over.
      this.lod = lod;
      this.clear();
    }
    const free = range + FREE_SLACK;
    for (let k = this.builtNear.length - 1; k >= 0; k--) {
      const i = this.builtNear[k]!;
      if (this.square(i % this.nx, Math.floor(i / this.nx), CHUNK, x, z) > free) this.dropNear(i);
    }
    for (let k = this.builtFar.length - 1; k >= 0; k--) {
      const i = this.builtFar[k]!;
      if (this.square(i % this.gx, Math.floor(i / this.gx), CHUNK * GROUP, x, z) > free) this.dropFar(i);
    }

    // Far chunks in range, nearest first (insertion sort: there are only a few dozen).
    const span = CHUNK * GROUP * this.hf.cellSize;
    const c0 = Math.max(0, Math.floor((x - range - this.hf.originX) / span));
    const c1 = Math.min(this.gx - 1, Math.floor((x + range - this.hf.originX) / span));
    const r0 = Math.max(0, Math.floor((z - range - this.hf.originZ) / span));
    const r1 = Math.min(this.gz - 1, Math.floor((z + range - this.hf.originZ) / span));
    let count = 0;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const d = this.square(c, r, CHUNK * GROUP, x, z);
        if (d > range) continue;
        let k = count++;
        while (k > 0 && this.orderDist[k - 1]! > d) {
          this.order[k] = this.order[k - 1]!;
          this.orderDist[k] = this.orderDist[k - 1]!;
          k--;
        }
        this.order[k] = r * this.gx + c;
        this.orderDist[k] = d;
      }
    }

    let left = budget;
    for (let k = 0; k < count; k++) {
      const g = this.order[k]!;
      const gc = g % this.gx;
      const gr = (g - gc) / this.gx;
      if (!lod || this.orderDist[k]! < SPLIT) {
        // Drawn as its near chunks. The far chunk stays until they're all there, so nothing flickers open.
        let complete = true;
        for (let r = gr * GROUP; r < Math.min((gr + 1) * GROUP, this.nz); r++) {
          for (let c = gc * GROUP; c < Math.min((gc + 1) * GROUP, this.nx); c++) {
            const d = this.square(c, r, CHUNK, x, z);
            if (d > range) continue;
            const i = r * this.nx + c;
            const step = lod && d > DETAIL ? 2 : 1;
            if (this.near[i] && this.nearStep[i] === step) continue;
            if (left <= 0) {
              if (!this.near[i]) complete = false;
              continue;
            }
            left--;
            if (this.near[i]) this.dropNear(i);
            this.buildNear(c, r, step);
          }
        }
        if (complete && this.far[g]) this.dropFar(g);
      } else {
        // Drawn as one coarse far chunk; its near chunks go once it's there.
        if (!this.far[g]) {
          if (left <= 0) continue;
          left--;
          this.buildFar(gc, gr);
        }
        for (let r = gr * GROUP; r < Math.min((gr + 1) * GROUP, this.nz); r++) {
          for (let c = gc * GROUP; c < Math.min((gc + 1) * GROUP, this.nx); c++) {
            if (this.near[r * this.nx + c]) this.dropNear(r * this.nx + c);
          }
        }
      }
    }
  }

  /** Frees every chunk. */
  clear(): void {
    while (this.builtNear.length > 0) this.dropNear(this.builtNear[this.builtNear.length - 1]!);
    while (this.builtFar.length > 0) this.dropFar(this.builtFar[this.builtFar.length - 1]!);
  }

  private buildNear(c: number, r: number, step: number): void {
    const hf = this.hf;
    const mesh = createChunk(hf, this.seed, c * CHUNK, Math.min((c + 1) * CHUNK, hf.cols - 1), r * CHUNK, Math.min((r + 1) * CHUNK, hf.rows - 1), step, this.lod, this.material);
    const i = r * this.nx + c;
    this.near[i] = mesh;
    this.nearStep[i] = step;
    this.builtNear.push(i);
    this.group.add(mesh);
  }

  private buildFar(c: number, r: number): void {
    const hf = this.hf;
    const n = CHUNK * GROUP;
    const mesh = createChunk(hf, this.seed, c * n, Math.min((c + 1) * n, hf.cols - 1), r * n, Math.min((r + 1) * n, hf.rows - 1), FAR_STEP, true, this.material);
    const i = r * this.gx + c;
    this.far[i] = mesh;
    this.builtFar.push(i);
    this.group.add(mesh);
  }

  private dropNear(i: number): void {
    const mesh = this.near[i];
    if (!mesh) return;
    this.group.remove(mesh);
    mesh.geometry.dispose();
    this.near[i] = null;
    const k = this.builtNear.indexOf(i);
    this.builtNear[k] = this.builtNear[this.builtNear.length - 1]!;
    this.builtNear.pop();
  }

  private dropFar(i: number): void {
    const mesh = this.far[i];
    if (!mesh) return;
    this.group.remove(mesh);
    mesh.geometry.dispose();
    this.far[i] = null;
    const k = this.builtFar.indexOf(i);
    this.builtFar[k] = this.builtFar[this.builtFar.length - 1]!;
    this.builtFar.pop();
  }

  /** Flat distance from (x, z) to the square of `cells` cells per side at grid spot (c, r) (0 inside it). */
  private square(c: number, r: number, cells: number, x: number, z: number): number {
    const span = cells * this.hf.cellSize;
    const x0 = this.hf.originX + c * span;
    const z0 = this.hf.originZ + r * span;
    const dx = Math.max(x0 - x, 0, x - (x0 + span));
    const dz = Math.max(z0 - z, 0, z - (z0 + span));
    return Math.sqrt(dx * dx + dz * dz);
  }
}

/**
 * One chunk's mesh: the cells from column c0 to c1 and row r0 to r1, using
 * every `step`-th sample, with a skirt hanging from its edges if asked.
 */
function createChunk(
  hf: Heightfield,
  seed: number,
  c0: number,
  c1: number,
  r0: number,
  r1: number,
  step: number,
  skirt: boolean,
  material: MeshLambertMaterial,
): Mesh {
  const nc = Math.ceil((c1 - c0) / step);
  const nr = Math.ceil((r1 - r0) / step);
  const edges = skirt ? 2 * (nc + nr) : 0;
  const positions = new Float32Array((nc * nr + edges) * 18);
  const colors = new Float32Array((nc * nr + edges) * 18);
  let p = 0;
  let c = 0;

  const vertex = (col: number, row: number): void => {
    positions[p++] = hf.originX + col * hf.cellSize;
    positions[p++] = drawnSample(hf, col, row);
    positions[p++] = hf.originZ + row * hf.cellSize;
  };
  const color = (col: number, row: number, k: number, rocky: number): void => {
    const t = 0.5 + 0.5 * hash2(col * 2 + k, row, seed + 101);
    if (rocky > 0.5 + 0.12 * hash2(col, row, seed + 7)) scratch.copy(ROCK).lerp(ROCK_DARK, t);
    else scratch.copy(SNOW).lerp(SNOW_SHADE, t * t * 0.4);
    for (let n = 0; n < 3; n++) {
      colors[c++] = scratch.r;
      colors[c++] = scratch.g;
      colors[c++] = scratch.b;
    }
  };

  const rock = hf.rock;
  const rockAt = (col: number, row: number): number => (rock ? (rock[row * hf.cols + col] ?? 0) / 255 : 0);
  for (let row = r0; row < r1; row += step) {
    const rowB = Math.min(row + step, r1);
    for (let col = c0; col < c1; col += step) {
      const colB = Math.min(col + step, c1);
      const rocky = (rockAt(col, row) + rockAt(colB, row) + rockAt(col, rowB) + rockAt(colB, rowB)) / 4;
      // Counter-clockwise from above so faces point up, split along whichever
      // diagonal fits the snow better (see splitsMain).
      if (splitsMain(hf, col, row, colB, rowB)) {
        vertex(col, row);
        vertex(colB, rowB);
        vertex(colB, row);
        color(col, row, 0, rocky);
        vertex(col, row);
        vertex(col, rowB);
        vertex(colB, rowB);
        color(col, row, 1, rocky);
      } else {
        vertex(col, row);
        vertex(col, rowB);
        vertex(colB, row);
        color(col, row, 0, rocky);
        vertex(colB, row);
        vertex(col, rowB);
        vertex(colB, rowB);
        color(col, row, 1, rocky);
      }
    }
  }

  if (skirt) {
    // A wall hanging down from each edge, facing out, deep enough to cover
    // the gap to a neighbor drawn at another coarseness.
    const depth = 2 + 2 * step;
    const wall = (ca: number, ra: number, cb: number, rb: number, outX: number, outZ: number): void => {
      const ax = hf.originX + ca * hf.cellSize;
      const az = hf.originZ + ra * hf.cellSize;
      const bx = hf.originX + cb * hf.cellSize;
      const bz = hf.originZ + rb * hf.cellSize;
      const ay = drawnSample(hf, ca, ra);
      const by = drawnSample(hf, cb, rb);
      // Facing out: the wall's normal is (-(bz - az), 0, bx - ax) in this order; if that points in, swap a and b.
      const flip = -(bz - az) * outX + (bx - ax) * outZ < 0;
      const [x1, y1, z1, x2, y2, z2] = flip ? [bx, by, bz, ax, ay, az] : [ax, ay, az, bx, by, bz];
      positions.set([x1, y1, z1, x1, y1 - depth, z1, x2, y2, z2, x2, y2, z2, x1, y1 - depth, z1, x2, y2 - depth, z2], p);
      p += 18;
      for (let n = 0; n < 6; n++) {
        colors[c++] = SNOW_SHADE.r;
        colors[c++] = SNOW_SHADE.g;
        colors[c++] = SNOW_SHADE.b;
      }
    };
    for (let col = c0; col < c1; col += step) {
      const colB = Math.min(col + step, c1);
      wall(col, r0, colB, r0, 0, -1);
      wall(col, r1, colB, r1, 0, 1);
    }
    for (let row = r0; row < r1; row += step) {
      const rowB = Math.min(row + step, r1);
      wall(c0, row, c0, rowB, -1, 0);
      wall(c1, row, c1, rowB, 1, 0);
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

/** Drawn height of one heightfield sample: the snow plus its visual jitter. */
function drawnSample(hf: Heightfield, col: number, row: number): number {
  const i = row * hf.cols + col;
  return (hf.heights[i] ?? 0) + (hf.detail?.[i] ?? 0);
}

/**
 * Which way a cell (corners (ca, ra) to (cb, rb)) is split into two
 * triangles: along the diagonal from (ca, ra) to (cb, rb), or along the
 * other one. Splitting along the corners that are closer in height follows
 * the ground's contours, so a wall or ridge running at an angle to the grid
 * stays a clean face instead of a sawtooth.
 */
function splitsMain(hf: Heightfield, ca: number, ra: number, cb: number, rb: number): boolean {
  const main = Math.abs(drawnSample(hf, ca, ra) - drawnSample(hf, cb, rb));
  const other = Math.abs(drawnSample(hf, cb, ra) - drawnSample(hf, ca, rb));
  return main <= other;
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
  const h00 = drawnSample(hf, col, row);
  const h10 = drawnSample(hf, col + 1, row);
  const h01 = drawnSample(hf, col, row + 1);
  const h11 = drawnSample(hf, col + 1, row + 1);
  // Matches the triangle split in createChunk.
  if (splitsMain(hf, col, row, col + 1, row + 1)) {
    if (fx >= fz) return h00 + fx * (h10 - h00) + fz * (h11 - h10);
    return h00 + fz * (h01 - h00) + fx * (h11 - h01);
  }
  if (fx + fz <= 1) return h00 + fx * (h10 - h00) + fz * (h01 - h00);
  return h11 + (1 - fx) * (h01 - h11) + (1 - fz) * (h10 - h11);
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
