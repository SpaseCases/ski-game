import { Quaternion, Vector3 } from 'three';
import { CHEATS, TUNING } from './tuning.ts';
import { GRAB_ACTIONS, type InputState } from '../core/input.ts';
import { onPipeWall, onTakeoff, pipeInward } from '../maps/shapes.ts';
import type { Heightfield, RailShape, SpawnDef } from '../maps/types.ts';
import { keepInside } from './bounds.ts';
import { collideObstacles, type Course } from './obstacles.ts';
import { collideRails, railFrame, railUnder, type RailSpot } from './rails.ts';
import { groundAt, heightAt } from './terrain.ts';

// Skier physics. On the snow, velocity is split into the part along the skis
// (gravity, friction, drag) and the part across them, which the edges either
// carve into forward motion (up to a grip limit) or scrape away as a skid.
// The skier leaves the snow on its own wherever the slope falls away faster
// than gravity can follow.
//
// The skis' heading is measured in the snow's own frame (the world tilted to
// the snow's normal), and contact is resolved along that normal, so riding
// carries on smoothly up a halfpipe wall, however steep. Going up a wall and
// off its top launches straight up, rotating in the wall's plane, so the
// skier comes back down into the pipe.
//
// In the air the center of mass flies ballistically and the body turns
// around it. Orientation is built in layers:
//   frame  ×  heading at takeoff  ×  pitch that follows the flight path  ×  tricks
// The frame is the world, or a halfpipe wall turned up to face its normal.
// Tricks are the rotation from held keys, in the body's own axes: spin about
// its up axis, flips about its side-to-side axis, Lincoln loops about its
// front-to-back axis. Holding two at once rotates about a tilted axis, which
// is what makes corks and misty flips.
//
// Landing checks the body against the snow; too far off and the skier
// crashes: a cheap tumble that rolls and slides to a stop. With the No
// crashes cheat on, nothing crashes: a bad landing is set upright on the
// snow and rides on, and a hard hit only stops the skier.
//
// Rails and boxes: skis coming down onto one, close enough to its line and
// lined up straight or sideways, lock on and slide along it. Otherwise they
// slip off to the side. Riding onto one that starts at the snow locks on the
// same way. Running into a rail or box below its top, or into a tree, rock
// or fence, bumps, or crashes if hard enough.

/** Why the last landing was a crash ('' if it was clean). */
export type BailReason = '' | 'pitch' | 'edge' | 'sideways' | 'impact' | 'head' | 'obstacle';

export interface SkierState {
  /** Feet position on the snow. */
  position: Vector3;
  velocity: Vector3;
  /**
   * Ski heading in radians: 0 faces -Z (downhill), positive turns left. On
   * the snow it's measured in the snow's own frame (see rideSnow).
   */
  yaw: number;
  /** Current turning speed of the skis (rad/s, positive = left). */
  yawRate: number;
  grounded: boolean;
  /** Seconds since the skis left the snow (0 while riding). */
  airTime: number;
  /** True while a pop is available: on the snow, and briefly after leaving it. */
  canPop: boolean;
  /** Snow normal under the skier; the last contact normal while airborne. */
  normal: Vector3;
  /** 0 standing, 1 full crouch. */
  crouch: number;
  /** 0..1 braking amount. */
  brake: number;
  /** Side the body swings to for a hockey stop: +1 left, -1 right. */
  brakeSide: number;
  /** Lean into the turn in radians; positive leans to the skier's left. */
  lean: number;
  poleCooldown: number;
  /** Seconds since the latest pole push started. */
  poleTime: number;
  /** Direction of the latest push along the skis: +1 forward, -1 switch. */
  poleDir: number;
  /** 0..1 progress of the latest pole push cycle; 1 when idle. */
  polePhase: number;
  /** Extra push (m/s²) from snow curving up under the skis, beyond gravity's. */
  press: number;

  /**
   * Body orientation, skier space (+Y up, -Z toward the ski tips) to world.
   * On the snow it follows the slope and heading; in the air it carries the
   * tricks; in a crash it tumbles.
   */
  orient: Quaternion;
  /** Body center: the center of mass riding and flying, the middle of the tumbling body in a crash. */
  center: Vector3;
  /**
   * Rotation speed (rad/s). In the air it's in body axes: x flips (nose up
   * is +), y spins (left is +), z Lincoln loops (left is +). In a crash it's
   * the world-space tumble.
   */
  spin: Vector3;
  /** Air: one bit per axis (1 flip, 2 spin, 4 Lincoln) once a key drove it. Driven axes slow down after release. */
  spinDriven: number;
  /**
   * Air: the frame the flight is measured in (the world, or a halfpipe wall
   * turned up to face its normal), the skis' heading and flight-path pitch
   * (nose up +) in it, and the trick rotation on top.
   */
  airFrame: Quaternion;
  airHeading: number;
  airPitch: number;
  trick: Quaternion;
  /** Took off up a wall (see CONFIG.air.wallAngle): the heading follows the path along the wall. */
  airWall: boolean;
  /** Grab being held (index into GRAB_ACTIONS), or -1. */
  grab: number;
  /** Butter on the snow: 1 pressing the tips, -1 the tails, 0 neither; and how far into the press (0..1). */
  butter: number;
  butterAmount: number;
  /** Seconds since the last landing, and how deep (0..1) its absorb crouch is. */
  landTime: number;
  landDepth: number;
  /**
   * Last landing check (radians): body tilted nose up or down against the
   * snow (pitch), rolled onto an edge (roll), skis against the direction of
   * travel (side); and the speed into the snow (m/s).
   */
  landPitch: number;
  landRoll: number;
  landSide: number;
  landImpact: number;
  bailed: boolean;
  /** Seconds since the crash. */
  bailTime: number;
  bailReason: BailReason;
  /**
   * Rail or box being slid (index into the map's rails), or -1. While on
   * one, `grounded` is true and `normal` is the rail's up direction.
   */
  rail: number;
  /** Distance along the rail's top, and speed along it (negative going toward its start). */
  railS: number;
  railSpeed: number;
  /** Ski angle against the rail's direction (radians; 0 straight, ±π/2 sideways). */
  railAngle: number;
  /** In the air after leaving a rail or box; the landing then checks edges and sideways however short the drop. */
  railExit: boolean;
}

