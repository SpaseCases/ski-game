import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Euler,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Quaternion,
  Shape,
  Sphere,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DEFAULT_OUTFIT, type Outfit } from '../core/outfit.ts';
import { clothMaterial } from './cloth.ts';
import type { PoseDef, Vec3 } from './skierPoses.ts';

// Low-poly freeskier: a straight hip-length shell jacket, wide pants over
// chunky boots, a snug matte helmet, small goggles and a neck gaiter that
// close up the face, twin-tip skis and poles. Each body segment is its own
// mesh (vertex colors, flat shading, one shared material) placed every pose
// by a small solver: hips, chest and head are rigid; knees and elbows come
// from two-bone IK so hands and feet land where the pose says. The jacket's
// hem is the one part rebuilt every pose, so it rides up over the thighs.
// Colors and headwear come from the Locker's outfit; changing it rebuilds
// only the parts it touches (setOutfit), never per frame.

const FIXED = {
  gaiter: '#1b1d21',
  gaiterSeam: '#2a2d33',
  vent: '#0e0f12',
  /** Dark smoke lens, a shade lighter at the top. */
  lensTop: '#5a6676',
  lensBottom: '#45505e',
  zip: '#16181c',
  bootSole: '#202328',
  buckle: '#c9ced6',
  binding: '#1c1f25',
  skiTop: '#21252c',
  skiTip: '#b8e330',
  skiStripe: '#e2497b',
  skiBase: '#2f7fe0',
  poleShaft: '#b8c0c9',
  poleDark: '#1c1f25',
  hatRed: '#c3262e',
  hatFur: '#f3f1ec',
  pumpkin: '#e8761e',
  pumpkinGroove: '#c95f14',
  pumpkinFlesh: '#f6c05a',
  stem: '#6e6a2c',
  /** The carved face: a dark hollow by day; glowing at night (setGlow). */
  carvedDark: '#2a1206',
  carvedGlow: '#ffb43a',
};

/** Body proportions in meters. */
export const BODY = {
  /** Ankle joint above the ski base, and behind the ski's middle. */
  ankleHeight: 0.16,
  ankleBack: 0.02,
  shin: 0.43,
  thigh: 0.43,
  hipWidth: 0.088,
  hipDrop: 0.03,
  /** Pelvis center to the base of the neck. */
  spine: 0.52,
  shoulderWidth: 0.19,
  shoulderDrop: 0.07,
  upperArm: 0.29,
  forearm: 0.25,
  /** Wrist to the middle of the glove. */
  hand: 0.05,
  skiLength: 1.76,
  skiWidth: 0.1,
};

/** Goggle height above the base of the neck; also roughly the middle of the head. */
const GOGGLE_Y = 0.205;

/** Range (degrees) a ski boot lets the foot sit at relative to the shin. */
const ANKLE_MIN = 55;
const ANKLE_MAX = 145;

/** Joint hints used when a pose leaves them out, per side (index 0 left, 1 right). */
export const DEFAULT_HINTS = {
  knee: [
    [-0.15, 0.05, -1],
    [0.15, 0.05, -1],
  ],
  elbow: [
    [-0.7, -0.4, 0.5],
    [0.7, -0.4, 0.5],
  ],
  pole: [
    [-0.18, -0.8, 0.55],
    [0.18, -0.8, 0.55],
  ],
} as const satisfies Record<string, readonly [Vec3, Vec3]>;

const DOWN = new Vector3(0, -1, 0);

export class SkierRig {
  readonly root = new Group();
  private readonly pelvis: Mesh;
  private readonly torso: Mesh;
  private readonly hem: JacketLower;
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

  /** Middle of the head and midpoint between the ankles, in skier space, after the last pose. */
  readonly headCenter = new Vector3();
  readonly feetCenter = new Vector3();
  /** Largest distance (m) a hand or foot fell short of its target in the last pose. */
  reachError = 0;
  /** Largest amount (degrees) a foot was bent past what a boot allows in the last pose. */
  ankleError = 0;

  /** Santa hat (cloth, so it sways) and the pumpkin's carved face (unlit, for its glow); children of the head. */
  private readonly hat: Mesh;
  private readonly face: Mesh;
  private readonly material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  private readonly glowMaterial = new MeshBasicMaterial({ color: FIXED.carvedDark });
  private outfit: Outfit;

  constructor(outfit: Outfit = DEFAULT_OUTFIT) {
    this.outfit = { ...outfit };
    const add = (geometry: BufferGeometry): Mesh => {
      const mesh = new Mesh(geometry, this.material);
      this.root.add(mesh);
      return mesh;
    };
    const c = colors(outfit);

    // The seat of the pants, under the jacket's hem.
    this.pelvis = add(buildPelvis(c.pants));
    this.torso = add(buildTorso(c.jacket));
    this.hem = new JacketLower(c.jacket);
    this.root.add(this.hem.mesh);
    this.head = add(buildHead(outfit));
    this.hat = new Mesh(new BufferGeometry(), clothMaterial);
    this.face = new Mesh(new BufferGeometry(), this.glowMaterial);
    this.head.add(this.hat, this.face);
    this.setHeadwear();
    // Both sides share one geometry, apart from the feet (buckles on the outside).
    const upperArm = buildUpperArm(c.jacket);
    const forearm = buildForearm(c.jacket, c.mittens);
    const thigh = buildThigh(c.pants);
    const shin = buildShin(c.pants, c.boots);
    const pole = buildPole();
    for (const side of [-1, 1]) {
      this.upperArms.push(add(upperArm));
      this.forearms.push(add(forearm));
      this.thighs.push(add(thigh));
      this.shins.push(add(shin));
      this.feet.push(add(buildFoot(side, c.boots)));
      this.poles.push(add(pole));
    }
  }

  /** Changes colors or headwear, rebuilding only the parts that change (the old geometry is freed). */
  setOutfit(next: Outfit): void {
    const prev = this.outfit;
    this.outfit = { ...next };
    const changed = (...keys: (keyof Outfit)[]): boolean => keys.some((k) => prev[k] !== next[k]);
    const c = colors(next);
    if (changed('pants')) {
      swap([this.pelvis], buildPelvis(c.pants));
      swap(this.thighs, buildThigh(c.pants));
    }
    if (changed('jacket')) {
      swap([this.torso], buildTorso(c.jacket));
      this.hem.recolor(c.jacket);
      swap(this.upperArms, buildUpperArm(c.jacket));
    }
    if (changed('jacket', 'mittens')) swap(this.forearms, buildForearm(c.jacket, c.mittens));
    if (changed('pants', 'boots')) swap(this.shins, buildShin(c.pants, c.boots));
    if (changed('boots')) this.feet.forEach((m, i) => swap([m], buildFoot(i === 0 ? -1 : 1, c.boots)));
    if (changed('helmet', 'goggleFrame', 'goggleStrap', 'headwear')) {
      swap([this.head], buildHead(next));
      this.setHeadwear();
    }
  }

