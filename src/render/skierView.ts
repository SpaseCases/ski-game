import {
  BufferAttribute,
  CircleGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
  type Scene,
} from 'three';
import { CONFIG } from '../config.ts';
import type { Heightfield } from '../maps/types.ts';
import { wrapAngle, type SkierState } from '../sim/skier.ts';
import { groundAt } from '../sim/terrain.ts';
import { TUNING } from '../sim/tuning.ts';
import { addPoseDelta, createPoseBuffer, setPose, type PoseBuffer } from './poseBlend.ts';
import { CROUCH, GRABS, STANCE, STANCE_HALF_WIDTH, TUCK, TUMBLE, TUMBLE_CENTER } from './skierPoses.ts';
import { DEFAULT_OUTFIT, type Outfit } from '../core/outfit.ts';
import { SkierRig } from './skierRig.ts';
import { drawnHeightAt } from './terrainMesh.ts';

/** Skier state blended between the last two simulation steps, for drawing. */
export interface SkierPose {
  position: Vector3;
  velocity: Vector3;
  normal: Vector3;
  yaw: number;
  lean: number;
  crouch: number;
  brake: number;
  brakeSide: number;
  polePhase: number;
  grounded: boolean;
  /** Body orientation from the sim (used in the air and in a crash). */
  orient: Quaternion;
  /** Center of mass, or the middle of the tumbling body in a crash. */
  center: Vector3;
  /** Rotation speed in the air (rad/s). */
  spinRate: number;
  grab: number;
  landTime: number;
  landDepth: number;
  bailed: boolean;
  bailTime: number;
  /** Sliding a rail or box. */
  onRail: boolean;
}

export function createSkierPose(): SkierPose {
  return {
    position: new Vector3(),
    velocity: new Vector3(),
    normal: new Vector3(0, 1, 0),
    yaw: 0,
    lean: 0,
    crouch: 0,
    brake: 0,
    brakeSide: -1,
    polePhase: 1,
    grounded: true,
    orient: new Quaternion(),
    center: new Vector3(),
    spinRate: 0,
    grab: -1,
    landTime: Infinity,
    landDepth: 0,
    bailed: false,
    bailTime: 0,
    onRail: false,
  };
}

export function interpolateSkier(out: SkierPose, prev: SkierState, curr: SkierState, alpha: number): void {
  out.position.lerpVectors(prev.position, curr.position, alpha);
  out.velocity.lerpVectors(prev.velocity, curr.velocity, alpha);
  out.normal.lerpVectors(prev.normal, curr.normal, alpha).normalize();
  out.yaw = prev.yaw + wrapAngle(curr.yaw - prev.yaw) * alpha;
  out.lean = prev.lean + (curr.lean - prev.lean) * alpha;
  out.crouch = prev.crouch + (curr.crouch - prev.crouch) * alpha;
  out.brake = prev.brake + (curr.brake - prev.brake) * alpha;
  out.brakeSide = curr.brakeSide;
  out.polePhase = curr.polePhase;
  out.grounded = curr.grounded;
  out.orient.slerpQuaternions(prev.orient, curr.orient, alpha);
  out.center.lerpVectors(prev.center, curr.center, alpha);
  out.spinRate = curr.grounded ? 0 : curr.spin.length();
  out.grab = curr.grab;
  out.landTime = curr.landTime;
  out.landDepth = curr.landDepth;
  out.bailed = curr.bailed;
  out.bailTime = curr.bailTime;
  out.onRail = curr.rail >= 0;
}

const UP = new Vector3(0, 1, 0);
const IDENTITY = new Quaternion();
const SHADOW_OPACITY = 0.45;

// Pole directions (from the hand) at the plant and at the end of the push,
// for the left hand; the right hand mirrors X.
const POLE_PLANTED: readonly [number, number, number] = [-0.1, -0.94, 0.32];
const POLE_PUSHED: readonly [number, number, number] = [-0.2, -0.42, 0.88];

/**
 * Draws the skier and its blob shadow from interpolated sim state.
 *   root (on the snow, tilted to the slope, turned to the ski heading)
 *   └ swing (hockey-stop yaw) └ lean (roll into the turn) └ rig
 */
