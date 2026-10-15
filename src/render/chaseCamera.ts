import type { PerspectiveCamera } from 'three';
import { CONFIG } from '../config.ts';
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

/**
 * Third-person chase camera. Sits behind and above the skier along the
 * direction of travel (so it swings around when riding switch), pulls back
 * with speed, never rolls, and stays above the snow. Dragging with the mouse
 * orbits it around the skier; once riding, it eases back behind.
 */
export class ChaseCamera {
  private readonly camera: PerspectiveCamera;
  private readonly hf: Heightfield;
  private yaw = 0;
  private focusY = 0;
  /** Orbit added by dragging, on top of the chase heading and tilt. */
  private orbitYaw = 0;
  private orbitPitch = 0;
  private sinceDrag = Infinity;

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
    this.place(pose);
  }

  update(pose: SkierPose, frameTime: number, drag: OrbitDrag): void {
    const c = CONFIG.camera;
    const target = this.targetYaw(pose);
    this.yaw = wrapAngle(this.yaw + wrapAngle(target - this.yaw) * smoothing(c.yawSmoothing, frameTime));

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

    this.place(pose);
  }

  private place(pose: SkierPose): void {
    const c = CONFIG.camera;
    // Follow the body, not the feet, which swing around it in flips.
    const p = pose.center;
    const speed = Math.hypot(pose.velocity.x, pose.velocity.z);
    const far = Math.min(1, speed / c.speedForFar);
    const dist = c.distNear + (c.distFar - c.distNear) * far;
    const height = c.heightNear + (c.heightFar - c.heightNear) * far;

    // Same distance from the skier, swung around by the orbit.
    const range = Math.hypot(dist, height);
    const elevation = Math.atan2(height, dist) + this.orbitPitch;
    const flat = range * Math.cos(elevation);
    const heading = this.yaw + this.orbitYaw;
    const fx = -Math.sin(heading);
    const fz = -Math.cos(heading);
    const cx = p.x - fx * flat;
    const cz = p.z - fz * flat;
    let cy = this.focusY + range * Math.sin(elevation);

    // Stay above the snow at the camera and halfway back to the skier.
    cy = Math.max(cy, heightAt(this.hf, cx, cz) + c.clearance);
    const midGround = heightAt(this.hf, (p.x + cx) / 2, (p.z + cz) / 2) + c.clearance;
    const lookY = focusHeight(pose) + c.lookHeight;
    const midLine = (lookY + cy) / 2;
    if (midGround > midLine) cy += 2 * (midGround - midLine);

    this.camera.position.set(cx, cy, cz);
    this.camera.lookAt(p.x + fx * c.lookAhead, lookY, p.z + fz * c.lookAhead);
  }

  /** Heading of travel, falling back to where the skis point when nearly stopped. */
  private targetYaw(pose: SkierPose): number {
    const c = CONFIG.camera;
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
