import {
  BoxGeometry,
  BufferAttribute,
  type BufferGeometry,
  Color,
  CylinderGeometry,
  Euler,
  ExtrudeGeometry,
  Group,
  IcosahedronGeometry,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Quaternion,
  Shape,
  SphereGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PoseDef, Vec3 } from './skierPoses.ts';

// Low-poly freeskier: long baggy jacket, wide pants, chunky boots, helmet
// with goggles and a neck gaiter, twin-tip skis and poles. Each body segment
// is its own mesh (vertex colors, flat shading, one shared material) placed
// every pose by a small solver: hips, chest and head are rigid; knees and
// elbows come from two-bone IK so hands and feet land where the pose says.

export interface Outfit {
  jacket: string;
  pants: string;
  helmet: string;
}

export const DEFAULT_OUTFIT: Outfit = { jacket: '#30343c', pants: '#677a52', helmet: '#e2445f' };

const FIXED = {
  gaiter: '#3e66b0',
  strap: '#1c1f25',
  lens: '#f0a238',
  glove: '#3a3f47',
  boot: '#4d525b',
  binding: '#1c1f25',
  skiTop: '#21252c',
  skiTip: '#b8e330',
  skiStripe: '#e2497b',
  skiBase: '#2f7fe0',
  poleShaft: '#b8c0c9',
  poleDark: '#1c1f25',
};

/** Body proportions in meters. */
export const BODY = {
  /** Ankle joint above the ski base, and behind the ski's middle. */
  ankleHeight: 0.16,
  ankleBack: 0.02,
  shin: 0.43,
  thigh: 0.43,
  hipWidth: 0.1,
  hipDrop: 0.03,
  /** Pelvis center to the base of the neck. */
  spine: 0.52,
  shoulderWidth: 0.19,
  shoulderDrop: 0.07,
  upperArm: 0.29,
  forearm: 0.25,
  /** Wrist to the middle of the mitten. */
  hand: 0.05,
  skiLength: 1.76,
  skiWidth: 0.1,
};

const DOWN = new Vector3(0, -1, 0);

export class SkierRig {
  readonly root = new Group();
  private readonly pelvis: Mesh;
  private readonly torso: Mesh;
  private readonly skirt: Mesh;
  private readonly head: Mesh;
  private readonly upperArms: Mesh[] = [];
  private readonly forearms: Mesh[] = [];
  private readonly thighs: Mesh[] = [];
  private readonly shins: Mesh[] = [];
  private readonly feet: Mesh[] = [];
  private readonly poles: Mesh[] = [];

  // Solved joint positions and orientations (skier space), reused every pose.
  private readonly pelvisPos = new Vector3();
  private readonly pelvisQ = new Quaternion();
  private readonly chestQ = new Quaternion();
  private readonly headQ = new Quaternion();
  private readonly hips = [new Vector3(), new Vector3()];
  private readonly knees = [new Vector3(), new Vector3()];
  private readonly ankles = [new Vector3(), new Vector3()];
  private readonly footQs = [new Quaternion(), new Quaternion()];
  private readonly shoulders = [new Vector3(), new Vector3()];
  private readonly elbows = [new Vector3(), new Vector3()];
  private readonly hands = [new Vector3(), new Vector3()];

  /** Largest distance (m) a hand or foot fell short of its target in the last pose. */
  reachError = 0;

  constructor(outfit: Outfit = DEFAULT_OUTFIT) {
    const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const add = (geometry: BufferGeometry): Mesh => {
      const mesh = new Mesh(geometry, material);
      this.root.add(mesh);
      return mesh;
    };
    const jacket = new Color(outfit.jacket);
    const jacketShade = jacket.clone().multiplyScalar(0.8);
    const pants = new Color(outfit.pants);
    const helmet = new Color(outfit.helmet);

    // The long jacket covers the hips, so the pelvis wears the jacket color.
    this.pelvis = add(buildPelvis(jacket));
    this.torso = add(buildTorso(jacket, jacketShade));
    this.skirt = add(buildSkirt(jacket));
    this.head = add(buildHead(helmet));
    for (let i = 0; i < 2; i++) {
      this.upperArms.push(add(buildUpperArm(jacket)));
      this.forearms.push(add(buildForearm(jacket)));
      this.thighs.push(add(buildThigh(pants)));
      this.shins.push(add(buildShin(pants)));
      this.feet.push(add(buildFoot()));
      this.poles.push(add(buildPole()));
    }
  }