  /** How brightly the pumpkin's carved face glows: 0 by day (a dark hollow), 1 at night. */
  setGlow(amount: number): void {
    this.glowMaterial.color.set(FIXED.carvedDark).lerp(glowColor, Math.min(1, Math.max(0, amount)));
  }

  /** Frees every geometry and material (the rig is not used again). */
  dispose(): void {
    const seen = new Set<BufferGeometry>();
    this.root.traverse((o) => {
      if (o instanceof Mesh) seen.add(o.geometry as BufferGeometry);
    });
    for (const g of seen) g.dispose();
    this.material.dispose();
    this.glowMaterial.dispose();
  }

  /** Builds the Santa hat or the carved face for the current headwear (or neither). */
  private setHeadwear(): void {
    const hw = this.outfit.headwear;
    swap([this.hat], hw === 'santa' ? buildSantaHat() : new BufferGeometry());
    swap([this.face], hw === 'pumpkin' ? buildCarvedFace(false) : new BufferGeometry());
    this.hat.visible = hw === 'santa';
    this.face.visible = hw === 'pumpkin';
  }

  /** Solves the pose and moves every part into place. */
  apply(p: PoseDef): void {
    this.reachError = 0;
    this.ankleError = 0;

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
    this.headCenter.set(0, GOGGLE_Y, 0).applyQuaternion(this.headQ).add(neck);

    // Arms first: shoulder to hand, elbow solved toward the elbow hint.
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const hand = p.hands[i === 0 ? 0 : 1];
      this.shoulders[i]!.set(side * BODY.shoulderWidth, BODY.spine - BODY.shoulderDrop, 0)
        .applyQuaternion(this.chestQ)
        .add(this.pelvisPos);
      this.hands[i]!.set(hand.at[0], hand.at[1], hand.at[2]);
      setHint(hint, hand.elbow ?? DEFAULT_HINTS.elbow[i === 0 ? 0 : 1]);
      this.solveLimb(this.shoulders[i]!, this.hands[i]!, BODY.upperArm, BODY.forearm + BODY.hand, hint, this.elbows[i]!);
      segment(this.upperArms[i]!, this.shoulders[i]!, this.elbows[i]!, hint);
      segment(this.forearms[i]!, this.elbows[i]!, this.hands[i]!, hint);

      // Pole hangs from the hand.
      setHint(v3, hand.pole ?? DEFAULT_HINTS.pole[i === 0 ? 0 : 1]).normalize();
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
      this.ankles[i]!.set(foot.ankle[0], foot.ankle[1], foot.ankle[2]);
      if (grip) {
        // Partway into a grab, the ski is partway to the hand.
        ankleForGrip(v1, this.hands[holder]!, grip, this.footQs[i]!);
        this.ankles[i]!.lerp(v1, p.hands[holder === 0 ? 0 : 1].weight ?? 1);
      }

      setHint(hint, foot.knee ?? DEFAULT_HINTS.knee[i === 0 ? 0 : 1]);
      this.solveLimb(this.hips[i]!, this.ankles[i]!, BODY.thigh, BODY.shin, hint, this.knees[i]!);
      segment(this.thighs[i]!, this.hips[i]!, this.knees[i]!, hint);
      segment(this.shins[i]!, this.knees[i]!, this.ankles[i]!, hint);
      place(this.feet[i]!, this.ankles[i]!, this.footQs[i]!);
      this.checkAnkle(i);
    }

    this.feetCenter.addVectors(this.ankles[0]!, this.ankles[1]!).multiplyScalar(0.5);

    place(this.hem.mesh, this.pelvisPos, this.pelvisQ);
    this.hem.fit(this.pelvisPos, this.pelvisQ, this.chestQ, this.hips, this.knees);
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

  /**
   * Flags a foot turned further than a boot allows: the toe should sit
   * roughly square to the shin, on the same side the knee bends toward.
   */
  private checkAnkle(i: number): void {
    const knee = this.knees[i]!;
    const ankle = this.ankles[i]!;
    dir.subVectors(ankle, knee).normalize(); // shin, knee to ankle
    v2.set(0, 0, -1).applyQuaternion(this.footQs[i]!); // toe direction
    const angle = (Math.acos(Math.min(1, Math.max(-1, v2.dot(dir)))) * 180) / Math.PI;
    let error = Math.max(0, ANKLE_MIN - angle, angle - ANKLE_MAX);
    // Which way the knee sticks out of the hip-ankle line is the front of the leg.
    side.addVectors(this.hips[i]!, ankle).multiplyScalar(0.5);
    side.subVectors(knee, side);
    if (side.lengthSq() > 1e-6 && v2.dot(side.normalize()) < -0.25) error = Math.max(error, 90);
    this.ankleError = Math.max(this.ankleError, error);
  }
}

// Scratch objects so posing never allocates.
const euler = new Euler();
const q1 = new Quaternion();
const v1 = new Vector3();
const v2 = new Vector3();
const v3 = new Vector3();
const hint = new Vector3();
const dir = new Vector3();
const side = new Vector3();
const basis = new Matrix4();
const xAxis = new Vector3();
const yAxis = new Vector3();
const zAxis = new Vector3();
const skiOffset = new Vector3();

const glowColor = new Color(FIXED.carvedGlow);

/** The outfit's colors as Colors. */
function colors(o: Outfit): Record<'jacket' | 'pants' | 'boots' | 'mittens', Color> {
  return { jacket: new Color(o.jacket), pants: new Color(o.pants), boots: new Color(o.boots), mittens: new Color(o.mittens) };
}

/** Gives `meshes` (which share one geometry) a new geometry, freeing the old one. */
function swap(meshes: readonly Mesh[], geometry: BufferGeometry): void {
  meshes[0]?.geometry.dispose();
  for (const m of meshes) m.geometry = geometry;
}

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

function setHint(out: Vector3, v: Vec3): Vector3 {
  return out.set(v[0], v[1], v[2]);
}

