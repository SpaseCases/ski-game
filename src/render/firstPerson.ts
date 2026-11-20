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
/** Grabs (GRAB_ACTIONS indices) that read only with the legs drawn while looking down: both japans and the spread eagle. */
const LEG_GRABS: readonly number[] = [2, 6, 13];
/** On a snowboard (milestone 22): the method, the japan, the roast beef, the poke and the stiffy, which read only with the legs (the rocket air's front knee comes up to the eye, so its view shows the board, boots and hands). */
const BOARD_LEG_GRABS: readonly number[] = [2, 3, 6, 11, 13];
const toFeet = new Vector3();
/** A grab's view leans from the body's down toward the feet by at most this (m across per m down). */
const FEET_AIM_MAX = 0.6;
const grabView = new Quaternion();
const bodyUp = new Vector3();
const bodyDown = new Vector3();
const bodyTips = new Vector3();
const bodyRight = new Vector3();
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
  /** How far the view has turned to look down at the skis for a grab (0..1), and the grab it last looked at (kept while easing back up). */
  grabLook = 0;
  lastGrab = -1;
  /**
   * Head-locked in the air (milestone 28): the turn (radians round the
   * world's up) added to the head-locked view so the look over the shoulder
   * that riding switch needs unwinds through a spin to the stance the skis
   * now face (or winds up, normal to switch): a 180 lands looking down the
   * hill, with no half turn of the view after. `stanceAtTakeoff` is that
   * stance (0 forward, π switch); `bodyHeading` the body's last heading
   * across the ground and `spinSide` which way it last turned.
   */
  private unwind = 0;
  /** What `unwind` eases toward, and the stance, the head's turn on the body (radians) at takeoff and the stance now. */
  private owed = 0;
  private headAtTakeoff = 0;
  private stanceNow = 0;
  private stanceAtTakeoff = 0;
  private bodyHeading = 0;
  private spinSide = 1;
  private lookYaw = 0;
  private lookPitch = 0;
  private sinceDrag = Infinity;
  private bobPhase = 0;
  /** The last heading looked along on the snow (for a stop, when travel says nothing). */
  private heading = 0;
  /** This update drops all easing (see update's `snap`). */
  private snapping = false;

  /** Works out this frame's view. `snap` drops all easing (a respawn, a skipped lift ride, switching in at rest). */
  update(pose: SkierPose, rig: SkierRig, hf: Heightfield, frameTime: number, drag: OrbitDrag, air: FirstAir, snap: boolean): void {
    const c = CONFIG.camera;
    rig.eye(this.middle, this.head);
    this.snapping = snap;
    if (snap) {
      this.lookYaw = 0;
      this.lookPitch = 0;
      this.roll = 0;
      this.grabLook = 0;
      this.locked = false;
      this.sinceDrag = Infinity;
    }

    // The up turns toward a 3D rail's (and back to the world's), as the chase camera's does.
    qTurn.setFromUnitVectors(this.up, pose.rail3d ? pose.normal : UP);
    this.up.applyQuaternion(qStep.identity().slerp(qTurn, snap ? 1 : smoothing(c.rollRate, frameTime))).normalize();
    if (!pose.rail3d && this.up.y > 0.99999) this.up.copy(UP);

    const flying = !pose.grounded && !pose.bailed;
    if (flying && air === 'head') {
      const v = pose.velocity;
      if (v.x * v.x + v.z * v.z > 0.25) this.heading = Math.atan2(-v.x, -v.z);
      const takeoff = snap || !this.locked;
      const body = this.bodyFacing(pose, takeoff);
      // The stance the body is in against the flight path: past a quarter turn either way it's switch.
      const stance = Math.abs(wrapAngle(body - this.heading)) > Math.PI / 2 ? Math.PI : 0;
      // How the head is turned on the body (riding switch it looks back over a shoulder, on a board more so).
      const headOnBody = wrapAngle(headingOf(this.head, body) - body);
      if (takeoff) {
        if (snap) this.targetView(pose, true, this.base);
        this.locked = true;
        this.takeoffHead.copy(this.head);
        this.takeoffView.copy(this.base);
        this.unwind = 0;
        this.stanceAtTakeoff = stance;
        this.stanceNow = stance;
        this.headAtTakeoff = headOnBody;
      }
      // The turn still owed: from takeoff's stance to this one (0 or a half
      // turn), less the head's own turn on the body since takeoff, so the
      // view turns with the body's spin. Taken the nearest way round; as the
      // stance changes, against the spin, so the view comes back rather than
      // spinning on past.
      const owed = this.stanceAtTakeoff - stance - wrapAngle(headOnBody - this.headAtTakeoff);
      // Kept continuous with last frame's (whole turns apart); a stance change moves it half a turn, against the spin.
      const from = stance === this.stanceNow ? this.owed : this.owed - this.spinSide * Math.PI;
      this.stanceNow = stance;
      this.owed = takeoff ? 0 : owed + Math.round((from - owed) / (2 * Math.PI)) * 2 * Math.PI;
      this.unwind += (this.owed - this.unwind) * (snap ? 1 : smoothing(c.firstStanceRate, frameTime));
      // view = turn owed × (head now × head at takeoff⁻¹) × view at takeoff
      inverse.copy(this.takeoffHead).invert();
      this.base.copy(this.head).multiply(inverse).multiply(this.takeoffView);
      if (this.unwind !== 0) this.base.premultiply(qAxis.setFromAxisAngle(UP, this.unwind));
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

    // A grab or style move held in the air looks down at the skis, so the grab shows.
    const grabTo = flying && pose.grab >= 0 ? 1 : 0;
    if (pose.grab >= 0) this.lastGrab = pose.grab;
    this.grabLook += (grabTo - this.grabLook) * (snap ? 1 : smoothing(c.firstGrabRate, frameTime));

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
    if (this.grabLook > 0.001) {
      // Looking from the head down the body to the skis, their tips (the
      // board's nose) at the top of the screen, turned with the body
      // (milestone 28): through a flip or a cork the skis stay in view and
      // the sky and the slope swing past behind them. (Before, it panned
      // straight down at the snow, so upside down the skis left the view.)
      bodyUp.set(0, 1, 0).applyQuaternion(pose.orient);
      bodyTips.set(0, 0, -1).applyQuaternion(pose.orient);
      bodyDown.copy(bodyUp).negate();
      // The head is seldom right over the feet in a grab (on a board it's
      // out over the toes; on skis the crouch puts the feet behind it): the
      // view leans from the body's down toward the feet (by their offset
      // across the body, at most FEET_AIM_MAX, so it never jumps however the
      // body is turned).
      rig.root.updateWorldMatrix(true, false);
      toFeet.copy(rig.feetCenter).applyMatrix4(rig.root.matrixWorld).sub(this.middle);
      toFeet.addScaledVector(bodyUp, -toFeet.dot(bodyUp));
      const across = toFeet.length();
      if (across > FEET_AIM_MAX) toFeet.multiplyScalar(FEET_AIM_MAX / across);
      bodyDown.add(toFeet).normalize();
      look.lookAt(ORIGIN, bodyDown, bodyTips);
      grabView.setFromRotationMatrix(look);
      const g = this.grabLook;
      q.slerp(grabView, g * g * (3 - 2 * g));
    }

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

  /** The body's heading across the ground (headingOf, kept through a cork), noting which way it turned since last frame (`spinSide`) unless `reset`. */
  private bodyFacing(pose: SkierPose, reset: boolean): number {
    const heading = headingOf(pose.orient, this.bodyHeading);
    const turned = wrapAngle(heading - this.bodyHeading);
    if (!reset && Math.abs(turned) > 1e-4) this.spinSide = turned > 0 ? 1 : -1;
    this.bodyHeading = heading;
    return heading;
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
      // Slow, it leans toward the end of the skis nearer where the view looks
      // now (the tips going forward, the tails riding switch), never across
      // them (milestone 28: blending the angle from the tips flipped sides as
      // switch riding crossed a half turn, and a slow turn from switch
      // whipped the view most of the way round in a second). A pivot from
      // switch to forward on the spot hands the view from the tails to the
      // tips as they pass it, so it stays looking down the hill.
      // (Snapping in, a respawn say, the view from before says nothing: the tips.)
      forward.set(0, 0, -1).applyQuaternion(this.base);
      const looking = this.snapping ? pose.yaw : forward.x * forward.x + forward.z * forward.z > 0.01 ? Math.atan2(-forward.x, -forward.z) : this.heading;
      const end = Math.cos(looking - pose.yaw) >= 0 ? 1 : -1;
      // (Under travelMinSpeed, t is 0: just that end.)
      const hx = -Math.sin(pose.yaw) * end * (1 - t) + (t > 0 ? (v.x / hspeed) * t : 0);
      const hz = -Math.cos(pose.yaw) * end * (1 - t) + (t > 0 ? (v.z / hspeed) * t : 0);
      if (hx * hx + hz * hz > 0.01) this.heading = Math.atan2(-hx, -hz);
      else this.heading = end > 0 ? pose.yaw : wrapAngle(pose.yaw + Math.PI);
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
    // At the eye the head goes (it would fill the view); in the air with "Level" the body too, but for the skis;
    // looking down at a grab, all but the mittens, poles, boots and skis (the rest would fill the view from inches away).
    const atEye = cam.position.distanceToSquared(first.eye) < c.firstHideRange * c.firstHideRange;
    const flying = !pose.grounded && !pose.bailed && !pose.onRail;
    const legs = rig.onBoard ? BOARD_LEG_GRABS : LEG_GRABS;
    const grab = !atEye || first.grabLook <= 0.2 ? 0 : legs.includes(first.lastGrab) ? 2 : 1;
    rig.setHidden(atEye, atEye && flying && this.firstAir === 'level', grab);
  }
}

/**
 * The heading across the ground (radians, as the sim's yaw) that something
 * turned by `q` faces, from its right-hand side (+X) so a flip, which turns
 * round that side, leaves it be; `fallback` while that side stands near
 * upright (a cork).
 */
function headingOf(q: Quaternion, fallback: number): number {
  bodyRight.set(1, 0, 0).applyQuaternion(q);
  // Forward across the ground: up × right.
  const fx = bodyRight.z;
  const fz = -bodyRight.x;
  return fx * fx + fz * fz > 0.09 ? Math.atan2(-fx, -fz) : fallback;
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
