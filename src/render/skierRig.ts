import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  Euler,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Quaternion,
  Shape,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PoseDef, Vec3 } from './skierPoses.ts';

// Low-poly freeskier: long baggy jacket, wide pants over chunky boots, a
// helmet with goggles, a neck gaiter pulled over the face, twin-tip skis and
// poles. Each body segment is its own mesh (vertex colors, flat shading, one
// shared material) placed every pose by a small solver: hips, chest and head
// are rigid; knees and elbows come from two-bone IK so hands and feet land
// where the pose says.

export interface Outfit {
  jacket: string;
  pants: string;
  helmet: string;
}

export const DEFAULT_OUTFIT: Outfit = { jacket: '#30343c', pants: '#677a52', helmet: '#e2445f' };

const FIXED = {
  skin: '#d9a07c',
  gaiter: '#3e66b0',
  gaiterSeam: '#2f5293',
  trim: '#1c1f25',
  goggleFrame: '#f1f3f5',
  lensTop: '#ffb43c',
  lensBottom: '#e8467f',
  strap: '#22252b',
  glove: '#3a3f47',
  gloveCuff: '#2a2e35',
  zip: '#16181c',
  boot: '#4d525b',
  bootSole: '#202328',
  buckle: '#c9ced6',
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

  /** Middle of the head and midpoint between the ankles, in skier space, after the last pose. */
  readonly headCenter = new Vector3();
  readonly feetCenter = new Vector3();
  /** Largest distance (m) a hand or foot fell short of its target in the last pose. */
  reachError = 0;
  /** Largest amount (degrees) a foot was bent past what a boot allows in the last pose. */
  ankleError = 0;

  constructor(outfit: Outfit = DEFAULT_OUTFIT) {
    const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const add = (geometry: BufferGeometry): Mesh => {
      const mesh = new Mesh(geometry, material);
      this.root.add(mesh);
      return mesh;
    };
    const jacket = new Color(outfit.jacket);
    const pants = new Color(outfit.pants);
    const helmet = new Color(outfit.helmet);

    // The long jacket covers the hips, so the pelvis wears the jacket color.
    this.pelvis = add(buildPelvis(jacket));
    this.torso = add(buildTorso(jacket));
    this.skirt = add(buildSkirt(jacket));
    this.head = add(buildHead(helmet));
    for (const side of [-1, 1]) {
      this.upperArms.push(add(buildUpperArm(jacket)));
      this.forearms.push(add(buildForearm(jacket)));
      this.thighs.push(add(buildThigh(pants, side)));
      this.shins.push(add(buildShin(pants)));
      this.feet.push(add(buildFoot(side)));
      this.poles.push(add(buildPole()));
    }
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

function buildPelvis(jacket: Color): BufferGeometry {
  return paint(prism(0.15, 0.17, 0.2, 12).translate(0, -0.13, 0).scale(1, 1, 0.72), jacket);
}

function buildTorso(jacket: Color): BufferGeometry {
  const dark = shade(jacket, 0.78);
  const parts = [
    paint(prism(0.205, 0.222, 0.5, 12).translate(0, 0.02, 0).scale(1, 1, 0.66), jacket),
    // High collar and the hood bunched behind the neck.
    paint(prism(0.112, 0.102, 0.09, 12).translate(0, 0.49, 0.008).scale(1, 1, 0.95), jacket),
    paint(new SphereGeometry(0.13, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.25, 0.6, 0.85).translate(0, 0.5, 0.115), dark),
    // Zip and a chest pocket.
    paint(new BoxGeometry(0.014, 0.46, 0.012).translate(0, 0.27, -0.146), FIXED.zip),
    paint(new BoxGeometry(0.11, 0.085, 0.012).translate(-0.1, 0.38, -0.141), dark),
  ];
  for (const s of [-1, 1]) {
    parts.push(paint(new IcosahedronGeometry(0.09, 1).translate(s * BODY.shoulderWidth, BODY.spine - BODY.shoulderDrop, 0), jacket));
  }
  return merge(parts);
}

/** The long jacket below the waist, built along +Y from the waist down to mid-thigh. */
function buildSkirt(jacket: Color): BufferGeometry {
  return merge([
    paint(prism(0.207, 0.262, 0.36, 12).scale(1, 1, 0.68), jacket),
    paint(prism(0.264, 0.266, 0.03, 12).translate(0, 0.335, 0).scale(1, 1, 0.68), shade(jacket, 0.78)),
  ]);
}

// Goggles: how far they wrap around (radians from straight ahead) and their
// half-height, tallest in front and tapering toward the temples.
const GOGGLE_SPAN = 1.75;
const goggleHalf: AngleFn = (a) => 0.034 + 0.02 * Math.max(0, Math.cos((a * Math.PI) / (2 * GOGGLE_SPAN))) ** 0.8;

// Helmet shell: a squashed, elongated dome. Across the front its edge rests
// on top of the goggle frame; past the lens it drops to cover the ears.
const HELMET = { r: 0.148, y: 0.212, squash: 0.96, long: 1.12, back: 0.008 };
const LENS_SPAN = 1.45;
const helmetEdge: AngleFn = (a) => {
  const t = Math.min(1, Math.max(0, (Math.abs(a) - LENS_SPAN) / 0.5));
  const front = GOGGLE_Y + goggleHalf(Math.min(Math.abs(a), LENS_SPAN)) + 0.002;
  return front + (0.152 - front) * t * t * (3 - 2 * t);
};
/** Horizontal radius of the (unstretched) helmet dome at height `y`. */
const helmetRadiusAt = (y: number): number =>
  HELMET.r * Math.sqrt(Math.max(0, 1 - ((y - HELMET.y) / (HELMET.r * HELMET.squash)) ** 2));

/** Head, built up from the base of the neck: gaiter, goggles, helmet. */
function buildHead(helmet: Color): BufferGeometry {
  const parts = [
    // Head under everything, in case any gap shows.
    paint(new SphereGeometry(0.105, 16, 12).scale(1, 1.08, 1.1).translate(0, 0.2, 0), FIXED.skin),
    ...buildGaiter(),
    ...buildHelmet(helmet),
    ...buildGoggles(),
  ];
  return merge(parts);
}

/** Neck gaiter pulled up over the chin and nose, following the jaw, with a patterned band. */
function buildGaiter(): BufferGeometry[] {
  const profile = [
    [0.074, -0.02],
    [0.078, 0.02],
    [0.086, 0.06],
    [0.098, 0.1],
    [0.103, 0.135],
    [0.102, 0.165],
    [0.096, 0.19],
  ].map(([r, y]) => new Vector2(r, y));
  const face = (g: BufferGeometry): BufferGeometry => g.scale(1, 1, 1.13).translate(0, 0, -0.006);
  return [
    paint(face(new LatheGeometry(profile, 18)), FIXED.gaiter),
    paint(face(prism(0.0835, 0.0875, 0.014, 18).translate(0, 0.048, 0)), FIXED.gaiterSeam),
    paint(face(prism(0.1, 0.1015, 0.01, 18).translate(0, 0.114, 0)), FIXED.gaiterSeam),
    // Nose under the fabric, just below the goggles.
    paint(new IcosahedronGeometry(0.03, 0).scale(0.7, 0.9, 0.85).translate(0, 0.168, -0.12), FIXED.gaiter),
  ];
}

function buildHelmet(helmet: Color): BufferGeometry[] {
  const fit = (g: BufferGeometry): BufferGeometry => g.scale(1, 1, HELMET.long).translate(0, 0, HELMET.back);

  // Dome, with every vertex below the edge line lifted onto it.
  const shell = new SphereGeometry(HELMET.r, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.62)
    .scale(1, HELMET.squash, 1)
    .translate(0, HELMET.y, 0);
  const p = shell.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const edge = helmetEdge(Math.atan2(p.getX(i), -p.getZ(i)));
    if (p.getY(i) < edge) p.setY(i, edge);
  }

  const parts = [paint(fit(shell), helmet)];
  // Dark trim along the edge.
  const trimR: AngleFn = (a) => helmetRadiusAt(helmetEdge(a)) + 0.004;
  parts.push(
    paint(
      fit(curvedPanel((a) => trimR(a) - 0.012, trimR, (a) => helmetEdge(a) + 0.007, (a) => helmetEdge(a) - 0.005, -Math.PI, Math.PI, 36)),
      FIXED.trim,
    ),
  );
  // Ear pads, below the goggle strap.
  const padY = 0.15;
  for (const s of [-1, 1]) {
    parts.push(
      paint(fit(new CylinderGeometry(0.04, 0.04, 0.018, 14).rotateZ(Math.PI / 2).translate(s * (helmetRadiusAt(padY) + 0.006), padY, 0.015)), shade(helmet, 0.75)),
    );
  }
  // Vent slots set into the top, tilted to follow the dome.
  for (const x of [-0.045, 0, 0.045]) {
    const y = HELMET.y + HELMET.squash * Math.sqrt(HELMET.r ** 2 - x ** 2) - 0.003;
    parts.push(paint(fit(new BoxGeometry(0.016, 0.01, 0.05).rotateZ(-Math.asin(x / HELMET.r)).translate(x, y, 0)), FIXED.trim));
  }
  return parts;
}

/**
 * Goggles sitting on the face, tucked under the helmet's front edge: a frame
 * that's tallest in front and tapers to the temples with a notch for the
 * nose, a two-tone mirrored lens standing slightly proud of it, and a strap
 * around the outside of the helmet.
 */
function buildGoggles(): BufferGeometry[] {
  const half = goggleHalf;
  const nose: AngleFn = (a) => 0.02 * Math.max(0, 1 - Math.abs(a) / 0.3) ** 2;
  const onFace = (g: BufferGeometry): BufferGeometry => g.scale(1, 1, 1.15).translate(0, GOGGLE_Y, 0);
  const span = GOGGLE_SPAN;
  const lens = LENS_SPAN;
  return [
    paint(onFace(curvedPanel(constant(0.116), constant(0.134), half, (a) => -half(a) + nose(a), -span, span, 24)), FIXED.goggleFrame),
    paint(onFace(curvedPanel(constant(0.131), constant(0.139), (a) => half(a) - 0.008, constant(0), -lens, lens, 22)), FIXED.lensTop),
    paint(
      onFace(curvedPanel(constant(0.131), constant(0.139), constant(0), (a) => -half(a) + nose(a) + 0.008, -lens, lens, 22)),
      FIXED.lensBottom,
    ),
    // Strap runs round the outside of the helmet from where the goggle ends tuck under it.
    paint(
      curvedPanel(constant(0.151), constant(0.159), constant(0.018), constant(-0.018), 1.8, Math.PI * 2 - 1.8, 16)
        .scale(1, 1, HELMET.long)
        .translate(0, GOGGLE_Y + 0.004, HELMET.back),
      FIXED.strap,
    ),
  ];
}

function buildUpperArm(jacket: Color): BufferGeometry {
  return merge([
    paint(prism(0.074, 0.066, BODY.upperArm, 9), jacket),
    paint(new IcosahedronGeometry(0.068, 1).translate(0, BODY.upperArm, 0), jacket),
  ]);
}

/** Sleeve flaring toward the wrist, then a glove with a thumb. */
function buildForearm(jacket: Color): BufferGeometry {
  const f = BODY.forearm;
  return merge([
    paint(prism(0.066, 0.072, f, 9), jacket),
    paint(prism(0.074, 0.074, 0.025, 9).translate(0, f - 0.03, 0), shade(jacket, 0.78)),
    paint(prism(0.058, 0.056, 0.05, 10).translate(0, f - 0.01, 0), FIXED.gloveCuff),
    paint(new CapsuleGeometry(0.04, 0.05, 3, 10).scale(1.05, 1, 0.82).translate(0, f + BODY.hand, 0), FIXED.glove),
    paint(new CapsuleGeometry(0.016, 0.03, 2, 6).rotateX(-0.5).translate(0, f + BODY.hand - 0.012, 0.035), FIXED.glove),
  ]);
}

/** Baggy thigh with a cargo pocket on the outside (`side` -1 left, 1 right) and a knee. */
function buildThigh(pants: Color, side: number): BufferGeometry {
  const t = BODY.thigh;
  // In the segment frame +X points to the skier's left when standing, so the
  // outside of the left leg is +X.
  return merge([
    paint(prism(0.118, 0.104, t, 12), pants),
    paint(new IcosahedronGeometry(0.106, 1).translate(0, t, 0), pants),
    paint(new BoxGeometry(0.03, 0.13, 0.12).translate(-side * 0.11, t * 0.45, 0), shade(pants, 0.85)),
  ]);
}

/**
 * Wide pant leg from the knee to just past the ankle, with a darker hem.
 * The boot's upper cuff lives inside it (it follows the shin, so it never
 * pokes through the pants); only its bottom edge shows under the hem.
 */
function buildShin(pants: Color): BufferGeometry {
  const s = BODY.shin;
  return merge([
    paint(prism(0.1, 0.112, s + 0.02, 12), pants),
    paint(prism(0.114, 0.115, 0.022, 12).translate(0, s - 0.004, 0), shade(pants, 0.8)),
    paint(prism(0.078, 0.078, 0.2, 12).translate(0, s - 0.15, 0), FIXED.boot),
  ]);
}

/** Boot (shell, sole, buckles), binding and ski, in the foot frame (origin at the ankle). */
function buildFoot(side: number): BufferGeometry {
  const parts = [
    paint(bootShell(), FIXED.boot),
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
