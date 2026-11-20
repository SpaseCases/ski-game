import { BufferAttribute, BufferGeometry, Color, Euler, Matrix4, Mesh, MeshLambertMaterial, Quaternion, SRGBColorSpace, Vector3, type PerspectiveCamera, type Scene } from 'three';
import { CONFIG } from '../config.ts';
import type { DevKeys } from '../core/devKeys.ts';
import type { ButtonState, InputState } from '../core/input.ts';
import { flightKeys, flightStep, startFlight, toggleLanding } from '../sim/flight.ts';
import type { Course } from '../sim/obstacles.ts';
import { castShot, createShotHit, HIT, type ShotHit } from '../sim/shot.ts';
import { setFlightStep, type SkierState } from '../sim/skier.ts';
import { BODY, EYE_FORWARD, type SkierRig } from './skierRig.ts';
import type { SkierPose } from './skierView.ts';
import type { SnowFx } from './snowFx.ts';

// The developer's powers (milestone 25), the per-step and per-frame half:
// flight's keys, aiming (the view through the scope, its sway and kick),
// firing (a ray from the eye, a puff or sparks where it lands), and the
// carried model (slung on the back, in the hands while aiming, the arms
// brought to it). Only the developer's chunk imports this file (main loads
// it once the dev unlock is confirmed). Runs every frame, so it lives in
// render/ (never obfuscated) and holds no menu text; it allocates nothing
// per frame.

/** What the scope ring and the sound do: the developer's chunk fills these in (ui/devScope.ts, audio/devShot.ts). */
export interface DevOutputs {
  showScope(on: boolean): void;
  /** After a shot: the distance it hit at and what it hit (a HIT kind), or null for a miss. */
  shotAt(meters: number | null, kind: number): void;
  /** Make the shot's sound ready (the first aim), and play it. */
  prepareShot(): void;
  playShot(): void;
  /** The Dev tag: shown while flying. */
  showTag(on: boolean): void;
}

/** The converted model (tools/models/packs.ts → render/devModels.json): positions quantized to 16 bits, a color per triangle. */
interface ModelData {
  size: number[];
  pos: string;
  col: string;
}

// snowFx.ts's particle kinds (its SNOW, SPARK and WISP).
const SNOW = 0;
const SPARK = 1;
const WISP = 2;

const UP = new Vector3(0, 1, 0);
const X_AXIS = new Vector3(1, 0, 0);
const Z_AXIS = new Vector3(0, 0, 1);
const euler = new Euler(0, 0, 0, 'YXZ');
const qAim = new Quaternion();
const middle = new Vector3();
const headQ = new Quaternion();
const forward = new Vector3();
const eyePos = new Vector3();
const v1 = new Vector3();
const v2 = new Vector3();
const m1 = new Matrix4();
const m2 = new Matrix4();
const rootInverse = new Matrix4();
const back = new Matrix4();
const hands = [new Vector3(), new Vector3()];
const elbow = new Vector3();
const hint = new Vector3();
const dir = new Vector3();
const side = new Vector3();
const yAxis = new Vector3();
const zAxis = new Vector3();
const xAxis = new Vector3();
const basis = new Matrix4();
const shotFrom = new Vector3();
const shotDir = new Vector3();
const spot = new Vector3();

export class DevPowers {
  private readonly keys: DevKeys;
  private readonly out: DevOutputs;
  private readonly scene: Scene;
  /** The carried model, once its chunk has loaded. */
  private model: Mesh | null = null;
  private readonly modelEye = new Vector3();
  private readonly modelGrip = new Vector3();
  private readonly modelFore = new Vector3();
  /** Held U this step (and not crashed): the arrows aim instead of steering. */
  private aiming = false;
  /**
   * Stopped on the snow when the aim began (milestone 28): held exactly
   * where it stood (`pinAt`, `pinCenter`) until the aim ends, however steep
   * the slope. Aiming takes ↓, so a rider stopped by the brake used to let
   * go of it and slide off.
   */
  private pinned = false;
  private readonly pinAt = new Vector3();
  private readonly pinCenter = new Vector3();
  private aimX = 0;
  private aimY = 0;
  /** The pole key held while aiming: fine aim. */
  private fine = false;
  /** 0 at rest, 1 looking through the scope. */
  private raise = 0;
  private aimYaw = 0;
  private aimPitch = 0;
  /** 0 just moved, 1 held still long enough to steady. */
  private steady = 0;
  private swayTime = 0;
  private kick = 0;
  /** Seconds (game time) until the next shot can go. */
  private reload = 0;
  private fireQueued = false;
  /**
   * Multiplayer (milestone 27): the other riders as a target. Given the
   * shot and how far it may reach, the distance to the rider it hits (and the
   * hit is sent), or -1. Null when not in a lobby.
   */
  riderShot: ((from: Vector3, dir: Vector3, range: number) => number) | null = null;
  private tag = false;
  private bodyHidden = false;
  private readonly hit: ShotHit = createShotHit();

