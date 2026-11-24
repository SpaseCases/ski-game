import { Quaternion, Vector3 } from 'three';
import { CONFIG } from '../config.ts';
import type { InputState } from '../core/input.ts';
import { keepInside } from './bounds.ts';
import type { Course } from './obstacles.ts';
import { wrapAngle, type SkierState } from './skier.ts';
import { groundAt } from './terrain.ts';
import { TUNING } from './tuning.ts';

// The developer's free flight (milestone 25). Only the developer's chunk
// imports this file: it registers flightStep with sim/skier.ts's
// setFlightStep, and stepSkier runs it instead of everything else while
// SkierState.flight isn't 0. With flight 0 nothing here runs, so every sim
// tool stays byte-identical.
//
// Flying: no gravity and no crashes. The rider flies forward on their own
// (CONFIG.dev.flight.cruise; the pole key held, `fast`), ← → turn, ↑
// climbs, ↓ dives (the pole key held, `fastDive`), and Space
// (flightKeys.hover, set by the developer's keys each step) slows to a hover. The snow and the map's edge stop them (they
// skim over it); trees, rocks, buildings and rails are flown through.
// Landing glides down to the snow below (faster the higher it starts) and rides away with the speed,
// with no landing check. While flying, `yaw` is the heading in the world
// (the body's forward), not the snow's frame.

/** Held keys the riding keys don't carry: Space hovers (it's the pop key, or nothing with "Pop with: ↑"). */
export const flightKeys = { hover: false };

const UP = new Vector3(0, 1, 0);
const SIDE = new Vector3(1, 0, 0);
const forward = new Vector3();
const local = new Vector3();
const normal = new Vector3();
const qTurn = new Quaternion();
const qPitch = new Quaternion();
const qTilt = new Quaternion();
const target = new Quaternion();

/** Lifts the rider into flight (from the snow, a rail or the air). False when they can't: crashed, or on the chairlift. */
export function startFlight(s: SkierState): boolean {
  if (s.flight !== 0 || s.bailed || s.lift >= 0) return false;
  // Fly the way the body points (on a board, its nose).
  forward.set(0, 0, -1).applyQuaternion(s.orient);
  const heading = Math.hypot(forward.x, forward.z) > 1e-3 ? Math.atan2(-forward.x, -forward.z) : s.yaw;
  const fromSnow = s.grounded;
  s.flight = 1;
  s.yaw = wrapAngle(heading);
  s.yawRate = 0;
  s.grounded = false;
  s.airTime = 0;
  s.canPop = false;
  s.rail = -1;
  s.rail3d = false;
  s.railExit = false;
  s.airWall = false;
  s.press = 0;
  s.crouch = 0;
  s.brake = 0;
  s.lean = 0;
  s.butter = 0;
  s.butterAmount = 0;
  s.grab = -1;
  s.spin.set(0, 0, 0);
  s.spinDriven = 0;
  s.airFrame.identity();
  s.airHeading = s.yaw;
  s.airPitch = 0;
  s.trick.identity();
  s.trickTurn = 0;
  s.landSoft = false;
  s.landPowder = false;
  if (fromSnow) s.velocity.y = Math.max(s.velocity.y, 0) + CONFIG.dev.flight.liftOff;
  return true;
}

/** The fly key while flying: start gliding down to land; while gliding, fly on again. */
export function toggleLanding(s: SkierState): void {
  if (s.flight === 1) s.flight = 2;
  else if (s.flight === 2) s.flight = 1;
}

