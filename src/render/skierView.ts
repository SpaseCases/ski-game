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
import { addPoseDelta, createPoseBuffer, setPose, type PoseBuffer } from './poseBlend.ts';
import { CROUCH, STANCE, TUCK } from './skierPoses.ts';
import { SkierRig } from './skierRig.ts';

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
}

const UP = new Vector3(0, 1, 0);
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
  private readonly rig = new SkierRig();
  private readonly root = new Group();
  private readonly swing = new Group();
  private readonly lean = new Group();
  private readonly pose: PoseBuffer = createPoseBuffer();
  private readonly shadow: Mesh;
  private readonly shadowMaterial: MeshBasicMaterial;
  /** Smoothed "up" the body is tilted to: the snow normal when riding, straight up in the air. */
  private readonly tiltUp = new Vector3(0, 1, 0);
  private readonly tilt = new Quaternion();
  private readonly turn = new Quaternion();
  private readonly groundNormal = new Vector3();
  private readonly hf: Heightfield;

  constructor(scene: Scene, hf: Heightfield) {
    this.hf = hf;
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

  /** Jumps the body tilt straight to the current snow normal (after a respawn). */
  snap(pose: SkierPose): void {
    this.tiltUp.copy(pose.normal);
  }

  update(state: SkierPose, frameTime: number): void {
    const r = CONFIG.render;
    this.root.position.copy(state.position);
    const target = state.grounded ? state.normal : UP;
    this.tiltUp.lerp(target, 1 - Math.exp(-r.tiltSmoothing * frameTime)).normalize();
    this.tilt.setFromUnitVectors(UP, this.tiltUp);
    this.turn.setFromAxisAngle(UP, state.yaw);
    this.root.quaternion.multiplyQuaternions(this.tilt, this.turn);

    // Hockey stop: the skis swing sideways and the skier leans away from the skid.
    const swing = state.brake * r.brakeTwist * state.brakeSide;
    this.swing.rotation.y = swing;
    this.lean.rotation.z = state.lean + state.brake * r.brakeLean * state.brakeSide;

    // Body: stance, sinking into a crouch while ↑ is held, which becomes a
    // speed tuck when going fast on the snow. Braking sinks a little too.
    const speed = Math.hypot(state.velocity.x, state.velocity.z);
    const tuck = state.grounded ? smoothstep(r.tuckSpeedMin, r.tuckSpeedFull, speed) : 0;
    const p = this.pose;
    setPose(p, STANCE);
    addPoseDelta(p, STANCE, CROUCH, state.crouch * (1 - tuck) + state.brake * r.brakeSink * (1 - state.crouch));
    addPoseDelta(p, STANCE, TUCK, state.crouch * tuck);
    // The upper body turns back against the swing to keep facing down the hill.
    p.pelvisYaw -= swing * r.brakeCounter * 0.5;
    p.chestYaw -= swing * r.brakeCounter * 0.5;
    poleStroke(p, state.polePhase);
    this.rig.apply(p);

    // Shadow sits on the snow under the skier and fades as they rise.
    const pos = state.position;
    const ground = groundAt(this.hf, pos.x, pos.z, this.groundNormal);
    const height = Math.max(0, pos.y - ground);
    this.shadow.position.set(pos.x, ground, pos.z).addScaledVector(this.groundNormal, 0.06);
    this.shadow.quaternion.setFromUnitVectors(UP, this.groundNormal);
    const fade = Math.max(0.15, 1 - height / 6);
    this.shadow.scale.setScalar(0.75 + 0.25 * fade);
    this.shadowMaterial.opacity = SHADOW_OPACITY * fade;
  }
}

/**
 * Pole push, keyed to the sim's push timing: the hands reach forward and
 * plant the poles by the boots, drive back past the hips while the push
 * force acts, then swing back to the riding position.
 */
function poleStroke(p: PoseBuffer, phase: number): void {
  if (phase >= 1) return;
  const s = CONFIG.skier;
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

function smoothstep(edge0: number, edge1: number, x: number): number {
  return ease((x - edge0) / (edge1 - edge0));
}