/** Where the ankle must be for the ski point `grip` (ski space) to sit at `hand`. */
function ankleForGrip(out: Vector3, hand: Vector3, grip: Vec3, footQ: Quaternion): Vector3 {
  skiOffset.set(grip[0], grip[1] - BODY.ankleHeight, grip[2] - BODY.ankleBack).applyQuaternion(footQ);
  return out.copy(hand).sub(skiOffset);
}

// ---------------------------------------------------------------------------
// Geometry. Every part is non-indexed with a per-vertex color, so the pieces
// of one rigid part merge into a single mesh whatever their colors.

type FaceColor = (centroid: Vector3, normal: Vector3) => Color;

const fa = new Vector3();
const fb = new Vector3();
const fc = new Vector3();
const centroid = new Vector3();
const faceNormal = new Vector3();

/** Colors a geometry: one color, or per face from its centroid and normal. */
function paint(geometry: BufferGeometry, color: Color | string | FaceColor): BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.deleteAttribute('uv');
  const pos = g.getAttribute('position');
  const rgb = new Float32Array(pos.count * 3);
  const fixed = typeof color === 'function' ? null : typeof color === 'string' ? new Color(color) : color;
  for (let i = 0; i < pos.count; i += 3) {
    let c = fixed;
    if (!c) {
      fa.fromBufferAttribute(pos, i);
      fb.fromBufferAttribute(pos, i + 1);
      fc.fromBufferAttribute(pos, i + 2);
      centroid.copy(fa).add(fb).add(fc).divideScalar(3);
      faceNormal.subVectors(fc, fb).cross(fa.sub(fb)).normalize();
      c = (color as FaceColor)(centroid, faceNormal);
    }
    for (let k = 0; k < 3; k++) {
      rgb[(i + k) * 3] = c.r;
      rgb[(i + k) * 3 + 1] = c.g;
      rgb[(i + k) * 3 + 2] = c.b;
    }
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

function shade(color: Color, amount: number): Color {
  return color.clone().multiplyScalar(amount);
}

/** A tapered prism from y = 0 (radius `r0`) to y = `length` (radius `r1`). */
function prism(r0: number, r1: number, length: number, sides: number): BufferGeometry {
  return new CylinderGeometry(r1, r0, length, sides).translate(0, length / 2, 0);
}

type AngleFn = (a: number) => number;
type Point = readonly [number, number, number];

/**
 * A thick curved panel wrapped around the vertical axis, like goggles or a
 * helmet trim. Angle 0 is straight ahead (-Z). Inner and outer radius and
 * the top and bottom edges can all change with the angle.
 */
function curvedPanel(
  ri: AngleFn,
  ro: AngleFn,
  top: AngleFn,
  bottom: AngleFn,
  a0: number,
  a1: number,
  segments: number,
): BufferGeometry {
  const pos: number[] = [];
  const at = (r: number, a: number, y: number): Point => [r * Math.sin(a), y, -r * Math.cos(a)];
  // Two triangles p-q-r and p-r-s, wound so the face points out of the panel.
  const quad = (p: Point, q: Point, r: Point, s: Point): void => {
    pos.push(...p, ...q, ...r, ...p, ...r, ...s);
  };
  const corners = (a: number): Point[] => [
    at(ri(a), a, bottom(a)),
    at(ri(a), a, top(a)),
    at(ro(a), a, bottom(a)),
    at(ro(a), a, top(a)),
  ];
  for (let i = 0; i < segments; i++) {
    const [ia0, ia1, oa0, oa1] = corners(a0 + ((a1 - a0) * i) / segments) as [Point, Point, Point, Point];
    const [ib0, ib1, ob0, ob1] = corners(a0 + ((a1 - a0) * (i + 1)) / segments) as [Point, Point, Point, Point];
    quad(oa0, oa1, ob1, ob0); // outside
    quad(ia0, ib0, ib1, ia1); // inside
    quad(ia1, ib1, ob1, oa1); // top edge
    quad(ia0, oa0, ob0, ib0); // bottom edge
    if (i === 0) quad(ia0, ia1, oa1, oa0);
    if (i === segments - 1) quad(ib0, ob0, ob1, ib1);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

const constant =
  (v: number): AngleFn =>
  () =>
    v;

function buildPelvis(pants: Color): BufferGeometry {
  return paint(prism(0.13, 0.15, 0.2, 12).translate(0, -0.13, 0).scale(1, 1, 0.72), pants);
}

/**
 * Upper jacket, from the belly up: a straight shell, a touch narrower at the
 * waist, with a high collar, the hood rolled down behind the neck, a zip and
 * a chest pocket. Below the belly the jacket is a JacketLower.
 */
function buildTorso(jacket: Color): BufferGeometry {
  const dark = shade(jacket, 0.78);
  const parts = [
    paint(prism(0.205, 0.222, BODY.spine - TORSO_BOTTOM, 12).translate(0, TORSO_BOTTOM, 0).scale(1, 1, 0.66), jacket),
    paint(prism(0.112, 0.102, 0.09, 12).translate(0, 0.49, 0.008).scale(1, 1, 0.95), jacket),
    paint(new SphereGeometry(0.12, 12, 8).scale(1.2, 0.55, 0.7).translate(0, 0.53, 0.12), dark),
    paint(new BoxGeometry(0.014, 0.21, 0.012).translate(0, 0.405, -0.144), FIXED.zip),
    paint(new BoxGeometry(0.11, 0.085, 0.012).translate(-0.1, 0.38, -0.14), dark),
  ];
  for (const s of [-1, 1]) {
    parts.push(paint(new IcosahedronGeometry(0.09, 1).translate(s * BODY.shoulderWidth, BODY.spine - BODY.shoulderDrop, 0), jacket));
  }
  return merge(parts);
}

/** Height (chest frame) where the rigid upper jacket ends and the rebuilt lower jacket takes over. */
const TORSO_BOTTOM = 0.3;

// Lower jacket: rings of points from inside the upper jacket, down past the
// waist to a straight hem that drops a little lower at the back, then
// turned under. The top rings follow the chest, the rest the hips. Angle 0
// is the front.
const LOWER_SEGMENTS = 18;
const hemLow = (a: number): number => -0.16 - 0.07 * ((1 - Math.cos(a)) / 2) ** 1.5;
interface LowerRing {
  /** Built in the chest's frame (else the hips'). */
  chest: boolean;
  /** Kept out of the thighs. */
  push: boolean;
  /** Height, radius and front-to-back depth at angle a. */
  at: (a: number) => [number, number, number];
}
const LOWER_RINGS: readonly LowerRing[] = [
  { chest: true, push: false, at: () => [0.35, 0.2, 0.64] },
  { chest: true, push: true, at: () => [0.25, 0.205, 0.66] },
  { chest: true, push: true, at: () => [0.12, 0.202, 0.67] },
  { chest: false, push: true, at: () => [-0.01, 0.198, 0.7] },
  { chest: false, push: true, at: (a) => [hemLow(a) + 0.032, 0.2, 0.72] },
  { chest: false, push: true, at: (a) => [hemLow(a), 0.201, 0.72] },
  { chest: false, push: true, at: (a) => [hemLow(a) + 0.008, 0.184, 0.7] },
];
/** Rings the zip runs between (it carries on up the upper jacket), and its half-width. */
const ZIP_FIRST = 1;
const ZIP_LAST = 5;
const ZIP_HALF = 0.007;
/** Thigh radius plus a little room, for keeping the jacket outside the legs. */
const THIGH_ROOM = 0.11;
/** Furthest (m) a raised thigh lifts any point of the jacket. */
const MAX_RIDE_UP = 0.12;

/**
 * The jacket from the belly down, rebuilt every pose. A straight jacket on
 * rigid hips would let raised thighs poke straight through it: instead every
 * point inside a thigh is moved out of it (onto the thigh's top side when the
 * thigh is raised), so the jacket bunches up over the legs like real fabric.
 * Drawn from both sides, so looking up under the hem never sees through it.
 */
class JacketLower {
  readonly mesh: Mesh;
  /** Ring points then zip points, in pelvis space, and which point each mesh vertex is. */
  private readonly points: Float32Array;
  private readonly vertexPoint: Uint16Array;
  private readonly position: BufferAttribute;
  private readonly ringPoints = LOWER_RINGS.length * LOWER_SEGMENTS;

  constructor(jacket: Color) {
    const colors: number[] = [];
    const index = this.build(jacket, colors);
    this.points = new Float32Array((this.ringPoints + (ZIP_LAST - ZIP_FIRST + 1) * 2) * 3);
    this.vertexPoint = new Uint16Array(index);
    this.position = new BufferAttribute(new Float32Array(index.length * 3), 3);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', this.position);
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    // It moves every pose; a fixed sphere around the hips covers it.
    geometry.boundingSphere = new Sphere(new Vector3(0, 0, 0), 0.6);
    this.mesh = new Mesh(geometry, lowerMaterial);
  }

  /** New jacket color: rewrites the vertex colors in place (the shape is untouched). */
  recolor(jacket: Color): void {
    const colors: number[] = [];
    this.build(jacket, colors);
    const attr = this.mesh.geometry.getAttribute('color') as BufferAttribute;
    (attr.array as Float32Array).set(colors);
    attr.needsUpdate = true;
  }

  /** The mesh's faces: fills `colors` per vertex and returns which point each vertex is. */
  private build(jacket: Color, colors: number[]): number[] {
    const band = shade(jacket, 0.78);
    const under = shade(jacket, 0.6);
    const zip = new Color(FIXED.zip);
    const index: number[] = [];
    const quad = (a: number, b: number, c: number, d: number, color: Color): void => {
      index.push(a, b, c, a, c, d);
      for (let k = 0; k < 6; k++) colors.push(color.r, color.g, color.b);
    };
    const point = (ring: number, seg: number): number => ring * LOWER_SEGMENTS + (seg % LOWER_SEGMENTS);
    const last = LOWER_RINGS.length - 1;
    for (let ring = 0; ring < last; ring++) {
      const color = ring < last - 2 ? jacket : ring === last - 2 ? band : under;
      for (let seg = 0; seg < LOWER_SEGMENTS; seg++) {
        // Wound so the outside faces out (and the turned-under band faces down).
        quad(point(ring, seg), point(ring, seg + 1), point(ring + 1, seg + 1), point(ring + 1, seg), color);
      }
    }
    // Zip: a strip just proud of the front, two points per ring.
    const zipPoint = (ring: number, side: number): number => this.ringPoints + (ring - ZIP_FIRST) * 2 + side;
    for (let ring = ZIP_FIRST; ring < ZIP_LAST; ring++) {
      quad(zipPoint(ring, 0), zipPoint(ring, 1), zipPoint(ring + 1, 1), zipPoint(ring + 1, 0), zip);
    }
    return index;
  }

  /** Rebuilds the lower jacket for a solved pose (all inputs in skier space). */
  fit(pelvisPos: Vector3, pelvisQ: Quaternion, chestQ: Quaternion, hips: Vector3[], knees: Vector3[]): void {
    lowerInv.copy(pelvisQ).invert();
    lowerChest.copy(lowerInv).multiply(chestQ);
    for (let i = 0; i < 2; i++) {
      lowerHips[i]!.copy(hips[i]!).sub(pelvisPos).applyQuaternion(lowerInv);
      lowerKnees[i]!.copy(knees[i]!).sub(pelvisPos).applyQuaternion(lowerInv);
    }
    const pts = this.points;
    for (let ring = 0; ring < LOWER_RINGS.length; ring++) {
      for (let seg = 0; seg < LOWER_SEGMENTS; seg++) {
        this.ringPoint(ring, (seg / LOWER_SEGMENTS) * Math.PI * 2, 1);
        lowerP.toArray(pts, (ring * LOWER_SEGMENTS + seg) * 3);
      }
      if (ring < ZIP_FIRST || ring > ZIP_LAST) continue;
      for (let side = 0; side < 2; side++) {
        const r = LOWER_RINGS[ring]!.at(0)[1];
        this.ringPoint(ring, (side === 0 ? -ZIP_HALF : ZIP_HALF) / r, 1.012);
        lowerP.toArray(pts, (this.ringPoints + (ring - ZIP_FIRST) * 2 + side) * 3);
      }
    }
    const out = this.position.array as Float32Array;
    const map = this.vertexPoint;
    for (let v = 0; v < map.length; v++) {
      const k = (map[v] ?? 0) * 3;
      out[v * 3] = pts[k] ?? 0;
      out[v * 3 + 1] = pts[k + 1] ?? 0;
      out[v * 3 + 2] = pts[k + 2] ?? 0;
    }
    this.position.needsUpdate = true;
  }

  /** One point of a ring at angle `a`, scaled out by `grow`, into lowerP (pelvis space). */
  private ringPoint(ring: number, a: number, grow: number): void {
    const def = LOWER_RINGS[ring]!;
    const [y, r, depth] = def.at(a);
    lowerP.set(r * grow * Math.sin(a), y, -r * grow * Math.cos(a) * depth);
    if (def.chest) lowerP.applyQuaternion(lowerChest);
    if (!def.push) return;
    // Twice, so a point pushed out of one thigh into the other ends up clear of both.
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < 2; i++) pushOutOfThigh(lowerP, lowerHips[i]!, lowerKnees[i]!);
    }
  }
}

const lowerMaterial = new MeshLambertMaterial({ vertexColors: true, flatShading: true, side: DoubleSide });
const lowerInv = new Quaternion();
const lowerChest = new Quaternion();
const lowerHips = [new Vector3(), new Vector3()];
const lowerKnees = [new Vector3(), new Vector3()];
const lowerP = new Vector3();
const hemAxis = new Vector3();
const hemNear = new Vector3();
const hemOff = new Vector3();
const hemUp = new Vector3();
const hemRadial = new Vector3();

/**
 * Moves `p` out of the thigh running from `hip` to `knee` (pelvis space).
 * Beside a hanging thigh the jacket is pushed straight out from it. A raised
 * thigh lifts the jacket straight up toward the waist instead, the way a
 * jacket rides up when you pull your knees in, rather than wrapping the leg.
 */
function pushOutOfThigh(p: Vector3, hip: Vector3, knee: Vector3): void {
  hemAxis.subVectors(knee, hip);
  const len2 = hemAxis.lengthSq();
  const t = Math.min(1, Math.max(0, hemOff.subVectors(p, hip).dot(hemAxis) / (len2 || 1)));
  hemNear.copy(hip).addScaledVector(hemAxis, t);
  hemOff.subVectors(p, hemNear);
  const dist = hemOff.length();
  const room = THIGH_ROOM;
  if (dist >= room) return;

  // Straight out from the thigh's axis.
  if (dist > 1e-6) hemRadial.copy(hemOff).multiplyScalar(room / dist - 1);
  else hemRadial.set(room, 0, 0);

  // Straight up until clear of the thigh (as a cylinder): solve
  // |offset + lift * up| = room across the thigh's axis.
  hemAxis.normalize();
  hemUp.set(0, 1, 0).addScaledVector(hemAxis, -hemAxis.y); // up, across the thigh
  const a = hemUp.lengthSq();
  const raised = smooth01((Math.sqrt(a) - 0.25) / 0.35);
  if (raised > 0) {
    hemOff.addScaledVector(hemAxis, -hemOff.dot(hemAxis)); // offset across the thigh
    const b = hemOff.dot(hemUp);
    const c = hemOff.lengthSq() - room * room;
    // Fabric only rides up so far; past that it stays bunched against the leg.
    const lift = Math.min(MAX_RIDE_UP, (-b + Math.sqrt(Math.max(0, b * b - a * c))) / a);
    hemRadial.lerp(hemUp.set(0, lift, 0), raised);
  }
  p.add(hemRadial);
}

// Goggles: a compact frame, tallest in front and tapering toward the
// temples, where it draws in and slips under the helmet (the strap runs
// inside the helmet, out of sight). Angles are radians from straight ahead.
const GOGGLE_SPAN = 1.62;
const LENS_SPAN = 1.28;
const GOGGLE_DEPTH = 1.12;
const goggleHalf: AngleFn = (a) => 0.034 + 0.011 * Math.max(0, Math.cos((a * Math.PI) / (2 * GOGGLE_SPAN)));
const goggleNose: AngleFn = (a) => 0.016 * Math.max(0, 1 - Math.abs(a) / 0.28) ** 2;
const goggleOuter: AngleFn = (a) => 0.122 - 0.016 * smooth01((Math.abs(a) - 1.1) / 0.5);

// Helmet: a snug, rounded low-profile shell. Across the front its edge
// rests on the goggle frame; past the lens it sweeps down over the ears and
// rises a little toward the back of the head.
const HELMET = { r: 0.13, y: 0.205, squash: 0.95, long: 1.1, back: 0.006 };
const helmetEdge: AngleFn = (a) => {
  const abs = Math.abs(a);
  const front = GOGGLE_Y + goggleHalf(Math.min(abs, LENS_SPAN)) + 0.001;
  const low = 0.135 + 0.02 * smooth01((abs - 2.2) / 0.7);
  return front + (low - front) * smooth01((abs - LENS_SPAN) / 0.45);
};
/** Horizontal radius of the (unstretched) helmet dome at height `y`. */
const helmetRadiusAt = (y: number): number =>
  HELMET.r * Math.sqrt(Math.max(0, 1 - ((y - HELMET.y) / (HELMET.r * HELMET.squash)) ** 2));

function smooth01(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/**
 * Head, built up from the base of the neck: gaiter, goggles, helmet (the
 * Santa hat goes over it as its own mesh). Nothing of the face shows. The
 * jack-o'-lantern replaces the helmet and goggles with a whole pumpkin.
 */
function buildHead(o: Outfit): BufferGeometry {
  if (o.headwear === 'pumpkin') return merge([...buildGaiter(), ...buildPumpkin(), buildCarvedFace(true)]);
  return merge([
    // Head under everything, in case any gap shows.
    paint(new SphereGeometry(0.105, 16, 12).scale(1, 1.08, 1.1).translate(0, 0.2, 0), FIXED.gaiter),
    ...buildGaiter(),
    ...buildHelmet(new Color(o.helmet), o.goggleStrap),
    ...buildGoggles(o.goggleFrame),
  ]);
}

/** Neck gaiter pulled up over the chin and nose, following the jaw, tucked under the goggles and helmet. */
function buildGaiter(): BufferGeometry[] {
  const profile = [
    [0.074, -0.02],
    [0.078, 0.02],
    [0.086, 0.06],
    [0.097, 0.1],
    [0.102, 0.135],
    [0.103, 0.165],
    [0.1, 0.19],
    [0.097, 0.205],
  ].map(([r, y]) => new Vector2(r, y));
  const face = (g: BufferGeometry): BufferGeometry => g.scale(1, 1, 1.13).translate(0, 0, -0.006);
  return [
    paint(face(new LatheGeometry(profile, 18)), FIXED.gaiter),
    paint(face(prism(0.0835, 0.0875, 0.012, 18).translate(0, 0.048, 0)), FIXED.gaiterSeam),
    // Nose under the fabric, just below the goggles.
    paint(new IcosahedronGeometry(0.028, 0).scale(0.7, 0.9, 0.85).translate(0, 0.166, -0.118), FIXED.gaiter),
  ];
}

function buildHelmet(helmet: Color, strap: string): BufferGeometry[] {
  const fit = (g: BufferGeometry): BufferGeometry => g.scale(1, 1, HELMET.long).translate(0, 0, HELMET.back);

  // Dome, with every vertex below the edge line lifted onto it.
  const shell = new SphereGeometry(HELMET.r, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.66)
    .scale(1, HELMET.squash, 1)
    .translate(0, HELMET.y, 0);
  const p = shell.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const edge = helmetEdge(Math.atan2(p.getX(i), -p.getZ(i)));
    if (p.getY(i) < edge) p.setY(i, edge);
  }

  const edgeColor = shade(helmet, 0.72);
  const parts = [paint(fit(shell), helmet)];
  // A slim rolled edge all round, a touch proud of the shell.
  const trimR: AngleFn = (a) => helmetRadiusAt(helmetEdge(a)) + 0.003;
  parts.push(
    paint(
      fit(curvedPanel((a) => trimR(a) - 0.01, trimR, (a) => helmetEdge(a) + 0.006, (a) => helmetEdge(a) - 0.003, -Math.PI, Math.PI, 40)),
      edgeColor,
    ),
  );
  // Small vents set into the shell: an arc of five over the forehead and two at the back.
  const vents: [number, number][] = [
    [0, 0.7],
    [-0.38, 0.74],
    [0.38, 0.74],
    [-0.76, 0.84],
    [0.76, 0.84],
    [Math.PI - 0.32, 0.95],
    [Math.PI + 0.32, 0.95],
  ];
  for (const [around, down] of vents) {
    // `down` is the angle from the crown; `around` turns from the front.
    const x = Math.sin(down) * Math.sin(around);
    const y = Math.cos(down) * HELMET.squash;
    const z = -Math.sin(down) * Math.cos(around);
    const normal = new Vector3(x, y, z).normalize();
    const slot = new BoxGeometry(0.011, 0.006, 0.03);
    slot.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), normal));
    const sink = HELMET.r - 0.002;
    slot.translate(x * sink, HELMET.y + y * sink, z * sink);
    parts.push(paint(fit(slot), FIXED.vent));
  }
  // Goggle strap round the back of the shell, from where the frame slips under the helmet's edge.
  const strapY: AngleFn = (a) => GOGGLE_Y + 0.012 * smooth01((Math.abs(wrapAngle(a)) - STRAP_FROM) / 1.2);
  parts.push(
    paint(
      fit(curvedPanel(constant(0.127), constant(0.1335), (a) => strapY(a) + 0.014, (a) => strapY(a) - 0.014, STRAP_FROM, Math.PI * 2 - STRAP_FROM, 20)),
      strap,
    ),
  );
  return parts;
}

