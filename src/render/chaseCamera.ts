import { Quaternion, Vector3, type PerspectiveCamera } from 'three';
import { CONFIG } from '../config.ts';
import { pipeAt } from '../maps/shapes.ts';
import type { Heightfield } from '../maps/types.ts';
import { wrapAngle } from '../sim/skier.ts';
import { heightAt } from '../sim/terrain.ts';
import type { SkierPose } from './skierView.ts';

/** Mouse drag since the last frame, in pixels, and whether a drag is still held. */
export interface OrbitDrag {
  x: number;
  y: number;
  active: boolean;
}

const UP = new Vector3(0, 1, 0);
// Scratch, so a frame never allocates.
const chasePos = new Vector3();
const chaseLook = new Vector3();
const railPos = new Vector3();
const railLook = new Vector3();
const travel = new Vector3();
const railUpV = new Vector3();
const qTurn = new Quaternion();
const qStep = new Quaternion();

/**
 * Third-person chase camera. Sits behind and above the skier along the
 * direction of travel (so it swings around when riding switch), pulls back
 * with speed, never rolls, and stays above the snow. In a halfpipe it looks
 * down the pipe rather than swinging with every wall. Dragging with the
 * mouse orbits it around the skier; once riding, it eases back behind.
 * Round a 3D rail (a loop or a corkscrew) it does roll: it eases into a view
 * from behind along the travel, its up following the rail's, and back out
 * to the level chase after leaving the rail.
 */
export class ChaseCamera {
  private readonly camera: PerspectiveCamera;
  /** The snow to stay above; swapped when another map loads. */
  hf: Heightfield;
  private yaw = 0;
  private focusY = 0;
  /** Orbit added by dragging, on top of the chase heading and tilt. */
  private orbitYaw = 0;
  private orbitPitch = 0;
  private sinceDrag = Infinity;
  /** Height (m) added for the snow rising behind the skier (see CONFIG.camera.slopeLift), smoothed. */
  private lift = 0;
  /** The camera's up, turning toward a 3D rail's up while on one and back to the world's after (CONFIG.camera.rollRate). */
  private readonly up = new Vector3(0, 1, 0);
  /** 0 the level chase view, 1 the view rolling with a 3D rail; eased over CONFIG.camera.rollBlend. */
  private roll = 0;

  constructor(camera: PerspectiveCamera, hf: Heightfield) {
    this.camera = camera;
    this.hf = hf;
  }

  /** Jumps straight to the skier with no smoothing and no orbit (start and respawn). */
  snap(pose: SkierPose): void {
    this.yaw = this.targetYaw(pose);
    this.focusY = focusHeight(pose);
    this.orbitYaw = 0;
    this.orbitPitch = 0;
    this.lift = this.targetLift(pose);
    this.roll = pose.rail3d ? 1 : 0;
    this.up.copy(pose.rail3d ? pose.normal : UP);
    this.place(pose);
  }

  update(pose: SkierPose, frameTime: number, drag: OrbitDrag): void {
    const c = CONFIG.camera;
    // Round a 3D rail the chase heading holds (the travel turns right round), ready for the way out.
    if (!pose.rail3d) {
      const target = this.targetYaw(pose);
      this.yaw = wrapAngle(this.yaw + wrapAngle(target - this.yaw) * smoothing(c.yawSmoothing, frameTime));
    }
    this.roll = Math.min(1, Math.max(0, this.roll + (pose.rail3d ? 1 : -1) * (frameTime / c.rollBlend)));
    // The up turns toward the rail's (or back to the world's) by the shortest way.
    qTurn.setFromUnitVectors(this.up, pose.rail3d ? pose.normal : UP);
    this.up.applyQuaternion(qStep.identity().slerp(qTurn, smoothing(c.rollRate, frameTime))).normalize();
    if (!pose.rail3d && this.roll === 0 && this.up.y > 0.99999) this.up.copy(UP);

    // Dragging right swings the camera left around the skier (the view turns
    // with the drag); dragging down raises it to look from above.
    this.orbitYaw = wrapAngle(this.orbitYaw - drag.x * c.orbitSensitivity);
    this.orbitPitch = clamp(this.orbitPitch + drag.y * c.orbitSensitivity, c.orbitPitchMin, c.orbitPitchMax);
    this.sinceDrag = drag.active ? 0 : this.sinceDrag + frameTime;
    const speed = Math.hypot(pose.velocity.x, pose.velocity.z);
    if (this.sinceDrag > c.orbitReturnDelay && speed > c.orbitHoldSpeed) {
      const k = smoothing(c.orbitReturnRate, frameTime);
      this.orbitYaw -= this.orbitYaw * k;
      this.orbitPitch -= this.orbitPitch * k;
    }

    // The camera's height follows smoothly: tightly on the snow, loosely in
    // the air so the horizon stays calm. Leading by vertical speed stops it
    // trailing behind a steady climb or fall. Its aim always stays on the
    // skier (see place), so a lagging camera never loses them off screen.
    const rate = pose.grounded ? c.heightSmoothingGround : c.heightSmoothingAir;
    const lead = pose.velocity.y / rate;
    this.focusY += (focusHeight(pose) + lead - this.focusY) * smoothing(rate, frameTime);
    this.lift += (this.targetLift(pose) - this.lift) * smoothing(c.heightSmoothingGround, frameTime);

    this.place(pose);
  }

