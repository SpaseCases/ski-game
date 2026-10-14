import type { PerspectiveCamera } from 'three';
import { CONFIG } from '../config.ts';
import type { Heightfield } from '../maps/types.ts';
import { wrapAngle } from '../sim/skier.ts';
import { heightAt } from '../sim/terrain.ts';
import type { SkierPose } from './skierView.ts';

/**
 * Third-person chase camera. Sits behind and above the skier along the
 * direction of travel (so it swings around when riding switch), pulls back
 * with speed, never rolls, and stays above the snow.
 */
export class ChaseCamera {
  private readonly camera: PerspectiveCamera;
  private readonly hf: Heightfield;
  private yaw = 0;
  private focusY = 0;

  constructor(camera: PerspectiveCamera, hf: Heightfield) {
    this.camera = camera;
    this.hf = hf;
  }

  /** Jumps straight to the skier with no smoothing (start and respawn). */
  snap(pose: SkierPose): void {
    this.yaw = this.targetYaw(pose);
    this.focusY = pose.position.y;
    this.place(pose);
  }

  update(pose: SkierPose, frameTime: number): void {
    const c = CONFIG.camera;
    const target = this.targetYaw(pose);
    this.yaw = wrapAngle(this.yaw + wrapAngle(target - this.yaw) * smoothing(c.yawSmoothing, frameTime));

    // Follow height smoothly. On the snow, lead by vertical speed so a steady
    // descent doesn't leave the camera lagging; in the air, follow loosely
    // so the horizon stays calm.
    const p = pose.position;
    const rate = pose.grounded ? c.heightSmoothingGround : c.heightSmoothingAir;
    const lead = pose.grounded ? pose.velocity.y / rate : 0;
    this.focusY += (p.y + lead - this.focusY) * smoothing(rate, frameTime);

    this.place(pose);
  }

  private place(pose: SkierPose): void {
    const c = CONFIG.camera;
    const p = pose.position;
    const speed = Math.hypot(pose.velocity.x, pose.velocity.z);
    const far = Math.min(1, speed / c.speedForFar);
    const dist = c.distNear + (c.distFar - c.distNear) * far;
    const height = c.heightNear + (c.heightFar - c.heightNear) * far;

    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const cx = p.x - fx * dist;
    const cz = p.z - fz * dist;
    let cy = this.focusY + height;

    // Stay above the snow at the camera and halfway back to the skier.
    cy = Math.max(cy, heightAt(this.hf, cx, cz) + c.clearance);
    const midGround = heightAt(this.hf, (p.x + cx) / 2, (p.z + cz) / 2) + c.clearance;
    const midLine = (this.focusY + c.lookHeight + cy) / 2;
    if (midGround > midLine) cy += 2 * (midGround - midLine);

    this.camera.position.set(cx, cy, cz);
    this.camera.lookAt(p.x + fx * c.lookAhead, this.focusY + c.lookHeight, p.z + fz * c.lookAhead);
  }

  /** Heading of travel, falling back to where the skis point when nearly stopped. */
  private targetYaw(pose: SkierPose): number {
    const c = CONFIG.camera;
    const v = pose.velocity;
    const speed = Math.hypot(v.x, v.z);
    const t = clamp01((speed - c.travelMinSpeed) / (c.travelFullSpeed - c.travelMinSpeed));
    const travel = Math.atan2(-v.x, -v.z);
    return pose.yaw + wrapAngle(travel - pose.yaw) * t;
  }
}

function smoothing(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