export function createSkierState(): SkierState {
  return {
    position: new Vector3(),
    velocity: new Vector3(),
    yaw: 0,
    yawRate: 0,
    grounded: true,
    airTime: 0,
    canPop: true,
    normal: new Vector3(0, 1, 0),
    crouch: 0,
    brake: 0,
    brakeSide: -1,
    lean: 0,
    poleCooldown: 0,
    poleTime: Infinity,
    poleDir: 1,
    polePhase: 1,
    press: 0,
    orient: new Quaternion(),
    center: new Vector3(),
    spin: new Vector3(),
    spinDriven: 0,
    airFrame: new Quaternion(),
    airHeading: 0,
    airPitch: 0,
    trick: new Quaternion(),
    airWall: false,
    grab: -1,
    butter: 0,
    butterAmount: 0,
    landTime: Infinity,
    landDepth: 0,
    landPitch: 0,
    landRoll: 0,
    landSide: 0,
    landImpact: 0,
    bailed: false,
    bailTime: 0,
    bailReason: '',
    rail: -1,
    railS: 0,
    railSpeed: 0,
    railAngle: 0,
    railExit: false,
  };
}

export function copySkierState(dst: SkierState, src: SkierState): void {
  dst.position.copy(src.position);
  dst.velocity.copy(src.velocity);
  dst.yaw = src.yaw;
  dst.yawRate = src.yawRate;
  dst.grounded = src.grounded;
  dst.airTime = src.airTime;
  dst.canPop = src.canPop;
  dst.normal.copy(src.normal);
  dst.crouch = src.crouch;
  dst.brake = src.brake;
  dst.brakeSide = src.brakeSide;
  dst.lean = src.lean;
  dst.poleCooldown = src.poleCooldown;
  dst.poleTime = src.poleTime;
  dst.poleDir = src.poleDir;
  dst.polePhase = src.polePhase;
  dst.press = src.press;
  dst.orient.copy(src.orient);
  dst.center.copy(src.center);
  dst.spin.copy(src.spin);
  dst.spinDriven = src.spinDriven;
  dst.airFrame.copy(src.airFrame);
  dst.airHeading = src.airHeading;
  dst.airPitch = src.airPitch;
  dst.trick.copy(src.trick);
  dst.airWall = src.airWall;
  dst.grab = src.grab;
  dst.butter = src.butter;
  dst.butterAmount = src.butterAmount;
  dst.landTime = src.landTime;
  dst.landDepth = src.landDepth;
  dst.landPitch = src.landPitch;
  dst.landRoll = src.landRoll;
  dst.landSide = src.landSide;
  dst.landImpact = src.landImpact;
  dst.bailed = src.bailed;
  dst.bailTime = src.bailTime;
  dst.bailReason = src.bailReason;
  dst.rail = src.rail;
  dst.railS = src.railS;
  dst.railSpeed = src.railSpeed;
  dst.railAngle = src.railAngle;
  dst.railExit = src.railExit;
}

/** Puts the skier at a spawn point, standing still on the snow. */
export function placeSkier(s: SkierState, spawn: SpawnDef, hf: Heightfield): void {
  placeSkierAt(s, spawn.x, spawn.z, (spawn.heading * Math.PI) / 180, hf);
}

/** Puts the skier on the snow at (x, z) facing `yaw` (radians), standing still in a fresh state. */
export function placeSkierAt(s: SkierState, x: number, z: number, yaw: number, hf: Heightfield): void {
  const fresh = createSkierState();
  copySkierState(s, fresh);
  s.position.set(x, 0, z);
  s.position.y = groundAt(hf, x, z, s.normal);
  s.yaw = wrapAngle(yaw);
  groundOrient(s);
  s.center.copy(s.position).addScaledVector(s.normal, TUNING.air.comHeight);
}

// Scratch vectors so stepping never allocates.
const forward = new Vector3();
const left = new Vector3();
const slopeGravity = new Vector3();
const contactNormal = new Vector3();
const bodyUp = new Vector3();
const bodyForward = new Vector3();
const tangent = new Vector3();
const skiSide = new Vector3();
const axis = new Vector3();
const head = new Vector3();
const railDir = new Vector3();
const frameUp = new Vector3();
const local = new Vector3();
const below = new Vector3();
const spot: RailSpot = { rail: -1, seg: 0, s: 0, top: 0, side: 0 };
const qTilt = new Quaternion();
const qTurn = new Quaternion();
const qPitch = new Quaternion();
const qStep = new Quaternion();
const qFrame = new Quaternion();
const UP = new Vector3(0, 1, 0);
const SIDE = new Vector3(1, 0, 0);
const DEG = Math.PI / 180;
/** A change of snow normal sharper than this (cosine of ~10°) in one step is a crease, not a curve. */
const CREASE_COS = Math.cos(10 * DEG);
/** Speed (m/s) away from the snow past a crease that leaves it. */
const CREASE_LEAVE = 0.5;
/** Body against a rail, from railFit: tilt off the rail's up, and the skis' angle against its direction. */
const fit = { tilt: 0, angle: 0 };

/** Advances the skier by one fixed step. */
export function stepSkier(s: SkierState, input: InputState, course: Course, dt: number): void {
  if (s.bailed) {
    stepBail(s, course, dt);
    return;
  }
  const c = TUNING.skier;
  s.poleCooldown = Math.max(0, s.poleCooldown - dt);
  s.poleTime += dt;
  s.polePhase = Math.min(1, s.poleTime / c.polePushInterval);
  s.landTime += dt;
  const steer = (input.left.held ? 1 : 0) - (input.right.held ? 1 : 0);

  // Pop: release the crouch on the snow or a rail (or just after leaving it).
  // Up a wall it drives up the wall, a little; pushing off along the snow's
  // normal there would throw the skier out across the pipe. Off a takeoff
  // steeper than a wall (an aerials kicker) it pushes straight up: the
  // normal there points back down the in-run.
  if (input.up.released && s.canPop && (s.grounded || s.airTime <= c.popCoyoteTime)) {
    // Out of a butter it's an ollie (off the tails) or a nollie (off the tips): a stronger pop.
    const pop = (c.popMin + (c.popMax - c.popMin) * s.crouch) * (1 + (c.butterPop - 1) * s.butterAmount);
    if (onWall(s, course.hf)) s.velocity.y += pop * TUNING.air.wallPop;
    else if (s.normal.y < Math.cos(TUNING.air.wallAngle * DEG)) s.velocity.y += pop;
    else s.velocity.addScaledVector(s.normal, pop);
    if (s.grounded) takeOff(s, steer, course.hf);
    s.canPop = false;
    s.crouch = 0;
  }
  // ↑ crouches while a pop is still possible; after that, in the air, it flips.
  const crouchTarget = input.up.held && s.canPop ? 1 : 0;
  s.crouch = approach(s.crouch, crouchTarget, dt / (crouchTarget > s.crouch ? c.crouchTime : c.standTime));

  if (s.rail >= 0) {
    endButter(s);
    slideRail(s, input, course, steer, dt);
    return;
  }
  if (s.grounded) updateButter(s, input, dt);
  else endButter(s);
  if (s.grounded) rideSnow(s, input, dt);
  else fly(s, input, steer, course.hf, dt);

  if (s.grounded) moveOnSnow(s, course, steer, dt);
  else moveInAir(s, course, dt);
}

