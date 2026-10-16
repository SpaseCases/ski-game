import type { Mesh, Object3D } from 'three';

/**
 * Keeps whole tiles of the world (groups of trees, merged props) out of the
 * scene while they're farther from the camera than it can see, measured
 * flat across the map. Detached tiles cost Three.js nothing at all (it
 * walks every attached object each frame, hidden or not), so a big map
 * costs only the tiles near the camera.
 *
 * Tiles can share a group with a coarse stand-in for all of them (simple
 * far trees for a block of tree tiles): past `split` the stand-in is drawn
 * instead of the tiles, so the distance costs a few draw calls, not dozens.
 */
export class DistanceCuller {
  private readonly objects: Object3D[] = [];
  private readonly parents: Object3D[] = [];
  private readonly xs: number[] = [];
  private readonly zs: number[] = [];
  private readonly radii: number[] = [];
  /** Per object: its group, or -1. */
  private readonly groupOf: number[] = [];
  /** Per group: the stand-in (or null), its parent, and the square it covers (middle and half its side). */
  private readonly far: (Object3D | null)[] = [];
  private readonly farParents: (Object3D | null)[] = [];
  private readonly gx: number[] = [];
  private readonly gz: number[] = [];
  private readonly gHalf: number[] = [];
  /** Per group, each update: drawn as its tiles (1) or as its stand-in (0). */
  private split = new Uint8Array(0);

  /**
   * A group of tiles covering a square (middle (x, z), half side `half`),
   * with a stand-in drawn in their place far away (already added to its
   * parent), or null to draw nothing there. Returns its id for add().
   */
  addGroup(far: Object3D | null, x: number, z: number, half: number): number {
    if (far && !far.parent) throw new Error('DistanceCuller: add the stand-in to its parent first');
    this.far.push(far);
    this.farParents.push(far ? far.parent : null);
    this.gx.push(x);
    this.gz.push(z);
    this.gHalf.push(half);
    this.split = new Uint8Array(this.far.length);
    return this.far.length - 1;
  }

  /** An object (already added to its parent) whose contents lie within `radius` of (x, z), seen from above, in `group` if any. */
  add(object: Object3D, x: number, z: number, radius: number, group = -1): void {
    if (!object.parent) throw new Error('DistanceCuller: add the object to its parent first');
    this.objects.push(object);
    this.parents.push(object.parent);
    this.xs.push(x);
    this.zs.push(z);
    this.radii.push(radius);
    this.groupOf.push(group);
  }

  /** A mesh drawn in world space (no transform), by its bounding sphere. */
  addMesh(mesh: Mesh): void {
    const g = mesh.geometry;
    if (!g.boundingSphere) g.computeBoundingSphere();
    const s = g.boundingSphere!;
    this.add(mesh, s.center.x, s.center.z, s.radius);
  }

  /**
   * Attaches what's within `range` of (x, z) and detaches the rest. Groups
   * closer than `splitAt` are drawn as their tiles, farther ones as their stand-ins.
   */
  update(x: number, z: number, range: number, splitAt: number): void {
    for (let g = 0; g < this.far.length; g++) {
      const half = this.gHalf[g]!;
      const dx = Math.max(Math.abs(this.gx[g]! - x) - half, 0);
      const dz = Math.max(Math.abs(this.gz[g]! - z) - half, 0);
      const d = Math.sqrt(dx * dx + dz * dz);
      const far = this.far[g]!;
      const near = !far || d < splitAt;
      this.split[g] = near ? 1 : 0;
      if (far) attach(far, this.farParents[g]!, !near && d < range);
    }
    for (let i = 0; i < this.objects.length; i++) {
      const g = this.groupOf[i]!;
      const dx = this.xs[i]! - x;
      const dz = this.zs[i]! - z;
      const reach = range + this.radii[i]!;
      attach(this.objects[i]!, this.parents[i]!, (g < 0 || this.split[g] === 1) && dx * dx + dz * dz < reach * reach);
    }
  }

  /** Attaches everything again (so a dispose can reach it all). */
  attachAll(): void {
    for (let i = 0; i < this.objects.length; i++) attach(this.objects[i]!, this.parents[i]!, true);
    for (let g = 0; g < this.far.length; g++) {
      const far = this.far[g];
      if (far) attach(far, this.farParents[g]!, true);
    }
  }
}

function attach(object: Object3D, parent: Object3D, on: boolean): void {
  if (on && !object.parent) parent.add(object);
  else if (!on && object.parent) object.removeFromParent();
}
