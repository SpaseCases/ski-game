import { Group, InstancedMesh, Mesh, type Material, type Object3D } from 'three';
import type { BuiltMap } from '../maps/build.ts';
import { layoutDecor } from '../maps/decor.ts';
import type { RunState } from '../sim/checkpoints.ts';
import type { RaceState } from '../sim/race.ts';
import { CheckpointView } from './checkpointMeshes.ts';
import { createDecor } from './decor.ts';
import { createFeatureMeshes } from './features.ts';
import { SlalomView } from './slalomView.ts';
import { StartGateView } from './startGates.ts';
import { createTerrainMesh } from './terrainMesh.ts';

/**
 * Everything drawn for one map: the snow, the features on it, start gates,
 * slalom poles, flags and the finish, and the decoration. Added to the scene
 * as one group, and freed in one go when another map is picked.
 */
export class WorldView {
  readonly group = new Group();
  private readonly built: BuiltMap;
  private readonly startView: StartGateView;
  private readonly slalomView: SlalomView | null;
  private readonly checkpointView: CheckpointView;
  private decor: Group;

  /** `density`: the share of scenery decoration to draw (see decorDensity). */
  constructor(built: BuiltMap, density: number) {
    this.built = built;
    const { map, hf, starts, course, race } = built;
    this.group.add(createTerrainMesh(hf, map.terrain.seed));
    this.group.add(createFeatureMeshes(hf, course.rails));
    this.startView = new StartGateView(starts, hf);
    this.group.add(this.startView.group);
    this.slalomView = race && race.gates.length > 0 ? new SlalomView(race, hf) : null;
    if (this.slalomView) this.group.add(this.slalomView.mesh);
    this.decor = createDecor(layoutDecor(map, hf, density), hf);
    this.group.add(this.decor);
    this.checkpointView = new CheckpointView(map, hf);
    this.group.add(this.checkpointView.group);
  }

  /** Redraws the decoration at another density. */
  setDensity(density: number): void {
    this.group.remove(this.decor);
    disposeTree(this.decor);
    this.decor = createDecor(layoutDecor(this.built.map, this.built.hf, density), this.built.hf);
    this.group.add(this.decor);
  }

  update(run: RunState, race: RaceState | null, frameTime: number): void {
    this.startView.update(race ? race.wandTime : Infinity);
    this.slalomView?.update(race);
    this.checkpointView.update(run, this.built.hf, frameTime);
  }

  /** Frees every geometry and material. Shared materials just get rebuilt the next time they're drawn. */
  dispose(): void {
    this.group.removeFromParent();
    disposeTree(this.group);
  }
}

function disposeTree(root: Object3D): void {
  const materials = new Set<Material>();
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    o.geometry.dispose();
    // Instance matrices and colors live on the mesh, not the geometry.
    if (o instanceof InstancedMesh) o.dispose();
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m as Material);
  });
  for (const m of materials) m.dispose();
}