  /** Solves the pose and moves every part into place. */
  apply(p: PoseDef): void {
    this.reachError = 0;

    // Rigid core: pelvis, chest (bent at the lower back), head.
    this.pelvisPos.set(p.pelvis[0], p.pelvis[1], p.pelvis[2]);
    this.pelvisQ.setFromEuler(euler.set(-p.pelvisPitch, p.pelvisYaw ?? 0, p.pelvisRoll ?? 0, 'YXZ'));
    this.chestQ
      .copy(this.pelvisQ)
      .multiply(q1.setFromEuler(euler.set(-p.chestPitch, p.chestYaw ?? 0, p.chestRoll ?? 0, 'YXZ')));
    this.headQ.copy(this.chestQ).multiply(q1.setFromEuler(euler.set(-(p.headPitch ?? 0), p.headYaw ?? 0, 0, 'YXZ')));

    place(this.pelvis, this.pelvisPos, this.pelvisQ);
    place(this.torso, this.pelvisPos, this.chestQ);
    const neck = v1.set(0, BODY.spine, 0).applyQuaternion(this.chestQ).add(this.pelvisPos);
    place(this.head, neck, this.headQ);

    // Arms first: shoulder to hand, elbow solved toward the elbow hint.
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const hand = p.hands[i === 0 ? 0 : 1];
      this.shoulders[i]!.set(side * BODY.shoulderWidth, BODY.spine - BODY.shoulderDrop, 0)
        .applyQuaternion(this.chestQ)
        .add(this.pelvisPos);
      this.hands[i]!.set(hand.at[0], hand.at[1], hand.at[2]);
      setHint(hint, hand.elbow, side * 0.7, -0.4, 0.5);
      this.solveLimb(this.shoulders[i]!, this.hands[i]!, BODY.upperArm, BODY.forearm + BODY.hand, hint, this.elbows[i]!);
      segment(this.upperArms[i]!, this.shoulders[i]!, this.elbows[i]!, hint);
      segment(this.forearms[i]!, this.elbows[i]!, this.hands[i]!, hint);

      // Pole hangs from the hand.
      setHint(v3, hand.pole, side * 0.18, -0.8, 0.55).normalize();
      this.poles[i]!.position.copy(this.hands[i]!);
      this.poles[i]!.quaternion.setFromUnitVectors(DOWN, v3);
    }

    // Then legs: hip to ankle, knee solved toward the knee hint. A grabbed
    // ski is brought to the hand holding it, which sets that ankle.
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const foot = p.feet[i === 0 ? 0 : 1];
      this.hips[i]!.set(side * BODY.hipWidth, -BODY.hipDrop, 0).applyQuaternion(this.pelvisQ).add(this.pelvisPos);
      this.footQs[i]!.setFromEuler(euler.set(foot.pitch ?? 0, foot.yaw ?? 0, foot.roll ?? 0, 'YXZ'));
      const holder = p.hands[0].grab === i ? 0 : p.hands[1].grab === i ? 1 : -1;
      const grip = holder >= 0 ? p.hands[holder === 0 ? 0 : 1].on : undefined;
      if (grip) ankleForGrip(this.ankles[i]!, this.hands[holder]!, grip, this.footQs[i]!);
      else this.ankles[i]!.set(foot.ankle[0], foot.ankle[1], foot.ankle[2]);

