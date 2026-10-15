import { Color, InstancedMesh, Matrix4, MeshLambertMaterial, Quaternion, Vector3 } from 'three';
import { CONFIG } from '../config.ts';
import type { Heightfield } from '../maps/types.ts';
import type { RaceDef, RaceState } from '../sim/race.ts';
import { MeshKit } from './meshKit.ts';
import { drawnHeightAt } from './terrainMesh.ts';

// Slalom gate poles: one instanced mesh, two poles per gate, red and blue
// gates alternating. Each pole leans over by the bend the sim gives it,
// hinged at the snow.

const RED = new Color('#d8342c');
const BLUE = new Color('#2f62d0');
const SINK = 0.2;

export class SlalomView {
  readonly mesh: InstancedMesh;
  private readonly base: Vector3[] = [];
  private readonly matrix = new Matrix4();
  private readonly turn = new Quaternion();
  private readonly axis = new Vector3();
  private readonly one = new Vector3(1, 1, 1);

  constructor(def: RaceDef, hf: Heightfield) {
    const h = CONFIG.slalom.poleHeight;
    const kit = new MeshKit();
    kit.prism(0, 0, -SINK, h, 0.028, 0.024, 6, new Color('#ffffff'));
    // A dark cap so the pole top reads against the snow.
    kit.prism(0, 0, h, h + 0.08, 0.03, 0.03, 6, new Color('#3a4450'));
    const count = def.gates.length * 2;
    this.mesh = new InstancedMesh(kit.geometry(), new MeshLambertMaterial({ vertexColors: true, flatShading: true }), Math.max(1, count));
    this.mesh.count = count;
    def.gates.forEach((g, i) => {
      for (let k = 0; k < 2; k++) {
        const side = k === 0 ? -1 : 1;
        const x = g.x + g.rightX * g.half * side;
        const z = g.z + g.rightZ * g.half * side;
        this.base.push(new Vector3(x, drawnHeightAt(hf, x, z), z));
        this.mesh.setColorAt(i * 2 + k, i % 2 === 0 ? RED : BLUE);
      }
    });
    // Bent poles reach past their bases; skip culling rather than track the bounds.
    this.mesh.frustumCulled = false;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.update(null);
  }

  /** Leans every pole by its bend (none without a race state). */
  update(race: RaceState | null): void {
    for (let i = 0; i < this.base.length; i++) {
      const bx = race?.bendX[i] ?? 0;
      const bz = race?.bendZ[i] ?? 0;
      const bend = Math.hypot(bx, bz);
      if (bend > 1e-5) {
        // Tip the pole's +Y toward (bx, bz): about up × that direction.
        this.turn.setFromAxisAngle(this.axis.set(bz / bend, 0, -bx / bend), bend);
      } else {
        this.turn.identity();
      }
      this.matrix.compose(this.base[i]!, this.turn, this.one);
      this.mesh.setMatrixAt(i, this.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
