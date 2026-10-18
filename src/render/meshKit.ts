import { BufferAttribute, BufferGeometry, Color, Mesh, type Material, Vector3 } from 'three';
import { TriBuilder } from './triBuilder.ts';

const NO_SWAY = [0, 0, 0, 0] as const;

/**
 * Builds low-poly, vertex-colored models out of simple solids (boxes,
 * prisms, beams, panels) into one triangle list. `at` sets a transform
 * (position, turn about +Y, uniform scale) applied to the parts that follow,
 * so a model function can draw in its own local space.
 */
export class MeshKit {
  private readonly tris = new TriBuilder();
  private ox = 0;
  private oy = 0;
  private oz = 0;
  private cos = 1;
  private sin = 0;
  private k = 1;

  get empty(): boolean {
    return this.tris.positions.length === 0;
  }

  /** Places what follows: local (x, y, z) is turned by `yaw` (radians), scaled, then moved to (x, y, z). */
  at(x: number, y: number, z: number, yaw = 0, scale = 1): this {
    this.ox = x;
    this.oy = y;
    this.oz = z;
    this.cos = Math.cos(yaw);
    this.sin = Math.sin(yaw);
    this.k = scale;
    return this;
  }

  /** World position of a local point. */
  p(x: number, y: number, z: number): Vector3 {
    const sx = x * this.k;
    const sz = z * this.k;
    return new Vector3(this.ox + sx * this.cos + sz * this.sin, this.oy + y * this.k, this.oz - sx * this.sin + sz * this.cos);
  }

  /** A triangle in world space, facing `out`. */
  tri(a: Vector3, b: Vector3, c: Vector3, color: Color, out: Vector3): this {
    this.tris.tri(a, b, c, color, out);
    return this;
  }

