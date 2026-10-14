import { BufferAttribute, BufferGeometry, Color, Mesh, MeshLambertMaterial } from 'three';
import { hash2 } from '../maps/terrain.ts';
import type { Heightfield } from '../maps/types.ts';

const SNOW = new Color('#f5f8fc');
const SNOW_SHADE = new Color('#c4d3e6');
const scratch = new Color();

/**
 * Builds a flat-shaded snow mesh from a heightfield. Triangles don't share
 * vertices, so each face gets its own color from the snow palette.
 * The cell split matches sim/terrain.ts so the surface and the physics agree.
 */
export function createTerrainMesh(hf: Heightfield, seed: number): Mesh {
  const cells = (hf.cols - 1) * (hf.rows - 1);
  const positions = new Float32Array(cells * 18);
  const colors = new Float32Array(cells * 18);
  let p = 0;
  let c = 0;

  const vertex = (col: number, row: number): void => {
    positions[p++] = hf.originX + col * hf.cellSize;
    positions[p++] = hf.heights[row * hf.cols + col] ?? 0;
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