/**
 * Sliding a rail or box: locked to its line, pulled along it by gravity and
 * slowed by friction, and by ↓, which drags the skis against it. ←/→ turn
 * the skis freely, to any angle. Leaves off either end, onto snow that rises
 * to meet the skis, or with a pop (see stepSkier).
 */
function slideRail(s: SkierState, input: InputState, course: Course, steer: number, dt: number): void {
  const c = TUNING.skier;
  const R = TUNING.rails;
  const rail = course.rails[s.rail]!;
  s.brake = approach(s.brake, input.down.held ? 1 : 0, dt / c.brakeRampTime);
  s.lean += (0 - s.lean) * (1 - Math.exp(-c.leanResponse * dt));

  // Free rotation: ←/→ turn the skis at any angle, and they stay where they're left.
  s.yawRate = approach(s.yawRate, steer * R.turnRate, R.turnAccel * dt); // carries into a spin off the rail
  s.railAngle = wrapAngle(s.railAngle + s.yawRate * dt);

  // Along the rail: gravity's pull down it, friction from the load on it and the brake, air drag.
  railFrame(rail, s.railS, s.position, railDir);
  const g = c.gravity;
  const load = g * Math.sqrt(Math.max(0, 1 - railDir.y * railDir.y));
  const friction = rail.kind === 'rail' && rail.metal ? R.railFriction : R.boxFriction;
  let v = s.railSpeed - g * railDir.y * dt;
  v = approach(v, 0, (friction * load + R.brakeDecel * s.brake) * dt);
  const drag = c.dragStand + (c.dragCrouch - c.dragStand) * s.crouch;
  v /= 1 + drag * Math.abs(v) * dt;
  s.railSpeed = v;
  s.railS += v * dt;

  const off = s.railS < 0 || s.railS > rail.length;
  railFrame(rail, s.railS, s.position, railDir);
  s.velocity.copy(railDir).multiplyScalar(v);
  if (off) {
    // Past an end: carry on from the end point.
    const over = s.railS < 0 ? s.railS : s.railS - rail.length;
    s.position.addScaledVector(railDir, over);
  }
  // The rail's up: world up, tipped to stay square to a sloping rail.
  s.normal.set(0, 1, 0).addScaledVector(railDir, -railDir.y).normalize();
  s.yaw = wrapAngle(Math.atan2(-railDir.x, -railDir.z) + s.railAngle);

  if (off) {
    takeOff(s, steer, course.hf);
    return;
  }
  const h = groundAt(course.hf, s.position.x, s.position.z, contactNormal);
  if (h >= s.position.y + R.sinkDepth) {
    // The snow came up over the rail: ride on it.
    s.position.y = h;
    s.rail = -1;
    s.normal.copy(contactNormal);
    s.yawRate = 0;
  }
  groundOrient(s);
  s.center.copy(s.position).addScaledVector(s.normal, TUNING.air.comHeight);
}