/** Angle (from straight ahead) where the strap comes out from under the helmet's edge. */
const STRAP_FROM = 1.56;

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/**
 * Goggles under the helmet's front edge: a matte frame with a notch for the
 * nose, and a dark tinted lens set just proud of it.
 */
function buildGoggles(frame: string): BufferGeometry[] {
  const half = goggleHalf;
  const nose = goggleNose;
  const onFace = (g: BufferGeometry): BufferGeometry => g.scale(1, 1, GOGGLE_DEPTH).translate(0, GOGGLE_Y, 0);
  const lensIn: AngleFn = (a) => goggleOuter(a) - 0.002;
  const lensOut: AngleFn = (a) => goggleOuter(a) + 0.003;
  return [
    paint(
      onFace(curvedPanel((a) => goggleOuter(a) - 0.012, goggleOuter, half, (a) => -half(a) + nose(a), -GOGGLE_SPAN, GOGGLE_SPAN, 26)),
      frame,
    ),
    paint(onFace(curvedPanel(lensIn, lensOut, (a) => half(a) - 0.006, constant(-0.002), -LENS_SPAN, LENS_SPAN, 22)), FIXED.lensTop),
    paint(
      onFace(curvedPanel(lensIn, lensOut, constant(-0.002), (a) => -half(a) + nose(a) + 0.006, -LENS_SPAN, LENS_SPAN, 22)),
      FIXED.lensBottom,
    ),
  ];
}

