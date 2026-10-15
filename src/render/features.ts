import { BufferAttribute, BufferGeometry, Color, Group, Mesh, MeshLambertMaterial } from 'three';
import { sampleJump, type JumpSample } from '../maps/jumps.ts';
import { hash2 } from '../maps/terrain.ts';
import type { Heightfield, JumpShape, RailShape } from '../maps/types.ts';
import { createRailMesh } from './railMesh.ts';
import { renderedHeightAt } from './terrainMesh.ts';

// Jumps are snow, with a dyed blue line along the lip so it reads from the in-run.
const JUMP_SNOW = new Color('#f7f9fd');
const JUMP_SHADE = new Color('#c9d6e8');
const LIP_LINE = new Color('#3f7fe0');
const LIP_LINE_WIDTH = 0.6;
/** Grid spacing (m) of jump meshes, fine enough for a round takeoff. */
const JUMP_STEP = 0.5;
const jumpMaterial = new MeshLambertMaterial({
  vertexColors: true,
  flatShading: true,
  // Where a jump meets the slope the two surfaces coincide; draw the jump on top.
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
});

/**
 * Builds meshes for every feature in the map, from the same shapes the
 * physics uses: jumps from the heightfield's jump shapes, rails and boxes
 * from their slide lines.
 */
export function createFeatureMeshes(hf: Heightfield, rails: readonly RailShape[]): Group {
  const group = new Group();
  for (const [i, jump] of (hf.jumps ?? []).entries()) group.add(createJump(jump, hf, i));
  if (rails.length > 0) group.add(createRailMesh(rails, hf));
  return group;
}

/**
 * A jump is a fine grid laid over the snow: each vertex sits on the drawn
 * terrain plus the jump's height, so its edges meet the slope seamlessly.
 */
function createJump(j: JumpShape, hf: Heightfield, seed: number): Mesh {
  const edge = j.halfWidth + j.sideWidth;
  const nu = Math.ceil(j.landingEnd / JUMP_STEP);
  const nv = Math.ceil((2 * edge) / JUMP_STEP);
  const du = j.landingEnd / nu;
  const dv = (2 * edge) / nv;
  const sample: JumpSample = { height: 0, dhdx: 0, dhdz: 0, along: 0 };

  // Vertex heights on the (nu + 1) x (nv + 1) grid.
  const gx = new Float32Array((nu + 1) * (nv + 1));
  const gy = new Float32Array((nu + 1) * (nv + 1));
  const gz = new Float32Array((nu + 1) * (nv + 1));
  for (let a = 0; a <= nu; a++) {
    for (let b = 0; b <= nv; b++) {
      const u = a * du;
      const v = -edge + b * dv;
      const x = j.x + j.dirX * u + j.rightX * v;
      const z = j.z + j.dirZ * u + j.rightZ * v;
      const bump = sampleJump(j, x, z, sample) ? sample.height : 0;
      const k = a * (nv + 1) + b;
      gx[k] = x;
      gy[k] = renderedHeightAt(hf, x, z) + bump;
      gz[k] = z;
    }
  }

  const positions = new Float32Array(nu * nv * 18);
  const colors = new Float32Array(nu * nv * 18);
  let p = 0;
  let c = 0;
  const color = new Color();
  const vertex = (a: number, b: number): void => {
    const k = a * (nv + 1) + b;
    positions[p++] = gx[k] ?? 0;
    positions[p++] = gy[k] ?? 0;
    positions[p++] = gz[k] ?? 0;
  };
  const face = (a: number, b: number, tri: number): void => {
    const uMid = (a + 0.5) * du;
    if (uMid > j.lipAt - LIP_LINE_WIDTH && uMid < j.lipAt) {
      color.copy(LIP_LINE);
    } else {
      const t = 0.5 + 0.5 * hash2(a * 2 + tri, b, seed + 211);
      color.copy(JUMP_SNOW).lerp(JUMP_SHADE, t * t * 0.35);
    }
    for (let k = 0; k < 3; k++) {
      colors[c++] = color.r;
      colors[c++] = color.g;
      colors[c++] = color.b;
    }
  };

  // a runs along the jump and b to its right; this order winds each
  // triangle counter-clockwise seen from above, so faces point up.
  for (let a = 0; a < nu; a++) {
    for (let b = 0; b < nv; b++) {
      vertex(a, b);
      vertex(a + 1, b + 1);
      vertex(a + 1, b);
      face(a, b, 0);
      vertex(a, b);
      vertex(a, b + 1);
      vertex(a + 1, b + 1);
      face(a, b, 1);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const mesh = new Mesh(geometry, jumpMaterial);
  mesh.matrixAutoUpdate = false;
  return mesh;
}
