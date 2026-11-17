// Snowboard poses as data (milestone 22), in skier space like the ski poses
// (render/skierPoses.ts: origin on the snow under the rider, +Y up, -Z the
// way the rider's chest faces, +X the rider's right), for a REGULAR rider:
// the left foot forward, toward the board's nose at -X, the toes toward -Z.
// A goofy rider is the same poses mirrored (SkierView mirrors the rig), so
// "front" is always index 0 (the left side here) and "rear" index 1.
//
// The board is where a pose says (BoardDef); both feet stand in its
// bindings, so a pose moves the board and the legs follow (two-bone IK from
// the hips). In a grab the hand goes to a point on the board (`board` on a
// HandDef), the opposite of a ski grab, which brings the ski to the hand.
// The rider stands across the board, knees flexed, hips and shoulders a
// little open toward the nose, head turned to look over the front shoulder,
// arms out for balance (the front one toward the nose).

import type { BoardDef, FootDef, HandDef, PoseDef, Vec3 } from './skierPoses.ts';

/** Where the bindings hold each ankle, in board space (index 0 the front foot), and how each foot is turned on the board (+ toward the nose). */
export const BINDINGS: readonly [Vec3, Vec3] = [
  [-0.26, 0.16, 0.015],
  [0.26, 0.16, 0.015],
];
export const BINDING_YAW: readonly [number, number] = [0.26, -0.1];

/** The board flat on the snow under the rider. */
const FLAT: BoardDef = { at: [0, 0, 0] };

/** Each foot where its binding puts it on the flat board (only read when a pose frees the back foot). */
const BOUND_FEET: PoseDef['feet'] = [
  { ankle: BINDINGS[0], yaw: BINDING_YAW[0], knee: [-0.1, 0.05, -1] },
  { ankle: BINDINGS[1], yaw: BINDING_YAW[1], knee: [-0.35, 0.05, -1] },
];
/** Knees pulled up high (the heel-edge grabs, with the board up under the seat). */
const HIGH_KNEES: PoseDef['feet'] = [
  { ankle: BINDINGS[0], yaw: BINDING_YAW[0], knee: [-0.1, 0.5, -1] },
  { ankle: BINDINGS[1], yaw: BINDING_YAW[1], knee: [-0.3, 0.5, -1] },
];

/**
 * Riding stance: across the board, knees flexed over the toes, hips a touch
 * back over the heels, chest and head open toward the nose, the front arm
 * out over the nose and the rear one low over the tail.
 */
export const BOARD_STANCE: PoseDef = {
  pelvis: [0, 0.84, 0.04],
  pelvisPitch: 0.2,
  pelvisYaw: 0.25,
  chestPitch: 0.12,
  chestYaw: 0.3,
  headPitch: -0.25,
  headYaw: 0.75,
  feet: BOUND_FEET,
  hands: [
    { at: [-0.56, 0.98, -0.12], elbow: [-0.5, -0.6, 0.5] },
    { at: [0.44, 0.86, -0.02], elbow: [0.6, -0.6, 0.4] },
  ],
  board: FLAT,
};

/** Crouched for a pop: knees deep, chest over the knees, hands low and forward. */
export const BOARD_CROUCH: PoseDef = {
  pelvis: [0, 0.6, 0.1],
  pelvisPitch: 0.4,
  pelvisYaw: 0.2,
  chestPitch: 0.4,
  chestYaw: 0.3,
  headPitch: -0.55,
  headYaw: 0.75,
  feet: BOUND_FEET,
  hands: [
    { at: [-0.5, 0.7, -0.3], elbow: [-0.5, -0.6, 0.5] },
    { at: [0.36, 0.64, -0.24], elbow: [0.6, -0.6, 0.4] },
  ],
  board: FLAT,
};

/** Tucked for speed: low, the front fist pointing down the nose, the rear hand on the rear knee. */
export const BOARD_TUCK: PoseDef = {
  pelvis: [0.02, 0.58, 0.08],
  pelvisPitch: 0.55,
  pelvisYaw: 0.35,
  chestPitch: 0.55,
  chestYaw: 0.45,
  headPitch: -0.85,
  headYaw: 0.6,
  feet: BOUND_FEET,
  hands: [
    { at: [-0.5, 0.62, -0.34], elbow: [-0.3, -0.8, 0.4] },
    { at: [0.2, 0.58, -0.3], elbow: [0.7, -0.5, 0.3] },
  ],
  board: FLAT,
};

// Butters: the board tips about 11.5° onto its nose or tail, turning about
// where that end meets the snow (0.6 m from the middle).
const PRESS = 0.2;
const PRESS_X = 0.6 - 0.6 * Math.cos(PRESS);
const PRESS_Y = 0.6 * Math.sin(PRESS);