/**
 * Santa hat over the helmet: a white fur band resting on the helmet's edge
 * just above the goggles (a touch lower at the back), a red cone that flops
 * back and to one side, and a pom-pom at its tip. Drawn with the cloth
 * material: its `sway` weight is 0 on the band and grows toward the tip, so
 * the tip and pom-pom sway like the banners.
 */
function buildSantaHat(): BufferGeometry {
  const fit = (g: BufferGeometry): BufferGeometry => g.scale(1, 1, HELMET.long).translate(0, 0, HELMET.back);
  const bandY: AngleFn = (a) => 0.262 - 0.022 * (1 - Math.cos(a)) * 0.5;
  const bandIn = helmetRadiusAt(0.255) - 0.004;
  const band = curvedPanel(constant(bandIn), constant(bandIn + 0.026), (a) => bandY(a) + 0.024, (a) => bandY(a) - 0.01, -Math.PI, Math.PI, 24);

  // Cone: rings along a path from the band's top to the tip.
  const RINGS = 7;
  const SIDES = 12;
  const path = (t: number, out: Vector3): Vector3 => out.set(0.035 * t * t, 0.27 + 0.13 * t - 0.035 * t * t * t, 0.006 + 0.012 * t + 0.1 * t * t);
  const radius = (t: number): number => (bandIn + 0.02) * (1 - t) ** 1.1 + 0.008;
  const rings: Vector3[][] = [];
  const c = new Vector3();
  const ahead = new Vector3();
  const tangent = new Vector3();
  const across = new Vector3();
  const fore = new Vector3();
  for (let k = 0; k <= RINGS; k++) {
    const t = k / RINGS;
    path(t, c);
    tangent.subVectors(path(Math.min(1, t + 0.01), ahead), path(Math.max(0, t - 0.01), fore)).normalize();
    path(t, c);
    across.set(1, 0, 0).addScaledVector(tangent, -tangent.x).normalize();
    fore.crossVectors(across, tangent).normalize(); // -Z-ish: the hat's front
    const r = radius(t);
    const ring: Vector3[] = [];
    for (let j = 0; j < SIDES; j++) {
      const a = (j / SIDES) * Math.PI * 2;
      ring.push(c.clone().addScaledVector(across, r * Math.sin(a)).addScaledVector(fore, r * Math.cos(a)));
    }
    rings.push(ring);
  }
  const tip = new Vector3();
  path(1, tip);
  const cone: number[] = [];
  for (let k = 0; k < RINGS; k++) {
    for (let j = 0; j < SIDES; j++) {
      const a0 = rings[k]![j]!;
      const a1 = rings[k]![(j + 1) % SIDES]!;
      const b0 = rings[k + 1]![j]!;
      const b1 = rings[k + 1]![(j + 1) % SIDES]!;
      cone.push(...outward(a0, a1, b1, c.copy(a0).sub(path(k / RINGS, tip))), ...outward(a0, b1, b0, c.copy(a0).sub(path(k / RINGS, tip))));
    }
  }
  const coneGeometry = new BufferGeometry();
  coneGeometry.setAttribute('position', new Float32BufferAttribute(cone, 3));
  coneGeometry.computeVertexNormals();
  path(1, tip);
  const pom = new IcosahedronGeometry(0.03, 1).translate(tip.x, tip.y, tip.z);

  const g = fit(merge([paint(band, FIXED.hatFur), paint(coneGeometry, FIXED.hatRed), paint(pom, FIXED.hatFur)]));
  // Sway grows with height above the band; the pom-pom moves as one with the tip.
  const pos = g.getAttribute('position');
  const sway = new Float32Array(pos.count);
  const tipY = tip.y;
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, (pos.getY(i) - 0.29) / (tipY - 0.29)));
    sway[i] = 0.24 * t * t;
  }
  g.setAttribute('sway', new BufferAttribute(sway, 1));
  return g;
}