  /** How much to lift the camera for the snow rising between the skier and where the camera sits. */
  private targetLift(pose: SkierPose): number {
    const c = CONFIG.camera;
    const p = pose.center;
    const { x, z } = this.spot(pose);
    const rise = heightAt(this.hf, x, z) - heightAt(this.hf, p.x, p.z);
    return Math.min(c.slopeLiftMax, Math.max(0, rise * c.slopeLift));
  }

  /** Where the camera sits seen from above: behind the skier along the chase heading and orbit. */
  private spot(pose: SkierPose): { x: number; z: number; flat: number; range: number; elevation: number } {
    const c = CONFIG.camera;
    const p = pose.center;
    const speed = Math.hypot(pose.velocity.x, pose.velocity.z);
    const far = Math.min(1, speed / c.speedForFar);
    const dist = c.distNear + (c.distFar - c.distNear) * far;
    const height = c.heightNear + (c.heightFar - c.heightNear) * far;
    const range = Math.hypot(dist, height);
    const elevation = Math.atan2(height, dist) + this.orbitPitch;
    const flat = range * Math.cos(elevation);
    const heading = this.yaw + this.orbitYaw;
    return { x: p.x + Math.sin(heading) * flat, z: p.z + Math.cos(heading) * flat, flat, range, elevation };
  }

  private place(pose: SkierPose): void {
    const c = CONFIG.camera;
    // Follow the body, not the feet, which swing around it in flips.
    const p = pose.center;
    // Same distance from the skier, swung around by the orbit, lifted where the snow behind rises.
    const { x: cx, z: cz, range, elevation } = this.spot(pose);
    const heading = this.yaw + this.orbitYaw;
    const fx = -Math.sin(heading);
    const fz = -Math.cos(heading);
    let cy = this.focusY + range * Math.sin(elevation) + this.lift;

    // Stay above the snow at the camera and halfway back to the skier.
    cy = Math.max(cy, heightAt(this.hf, cx, cz) + c.clearance);
    const midGround = heightAt(this.hf, (p.x + cx) / 2, (p.z + cz) / 2) + c.clearance;
    const lookY = focusHeight(pose) + c.lookHeight;
    const midLine = (lookY + cy) / 2;
    if (midGround > midLine) cy += 2 * (midGround - midLine);
    chasePos.set(cx, cy, cz);
    chaseLook.set(p.x + fx * c.lookAhead, lookY, p.z + fz * c.lookAhead);

    if (this.roll > 0) {
      // Rolling with a 3D rail: behind along the travel and above along the
      // camera's up, the same distance and height as the chase, looking
      // ahead along the travel. Blended with the chase view while easing.
      const speed = pose.velocity.length();
      if (speed > 0.5) travel.copy(pose.velocity).divideScalar(speed);
      else travel.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      railUpV.copy(this.up).addScaledVector(travel, -this.up.dot(travel)).normalize();
      const far = Math.min(1, speed / c.speedForFar);
      const dist = c.distNear + (c.distFar - c.distNear) * far;
      const height = c.heightNear + (c.heightFar - c.heightNear) * far;
      railPos.copy(p).addScaledVector(travel, -dist).addScaledVector(railUpV, height);
      railLook.copy(p).addScaledVector(railUpV, c.lookHeight).addScaledVector(travel, c.lookAhead);
      const w = this.roll * this.roll * (3 - 2 * this.roll);
      chasePos.lerp(railPos, w);
      chaseLook.lerp(railLook, w);
    }

    this.camera.up.copy(this.up);
    this.camera.position.copy(chasePos);
    this.camera.lookAt(chaseLook);
  }

  /** Heading of travel, falling back to where the skis point when nearly stopped; down the pipe in a halfpipe. */
  private targetYaw(pose: SkierPose): number {
    const c = CONFIG.camera;
    const pipe = pose.bailed ? undefined : pipeAt(this.hf.shapes, pose.position.x, pose.position.z);
    if (pipe) return pipe.heading;
    const v = pose.velocity;
    const speed = Math.hypot(v.x, v.z);
    const t = clamp((speed - c.travelMinSpeed) / (c.travelFullSpeed - c.travelMinSpeed), 0, 1);
    const travel = Math.atan2(-v.x, -v.z);
    return pose.yaw + wrapAngle(travel - pose.yaw) * t;
  }
}

/** Feet height the camera follows: under the body center, so flips don't bob the view. */
function focusHeight(pose: SkierPose): number {
  return pose.center.y - (pose.bailed ? CONFIG.bail.centerHeight : CONFIG.air.comHeight);
}

function smoothing(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