/** Nose press: the weight over the front foot, the tail up off the snow. */
export const BOARD_NOSE_PRESS: PoseDef = {
  pelvis: [-0.13, 0.9, 0.02],
  pelvisPitch: 0.2,
  pelvisYaw: 0.35,
  pelvisRoll: 0.12,
  chestPitch: 0.2,
  chestYaw: 0.35,
  headPitch: -0.4,
  headYaw: 0.7,
  feet: BOUND_FEET,
  hands: [
    { at: [-0.62, 0.92, -0.08], elbow: [-0.5, -0.6, 0.5] },
    { at: [0.3, 1.12, -0.05], elbow: [0.6, -0.6, 0.4] },
  ],
  board: { at: [-PRESS_X, PRESS_Y, 0], pitch: -PRESS },
};

/** Tail press: back over the rear foot, the nose up. */
export const BOARD_TAIL_PRESS: PoseDef = {
  pelvis: [0.14, 0.88, 0.05],
  pelvisPitch: 0.1,
  pelvisYaw: 0.15,
  pelvisRoll: -0.1,
  chestPitch: 0.06,
  chestYaw: 0.35,
  headPitch: -0.3,
  headYaw: 0.85,
  feet: BOUND_FEET,
  hands: [
    { at: [-0.5, 1.12, -0.15], elbow: [-0.5, -0.6, 0.5] },
    { at: [0.5, 0.92, 0.02], elbow: [0.6, -0.6, 0.4] },
  ],
  board: { at: [PRESS_X, PRESS_Y, 0], pitch: PRESS },
};

/**
 * Sitting on a chairlift: the front foot still in its binding, the board
 * hanging nose forward under the seat beside the right foot, which rests out
 * of its binding.
 */
export const BOARD_CHAIR: PoseDef = {
  pelvis: [0, 0.6, 0.4],
  pelvisPitch: -0.12,
  chestPitch: 0.1,
  headPitch: -0.02,
  feet: [
    { ankle: [-0.11, 0.16, 0.02] },
    { ankle: [0.13, 0.17, 0.0], yaw: -0.15 },
  ],
  hands: [
    { at: [-0.2, 0.84, -0.02], elbow: [-0.7, -0.4, 0.5] },
    { at: [0.2, 0.84, -0.02], elbow: [0.7, -0.4, 0.5] },
  ],
  // Nose forward: turned a quarter right, the front binding under the left foot.
  board: { at: [-0.095, 0, 0.27], yaw: -Math.PI / 2, free: 1 },
};

// Air poses share the hips over a board pulled up under them, and the free
// arm out for balance.
const AIR_PELVIS: Vec3 = [0, 0.9, 0.05];
/** A grab's hips: a little lower and back, so the folded chest brings the hands down to the board. */
const GRAB_PELVIS: Vec3 = [0, 0.86, 0.08];
const UP_BOARD = 0.56;
const FREE_FRONT: HandDef = { at: [-0.5, 1.02, -0.22], elbow: [-0.4, -0.7, 0.5] };
const FREE_REAR: HandDef = { at: [0.42, 0.98, -0.24], elbow: [0.4, -0.7, 0.5] };

/** A grab: the board pulled up under the hips, `hand` (0 front, 1 rear) on `on` (board space), the chest folded toward it. */
function grab(hand: 0 | 1, on: Vec3, board: BoardDef, body: Partial<PoseDef> = {}): PoseDef {
  const reach: HandDef = { at: approx(board, on), board: on, elbow: hand === 0 ? [-0.6, -0.3, 0.4] : [0.6, -0.3, 0.4] };
  return {
    pelvis: GRAB_PELVIS,
    pelvisPitch: 0.5,
    pelvisYaw: 0.15,
    chestPitch: 0.95,
    chestYaw: 0.2,
    headPitch: -0.6,
    headYaw: 0.5,
    feet: BOUND_FEET,
    hands: hand === 0 ? [reach, FREE_REAR] : [FREE_FRONT, reach],
    board,
    ...body,
  };
}

/** Roughly where a board point sits (for blending the hand's way there; the rig puts it on the point itself). */
function approx(b: BoardDef, on: Vec3): Vec3 {
  return [b.at[0] + on[0], b.at[1] + on[1], b.at[2] + on[2]];
}

const TOE = -0.125;
const HEEL = 0.125;
const TOP = 0.016;

