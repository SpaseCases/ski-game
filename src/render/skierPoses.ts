// Skier poses as data. Positions are in skier space: origin on the snow
// between the feet, +Y up, -Z forward, +X to the skier's right. Index 0 is
// the left side, 1 the right. Angles are radians: pitch > 0 leans forward
// (for skis: tip up), yaw > 0 turns left, roll > 0 leans left.
// The rig solves knees and elbows itself, so a pose only says where the
// hips, chest, feet and hands go. In a grab the hand says where it is and
// the ski is brought to the hand, so the hand is always on the ski.

export type Vec3 = readonly [number, number, number];

export interface FootDef {
  /**
   * Ankle position. On the snow the ankle sits 0.16 m above the ski base.
   * Ignored when a hand grabs this foot's ski: the ski goes to the hand.
   */
  ankle: Vec3;
  yaw?: number;
  pitch?: number;
  roll?: number;
  /** Direction the knee points (defaults to forward and slightly out). */
  knee?: Vec3;
}

export interface HandDef {
  /** Hand position. */
  at: Vec3;
  /** Which ski this hand holds (0 left, 1 right), if any. */
  grab?: 0 | 1;
  /** The point on that ski the hand holds, in ski space (origin at the base center, tip toward -Z). */
  on?: Vec3;
  /** How far (0..1) the ski is pulled to the hand, for blending into a grab. Defaults to 1. */
  weight?: number;
  /** Direction the pole points from the hand. */
  pole?: Vec3;
  /** Direction the elbow points (defaults to out and back). */
  elbow?: Vec3;
}

export interface PoseDef {
  pelvis: Vec3;
  pelvisPitch: number;
  pelvisYaw?: number;
  pelvisRoll?: number;
  /** Chest relative to the pelvis (the bend at the lower back). */
  chestPitch: number;
  chestYaw?: number;
  chestRoll?: number;
  /** Head relative to the chest. */
  headPitch?: number;
  headYaw?: number;
  feet: readonly [FootDef, FootDef];
  hands: readonly [HandDef, HandDef];
}

// Grab points on the left ski. Its outside edge is -X and inside edge +X;
// mirroring turns these into the right ski's points.
const EDGE = 0.06;
const TOP = 0.035;

/** Half the distance between the feet on the snow (m). */
export const STANCE_HALF_WIDTH = 0.105;

const SNOW_FEET: PoseDef['feet'] = [
  { ankle: [-STANCE_HALF_WIDTH, 0.16, 0.02] },
  { ankle: [STANCE_HALF_WIDTH, 0.16, 0.02] },
];

/**
 * Athletic riding stance: ankles flexed so the shins press forward into the
 * boots, knees bent over the toes, hips back over the heels, chest forward,
 * and hands out in front, wider than the body.
 */
export const STANCE: PoseDef = {
  pelvis: [0, 0.89, 0.08],
  pelvisPitch: 0.24,
  chestPitch: 0.13,
  headPitch: -0.3,
  feet: SNOW_FEET,
  hands: [
    { at: [-0.37, 0.95, -0.33], pole: [-0.15, -0.84, 0.52] },
    { at: [0.37, 0.95, -0.33], pole: [0.15, -0.84, 0.52] },
  ],
};

export const CROUCH: PoseDef = {
  pelvis: [0, 0.64, 0.17],
  pelvisPitch: 0.38,
  chestPitch: 0.42,
  headPitch: -0.62,
  feet: SNOW_FEET,
  hands: [
    { at: [-0.33, 0.74, -0.3], pole: [-0.2, -0.6, 0.78] },
    { at: [0.33, 0.74, -0.3], pole: [0.2, -0.6, 0.78] },
  ],
};

export const TUCK: PoseDef = {
  pelvis: [0, 0.64, 0.25],
  pelvisPitch: 0.62,
  chestPitch: 0.48,
  headPitch: -1.05,
  feet: SNOW_FEET,
  hands: [
    // Fists low in front of the knees, poles clamped under the arms along the ribs.
    { at: [-0.08, 0.68, -0.44], pole: [-0.35, 0.14, 1], elbow: [-0.6, -1, 0.1] },
    { at: [0.08, 0.68, -0.44], pole: [0.35, 0.14, 1], elbow: [0.6, -1, 0.1] },
  ],
};