  /** A quad in world space, facing `out`. */
  quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3, color: Color, out: Vector3): this {
    this.tris.quad(a, b, c, d, color, out);
    return this;
  }

  /**
   * A two-sided quad in world space (cloth, nets, signs). `sway`: how
   * freely each corner flaps, for cloth drawn with render/cloth.ts.
   */
  panel(a: Vector3, b: Vector3, c: Vector3, d: Vector3, color: Color, back: Color = color, sway: readonly [number, number, number, number] = NO_SWAY): this {
    const n = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(d, a));
    const [wa, wb, wc, wd] = sway;
    this.tris.quad(a, b, c, d, color, n, wa, wb, wc, wd);
    this.tris.quad(a, b, c, d, back, n.negate(), wa, wb, wc, wd);
    return this;
  }

  /** A box centered at local (x, y, z), sized (sx, sy, sz) along the local axes. */
  box(x: number, y: number, z: number, sx: number, sy: number, sz: number, color: Color): this {
    const hx = sx / 2;
    const hy = sy / 2;
    const hz = sz / 2;
    const c = this.p(x, y, z);
    const v = (dx: number, dy: number, dz: number): Vector3 => this.p(x + dx * hx, y + dy * hy, z + dz * hz);
    const faces: [number, number, number][] = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];
    for (const [fx, fy, fz] of faces) {
      // Two axes across the face.
      const [ax, ay, az] = fx !== 0 ? [0, 1, 0] : [1, 0, 0];
      const [bx, by, bz] = fz !== 0 ? [0, 1, 0] : fy !== 0 ? [0, 0, 1] : [0, 0, 1];
      const corner = (s: number, t: number): Vector3 => v(fx + ax * s + bx * t, fy + ay * s + by * t, fz + az * s + bz * t);
      const a = corner(-1, -1);
      const out = this.p(x + fx * hx, y + fy * hy, z + fz * hz).sub(c);
      this.tris.quad(a, corner(1, -1), corner(1, 1), corner(-1, 1), color, out);
    }
    return this;
  }

  /**
   * An upright prism (a tapered pole, a trunk, a cone when `r1` is 0) at
   * local (x, z) from height y0 to y1, radius r0 at the bottom and r1 at the
   * top. Closed at the top, and at the bottom if `bottom`.
   */
  prism(x: number, z: number, y0: number, y1: number, r0: number, r1: number, sides: number, color: Color, bottom = false): this {
    const ring = (y: number, r: number): Vector3[] =>
      Array.from({ length: sides }, (_, i) => {
        const t = (i / sides) * Math.PI * 2;
        return this.p(x + Math.cos(t) * r, y, z + Math.sin(t) * r);
      });
    const lo = ring(y0, r0);
    const hi = ring(y1, r1);
    const axisLo = this.p(x, y0, z);
    const axisHi = this.p(x, y1, z);
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      const out = new Vector3().addVectors(lo[i]!, lo[j]!).multiplyScalar(0.5).sub(axisLo);
      out.y = 0;
      if (r1 > 0) this.tris.quad(lo[i]!, lo[j]!, hi[j]!, hi[i]!, color, out);
      else this.tris.tri(lo[i]!, lo[j]!, axisHi, color, out);
      if (r1 > 0) this.tris.tri(axisHi, hi[i]!, hi[j]!, color, new Vector3(0, 1, 0));
      if (bottom) this.tris.tri(axisLo, lo[i]!, lo[j]!, color, new Vector3(0, -1, 0));
    }
    return this;
  }

  /** A square beam `w` thick between two local points (braces, rails, cables). */
  beam(ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number, color: Color): this {
    const a = this.p(ax, ay, az);
    const b = this.p(bx, by, bz);
    return this.beamWorld(a, b, w * this.k, color);
  }

  /** A square beam `w` thick between two world points. */
  beamWorld(a: Vector3, b: Vector3, w: number, color: Color): this {
    const dir = new Vector3().subVectors(b, a);
    if (dir.lengthSq() < 1e-8) return this;
    dir.normalize();
    const side = new Vector3().crossVectors(dir, Math.abs(dir.y) > 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0)).normalize();
    const up = new Vector3().crossVectors(side, dir).normalize();
    side.multiplyScalar(w / 2);
    up.multiplyScalar(w / 2);
    const offs = [
      side.clone().add(up),
      side.clone().sub(up),
      side.clone().negate().sub(up),
      side.clone().negate().add(up),
    ];
    for (let i = 0; i < 4; i++) {
      const o0 = offs[i]!;
      const o1 = offs[(i + 1) % 4]!;
      this.tris.quad(a.clone().add(o0), a.clone().add(o1), b.clone().add(o1), b.clone().add(o0), color, o0.clone().add(o1));
    }
    this.tris.quad(a.clone().add(offs[0]!), a.clone().add(offs[1]!), a.clone().add(offs[2]!), a.clone().add(offs[3]!), color, dir.clone().negate());
    this.tris.quad(b.clone().add(offs[0]!), b.clone().add(offs[1]!), b.clone().add(offs[2]!), b.clone().add(offs[3]!), color, dir);
    return this;
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.tris.positions), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.tris.colors), 3));
    if (this.tris.sways.some((w) => w !== 0)) g.setAttribute('sway', new BufferAttribute(new Float32Array(this.tris.sways), 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }

  mesh(material: Material): Mesh {
    const mesh = new Mesh(this.geometry(), material);
    mesh.matrixAutoUpdate = false;
    return mesh;
  }
}

/**
 * Many MeshKits, one per square tile of the map, so static decoration merges
 * into a few meshes that can still be culled when off screen.
 */
export class TiledKit {
  private readonly kits = new Map<string, MeshKit>();

  private readonly tile: number;

  constructor(tile: number) {
    this.tile = tile;
  }

  /** The kit for the tile holding world (x, z). */
  near(x: number, z: number): MeshKit {
    const key = `${Math.floor(x / this.tile)},${Math.floor(z / this.tile)}`;
    let kit = this.kits.get(key);
    if (!kit) {
      kit = new MeshKit();
      this.kits.set(key, kit);
    }
    return kit;
  }

  meshes(material: Material): Mesh[] {
    return [...this.kits.values()].filter((k) => !k.empty).map((k) => k.mesh(material));
  }
}