function rideSnow(s: SkierState, input: InputState, dt: number): void {
  const c = TUNING.skier;
  const n = s.normal;
  const g = c.gravity;
  const press = g * n.y; // how hard gravity presses the skis into the snow
  // What the edges grip with and friction works against: gravity's push plus
  // the snow's when it curves up under the skis.
  const load = press + s.press * c.curveLoad;
  // Riding switch, some skis grip and hold their edges less (switchGrip,
  // switchEdgeHold), fading in with the speed backwards along the skis.
  const backwards = s.velocity.x * Math.sin(s.yaw) + s.velocity.z * Math.cos(s.yaw);
  const sw = clamp(backwards / c.switchSpeed, 0, 1);
  const grip = c.grip * (1 + (c.switchGrip - 1) * sw);
  const edgeHold = c.edgeHold * (1 + (c.switchEdgeHold - 1) * sw);

  // Steering: the skis turn at a rate that drops with speed, and never faster
  // than the edges can carve (a held turn is a clean arc, not a skid).
  const steer = (input.left.held ? 1 : 0) - (input.right.held ? 1 : 0);
  const speed = s.velocity.length();
  const t = Math.min(1, speed / c.turnSpeedRef);
  const baseRate = c.turnRateSlow + (c.turnRateFast - c.turnRateSlow) * t;
  const maxRate = Math.min(baseRate, (grip * load) / Math.max(speed, 0.1));
  // In a butter the skis pivot on their tips or tails instead of carving.
  const b = s.butterAmount;
  const yawTarget = steer * (maxRate + (c.butterSpinRate - maxRate) * b);
  s.yawRate = approach(s.yawRate, yawTarget, (c.turnResponse + (c.butterSpinResponse - c.turnResponse) * b) * dt);
  s.yaw = wrapAngle(s.yaw + s.yawRate * dt);

  // Braking: pick the hockey-stop side when the brake starts.
  const braking = input.down.held;
  if (braking && s.brake === 0) s.brakeSide = steer !== 0 ? steer : s.lean > 0 ? 1 : -1;
  s.brake = approach(s.brake, braking ? 1 : 0, dt / c.brakeRampTime);

  // Ski frame on the snow: the heading turned in the world tilted to the
  // snow's normal (as groundOrient draws it), forward along the skis and
  // left across them. Up a halfpipe wall this keeps pointing where it did on
  // the floor, so heading across the pipe means heading up the wall.
  qTilt.setFromUnitVectors(UP, n);
  forward.set(-Math.sin(s.yaw), 0, -Math.cos(s.yaw)).applyQuaternion(qTilt);
  left.crossVectors(n, forward);
  slopeGravity.set(0, -g, 0).addScaledVector(n, press);

  let u = s.velocity.dot(forward); // along the skis (negative when riding switch)
  let w = s.velocity.dot(left); // sideways slip
  let vn = s.velocity.dot(n); // into or out of the snow

  u += slopeGravity.dot(forward) * dt;
  const sidePull = slopeGravity.dot(left);
  const overHold = Math.abs(sidePull) - edgeHold * load;
  if (overHold > 0) w += Math.sign(sidePull) * overHold * dt;

  // Pole push: each push is a stroke whose force swells and fades over
  // polePushTime (after the poles plant), so speed builds rather than jumps.
  // It only helps below poleMaxSpeed.
  if (input.pole.held && s.poleCooldown === 0 && s.brake < 0.5 && Math.abs(u) < c.poleMaxSpeed) {
    s.poleCooldown = c.polePushInterval;
    s.poleTime = 0;
    s.poleDir = u < -0.5 ? -1 : 1;
  }
  const stroke = (s.poleTime - c.polePlantTime) / c.polePushTime;
  if (stroke > 0 && stroke < 1) {
    const gain = Math.max(0, 1 - Math.abs(u) / c.poleMaxSpeed);
    const envelope = Math.sin(Math.PI * stroke) ** 2; // integrates to 1/2 over the stroke
    u += s.poleDir * ((2 * c.polePushSpeed) / c.polePushTime) * envelope * gain * dt;
  }

  // Carve or skid. Within the grip limit, sideways speed turns into speed
  // along the skis without loss. Past it, or at big slip angles, it scrapes away.
  const total = Math.hypot(u, w);
  if (total > 1e-4) {
    // Full grip up to half of carveSlipMax, fading to none at carveSlipMax.
    const slipAngle = Math.atan2(Math.abs(w), Math.abs(u));
    const carve = clamp((c.carveSlipMax - slipAngle) / (0.5 * c.carveSlipMax), 0, 1);
    const redirect = grip * (1 - (1 - c.butterGrip) * b) * load * carve * dt;
    if (redirect > 0) {
      const wNext = Math.abs(w) <= redirect ? 0 : w - Math.sign(w) * redirect;
      u = Math.sign(u) * Math.sqrt(Math.max(0, total * total - wNext * wNext));
      u = approach(u, 0, c.carveFriction * Math.abs(w - wNext));
      w = wNext;
    }
    w = approach(w, 0, c.skidFriction * (1 - (1 - c.butterSkid) * b) * load * (1 - carve) * dt);
  }

  // Friction and brake along the skis, then air drag on the whole speed.
  u = approach(u, 0, (c.skiFriction * load + c.brakeDecel * s.brake) * dt);
  const drag = c.dragStand + (c.dragCrouch - c.dragStand) * s.crouch;
  const slow = 1 / (1 + drag * Math.hypot(u, w) * dt);
  u *= slow;
  w *= slow;

  vn -= press * dt; // gravity keeps pressing the skis into the snow

  s.velocity.copy(forward).multiplyScalar(u).addScaledVector(left, w).addScaledVector(n, vn);

  // Lean into the turn by the angle that balances centripetal force and gravity.
  // A butter's pivot is no turn to lean into.
  const leanTarget = clamp(Math.atan2(s.yawRate * u, g), -c.leanMax, c.leanMax) * (1 - b);
  s.lean += (leanTarget - s.lean) * (1 - Math.exp(-c.leanResponse * dt));
}

function fly(s: SkierState, input: InputState, steer: number, hf: Heightfield, dt: number): void {
  const c = TUNING.skier;
  const a = TUNING.air;
  s.airTime += dt;
  s.brake = approach(s.brake, 0, dt / c.brakeRampTime);
  s.lean += (0 - s.lean) * (1 - Math.exp(-c.leanResponse * dt));
  if (s.airTime > c.popCoyoteTime) s.canPop = false;

  // Tricks: ↓ back flip, ↑ front flip (once it no longer means crouch),
  // ←/→ spin, Q/E Lincoln loop. Rotation lives in the body's own axes.
  const flip = (input.down.held ? 1 : 0) - (input.up.held && !s.canPop ? 1 : 0);
  const lincoln = (input.lincolnLeft.held ? 1 : 0) - (input.lincolnRight.held ? 1 : 0);
  s.spin.x = rotateAxis(s, 1, s.spin.x, flip, a.flipRate, dt);
  s.spin.y = rotateAxis(s, 2, s.spin.y, steer, a.spinRate, dt);
  s.spin.z = rotateAxis(s, 4, s.spin.z, lincoln, a.lincolnRate, dt);
  const rate = s.spin.length();
  if (rate > 1e-6) {
    axis.copy(s.spin).divideScalar(rate);
    s.trick.multiply(qStep.setFromAxisAngle(axis, rate * dt)).normalize();
  }

  // The skis follow the flight path like an arrow, once there's enough speed
  // to have one; riding switch, the tails lead. Off a jump their pitch
  // follows it. Up a wall, their heading follows it along the wall.
  local.copy(s.velocity).applyQuaternion(qFrame.copy(s.airFrame).invert());
  if (s.airWall) {
    const follow = smoothstep(a.pathSpeedMin, a.pathSpeedFull, Math.hypot(local.x, local.z));
    let target = Math.atan2(-local.x, -local.z);
    if (Math.cos(target - s.airHeading) < 0) target += Math.PI;
    const turn = wrapAngle(target - s.airHeading) * (1 - Math.exp(-a.pathAlign * follow * dt));
    s.airHeading = wrapAngle(s.airHeading + turn);
  } else {
    const along = -local.x * Math.sin(s.airHeading) - local.z * Math.cos(s.airHeading);
    const follow = smoothstep(a.pathSpeedMin, a.pathSpeedFull, Math.abs(along));
    const pathPitch = Math.sign(along) * Math.atan2(local.y, Math.abs(along));
    s.airPitch += (pathPitch - s.airPitch) * (1 - Math.exp(-a.pathAlign * follow * dt));
  }
  // Out over snow that isn't a wall, a wall air's frame tips toward that snow (see CONFIG.air.wallLevel).
  if (s.airWall && a.wallLevel > 0) {
    groundAt(hf, s.position.x, s.position.z, below);
    if (below.y > Math.cos(a.wallAngle * DEG)) s.airFrame.slerp(qFrame.setFromUnitVectors(UP, below), 1 - Math.exp(-a.wallLevel * dt));
  }
  airOrient(s);

  updateGrab(s, input);

  s.velocity.y -= c.gravity * dt;
  s.velocity.multiplyScalar(1 / (1 + c.dragAir * s.velocity.length() * dt));
}

