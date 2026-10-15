import { DEFAULT_HINTS } from './skierRig.ts';
import type { FootDef, HandDef, PoseDef, Vec3 } from './skierPoses.ts';

// A mutable pose the game rebuilds every frame by mixing pose definitions,
// so animating the skier never allocates. Every optional field of PoseDef is
// filled in (missing angles are 0, missing hints use the rig's defaults).
// Grabs are not blended here yet; they arrive with the air tricks.

type MutableVec3 = [number, number, number];

interface FootBuffer {
  ankle: MutableVec3;
  yaw: number;
  pitch: number;
  roll: number;
  knee: MutableVec3;
}

interface HandBuffer {
  at: MutableVec3;
  pole: MutableVec3;
  elbow: MutableVec3;
}

export interface PoseBuffer {
  pelvis: MutableVec3;
  pelvisPitch: number;
  pelvisYaw: number;
  pelvisRoll: number;
  chestPitch: number;
  chestYaw: number;
  chestRoll: number;
  headPitch: number;
  headYaw: number;
  feet: [FootBuffer, FootBuffer];
  hands: [HandBuffer, HandBuffer];
}

export function createPoseBuffer(): PoseBuffer {
  const foot = (): FootBuffer => ({ ankle: [0, 0, 0], yaw: 0, pitch: 0, roll: 0, knee: [0, 0, 0] });
  const hand = (): HandBuffer => ({ at: [0, 0, 0], pole: [0, 0, 0], elbow: [0, 0, 0] });
  return {
    pelvis: [0, 0, 0],
    pelvisPitch: 0,
    pelvisYaw: 0,
    pelvisRoll: 0,
    chestPitch: 0,
    chestYaw: 0,
    chestRoll: 0,
    headPitch: 0,
    headYaw: 0,
    feet: [foot(), foot()],
    hands: [hand(), hand()],
  };
}

/** Copies a pose definition into the buffer. */
export function setPose(out: PoseBuffer, def: PoseDef): void {
  out.pelvisPitch = def.pelvisPitch;
  out.pelvisYaw = def.pelvisYaw ?? 0;
  out.pelvisRoll = def.pelvisRoll ?? 0;
  out.chestPitch = def.chestPitch;
  out.chestYaw = def.chestYaw ?? 0;
  out.chestRoll = def.chestRoll ?? 0;
  out.headPitch = def.headPitch ?? 0;
  out.headYaw = def.headYaw ?? 0;
  copy(out.pelvis, def.pelvis);
  for (let i = 0; i < 2; i++) {
    const s = i === 0 ? 0 : 1;
    const f = out.feet[s];
    const fd: FootDef = def.feet[s];
    copy(f.ankle, fd.ankle);
    f.yaw = fd.yaw ?? 0;
    f.pitch = fd.pitch ?? 0;
    f.roll = fd.roll ?? 0;
    copy(f.knee, fd.knee ?? DEFAULT_HINTS.knee[s]);
    const h = out.hands[s];
    const hd: HandDef = def.hands[s];
    copy(h.at, hd.at);
    copy(h.pole, hd.pole ?? DEFAULT_HINTS.pole[s]);
    copy(h.elbow, hd.elbow ?? DEFAULT_HINTS.elbow[s]);
  }
}

/**
 * Moves the buffer by `w` times the difference from `base` to `target`.
 * Starting from `base` and adding several targets gives a weighted mix:
 * base * (1 - w1 - w2) + target1 * w1 + target2 * w2.
 */
export function addPoseDelta(out: PoseBuffer, base: PoseDef, target: PoseDef, w: number): void {
  if (w === 0) return;
  out.pelvisPitch += (target.pelvisPitch - base.pelvisPitch) * w;
  out.pelvisYaw += ((target.pelvisYaw ?? 0) - (base.pelvisYaw ?? 0)) * w;
  out.pelvisRoll += ((target.pelvisRoll ?? 0) - (base.pelvisRoll ?? 0)) * w;
  out.chestPitch += (target.chestPitch - base.chestPitch) * w;
  out.chestYaw += ((target.chestYaw ?? 0) - (base.chestYaw ?? 0)) * w;
  out.chestRoll += ((target.chestRoll ?? 0) - (base.chestRoll ?? 0)) * w;
  out.headPitch += ((target.headPitch ?? 0) - (base.headPitch ?? 0)) * w;
  out.headYaw += ((target.headYaw ?? 0) - (base.headYaw ?? 0)) * w;
  addDelta(out.pelvis, base.pelvis, target.pelvis, w);
  for (let i = 0; i < 2; i++) {
    const s = i === 0 ? 0 : 1;
    const f = out.feet[s];
    const bf = base.feet[s];
    const tf = target.feet[s];
    addDelta(f.ankle, bf.ankle, tf.ankle, w);
    f.yaw += ((tf.yaw ?? 0) - (bf.yaw ?? 0)) * w;
    f.pitch += ((tf.pitch ?? 0) - (bf.pitch ?? 0)) * w;
    f.roll += ((tf.roll ?? 0) - (bf.roll ?? 0)) * w;
    addDelta(f.knee, bf.knee ?? DEFAULT_HINTS.knee[s], tf.knee ?? DEFAULT_HINTS.knee[s], w);
    const h = out.hands[s];
    const bh = base.hands[s];
    const th = target.hands[s];
    addDelta(h.at, bh.at, th.at, w);
    addDelta(h.pole, bh.pole ?? DEFAULT_HINTS.pole[s], th.pole ?? DEFAULT_HINTS.pole[s], w);
    addDelta(h.elbow, bh.elbow ?? DEFAULT_HINTS.elbow[s], th.elbow ?? DEFAULT_HINTS.elbow[s], w);
  }
}

function copy(out: MutableVec3, v: Vec3): void {
  out[0] = v[0];
  out[1] = v[1];
  out[2] = v[2];
}

function addDelta(out: MutableVec3, a: Vec3, b: Vec3, w: number): void {
  out[0] += (b[0] - a[0]) * w;
  out[1] += (b[1] - a[1]) * w;
  out[2] += (b[2] - a[2]) * w;
}
