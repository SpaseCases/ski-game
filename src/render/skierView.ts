import {
  BufferAttribute,
  CircleGeometry,
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
import { SkierModel } from './skierModel.ts';

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

/** Draws the skier and its blob shadow from interpolated sim state. */
export class SkierView {
  private readonly model = new SkierModel();
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
    scene.add(this.model.root);

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

  update(pose: SkierPose, frameTime: number): void {
    const root = this.model.root;
    root.position.copy(pose.position);

    const target = pose.grounded ? pose.normal : UP;
    this.tiltUp.lerp(target, 1 - Math.exp(-CONFIG.render.tiltSmoothing * frameTime)).normalize();
    this.tilt.setFromUnitVectors(UP, this.tiltUp);
    this.turn.setFromAxisAngle(UP, pose.yaw);
    root.quaternion.multiplyQuaternions(this.tilt, this.turn);

    this.model.pose({
      crouch: pose.crouch,
      lean: pose.lean,
      twist: pose.brake * CONFIG.render.brakeTwist * pose.brakeSide,
      polePhase: pose.polePhase,
    });

    // Shadow sits on the snow under the skier and fades as they rise.
    const p = pose.position;
    const ground = groundAt(this.hf, p.x, p.z, this.groundNormal);
    const height = Math.max(0, p.y - ground);
    this.shadow.position.set(p.x, ground, p.z).addScaledVector(this.groundNormal, 0.06);
    this.shadow.quaternion.setFromUnitVectors(UP, this.groundNormal);
    const fade = Math.max(0.15, 1 - height / 6);
    this.shadow.scale.setScalar(0.75 + 0.25 * fade);
    this.shadowMaterial.opacity = SHADOW_OPACITY * fade;
  }
}