/**
 * One rotation axis: a held key builds speed toward its rate. Once a key has
 * driven the axis, letting go slows it to a stop. Rotation carried off the
 * snow (a carve into the lip) keeps going until a key takes over.
 */
function rotateAxis(s: SkierState, bit: number, w: number, input: number, rate: number, dt: number): number {
  const a = TUNING.air;
  if (input !== 0) {
    s.spinDriven |= bit;
    return approach(w, input * rate, a.rotateAccel * dt);
  }
  return s.spinDriven & bit ? approach(w, 0, a.rotateStop * dt) : w;
}

/**
 * Butters on the snow: a nose grab key held presses onto the tips, a tail
 * grab key onto the tails (the newest pressed wins when both are held).
 * Changing ends lets the press out before pressing the other end.
 */
function updateButter(s: SkierState, input: InputState, dt: number): void {
  const nose = input.grabLeftNose.held || input.grabRightNose.held;
  const tail = input.grabLeftTail.held || input.grabRightTail.held;
  let want = nose ? 1 : tail ? -1 : 0;
  if (nose && tail) {
    if (input.grabLeftNose.pressed || input.grabRightNose.pressed) want = 1;
    else if (input.grabLeftTail.pressed || input.grabRightTail.pressed) want = -1;
    else want = s.butter !== 0 ? s.butter : 1;
  }
  if (want !== 0 && (s.butter === want || s.butterAmount === 0)) s.butter = want;
  const pressing = want !== 0 && s.butter === want;
  s.butterAmount = approach(s.butterAmount, pressing ? 1 : 0, dt / TUNING.skier.butterBlendTime);
  if (s.butterAmount === 0 && !pressing) s.butter = 0;
}

/** Off the snow (in the air, on a rail) there's no butter. */
function endButter(s: SkierState): void {
  s.butter = 0;
  s.butterAmount = 0;
}

/** The newest grab key pressed wins; letting it go falls back to another held grab. */
function updateGrab(s: SkierState, input: InputState): void {
  for (let i = 0; i < GRAB_ACTIONS.length; i++) {
    if (input[GRAB_ACTIONS[i]!].pressed) s.grab = i;
  }
  if (s.grab >= 0 && !input[GRAB_ACTIONS[s.grab]!].held) {
    s.grab = -1;
    for (let i = 0; i < GRAB_ACTIONS.length; i++) {
      if (input[GRAB_ACTIONS[i]!].held) s.grab = i;
    }
  }
}

/** Orientation on the snow: tilted to the slope, turned to the ski heading. */
function groundOrient(s: SkierState): void {
  qTilt.setFromUnitVectors(UP, s.normal);
  qTurn.setFromAxisAngle(UP, s.yaw);
  s.orient.multiplyQuaternions(qTilt, qTurn);
}

/** Orientation in the air: the flight's frame, the heading and flight-path pitch in it, then tricks. */
function airOrient(s: SkierState): void {
  qTurn.setFromAxisAngle(UP, s.airHeading);
  qPitch.setFromAxisAngle(SIDE, s.airPitch);
  s.orient.copy(s.airFrame).multiply(qTurn).multiply(qPitch).multiply(s.trick);
}

/**
 * On a wall: steeper than CONFIG.air.wallAngle (but not a jump's takeoff,
 * however steep), or up a halfpipe's transition, and not on a rail.
 */
function onWall(s: SkierState, hf: Heightfield): boolean {
  if (s.rail >= 0) return false;
  const p = s.position;
  return (s.normal.y < Math.cos(TUNING.air.wallAngle * DEG) && !onTakeoff(hf, p.x, p.z)) || onPipeWall(hf.shapes, p.x, p.z);
}

/** Leaves the snow, setting up the air orientation to carry on exactly from the snow. */
function takeOff(s: SkierState, steer: number, hf: Heightfield): void {
  const a = TUNING.air;
  const wall = onWall(s, hf);
  s.grounded = false;
  s.airTime = 0;
  s.railExit = s.rail >= 0;
  s.rail = -1;
  s.press = 0;
  groundOrient(s);

  // Up a wall (a halfpipe): launch straight up (no faster than
  // wallLaunchMax), drifting back in just enough to come down on the wall
  // again (in a pipe "in" is straight across it), and turn in the plane of
  // the snow left behind, measuring heading from the wall, not the horizon.
  const n = s.normal;
  const flat = Math.hypot(n.x, n.z);
  s.airWall = wall && s.velocity.y > 0 && flat > 1e-3;
  if (s.airWall) {
    if (pipeInward(hf.shapes, s.position.x, s.position.z, frameUp)) frameUp.y = 0;
    else frameUp.set(n.x / flat, 0, n.z / flat);
    s.velocity.y = Math.min(s.velocity.y, a.wallLaunchMax);
    const inward = clamp((a.wallDrift * TUNING.skier.gravity) / (2 * Math.max(s.velocity.y, 0.5)), 0.2, 3);
    s.velocity.addScaledVector(frameUp, inward - s.velocity.dot(frameUp));
    s.airFrame.setFromUnitVectors(UP, n);
  } else {
    s.airFrame.identity();
  }

  // The skis' heading and pitch in that frame; with no heading to speak of
  // (pointing straight up), keep the one on the snow.
  bodyForward.set(0, 0, -1).applyQuaternion(s.orient).applyQuaternion(qFrame.copy(s.airFrame).invert());
  s.airHeading = Math.hypot(bodyForward.x, bodyForward.z) > 1e-3 ? Math.atan2(-bodyForward.x, -bodyForward.z) : s.yaw;
  s.airPitch = Math.asin(clamp(bodyForward.y, -1, 1));
  // trick = (frame × heading × pitch)⁻¹ × orient, so the layers start out equal to the snow pose.
  qTurn.setFromAxisAngle(UP, s.airHeading);
  qPitch.setFromAxisAngle(SIDE, s.airPitch);
  s.trick.copy(s.airFrame).multiply(qTurn).multiply(qPitch).invert().multiply(s.orient);
  const carry = s.railExit ? TUNING.rails.spinCarry : a.spinCarry;
  s.spin.set(0, s.yawRate * carry + steer * a.spinPreload, 0);
  s.spinDriven = 0;
  s.grab = -1;
  s.center.copy(s.position).addScaledVector(s.normal, a.comHeight);
}