      setHint(hint, foot.knee, side * 0.15, 0.05, -1);
      this.solveLimb(this.hips[i]!, this.ankles[i]!, BODY.thigh, BODY.shin, hint, this.knees[i]!);
      segment(this.thighs[i]!, this.hips[i]!, this.knees[i]!, hint);
      segment(this.shins[i]!, this.knees[i]!, this.ankles[i]!, hint);
      place(this.feet[i]!, this.ankles[i]!, this.footQs[i]!);
    }

    // Jacket skirt hangs from the waist, swinging partway toward the thighs.
    const hinge = v1.set(0, 0.05, 0).applyQuaternion(this.pelvisQ).add(this.pelvisPos);
    v2.copy(DOWN).applyQuaternion(this.pelvisQ);
    v3.subVectors(this.knees[0]!, this.hips[0]!).add(v4.subVectors(this.knees[1]!, this.hips[1]!)).normalize();
    v2.lerp(v3, 0.45).normalize();
    hint.set(0, 0, -1).applyQuaternion(this.pelvisQ);
    segment(this.skirt, hinge, v4.copy(hinge).add(v2), hint);
  }

  /**
   * Two-bone IK: finds the middle joint between `start` and `target` given
   * the two bone lengths, bending toward `bend`. If the target is out of
   * reach it is pulled in to the limb's full length.
   */
  private solveLimb(start: Vector3, target: Vector3, a: number, b: number, bend: Vector3, outMid: Vector3): void {
    dir.subVectors(target, start);
    const want = dir.length();
    dir.divideScalar(want || 1);
    const d = Math.min(Math.max(want, Math.abs(a - b) + 1e-4), a + b - 1e-4);
    this.reachError = Math.max(this.reachError, want - d);
    target.copy(start).addScaledVector(dir, d);

    const along = (a * a - b * b + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, a * a - along * along));
    side.copy(bend).addScaledVector(dir, -bend.dot(dir));
    if (side.lengthSq() < 1e-8) side.set(0, 0, -1).addScaledVector(dir, dir.z);
    side.normalize();
    outMid.copy(start).addScaledVector(dir, along).addScaledVector(side, h);
  }
}

// Scratch objects so posing never allocates.
const euler = new Euler();
const q1 = new Quaternion();
const v1 = new Vector3();
const v2 = new Vector3();
const v3 = new Vector3();
const v4 = new Vector3();
const hint = new Vector3();
const dir = new Vector3();
const side = new Vector3();
const basis = new Matrix4();
const xAxis = new Vector3();
const yAxis = new Vector3();
const zAxis = new Vector3();
const skiOffset = new Vector3();

function place(mesh: Mesh, position: Vector3, quaternion: Quaternion): void {
  mesh.position.copy(position);
  mesh.quaternion.copy(quaternion);
}

/** Points a segment mesh (built along +Y from its origin) from `a` to `b`, its front toward `front`. */
function segment(mesh: Mesh, a: Vector3, b: Vector3, front: Vector3): void {
  yAxis.subVectors(b, a).normalize();
  zAxis.copy(front).addScaledVector(yAxis, -front.dot(yAxis));
  if (zAxis.lengthSq() < 1e-8) zAxis.set(0, 0, -1).addScaledVector(yAxis, yAxis.z);
  zAxis.normalize().negate(); // the mesh's -Z faces the front
  xAxis.crossVectors(yAxis, zAxis);
  basis.makeBasis(xAxis, yAxis, zAxis);
  mesh.position.copy(a);
  mesh.quaternion.setFromRotationMatrix(basis);
}

function setHint(out: Vector3, v: Vec3 | undefined, x: number, y: number, z: number): Vector3 {
  return v ? out.set(v[0], v[1], v[2]) : out.set(x, y, z);
}

/** Where the ankle must be for the ski point `grip` (ski space) to sit at `hand`. */
function ankleForGrip(out: Vector3, hand: Vector3, grip: Vec3, footQ: Quaternion): Vector3 {
  skiOffset.set(grip[0], grip[1] - BODY.ankleHeight, grip[2] - BODY.ankleBack).applyQuaternion(footQ);
  return out.copy(hand).sub(skiOffset);
}

