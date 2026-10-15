import { Quaternion, Vector3 } from 'three';
import { CONFIG } from '../config.ts';
import { GRAB_ACTIONS, type InputState } from '../core/input.ts';
import type { Heightfield, SpawnDef } from '../maps/types.ts';
import { groundAt, heightAt } from './terrain.ts';

// Skier physics. On the snow, velocity is split into the part along the skis
// (gravity, friction, drag) and the part across them, which the edges either
// carve into forward motion (up to a grip limit) or scrape away as a skid.
// The skier leaves the snow on its own wherever the slope falls away faster
// than gravity can follow.
//
// In the air the center of mass flies ballistically and the body turns
// around it. Orientation is built in three layers:
//   heading at takeoff  ×  pitch that follows the flight path  ×  tricks
// Tricks are the rotation from held keys, in the body's own axes: spin about
// its up axis, flips about its side-to-side axis, Lincoln loops about its
// front-to-back axis. Holding two at once rotates about a tilted axis, which
// is what makes corks and misty flips.
//
// Landing checks the body against the snow; too far off and the skier
// crashes: a cheap tumble that rolls and slides to a stop.

/** Why the last landing was a crash ('' if it was clean). */
export type BailReason = '' | 'pitch' | 'edge' | 'sideways' | 'impact' | 'head';

export interface SkierState {
  /** Feet position on the snow. */
  position: Vector3;
  velocity: Vector3;
  /** Ski heading in radians: 0 faces -Z (downhill), positive turns left. */
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
  /** Air: heading at takeoff, the skis' flight-path pitch (nose up +), and the trick rotation on top. */
  airHeading: number;
  airPitch: number;
  trick: Quaternion;
  /** Grab being held (index into GRAB_ACTIONS), or -1. */
  grab: number;
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
    orient: new Quaternion(),
    center: new Vector3(),
    spin: new Vector3(),
    spinDriven: 0,
    airHeading: 0,
    airPitch: 0,
    trick: new Quaternion(),
    grab: -1,
    landTime: Infinity,
    landDepth: 0,
    landPitch: 0,
    landRoll: 0,
    landSide: 0,
    landImpact: 0,
    bailed: false,
    bailTime: 0,
    bailReason: '',
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
  dst.orient.copy(src.orient);
  dst.center.copy(src.center);
  dst.spin.copy(src.spin);
  dst.spinDriven = src.spinDriven;
  dst.airHeading = src.airHeading;
  dst.airPitch = src.airPitch;
  dst.trick.copy(src.trick);
  dst.grab = src.grab;
  dst.landTime = src.landTime;
  dst.landDepth = src.landDepth;
  dst.landPitch = src.landPitch;
  dst.landRoll = src.landRoll;
  dst.landSide = src.landSide;
  dst.landImpact = src.landImpact;
  dst.bailed = src.bailed;
  dst.bailTime = src.bailTime;
  dst.bailReason = src.bailReason;
}