/** Moves the skier along the snow, or lets it fly where the snow falls away. */
function moveOnSnow(s: SkierState, course: Course, steer: number, dt: number): void {
  const c = TUNING.skier;
  const hf = course.hf;
  const p = s.position;
  p.addScaledVector(s.velocity, dt);
  keepInsideMap(s, hf);
  if (mountRail(s, course.rails)) return;
  if (bump(s, course)) return;

  const h = groundAt(hf, p.x, p.z, contactNormal);
  // Distance off the snow measured square to it: up a steep wall the
  // vertical gap is many times the real one.
  const gap = (p.y - h) * contactNormal.y;
  const smooth = 1 - Math.exp(-c.curveSmoothing * dt);
  if (contactNormal.dot(s.normal) < CREASE_COS && s.velocity.dot(contactNormal) > CREASE_LEAVE) {
    // Over a sharp crest (a lip, a pipe's coping) and moving away from the
    // snow beyond it: airborne, launching off the snow the skis just left.
    takeOff(s, steer, hf);
    return;
  }
  if (gap <= 0) {
    // On (or pushed into) the snow: sit on it and drop any motion into it.
    toSurface(hf, p);
    const into = s.velocity.dot(contactNormal);
    if (into < 0) s.velocity.addScaledVector(contactNormal, -into);
    // Snow curving up under the skis turned them harder than gravity alone
    // pushes: that extra is load for the edges and friction.
    const extra = clamp(Math.max(0, -into) / dt - c.gravity * contactNormal.y, 0, c.curveLoadMax);
    s.press += (extra - s.press) * smooth;
    s.normal.copy(contactNormal);
    s.airTime = 0;
    s.canPop = true;
  } else if (gap < c.groundTolerance) {
    // Skimming a few centimeters over a crest: still riding. Past a sharp
    // crease (a lip, a pipe's coping) keep the snow the skis just left, so
    // the takeoff launches off the lip, not the deck behind it.
    s.press -= s.press * smooth;
    if (contactNormal.dot(s.normal) > CREASE_COS) s.normal.copy(contactNormal);
  } else {
    // The snow fell away faster than gravity could follow: airborne.
    takeOff(s, steer, hf);
    return;
  }
  groundOrient(s);
  s.center.copy(p).addScaledVector(s.normal, TUNING.air.comHeight);
}

/** Flies the center of mass with the feet hanging below it along the body. Lands or crashes on contact. */
function moveInAir(s: SkierState, course: Course, dt: number): void {
  const a = TUNING.air;
  const hf = course.hf;
  const p = s.position;
  s.center.addScaledVector(s.velocity, dt);
  bodyUp.set(0, 1, 0).applyQuaternion(s.orient);
  p.copy(s.center).addScaledVector(bodyUp, -a.comHeight);
  keepInsideMap(s, hf);
  if (catchRail(s, course.rails)) return;
  if (bump(s, course)) return;
  s.center.copy(p).addScaledVector(bodyUp, a.comHeight);

  const h = groundAt(hf, p.x, p.z, contactNormal);
  if (p.y <= h) {
    toSurface(hf, p);
    land(s);
    return;
  }
  head.copy(p).addScaledVector(bodyUp, a.headHeight);
  if (head.y <= heightAt(hf, head.x, head.z)) {
    // Head first into the snow: crash where the body is (or, with no
    // crashes, land there).
    p.x = s.center.x;
    p.z = s.center.z;
    p.y = groundAt(hf, p.x, p.z, contactNormal);
    if (CHEATS.noCrashes) {
      land(s);
      return;
    }
    s.landPitch = Math.acos(clamp(bodyUp.dot(contactNormal), -1, 1));
    s.landRoll = 0;
    s.landSide = 0;
    s.landImpact = Math.max(0, -s.velocity.dot(contactNormal));
    crash(s, 'head');
  }
}

/**
 * In the air: if the skis are coming down onto a rail or box, lock on when
 * they're lined up straight or sideways and the body is upright; otherwise
 * slip off to the side. Returns true when locked on (or crashed onto it).
 */
function catchRail(s: SkierState, rails: readonly RailShape[]): boolean {
  const R = TUNING.rails;
  const p = s.position;
  if (!railUnder(rails, p.x, p.z, R.snapDistance, spot)) return false;
  if (p.y > spot.top || p.y < spot.top - R.catchDepth) return false;
  const rail = rails[spot.rail]!;
  const n = railSpot(rail);
  const into = -s.velocity.dot(n);
  if (into <= 0) return false; // still rising past it

  // Body upright on the rail, skis straight or sideways along it.
  const railYaw = Math.atan2(-railDir.x, -railDir.z);
  const off = railFit(s, n, railYaw);
  s.landPitch = fit.tilt;
  s.landRoll = 0;
  s.landSide = off;
  s.landImpact = into;
  if (fit.tilt > R.tiltMax || off > R.angleMax) {
    slipOff(s, rail.halfWidth, railYaw);
    return false;
  }

  p.copy(head);
  s.normal.copy(n);
  if (into > TUNING.landing.impactMax && !CHEATS.noCrashes) {
    crash(s, 'impact');
    return true;
  }
  lockOn(s, railYaw, into);
  return true;
}

/**
 * On the snow, riding onto a rail or box whose top is at the snow (a ride-on
 * feature): locks on when travelling along it with the skis lined up
 * straight or sideways, as when landing on one.
 */