  constructor(keys: DevKeys, out: DevOutputs, scene: Scene) {
    this.keys = keys;
    this.out = out;
    this.scene = scene;
    setFlightStep(flightStep);
    void import('./devModels.json').then(
      (m) => this.build(m.default.models.long as ModelData),
      () => {
        // Without the model the powers still work; nothing is carried.
      },
    );
  }

  /**
   * Before each fixed step, after main copies the skier into the previous
   * state: the fly key takes off and lands, aiming takes the arrows (and
   * Space) from the riding keys so the rider coasts, and a shot is queued
   * for the next frame. With `on` false (the unlock gone), a flight glides
   * down and nothing else happens.
   */
  step(on: boolean, s: SkierState, input: InputState, dt: number): void {
    this.keys.sample();
    if (!on) {
      this.aiming = false;
      this.pinned = false;
      this.fireQueued = false;
      flightKeys.hover = false;
      if (s.flight === 1) toggleLanding(s);
      return;
    }
    const k = this.keys;
    if (k.fly.pressed) {
      if (s.flight === 0) startFlight(s);
      else toggleLanding(s);
    }
    const was = this.aiming;
    this.aiming = k.aim.held && !s.bailed;
    if (this.aiming && !was) {
      this.pinned = s.grounded && s.rail < 0 && s.lift < 0 && s.liftChair === -1 && s.flight === 0 && s.velocity.length() < CONFIG.dev.scope.pinSpeed;
      this.pinAt.copy(s.position);
      this.pinCenter.copy(s.center);
    }
    if (!this.aiming || s.flight !== 0) this.pinned = false;
    flightKeys.hover = k.space.held && !this.aiming;
    if (this.aiming) {
      this.aimX = (input.right.held ? 1 : 0) - (input.left.held ? 1 : 0);
      this.aimY = (input.up.held ? 1 : 0) - (input.down.held ? 1 : 0);
      this.fine = input.pole.held;
      quiet(input.pole);
      quiet(input.left);
      quiet(input.right);
      quiet(input.up);
      quiet(input.down);
      quiet(input.pop);
    } else {
      this.aimX = 0;
      this.aimY = 0;
    }
    this.reload = Math.max(0, this.reload - dt);
    if ((k.fire.pressed || (this.aiming && k.space.pressed)) && this.reload <= 0) {
      this.fireQueued = true;
      this.reload = CONFIG.dev.shot.reload;
    }
  }

  /**
   * After each fixed step (milestone 28): a rider pinned for the aim is put
   * back where it stood, at rest. Anything that crashes it (an avalanche, a
   * shot in a lobby) lets go.
   */
  hold(s: SkierState): void {
    if (!this.pinned) return;
    if (s.bailed || !s.grounded) {
      this.pinned = false;
      return;
    }
    s.position.copy(this.pinAt);
    s.center.copy(this.pinCenter);
    s.velocity.set(0, 0, 0);
    s.yawRate = 0;
  }