/** Puts the skier at a spawn point, standing still on the snow. */
export function placeSkier(s: SkierState, spawn: SpawnDef, hf: Heightfield): void {
  const fresh = createSkierState();
  copySkierState(s, fresh);
  s.position.set(spawn.x, 0, spawn.z);
  s.position.y = groundAt(hf, spawn.x, spawn.z, s.normal);
  s.yaw = (spawn.heading * Math.PI) / 180;
  groundOrient(s);
  s.center.copy(s.position).addScaledVector(s.normal, CONFIG.air.comHeight);
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
const qTilt = new Quaternion();
const qTurn = new Quaternion();
const qPitch = new Quaternion();
const qStep = new Quaternion();
const UP = new Vector3(0, 1, 0);
const SIDE = new Vector3(1, 0, 0);

/** Advances the skier by one fixed step. */
export function stepSkier(s: SkierState, input: InputState, hf: Heightfield, dt: number): void {
  if (s.bailed) {
    stepBail(s, hf, dt);
    return;
  }
  const c = CONFIG.skier;
  s.poleCooldown = Math.max(0, s.poleCooldown - dt);
  s.poleTime += dt;
  s.polePhase = Math.min(1, s.poleTime / c.polePushInterval);
  s.landTime += dt;
  const steer = (input.left.held ? 1 : 0) - (input.right.held ? 1 : 0);

  // Pop: release the crouch on the snow (or just after leaving it).
  if (input.up.released && s.canPop && (s.grounded || s.airTime <= c.popCoyoteTime)) {
    s.velocity.addScaledVector(s.normal, c.popMin + (c.popMax - c.popMin) * s.crouch);
    if (s.grounded) takeOff(s, steer);
    s.canPop = false;
    s.crouch = 0;
  }
  // ↑ crouches while a pop is still possible; after that, in the air, it flips.
  const crouchTarget = input.up.held && s.canPop ? 1 : 0;
  s.crouch = approach(s.crouch, crouchTarget, dt / (crouchTarget > s.crouch ? c.crouchTime : c.standTime));

  if (s.grounded) rideSnow(s, input, dt);
  else fly(s, input, steer, dt);

  if (s.grounded) moveOnSnow(s, hf, steer, dt);
  else moveInAir(s, hf, dt);
}

function rideSnow(s: SkierState, input: InputState, dt: number): void {
  const c = CONFIG.skier;
  const n = s.normal;
  const g = c.gravity;
  const load = g * n.y; // how hard gravity presses the skis into the snow

  // Steering: the skis turn at a rate that drops with speed, and never faster
  // than the edges can carve (a held turn is a clean arc, not a skid).
  const steer = (input.left.held ? 1 : 0) - (input.right.held ? 1 : 0);
  const speed = s.velocity.length();
  const t = Math.min(1, speed / c.turnSpeedRef);
  const baseRate = c.turnRateSlow + (c.turnRateFast - c.turnRateSlow) * t;
  const maxRate = Math.min(baseRate, (c.grip * load) / Math.max(speed, 0.1));
  s.yawRate = approach(s.yawRate, steer * maxRate, c.turnResponse * dt);
  s.yaw = wrapAngle(s.yaw + s.yawRate * dt);

  // Braking: pick the hockey-stop side when the brake starts.
  const braking = input.down.held;
  if (braking && s.brake === 0) s.brakeSide = steer !== 0 ? steer : s.lean > 0 ? 1 : -1;
  s.brake = approach(s.brake, braking ? 1 : 0, dt / c.brakeRampTime);

  // Ski frame on the snow: forward along the skis, left across them.
  forward.set(-Math.sin(s.yaw), 0, -Math.cos(s.yaw));
  forward.addScaledVector(n, -forward.dot(n)).normalize();
  left.crossVectors(n, forward);
  slopeGravity.set(0, -g, 0).addScaledVector(n, load);

  let u = s.velocity.dot(forward); // along the skis (negative when riding switch)
  let w = s.velocity.dot(left); // sideways slip
  let vn = s.velocity.dot(n); // into or out of the snow

  u += slopeGravity.dot(forward) * dt;
  const sidePull = slopeGravity.dot(left);
  const overHold = Math.abs(sidePull) - c.edgeHold * load;
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
    const redirect = c.grip * load * carve * dt;
    if (redirect > 0) {
      const wNext = Math.abs(w) <= redirect ? 0 : w - Math.sign(w) * redirect;
      u = Math.sign(u) * Math.sqrt(Math.max(0, total * total - wNext * wNext));
      u = approach(u, 0, c.carveFriction * Math.abs(w - wNext));
      w = wNext;
    }
    w = approach(w, 0, c.skidFriction * load * (1 - carve) * dt);
  }

  // Friction and brake along the skis, then air drag on the whole speed.
  u = approach(u, 0, (c.skiFriction * load + c.brakeDecel * s.brake) * dt);
  const drag = c.dragStand + (c.dragCrouch - c.dragStand) * s.crouch;
  const slow = 1 / (1 + drag * Math.hypot(u, w) * dt);
  u *= slow;
  w *= slow;

  vn -= load * dt; // gravity keeps pressing the skis into the snow

  s.velocity.copy(forward).multiplyScalar(u).addScaledVector(left, w).addScaledVector(n, vn);

  // Lean into the turn by the angle that balances centripetal force and gravity.
  const leanTarget = clamp(Math.atan2(s.yawRate * u, g), -c.leanMax, c.leanMax);
  s.lean += (leanTarget - s.lean) * (1 - Math.exp(-c.leanResponse * dt));
}

