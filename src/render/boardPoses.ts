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

/** Each foot in its binding, the knees over the toes, the rear one driving a little toward the nose. */
const BOUND_FEET: PoseDef['feet'] = [
  { ankle: BINDINGS[0], yaw: BINDING_YAW[0], knee: [-0.1, 0.05, -1] },
  { ankle: BINDINGS[1], yaw: BINDING_YAW[1], knee: [-0.35, 0.05, -1] },
];

/**
 * Riding stance: across the board, knees flexed over the toes, hips a touch
 * back over the heels, chest and head open toward the nose, the front arm
 * out over the nose and the rear one low over the tail.
 */
export const BOARD_STANCE: PoseDef = {
  pelvis: [0, 0.93, 0.03],
  pelvisPitch: 0.14,
  pelvisYaw: 0.2,
  chestPitch: 0.1,
  chestYaw: 0.22,
  headPitch: -0.22,
  headYaw: 0.8,
  feet: BOUND_FEET,
  hands: [
    { at: [-0.5, 0.98, -0.1], elbow: [-0.5, -0.6, 0.5] },
    { at: [0.4, 0.86, 0.02], elbow: [0.6, -0.6, 0.4] },
  ],
  board: FLAT,
};

/** Knees spread over the toes as the legs fold deeper (the crouch and the tuck), so the chest has room between them. */
const WIDE_KNEES: PoseDef['feet'] = [
  { ankle: BINDINGS[0], yaw: BINDING_YAW[0], knee: [-0.35, 0.05, -1] },
  { ankle: BINDINGS[1], yaw: BINDING_YAW[1], knee: [0.05, 0.05, -1] },
];

/** Crouched for a pop: knees bent to about a right angle, chest leaning over them, hands low and forward. */
export const BOARD_CROUCH: PoseDef = {
  pelvis: [0, 0.77, 0.08],
  pelvisPitch: 0.3,
  pelvisYaw: 0.18,
  chestPitch: 0.28,
  chestYaw: 0.25,
  headPitch: -0.45,
  headYaw: 0.75,
  feet: WIDE_KNEES,
  hands: [
    { at: [-0.5, 0.8, -0.28], elbow: [-0.5, -0.6, 0.5] },
    { at: [0.38, 0.72, -0.2], elbow: [0.6, -0.6, 0.4] },
  ],
  board: FLAT,
};