// Shared pieces of the air poses: hips over the tucked-up skis, the free
// hand out to the side for balance.
const AIR_PELVIS: Vec3 = [0, 0.92, 0.05];
const TUCKED_LEFT: FootDef = { ankle: [-0.13, 0.5, -0.06], knee: [-0.15, 0.3, -1] };
const TUCKED_RIGHT: FootDef = { ankle: [0.13, 0.5, -0.06], knee: [0.15, 0.3, -1] };
const BALANCE_RIGHT: HandDef = { at: [0.52, 1.1, -0.1], pole: [0.55, -0.72, 0.4], elbow: [0.6, -0.6, 0.4] };

/** Left hand across the body to the right ski's outside edge, in front of the boot. */
export const LEFT_MUTE: PoseDef = {
  pelvis: AIR_PELVIS,
  pelvisPitch: 0.35,
  pelvisYaw: -0.1,
  chestPitch: 1.0,
  chestYaw: -0.4,
  chestRoll: -0.2,
  headPitch: -0.75,
  headYaw: 0.25,
  feet: [TUCKED_LEFT, { ankle: [0, 0, 0], yaw: 0.3, pitch: 0.2, roll: -0.1, knee: [0.5, 0.1, -1] }],
  hands: [
    { at: [0.06, 0.44, -0.4], grab: 1, on: [EDGE, TOP, -0.32], pole: [-0.3, -0.4, 0.85], elbow: [-0.3, -0.6, 0.3] },
    BALANCE_RIGHT,
  ],
};

/** Left hand to the left ski's outside edge, right beside the boot. */
export const LEFT_SAFETY: PoseDef = {
  pelvis: AIR_PELVIS,
  pelvisPitch: 0.45,
  chestPitch: 1.0,
  chestYaw: 0.05,
  chestRoll: 0.6,
  headPitch: -0.65,
  feet: [{ ankle: [0, 0, 0], roll: 0.15, knee: [-0.35, -1, -1] }, TUCKED_RIGHT],
  hands: [
    { at: [-0.29, 0.38, -0.1], grab: 0, on: [-EDGE, TOP, -0.06], pole: [-0.35, -0.3, 0.9], elbow: [-0.9, -0.1, 0.3] },
    { at: [0.4, 1.1, -0.24], pole: [0.55, -0.72, 0.4], elbow: [0.6, -0.6, 0.4] },
  ],
};

/**
 * Left hand reaches back past the hip to the left ski's inside edge, just
 * above the boot. The thigh hangs nearly straight down, the knee a little
 * forward, and the shin runs back so the boot is up behind the seat, toe
 * down: the ski stands close behind the body, tip down, its tail up past the
 * shoulder.
 */
export const LEFT_JAPAN: PoseDef = {
  pelvis: AIR_PELVIS,
  pelvisPitch: 0.3,
  pelvisYaw: 0.1,
  chestPitch: 0.4,
  chestYaw: 0.55,
  chestRoll: 0.35,
  headPitch: -0.3,
  headYaw: -0.35,
  feet: [
    { ankle: [0, 0, 0], pitch: -1.5, yaw: -0.2, knee: [-0.15, -1, -0.5] },
    { ankle: [0.13, 0.36, -0.1], knee: [0.15, 0.3, -1] },
  ],
  hands: [
    { at: [-0.168, 0.971, 0.407], grab: 0, on: [EDGE + 0.035, TOP, 0.2], pole: [-0.45, -0.5, 0.7], elbow: [0.5, -0.8, 0.3] },
    { at: [0.42, 1.12, -0.22], pole: [0.55, -0.72, 0.4], elbow: [0.6, -0.6, 0.4] },
  ],
};

/** Left hand back to the tail of the left ski; the ski angles tail-up behind. */
export const LEFT_TAIL: PoseDef = {
  pelvis: AIR_PELVIS,
  pelvisPitch: 0.3,
  pelvisYaw: 0.15,
  chestPitch: 0.25,
  chestYaw: 0.5,
  chestRoll: 0.3,
  headPitch: -0.3,
  headYaw: -0.3,
  feet: [{ ankle: [0, 0, 0], pitch: -0.6, yaw: 0.1, knee: [-0.15, -0.1, -1] }, TUCKED_RIGHT],
  hands: [
    { at: [-0.3, 0.95, 0.35], grab: 0, on: [-0.04, 0.05, 0.72], pole: [-0.5, -0.6, 0.5], elbow: [-1, -0.2, 0.2] },
    { at: [0.46, 1.1, -0.2], pole: [0.55, -0.72, 0.4], elbow: [0.6, -0.6, 0.4] },
  ],
};