function fly(s: SkierState, input: InputState, steer: number, dt: number): void {
  const c = CONFIG.skier;
  const a = CONFIG.air;
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

  // The skis' pitch eases toward the flight path, once there's enough speed
  // along them to have one. Riding switch, the tails lead.
  const along = -s.velocity.x * Math.sin(s.airHeading) - s.velocity.z * Math.cos(s.airHeading);
  const follow = smoothstep(a.pathSpeedMin, a.pathSpeedFull, Math.abs(along));
  const pathPitch = Math.sign(along) * Math.atan2(s.velocity.y, Math.abs(along));
  s.airPitch += (pathPitch - s.airPitch) * (1 - Math.exp(-a.pathAlign * follow * dt));
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
  const a = CONFIG.air;
  if (input !== 0) {
    s.spinDriven |= bit;
    return approach(w, input * rate, a.rotateAccel * dt);
  }
  return s.spinDriven & bit ? approach(w, 0, a.rotateStop * dt) : w;
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

/** Orientation in the air: takeoff heading, then flight-path pitch, then tricks. */
function airOrient(s: SkierState): void {
  qTurn.setFromAxisAngle(UP, s.airHeading);
  qPitch.setFromAxisAngle(SIDE, s.airPitch);
  s.orient.multiplyQuaternions(qTurn, qPitch).multiply(s.trick);
}

/** Leaves the snow, setting up the air orientation to carry on exactly from the snow. */
function takeOff(s: SkierState, steer: number): void {
  const a = CONFIG.air;
  s.grounded = false;
  s.airTime = 0;
  groundOrient(s);
  s.airHeading = s.yaw;
  bodyForward.set(0, 0, -1).applyQuaternion(s.orient);
  s.airPitch = Math.asin(clamp(bodyForward.y, -1, 1));
  // trick = (heading × pitch)⁻¹ × orient, so the three layers start out equal to the snow pose.
  qTurn.setFromAxisAngle(UP, s.airHeading);
  qPitch.setFromAxisAngle(SIDE, s.airPitch);
  s.trick.multiplyQuaternions(qTurn, qPitch).invert().multiply(s.orient);
  s.spin.set(0, s.yawRate * a.spinCarry + steer * a.spinPreload, 0);
  s.spinDriven = 0;
  s.grab = -1;
  s.center.copy(s.position).addScaledVector(s.normal, a.comHeight);
}

/** Moves the skier along the snow, or lets it fly where the snow falls away. */
function moveOnSnow(s: SkierState, hf: Heightfield, steer: number, dt: number): void {
  const p = s.position;
  p.addScaledVector(s.velocity, dt);
  keepInsideMap(s, hf);

  const h = groundAt(hf, p.x, p.z, contactNormal);
  const gap = p.y - h;
  if (gap <= 0) {
    // On (or pushed into) the snow: sit on it and drop any motion into it.
    p.y = h;
    const into = s.velocity.dot(contactNormal);
    if (into < 0) s.velocity.addScaledVector(contactNormal, -into);
    s.normal.copy(contactNormal);
    s.airTime = 0;
    s.canPop = true;
  } else if (gap < CONFIG.skier.groundTolerance) {
    // Skimming a few centimeters over a crest: still riding.
    s.normal.copy(contactNormal);
  } else {
    // The snow fell away faster than gravity could follow: airborne.
    takeOff(s, steer);
    return;
  }
  groundOrient(s);
  s.center.copy(p).addScaledVector(s.normal, CONFIG.air.comHeight);
}

/** Flies the center of mass with the feet hanging below it along the body. Lands or crashes on contact. */
function moveInAir(s: SkierState, hf: Heightfield, dt: number): void {
  const a = CONFIG.air;
  const p = s.position;
  s.center.addScaledVector(s.velocity, dt);
  bodyUp.set(0, 1, 0).applyQuaternion(s.orient);
  p.copy(s.center).addScaledVector(bodyUp, -a.comHeight);
  keepInsideMap(s, hf);
  s.center.copy(p).addScaledVector(bodyUp, a.comHeight);

  const h = groundAt(hf, p.x, p.z, contactNormal);
  if (p.y <= h) {
    p.y = h;
    land(s);
    return;
  }
  head.copy(p).addScaledVector(bodyUp, a.headHeight);
  if (head.y <= heightAt(hf, head.x, head.z)) {
    // Head first into the snow: crash where the body is.
    p.x = s.center.x;
    p.z = s.center.z;
    p.y = groundAt(hf, p.x, p.z, contactNormal);
    s.landPitch = Math.acos(clamp(bodyUp.dot(contactNormal), -1, 1));
    s.landRoll = 0;
    s.landSide = 0;
    s.landImpact = Math.max(0, -s.velocity.dot(contactNormal));
    crash(s, 'head');
  }
}

/** The skis touch down: ride away if the body is close to the snow's angle, otherwise crash. */
function land(s: SkierState): void {
  const L = CONFIG.landing;
  const n = contactNormal;
  bodyUp.set(0, 1, 0).applyQuaternion(s.orient);
  bodyForward.set(0, 0, -1).applyQuaternion(s.orient);

  const vn = s.velocity.dot(n);
  const impact = Math.max(0, -vn);
  // The skis' direction along the snow, and across it.
  bodyForward.addScaledVector(n, -bodyForward.dot(n));
  const skiLen = bodyForward.length();
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

  // Short hops (skidding over a bump) never catch an edge or land sideways.
  const edgeChecks = s.airTime >= L.edgeCheckAir;
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
    crash(s, reason);
    return;
  }

  // Clean: the snow takes the speed into it, the skis take the heading, and
  // spin carries into the turn up to what the skis can turn on snow.
  if (vn < 0) s.velocity.addScaledVector(n, -vn);
  if (skiLen > 1e-3) s.yaw = Math.atan2(-bodyForward.x, -bodyForward.z);
  axis.copy(s.spin).applyQuaternion(s.orient);
  const maxRate = CONFIG.skier.turnRateSlow;
  s.yawRate = clamp(axis.dot(n), -maxRate, maxRate);
  s.grounded = true;
  s.airTime = 0;
  s.canPop = true;
  s.grab = -1;
  s.spin.set(0, 0, 0);
  s.spinDriven = 0;
  s.landTime = 0;
  s.landDepth = clamp((impact - 1) / (L.squashImpact - 1), 0, 1);
  groundOrient(s);
  s.center.copy(s.position).addScaledVector(n, CONFIG.air.comHeight);
}