  /**
   * After the game camera: through the scope while aiming (it overrides the
   * camera), the model on the back or in the hands, a queued shot. With `on`
   * false, or while the Locker shows the rider, everything is put away.
   */
  frame(on: boolean, pose: SkierPose, sim: SkierState, rig: SkierRig, camera: PerspectiveCamera, frameTime: number, course: Course, snow: SnowFx, firstWeight: number): void {
    const tag = on && sim.flight !== 0;
    if (tag !== this.tag) {
      this.tag = tag;
      this.out.showTag(tag);
    }
    if (!on) {
      this.raise = 0;
      this.fireQueued = false;
      this.out.showScope(false);
      if (this.model) this.model.visible = false;
      this.bodyHidden = false;
      return;
    }
    const S = CONFIG.dev.scope;
    if (this.aiming && this.raise === 0) {
      // The way the camera looks now, at `startPitch` (the chase camera looks down at the rider: from the eye that's the snow a few meters ahead).
      camera.getWorldDirection(forward);
      this.aimYaw = Math.atan2(-forward.x, -forward.z);
      this.aimPitch = S.startPitch;
      this.steady = 0;
      this.out.prepareShot();
    }
    this.raise = approach(this.raise, this.aiming ? 1 : 0, frameTime / S.raise);
    if (this.raise > 0) {
      const rate = this.fine ? S.fineRate : S.aimRate;
      this.aimYaw -= this.aimX * rate * frameTime;
      this.aimPitch = clamp(this.aimPitch + this.aimY * rate * frameTime, S.pitchMin, S.pitchMax);
      this.steady = this.aimX !== 0 || this.aimY !== 0 ? 0 : Math.min(1, this.steady + frameTime / S.steady);
    }
    // Sway: two slow waves each way, smaller once steady, bigger at speed; the kick on top.
    this.swayTime += frameTime;
    this.kick *= Math.exp(-S.settle * frameTime);
    const amp = S.sway + (S.steadySway - S.sway) * this.steady + S.speedSway * pose.velocity.length();
    const w = 2 * Math.PI * S.swayRate * this.swayTime;
    const swayYaw = amp * (Math.sin(w) + 0.5 * Math.sin(w * 2.31 + 1.3));
    const swayPitch = amp * (Math.sin(w * 1.37 + 0.7) + 0.5 * Math.sin(w * 3.1 + 2.1)) + this.kick;
    qAim.setFromEuler(euler.set(clamp(this.aimPitch + swayPitch, S.pitchMin, S.pitchMax), this.aimYaw + swayYaw, 0));
    forward.set(0, 0, -1).applyQuaternion(qAim);

    rig.eye(middle, headQ);
    const scoped = this.raise >= 1;
    if (this.raise > 0) {
      const t = this.raise * this.raise * (3 - 2 * this.raise);
      eyePos.copy(middle).addScaledVector(forward, EYE_FORWARD);
      camera.position.lerp(eyePos, t);
      camera.quaternion.slerp(qAim, t);
      camera.up.lerp(UP, t).normalize();
      const zoomed = (2 * Math.atan(Math.tan((CONFIG.camera.firstFov * Math.PI) / 360) / S.zoom) * 180) / Math.PI;
      setFov(camera, camera.fov + (zoomed - camera.fov) * t);
    }
    this.out.showScope(this.raise > 0.85);
    // Through the scope the body would fill the view: only the boots and skis stay (as in level air in first person).
    if (scoped !== this.bodyHidden) {
      this.bodyHidden = scoped;
      if (!scoped) rig.setHidden(false, false);
    }
    if (scoped) rig.setHidden(true, true);

    this.place(rig, firstWeight, scoped);

    if (this.fireQueued) {
      this.fireQueued = false;
      this.fire(course, snow, camera, scoped);
    }
  }

  /** Turns the aim to look at a point from the eye, held steady (for checks: the dev hook parkLaps.devAimAt in dev builds). */
  aimAt(x: number, y: number, z: number): void {
    const dx = x - middle.x;
    const dy = y - middle.y;
    const dz = z - middle.z;
    this.aimYaw = Math.atan2(-dx, -dz);
    this.aimPitch = Math.atan2(dy, Math.hypot(dx, dz));
    this.steady = 1;
  }

  /** The model on the back, or in the hands (the arms brought to it) while raised; hidden at the eye. */
  private place(rig: SkierRig, firstWeight: number, scoped: boolean): void {
    const model = this.model;
    if (!model) return;
    const C = CONFIG.dev.carry;
    const raised = this.raise > 0;
    model.visible = !scoped && (raised || firstWeight < C.hideFirst);
    if (!model.visible) return;
    if (!raised) {
      // Slung across the back, muzzle up over the left shoulder, scope out.
      const torso = rig.parts().torso;
      torso.updateWorldMatrix(true, false);
      model.matrix.multiplyMatrices(torso.matrixWorld, back);
      model.matrixWorldNeedsUpdate = true;
      return;
    }
    // In the hands: the eye point at the cheek, along the aim.
    v1.copy(middle).addScaledVector(forward, C.cheek);
    v1.y -= C.cheekDrop;
    v2.copy(this.modelEye).applyQuaternion(qAim);
    v1.sub(v2);
    model.matrix.compose(v1, qAim, ONE);
    model.matrixWorldNeedsUpdate = true;
    // The hands to the grip and the fore-end (in the rig's own space).
    const root = rig.root;
    root.updateWorldMatrix(true, false);
    rootInverse.copy(root.matrixWorld).invert();
    m1.multiplyMatrices(rootInverse, model.matrix);
    const parts = rig.parts();
    // The trigger hand is the right one as seen in the world: the rig's left when mirrored (goofy).
    const gripHand = root.matrixWorld.determinant() < 0 ? 0 : 1;
    hands[gripHand]!.copy(this.modelGrip).applyMatrix4(m1);
    hands[1 - gripHand]!.copy(this.modelFore).applyMatrix4(m1);
    for (let i = 0; i < 2; i++) {
      const out = i === 0 ? -1 : 1;
      if (i === gripHand) hint.set(out * 0.8, -0.6, 0.2);
      else hint.set(out * 0.3, -1, 0.1);
      const shoulder = parts.upperArms[i]!.position;
      solveLimb(shoulder, hands[i]!, BODY.upperArm, BODY.forearm + BODY.hand, hint, elbow);
      segment(parts.upperArms[i]!, shoulder, elbow, hint);
      segment(parts.forearms[i]!, elbow, hands[i]!, hint);
      parts.poles[i]!.position.copy(hands[i]!);
    }
  }

