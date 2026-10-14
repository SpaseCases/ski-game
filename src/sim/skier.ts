import { Vector3 } from 'three';
import { CONFIG } from '../config.ts';
import type { InputState } from '../core/input.ts';
import type { Heightfield, SpawnDef } from '../maps/types.ts';
import { groundAt } from './terrain.ts';

// Skier physics. On the snow, velocity is split into the part along the skis
// (gravity, friction, drag) and the part across them, which the edges either
// carve into forward motion (up to a grip limit) or scrape away as a skid.
// In the air it's plain ballistics. The skier leaves the snow on its own
// wherever the slope falls away faster than gravity can follow.

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
}

/** Puts the skier at a spawn point, standing still on the snow. */
export function placeSkier(s: SkierState, spawn: SpawnDef, hf: Heightfield): void {
  const fresh = createSkierState();
  copySkierState(s, fresh);
  s.position.set(spawn.x, 0, spawn.z);
  s.position.y = groundAt(hf, spawn.x, spawn.z, s.normal);
  s.yaw = (spawn.heading * Math.PI) / 180;
}

// Scratch vectors so stepping never allocates.
const forward = new Vector3();
const left = new Vector3();
const slopeGravity = new Vector3();
const contactNormal = new Vector3();

/** Advances the skier by one fixed step. */
export function stepSkier(s: SkierState, input: InputState, hf: Heightfield, dt: number): void {
  const c = CONFIG.skier;
  s.poleCooldown = Math.max(0, s.poleCooldown - dt);
  s.poleTime += dt;
  s.polePhase = Math.min(1, s.poleTime / c.polePushInterval);

  // Pop: release the crouch on the snow (or just after leaving it).
  if (input.up.released && s.canPop && (s.grounded || s.airTime <= c.popCoyoteTime)) {
    s.velocity.addScaledVector(s.normal, c.popMin + (c.popMax - c.popMin) * s.crouch);
    s.grounded = false;
    s.canPop = false;
    s.crouch = 0;
  }
  const crouchTarget = input.up.held ? 1 : 0;
  s.crouch = approach(s.crouch, crouchTarget, dt / (crouchTarget > s.crouch ? c.crouchTime : c.standTime));

  if (s.grounded) rideSnow(s, input, dt);
  else fly(s, dt);

  move(s, hf, dt);
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

function fly(s: SkierState, dt: number): void {
  const c = CONFIG.skier;
  s.airTime += dt;
  s.yawRate = 0; // spins arrive in milestone 2
  s.brake = approach(s.brake, 0, dt / c.brakeRampTime);
  s.lean += (0 - s.lean) * (1 - Math.exp(-c.leanResponse * dt));
  if (s.airTime > c.popCoyoteTime) s.canPop = false;

  s.velocity.y -= c.gravity * dt;
  s.velocity.multiplyScalar(1 / (1 + c.dragAir * s.velocity.length() * dt));
}

/** Moves the skier and resolves contact with the snow. */
function move(s: SkierState, hf: Heightfield, dt: number): void {
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
    s.grounded = true;
    s.airTime = 0;
    s.canPop = true;
  } else if (s.grounded && gap < CONFIG.skier.groundTolerance) {
    // Skimming a few centimeters over a crest: still riding.
    s.normal.copy(contactNormal);
  } else if (s.grounded) {
    // The snow fell away faster than gravity could follow: airborne.
    s.grounded = false;
    s.airTime = 0;
  }
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

export function wrapAngle(a: number): number {
  return a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));
}
