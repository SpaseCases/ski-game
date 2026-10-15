import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  MeshLambertMaterial,
} from 'three';
import { sampleJump, type JumpSample } from '../maps/jumps.ts';
import { hash2 } from '../maps/terrain.ts';
import type { BoxFeature, Feature, Heightfield, JumpShape } from '../maps/types.ts';
import { heightAt } from '../sim/terrain.ts';
import { renderedHeightAt } from './terrainMesh.ts';

const DEG = Math.PI / 180;

// Greybox colors: painted wood sides with a metal-gray sliding deck.
const boxSideMaterial = new MeshLambertMaterial({ color: '#8a5a32', flatShading: true });
const boxDeckMaterial = new MeshLambertMaterial({ color: '#9aa4ad', flatShading: true });

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

/** Builds meshes for every feature in the map. */
export function createFeatureMeshes(features: readonly Feature[], hf: Heightfield): Group {
  const group = new Group();
  for (const feature of features) {
    switch (feature.type) {
      case 'box':
        group.add(createBox(feature, hf));
        break;
      case 'jump':
        // Drawn from the shapes the physics uses (see buildJumpShapes).
        break;
    }
  }
  for (const [i, jump] of (hf.jumps ?? []).entries()) group.add(createJump(jump, hf, i));
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

function createBox(box: BoxFeature, hf: Heightfield): Mesh {
  // BoxGeometry face groups: +x, -x, +y (deck), -y, +z, -z.
  const geometry = new BoxGeometry(box.width, box.height, box.length);
  const materials = [
    boxSideMaterial,
    boxSideMaterial,
    boxDeckMaterial,
    boxSideMaterial,
    boxSideMaterial,
    boxSideMaterial,
  ];
  const mesh = new Mesh(geometry, materials);

  // Pitch the box to follow the snow between its two ends.
  const yaw = box.yaw * DEG;
  const ax = Math.sin(yaw) * (box.length / 2);
  const az = Math.cos(yaw) * (box.length / 2);
  const hPlus = heightAt(hf, box.x + ax, box.z + az);
  const hMinus = heightAt(hf, box.x - ax, box.z - az);

  mesh.position.set(box.x, (hPlus + hMinus) / 2 + box.height / 2, box.z);
  mesh.rotation.order = 'YXZ';
  mesh.rotation.set(-Math.atan2(hPlus - hMinus, box.length), yaw, 0);
  mesh.updateMatrix();
  mesh.matrixAutoUpdate = false;
  return mesh;
}
