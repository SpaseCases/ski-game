import { BoxGeometry, Group, Mesh, MeshLambertMaterial } from 'three';
import type { BoxFeature, Feature, Heightfield } from '../maps/types.ts';
import { heightAt } from '../sim/terrain.ts';

const DEG = Math.PI / 180;

// Greybox colors: painted wood sides with a metal-gray sliding deck.
const boxSideMaterial = new MeshLambertMaterial({ color: '#8a5a32', flatShading: true });
const boxDeckMaterial = new MeshLambertMaterial({ color: '#9aa4ad', flatShading: true });

/** Builds meshes for every feature in the map. */
export function createFeatureMeshes(features: readonly Feature[], hf: Heightfield): Group {
  const group = new Group();
  for (const feature of features) {
    switch (feature.type) {
      case 'box':
        group.add(createBox(feature, hf));
        break;
    }
  }
  return group;
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