// ---------------------------------------------------------------------------
// Geometry. Every part is non-indexed with a per-vertex color, so parts of
// one rigid piece can be merged into a single mesh whatever their colors.

function paint(geometry: BufferGeometry, color: Color | string): BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.deleteAttribute('uv');
  const c = typeof color === 'string' ? new Color(color) : color;
  const count = g.getAttribute('position').count;
  const rgb = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    rgb[i * 3] = c.r;
    rgb[i * 3 + 1] = c.g;
    rgb[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new BufferAttribute(rgb, 3));
  return g;
}

function merge(parts: BufferGeometry[]): BufferGeometry {
  const merged = mergeGeometries(parts);
  if (!merged) throw new Error('Skier: could not merge part geometries');
  merged.computeBoundingSphere();
  return merged;
}

/** A tapered prism from y = 0 (radius `r0`) to y = `length` (radius `r1`). */
function prism(r0: number, r1: number, length: number, sides: number): BufferGeometry {
  return new CylinderGeometry(r1, r0, length, sides).translate(0, length / 2, 0);
}

function buildPelvis(color: Color): BufferGeometry {
  return paint(prism(0.15, 0.165, 0.2, 7).translate(0, -0.13, 0).scale(1, 1, 0.72), color);
}

function buildTorso(jacket: Color, shade: Color): BufferGeometry {
  const body = paint(prism(0.2, 0.215, 0.5, 7).translate(0, 0.02, 0).scale(1, 1, 0.64), jacket);
  const hood = paint(new BoxGeometry(0.27, 0.11, 0.13).rotateX(-0.3).translate(0, 0.5, 0.11), shade);
  const zip = paint(new BoxGeometry(0.02, 0.44, 0.02).translate(0, 0.26, -0.135), shade);
  const shoulders = [-1, 1].map((s) =>
    paint(new IcosahedronGeometry(0.085, 0).translate(s * BODY.shoulderWidth, BODY.spine - BODY.shoulderDrop, 0), jacket),
  );
  return merge([body, hood, zip, ...shoulders]);
}

/** The long jacket below the waist, built along +Y from the waist down to mid-thigh. */
function buildSkirt(jacket: Color): BufferGeometry {
  return paint(prism(0.205, 0.255, 0.36, 7).scale(1, 1, 0.68), jacket);
}

function buildHead(helmet: Color): BufferGeometry {
  const gaiter = paint(prism(0.112, 0.104, 0.16, 7).translate(0, -0.02, -0.01), FIXED.gaiter);
  const shell = paint(new SphereGeometry(0.152, 8, 6).scale(1, 0.92, 1.1).translate(0, 0.22, 0.01), helmet);
  const strap = paint(new CylinderGeometry(0.156, 0.156, 0.05, 9, 1, true).scale(1, 1, 1.1).translate(0, 0.2, 0.01), FIXED.strap);
  const lens = paint(
    new CylinderGeometry(0.163, 0.16, 0.085, 9, 1, true, Math.PI * 0.58, Math.PI * 0.84).scale(1, 1, 1.1).translate(0, 0.195, 0.01),
    FIXED.lens,
  );
  return merge([gaiter, shell, strap, lens]);
}

function buildUpperArm(jacket: Color): BufferGeometry {
  const sleeve = paint(prism(0.07, 0.062, BODY.upperArm, 6), jacket);
  const elbow = paint(new IcosahedronGeometry(0.066, 0).translate(0, BODY.upperArm, 0), jacket);
  return merge([sleeve, elbow]);
}

function buildForearm(jacket: Color): BufferGeometry {
  const sleeve = paint(prism(0.062, 0.066, BODY.forearm, 6), jacket);
  const mitten = paint(new BoxGeometry(0.09, 0.11, 0.08).translate(0, BODY.forearm + BODY.hand, 0), FIXED.glove);
  return merge([sleeve, mitten]);
}

