import { Matrix4, Quaternion, Vector3, type PerspectiveCamera } from 'three';
import { CONFIG } from '../config.ts';
import type { CameraView, FirstAir } from '../core/settings.ts';
import type { Heightfield } from '../maps/types.ts';
import { wrapAngle } from '../sim/skier.ts';
import type { ChaseCamera, OrbitDrag } from './chaseCamera.ts';
import { EYE_FORWARD, type SkierRig } from './skierRig.ts';
import type { SkierPose } from './skierView.ts';
import { drawnHeightAt } from './terrainMesh.ts';

// First person (milestone 18) and the switch between it and the chase
// camera. Runs every frame, so it lives in render/ (never obfuscated) and
// allocates nothing: every vector and quaternion below is scratch.

const UP = new Vector3(0, 1, 0);
const ORIGIN = new Vector3();
const X_AXIS = new Vector3(1, 0, 0);
const Z_AXIS = new Vector3(0, 0, 1);
/** A drag that never moves: what the view not in use gets, so only one of them looks around. */
const STILL: OrbitDrag = { x: 0, y: 0, active: false };

const look = new Matrix4();
const forward = new Vector3();
const flat = new Vector3();
const target = new Quaternion();
const qTurn = new Quaternion();
const qStep = new Quaternion();
const qAxis = new Quaternion();
const inverse = new Quaternion();
const headUp = new Vector3();
const chasePos = new Vector3();
const chaseQ = new Quaternion();
const chaseUp = new Vector3();

/**
 * The view from the skier's eye. The eye is the rig's own (SkierRig.eye: at
 * the goggles, wherever the pose puts the head). On the snow, on rails and
 * waiting for the lift it looks along the travel, a little down, rolling a
 * little into carves and bobbing with speed; on a 3D rail its up follows the
 * rail's, as the chase camera's does. In the air it is head-locked (it turns
 * exactly as the head has turned since takeoff) or, with "Level", looks
 * along the flight path with the horizon level. Seated on a chair it looks
 * along the chair's heading. Dragging turns the head; once riding it eases
 * back like the chase camera's orbit.
 */
export class FirstPerson {
  /** The result: where the camera goes, how it's turned, and its up (the world's, or a 3D rail's). */
  readonly position = new Vector3();
  readonly quaternion = new Quaternion();
  readonly up = new Vector3(0, 1, 0);
  /** The eye, turned round the head's middle toward where the view looks. */
  readonly eye = new Vector3();
  /** The head's middle (at the goggles) and its turn, as the rig gave them this frame. */
  private readonly middle = new Vector3();
  private readonly head = new Quaternion();
  /** The view before the lean roll and the drag: eased toward its target, or locked to the head in the air. */
  private readonly base = new Quaternion();
  /** Head-locked in the air: the head's turn and the view at takeoff. */
  private locked = false;
  private readonly takeoffHead = new Quaternion();
  private readonly takeoffView = new Quaternion();
  private roll = 0;
  private lookYaw = 0;
  private lookPitch = 0;
  private sinceDrag = Infinity;
  private bobPhase = 0;
  /** The last heading looked along on the snow (for a stop, when travel says nothing). */
  private heading = 0;

