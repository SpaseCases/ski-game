import { BufferAttribute, BufferGeometry, Color, Group, Mesh, MeshLambertMaterial } from 'three';
import { sampleShape, type ShapeSample } from '../maps/shapes.ts';
import { hash2 } from '../maps/terrain.ts';
import type { Heightfield } from '../maps/types.ts';

const SNOW = new Color('#f5f8fc');
const SNOW_SHADE = new Color('#c4d3e6');
/** Cells per side of one terrain chunk. Each chunk is its own mesh, so chunks off screen or past the fog aren't drawn. */
const CHUNK = 24;
const scratch = new Color();

/**
 * Builds a flat-shaded snow mesh from a heightfield plus its visual detail,
 * split into square chunks that Three.js frustum-culls. Triangles don't share
 * vertices, so each face gets its own color from the snow palette.
 */
export function createTerrainMesh(hf: Heightfield, seed: number): Group {
  const group = new Group();
  const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  for (let r0 = 0; r0 < hf.rows - 1; r0 += CHUNK) {
    for (let c0 = 0; c0 < hf.cols - 1; c0 += CHUNK) {
      const r1 = Math.min(r0 + CHUNK, hf.rows - 1);
      const c1 = Math.min(c0 + CHUNK, hf.cols - 1);
      group.add(createChunk(hf, seed, c0, c1, r0, r1, material));
    }
  }
  return group;
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
    scratch.copy(SNOW).lerp(SNOW_SHADE, t * t * 0.4);
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