/** Triangle a, b, c as a flat list, wound so its face points along `out`. */
function outward(a: Vector3, b: Vector3, c: Vector3, out: Vector3): number[] {
  fa.subVectors(b, a);
  fb.subVectors(c, a);
  const flip = fc.crossVectors(fa, fb).dot(out) < 0;
  return flip ? [a.x, a.y, a.z, c.x, c.y, c.z, b.x, b.y, b.z] : [a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z];
}

// Jack-o'-lantern: a whole ribbed pumpkin for a head, well bigger than the
// helmet and sitting low, so it swallows the head and most of the neck
// (its bottom meets the collar), with a stem in the top's dimple.
const PUMPKIN = { r: 0.185, h: 0.16, y: 0.165, ribs: 8, ribDepth: 0.05 };
/** The carved face was drawn for a 0.152 m pumpkin; its heights scale with it (angles don't need to). */
const FACE_SCALE = PUMPKIN.r / 0.152;
/** Rib bulge at angle a from straight ahead: a rib's middle faces forward. */
const pumpkinRib = (a: number): number => 1 - PUMPKIN.ribDepth * (0.5 - 0.5 * Math.cos(PUMPKIN.ribs * a));
/** Distance from the pumpkin's axis to its skin at angle a and height y (from the pumpkin's middle). */
const pumpkinSkin = (a: number, y: number): number => PUMPKIN.r * pumpkinRib(a) * Math.sqrt(Math.max(0, 1 - (y / PUMPKIN.h) ** 2));

