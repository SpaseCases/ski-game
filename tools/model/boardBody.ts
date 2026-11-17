// The snowboard rider's body against itself (milestone 22): for every board
// pose and riding state, the parts that pass through each other, and how
// far each knee bends. Run from the repo root:
//   node tools/model/boardBody.ts            every state
//   node tools/model/boardBody.ts mute       states whose name contains "mute"
//   node tools/model/boardBody.ts --skis     the ski poses too, for comparison
// For each state (the board poses were tuned to these: no part through another
// beyond a few points, knees no tighter than about 40°):
// - knees: each knee's angle (180° is a straight leg) and the torso's lean
//   from upright;
// - through: points of one part inside another, by pair: a leg in the torso,
//   a leg in the other leg, an arm in the torso or a leg, the head in the
//   limbs, the board's top in the body. Joints overlap where parts meet, so
//   the ends of a limb by its own joint don't count (the top of a thigh by
//   its hip, the top of an upper arm by its shoulder). A count is vertices
//   of the first part's mesh, so it reads as how much, not how deep;
// - collar: points of the head inside the torso, apart from the count:
//   the neck always sits down in the jacket's collar (about 30 standing,
//   more with the head bowed).
// Inside means inside a part's closed surface, by counting how many times a
// ray from the point crosses it, along two rays that must agree.

import { DoubleSide, Mesh, Raycaster, Scene, Sphere, Vector3, type Material } from 'three';
import { CONFIG } from '../../src/config.ts';
import type { Heightfield } from '../../src/maps/types.ts';
import { createSkierPose, SkierView, type SkierPose } from '../../src/render/skierView.ts';
import { SkierRig } from '../../src/render/skierRig.ts';
import { createPoseBuffer, setPose } from '../../src/render/poseBlend.ts';
import {
  BOARD_CHAIR,
  BOARD_CROUCH,
  BOARD_GRABS,
  BOARD_NOSE_PRESS,
  BOARD_SLAM_HEEL,
  BOARD_SLAM_TOE,
  BOARD_STANCE,
  BOARD_TAIL_PRESS,
  BOARD_TUCK,
  BOARD_TUMBLE,
} from '../../src/render/boardPoses.ts';
import { CROUCH, LEFT_JAPAN, LEFT_MUTE, LEFT_NOSE, LEFT_SAFETY, LEFT_TAIL, STANCE, TUCK, TUMBLE, type PoseDef } from '../../src/render/skierPoses.ts';

interface Ride {
  speed?: number;
  crouch?: number;
  lean?: number;
  brake?: number;
  polePhase?: number;
  butter?: number;
  rail?: number;
}
type State = [string, PoseDef | Ride, boolean];

/** BOARD_GRABS in order (render/boardPoses.ts). */
const GRAB_NAMES = ['mute', 'melon', 'method', 'japan', 'indy', 'stalefish', 'roast beef', 'tail grab', 'nose grab', 'crail', 'shifty', 'poke', 'rocket air', 'stiffy'];

const args = process.argv.slice(2);
const withSkis = args.includes('--skis');
const filter = args.find((a) => !a.startsWith('--'))?.toLowerCase();