/** Tucked for speed: low, the front fist pointing down the nose, the rear hand by the rear knee. */
export const BOARD_TUCK: PoseDef = {
  pelvis: [0.02, 0.71, 0.1],
  pelvisPitch: 0.4,
  pelvisYaw: 0.3,
  chestPitch: 0.38,
  chestYaw: 0.4,
  headPitch: -0.55,
  headYaw: 0.6,
  feet: WIDE_KNEES,
  hands: [
    { at: [-0.52, 0.72, -0.3], elbow: [-0.3, -0.8, 0.4] },
    { at: [0.3, 0.64, -0.32], elbow: [0.7, -0.5, 0.3] },
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
  pelvis: [-0.15, 1.02, 0.02],
  pelvisPitch: 0.2,
  pelvisYaw: 0.35,
  pelvisRoll: 0.12,
  chestPitch: 0.2,
  chestYaw: 0.35,
  headPitch: -0.4,
  headYaw: 0.7,
  feet: BOUND_FEET,
  hands: [
    { at: [-0.66, 1.0, -0.08], elbow: [-0.5, -0.6, 0.5] },
    { at: [0.32, 1.18, -0.05], elbow: [0.6, -0.6, 0.4] },
  ],
  board: { at: [-PRESS_X, PRESS_Y, 0], pitch: -PRESS },
};

/** Tail press: back over the rear foot, the nose up. */
export const BOARD_TAIL_PRESS: PoseDef = {
  pelvis: [0.15, 1.01, 0.06],
  pelvisPitch: 0.1,
  pelvisYaw: 0.15,
  pelvisRoll: -0.1,
  chestPitch: 0.06,
  chestYaw: 0.35,
  headPitch: -0.3,
  headYaw: 0.85,
  feet: BOUND_FEET,
  hands: [
    { at: [-0.38, 1.2, -0.12], elbow: [-0.5, -0.6, 0.5] },
    { at: [0.5, 1.0, 0.02], elbow: [0.6, -0.6, 0.4] },
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
    { ankle: [-0.13, 0.16, 0.02], knee: [-0.2, 0.05, -1] },
    { ankle: [0.16, 0.17, 0.0], yaw: -0.15, knee: [0.2, 0.05, -1] },
  ],
  hands: [
    { at: [-0.2, 0.84, -0.02], elbow: [-0.7, -0.4, 0.5] },
    { at: [0.2, 0.84, -0.02], elbow: [0.7, -0.4, 0.5] },
  ],
  // Nose forward: turned a quarter right, the front binding under the left foot.
  board: { at: [-0.095, 0, 0.27], yaw: -Math.PI / 2, free: 1 },
};

// Air poses: the hips over a board pulled up under them, the free arm out
// for balance. The rig's arms are short for its legs, so a hand reaches the
// board only with the legs folded deep and the chest leaning well over: the
// knees go wide, over the toes, and the chest folds down between them (not
// into them), the grabbing shoulder dropped toward the grab. The numbers were
// tuned with tools/model/boardBody.ts (no part through another, the knees no
// tighter than about 55°).
const TOE = -0.125;
const HEEL = 0.125;
const TOP = 0.016;

/** A grab: the board where it's pulled to, `hand` (0 front, 1 rear) on `on` (board space), the body folded to it. */
interface GrabDef {
  hand: 0 | 1;
  on: Vec3;
  board: BoardDef;
  body: Pick<PoseDef, 'pelvis' | 'pelvisPitch' | 'pelvisYaw' | 'pelvisRoll' | 'chestPitch' | 'chestYaw' | 'chestRoll' | 'headPitch' | 'headYaw'>;
  /** Which way each knee points (front, rear). */
  knees: readonly [Vec3, Vec3];
  /** Which way the grabbing arm's elbow points. */
  elbow: Vec3;
  /** Where the free hand is, out for balance. */
  free: Vec3;
}

function grab(g: GrabDef): PoseDef {
  const b = g.board.at;
  // Where the hand starts on its way to the board (the rig puts it on the point itself).
  const reach: HandDef = { at: [b[0] + g.on[0], b[1] + g.on[1], b[2] + g.on[2]], board: g.on, elbow: g.elbow };
  const free: HandDef = { at: g.free, elbow: [Math.sign(g.free[0]) * 0.4, -0.7, 0.5] };
  return {
    ...g.body,
    feet: [
      { ankle: BINDINGS[0], yaw: BINDING_YAW[0], knee: g.knees[0] },
      { ankle: BINDINGS[1], yaw: BINDING_YAW[1], knee: g.knees[1] },
    ],
    hands: g.hand === 0 ? [reach, free] : [free, reach],
    board: g.board,
  };
}

/** Mute: the front hand to the toe edge between the bindings, the front shoulder dropped and the knees spread round the chest. */
export const MUTE = grab({
  hand: 0,
  on: [-0.08, TOP, TOE],
  board: { at: [-0.02, 0.39, -0.14], pitch: 0, roll: -0.33 },
  body: { pelvis: [0, 0.88, 0.08], pelvisPitch: 0.63, pelvisYaw: -0.09, pelvisRoll: 0.1, chestPitch: 0.45, chestYaw: -0.19, chestRoll: 0.25, headPitch: -0.35, headYaw: 0.45 },
  knees: [[-0.89, 0.27, -0.77], [0.56, 0.3, -0.92]],
  elbow: [-0.69, -0.27, 0.46],
  free: [0.55, 1.12, 0.05],
});

/** Melon: the front hand down behind the front leg to the heel edge, the heel edge tweaked up. */
export const MELON = grab({
  hand: 0,
  on: [-0.14, TOP, HEEL],
  board: { at: [-0.12, 0.47, -0.05], pitch: 0.12, roll: 0.71 },
  body: { pelvis: [0, 0.88, 0.12], pelvisPitch: 0.32, pelvisYaw: 0.01, pelvisRoll: 0.07, chestPitch: 0.39, chestYaw: 0.32, chestRoll: 0.37, headPitch: -0.35, headYaw: 0.39 },
  knees: [[-0.4, -0.05, -0.83], [0.65, 0.33, -0.73]],
  elbow: [-0.52, -0.02, 1.08],
  free: [0.46, 1.13, 0.02],
});

/** Method: the front hand on the heel edge, the knees bent and the board pulled up behind, its base turned out. */
export const METHOD = grab({
  hand: 0,
  on: [-0.16, TOP, HEEL],
  board: { at: [-0.06, 0.6, 0.32], pitch: 0.14, roll: 1.26 },
  body: { pelvis: [0, 0.91, 0.01], pelvisPitch: -0.06, pelvisYaw: 0.05, pelvisRoll: -0.02, chestPitch: 0.09, chestYaw: 0.36, chestRoll: 0.31, headPitch: -0.2, headYaw: 0.7 },
  knees: [[-0.3, -0.6, -0.99], [0.2, -0.53, -1.02]],
  elbow: [-0.7, 0.03, 0.61],
  free: [0.54, 1.12, 0.05],
});

/**
 * Japan: the front hand down between the knees to the toe edge, the nose tipped
 * down, the base rolled to face back, the front knee driven down. (A board right
 * up behind the back is out of the hand's reach.)
 */
export const JAPAN = grab({
  hand: 0,
  on: [-0.12, TOP, TOE],
  board: { at: [-0.04, 0.39, -0.04], pitch: -0.25, roll: 0.15 },
  body: { pelvis: [0, 0.87, 0.08], pelvisPitch: 0.73, pelvisYaw: -0.1, pelvisRoll: 0.13, chestPitch: 0.49, chestYaw: -0.44, chestRoll: 0.25, headPitch: -0.35, headYaw: 0.46 },
  knees: [[-0.89, -0.2, -0.77], [0.56, 0.3, -0.9]],
  elbow: [-0.69, -0.27, 0.46],
  free: [0.59, 1.16, 0.05],
});

/** Indy: the rear hand to the toe edge between the bindings, the rear shoulder dropped. */
export const INDY = grab({
  hand: 1,
  on: [0.08, TOP, TOE],
  board: { at: [0, 0.47, -0.09], pitch: -0.01, roll: -0.17 },
  body: { pelvis: [0, 0.9, 0.05], pelvisPitch: 0.45, pelvisYaw: 0.16, pelvisRoll: 0.03, chestPitch: 0.35, chestYaw: 0.65, chestRoll: -0.38, headPitch: -0.3, headYaw: 0.55 },
  knees: [[-0.29, 0.45, -1], [0.37, 0.46, -0.92]],
  elbow: [0.5, -0.54, 0.25],
  free: [-0.58, 1.12, -0.25],
});

/** Stalefish: the rear hand down behind the rear leg to the heel edge. */
export const STALEFISH = grab({
  hand: 1,
  on: [0.15, TOP, HEEL],
  board: { at: [0.15, 0.47, -0.09], pitch: -0.19, roll: 0.45 },
  body: { pelvis: [0, 0.87, 0.05], pelvisPitch: 0.43, pelvisYaw: -0.01, pelvisRoll: 0, chestPitch: 0.06, chestYaw: -0.15, chestRoll: -0.52, headPitch: -0.3, headYaw: 0.75 },
  knees: [[-0.35, 0.45, -1], [0.39, 0.44, -0.98]],
  elbow: [0.57, 0.2, 0.76],
  free: [-0.53, 1.22, -0.19],
});

/** Roast beef: the rear hand down between the knees to the heel edge. */
export const ROAST_BEEF = grab({
  hand: 1,
  on: [0.0, TOP, HEEL],
  board: { at: [0.1, 0.46, -0.09], pitch: 0.24, roll: 0.55 },
  body: { pelvis: [0, 0.93, 0.16], pelvisPitch: 0.51, pelvisYaw: 0.09, pelvisRoll: -0.1, chestPitch: 0.44, chestYaw: 0.47, chestRoll: -0.35, headPitch: -0.3, headYaw: 0.5 },
  knees: [[-0.66, 0.05, -0.74], [0.67, 0.1, -0.73]],
  elbow: [0.11, -0.4, -0.97],
  free: [-0.68, 1.12, -0.16],
});

/** Tail grab: the rear hand back to the tail, the tail pulled up, the front leg longer. */
export const TAIL_GRAB = grab({
  hand: 1,
  on: [0.68, TOP + 0.05, 0],
  board: { at: [-0.07, 0.36, -0.09], pitch: -0.34, roll: 0.04 },
  body: { pelvis: [0, 0.92, 0.13], pelvisPitch: 0.39, pelvisYaw: 0.09, pelvisRoll: -0.02, chestPitch: 0.35, chestYaw: -0.27, chestRoll: -0.4, headPitch: -0.35, headYaw: 0.72 },
  knees: [[-0.19, 0.19, -0.96], [0.61, 0.16, -0.84]],
  elbow: [0.81, -0.2, 0.53],
  free: [-0.53, 1.14, -0.07],
});

/** Nose grab: the front hand forward to the nose, the nose pulled up, the back leg longer. */
export const NOSE_GRAB = grab({
  hand: 0,
  on: [-0.68, TOP + 0.05, 0],
  board: { at: [0.03, 0.35, -0.09], pitch: 0.37, roll: 0.01 },
  body: { pelvis: [0, 0.9, 0.14], pelvisPitch: 0.33, pelvisYaw: 0.02, pelvisRoll: 0.01, chestPitch: 0.4, chestYaw: 0.27, chestRoll: 0.37, headPitch: -0.35, headYaw: 0.39 },
  knees: [[-0.61, 0.16, -0.85], [0.2, 0.26, -1.02]],
  elbow: [-0.8, -0.2, 0.38],
  free: [0.48, 1.12, 0.02],
});

/** Crail: the rear hand across the front to the toe edge up by the nose, the nose pulled up. */
export const CRAIL = grab({
  hand: 1,
  on: [-0.42, TOP, TOE],
  board: { at: [0.04, 0.37, -0.1], pitch: 0.44, roll: 0.03 },
  body: { pelvis: [0, 0.92, 0.11], pelvisPitch: 0.61, pelvisYaw: 0.28, pelvisRoll: 0, chestPitch: 0.5, chestYaw: 0.66, chestRoll: 0.15, headPitch: -0.33, headYaw: 0.38 },
  knees: [[-0.96, 0.22, -0.64], [0.26, 0.14, -1.01]],
  elbow: [0.29, -0.61, 0.09],
  free: [-0.6, 1.11, -0.05],
});

// Style moves: no hand on the board, except the rocket air.

/** Shifty: the board turned about 65° under the hips while the shoulders stay, knees bent. */
export const SHIFTY: PoseDef = {
  pelvis: [0, 1.02, 0.06],
  pelvisPitch: 0.2,
  pelvisYaw: -0.45,
  pelvisRoll: 0,
  chestPitch: 0.15,
  chestYaw: 0.84,
  chestRoll: -0.01,
  headPitch: -0.3,
  headYaw: 0.6,
  feet: [
    { ankle: BINDINGS[0], yaw: BINDING_YAW[0], knee: [0.74, 0.21, -0.7] },
    { ankle: BINDINGS[1], yaw: BINDING_YAW[1], knee: [0.86, 0.2, -0.5] },
  ],
  hands: [
    { at: [-0.55, 1.08, -0.1], elbow: [-0.4, -0.7, 0.5] },
    { at: [0.5, 1.05, -0.01], elbow: [0.4, -0.7, 0.5] },
  ],
  board: { at: [0, 0.34, 0.01], pitch: 0.04, yaw: -1.05, roll: 0 },
};

/** Poke: the front leg kicked straight, the nose boned out and down, the back knee tucked. */
export const POKE: PoseDef = {
  pelvis: [0, 0.89, 0.07],
  pelvisPitch: 0.19,
  pelvisYaw: 0.31,
  pelvisRoll: -0.05,
  chestPitch: 0.08,
  chestYaw: 0.34,
  chestRoll: 0,
  headPitch: -0.3,
  headYaw: 0.75,
  feet: [
    { ankle: BINDINGS[0], yaw: BINDING_YAW[0], knee: [-0.34, 0.23, -1.03] },
    { ankle: BINDINGS[1], yaw: BINDING_YAW[1], knee: [0.35, 0.5, -0.98] },
  ],
  hands: [
    { at: [-0.61, 1.01, -0.15], elbow: [-0.4, -0.7, 0.5] },
    { at: [0.45, 1.32, 0.1], elbow: [0.4, -0.7, 0.5] },
  ],
  board: { at: [-0.24, 0.18, -0.08], pitch: -0.65, yaw: 0.2, roll: 0 },
};

/** Rocket air: both hands on the nose, the board stood up in front of the chest, the back leg straight down. */
export const ROCKET: PoseDef = {
  pelvis: [0, 0.91, 0.09],
  pelvisPitch: 0.23,
  pelvisYaw: 0.1,
  pelvisRoll: -0.04,
  chestPitch: 0.28,
  chestYaw: 0.1,
  chestRoll: 0,
  headPitch: -0.1,
  headYaw: 0.21,
  feet: [
    { ankle: BINDINGS[0], yaw: BINDING_YAW[0], knee: [-0.31, 0.57, -0.24] },
    { ankle: BINDINGS[1], yaw: BINDING_YAW[1], knee: [0.29, 0.2, -1.01] },
  ],
  hands: [
    { at: [-0.04, 0.95, -0.35], board: [-0.7, TOP + 0.03, 0.06], elbow: [-0.68, -0.51, 0.41] },
    { at: [-0.04, 0.95, -0.35], board: [-0.7, TOP + 0.03, -0.06], elbow: [0.68, -0.51, 0.41] },
  ],
  board: { at: [-0.04, 0.25, -0.35], pitch: 1.25, yaw: -Math.PI / 2, roll: 0.02 },
};

/** Stiffy: both legs straight, the board flat out under the body, arms up and out. */
export const STIFFY: PoseDef = {
  pelvis: [0, 1.02, 0.06],
  pelvisPitch: 0.05,
  pelvisYaw: 0.2,
  pelvisRoll: 0,
  chestPitch: 0.05,
  chestYaw: 0.25,
  chestRoll: 0,
  headPitch: -0.15,
  headYaw: 0.6,
  feet: [
    { ankle: BINDINGS[0], yaw: BINDING_YAW[0], knee: [-0.3, 0.05, -1] },
    { ankle: BINDINGS[1], yaw: BINDING_YAW[1], knee: [0, 0.05, -1] },
  ],
  hands: [
    { at: [-0.62, 1.42, -0.05], elbow: [-0.4, -0.7, 0.5] },
    { at: [0.62, 1.4, -0.05], elbow: [0.4, -0.7, 0.5] },
  ],
  board: { at: [0, 0.02, -0.03], pitch: 0, yaw: 0, roll: 0 },
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
 * Crash tumble: balled up, knees to the chest with the board still on, the
 * knees wide and the arms wrapped round the shins. In game the whole body
 * rolls round BOARD_TUMBLE_CENTER.
 */
export const BOARD_TUMBLE: PoseDef = {
  pelvis: [0, 0.57, 0.1],
  pelvisPitch: 0.49,
  pelvisYaw: 0.3,
  pelvisRoll: 0,
  chestPitch: 0.45,
  chestYaw: 0.21,
  chestRoll: 0,
  headPitch: -0.4,
  headYaw: -0.01,
  feet: [
    { ankle: BINDINGS[0], yaw: BINDING_YAW[0], knee: [-0.96, 0.22, -0.64] },
    { ankle: BINDINGS[1], yaw: BINDING_YAW[1], knee: [0.69, 0.3, -0.58] },
  ],
  hands: [
    { at: [-0.22, 0.62, -0.42], elbow: [-0.8, -0.4, 0.2] },
    { at: [0.22, 0.62, -0.36], elbow: [0.8, -0.4, 0.2] },
  ],
  board: { at: [0, 0.15, -0.12], pitch: 0.08, roll: 0 },
};

/** Middle of the balled-up tumble, in skier space. */
export const BOARD_TUMBLE_CENTER: Vec3 = [0, 0.56, -0.08];

/** Heel-side slam: the heel edge caught, thrown back onto the seat and shoulders, knees apart, arms flung back. */
export const BOARD_SLAM_HEEL: PoseDef = {
  pelvis: [0, 0.32, 0.4],
  pelvisPitch: -0.6,
  pelvisYaw: 0.1,
  pelvisRoll: 0,
  chestPitch: -0.45,
  chestYaw: 0.1,
  chestRoll: 0,
  headPitch: 0.35,
  headYaw: 0,
  feet: [
    { ankle: BINDINGS[0], yaw: BINDING_YAW[0], knee: [-0.6, 0.4, -0.6] },
    { ankle: BINDINGS[1], yaw: BINDING_YAW[1], knee: [0.6, 0.4, -0.6] },
  ],
  hands: [
    { at: [-0.42, 0.3, 0.75], elbow: [-0.6, 0.3, -0.5] },
    { at: [0.42, 0.3, 0.75], elbow: [0.6, 0.3, -0.5] },
  ],
  board: { at: [0, 0.12, -0.25], pitch: 0, roll: -0.6 },
};

/** Toe-side slam: the toe edge caught, thrown forward onto the knees and chest, hands out to catch the fall. */
export const BOARD_SLAM_TOE: PoseDef = {
  pelvis: [0, 0.48, -0.25],
  pelvisPitch: 0.9,
  pelvisYaw: 0.1,
  pelvisRoll: 0,
  chestPitch: 0.8,
  chestYaw: 0.1,
  chestRoll: 0,
  headPitch: -0.41,
  headYaw: 0,
  feet: [
    { ankle: BINDINGS[0], yaw: BINDING_YAW[0], knee: [-0.49, -0.5, -0.98] },
    { ankle: BINDINGS[1], yaw: BINDING_YAW[1], knee: [0.5, -0.5, -1] },
  ],
  hands: [
    { at: [-0.36, 0.25, -0.95], elbow: [-0.6, 0.2, 0.5] },
    { at: [0.36, 0.25, -0.95], elbow: [0.6, 0.2, 0.5] },
  ],
  board: { at: [0, 0.27, 0.28], pitch: 0, roll: 1.07 },
};

/** The back foot out of its binding for the skating push (Shift): where it plants on the toe side, and how far back it drives. */
export const PUSH_FOOT: FootDef = { ankle: [0.12, 0.16, -0.27], yaw: 0.15 };
export const PUSH_BACK = 0.3;
