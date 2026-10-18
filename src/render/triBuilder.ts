import { Color, Vector3 } from 'three';

/**
 * Collects flat-colored triangles, wound to face a given outward direction.
 * Each vertex can carry a sway weight (0 holds still, 1 flaps freely) for
 * cloth drawn with render/cloth.ts.
 */
export class TriBuilder {
  readonly positions: number[] = [];
  readonly colors: number[] = [];
  readonly sways: number[] = [];
  private readonly ab = new Vector3();
  private readonly ac = new Vector3();

  tri(a: Vector3, b: Vector3, c: Vector3, color: Color, out: Vector3, wa = 0, wb = 0, wc = 0): void {
    this.ab.subVectors(b, a);
    this.ac.subVectors(c, a);
    const facing = this.ab.cross(this.ac).dot(out);
    // Counter-clockwise seen from the outside faces outward.
    const flip = facing < 0;
    for (const [v, w] of flip ? ([[a, wa], [c, wc], [b, wb]] as const) : ([[a, wa], [b, wb], [c, wc]] as const)) {
      this.positions.push(v.x, v.y, v.z);
      this.colors.push(color.r, color.g, color.b);
      this.sways.push(w);
    }
  }

  quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3, color: Color, out: Vector3, wa = 0, wb = 0, wc = 0, wd = 0): void {
    this.tri(a, b, c, color, out, wa, wb, wc);
    this.tri(a, c, d, color, out, wa, wc, wd);
  }
}
