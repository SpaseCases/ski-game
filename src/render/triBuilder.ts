import { Color, Vector3 } from 'three';

/** Collects flat-colored triangles, wound to face a given outward direction. */
export class TriBuilder {
  readonly positions: number[] = [];
  readonly colors: number[] = [];
  private readonly ab = new Vector3();
  private readonly ac = new Vector3();

  tri(a: Vector3, b: Vector3, c: Vector3, color: Color, out: Vector3): void {
    this.ab.subVectors(b, a);
    this.ac.subVectors(c, a);
    const facing = this.ab.cross(this.ac).dot(out);
    // Counter-clockwise seen from the outside faces outward.
    const order = facing >= 0 ? [a, b, c] : [a, c, b];
    for (const v of order) {
      this.positions.push(v.x, v.y, v.z);
      this.colors.push(color.r, color.g, color.b);
    }
  }

  quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3, color: Color, out: Vector3): void {
    this.tri(a, b, c, color, out);
    this.tri(a, c, d, color, out);
  }
}