  /** Works out this frame's view. `snap` drops all easing (a respawn, a skipped lift ride, switching in at rest). */
  update(pose: SkierPose, rig: SkierRig, hf: Heightfield, frameTime: number, drag: OrbitDrag, air: FirstAir, snap: boolean): void {
    const c = CONFIG.camera;
    rig.eye(this.middle, this.head);
    if (snap) {
      this.lookYaw = 0;
      this.lookPitch = 0;
      this.roll = 0;
      this.locked = false;
      this.sinceDrag = Infinity;
    }

    // The up turns toward a 3D rail's (and back to the world's), as the chase camera's does.
    qTurn.setFromUnitVectors(this.up, pose.rail3d ? pose.normal : UP);
    this.up.applyQuaternion(qStep.identity().slerp(qTurn, snap ? 1 : smoothing(c.rollRate, frameTime))).normalize();
    if (!pose.rail3d && this.up.y > 0.99999) this.up.copy(UP);

    const flying = !pose.grounded && !pose.bailed;
    if (flying && air === 'head') {
      if (snap || !this.locked) {
        if (snap) this.targetView(pose, true, this.base);
        this.locked = true;
        this.takeoffHead.copy(this.head);
        this.takeoffView.copy(this.base);
      }
      // view = (head now × head at takeoff⁻¹) × view at takeoff
      inverse.copy(this.takeoffHead).invert();
      this.base.copy(this.head).multiply(inverse).multiply(this.takeoffView);
    } else {
      this.locked = false;
      this.targetView(pose, flying, target);
      if (snap) this.base.copy(target);
      else this.base.slerp(target, smoothing(c.firstTurnRate, frameTime));
    }

    // Rolling into a carve, on the snow only (riding switch, the lean is the other way round to the view).
    const hspeed = Math.hypot(pose.velocity.x, pose.velocity.z);
    const carving = pose.grounded && !pose.onRail && !pose.sitting && !pose.bailed;
    const facing = Math.cos(wrapAngle(this.heading - pose.yaw));
    const rollTo = carving ? pose.lean * c.firstLeanShare * facing : 0;
    this.roll += (rollTo - this.roll) * (snap ? 1 : smoothing(c.firstLeanRate, frameTime));

    // Drag to look: right looks right, down looks down (the chase camera's orbit turns the same way).
    this.lookYaw = clamp(this.lookYaw - drag.x * c.orbitSensitivity, -c.firstLookYawMax, c.firstLookYawMax);
    this.lookPitch = clamp(this.lookPitch - drag.y * c.orbitSensitivity, c.firstLookPitchMin, c.firstLookPitchMax);
    this.sinceDrag = drag.active ? 0 : this.sinceDrag + frameTime;
    // Seated on the chair the view stays where it's left; riding, it eases back after a moment.
    if (this.sinceDrag > c.orbitReturnDelay && hspeed > c.orbitHoldSpeed && !pose.sitting) {
      const k = smoothing(c.orbitReturnRate, frameTime);
      this.lookYaw -= this.lookYaw * k;
      this.lookPitch -= this.lookPitch * k;
    }

    // The drag turns the view round its up (the world's, or a 3D rail's), so looking round never tips the horizon.
    const q = this.quaternion.copy(this.base);
    if (this.lookYaw !== 0) q.premultiply(qAxis.setFromAxisAngle(this.up, this.lookYaw));
    if (this.roll !== 0) q.multiply(qAxis.setFromAxisAngle(Z_AXIS, this.roll));
    if (this.lookPitch !== 0) q.multiply(qAxis.setFromAxisAngle(X_AXIS, this.lookPitch));

    // The eye turns round the head's middle toward where the view looks, as
    // a head turns: looking sideways or back (riding switch, dragging, a
    // switch landing) puts it at the ear or the back of the head, so the
    // shoulders and the collar stay below the view. Its height in the head stays the goggles'.
    headUp.set(0, 1, 0).applyQuaternion(this.head);
    forward.set(0, 0, -1).applyQuaternion(q);
    forward.addScaledVector(headUp, -forward.dot(headUp));
    if (forward.lengthSq() < 0.04) forward.set(0, 0, -1).applyQuaternion(this.head);
    this.eye.copy(this.middle).addScaledVector(forward.normalize(), EYE_FORWARD);

    // A little bob over the snow, growing with speed, along the view's up.
    const p = this.position.copy(this.eye);
    if (carving) {
      this.bobPhase = (this.bobPhase + hspeed * frameTime * c.firstBobRate) % (Math.PI * 2);
      p.addScaledVector(this.up, c.firstBob * Math.min(1, hspeed / c.firstBobSpeed) * Math.sin(this.bobPhase));
    }
    // Never under the drawn snow (the chase camera's rule, closer in).
    p.y = Math.max(p.y, drawnHeightAt(hf, p.x, p.z) + c.firstClearance);
  }