function buildPumpkin(): BufferGeometry[] {
  const profile: Vector2[] = [new Vector2(0.001, -PUMPKIN.h * 0.97)];
  for (let i = 1; i < 8; i++) {
    const phi = -Math.PI / 2 + (i / 8) * Math.PI;
    profile.push(new Vector2(PUMPKIN.r * Math.cos(phi), PUMPKIN.h * Math.sin(phi)));
  }
  profile.push(new Vector2(0.03, PUMPKIN.h * 0.9), new Vector2(0.001, PUMPKIN.h * 0.82));
  const shell = new LatheGeometry(profile, PUMPKIN.ribs * 3);
  const p = shell.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const k = pumpkinRib(Math.atan2(p.getX(i), -p.getZ(i)));
    p.setXYZ(i, p.getX(i) * k, p.getY(i) + PUMPKIN.y, p.getZ(i) * k);
  }
  const skin = new Color(FIXED.pumpkin);
  const groove = new Color(FIXED.pumpkinGroove);
  const mix = new Color();
  const top = PUMPKIN.y + PUMPKIN.h * 0.82;
  return [
    paint(shell, (c) => mix.copy(skin).lerp(groove, 0.5 - 0.5 * Math.cos(PUMPKIN.ribs * Math.atan2(c.x, -c.z)))),
    paint(prism(0.023, 0.014, 0.075, 6).rotateZ(0.25).rotateX(0.15).translate(0, top - 0.012, 0), FIXED.stem),
  ];
}

/**
 * The carved face: triangle eyes and nose and a toothy grin, laid on the
 * pumpkin's skin. `rim` gives the pale cut flesh round each hole (part of
 * the head); otherwise the holes themselves, a touch further out, drawn
 * unlit so they can glow at night without a light (see setGlow).
 */
function buildCarvedFace(rim: boolean): BufferGeometry {
  const k = FACE_SCALE;
  const grow = rim ? 0.007 * k : 0;
  const lift = rim ? 0.0015 : 0.003;
  const tri = (ac: number, yc: number, w: number, h: number): BufferGeometry =>
    carvedPanel(
      (a) => yc - h / 2 + (h + grow) * Math.max(0, 1 - Math.abs(a - ac) / (w + grow)) + grow * 0.4,
      () => yc - h / 2 - grow,
      ac - w - grow,
      ac + w + grow,
      6,
      lift,
    );
  const MOUTH = 0.56;
  const mid = (a: number): number => (-0.054 + 0.026 * (a / MOUTH) ** 2) * k;
  const half = (a: number): number => (0.023 * Math.sqrt(Math.max(0, 1 - (a / (MOUTH + grow)) ** 2)) + 0.002) * k;
  const notch = (a: number, at: number, w: number): number => (Math.abs(a - at) < w ? 0.017 * k : 0);
  const mouth = carvedPanel(
    (a) => mid(a) + half(a) + grow - (rim ? 0 : notch(a, -0.22, 0.055) + notch(a, 0.22, 0.055)),
    (a) => mid(a) - half(a) - grow + (rim ? 0 : notch(a, 0, 0.06)),
    -MOUTH - grow,
    MOUTH + grow,
    28,
    lift,
  );
  const parts = [tri(-0.3, 0.037 * k, 0.14, 0.058 * k), tri(0.3, 0.037 * k, 0.14, 0.058 * k), tri(0, -0.008 * k, 0.065, 0.032 * k), mouth];
  return rim ? merge(parts.map((g) => paint(g, FIXED.pumpkinFlesh))) : merge(parts.map((g) => paint(g, FIXED.carvedDark)));
}