/** One fixed step of flight (registered with setFlightStep). Allocates nothing. */
export function flightStep(s: SkierState, input: InputState, course: Course, dt: number): void {
  const F = CONFIG.dev.flight;
  const hf = course.hf;
  s.airTime += dt;
  s.landTime += dt;
  s.poleTime += dt;
  s.polePhase = 1;

  const steer = (input.left.held ? 1 : 0) - (input.right.held ? 1 : 0);
  s.yawRate = steer * F.turnRate;
  s.yaw = wrapAngle(s.yaw + s.yawRate * dt);
  const hx = -Math.sin(s.yaw);
  const hz = -Math.cos(s.yaw);

  // Speed across the ground, always along the heading (turning carries it round, no drift).
  const hover = flightKeys.hover;
  const want = hover ? 0 : input.pole.held ? F.fast : F.cruise;
  let along = s.velocity.x * hx + s.velocity.z * hz;
  along = approach(along, want, (hover && along > want ? F.hoverBrake : F.accel) * dt);
  s.velocity.x = hx * along;
  s.velocity.z = hz * along;
  // Up and down: ↑ climbs, ↓ dives (faster with the pole key); gliding down
  // to land sinks at `glide` near the snow, faster the higher it is.
  const diving = input.down.held && !input.up.held;
  const climb = (input.up.held ? F.climb : 0) - (input.down.held ? (input.pole.held ? F.fastDive : F.dive) : 0);
  const above = s.position.y - groundAt(hf, s.position.x, s.position.z, normal);
  const sink = Math.min(F.glideMax, F.glide + F.glideFar * Math.max(0, above));
  const vy = s.flight === 2 ? Math.min(-sink, climb) : climb;
  const falling = vy < s.velocity.y && (diving || s.flight === 2);
  s.velocity.y = approach(s.velocity.y, vy, (falling ? F.diveAccel : F.climbAccel) * dt);

  s.position.addScaledVector(s.velocity, dt);
  keepInside(hf.bounds, s.position, s.velocity);
  const ground = groundAt(hf, s.position.x, s.position.z, normal);
  if (s.flight === 2 && s.position.y <= ground) {
    touchDown(s, hf, along);
    return;
  }
  // The snow stops a flight (it skims over), and so does the ceiling.
  const floor = ground + (s.flight === 2 ? 0 : F.clearance);
  if (s.position.y < floor) {
    s.position.y = floor;
    if (s.velocity.y < 0) s.velocity.y = 0;
  } else if (s.position.y > ground + F.ceiling) {
    s.position.y = ground + F.ceiling;
    if (s.velocity.y > 0) s.velocity.y = 0;
  }

  // The body turns to the heading and pitches with the climb.
  s.airHeading = s.yaw;
  s.airPitch = F.pitchMax * clamp(s.velocity.y / F.climb, -1, 1);
  qTurn.setFromAxisAngle(UP, s.airHeading);
  qPitch.setFromAxisAngle(SIDE, s.airPitch);
  target.multiplyQuaternions(qTurn, qPitch);
  s.orient.slerp(target, 1 - Math.exp(-F.turnBody * dt));
  s.center.set(0, TUNING.air.comHeight, 0).applyQuaternion(s.orient).add(s.position);
}

/**
 * Onto the snow at the end of a glide: standing, riding on along the
 * heading at `landKeep` of the speed across the ground, with no landing
 * check (nothing crashes). Wherever the snow is: a slope, a roof, a pipe's wall.
 */
function touchDown(s: SkierState, hf: Course['hf'], along: number): void {
  const F = CONFIG.dev.flight;
  s.flight = 0;
  s.grounded = true;
  s.airTime = 0;
  s.canPop = true;
  s.popArmed = true;
  s.position.y = groundAt(hf, s.position.x, s.position.z, s.normal);
  // Along the heading, in the snow's plane.
  forward.set(-Math.sin(s.yaw), 0, -Math.cos(s.yaw));
  forward.addScaledVector(s.normal, -forward.dot(s.normal)).normalize();
  s.velocity.copy(forward).multiplyScalar(Math.max(0, along) * F.landKeep);
  // The heading on the snow is measured in the snow's own frame.
  qTilt.setFromUnitVectors(UP, s.normal);
  local.copy(forward).applyQuaternion(target.copy(qTilt).invert());
  s.yaw = Math.atan2(-local.x, -local.z);
  s.yawRate = 0;
  s.orient.multiplyQuaternions(qTilt, qTurn.setFromAxisAngle(UP, s.yaw));
  s.center.copy(s.position).addScaledVector(s.normal, TUNING.air.comHeight);
  s.spin.set(0, 0, 0);
  s.trick.identity();
  s.airPitch = 0;
  s.landTime = 0;
  s.landDepth = 0.3;
  s.landPitch = 0;
  s.landRoll = 0;
  s.landSide = 0;
  s.landImpact = 0;
}

function approach(value: number, to: number, step: number): number {
  return value < to ? Math.min(to, value + step) : Math.max(to, value - step);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