/** Mute: the front hand to the toe edge between the bindings. */
export const MUTE = grab(0, [-0.08, TOP, TOE], { at: [0, UP_BOARD, -0.04] }, { chestYaw: 0.05, headYaw: 0.45 });
/** Melon: the front hand behind the front leg to the heel edge between the bindings. */
export const MELON = grab(0, [-0.12, TOP, HEEL], { at: [-0.03, UP_BOARD + 0.08, 0.02] }, { chestPitch: 0.75, chestYaw: 0.35, chestRoll: 0.25, feet: HIGH_KNEES });
/** Method: the front hand on the heel edge, the knees bent and the board pulled up behind the back, base turned back. */
export const METHOD = grab(0, [-0.16, TOP, HEEL], { at: [0.02, 0.6, 0.24], roll: 0.95, pitch: 0.2 }, { pelvisPitch: 0.15, chestPitch: 0.35, chestYaw: 0.3, chestRoll: 0.2, headYaw: 0.75 });
/** Japan: the front hand to the toe edge in front of the front knee, the board pulled up behind, nose tweaked down. */
export const JAPAN = grab(0, [-0.1, TOP, TOE], { at: [0.02, 0.74, 0.22], roll: 0.6, pitch: -0.35 }, { pelvisPitch: 0.25, chestPitch: 0.8, chestYaw: 0.15, headYaw: 0.6 });
/** Indy: the rear hand to the toe edge between the bindings. */
export const INDY = grab(1, [0.08, TOP, TOE], { at: [0, UP_BOARD, -0.04] }, { chestYaw: 0.25, headYaw: 0.55 });
/** Stalefish: the rear hand behind the back leg to the heel edge. */
export const STALEFISH = grab(1, [0.14, TOP, HEEL], { at: [0.04, UP_BOARD + 0.1, 0.02] }, { chestPitch: 0.75, chestYaw: -0.15, chestRoll: -0.3, headYaw: 0.8, feet: HIGH_KNEES });
/** Roast beef: the rear hand between the legs to the heel edge. */
export const ROAST_BEEF = grab(1, [0.0, TOP, HEEL], { at: [0, UP_BOARD + 0.08, 0.02] }, { chestPitch: 1.0, chestYaw: 0.1, feet: HIGH_KNEES });
/** Tail grab: the rear hand to the tail, the tail pulled up. */
export const TAIL_GRAB = grab(1, [0.68, TOP + 0.05, 0], { at: [0, UP_BOARD, 0], pitch: -0.25 }, { chestPitch: 0.7, chestYaw: -0.1, chestRoll: -0.35, headYaw: 0.7 });
/** Nose grab: the front hand to the nose, the nose pulled up. */
export const NOSE_GRAB = grab(0, [-0.68, TOP + 0.05, 0], { at: [0, UP_BOARD, 0], pitch: 0.3 }, { chestPitch: 0.75, chestYaw: 0.35, chestRoll: 0.35, headYaw: 0.4 });
/** Crail: the rear hand across the front to the toe edge up by the nose, the nose pulled up. */
export const CRAIL = grab(1, [-0.42, TOP, TOE], { at: [0, UP_BOARD, -0.05], pitch: 0.3 }, { chestPitch: 0.8, chestYaw: 0.55, chestRoll: 0.15, headYaw: 0.4 });

// Style moves: no hand on the board, except the rocket air.

/** Shifty: the board turned about 70° under the hips while the shoulders stay. */
export const SHIFTY: PoseDef = {
  pelvis: AIR_PELVIS,
  pelvisPitch: 0.25,
  pelvisYaw: -0.25,
  chestPitch: 0.25,
  chestYaw: 0.55,
  headPitch: -0.3,
  headYaw: 0.6,
  feet: BOUND_FEET,
  hands: [FREE_FRONT, FREE_REAR],
  board: { at: [0, 0.38, 0], yaw: -1.2 },
};

/** Poke: the front leg kicked straight, the nose boned out and down, the back knee tucked. */
export const POKE: PoseDef = {
  pelvis: AIR_PELVIS,
  pelvisPitch: 0.1,
  pelvisYaw: 0.4,
  chestPitch: 0.1,
  chestYaw: 0.25,
  headPitch: -0.25,
  headYaw: 0.6,
  feet: BOUND_FEET,
  hands: [{ at: [-0.55, 1.3, 0.05], elbow: [-0.4, -0.7, 0.5] }, FREE_REAR],
  board: { at: [-0.18, 0.28, -0.12], pitch: -0.55, yaw: 0.35 },
};