/**
 * Left hand forward to the outside edge of the left ski, just behind its tip. The leg
 * reaches forward with the thigh level, the tip pulled up steeply to the
 * hand, and the body folds forward over it.
 */
export const LEFT_NOSE: PoseDef = {
  pelvis: AIR_PELVIS,
  pelvisPitch: 0.35,
  chestPitch: 0.9,
  chestYaw: 0.1,
  chestRoll: 0.2,
  headPitch: -0.5,
  feet: [{ ankle: [0, 0, 0], pitch: 1.1, knee: [-0.2, 0, -1] }, TUCKED_RIGHT],
  hands: [
    { at: [-0.2, 0.946, -0.843], grab: 0, on: [-EDGE - 0.01, TOP, -0.6], pole: [-0.3, -0.5, 0.8], elbow: [-0.9, -0.2, 0.2] },
    // The free arm reaches out to the side for balance, nearly straight.
    { at: [0.58, 1.02, -0.15], pole: [0.6, -0.6, 0.5], elbow: [0.3, -0.5, 0.8] },
  ],
};

// Style moves: one each, not mirrored.

/**
 * Screamin' seaman, the old-school way: the right leg kicks straight out in
 * front, ski tipped up; the left thigh swings back and the knee bends so the
 * boot comes up behind, and the left ski stands up behind the back, held
 * toward its tail behind the shoulder by the left hand; chest out and back
 * arched, the right arm thrown up.
 */
export const SEAMAN: PoseDef = {
  pelvis: AIR_PELVIS,
  pelvisPitch: 0,
  chestPitch: -0.2,
  chestYaw: 0.35,
  chestRoll: 0.1,
  headPitch: 0.15,
  headYaw: -0.4,
  feet: [
    { ankle: [0, 0, 0], pitch: -1.85, knee: [-0.1, -0.6, 0.8] },
    { ankle: [0.12, 0.55, -0.75], pitch: 0.6, knee: [0.1, 0.4, -1] },
  ],
  hands: [
    { at: [-0.2, 1.316, 0.488], grab: 0, on: [-EDGE, TOP, 0.5], pole: [-0.4, -0.6, 0.7], elbow: [-0.8, 0, 0.5] },
    { at: [0.35, 1.6, -0.15], pole: [0.4, 0.3, 0.85], elbow: [0.8, -0.3, 0.3] },
  ],
};

/** Daffy: a running split in the air, left ski forward tip up, right ski back tip down, arms out wide. */
export const DAFFY: PoseDef = {
  pelvis: AIR_PELVIS,
  pelvisPitch: 0.1,
  chestPitch: 0.15,
  headPitch: -0.15,
  feet: [
    { ankle: [-0.11, 0.27, -0.5], pitch: 0.35, knee: [-0.1, 0.3, -1] },
    { ankle: [0.11, 0.35, 0.5], pitch: -0.45, knee: [0.1, -0.6, -1] },
  ],
  hands: [
    { at: [-0.6, 1.2, -0.12], pole: [-0.6, -0.6, 0.5], elbow: [-0.3, -0.7, 0.6] },
    { at: [0.6, 1.2, -0.12], pole: [0.6, -0.6, 0.5], elbow: [0.3, -0.7, 0.6] },
  ],
};

/** Iron cross: knees bent, heels kicked up behind, the skis turned in so their tips cross in an X in front. */
export const IRON_CROSS: PoseDef = {
  pelvis: AIR_PELVIS,
  pelvisPitch: 0.25,
  chestPitch: 0.3,
  headPitch: -0.35,
  feet: [
    // One boot a touch further back, so the skis pass one in front of the other where they cross.
    { ankle: [-0.17, 0.62, 0.24], pitch: -0.8, yaw: -1.0, knee: [-0.15, -1, -0.4] },
    { ankle: [0.17, 0.62, 0.32], pitch: -0.8, yaw: 1.0, knee: [0.15, -1, -0.4] },
  ],
  hands: [
    { at: [-0.5, 1.05, -0.3], pole: [-0.5, -0.7, 0.5], elbow: [-0.6, -0.6, 0.4] },
    { at: [0.5, 1.05, -0.3], pole: [0.5, -0.7, 0.5], elbow: [0.6, -0.6, 0.4] },
  ],
};