export class SkierView {
  /** The posed model; its root sits inside this view's groups. */
  readonly rig: SkierRig;
  private readonly root = new Group();
  private readonly swing = new Group();
  private readonly lean = new Group();
  private readonly pose: PoseBuffer = createPoseBuffer();
  private readonly shadow: Mesh;
  private readonly shadowMaterial: MeshBasicMaterial;
  private readonly tilt = new Quaternion();
  private readonly turn = new Quaternion();
  private readonly target = new Quaternion();
  /**
   * Leftover rotation from the moment the body switched between riding, flying
   * and crashing; it eases out so the switch never pops.
   */
  private readonly offset = new Quaternion();
  private mode: 0 | 1 | 2 = 0;
  private readonly groundNormal = new Vector3();
  /** Blend weights, eased over time: air pose, each grab, the crash tumble. */
  private airWeight = 0;
  private readonly grabWeights = new Float32Array(GRABS.length);
  private bailWeight = 0;
  private railWeight = 0;
  /** 1 while a pole push is under way: a tucked skier comes up into the crouch to push. */
  private poleWeight = 0;
  /** The snow the skier is on; swapped when another map loads. */
  hf: Heightfield;

  constructor(scene: Scene, hf: Heightfield, outfit: Outfit = DEFAULT_OUTFIT) {
    this.hf = hf;
    this.rig = new SkierRig(outfit);
    this.root.add(this.swing);
    this.swing.add(this.lean);
    this.lean.add(this.rig.root);
    scene.add(this.root);

    // Blob shadow: a dark disc on the snow instead of real shadow maps. Vertex
    // alpha fades it from the center (vertex 0) to clear at the rim.
    const disc = new CircleGeometry(0.6, 16);
    disc.rotateX(-Math.PI / 2);
    const count = disc.getAttribute('position').count;
    const rgba = new Float32Array(count * 4).fill(1);
    for (let i = 1; i < count; i++) rgba[i * 4 + 3] = 0;
    disc.setAttribute('color', new BufferAttribute(rgba, 4));
    this.shadowMaterial = new MeshBasicMaterial({
      color: 0x0b1a2a,
      vertexColors: true,
      transparent: true,
      opacity: SHADOW_OPACITY,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.shadow = new Mesh(disc, this.shadowMaterial);
    this.shadow.renderOrder = 1;
    scene.add(this.shadow);
  }

  /** Drops all smoothing and blending and shows the pose as it is (start and respawn). */
  snap(pose: SkierPose): void {
    this.offset.identity();
    this.mode = pose.bailed ? 2 : pose.grounded ? 0 : 1;
    this.airWeight = pose.grounded ? 0 : 1;
    this.grabWeights.fill(0);
    this.bailWeight = pose.bailed ? 1 : 0;
    this.railWeight = pose.onRail ? 1 : 0;
    this.poleWeight = pose.polePhase < 1 && !pose.bailed ? 1 : 0;
  }

  update(state: SkierPose, frameTime: number): void {
    const r = CONFIG.render;
    const ease = 1 - Math.exp(-r.tiltSmoothing * frameTime);

    // Orientation: on the snow, tilted to the slope (the sim's normal is
    // already smooth, so the skis follow it with no lag) and turned to the
    // heading; in the air and in a crash, straight from the sim.
    const mode = state.bailed ? 2 : state.grounded ? 0 : 1;
    if (mode === 0) {
      this.tilt.setFromUnitVectors(UP, state.normal);
      this.turn.setFromAxisAngle(UP, state.yaw);
      this.target.multiplyQuaternions(this.tilt, this.turn);
    } else {
      this.target.copy(state.orient);
    }
    if (mode !== this.mode) {
      // offset = target⁻¹ × what was on screen, so nothing jumps.
      this.offset.copy(this.target).invert().multiply(this.root.quaternion);
      this.mode = mode;
    }
    this.offset.slerp(IDENTITY, ease);
    this.root.quaternion.multiplyQuaternions(this.target, this.offset);

    // Blend weights.
    this.airWeight = approach(this.airWeight, state.grounded ? 0 : 1, frameTime / r.grabBlendTime);
    this.bailWeight = approach(this.bailWeight, state.bailed ? 1 : 0, frameTime / r.bailBlendTime);
    this.railWeight = approach(this.railWeight, state.onRail ? 1 : 0, frameTime / r.railBlendTime);
    this.poleWeight = approach(this.poleWeight, state.polePhase < 1 && !state.bailed ? 1 : 0, frameTime / r.poleTuckBlendTime);
    let grabTotal = 0;
    for (let i = 0; i < GRABS.length; i++) {
      const w = approach(this.grabWeights[i] ?? 0, state.grab === i ? 1 : 0, frameTime / r.grabBlendTime);
      this.grabWeights[i] = w;
      grabTotal += w;
    }
    const live = 1 - this.bailWeight;
    // Switching grabs briefly overlaps two; keep the total at most 1.
    const grabScale = grabTotal > 1 ? live / grabTotal : live;
    const free = live - Math.min(grabTotal, 1) * live;

    // A crash tumbles around the middle of the balled-up body, not the feet.
    const bw = this.bailWeight;
    this.root.position.lerpVectors(state.position, state.center, bw);
    this.rig.root.position.set(-TUMBLE_CENTER[0] * bw, -TUMBLE_CENTER[1] * bw, -TUMBLE_CENTER[2] * bw);

    // Body on the snow: stance, sinking into a crouch while ↑ is held, which
    // becomes a speed tuck when going fast. Braking sinks a little, and a
    // landing absorbs into a quick crouch. On a rail the knees stay soft. In
    // the air: knees up a little, tucking tighter the faster it rotates. A
    // pole push comes up out of the tuck into the crouch, the stroke's own
    // starting point, so the hands swing past the body rather than through it.
    const speed = Math.hypot(state.velocity.x, state.velocity.z);
    const tuck = smoothstep(r.tuckSpeedMin, r.tuckSpeedFull, speed) * (1 - this.poleWeight);
    const squash = state.landDepth * landCurve(state.landTime);
    const groundCrouch =
      state.crouch * (1 - tuck) +
      state.brake * r.brakeSink * (1 - state.crouch) +
      squash * (1 - state.crouch) +
      this.railWeight * r.railCrouch * (1 - state.crouch);

    // Hockey stop: the skis swing sideways and the skier leans away from the
    // skid. Only part of a lean tilts the whole body; the rest comes from the
    // knees and hips (see angulate). Folded up in a crouch or tuck the legs
    // have no room for that, so more of the lean tilts the whole body.
    const swing = state.brake * r.brakeTwist * state.brakeSide * live;
    const leanTotal = (state.lean + state.brake * r.brakeLean * state.brakeSide) * live;
    const onSnow = (1 - this.airWeight) * live;
    const deep = Math.min(1, groundCrouch + state.crouch * tuck);
    const legShare = (1 - r.leanBodyShare) * (1 - (1 - r.crouchAngulation) * deep);
    const bodyLean = leanTotal * (1 - legShare * onSnow);
    this.swing.rotation.y = swing;
    this.lean.rotation.z = bodyLean;

    const airCrouch = r.airCrouch + r.spinTuck * Math.min(1, state.spinRate / TUNING.air.flipRate);
    const air = this.airWeight;
    const p = this.pose;
    setPose(p, STANCE);
    addPoseDelta(p, STANCE, CROUCH, free * (groundCrouch * (1 - air) + airCrouch * air));
    addPoseDelta(p, STANCE, TUCK, free * state.crouch * tuck * (1 - air));
    for (let i = 0; i < GRABS.length; i++) {
      const w = (this.grabWeights[i] ?? 0) * grabScale;
      if (w > 0) addPoseDelta(p, STANCE, GRABS[i]!, w);
    }
    addPoseDelta(p, STANCE, TUMBLE, bw);
    if (!state.bailed) poleStroke(p, state.polePhase);
    // The upper body turns back against the hockey-stop swing to keep facing
    // down the hill, and a little against each turn.
    const counter = -swing * r.brakeCounter - leanTotal * r.turnCounter * onSnow * (1 - deep);
    angulate(p, bodyLean, leanTotal - bodyLean, counter, onSnow, deep);
    this.rig.apply(p);
    // On a rail the skis rest on the rail, not the snow.
    this.sitOnDrawnSnow(onSnow * (1 - this.railWeight));

    // Shadow sits on the drawn snow under the body and fades as it rises.
    const pos = state.center;
    const ground = groundAt(this.hf, pos.x, pos.z, this.groundNormal);
    const height = Math.max(0, pos.y - ground - (state.bailed ? CONFIG.bail.centerHeight : CONFIG.air.comHeight));
    const drawn = drawnHeightAt(this.hf, pos.x, pos.z);
    this.shadow.position.set(pos.x, drawn, pos.z).addScaledVector(this.groundNormal, 0.06);
    this.shadow.quaternion.setFromUnitVectors(UP, this.groundNormal);
    const fade = Math.max(0.15, 1 - height / 6);
    this.shadow.scale.setScalar(0.75 + 0.25 * fade);
    this.shadowMaterial.opacity = SHADOW_OPACITY * fade;
  }

  /**
   * The sim rides a smooth surface, but the snow is drawn as flat facets
   * with some jitter, a few centimeters off (more on the side banks). On the
   * snow, move the skier up or down so the skis rest on the drawn facets:
   * the lowest point of each ski touches, none sinks in.
   */
  private sitOnDrawnSnow(weight: number): void {
    if (weight <= 0) return;
    this.root.updateMatrix();
    let lift = -Infinity;
    for (let i = 0; i < SKI_POINTS.length; i++) {
      const pt = SKI_POINTS[i]!;
      skiPoint.set(pt[0], 0, pt[1]).applyQuaternion(this.swing.quaternion).applyMatrix4(this.root.matrix);
      lift = Math.max(lift, drawnHeightAt(this.hf, skiPoint.x, skiPoint.z) - skiPoint.y);
    }
    this.root.position.y += lift * weight;
  }
}

/** Points along the bottom of each ski (skier space x, z): tail, middle and tip where they touch the snow. */
const SKI_POINTS: readonly (readonly [number, number])[] = [
  [-STANCE_HALF_WIDTH, 0.7],
  [-STANCE_HALF_WIDTH, 0],
  [-STANCE_HALF_WIDTH, -0.7],
  [STANCE_HALF_WIDTH, 0.7],
  [STANCE_HALF_WIDTH, 0],
  [STANCE_HALF_WIDTH, -0.7],
];
const skiPoint = new Vector3();

/**
 * Turns from the knees and hips. The rig sits in the lean group, already
 * tilted by bodyLean; legLean is the rest of the turn's lean. Here:
 * - the feet stay on the snow even though the group is tilted,
 * - the skis roll onto their edges by the full lean,
 * - the hips move into the turn and sink, the knees point into it,
 * - the upper body turns by `counter` to face down the hill,
 * and the hands travel with the upper body. `deep` (0..1) is how far into a
 * crouch or tuck the skier is, which keeps the hips from sinking further. `weight` fades it all out in
 * the air and in a crash.
 */
function angulate(p: PoseBuffer, bodyLean: number, legLean: number, counter: number, weight: number, deep: number): void {
  const r = CONFIG.render;
  if (weight > 0) {
    const tilt = Math.tan(bodyLean);
    for (let i = 0; i < 2; i++) {
      const f = p.feet[i === 0 ? 0 : 1];
      // Keep the ski on the snow plane outside the tilted group.
      f.ankle[1] -= f.ankle[0] * tilt * weight;
      f.roll += legLean * weight;
      f.knee[0] -= legLean * r.kneeDrive * weight;
    }
    // Inside of a left turn (lean > 0) is the skier's left, -X.
    const shiftX = -legLean * r.hipShift * weight;
    // Folded into a crouch or tuck the hips are already low: they don't sink
    // further, and the outside leg reaches down to the snow instead.
    const drop = (Math.abs(STANCE_HALF_WIDTH * tilt) + Math.abs(bodyLean + legLean) * r.turnSink) * (1 - deep) * weight;
    p.pelvis[0] += shiftX;
    p.pelvis[1] -= drop;
    for (let i = 0; i < 2; i++) {
      const h = p.hands[i === 0 ? 0 : 1];
      if (h.grab !== undefined && h.weight > 0) continue;
      h.at[0] += shiftX;
      h.at[1] -= drop;
    }
  }
  if (counter === 0) return;
  // Turn the upper body, and the hands with it, about the hips.
  p.pelvisYaw += counter * 0.4;
  p.chestYaw += counter * 0.6;
  const c = Math.cos(counter);
  const s = Math.sin(counter);
  for (let i = 0; i < 2; i++) {
    const h = p.hands[i === 0 ? 0 : 1];
    turnY(h.at, c, s, p.pelvis[0], p.pelvis[2]);
    turnY(h.pole, c, s, 0, 0);
    turnY(h.elbow, c, s, 0, 0);
  }
}

/** Rotates a point or direction about the vertical axis through (cx, cz). */
function turnY(v: [number, number, number], c: number, s: number, cx: number, cz: number): void {
  const x = v[0] - cx;
  const z = v[2] - cz;
  v[0] = cx + x * c + z * s;
  v[2] = cz - x * s + z * c;
}

/**
 * Pole push, keyed to the sim's push timing: the hands reach forward and
 * plant the poles by the boots, drive back past the hips while the push
 * force acts, then swing back to the riding position.
 */
function poleStroke(p: PoseBuffer, phase: number): void {
  if (phase >= 1) return;
  const s = TUNING.skier;
  const plant = s.polePlantTime / s.polePushInterval;
  const done = Math.min(0.95, (s.polePlantTime + s.polePushTime) / s.polePushInterval);

  // reach: hands forward (+) or back (-) in meters. The pole goes riding ->
  // planted -> pushed through -> riding; `from`/`to` pick the two angles.
  let reach: number;
  let lift: number;
  let crunch = 0;
  let from: PoleKey;
  let to: PoleKey;
  let t: number;
  if (phase < plant) {
    t = ease(phase / plant);
    reach = 0.34 * t;
    lift = 0.22 * t;
    from = 'riding';
    to = 'planted';
  } else if (phase < done) {
    t = ease((phase - plant) / (done - plant));
    reach = 0.34 - 0.7 * t;
    lift = 0.22 - 0.34 * t;
    crunch = 0.32 * Math.sin(Math.PI * t);
    from = 'planted';
    to = 'pushed';
  } else {
    t = ease((phase - done) / (1 - done));
    reach = -0.36 * (1 - t);
    lift = -0.12 * (1 - t);
    from = 'pushed';
    to = 'riding';
  }

  p.chestPitch += crunch;
  for (let i = 0; i < 2; i++) {
    const h = p.hands[i === 0 ? 0 : 1];
    const mirror = i === 0 ? 1 : -1;
    h.at[1] += lift;
    h.at[2] -= reach;
    for (let k = 0; k < 3; k++) {
      const riding = h.pole[k] ?? 0;
      const sign = k === 0 ? mirror : 1;
      const a = poleAngle(from, riding, k, sign);
      h.pole[k] = a + (poleAngle(to, riding, k, sign) - a) * t;
    }
  }
}

type PoleKey = 'riding' | 'planted' | 'pushed';

/** One component of a pole direction key; `riding` is the pose's own pole. */
function poleAngle(key: PoleKey, riding: number, k: number, sign: number): number {
  if (key === 'riding') return riding;
  return ((key === 'planted' ? POLE_PLANTED[k] : POLE_PUSHED[k]) ?? 0) * sign;
}

function ease(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/** Landing absorb: down fast, back up over the rest of squashTime. 1 at the bottom. */
function landCurve(t: number): number {
  const down = 0.07;
  if (t < down) return t / down;
  return Math.max(0, 1 - (t - down) / (TUNING.landing.squashTime - down));
}

function approach(value: number, target: number, maxDelta: number): number {
  if (value < target) return Math.min(value + maxDelta, target);
  return Math.max(value - maxDelta, target);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  return ease((x - edge0) / (edge1 - edge0));
}
