import type { Mesh, Object3D } from 'three';

/**
 * Keeps whole tiles of the world (groups of trees, merged props) out of the
 * scene while they're farther from the camera than it can see, measured
 * flat across the map. Detached tiles cost Three.js nothing at all (it
 * walks every attached object each frame, hidden or not), so a big map
 * costs only the tiles near the camera.
 */
export class DistanceCuller {
  private readonly objects: Object3D[] = [];
  private readonly parents: Object3D[] = [];
  private readonly xs: number[] = [];
  private readonly zs: number[] = [];
  private readonly radii: number[] = [];

  /** An object (already added to its parent) whose contents lie within `radius` of (x, z), seen from above. */
  add(object: Object3D, x: number, z: number, radius: number): void {
    if (!object.parent) throw new Error('DistanceCuller: add the object to its parent first');
    this.objects.push(object);
    this.parents.push(object.parent);
    this.xs.push(x);
    this.zs.push(z);
    this.radii.push(radius);
  }

  /** A mesh drawn in world space (no transform), by its bounding sphere. */
  addMesh(mesh: Mesh): void {
    const g = mesh.geometry;
    if (!g.boundingSphere) g.computeBoundingSphere();
    const s = g.boundingSphere!;
    this.add(mesh, s.center.x, s.center.z, s.radius);
  }

  /** Attaches what's within `range` of (x, z) and detaches the rest. */
  update(x: number, z: number, range: number): void {
    for (let i = 0; i < this.objects.length; i++) {
      const dx = this.xs[i]! - x;
      const dz = this.zs[i]! - z;
      const reach = range + this.radii[i]!;
      const near = dx * dx + dz * dz < reach * reach;
      const object = this.objects[i]!;
      if (near && !object.parent) this.parents[i]!.add(object);
      else if (!near && object.parent) object.removeFromParent();
    }
  }

  /** Attaches everything again (so a dispose can reach it all). */
  attachAll(): void {
    for (let i = 0; i < this.objects.length; i++) {
      if (!this.objects[i]!.parent) this.parents[i]!.add(this.objects[i]!);
    }
  }
}