function mountRail(s: SkierState, rails: readonly RailShape[]): boolean {
  const R = TUNING.rails;
  const p = s.position;
  if (!railUnder(rails, p.x, p.z, R.snapDistance, spot)) return false;
  if (spot.top > p.y + R.stepTolerance || spot.top < p.y - R.sinkDepth) return false;
  const n = railSpot(rails[spot.rail]!);
  const speed = s.velocity.length();
  if (speed < 0.5 || Math.abs(s.velocity.dot(railDir)) < R.mountAlign * speed) return false;
  const railYaw = Math.atan2(-railDir.x, -railDir.z);
  if (railFit(s, n, railYaw) > R.angleMax || fit.tilt > R.tiltMax) return false;
  p.copy(head);
  s.normal.copy(n);
  lockOn(s, railYaw, 0);
  return true;
}

/** Loads the point on a rail's top at `spot` into `head` and its direction into `railDir`; returns the rail's up. */
function railSpot(rail: RailShape): Vector3 {
  railFrame(rail, spot.s, head, railDir);
  // World up, tipped to stay square to a sloping rail.
  return contactNormal.set(0, 1, 0).addScaledVector(railDir, -railDir.y).normalize();
}

/**
 * How the body sits against a rail with up `n`: sets fit.tilt (body away from
 * upright) and fit.angle (skis against the rail's direction), and returns how
 * far the skis are from straight or sideways (radians).
 */
function railFit(s: SkierState, n: Vector3, railYaw: number): number {
  bodyUp.set(0, 1, 0).applyQuaternion(s.orient);
  bodyForward.set(0, 0, -1).applyQuaternion(s.orient);
  bodyForward.addScaledVector(n, -bodyForward.dot(n));
  fit.tilt = Math.acos(clamp(bodyUp.dot(n), -1, 1));
  if (bodyForward.lengthSq() < 0.04) fit.tilt = Math.PI; // skis pointing at the rail: no way on
  fit.angle = wrapAngle(Math.atan2(-bodyForward.x, -bodyForward.z) - railYaw);
  return Math.abs(fit.angle - Math.round(fit.angle / (Math.PI / 2)) * (Math.PI / 2));
}

/** Locks onto the rail at `spot` (feet already on it, normal set), keeping the skis' angle from railFit. */
function lockOn(s: SkierState, railYaw: number, into: number): void {
  s.rail = spot.rail;
  s.railExit = false;
  s.railS = spot.s;
  s.railSpeed = s.velocity.dot(railDir);
  s.railAngle = fit.angle;
  s.velocity.copy(railDir).multiplyScalar(s.railSpeed);
  s.yaw = wrapAngle(railYaw + fit.angle);
  s.yawRate = 0;
  s.grounded = true;
  s.airTime = 0;
  s.canPop = true;
  s.grab = -1;
  s.spin.set(0, 0, 0);
  s.spinDriven = 0;
  s.press = 0;
  if (into > 0) {
    s.landTime = 0;
    s.landDepth = clamp((into - 1) / (TUNING.landing.squashImpact - 1), 0, 1);
  }
  groundOrient(s);
  s.center.copy(s.position).addScaledVector(s.normal, TUNING.air.comHeight);
}

/** Misses the rail: moves clear of it to the side the skier came down on, drifting away. */
function slipOff(s: SkierState, halfWidth: number, railYaw: number): void {
  const R = TUNING.rails;
  const sign = spot.side < 0 ? -1 : 1;
  // Right of the rail's direction, seen from above.
  const rx = Math.cos(railYaw) * sign;
  const rz = -Math.sin(railYaw) * sign;
  const shift = halfWidth + R.snapDistance + 0.02 - Math.abs(spot.side);
  s.position.x += rx * shift;
  s.position.z += rz * shift;
  const out = s.velocity.x * rx + s.velocity.z * rz;
  if (out < R.slipSpeed) {
    s.velocity.x += rx * (R.slipSpeed - out);
    s.velocity.z += rz * (R.slipSpeed - out);
  }
}

/** Keeps the skier out of rails, boxes and obstacles. Returns true if it hit one hard enough to crash. */
function bump(s: SkierState, course: Course): boolean {
  const hit = Math.max(
    collideRails(course.rails, s.position, s.velocity),
    collideObstacles(course.obstacles, s.position, s.velocity),
  );
  if (hit < TUNING.rails.crashSpeed || CHEATS.noCrashes) return false;
  const p = s.position;
  const h = groundAt(course.hf, p.x, p.z, contactNormal);
  if (s.grounded) p.y = h;
  s.landPitch = 0;
  s.landRoll = 0;
  s.landSide = 0;
  s.landImpact = hit;
  crash(s, 'obstacle');
  return true;
}