/** A patch of the pumpkin's skin between bottom(a) and top(a) (heights from its middle), raised by `lift`. */
function carvedPanel(top: AngleFn, bottom: AngleFn, a0: number, a1: number, segments: number, lift: number): BufferGeometry {
  const ROWS = 3;
  const at = (a: number, v: number): Vector3 => {
    const y = bottom(a) + (top(a) - bottom(a)) * v;
    const r = pumpkinSkin(a, y) + lift;
    return new Vector3(r * Math.sin(a), PUMPKIN.y + y, -r * Math.cos(a));
  };
  const pos: number[] = [];
  const out = new Vector3();
  for (let i = 0; i < segments; i++) {
    const a = a0 + ((a1 - a0) * i) / segments;
    const b = a0 + ((a1 - a0) * (i + 1)) / segments;
    for (let j = 0; j < ROWS; j++) {
      const p00 = at(a, j / ROWS);
      const p10 = at(b, j / ROWS);
      const p01 = at(a, (j + 1) / ROWS);
      const p11 = at(b, (j + 1) / ROWS);
      out.set(Math.sin((a + b) / 2), 0, -Math.cos((a + b) / 2));
      pos.push(...outward(p00, p10, p11, out), ...outward(p00, p11, p01, out));
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function buildUpperArm(jacket: Color): BufferGeometry {
  return merge([
    paint(prism(0.074, 0.066, BODY.upperArm, 9), jacket),
    paint(new IcosahedronGeometry(0.068, 1).translate(0, BODY.upperArm, 0), jacket),
  ]);
}

/** Sleeve flaring toward the wrist, then a glove with a thumb. */
function buildForearm(jacket: Color, mitten: Color): BufferGeometry {
  const f = BODY.forearm;
  return merge([
    paint(prism(0.066, 0.072, f, 9), jacket),
    paint(prism(0.074, 0.074, 0.025, 9).translate(0, f - 0.03, 0), shade(jacket, 0.78)),
    paint(prism(0.058, 0.056, 0.05, 10).translate(0, f - 0.01, 0), shade(mitten, 0.74)),
    paint(new CapsuleGeometry(0.04, 0.05, 3, 10).scale(1.05, 1, 0.82).translate(0, f + BODY.hand, 0), mitten),
    paint(new CapsuleGeometry(0.016, 0.03, 2, 6).rotateX(-0.5).translate(0, f + BODY.hand - 0.012, 0.035), mitten),
  ]);
}

/** Baggy thigh and a knee. */
function buildThigh(pants: Color): BufferGeometry {
  const t = BODY.thigh;
  return merge([
    paint(prism(0.096, 0.097, t, 12), pants),
    paint(new IcosahedronGeometry(0.099, 1).translate(0, t, 0), pants),
  ]);
}

/**
 * Wide pant leg from the knee to just past the ankle, with a darker hem.
 * The boot's upper cuff lives inside it (it follows the shin, so it never
 * pokes through the pants); only its bottom edge shows under the hem.
 */
function buildShin(pants: Color, boot: Color): BufferGeometry {
  const s = BODY.shin;
  return merge([
    paint(prism(0.1, 0.112, s + 0.02, 12), pants),
    paint(prism(0.114, 0.115, 0.022, 12).translate(0, s - 0.004, 0), shade(pants, 0.8)),
    paint(prism(0.078, 0.078, 0.2, 12).translate(0, s - 0.15, 0), boot),
  ]);
}

/** Boot (shell, sole, buckles), binding and ski, in the foot frame (origin at the ankle). */
function buildFoot(side: number, boot: Color): BufferGeometry {
  const parts = [
    paint(bootShell(), boot),
    paint(new BoxGeometry(0.118, 0.022, 0.33).translate(0, -0.104, -0.015), FIXED.bootSole),
    paint(new BoxGeometry(0.09, 0.025, 0.4).translate(0, -0.1275, 0), FIXED.binding),
    buildSki().translate(0, -BODY.ankleHeight, -BODY.ankleBack),
  ];
  // Buckles on the outside of the instep and cuff.
  for (const [y, z] of [
    [-0.035, -0.07],
    [0.0, 0.0],
    [0.06, 0.02],
  ] as const) {
    parts.push(paint(new BoxGeometry(0.012, 0.016, 0.05).translate(side * 0.068, y, z), FIXED.buckle));
  }
  return merge(parts);
}

/** Lower boot shell: a box that narrows and drops toward a rounded toe. */
function bootShell(): BufferGeometry {
  const g = new BoxGeometry(0.12, 0.095, 0.32, 3, 2, 8);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i);
    let y = p.getY(i);
    const z = p.getZ(i);
    const toe = Math.max(0, (-z - 0.03) / 0.13);
    const heel = Math.max(0, (z - 0.11) / 0.05);
    if (y > 0) y -= 0.05 * toe * toe;
    x *= 1 - 0.28 * toe * toe - 0.15 * heel * heel;
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g.translate(0, -0.046, -0.015);
}

/**
 * Twin-tip ski: a side profile extruded across the ski's width, colored per
 * face (dark topsheet, bright tips, a stripe, colored base).
 */
function buildSki(): BufferGeometry {
  const half = BODY.skiLength / 2;
  const thick = 0.022;
  const flat = 0.66;
  const tipStations = [0.69, 0.72, 0.76, 0.8, 0.83, 0.86];
  const stations = [
    -half,
    ...tipStations.map((x) => -x).reverse(),
    -flat,
    -0.25,
    -0.15,
    0.15,
    0.25,
    flat,
    ...tipStations,
    half,
  ];
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

  const top = new Color(FIXED.skiTop);
  const tip = new Color(FIXED.skiTip);
  const stripe = new Color(FIXED.skiStripe);
  const base = new Color(FIXED.skiBase);
  return paint(g, (c, n) => {
    const along = Math.abs(c.z);
    if (n.y < -0.5) return base;
    if (along > flat) return tip;
    return along > 0.15 && along < 0.25 ? stripe : top;
  });
}

/** Pole hanging down -Y from the grip at the origin. */
function buildPole(): BufferGeometry {
  return merge([
    paint(new CylinderGeometry(0.011, 0.008, 1.12, 6).translate(0, -0.56, 0), FIXED.poleShaft),
    paint(new CylinderGeometry(0.02, 0.018, 0.14, 8).translate(0, -0.02, 0), FIXED.poleDark),
    paint(new CylinderGeometry(0.045, 0.045, 0.012, 10).translate(0, -1.02, 0), FIXED.poleDark),
  ]);
}