const STATES: State[] = [
  ['stance', BOARD_STANCE, true],
  ['crouch', BOARD_CROUCH, true],
  ['tuck', BOARD_TUCK, true],
  ['nose press', BOARD_NOSE_PRESS, true],
  ['tail press', BOARD_TAIL_PRESS, true],
  ['chair', BOARD_CHAIR, true],
  ...BOARD_GRABS.map((def, i): State => [GRAB_NAMES[i]!, def, true]),
  ['tumble', BOARD_TUMBLE, true],
  ['heel slam', BOARD_SLAM_HEEL, true],
  ['toe slam', BOARD_SLAM_TOE, true],
  ['ride: straight', { speed: 10 }, true],
  ['ride: heel carve', { speed: 12, lean: 0.85 }, true],
  ['ride: toe carve', { speed: 12, lean: -0.85 }, true],
  ['ride: crouch', { speed: 5, crouch: 1 }, true],
  ['ride: crouch carve', { speed: 5, crouch: 1, lean: 0.6 }, true],
  ['ride: tuck', { speed: 15, crouch: 1 }, true],
  ['ride: tuck carve', { speed: 15, crouch: 1, lean: -0.85 }, true],
  ['ride: hockey stop', { speed: 8, brake: 1 }, true],
  ['ride: nose press', { speed: 6, butter: 1 }, true],
  ['ride: tail press', { speed: 6, butter: -1 }, true],
  ['ride: fakie', { speed: -8 }, true],
  ...[0.1, 0.3, 0.6, 0.82].map((phase): State => [`ride: push ${phase}`, { speed: 3, polePhase: phase }, true]),
];
if (withSkis) {
  STATES.push(
    ['skis: stance', STANCE, false],
    ['skis: crouch', CROUCH, false],
    ['skis: tuck', TUCK, false],
    ['skis: left mute', LEFT_MUTE, false],
    ['skis: left safety', LEFT_SAFETY, false],
    ['skis: left japan', LEFT_JAPAN, false],
    ['skis: left tail', LEFT_TAIL, false],
    ['skis: left nose', LEFT_NOSE, false],
    ['skis: tumble', TUMBLE, false],
  );
}

const flat: Heightfield = {
  cols: 5,
  rows: 5,
  cellSize: 2,
  originX: -4,
  originZ: -4,
  heights: new Float32Array(25),
  bounds: { minX: -4, maxX: 4, minZ: -4, maxZ: 4, polygon: new Float32Array(0) },
};

function rideRig(r: Ride): SkierRig {
  const view = new SkierView(new Scene(), flat);
  view.setRide(true, false);
  const pose: SkierPose = createSkierPose();
  pose.center.set(0, CONFIG.air.comHeight, 0);
  pose.velocity.set(0, 0, -(r.speed ?? 0));
  pose.crouch = r.crouch ?? 0;
  pose.lean = r.lean ?? 0;
  pose.brake = r.brake ?? 0;
  pose.brakeSide = 1;
  pose.butter = r.butter ?? 0;
  pose.butterAmount = r.butter ? 1 : 0;
  pose.polePhase = 1;
  view.snap(pose);
  const phase = r.polePhase ?? 1;
  const steps = 30;
  for (let i = 0; i <= steps; i++) {
    pose.polePhase = phase < 1 ? (phase * i) / steps : 1;
    view.update(pose, phase < 1 ? (phase * CONFIG.skier.polePushInterval) / steps : 0.05);
  }
  return view.rig;
}

const ray = new Raycaster();
const rayA = new Vector3(0.31, 0.83, 0.47).normalize();
const rayB = new Vector3(-0.62, -0.21, 0.76).normalize();
const p = new Vector3();
const a = new Vector3();
const b = new Vector3();
const sphere = new Sphere();

function inside(mesh: Mesh, pt: Vector3): boolean {
  sphere.copy(mesh.geometry.boundingSphere!).applyMatrix4(mesh.matrixWorld);
  if (!sphere.containsPoint(pt)) return false;
  ray.set(pt, rayA);
  if (ray.intersectObject(mesh, false).length % 2 === 0) return false;
  ray.set(pt, rayB);
  return ray.intersectObject(mesh, false).length % 2 === 1;
}