/** The skis touch down: ride away if the body is close to the snow's angle, otherwise crash. */
function land(s: SkierState): void {
  const L = TUNING.landing;
  const n = contactNormal;
  bodyUp.set(0, 1, 0).applyQuaternion(s.orient);
  bodyForward.set(0, 0, -1).applyQuaternion(s.orient);

  const vn = s.velocity.dot(n);
  const impact = Math.max(0, -vn);
  // The skis' direction along the snow, and across it.
  bodyForward.addScaledVector(n, -bodyForward.dot(n));
  let skiLen = bodyForward.length();
  if (skiLen > 1e-3) bodyForward.divideScalar(skiLen);
  skiSide.crossVectors(n, bodyForward);
  // Body up against the snow normal: tipped nose up or down, and rolled onto
  // an edge. Past 90° (upside down) both read as more than 90°.
  const upN = bodyUp.dot(n);
  const pitch = skiLen > 1e-3 ? Math.atan2(Math.abs(bodyUp.dot(bodyForward)), upN) : Math.PI / 2;
  const roll = Math.atan2(Math.abs(bodyUp.dot(skiSide)), upN);
  // Skis against the direction of travel along the snow; switch counts as lined up.
  tangent.copy(s.velocity).addScaledVector(n, -vn);
  const speed = tangent.length();
  let side = 0;
  if (speed > L.sideSpeed && skiLen > 1e-3) {
    side = Math.acos(clamp(Math.abs(bodyForward.dot(tangent)) / speed, 0, 1));
  }
  s.landPitch = pitch;
  s.landRoll = roll;
  s.landSide = side;
  s.landImpact = impact;

  // Short hops (skidding over a bump) never catch an edge or land sideways,
  // but dropping off a rail still has to land lined up.
  const edgeChecks = s.airTime >= L.edgeCheckAir || s.railExit;
  s.railExit = false;
  s.normal.copy(n);
  const reason: BailReason =
    pitch > L.pitchMax || upN <= 0
      ? 'pitch'
      : edgeChecks && roll > L.rollMax
        ? 'edge'
        : edgeChecks && side > L.sideMax
          ? 'sideways'
          : impact > L.impactMax
            ? 'impact'
            : '';
  if (reason !== '') {
    if (!CHEATS.noCrashes) {
      crash(s, reason);
      return;
    }
    // No crashes: upright on the snow with the skis along the travel (or
    // switch, if they were closer to that), and ride on without the spin.
    if (speed > 0.5) {
      const dir = skiLen > 1e-3 && bodyForward.dot(tangent) < 0 ? -1 : 1;
      bodyForward.copy(tangent).multiplyScalar(dir / speed);
      skiLen = 1;
    }
    s.spin.set(0, 0, 0);
  }

  // Clean: the snow takes the speed into it, the skis take the heading, and
  // spin carries into the turn up to what the skis can turn on snow. A hard
  // landing (casing a deck, short on a knuckle) also costs speed.
  if (vn < 0) s.velocity.addScaledVector(n, -vn);
  if (impact > L.roughImpact) {
    s.velocity.multiplyScalar(1 - Math.min(L.roughLossMax, (impact - L.roughImpact) * L.roughLoss));
  }
  if (skiLen > 1e-3) {
    // Heading in the snow's own frame (see rideSnow): undo the tilt to its normal.
    local.copy(bodyForward).applyQuaternion(qTilt.setFromUnitVectors(UP, n).invert());
    s.yaw = Math.atan2(-local.x, -local.z);
  }
  axis.copy(s.spin).applyQuaternion(s.orient);
  const maxRate = TUNING.skier.turnRateSlow;
  s.yawRate = clamp(axis.dot(n), -maxRate, maxRate);
  s.grounded = true;
  s.airTime = 0;
  s.canPop = true;
  s.grab = -1;
  s.spin.set(0, 0, 0);
  s.spinDriven = 0;
  s.press = 0;
  s.landTime = 0;
  s.landDepth = clamp((impact - 1) / (L.squashImpact - 1), 0, 1);
  groundOrient(s);
  s.center.copy(s.position).addScaledVector(n, TUNING.air.comHeight);
}

/** Starts the crash tumble from wherever the body is, on the snow at contactNormal. */
function crash(s: SkierState, reason: BailReason): void {
  const b = TUNING.bail;
  const n = contactNormal;
  s.bailed = true;
  s.bailTime = 0;
  s.bailReason = reason;
  s.grounded = true;
  s.normal.copy(n);
  const vn = s.velocity.dot(n);
  if (vn < 0) s.velocity.addScaledVector(n, -vn);
  s.velocity.multiplyScalar(1 - b.impactLoss);
  s.grab = -1;
  s.crouch = 0;
  s.brake = 0;
  s.lean = 0;
  s.yawRate = 0;
  s.canPop = false;
  s.poleTime = Infinity;
  s.polePhase = 1;
  s.rail = -1;
  s.railExit = false;
  s.press = 0;
  s.center.copy(s.position).addScaledVector(n, b.centerHeight);
}

/** Crash: the body rolls and slides to a stop. The game decides when to respawn. */
function stepBail(s: SkierState, course: Course, dt: number): void {
  const b = TUNING.bail;
  const g = TUNING.skier.gravity;
  const hf = course.hf;
  const v = s.velocity;
  s.bailTime += dt;

  if (s.grounded) {
    const n = s.normal;
    const load = g * n.y;
    slopeGravity.set(0, -g, 0).addScaledVector(n, load);
    v.addScaledVector(slopeGravity, dt);
    const vn = v.dot(n);
    tangent.copy(v).addScaledVector(n, -vn);
    const speed = tangent.length();
    let slowed = Math.max(0, speed - b.friction * load * dt);
    slowed /= 1 + TUNING.skier.dragStand * slowed * dt;
    tangent.multiplyScalar(speed > 1e-6 ? slowed / speed : 0);
    v.copy(tangent).addScaledVector(n, Math.min(vn, 0) - load * dt);
    // Roll along the snow like a ball: ω = n × v / r.
    s.spin.crossVectors(n, tangent).multiplyScalar(b.tumbleScale / b.rollRadius);
  } else {
    v.y -= g * dt;
  }

  const rate = s.spin.length();
  if (rate > 1e-6) {
    axis.copy(s.spin).divideScalar(rate);
    s.orient.premultiply(qStep.setFromAxisAngle(axis, rate * dt)).normalize();
  }

  const p = s.position;
  p.addScaledVector(v, dt);
  keepInsideMap(s, hf);
  collideRails(course.rails, p, v);
  collideObstacles(course.obstacles, p, v);
  const h = groundAt(hf, p.x, p.z, contactNormal);
  const gap = p.y - h;
  // A tumbling body sticks over small bumps but can still fly off a lip.
  if (gap <= 0 || (s.grounded && gap < 0.25)) {
    p.y = h;
    const into = v.dot(contactNormal);
    if (into < 0) v.addScaledVector(contactNormal, -into);
    s.normal.copy(contactNormal);
    s.grounded = true;
  } else {
    s.grounded = false;
  }
  s.center.copy(p).addScaledVector(s.grounded ? s.normal : UP, b.centerHeight);
}

/**
 * Puts a point that's into the snow back on it: out along the normal (which
 * up a steep wall is nearly sideways), then exactly onto the surface. Leaves
 * the snow's normal there in `contactNormal`.
 */
function toSurface(hf: Heightfield, p: Vector3): void {
  const gap = (p.y - groundAt(hf, p.x, p.z, contactNormal)) * contactNormal.y;
  if (gap < 0) p.addScaledVector(contactNormal, -gap);
  p.y = groundAt(hf, p.x, p.z, contactNormal);
}

/** Keeps the skier inside the play area. */
function keepInsideMap(s: SkierState, hf: Heightfield): void {
  keepInside(hf.bounds, s.position, s.velocity);
}

function approach(value: number, target: number, maxDelta: number): number {
  if (value < target) return Math.min(value + maxDelta, target);
  return Math.max(value - maxDelta, target);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function wrapAngle(a: number): number {
  return a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));
}