/** Rocket air: both hands on the nose, the board stood up in front of the chest, the back leg straight down. */
export const ROCKET: PoseDef = {
  pelvis: AIR_PELVIS,
  pelvisPitch: 0.2,
  pelvisYaw: 0.3,
  chestPitch: 0.2,
  chestYaw: 0.35,
  headPitch: -0.1,
  headYaw: 0.4,
  feet: BOUND_FEET,
  hands: [
    { at: [-0.2, 1.25, -0.3], board: [-0.68, TOP + 0.04, -0.07], elbow: [-0.6, -0.5, 0.3] },
    { at: [-0.2, 1.25, -0.25], board: [-0.68, TOP + 0.04, 0.07], elbow: [0.6, -0.5, 0.3] },
  ],
  board: { at: [-0.02, 0.6, -0.38], pitch: 1.3 },
};

/** Stiffy: both legs straight, the board flat out under the body, arms up and out. */
export const STIFFY: PoseDef = {
  pelvis: AIR_PELVIS,
  pelvisPitch: 0.05,
  pelvisYaw: 0.2,
  chestPitch: 0.05,
  chestYaw: 0.25,
  headPitch: -0.15,
  headYaw: 0.6,
  feet: BOUND_FEET,
  hands: [
    { at: [-0.62, 1.38, -0.05], elbow: [-0.3, -0.8, 0.5] },
    { at: [0.62, 1.36, -0.05], elbow: [0.3, -0.8, 0.5] },
  ],
  board: { at: [0, 0.04, -0.04] },
};

/** Every board grab and style move, in the order of GRAB_ACTIONS (core/input.ts): the front hand's row, then the rear's, then the style keys. */
export const BOARD_GRABS: readonly PoseDef[] = [
  MUTE, // A (grabLeftMute)
  MELON, // S
  METHOD, // D
  JAPAN, // F
  INDY, // Z (grabRightMute)
  STALEFISH, // X
  ROAST_BEEF, // C
  TAIL_GRAB, // V
  NOSE_GRAB, // G (grabLeftNose)
  CRAIL, // B (grabRightNose)
  SHIFTY, // T (styleSeaman)
  POKE, // W
  ROCKET, // 1
  STIFFY, // 2
];

/**
 * Crash tumble: balled up, knees to the chest with the board still on, arms
 * wrapped round the shins. In game the whole body rolls round BOARD_TUMBLE_CENTER.
 */
export const BOARD_TUMBLE: PoseDef = {
  pelvis: [0, 0.56, 0.1],
  pelvisPitch: 0.5,
  pelvisYaw: 0.2,
  chestPitch: 0.5,
  chestYaw: 0.2,
  headPitch: -0.45,
  feet: BOUND_FEET,
  hands: [
    { at: [-0.2, 0.62, -0.32], elbow: [-0.8, -0.4, 0.2] },
    { at: [0.2, 0.62, -0.32], elbow: [0.8, -0.4, 0.2] },
  ],
  board: { at: [0, 0.18, -0.12] },
};

/** Middle of the balled-up tumble, in skier space. */
export const BOARD_TUMBLE_CENTER: Vec3 = [0, 0.56, -0.08];

/** Heel-side slam: the heel edge caught, thrown back onto the seat and shoulders, arms flung back. */
export const BOARD_SLAM_HEEL: PoseDef = {
  pelvis: [0, 0.3, 0.4],
  pelvisPitch: -0.6,
  pelvisYaw: 0.1,
  chestPitch: -0.5,
  chestYaw: 0.1,
  headPitch: 0.35,
  feet: BOUND_FEET,
  hands: [
    { at: [-0.4, 0.35, 0.75], elbow: [-0.6, 0.3, -0.5] },
    { at: [0.4, 0.35, 0.75], elbow: [0.6, 0.3, -0.5] },
  ],
  board: { at: [0, 0.12, -0.2], roll: -0.6 },
};

/** Toe-side slam: the toe edge caught, thrown forward onto the knees and chest, hands out to catch the fall. */
export const BOARD_SLAM_TOE: PoseDef = {
  pelvis: [0, 0.48, -0.25],
  pelvisPitch: 0.9,
  pelvisYaw: 0.1,
  chestPitch: 0.9,
  chestYaw: 0.1,
  headPitch: -0.5,
  feet: BOUND_FEET,
  hands: [
    { at: [-0.35, 0.25, -0.95], elbow: [-0.6, 0.2, 0.5] },
    { at: [0.35, 0.25, -0.95], elbow: [0.6, 0.2, 0.5] },
  ],
  board: { at: [0, 0.32, 0.28], roll: 0.9 },
};

/** The back foot out of its binding for the skating push (Shift): where it plants on the toe side, and how far back it drives. */
export const PUSH_FOOT: FootDef = { ankle: [0.12, 0.16, -0.27], yaw: 0.15 };
export const PUSH_BACK = 0.3;