/** Starts the crash tumble from wherever the body is, on the snow at contactNormal. */
function crash(s: SkierState, reason: BailReason): void {
  const b = CONFIG.bail;
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
  s.center.copy(s.position).addScaledVector(n, b.centerHeight);
}

/** Crash: the body rolls and slides to a stop. The game decides when to respawn. */
function stepBail(s: SkierState, hf: Heightfield, dt: number): void {
  const b = CONFIG.bail;
  const g = CONFIG.skier.gravity;
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
    slowed /= 1 + CONFIG.skier.dragStand * slowed * dt;
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

function keepInsideMap(s: SkierState, hf: Heightfield): void {
  const margin = 1;
  const minX = hf.originX + margin;
  const maxX = hf.originX + (hf.cols - 1) * hf.cellSize - margin;
  const minZ = hf.originZ + margin;
  const maxZ = hf.originZ + (hf.rows - 1) * hf.cellSize - margin;
  const p = s.position;
  const v = s.velocity;
  if (p.x < minX) {
    p.x = minX;
    if (v.x < 0) v.x = 0;
  } else if (p.x > maxX) {
    p.x = maxX;
    if (v.x > 0) v.x = 0;
  }
  if (p.z < minZ) {
    p.z = minZ;
    if (v.z < 0) v.z = 0;
  } else if (p.z > maxZ) {
    p.z = maxZ;
    if (v.z > 0) v.z = 0;
  }
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