/** Spread eagle: legs spread wide to the sides, arms flung up and out, like a star. */
export const SPREAD_EAGLE: PoseDef = {
  pelvis: AIR_PELVIS,
  pelvisPitch: 0.05,
  chestPitch: 0,
  headPitch: -0.1,
  feet: [
    { ankle: [-0.55, 0.3, -0.02], roll: -0.5, knee: [-0.3, 0.2, -1] },
    { ankle: [0.55, 0.3, -0.02], roll: 0.5, knee: [0.3, 0.2, -1] },
  ],
  hands: [
    { at: [-0.72, 1.48, -0.05], pole: [-0.75, -0.3, 0.55], elbow: [-0.2, -0.8, 0.5] },
    { at: [0.72, 1.48, -0.05], pole: [0.75, -0.3, 0.55], elbow: [0.2, -0.8, 0.5] },
  ],
};

/** Mirrors a pose left to right: the right-hand version of a left-hand grab. */
export function mirrorPose(p: PoseDef): PoseDef {
  return {
    pelvis: flip(p.pelvis),
    pelvisPitch: p.pelvisPitch,
    pelvisYaw: neg(p.pelvisYaw),
    pelvisRoll: neg(p.pelvisRoll),
    chestPitch: p.chestPitch,
    chestYaw: neg(p.chestYaw),
    chestRoll: neg(p.chestRoll),
    headPitch: p.headPitch,
    headYaw: neg(p.headYaw),
    feet: [mirrorFoot(p.feet[1]), mirrorFoot(p.feet[0])],
    hands: [mirrorHand(p.hands[1]), mirrorHand(p.hands[0])],
  };
}

export const RIGHT_MUTE = mirrorPose(LEFT_MUTE);
export const RIGHT_SAFETY = mirrorPose(LEFT_SAFETY);
export const RIGHT_JAPAN = mirrorPose(LEFT_JAPAN);
export const RIGHT_TAIL = mirrorPose(LEFT_TAIL);
export const RIGHT_NOSE = mirrorPose(LEFT_NOSE);

function mirrorFoot(f: FootDef): FootDef {
  return { ankle: flip(f.ankle), yaw: neg(f.yaw), pitch: f.pitch, roll: neg(f.roll), knee: flipOpt(f.knee) };
}

function mirrorHand(h: HandDef): HandDef {
  return {
    at: flip(h.at),
    grab: h.grab === undefined ? undefined : h.grab === 0 ? 1 : 0,
    on: flipOpt(h.on),
    pole: flipOpt(h.pole),
    elbow: flipOpt(h.elbow),
  };
}

function flip(v: Vec3): Vec3 {
  return [-v[0], v[1], v[2]];
}

function flipOpt(v: Vec3 | undefined): Vec3 | undefined {
  return v ? flip(v) : undefined;
}

function neg(v: number | undefined): number | undefined {
  return v === undefined ? undefined : -v;
}

/** Every grab and style move, in the order of GRAB_ACTIONS (core/input.ts). */
export const GRABS: readonly PoseDef[] = [
  LEFT_MUTE,
  LEFT_SAFETY,
  LEFT_JAPAN,
  LEFT_TAIL,
  RIGHT_MUTE,
  RIGHT_SAFETY,
  RIGHT_JAPAN,
  RIGHT_TAIL,
  LEFT_NOSE,
  RIGHT_NOSE,
  SEAMAN,
  DAFFY,
  IRON_CROSS,
  SPREAD_EAGLE,
];

/**
 * Crash tumble: a simple tight ball, skis together under the body and both
 * arms wrapped forward around the knees, poles trailing. In game the whole
 * body rolls around TUMBLE_CENTER.
 */
export const TUMBLE: PoseDef = {
  pelvis: [0, 0.62, 0.14],
  pelvisPitch: 0.45,
  chestPitch: 0.45,
  headPitch: -0.45,
  feet: [
    { ankle: [-0.1, 0.2, -0.02], pitch: 0.15 },
    { ankle: [0.1, 0.2, -0.02], pitch: 0.15 },
  ],
  hands: [
    { at: [-0.19, 0.72, -0.36], pole: [-0.12, -0.25, 1], elbow: [-0.8, -0.4, 0.2] },
    { at: [0.19, 0.72, -0.36], pole: [0.12, -0.25, 1], elbow: [0.8, -0.4, 0.2] },
  ],
};

/** Middle of the balled-up tumble pose, in skier space. */
export const TUMBLE_CENTER: Vec3 = [0, 0.62, -0.08];
