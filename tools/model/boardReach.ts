// Every snowboard pose (milestone 22) through the real rig: how far each
// hand or foot falls short of where the pose puts it, and how far a boot
// bends past what an ankle allows. Run from the repo root:
//   node tools/model/boardReach.ts
// Grabs hold the board with the hand, so a short hand is a grab that
// doesn't reach.

import { BINDINGS, BOARD_CHAIR, BOARD_CROUCH, BOARD_GRABS, BOARD_NOSE_PRESS, BOARD_SLAM_HEEL, BOARD_SLAM_TOE, BOARD_STANCE, BOARD_TAIL_PRESS, BOARD_TUCK, BOARD_TUMBLE } from '../../src/render/boardPoses.ts';
import { createPoseBuffer, setPose } from '../../src/render/poseBlend.ts';
import { SkierRig } from '../../src/render/skierRig.ts';
import type { PoseDef } from '../../src/render/skierPoses.ts';
import { GRAB_ACTIONS } from '../../src/core/input.ts';
import { Quaternion, Vector3 } from 'three';
import { BOARD_TYPES, boardType, type BoardId } from '../../src/core/boards.ts';
import { DEFAULT_OUTFIT, type Outfit } from '../../src/core/outfit.ts';

// "--board-type <park|freeride|carving>" (milestone 22 part 2) checks that
// board in its first graphic (the park board without it, so the output
// stays the same). Taken out of the arguments before they're read.
const typeAt = process.argv.indexOf('--board-type');
const boardTypeId = (typeAt >= 0 ? process.argv.splice(typeAt, 2)[1] : 'park') as BoardId;
if (!BOARD_TYPES.some((t) => t.id === boardTypeId)) throw new Error(`--board-type takes one of: ${BOARD_TYPES.map((t) => t.id).join(', ')}`);
const BOARD_OUTFIT: Outfit = { ...DEFAULT_OUTFIT, board: boardTypeId, boardGraphic: boardType(boardTypeId).graphics[0]!.id };
if (boardTypeId !== 'park') console.log(`(the ${boardTypeId} board)`);


const want = new Vector3();

const rig = new SkierRig(BOARD_OUTFIT);
rig.setBoard(true);
const buffer = createPoseBuffer();
const poses: [string, PoseDef][] = [
  ['stance', BOARD_STANCE],
  ['crouch', BOARD_CROUCH],
  ['tuck', BOARD_TUCK],
  ['nose press', BOARD_NOSE_PRESS],
  ['tail press', BOARD_TAIL_PRESS],
  ['chair', BOARD_CHAIR],
  ...BOARD_GRABS.map((p, i) => [GRAB_ACTIONS[i]!, p] as [string, PoseDef]),
  ['tumble', BOARD_TUMBLE],
  ['heel slam', BOARD_SLAM_HEEL],
  ['toe slam', BOARD_SLAM_TOE],
];
let problems = 0;
for (const [name, pose] of poses) {
  setPose(buffer, pose);
  rig.apply(buffer);
  const bad = rig.reachError > 0.02 || rig.ankleError > 0;
  if (bad) problems++;
  // Which limb: each hand against its grip on the board (the rig's solved hands are where the arms got to).
  const r = rig as unknown as { hands: { x: number; y: number; z: number }[]; ankles: { x: number; y: number; z: number }[]; boardPos: Vector3; boardQ: Quaternion };
  const notes: string[] = [];
  for (let i = 0; i < 2; i++) {
    const h = buffer.hands[i === 0 ? 0 : 1];
    if (h.boardWeight > 0) want.set(h.boardOn[0], h.boardOn[1], h.boardOn[2]).applyQuaternion(r.boardQ).add(r.boardPos);
    else want.set(h.at[0], h.at[1], h.at[2]);
    const miss = want.distanceTo(new Vector3(r.hands[i]!.x, r.hands[i]!.y, r.hands[i]!.z));
    if (miss > 0.01) notes.push(`${i === 0 ? 'front' : 'rear'} hand ${(miss * 100).toFixed(0)} cm short${h.boardWeight > 0 ? ' of the board' : ''}`);
    const b = BINDINGS[i === 0 ? 0 : 1];
    want.set(b[0], b[1], b[2]).applyQuaternion(r.boardQ).add(r.boardPos);
    const foot = want.distanceTo(new Vector3(r.ankles[i]!.x, r.ankles[i]!.y, r.ankles[i]!.z));
    if (foot > 0.01 && !(i === 1 && buffer.board.free > 0)) notes.push(`${i === 0 ? 'front' : 'rear'} foot ${(foot * 100).toFixed(0)} cm off its binding`);
  }
  console.log(`${name.padEnd(18)} reach short ${(rig.reachError * 100).toFixed(1).padStart(5)} cm, ankle past ${rig.ankleError.toFixed(0).padStart(3)}°${bad ? '  PROBLEM' : ''}${notes.length ? ' (' + notes.join(', ') + ')' : ''}`);
}
console.log(`${problems} problems`);