/** Vertices of `from` (skipping those within `skip` m of its origin along its +Y, the joint it hangs from) inside `into`. */
function through(from: Mesh, into: Mesh, skip = 0): number {
  const pos = from.geometry.getAttribute('position');
  const seen = new Set<string>();
  let n = 0;
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    if (p.y < skip) continue;
    const key = `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    p.applyMatrix4(from.matrixWorld);
    if (inside(into, p)) n++;
  }
  return n;
}

const deg = (r: number): number => Math.round((r * 180) / Math.PI);
let total = 0;
for (const [name, def, board] of STATES) {
  if (filter && !name.toLowerCase().includes(filter)) continue;
  let rig: SkierRig;
  if ('pelvis' in def) {
    rig = new SkierRig();
    if (board) {
      rig.setBoard(true);
      const buffer = createPoseBuffer();
      setPose(buffer, def);
      rig.apply(buffer);
    } else rig.apply(def);
  } else rig = rideRig(def);
  rig.root.updateMatrixWorld(true);
  rig.root.traverse((o) => {
    if (o instanceof Mesh) {
      (o.material as Material).side = DoubleSide;
      o.geometry.computeBoundingSphere();
    }
  });
  const P = rig.parts();
  const hits: [string, number][] = [];
  const add = (label: string, n: number): void => {
    if (n > 0) hits.push([label, n]);
  };
  for (let i = 0; i < 2; i++) {
    const j = 1 - i;
    const L = i === 0 ? 'F' : 'R';
    add(`thigh${L}>torso`, through(P.thighs[i]!, P.torso, 0.16));
    add(`shin${L}>torso`, through(P.shins[i]!, P.torso));
    add(`thigh${L}>thigh`, through(P.thighs[i]!, P.thighs[j]!, 0.12));
    add(`shin${L}>shin`, through(P.shins[i]!, P.shins[j]!));
    add(`shin${L}>thigh`, through(P.shins[i]!, P.thighs[j]!));
    add(`shin${L}>ownthigh`, through(P.shins[i]!, P.thighs[i]!, 0.12));
    add(`fore${L}>torso`, through(P.forearms[i]!, P.torso));
    add(`arm${L}>torso`, through(P.upperArms[i]!, P.torso, 0.12));
    for (let k = 0; k < 2; k++) {
      const K = k === 0 ? 'F' : 'R';
      add(`fore${L}>thigh${K}`, through(P.forearms[i]!, P.thighs[k]!));
      add(`fore${L}>shin${K}`, through(P.forearms[i]!, P.shins[k]!));
      add(`arm${L}>thigh${K}`, through(P.upperArms[i]!, P.thighs[k]!));
    }
  }
  for (const m of [P.thighs[0]!, P.thighs[1]!, P.shins[0]!, P.shins[1]!, P.upperArms[0]!, P.upperArms[1]!]) add('head>limb', through(P.head, m));
  const collar = through(P.head, P.torso);
  if (board) {
    let n = 0;
    for (let x = -0.7; x <= 0.701; x += 0.05) {
      for (let z = -0.1; z <= 0.101; z += 0.05) {
        p.set(x, 0.03, z).applyMatrix4(P.board.matrixWorld);
        for (const m of [P.torso, P.pelvis, ...P.thighs, ...P.shins, ...P.upperArms, ...P.forearms]) if (inside(m, p)) n++;
      }
    }
    add('board>body', n);
  }
  // Knee angles (hip, knee, ankle from the thigh and shin meshes) and the torso's lean.
  const knees: string[] = [];
  for (let i = 0; i < 2; i++) {
    const hip = P.thighs[i]!.getWorldPosition(new Vector3());
    const knee = P.shins[i]!.getWorldPosition(new Vector3());
    const ankle = P.feet[i]!.getWorldPosition(new Vector3());
    a.subVectors(hip, knee).normalize();
    b.subVectors(ankle, knee).normalize();
    knees.push(`${deg(Math.acos(Math.min(1, Math.max(-1, a.dot(b)))))}`);
  }
  const up = new Vector3(0, 1, 0).applyQuaternion(P.torso.getWorldQuaternion(new (P.torso.quaternion.constructor as typeof P.torso.quaternion)()));
  const lean = deg(Math.acos(Math.min(1, up.y)));
  const sum = hits.reduce((s, h) => s + h[1], 0);
  total += sum;
  const reach = rig.reachError > 0.02 ? ` SHORT ${(rig.reachError * 100).toFixed(0)}cm` : '';
  const ankle = rig.ankleError > 0 ? ` BOOT ${rig.ankleError.toFixed(0)}°` : '';
  console.log(
    `${name.padEnd(20)} knees ${knees.join('/').padEnd(8)} lean ${String(lean).padStart(3)}°  collar ${String(collar).padStart(3)}  through ${String(sum).padStart(3)}${reach}${ankle}  ${hits.map(([k, v]) => `${k} ${v}`).join(', ')}`,
  );
  rig.dispose();
}
console.log(`total through: ${total}`);
