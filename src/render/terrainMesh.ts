import { BufferAttribute, BufferGeometry, Color, Mesh, MeshLambertMaterial } from 'three';
import { sampleJump, type JumpSample } from '../maps/jumps.ts';
import { hash2 } from '../maps/terrain.ts';
import type { Heightfield } from '../maps/types.ts';

const SNOW = new Color('#f5f8fc');
const SNOW_SHADE = new Color('#c4d3e6');
const scratch = new Color();

/**
 * Builds a flat-shaded snow mesh from a heightfield plus its visual detail.
 * Triangles don't share vertices, so each face gets its own color from the
 * snow palette.
 */
export function createTerrainMesh(hf: Heightfield, seed: number): Mesh {
  const cells = (hf.cols - 1) * (hf.rows - 1);
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

  for (let row = 0; row < hf.rows - 1; row++) {
    for (let col = 0; col < hf.cols - 1; col++) {
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

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const mesh = new Mesh(geometry, material);
  mesh.matrixAutoUpdate = false;
  return mesh;
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

const jumpSample: JumpSample = { height: 0, dhdx: 0, dhdz: 0, along: 0 };

/** Height of everything drawn as snow at world (x, z): the terrain facets plus any jumps on them. */
export function drawnHeightAt(hf: Heightfield, x: number, z: number): number {
  let h = renderedHeightAt(hf, x, z);
  const jumps = hf.jumps;
  if (jumps) {
    for (let i = 0; i < jumps.length; i++) {
      if (sampleJump(jumps[i]!, x, z, jumpSample)) h += jumpSample.height;
    }
  }
  return h;
}