  /** Where the view eases toward when not head-locked: along the travel (level in the air), or the chair's heading. */
  private targetView(pose: SkierPose, flying: boolean, out: Quaternion): void {
    const c = CONFIG.camera;
    const v = pose.velocity;
    const hspeed = Math.hypot(v.x, v.z);
    if (pose.rail3d) {
      // Round a loop or a corkscrew: straight along the travel, the up the rail's.
      const speed = v.length();
      if (speed > 0.5) forward.copy(v).divideScalar(speed);
      else forward.set(-Math.sin(pose.yaw), 0, -Math.cos(pose.yaw));
    } else if (pose.sitting) {
      // On the chair the skier's heading is the chair's.
      this.heading = pose.yaw;
      forward.set(-Math.sin(pose.yaw), 0, -Math.cos(pose.yaw));
    } else if (flying) {
      // Along the flight path, the pitch kept within bounds so the view doesn't stare at the sky or the snow.
      if (hspeed > 0.5) this.heading = Math.atan2(-v.x, -v.z);
      const pitch = clamp(Math.atan2(v.y, Math.max(hspeed, 0.5)), c.firstAirPitchMin, c.firstAirPitchMax);
      forward.set(-Math.sin(this.heading) * Math.cos(pitch), Math.sin(pitch), -Math.cos(this.heading) * Math.cos(pitch));
    } else {
      // Along the travel, toward where the skis point when slow (as the chase heading), down the slope or the rail.
      const t = clamp((hspeed - c.travelMinSpeed) / (c.travelFullSpeed - c.travelMinSpeed), 0, 1);
      this.heading = pose.yaw + wrapAngle(Math.atan2(-v.x, -v.z) - pose.yaw) * t;
      flat.set(-Math.sin(this.heading), 0, -Math.cos(this.heading));
      if (pose.onRail && v.length() > 1) forward.copy(v).normalize();
      else forward.copy(flat).addScaledVector(pose.normal, -flat.dot(pose.normal)).normalize();
    }
    // A camera looks down its -Z: lookAt from the origin to `forward` turns it that way.
    look.lookAt(ORIGIN, forward, this.up);
    out.setFromRotationMatrix(look);
    out.multiply(qAxis.setFromAxisAngle(X_AXIS, -c.firstLookDown));
  }
}

/**
 * The game camera: the chase camera, first person, or a blend of the two
 * while switching (CONFIG.camera.firstBlend). A crash eases out to the
 * chase camera and the respawn snaps back in. It also hides the head (and
 * in the air with "Level", the body) once the camera is at the eye.
 */
export class GameCamera {
  view: CameraView = 'chase';
  firstAir: FirstAir = 'head';
  private readonly camera: PerspectiveCamera;
  private readonly first = new FirstPerson();
  /** 0 the chase camera, 1 first person. */
  private weight = 0;
  private snapNext = true;

  constructor(camera: PerspectiveCamera) {
    this.camera = camera;
  }

  /** How far into first person (0 the chase camera, 1 first person), for the arms (SkierView.update). */
  get firstWeight(): number {
    return this.weight;
  }

  /** The next update jumps straight to the view with no easing (start, respawn, back to the top, a skipped lift ride). */
  snap(): void {
    this.snapNext = true;
  }

  update(chase: ChaseCamera, pose: SkierPose, rig: SkierRig, hf: Heightfield, frameTime: number, drag: OrbitDrag): void {
    const c = CONFIG.camera;
    const snap = this.snapNext;
    this.snapNext = false;
    const want = this.view === 'first' && !pose.bailed ? 1 : 0;
    this.weight = snap ? want : approach(this.weight, want, frameTime / c.firstBlend);
    if (snap) chase.snap(pose);
    // Only the view being switched to looks around with the drag.
    chase.update(pose, frameTime, want === 1 ? STILL : drag);
    const cam = this.camera;
    if (this.weight === 0 && want === 0) {
      rig.setHidden(false, false);
      setFov(cam, CONFIG.render.fov);
      return;
    }
    chasePos.copy(cam.position);
    chaseQ.copy(cam.quaternion);
    chaseUp.copy(cam.up);
    const first = this.first;
    first.update(pose, rig, hf, frameTime, want === 1 ? drag : STILL, this.firstAir, snap);
    const w = this.weight * this.weight * (3 - 2 * this.weight);
    cam.position.lerpVectors(chasePos, first.position, w);
    cam.quaternion.slerpQuaternions(chaseQ, first.quaternion, w);
    cam.up.lerpVectors(chaseUp, first.up, w).normalize();
    // Halfway between, the straight line can cut under a crest: keep it over the snow.
    if (w < 1) cam.position.y = Math.max(cam.position.y, drawnHeightAt(hf, cam.position.x, cam.position.z) + c.firstClearance);
    setFov(cam, CONFIG.render.fov + (c.firstFov - CONFIG.render.fov) * w);
    // At the eye the head goes (it would fill the view); in the air with "Level" the body too, but for the skis.
    const atEye = cam.position.distanceToSquared(first.eye) < c.firstHideRange * c.firstHideRange;
    const flying = !pose.grounded && !pose.bailed && !pose.onRail;
    rig.setHidden(atEye, atEye && flying && this.firstAir === 'level');
  }
}

function setFov(camera: PerspectiveCamera, fov: number): void {
  if (Math.abs(camera.fov - fov) < 1e-4) return;
  camera.fov = fov;
  camera.updateProjectionMatrix();
}

function approach(value: number, to: number, step: number): number {
  return value < to ? Math.min(to, value + step) : Math.max(to, value - step);
}

function smoothing(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
