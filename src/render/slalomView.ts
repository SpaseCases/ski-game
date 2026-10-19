import { type BufferGeometry, Color, InstancedMesh, Matrix4, MeshLambertMaterial, Quaternion, Vector3 } from 'three';
import { CONFIG } from '../config.ts';
import type { Heightfield } from '../maps/types.ts';
import { sideOffset, type RaceDef, type RaceState } from '../sim/race.ts';
import { MeshKit } from './meshKit.ts';
import { drawnHeightAt } from './terrainMesh.ts';

// Gates: one instanced mesh of slalom poles (a pole per side) and one of
// giant slalom panels (each side a plain panel between two poles), red and
// blue gates alternating along each course. Each pole or panel leans over
// by the bend the sim gives it, hinged at the snow.

const RED = new Color('#d8342c');
const BLUE = new Color('#2f62d0');
const WHITE = new Color('#ffffff');
const CAP = new Color('#3a4450');
const SINK = 0.2;
const UP = new Vector3(0, 1, 0);

/** One drawn side: which mesh and instance it is, where its foot is, and which way it faces. */
interface Side {
  mesh: InstancedMesh;
  instance: number;
  base: Vector3;
  facing: Quaternion;
}

export class SlalomView {
  readonly meshes: InstancedMesh[] = [];
  private readonly sides: Side[] = [];
  private readonly matrix = new Matrix4();
  private readonly turn = new Quaternion();
  private readonly axis = new Vector3();
  private readonly one = new Vector3(1, 1, 1);

  constructor(def: RaceDef, hf: Heightfield) {
    const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
    let poleCount = 0;
    for (const p of def.panel) if (p === 0) poleCount += 2;
    const poles = new InstancedMesh(poleGeometry(), material, Math.max(1, poleCount));
    const panels = new InstancedMesh(panelGeometry(), material, Math.max(1, def.gates.length * 2 - poleCount));
    poles.count = 0;
    panels.count = 0;
    // Red and blue alternate along each course, starting red.
    const order = new Uint16Array(def.gates.length);
    for (const c of def.courses) for (let k = 0; k < c.count; k++) order[c.first + k] = k;

    for (let i = 0; i < def.gates.length * 2; i++) {
      const g = def.gates[i >> 1]!;
      const across = sideOffset(def, i);
      const x = g.x + g.rightX * across;
      const z = g.z + g.rightZ * across;
      const mesh = def.panel[i >> 1] === 1 ? panels : poles;
      const instance = mesh.count++;
      const facing = new Quaternion().setFromAxisAngle(UP, Math.atan2(-g.dirX, -g.dirZ));
      this.sides.push({ mesh, instance, base: new Vector3(x, drawnHeightAt(hf, x, z), z), facing });
      mesh.setColorAt(instance, (order[i >> 1] ?? 0) % 2 === 0 ? RED : BLUE);
    }
    for (const mesh of [poles, panels]) {
      if (mesh.count === 0) {
        mesh.geometry.dispose();
        continue;
      }
      // Bent poles reach past their bases; skip culling rather than track the bounds.
      mesh.frustumCulled = false;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.meshes.push(mesh);
    }
    this.update(null);
  }

  /** Leans every pole and panel by its bend (none without a race state). */
  update(race: RaceState | null): void {
    for (let i = 0; i < this.sides.length; i++) {
      const side = this.sides[i]!;
      const bx = race?.bendX[i] ?? 0;
      const bz = race?.bendZ[i] ?? 0;
      const bend = Math.hypot(bx, bz);
      if (bend > 1e-5) {
        // Tip the pole's +Y toward (bx, bz): about up × that direction.
        this.turn.setFromAxisAngle(this.axis.set(bz / bend, 0, -bx / bend), bend);
      } else {
        this.turn.identity();
      }
      this.turn.multiply(side.facing);
      this.matrix.compose(side.base, this.turn, this.one);
      side.mesh.setMatrixAt(side.instance, this.matrix);
    }
    for (const mesh of this.meshes) mesh.instanceMatrix.needsUpdate = true;
  }
}

/** A slalom pole: white (tinted by the instance color) with a dark cap so its top reads against the snow. */
function poleGeometry(): BufferGeometry {
  const h = CONFIG.slalom.poleHeight;
  const kit = new MeshKit();
  kit.prism(0, 0, -SINK, h, 0.028, 0.024, 6, WHITE);
  kit.prism(0, 0, h, h + 0.08, 0.03, 0.03, 6, CAP);
  return kit.geometry();
}

/** A giant slalom panel: two poles with a plain panel between them, across local X, its middle at the origin. */
function panelGeometry(): BufferGeometry {
  const h = CONFIG.slalom.poleHeight;
  const c = CONFIG.giantSlalom;
  const half = c.panelWidth / 2;
  const kit = new MeshKit();
  for (const x of [-half, half]) {
    kit.prism(x, 0, -SINK, h, 0.026, 0.022, 6, WHITE);
    kit.prism(x, 0, h, h + 0.07, 0.028, 0.028, 6, CAP);
  }
  kit.box(0, (c.panelBottom + c.panelTop) / 2, 0, c.panelWidth, c.panelTop - c.panelBottom, 0.02, WHITE);
  return kit.geometry();
}