  /** A shot from the eye along the view (the scope's, sway and all). */
  private fire(course: Course, snow: SnowFx, camera: PerspectiveCamera, scoped: boolean): void {
    const S = CONFIG.dev.shot;
    if (scoped) shotFrom.copy(camera.position);
    else shotFrom.copy(middle);
    camera.getWorldDirection(shotDir);
    this.kick += CONFIG.dev.scope.kick;
    this.steady = 0;
    this.out.playShot();
    const hit = this.hit;
    const any = castShot(course, shotFrom, shotDir, S.range, hit);
    // Another rider in a multiplayer lobby nearer than what the ray hit (milestone 27): the lobby crashes them.
    const rider = this.riderShot ? this.riderShot(shotFrom, shotDir, any ? hit.distance : S.range) : -1;
    if (rider >= 0) {
      this.out.shotAt(rider, HIT.rider);
      return;
    }
    this.out.shotAt(any ? hit.distance : null, hit.kind);
    if (any) burstAt(snow, hit);
  }

  /** The model's mesh from its data: one draw call, a color per triangle. */
  private build(data: ModelData): void {
    const q = new Int16Array(bytes(data.pos).buffer);
    const c = bytes(data.col);
    const sx = data.size[0]!;
    const sy = data.size[1]!;
    const sz = data.size[2]!;
    const n = q.length / 3;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const color = new Color();
    for (let v = 0; v < n; v++) {
      pos[v * 3] = (q[v * 3]! / 32767) * (sx / 2);
      pos[v * 3 + 1] = (q[v * 3 + 1]! / 32767) * sy;
      pos[v * 3 + 2] = (q[v * 3 + 2]! / 32767) * (sz / 2);
      const t = Math.floor(v / 3) * 3;
      color.setRGB(c[t]! / 255, c[t + 1]! / 255, c[t + 2]! / 255, SRGBColorSpace);
      col[v * 3] = color.r;
      col[v * 3 + 1] = color.g;
      col[v * 3 + 2] = color.b;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(pos, 3));
    geometry.setAttribute('color', new BufferAttribute(col, 3));
    geometry.computeVertexNormals();
    const mesh = new Mesh(geometry, new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    mesh.visible = false;
    const C = CONFIG.dev.carry;
    this.modelEye.fromArray(C.eye);
    this.modelGrip.fromArray(C.grip);
    this.modelFore.fromArray(C.fore);
    // On the back: its middle at `back` in the chest's frame, the muzzle turned up (z to y), the scope out, then slung across.
    m1.makeTranslation(C.back[0]!, C.back[1]!, C.back[2]!);
    m2.makeRotationAxis(Z_AXIS, C.sling);
    back.multiplyMatrices(m1, m2);
    m2.makeRotationAxis(X_AXIS, Math.PI / 2);
    back.multiply(m2);
    m2.makeTranslation(0, -sy / 2, 0);
    back.multiply(m2);
    this.scene.add(mesh);
    this.model = mesh;
  }
}

const ONE = new Vector3(1, 1, 1);

/** A puff of snow (the snow, a tree) or sparks (anything hard: rock, rails, walls) where a shot landed, bigger far away. */
function burstAt(snow: SnowFx, hit: ShotHit): void {
  const S = CONFIG.dev.shot;
  const grow = Math.max(1, hit.distance / S.sizeFrom);
  const n = hit.normal;
  const hard = hit.kind === HIT.hard || hit.kind === HIT.rail;
  spot.copy(hit.point).addScaledVector(n, 0.05);
  if (hard) {
    for (let i = 0; i < S.sparks; i++) {
      randomOut(n, v1, S.sparkSpeed);
      snow.spawn(spot, v1.x, v1.y, v1.z, S.sparkLife * (0.4 + 0.6 * Math.random()), S.spark * grow, S.spark * grow, 1, 0.4, SPARK);
    }
  }
  const puffs = hard ? Math.round(S.puff / 4) : S.puff;
  for (let i = 0; i < puffs; i++) {
    randomOut(n, v1, S.puffSpeed);
    const cloud = Math.random() < 0.6;
    const life = S.puffLife * (0.6 + 0.6 * Math.random());
    if (cloud) snow.spawn(spot, v1.x * 0.5, v1.y * 0.5, v1.z * 0.5, life * 1.5, S.cloud0 * grow, S.cloud1 * grow * (0.6 + 0.8 * Math.random()), 0.15, 1.6, WISP);
    else snow.spawn(spot, v1.x, v1.y, v1.z, life, S.chunk * grow, S.chunk * 1.6 * grow, 0.8, 1.2, SNOW);
  }
  // Snow knocked off a tree's branches falls from above the hit.
  if (hit.kind === HIT.tree) {
    for (let i = 0; i < S.puff; i++) {
      v2.set(hit.point.x + (Math.random() - 0.5) * 1.5, hit.point.y + Math.random() * 2, hit.point.z + (Math.random() - 0.5) * 1.5);
      snow.spawn(v2, 0, -0.5, 0, S.puffLife * 1.5, S.chunk * grow, S.chunk * 2 * grow, 0.6, 1.5, Math.random() < 0.5 ? WISP : SNOW);
    }
  }
}

/** A random direction out of the surface (a cone round its normal), times up to `speed`. */
function randomOut(n: Vector3, out: Vector3, speed: number): void {
  out.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
  if (out.dot(n) < 0) out.addScaledVector(n, -2 * out.dot(n));
  out.addScaledVector(n, 0.8).normalize().multiplyScalar(speed * (0.3 + 0.7 * Math.random()));
}

/** Clears a key so the sim never sees it (aiming takes the arrows and Space). */
function quiet(b: ButtonState): void {
  b.held = false;
  b.pressed = false;
  b.released = false;
}

/** Two-bone reach, as SkierRig's solveLimb: the middle joint toward `bend`. */
function solveLimb(start: Vector3, target: Vector3, a: number, b: number, bend: Vector3, outMid: Vector3): void {
  dir.subVectors(target, start);
  const want = dir.length();
  dir.divideScalar(want || 1);
  const d = Math.min(Math.max(want, Math.abs(a - b) + 1e-4), a + b - 1e-4);
  target.copy(start).addScaledVector(dir, d);
  const along = (a * a - b * b + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, a * a - along * along));
  side.copy(bend).addScaledVector(dir, -bend.dot(dir));
  if (side.lengthSq() < 1e-8) side.set(0, 0, -1).addScaledVector(dir, dir.z);
  side.normalize();
  outMid.copy(start).addScaledVector(dir, along).addScaledVector(side, h);
}

/** A limb segment from a to b, its front toward `front`, as SkierRig's segment. */
function segment(mesh: Mesh, a: Vector3, b: Vector3, front: Vector3): void {
  yAxis.subVectors(b, a).normalize();
  zAxis.copy(front).addScaledVector(yAxis, -front.dot(yAxis));
  if (zAxis.lengthSq() < 1e-8) zAxis.set(0, 0, -1).addScaledVector(yAxis, yAxis.z);
  zAxis.normalize().negate();
  xAxis.crossVectors(yAxis, zAxis);
  basis.makeBasis(xAxis, yAxis, zAxis);
  mesh.position.copy(a);
  mesh.quaternion.setFromRotationMatrix(basis);
}

function setFov(camera: PerspectiveCamera, fov: number): void {
  if (Math.abs(camera.fov - fov) < 1e-4) return;
  camera.fov = fov;
  camera.updateProjectionMatrix();
}

function approach(value: number, to: number, step: number): number {
  return value < to ? Math.min(to, value + step) : Math.max(to, value - step);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function bytes(base64: string): Uint8Array {
  const s = atob(base64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