function buildThigh(pants: Color): BufferGeometry {
  const leg = paint(prism(0.112, 0.1, BODY.thigh, 7), pants);
  const knee = paint(new IcosahedronGeometry(0.1, 0).translate(0, BODY.thigh, 0), pants);
  return merge([leg, knee]);
}

/** Shin flares into a baggy cuff that covers the top of the boot. */
function buildShin(pants: Color): BufferGeometry {
  return paint(prism(0.098, 0.118, BODY.shin + 0.08, 7), pants);
}

/** Boot, binding and ski, in the foot frame (origin at the ankle). */
function buildFoot(): BufferGeometry {
  const shell = paint(new BoxGeometry(0.13, 0.21, 0.25).translate(0, 0.035, 0), FIXED.boot);
  const toe = paint(new BoxGeometry(0.135, 0.06, 0.33).translate(0, -0.085, -0.01), FIXED.boot);
  const binding = paint(new BoxGeometry(0.09, 0.025, 0.4).translate(0, -0.125, 0), FIXED.binding);
  const ski = buildSki().translate(0, -BODY.ankleHeight, -BODY.ankleBack);
  return merge([shell, toe, binding, ski]);
}

/**
 * Twin-tip ski: a side profile extruded across the ski's width, colored per
 * face (dark topsheet, bright tips, a stripe, colored base).
 */
function buildSki(): BufferGeometry {
  const half = BODY.skiLength / 2;
  const thick = 0.022;
  const flat = 0.66;
  const stations = [-half, -0.82, -0.75, -flat, -0.25, -0.15, 0.15, 0.25, flat, 0.75, 0.82, half];
  const rise = (x: number): number => {
    const t = Math.max(0, (Math.abs(x) - flat) / (half - flat));
    return 0.12 * t ** 1.6;
  };
  const shape = new Shape();
  stations.forEach((x, i) => (i === 0 ? shape.moveTo(x, rise(x)) : shape.lineTo(x, rise(x))));
  for (let i = stations.length - 1; i >= 0; i--) {
    const x = stations[i] ?? 0;
    shape.lineTo(x, rise(x) + thick);
  }
  // Profile x runs along the ski, y up; extrusion depth is the width.
  const g = new ExtrudeGeometry(shape, { depth: BODY.skiWidth, bevelEnabled: false })
    .rotateY(Math.PI / 2)
    .translate(-BODY.skiWidth / 2, 0, 0);
  g.deleteAttribute('uv');

  const pos = g.getAttribute('position');
  const rgb = new Float32Array(pos.count * 3);
  const top = new Color(FIXED.skiTop);
  const tip = new Color(FIXED.skiTip);
  const stripe = new Color(FIXED.skiStripe);
  const base = new Color(FIXED.skiBase);
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    const along = Math.abs((a.z + b.z + c.z) / 3);
    const normalY = b.clone().sub(a).cross(c.clone().sub(a)).normalize().y;
    const color = normalY < -0.5 ? base : along > flat ? tip : along > 0.15 && along < 0.25 ? stripe : top;
    for (let k = 0; k < 3; k++) {
      rgb[(i + k) * 3] = color.r;
      rgb[(i + k) * 3 + 1] = color.g;
      rgb[(i + k) * 3 + 2] = color.b;
    }
  }
  g.setAttribute('color', new BufferAttribute(rgb, 3));
  return g;
}

/** Pole hanging down -Y from the grip at the origin. */
function buildPole(): BufferGeometry {
  const shaft = paint(new CylinderGeometry(0.011, 0.008, 1.12, 5).translate(0, -0.56, 0), FIXED.poleShaft);
  const grip = paint(new CylinderGeometry(0.02, 0.018, 0.14, 6).translate(0, -0.02, 0), FIXED.poleDark);
  const basket = paint(new CylinderGeometry(0.045, 0.045, 0.012, 6).translate(0, -1.02, 0), FIXED.poleDark);
  return merge([shaft, grip, basket]);
}
