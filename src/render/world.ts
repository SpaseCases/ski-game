import { Group, InstancedMesh, Mesh, type Material, type Object3D } from 'three';
import type { BuiltMap } from '../maps/build.ts';
import { thinDecor } from '../maps/decor.ts';
import type { RunState } from '../sim/checkpoints.ts';
import type { RaceState } from '../sim/race.ts';
import { CheckpointView } from './checkpointMeshes.ts';
import { DistanceCuller } from './culling.ts';
import { createDecor } from './decor.ts';
import { createFeatureMeshes } from './features.ts';
import { SlalomView } from './slalomView.ts';
import { StartGateView } from './startGates.ts';
import { TerrainView } from './terrainMesh.ts';

/** Terrain chunks built per frame while riding (after a jump to a new spot, everything in view is built at once). */
const CHUNKS_PER_FRAME = 3;

/**
 * Everything drawn for one map: the snow, the features on it, start gates,
 * slalom poles, flags and the finishes, and the decoration. Added to the
 * scene as one group, and freed in one go when another map is picked. The
 * snow is built around the camera as it moves, and decoration past the
 * camera's view range is hidden.
 */
export class WorldView {
  readonly group = new Group();
  private readonly built: BuiltMap;
  private readonly terrain: TerrainView;
  private readonly startView: StartGateView;
  private readonly slalomView: SlalomView | null;
  private readonly checkpointView: CheckpointView;
  private decor: Group;
  private culler = new DistanceCuller();

  /** `density`: the share of scenery decoration to draw (see decorDensity). */
  constructor(built: BuiltMap, density: number) {
    this.built = built;
    this.group.matrixAutoUpdate = false;
    const { map, hf, starts, course, race } = built;
    this.terrain = new TerrainView(hf, map.terrain.seed);
    this.group.add(still(this.terrain.group));
    this.group.add(createFeatureMeshes(hf, course.rails));
    this.startView = new StartGateView(starts, hf);
    this.group.add(this.startView.group);
    this.slalomView = race && race.gates.length > 0 ? new SlalomView(race, hf) : null;
    if (this.slalomView) this.group.add(this.slalomView.mesh);
    this.decor = still(createDecor(thinDecor(built.decor, density), hf, this.culler));
    this.group.add(this.decor);
    this.checkpointView = new CheckpointView(map, hf);
    this.group.add(this.checkpointView.group);
  }

  /** Redraws the decoration at another density. */
  setDensity(density: number): void {
    this.culler.attachAll();
    this.group.remove(this.decor);
    disposeTree(this.decor);
    this.culler = new DistanceCuller();
    this.decor = still(createDecor(thinDecor(this.built.decor, density), this.built.hf, this.culler));
    this.group.add(this.decor);
  }

  /**
   * Builds the snow and shows the decoration within `range` of the camera
   * at (x, z). `all`: build every missing chunk now (after a jump to a new
   * spot), not just a few.
   */
  view(x: number, z: number, range: number, all: boolean): void {
    this.terrain.update(x, z, range, all ? Infinity : CHUNKS_PER_FRAME);
    this.culler.update(x, z, range);
  }

  update(run: RunState, race: RaceState | null, frameTime: number): void {
    this.startView.update(race ? race.wandTime : Infinity);
    this.slalomView?.update(race);
    this.checkpointView.update(run, this.built.hf, frameTime);
  }

  /** Frees every geometry and material. Shared materials just get rebuilt the next time they're drawn. */
  dispose(): void {
    this.culler.attachAll();
    this.group.removeFromParent();
    disposeTree(this.group);
  }
}

/** Marks a group that never moves, all the way down: its matrices stay identity and are never recomputed. */
function still(group: Group): Group {
  group.traverse((o) => {
    o.matrixAutoUpdate = false;
  });
  return group;
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
