import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Quaternion,
  Sphere,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DEFAULT_OUTFIT, GARMENTS, type Garment, type Outfit, type Pattern } from '../core/outfit.ts';
import { skiGraphic, skiType, type Side } from '../core/skis.ts';
import { clothMaterial } from './cloth.ts';
import { buildSkiGeometry } from './skiModel.ts';
import type { PoseDef, Vec3 } from './skierPoses.ts';

// Low-poly freeskier: a roomy shell jacket down to the thighs, wide pants over
// chunky boots, a snug matte helmet, small goggles and a neck gaiter that
// close up the face, twin-tip skis and poles. Each body segment is its own
// mesh (vertex colors, flat shading, one shared material) placed every pose
// by a small solver: hips, chest and head are rigid; knees and elbows come
// from two-bone IK so hands and feet land where the pose says. The jacket's
// hem is the one part rebuilt every pose, so it rides up over the thighs.
// Colors, headwear and skis come from the Locker's outfit; changing it rebuilds
// only the parts it touches (setOutfit), never per frame.

const FIXED = {
  vent: '#0e0f12',
  /** What a mirrored lens reflects: its top half takes a little of the sky's blue. */
  lensSky: '#9fc3e6',
  zip: '#16181c',
  bootSole: '#202328',
  buckle: '#c9ced6',
  binding: '#1c1f25',
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
    const jacket = wear(outfit, 'jacket');
    const pants = wear(outfit, 'pants');

    // The seat of the pants, under the jacket's hem.
    this.pelvis = add(buildPelvis(pants));
    this.torso = add(buildTorso(jacket, outfit.headwear === 'hood'));
    this.hem = new JacketLower(jacket);
    this.root.add(this.hem.mesh);
    this.head = add(buildHead(outfit));
    this.hat = new Mesh(new BufferGeometry(), clothMaterial);
    this.face = new Mesh(new BufferGeometry(), this.glowMaterial);
    this.head.add(this.hat, this.face);
    this.setHeadwear();
    // Both sides share one geometry, apart from the feet (buckles on the
    // outside) and, with striped pants, the shins (the stripe runs down the outside).
    const forearm = buildForearm(jacket, c.mittens);
    const pole = buildPole();
    for (const side of [-1, 1] as const) {
      this.upperArms.push(add(buildUpperArm(jacket, side)));
      this.forearms.push(add(forearm));
      this.thighs.push(add(buildThigh(pants, side)));
      this.shins.push(add(new BufferGeometry()));
      this.feet.push(add(buildFoot(side, c.boots, buildSki(outfit, side))));
      this.poles.push(add(pole));
    }
    this.setShins(pants, c.boots);
    this.setPoles();
  }

  /** Whether the skier carries poles (without them, the push is a skating step: see SkierView). */
  get hasPoles(): boolean {
    return this.outfit.poles;
  }

  /** Changes colors, patterns, headwear, skis or poles, rebuilding only the parts that change (the old geometry is freed). */
  setOutfit(next: Outfit): void {
    const prev = this.outfit;
    this.outfit = { ...next };
    const changed = (...keys: (keyof Outfit)[]): boolean => keys.some((k) => prev[k] !== next[k]);
    const c = colors(next);
    const jacket = wear(next, 'jacket');
    const pants = wear(next, 'pants');
    const pantsChanged = changed('pants', 'pantsPattern', 'pantsAccent');
    const jacketChanged = changed('jacket', 'jacketPattern', 'jacketAccent');
    const hoodChanged = (prev.headwear === 'hood') !== (next.headwear === 'hood');
    if (pantsChanged) {
      swap([this.pelvis], buildPelvis(pants));
      this.thighs.forEach((m, i) => swap([m], buildThigh(pants, i === 0 ? -1 : 1)));
    }
    if (jacketChanged || hoodChanged) swap([this.torso], buildTorso(jacket, next.headwear === 'hood'));
    if (jacketChanged) {
      this.hem.recolor(jacket);
      this.upperArms.forEach((m, i) => swap([m], buildUpperArm(jacket, i === 0 ? -1 : 1)));
    }
    if (jacketChanged || changed('mittens')) swap(this.forearms, buildForearm(jacket, c.mittens));
    if (pantsChanged || changed('boots')) this.setShins(pants, c.boots);
    if (changed('boots', 'ski', 'skiGraphic')) {
      this.feet.forEach((m, i) => {
        const side = i === 0 ? -1 : 1;
        swap([m], buildFoot(side, c.boots, buildSki(next, side)));
      });
    }
    // The hood is the jacket's color.
    if (changed('helmet', 'goggleFrame', 'goggleLens', 'goggleStrap', 'gaiter', 'headwear') || (next.headwear === 'hood' && changed('jacket'))) {
      swap([this.head], buildHead(next));
      this.setHeadwear();
    }
    if (changed('poles')) this.setPoles();
  }

  /** Builds the shins: one geometry for both, or one each when the pants are striped. */
  private setShins(pants: Wear, boot: Color): void {
    const old = new Set(this.shins.map((m) => m.geometry));
    if (pants.pattern === 'stripes') this.shins.forEach((m, i) => (m.geometry = buildShin(pants, boot, i === 0 ? -1 : 1)));
    else {
      const shared = buildShin(pants, boot, 0);
      for (const m of this.shins) m.geometry = shared;
    }
    for (const g of old) g.dispose();
  }

  private setPoles(): void {
    for (const m of this.poles) m.visible = this.outfit.poles;
  }

  /** How brightly the pumpkin's carved face glows: 0 by day (a dark hollow), 1 at night. */
  setGlow(amount: number): void {
    this.glowMaterial.color.set(FIXED.carvedDark).lerp(glowColor, Math.min(1, Math.max(0, amount)));
  }

  /** The part meshes by name (index 0 left, 1 right), for checks such as tools/model/clearance.ts. */
  parts(): Record<'pelvis' | 'torso' | 'hem' | 'head', Mesh> & Record<'upperArms' | 'forearms' | 'thighs' | 'shins' | 'feet' | 'poles', readonly Mesh[]> {
    const { pelvis, torso, head, upperArms, forearms, thighs, shins, feet, poles } = this;
    return { pelvis, torso, hem: this.hem.mesh, head, upperArms, forearms, thighs, shins, feet, poles };
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

  /** Builds what sways (the Santa hat, the beanie's pom) and the carved face for the current headwear (or neither). */
  private setHeadwear(): void {
    const hw = this.outfit.headwear;
    swap([this.hat], hw === 'santa' ? buildSantaHat() : hw === 'beanie' ? buildPom(new Color(this.outfit.helmet)) : new BufferGeometry());
    swap([this.face], hw === 'pumpkin' ? buildCarvedFace(false) : new BufferGeometry());
    this.hat.visible = hw === 'santa' || hw === 'beanie';
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
function colors(o: Outfit): Record<'boots' | 'mittens', Color> {
  return { boots: new Color(o.boots), mittens: new Color(o.mittens) };
}

/** A garment's pattern and colors, for painting its parts. */
interface Wear {
  pattern: Pattern;
  base: Color;
  accent: Color;
  /** Camo's darker shade of the base; plaid's darker crossing of both colors. */
  dark: Color;
}

function wear(o: Outfit, garment: Garment): Wear {
  const g = GARMENTS.find((x) => x.id === garment)!;
  const pattern = o[g.pattern];
  const base = new Color(o[garment]);
  const accent = new Color(o[g.accent]);
  const dark = pattern === 'plaid' ? base.clone().lerp(accent, 0.5).multiplyScalar(0.55) : shade(base, 0.62);
  return { pattern, base, accent, dark };
}

/**
 * Where a part of a garment takes the second color, in the part's own frame
 * (each part decides: stripes round the chest, blocks on the shoulders...).
 * `seed` shifts camo and plaid so parts side by side don't repeat, and
 * `radius` turns the angle round the part into plaid's distance across.
 */
interface Panel {
  stripe?: (c: Vector3) => boolean;
  block?: (c: Vector3) => boolean;
  seed: number;
  radius: number;
}

/** The garment's paint for one part: a single color when plain, else per face. */
function cloth(w: Wear, panel: Panel): Color | FaceColor {
  const { stripe, block } = panel;
  switch (w.pattern) {
    case 'plain':
      return w.base;
    case 'stripes':
      return stripe ? (c) => (stripe(c) ? w.accent : w.base) : w.base;
    case 'blocks':
      return block ? (c) => (block(c) ? w.accent : w.base) : w.base;
    case 'camo':
      return (c) => camo(w, c.x, c.y, c.z, panel.seed);
    case 'plaid':
      return (c) => plaid(w, around(c) * panel.radius, c.y, panel.seed);
  }
}

/**
 * How many rows a garment part of `length` m is cut into: enough faces for
 * camo and plaid, else one. Rows are kept coarse (the skier's triangle
 * budget): plaid's bands are a row tall.
 */
function rows(w: Wear, length: number): number {
  return w.pattern === 'camo' || w.pattern === 'plaid' ? Math.max(1, Math.round(length / CAMO_ROW)) : 1;
}
/** Height (m) of a row of faces in camo or plaid. */
const CAMO_ROW = 0.095;

/** Angle round the vertical axis from straight ahead (-Z), as the helmet and goggles measure it. */
function around(c: Vector3): number {
  return Math.atan2(c.x, -c.z);
}

/** Blotches: the base, a darker shade of it, and the second color, from smooth noise. */
function camo(w: Wear, x: number, y: number, z: number, seed: number): Color {
  const k = 1 / 0.12;
  const n = 0.7 * valueNoise(x * k + seed * 7.31, y * k, z * k) + 0.3 * valueNoise(x * k * 2.3, y * k * 2.3 + seed * 3.7, z * k * 2.3);
  return n < 0.44 ? w.base : n < 0.58 ? w.dark : w.accent;
}

/** A check: bands of the second color both ways, darker where they cross. */
function plaid(w: Wear, u: number, v: number, seed: number): Color {
  const period = 2 * CAMO_ROW;
  const across = ((((u + seed * 0.031) % period) + period) % period) < period / 2;
  const down = ((((v + seed * 0.017) % period) + period) % period) < period / 2;
  return across && down ? w.dark : across || down ? w.accent : w.base;
}

/** Smooth 3D value noise, 0..1. */
function valueNoise(x: number, y: number, z: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const fx = smooth01(x - x0);
  const fy = smooth01(y - y0);
  const fz = smooth01(z - z0);
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  const plane = (zz: number): number =>
    lerp(lerp(hash3(x0, y0, zz), hash3(x0 + 1, y0, zz), fx), lerp(hash3(x0, y0 + 1, zz), hash3(x0 + 1, y0 + 1, zz), fx), fy);
  return lerp(plane(z0), plane(z0 + 1), fz);
}

function hash3(x: number, y: number, z: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
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

/**
 * A tapered prism from y = 0 (radius `r0`) to y = `length` (radius `r1`),
 * in `rows` rows of faces, its corners turned `turn` rad round from the default.
 */
function prism(r0: number, r1: number, length: number, sides: number, rows = 1, turn = 0): BufferGeometry {
  return new CylinderGeometry(r1, r0, length, sides, rows, false, turn).translate(0, length / 2, 0);
}

/** Turns a 12-sided pant leg so a face looks straight out to each side (for a side stripe). */
const SIDE_FACE = Math.PI / 2 - Math.PI / 12;

/** Whether `c` is on the face looking out to the `side` (-1 left, 1 right; +X) of the part. */
function onSide(c: Vector3, side: number): boolean {
  return Math.abs(wrapAngle(around(c) - (side * Math.PI) / 2)) < 0.2;
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

/** The seat of the pants; striped pants carry their side stripes down over the hips. */
function buildPelvis(pants: Wear): BufferGeometry {
  const turn = pants.pattern === 'stripes' ? SIDE_FACE : 0;
  const paintIt = cloth(pants, { stripe: (c) => onSide(c, -1) || onSide(c, 1), seed: 1, radius: 0.155 });
  // Mostly under the jacket, so camo and plaid don't cut it into rows.
  return paint(prism(0.145, 0.165, 0.2, 12, 1, turn).translate(0, -0.13, 0).scale(1, 1, 0.72), paintIt);
}

/**
 * Upper jacket, from the belly up: a straight shell, a touch narrower at the
 * waist, with a high collar, the hood rolled down behind the neck (unless
 * it's up: see buildHood), a zip and a chest pocket. Below the belly the
 * jacket is a JacketLower. Stripes are two bands round the chest; blocks
 * color the shoulders.
 */
function buildTorso(w: Wear, hoodUp: boolean): BufferGeometry {
  const jacket = w.base;
  const dark = shade(jacket, 0.78);
  const shell = BODY.spine - TORSO_BOTTOM;
  // Stripes and blocks need the shell cut into rows; the bands are whole rows.
  const shellRows = w.pattern === 'stripes' ? CHEST_ROWS : w.pattern === 'blocks' ? YOKE_ROWS : rows(w, shell);
  const row = (c: Vector3, n: number): number => Math.floor(((c.y - TORSO_BOTTOM) / shell) * n);
  const body = cloth(w, {
    stripe: (c) => CHEST_STRIPES.includes(row(c, CHEST_ROWS)),
    block: (c) => row(c, YOKE_ROWS) === YOKE_ROWS - 1,
    // As the lower jacket's, so camo and plaid carry on across the seam at the waist.
    seed: 4,
    radius: JACKET.waist,
  });
  const parts = [
    // As many sides as the lower jacket, corner for corner, so the two meet flush.
    paint(prism(JACKET.waist, JACKET.chest, shell, LOWER_SEGMENTS, shellRows).translate(0, TORSO_BOTTOM, 0).scale(1, 1, JACKET.depth), body),
    paint(prism(0.116, 0.106, 0.09, 12).translate(0, 0.49, 0.008).scale(1, 1, 0.95), jacket),
    paint(new BoxGeometry(0.014, 0.21, 0.012).translate(0, 0.405, -0.155), FIXED.zip),
    paint(new BoxGeometry(0.11, 0.085, 0.012).translate(-0.11, 0.38, -0.15), dark),
    // Drawcord toggles hanging from the collar.
    paint(new BoxGeometry(0.012, 0.022, 0.012).translate(-0.03, 0.47, -0.118), FIXED.zip),
    paint(new BoxGeometry(0.012, 0.022, 0.012).translate(0.03, 0.47, -0.118), FIXED.zip),
  ];
  if (!hoodUp) parts.push(paint(new SphereGeometry(0.135, 12, 8).scale(1.25, 0.6, 0.75).translate(0, 0.53, 0.135), dark));
  const shoulder = w.pattern === 'blocks' ? w.accent : cloth(w, { seed: 3, radius: 0.1 });
  for (const s of [-1, 1]) {
    parts.push(paint(new IcosahedronGeometry(0.1, 1).translate(s * BODY.shoulderWidth, BODY.spine - BODY.shoulderDrop, 0), shoulder));
  }
  return merge(parts);
}

/** The chest shell's rows for stripes, and which rows are stripes (from the waist up); blocks color the top of YOKE_ROWS. */
const CHEST_ROWS = 5;
const CHEST_STRIPES = [1, 3];
const YOKE_ROWS = 3;

/** Height (chest frame) where the rigid upper jacket ends and the rebuilt lower jacket takes over. */
const TORSO_BOTTOM = 0.3;
/** A roomy freeski shell: radius at the waist seam and the chest, and its front-to-back depth. */
const JACKET = { waist: 0.226, chest: 0.242, depth: 0.68 };

// Lower jacket: rings of points from inside the upper jacket, down past the
// waist to a straight hem that drops a little lower at the back, then
// turned under. The top rings follow the chest, the rest the hips. Angle 0
// is the front.
const LOWER_SEGMENTS = 18;
// Long, to the top of the thighs, and a little longer at the back.
const hemLow = (a: number): number => -0.245 - 0.06 * ((1 - Math.cos(a)) / 2) ** 1.5;
interface LowerRing {
  /**
   * How much of the chest's bend (relative to the hips) the ring follows:
   * 1 moves with the chest, 0 with the hips. Easing from one to the other
   * down the waist bends the jacket there, so a deep bend doesn't fold the
   * back of it in and let the hips show through.
   */
  bend: number;
  /** Kept out of the thighs. */
  push: boolean;
  /** Height, radius and front-to-back depth at angle a (see ringAt). */
  at: (a: number) => Float64Array;
}
/** Where every ring's `at` writes its answer, so fitting the jacket every pose never allocates. */
const RING_AT = new Float64Array(3);
function ringAt(y: number, r: number, depth: number): Float64Array {
  RING_AT[0] = y;
  RING_AT[1] = r;
  RING_AT[2] = depth;
  return RING_AT;
}
/** Height `f` of the way from the waist ring down to the band above the hem, where the thighs leave the jacket. */
const waist = (a: number, f: number): number => -0.01 + (hemLow(a) + 0.042) * f;
const LOWER_RINGS: readonly LowerRing[] = [
  // Tucked inside the upper jacket, then flush with its bottom edge
  // (TORSO_BOTTOM), so the seam neither shows a step nor flickers.
  { bend: 1, push: false, at: () => ringAt(0.33, JACKET.waist - 0.015, JACKET.depth - 0.04) },
  { bend: 1, push: true, at: () => ringAt(TORSO_BOTTOM - 0.004, JACKET.waist, JACKET.depth) },
  { bend: 1, push: true, at: () => ringAt(0.25, JACKET.waist, JACKET.depth) },
  { bend: 0.7, push: true, at: () => ringAt(0.12, 0.226, 0.69) },
  { bend: 0.3, push: true, at: () => ringAt(-0.01, 0.227, 0.71) },
  // Close together here, so the jacket can follow a thigh swinging out under it.
  // Flaring a little toward the hem, so it hangs loose.
  { bend: 0.1, push: true, at: (a) => ringAt(waist(a, 1 / 3), 0.232, 0.72) },
  { bend: 0, push: true, at: (a) => ringAt(waist(a, 2 / 3), 0.238, 0.73) },
  { bend: 0, push: true, at: (a) => ringAt(hemLow(a) + 0.032, 0.243, 0.74) },
  { bend: 0, push: true, at: (a) => ringAt(hemLow(a), 0.245, 0.74) },
  { bend: 0, push: true, at: (a) => ringAt(hemLow(a) + 0.008, 0.228, 0.72) },
];
/** Rings the zip runs between (it carries on up the upper jacket), and its half-width. */
const ZIP_FIRST = 1;
const ZIP_LAST = 8;
const ZIP_HALF = 0.007;
/**
 * How the lower jacket's mesh is laid out, for checks (tools/model): its faces
 * run band by band between the rings, `segments` quads a band; the last two
 * bands are the hem's edge and its turned-under lip, the rest the jacket's body.
 */
export const JACKET_LAYOUT = { segments: LOWER_SEGMENTS, bodyBands: LOWER_RINGS.length - 3, hemLow };
/** Radius (m) of the pants' thighs, for checks (tools/model). */
export const THIGH_RADIUS = 0.112;

/** Thigh radius plus a little room, for keeping the jacket outside the legs. */
const THIGH_ROOM = 0.136;
/** Furthest (m) a raised thigh lifts any point of the jacket. */
const MAX_RIDE_UP = 0.17;
/**
 * How far a thigh must swing up before it lifts the jacket rather than the
 * jacket lying over it: the sine of its angle from hanging straight down,
 * where riding up starts, and over how much more it takes over completely.
 * A riding stance's thighs (~40°) drape; a crouch's or a grab's lift.
 */
const RIDE_UP_FROM = 0.7;
const RIDE_UP_SPAN = 0.22;

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

  constructor(jacket: Wear) {
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

  /** New jacket colors or pattern: rewrites the vertex colors in place (the shape is untouched). */
  recolor(jacket: Wear): void {
    const colors: number[] = [];
    this.build(jacket, colors);
    const attr = this.mesh.geometry.getAttribute('color') as BufferAttribute;
    (attr.array as Float32Array).set(colors);
    attr.needsUpdate = true;
  }

  /**
   * The mesh's faces: fills `colors` per vertex and returns which point each
   * vertex is. Camo and plaid color each face from where it hangs at rest;
   * stripes and blocks leave the lower jacket plain.
   */
  private build(w: Wear, colors: number[]): number[] {
    const jacket = w.base;
    const band = shade(jacket, 0.78);
    const under = shade(jacket, 0.6);
    const zip = new Color(FIXED.zip);
    const body = cloth(w, { seed: 4, radius: JACKET.waist });
    const index: number[] = [];
    const quad = (a: number, b: number, c: number, d: number, color: Color): void => {
      index.push(a, b, c, a, c, d);
      for (let k = 0; k < 6; k++) colors.push(color.r, color.g, color.b);
    };
    const point = (ring: number, seg: number): number => ring * LOWER_SEGMENTS + (seg % LOWER_SEGMENTS);
    const last = LOWER_RINGS.length - 1;
    const rest = new Vector3();
    for (let ring = 0; ring < last; ring++) {
      for (let seg = 0; seg < LOWER_SEGMENTS; seg++) {
        let color = ring < last - 2 ? jacket : ring === last - 2 ? band : under;
        if (ring < last - 2 && typeof body === 'function') {
          // The middle of the face as the jacket hangs at rest.
          const a = ((seg + 0.5) / LOWER_SEGMENTS) * Math.PI * 2;
          const top = LOWER_RINGS[ring]!.at(a);
          const y0 = top[0]!;
          const r = top[1]!;
          const depth = top[2]!;
          const y1 = LOWER_RINGS[ring + 1]!.at(a)[0]!;
          color = body(rest.set(r * Math.sin(a), (y0 + y1) / 2, -r * Math.cos(a) * depth), rest);
        }
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
    for (let ring = 0; ring < LOWER_RINGS.length; ring++) lowerBend[ring]!.slerpQuaternions(IDENTITY_Q, lowerChest, LOWER_RINGS[ring]!.bend);
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
        const r = LOWER_RINGS[ring]!.at(0)[1]!;
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
    const at = def.at(a);
    const r = at[1]! * grow;
    lowerP.set(r * Math.sin(a), at[0]!, -r * Math.cos(a) * at[2]!);
    if (def.bend > 0) lowerP.applyQuaternion(lowerBend[ring]!);
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
/** Each ring's share of the chest's bend, for the pose being fitted. */
const lowerBend = LOWER_RINGS.map(() => new Quaternion());
const IDENTITY_Q = new Quaternion();
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
  const raised = smooth01((Math.sqrt(a) - RIDE_UP_FROM) / RIDE_UP_SPAN);
  if (raised > 0) {
    hemOff.addScaledVector(hemAxis, -hemOff.dot(hemAxis)); // offset across the thigh
    const b = hemOff.dot(hemUp);
    const c = hemOff.lengthSq() - room * room;
    // Fabric only rides up so far; past that it lies over the leg (below).
    const lift = Math.min(MAX_RIDE_UP, (-b + Math.sqrt(Math.max(0, b * b - a * c))) / a);
    hemRadial.lerp(hemUp.set(0, lift, 0), raised);
  }
  p.add(hemRadial);

  // Where riding up stopped short (or the blend of the two pushes fell
  // inside), drape it over the leg: straight out from the thigh's axis.
  const along = Math.min(Math.sqrt(len2), Math.max(0, hemOff.subVectors(p, hip).dot(hemAxis)));
  hemOff.subVectors(p, hemNear.copy(hip).addScaledVector(hemAxis, along));
  const left = hemOff.length();
  if (left < room && left > 1e-6) p.addScaledVector(hemOff, room / left - 1);
}

// Goggles: a compact frame, tallest in front and tapering toward the
// temples, where it draws in and slips under the helmet's edge (the strap
// comes back out round the back of the helmet). Angles are radians from
// straight ahead.
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
  const gaiter = new Color(o.gaiter);
  if (o.headwear === 'pumpkin') return merge([...buildGaiter(gaiter), ...buildPumpkin(), buildCarvedFace(true)]);
  const hat = new Color(o.helmet);
  const parts = [
    // Head under everything, in case any gap shows (and through a cap's strap gap).
    paint(new SphereGeometry(0.105, 12, 9).scale(1, 1.08, 1.1).translate(0, 0.2, 0), gaiter),
    ...buildGaiter(gaiter),
    ...buildGoggles(o.goggleFrame, new Color(o.goggleLens)),
  ];
  switch (o.headwear) {
    case 'beanie':
      parts.push(...buildBeanie(hat), buildStrap(o.goggleStrap, BEANIE.r + 0.001));
      break;
    case 'cap':
      parts.push(...buildCap(hat, gaiter), buildStrap(o.goggleStrap, CAP.r + 0.001));
      break;
    case 'bucket':
      parts.push(...buildBucket(hat), buildStrap(o.goggleStrap, BUCKET.r + 0.001));
      break;
    case 'hood':
      parts.push(...buildHelmet(hat, o.goggleStrap), ...buildHood(new Color(o.jacket)));
      break;
    default:
      parts.push(...buildHelmet(hat, o.goggleStrap));
  }
  return merge(parts);
}

/** Neck gaiter pulled up over the chin and nose, following the jaw, tucked under the goggles and helmet. */
function buildGaiter(color: Color): BufferGeometry[] {
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
  // The hemmed seam round the neck: a little lighter on a dark gaiter, a little darker on a light one.
  const seam = color.getHSL({ h: 0, s: 0, l: 0 }).l < 0.25 ? color.clone().lerp(new Color('#ffffff'), 0.08) : shade(color, 0.82);
  return [
    paint(face(new LatheGeometry(profile, 18)), color),
    paint(face(prism(0.0835, 0.0875, 0.012, 18).translate(0, 0.048, 0)), seam),
    // Nose under the fabric, just below the goggles.
    paint(new IcosahedronGeometry(0.028, 0).scale(0.7, 0.9, 0.85).translate(0, 0.166, -0.118), color),
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
  parts.push(buildStrap(strap, 0.127));
  return parts;
}

/** Goggle strap round the back of the head at radius `r` (before the head's stretch), from where the frame slips under the helmet's or hat's edge. */
function buildStrap(strap: string, r: number): BufferGeometry {
  const strapY: AngleFn = (a) => GOGGLE_Y + 0.012 * smooth01((Math.abs(wrapAngle(a)) - STRAP_FROM) / 1.2);
  return paint(
    fitHead(curvedPanel(constant(r), constant(r + 0.0065), (a) => strapY(a) + 0.014, (a) => strapY(a) - 0.014, STRAP_FROM, Math.PI * 2 - STRAP_FROM, 20)),
    strap,
  );
}

/** Angle (from straight ahead) where the strap comes out from under the helmet's edge. */
const STRAP_FROM = 1.56;

/** Stretches a round shape front to back like the head (and the helmet). */
function fitHead(g: BufferGeometry): BufferGeometry {
  return g.scale(1, 1, HELMET.long).translate(0, 0, HELMET.back);
}

/**
 * A dome over the head (radius `r`, `squash` tall, centered at the goggles'
 * height) with every vertex below `edge` lifted onto it, before fitHead.
 */
function hatDome(r: number, squash: number, edge: AngleFn, widthSegments: number, heightSegments: number): BufferGeometry {
  const dome = new SphereGeometry(r, widthSegments, heightSegments, 0, Math.PI * 2, 0, Math.PI * 0.72).scale(1, squash, 1).translate(0, GOGGLE_Y, 0);
  const p = dome.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const e = edge(Math.atan2(p.getX(i), -p.getZ(i)));
    if (p.getY(i) < e) p.setY(i, e);
  }
  return dome;
}

/** Horizontal radius of a hatDome at height `y`. */
function domeRadiusAt(r: number, squash: number, y: number): number {
  return r * Math.sqrt(Math.max(0, 1 - ((y - GOGGLE_Y) / (r * squash)) ** 2));
}

/** Knit beanie: a slouchy ribbed dome and a thick folded cuff resting on the goggles; its pom sways (buildPom). */
const BEANIE = { r: 0.124, squash: 1.12, cuff: 0.042 };

function buildBeanie(color: Color): BufferGeometry[] {
  const { r, squash, cuff } = BEANIE;
  const rib = shade(color, 0.9);
  const ribs = (n: number): FaceColor => (c) => (Math.floor(((around(c) + Math.PI) / (Math.PI * 2)) * n) % 2 === 0 ? color : rib);
  const crown = paint(fitHead(hatDome(r, squash, helmetEdge, 20, 12)), ribs(20));
  // The cuff hugs the dome from its edge up, a little proud of it, with a lip top and bottom.
  const SEGS = 40;
  const pos: number[] = [];
  const at = (a: number, y: number, out: number): Point => {
    const rr = domeRadiusAt(r, squash, y) + out;
    return [rr * Math.sin(a), y, -rr * Math.cos(a)];
  };
  for (let i = 0; i < SEGS; i++) {
    const a0 = -Math.PI + (Math.PI * 2 * i) / SEGS;
    const a1 = -Math.PI + (Math.PI * 2 * (i + 1)) / SEGS;
    const e0 = helmetEdge(a0) - 0.003;
    const e1 = helmetEdge(a1) - 0.003;
    const b0 = at(a0, e0, 0.008);
    const b1 = at(a1, e1, 0.008);
    const t0 = at(a0, e0 + cuff, 0.008);
    const t1 = at(a1, e1 + cuff, 0.008);
    const bi0 = at(a0, e0, -0.004);
    const bi1 = at(a1, e1, -0.004);
    const ti0 = at(a0, e0 + cuff, -0.004);
    const ti1 = at(a1, e1 + cuff, -0.004);
    pos.push(...b0, ...b1, ...t1, ...b0, ...t1, ...t0); // outside
    pos.push(...ti0, ...t0, ...t1, ...ti0, ...t1, ...ti1); // top lip
    pos.push(...bi0, ...bi1, ...b1, ...bi0, ...b1, ...b0); // bottom lip
  }
  const band = new BufferGeometry();
  band.setAttribute('position', new Float32BufferAttribute(pos, 3));
  band.computeVertexNormals();
  return [crown, paint(fitHead(band), ribs(SEGS))];
}

/** The beanie's pom on top: drawn with the cloth material, so it sways a little. A lighter tone on a dark beanie, darker on a light one. */
function buildPom(color: Color): BufferGeometry {
  const light = color.getHSL({ h: 0, s: 0, l: 0 }).l < 0.45;
  const pomColor = light ? color.clone().lerp(new Color('#ece8de'), 0.6) : shade(color, 0.72);
  const top = GOGGLE_Y + BEANIE.r * BEANIE.squash;
  const g = fitHead(
    merge([
      paint(prism(0.012, 0.009, 0.02, 6).translate(0, top - 0.008, 0), shade(color, 0.85)),
      paint(new IcosahedronGeometry(0.038, 1).scale(1, 0.9, 1).translate(0, top + 0.036, 0), pomColor),
    ]),
  );
  // Sway grows from the knot to the top of the pom.
  const pos = g.getAttribute('position');
  const sway = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) sway[i] = 0.06 + 0.08 * Math.min(1, Math.max(0, (pos.getY(i) - top) / 0.07));
  g.setAttribute('sway', new BufferAttribute(sway, 1));
  return g;
}

/**
 * Cap worn backwards: a shallow six-panel crown with a button on top, its
 * flat brim out over the back of the neck, and the strap gap at the front
 * (the balaclava shows through it) just above the goggles.
 */
const CAP = { r: 0.126, squash: 0.86, brim: 0.075, brimSpan: 0.95, back: 0.188 };
const capEdge: AngleFn = (a) => {
  const abs = Math.abs(a);
  const front = GOGGLE_Y + goggleHalf(Math.min(abs, LENS_SPAN)) + 0.001;
  return front + (CAP.back - front) * smooth01((abs - LENS_SPAN) / 0.45);
};

function buildCap(color: Color, gap: Color): BufferGeometry[] {
  const { r, squash } = CAP;
  const seam = shade(color, 0.9);
  const GAP = 0.32;
  const crown = paint(fitHead(hatDome(r, squash, capEdge, 24, 10)), (c) => {
    const a = around(c);
    // The strap gap: an arch over the forehead.
    if (Math.abs(a) < GAP && c.y < capEdge(a) + 0.045 * Math.cos((a / GAP) * (Math.PI / 2))) return gap;
    return Math.floor(((a + Math.PI) / (Math.PI * 2)) * 6) % 2 === 0 ? color : seam;
  });
  const top = GOGGLE_Y + r * squash;
  const button = paint(fitHead(prism(0.014, 0.012, 0.008, 8).translate(0, top - 0.003, 0)), seam);
  // The adjuster strap across the bottom of the gap.
  const strapR = (a: number): number => domeRadiusAt(r, squash, capEdge(a) + 0.006) + 0.001;
  const adjuster = paint(
    fitHead(curvedPanel((a) => strapR(a) - 0.004, strapR, (a) => capEdge(a) + 0.012, (a) => capEdge(a) + 0.002, -GAP, GAP, 6)),
    shade(color, 0.7),
  );
  // The brim: flat, rounded, drooping a little toward its edge.
  const inner = domeRadiusAt(r, squash, CAP.back) - 0.004;
  const brimOut: AngleFn = (a) => inner + CAP.brim * Math.sqrt(Math.max(0, Math.cos(((a - Math.PI) / CAP.brimSpan) * (Math.PI / 2))));
  const brim = curvedPanel(constant(inner), brimOut, constant(CAP.back + 0.004), constant(CAP.back - 0.004), Math.PI - CAP.brimSpan, Math.PI + CAP.brimSpan, 12);
  const p = brim.getAttribute('position');
  for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) - 0.15 * Math.max(0, Math.hypot(p.getX(i), p.getZ(i)) - inner));
  brim.computeVertexNormals();
  return [crown, button, adjuster, paint(fitHead(brim), shade(color, 0.86))];
}

/**
 * Bucket hat: a short round crown sitting just above the goggles in front
 * and lower round the sides and back, and a soft brim sloping down all round.
 */
const BUCKET = { r: 0.129, brim: 0.068, drop: 0.04 };
const bucketEdge: AngleFn = (a) => {
  const abs = Math.abs(a);
  const front = GOGGLE_Y + goggleHalf(Math.min(abs, LENS_SPAN)) + 0.002;
  return front + (0.199 - front) * smooth01((abs - LENS_SPAN) / 0.4);
};

function buildBucket(color: Color): BufferGeometry[] {
  const { r, brim: out, drop } = BUCKET;
  // Lathe profiles (radius, height); a height of EDGE is replaced by the hat's edge at that angle.
  const EDGE = -1;
  const crownProfile = [
    [r, EDGE],
    [r - 0.002, 0.286],
    [r - 0.011, 0.318],
    [0.085, 0.334],
    [0.001, 0.337],
  ].map(([x, y]) => new Vector2(x, y));
  const crown = new LatheGeometry(crownProfile, 20);
  const cp = crown.getAttribute('position');
  for (let i = 0; i < cp.count; i++) {
    if (cp.getY(i) === EDGE) cp.setY(i, bucketEdge(Math.atan2(cp.getX(i), -cp.getZ(i))));
  }
  // The brim's cross-section, counterclockwise (inner bottom, outer bottom, outer top, inner top), heights from the edge.
  const brimProfile = [
    [r - 0.002, -0.002],
    [r + out, -drop - 0.006],
    [r + out, -drop],
    [r - 0.002, 0.006],
    [r - 0.002, -0.002],
  ].map(([x, y]) => new Vector2(x, y));
  const brim = new LatheGeometry(brimProfile, 24);
  const bp = brim.getAttribute('position');
  for (let i = 0; i < bp.count; i++) bp.setY(i, bp.getY(i) + bucketEdge(Math.atan2(bp.getX(i), -bp.getZ(i))));
  return [paint(fitHead(crown), color), paint(fitHead(brim), shade(color, 0.88))];
}

/**
 * Hood up over the helmet: the jacket's hood, roomy round the helmet and down
 * to the collar, its opening framing the goggles and gaiter. Lined (a
 * darker inside, so looking in at the opening shows cloth, not nothing),
 * with a hemmed edge round the opening.
 */
const HOOD_PROFILE: readonly (readonly [number, number])[] = [
  [0.001, 0.372],
  [0.075, 0.362],
  [0.118, 0.333],
  [0.146, 0.285],
  [0.156, 0.225],
  [0.155, 0.16],
  [0.157, 0.1],
  [0.163, 0.04],
  [0.174, -0.012],
];
/** Height of the hood's opening at angle a: an arch over the forehead, down to the collar at the sides. */
const hoodEdge: AngleFn = (a) => -0.02 + 0.31 * Math.cos(Math.min(1, Math.abs(a) / 1.42) * (Math.PI / 2)) ** 0.35;
/** The hood's radius at height y (from HOOD_PROFILE). */
function hoodRadiusAt(y: number): number {
  for (let i = 1; i < HOOD_PROFILE.length; i++) {
    const [r0, y0] = HOOD_PROFILE[i - 1]!;
    const [r1, y1] = HOOD_PROFILE[i]!;
    if (y <= y0 && y >= y1) return r0 + ((r1 - r0) * (y0 - y)) / (y0 - y1);
  }
  return HOOD_PROFILE[HOOD_PROFILE.length - 1]![0];
}
const HOOD = { long: 1.12, back: 0.014, lining: 0.93 };

function buildHood(jacket: Color): BufferGeometry[] {
  const fit = (g: BufferGeometry): BufferGeometry => g.scale(1, 1, HOOD.long).translate(0, 0, HOOD.back);
  const shell = (segments: number): BufferGeometry => {
    const g = new LatheGeometry(
      HOOD_PROFILE.map(([r, y]) => new Vector2(r, y)),
      segments,
    );
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const e = hoodEdge(Math.atan2(p.getX(i), -p.getZ(i)));
      if (p.getY(i) < e) p.setY(i, e);
    }
    return g;
  };
  const outside = paint(fit(shell(16)), jacket);
  // The lining: the same shell drawn smaller (and coarser: it's seen only past the hem) and turned inside out.
  const lining = paint(fit(shell(10).scale(HOOD.lining, 1, HOOD.lining)), shade(jacket, 0.55));
  const lp = lining.getAttribute('position');
  for (let i = 0; i < lp.count; i += 3) {
    const x = lp.getX(i + 1);
    const y = lp.getY(i + 1);
    const z = lp.getZ(i + 1);
    lp.setXYZ(i + 1, lp.getX(i + 2), lp.getY(i + 2), lp.getZ(i + 2));
    lp.setXYZ(i + 2, x, y, z);
  }
  // The hem round the opening, from the lining out to just proud of the shell.
  const SPAN = 1.42;
  const hem = curvedPanel(
    (a) => hoodRadiusAt(hoodEdge(a)) * HOOD.lining - 0.002,
    (a) => hoodRadiusAt(hoodEdge(a)) + 0.005,
    (a) => hoodEdge(a) + 0.014,
    (a) => hoodEdge(a) - 0.002,
    -SPAN,
    SPAN,
    18,
  );
  return [outside, lining, paint(fit(hem), shade(jacket, 0.8))];
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/**
 * Goggles under the helmet's front edge: a matte frame with a notch for the
 * nose, and a tinted mirror lens set just proud of it, lighter at the top
 * where it catches the sky.
 */
function buildGoggles(frame: string, lens: Color): BufferGeometry[] {
  const lensTop = lens.clone().lerp(new Color(FIXED.lensSky), 0.12);
  const lensBottom = shade(lens, 0.92);
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
    paint(onFace(curvedPanel(lensIn, lensOut, (a) => half(a) - 0.006, constant(-0.002), -LENS_SPAN, LENS_SPAN, 22)), lensTop),
    paint(
      onFace(curvedPanel(lensIn, lensOut, constant(-0.002), (a) => -half(a) + nose(a) + 0.006, -LENS_SPAN, LENS_SPAN, 22)),
      lensBottom,
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

/**
 * Roomy sleeve, shoulder to elbow (`side` -1 left, 1 right). The left one
 * has a zipped pocket on the outside of the arm. The segment's front (-Z)
 * faces the elbow, out and back; the outside of the arm is between that and
 * -X (out and forward).
 */
function buildUpperArm(w: Wear, side: number): BufferGeometry {
  // The pocket takes the sleeve's color.
  const jacket = w.pattern === 'blocks' ? w.accent : w.base;
  const length = BODY.upperArm;
  // Stripes: two bands round the sleeve (whole rows); blocks: the whole upper sleeve.
  const armRows = w.pattern === 'stripes' ? ARM_ROWS : rows(w, length);
  const sleeve = cloth(w, {
    stripe: (c) => ARM_STRIPES.includes(Math.floor((c.y / length) * ARM_ROWS)),
    block: () => true,
    seed: 5 + side,
    radius: 0.08,
  });
  const parts = [
    paint(prism(0.082, 0.076, length, 9, armRows), sleeve),
    paint(new IcosahedronGeometry(0.077, 1).translate(0, length, 0), w.pattern === 'blocks' ? w.accent : cloth(w, { seed: 6 + side, radius: 0.077 })),
  ];
  if (side < 0) {
    const face = 2.13; // turns +X to point at the outside of the arm
    const pocket = (g: BufferGeometry, out: number, y: number): BufferGeometry =>
      g.rotateY(face).translate(Math.cos(face) * out, y, -Math.sin(face) * out);
    parts.push(
      paint(pocket(new BoxGeometry(0.02, 0.08, 0.07), 0.074, 0.11), shade(jacket, 0.88)),
      paint(pocket(new BoxGeometry(0.022, 0.006, 0.06), 0.076, 0.075), FIXED.zip),
    );
  }
  return merge(parts);
}

/** The upper sleeve's rows for stripes, and which rows are stripes (from the shoulder). */
const ARM_ROWS = 5;
const ARM_STRIPES = [1, 3];

/** Sleeve flaring toward the wrist (camo or plaid, else plain), then a glove with a thumb. */
function buildForearm(w: Wear, mitten: Color): BufferGeometry {
  const f = BODY.forearm;
  const jacket = w.base;
  return merge([
    // Camo and plaid only by the sleeve's sides here (no rows: the triangle budget).
    paint(prism(0.076, 0.084, f, 9), cloth(w, { seed: 8, radius: 0.08 })),
    paint(prism(0.087, 0.087, 0.025, 9).translate(0, f - 0.03, 0), shade(jacket, 0.78)),
    paint(prism(0.058, 0.056, 0.05, 10).translate(0, f - 0.01, 0), shade(mitten, 0.74)),
    // A big mitt with a clear thumb, and a darker band over the knuckles.
    paint(new CapsuleGeometry(0.045, 0.055, 3, 10).scale(1.05, 1, 0.84).translate(0, f + BODY.hand, 0), mitten),
    paint(prism(0.049, 0.049, 0.018, 10).scale(1.05, 1, 0.86).translate(0, f + BODY.hand + 0.006, 0), shade(mitten, 0.8)),
    paint(new CapsuleGeometry(0.019, 0.035, 2, 6).rotateX(-0.55).translate(0, f + BODY.hand - 0.012, 0.04), mitten),
  ]);
}

/**
 * Baggy thigh and a knee, with a cargo pocket on the outside of the leg
 * (`side` -1 left, 1 right). In the segment's frame +X is the skier's left,
 * so the outside is -side.
 */
function buildThigh(w: Wear, side: number): BufferGeometry {
  const t = BODY.thigh;
  const r = PANTS.thigh;
  const out = -side * (r - 0.006);
  const pants = w.base;
  const turn = w.pattern === 'stripes' ? SIDE_FACE : 0;
  // Stripes run down the outside of the leg (past the pocket); blocks color the knee down.
  const leg = cloth(w, { stripe: (c) => onSide(c, -side), seed: 9 + side, radius: r });
  const pocket = w.pattern === 'stripes' ? w.accent : pants;
  return merge([
    paint(prism(r, r + 0.002, t, 12, rows(w, t), turn), leg),
    paint(new IcosahedronGeometry(PANTS.knee, 1).translate(0, t, 0), w.pattern === 'blocks' ? w.accent : cloth(w, { seed: 11 + side, radius: PANTS.knee })),
    // The pocket and its flap above it (toward the hip), on the stripe when there is one.
    paint(new BoxGeometry(0.03, 0.13, 0.1).translate(out, t * 0.55, 0.004), shade(pocket, 0.93)),
    paint(new BoxGeometry(0.036, 0.032, 0.108).translate(out * 1.02, t * 0.55 - 0.072, 0.004), shade(pocket, 0.82)),
  ]);
}

/**
 * Wide pant leg from the knee, flaring to a hem that falls past the ankle
 * over the boot, with a loose fold bunched above it. The boot's upper cuff
 * lives inside it (it follows the shin, so it never pokes through the
 * pants); only its bottom edge shows under the hem. `side` (-1 left, 1
 * right) puts a stripe down the outside; 0 for a pair that share a geometry.
 */
function buildShin(w: Wear, boot: Color, side: number): BufferGeometry {
  const s = BODY.shin;
  const hem = PANTS.hem;
  const pants = w.pattern === 'blocks' ? w.accent : w.base;
  const turn = w.pattern === 'stripes' ? SIDE_FACE : 0;
  const leg = w.pattern === 'blocks' ? pants : cloth(w, { stripe: (c) => side !== 0 && onSide(c, -side), seed: 13, radius: PANTS.knee });
  const stripe = w.pattern === 'stripes' && side !== 0;
  const fold = (g: BufferGeometry, k: number): BufferGeometry =>
    paint(g, stripe ? (c) => shade(onSide(c, -side) ? w.accent : pants, k) : shade(pants, k));
  return merge([
    paint(prism(PANTS.knee - 0.002, hem, s + 0.04, 12, rows(w, s + 0.04), turn), leg),
    fold(prism(hem + 0.004, hem + 0.004, 0.035, 12, 1, turn).translate(0, s - 0.1, 0), 0.92),
    fold(prism(hem + 0.003, hem + 0.004, 0.024, 12, 1, turn).translate(0, s + 0.02, 0), 0.8),
    paint(prism(0.078, 0.078, 0.2, 12).translate(0, s - 0.15, 0), boot),
  ]);
}

/** Baggy park pants: thigh and knee radius, and the flared hem's. */
const PANTS = { thigh: THIGH_RADIUS, knee: 0.116, hem: 0.132 };

/** Boot (shell, sole, buckles), binding and `ski` (from buildSki), in the foot frame (origin at the ankle). */
function buildFoot(side: number, boot: Color, ski: BufferGeometry): BufferGeometry {
  const parts = [
    paint(bootShell(), boot),
    paint(new BoxGeometry(0.118, 0.022, 0.33).translate(0, -0.104, -0.015), FIXED.bootSole),
    paint(new BoxGeometry(0.09, 0.025, 0.4).translate(0, -0.1275, 0), FIXED.binding),
    // Binding toe and heel pieces hugging the sole.
    paint(new BoxGeometry(0.075, 0.04, 0.06).translate(0, -0.1, -0.205), FIXED.binding),
    paint(new BoxGeometry(0.08, 0.05, 0.07).translate(0, -0.095, 0.18), FIXED.binding),
    paint(new BoxGeometry(0.05, 0.012, 0.03).translate(0, -0.074, 0.19), FIXED.buckle),
    ski,
  ];
  // Buckles on the outside of the instep and cuff.
  for (const [y, z] of [
    [-0.035, -0.07],
    [0.0, 0.0],
    [0.06, 0.02],
  ] as const) {
    parts.push(paint(new BoxGeometry(0.014, 0.02, 0.056).translate(side * 0.069, y, z), FIXED.buckle));
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

/** The outfit's ski for the left (-1) or right (1) foot, in the foot frame (see render/skiModel.ts). */
function buildSki(o: Outfit, side: Side): BufferGeometry {
  return buildSkiGeometry(skiType(o.ski).model, skiGraphic(o.ski, o.skiGraphic), side).translate(0, -BODY.ankleHeight, -BODY.ankleBack);
}

/** Pole hanging down -Y from the grip at the origin. */
function buildPole(): BufferGeometry {
  return merge([
    paint(new CylinderGeometry(0.011, 0.008, 1.12, 6).translate(0, -0.56, 0), FIXED.poleShaft),
    paint(new CylinderGeometry(0.02, 0.018, 0.14, 8).translate(0, -0.02, 0), FIXED.poleDark),
    paint(new CylinderGeometry(0.045, 0.045, 0.012, 10).translate(0, -1.02, 0), FIXED.poleDark),
  ]);
}
