// Skier model clearance check: poses the real rig (every pose in the pose
// gallery, the riding states, and a pole push from the stance, a crouch and
// a tuck) and reports where parts pass through each other:
// - poles: how much of each pole shaft runs inside the body;
// - jacket: thigh points that poke out through the jacket: above its hem and
//   inside its usual outline (where the jacket should cover them), yet
//   outside the jacket as it's drawn.
// - elbows: through each pole push, the furthest an elbow moves in 1% of the
//   stroke, against how far the hand moves (an elbow flipping round the arm
//   moves far while the hand barely does).
//   node tools/model/clearance.ts            every state
//   node tools/model/clearance.ts tuck       states whose name contains "tuck"
// Inside means inside a part's closed surface, found by counting how many
// times a ray from the point crosses it, along two rays that must agree (a
// ray grazing a seam can miscount). The hem is an open tube, so its rays run
// across the tube: sideways and front to back in the hips' frame.

import { DoubleSide, Mesh, Raycaster, Scene, Vector3, type Material } from 'three';
import { CONFIG } from '../../src/config.ts';
import type { Heightfield } from '../../src/maps/types.ts';
import { createSkierPose, SkierView, type SkierPose } from '../../src/render/skierView.ts';
import { BODY, JACKET_LAYOUT, SkierRig, THIGH_RADIUS } from '../../src/render/skierRig.ts';
import {
  CROUCH,
  LEFT_JAPAN,
  LEFT_MUTE,
  LEFT_SAFETY,
  LEFT_TAIL,
  RIGHT_JAPAN,
  RIGHT_MUTE,
  RIGHT_SAFETY,
  RIGHT_TAIL,
  STANCE,
  TUCK,
  TUMBLE,
  type PoseDef,
} from '../../src/render/skierPoses.ts';

interface Ride {
  speed?: number;
  crouch?: number;
  lean?: number;
  brake?: number;
  polePhase?: number;
}

const STATES: [string, PoseDef | Ride][] = [
  ['stance', STANCE],
  ['crouch', CROUCH],
  ['tuck pose', TUCK],
  ['left mute', LEFT_MUTE],
  ['right mute', RIGHT_MUTE],
  ['left safety', LEFT_SAFETY],
  ['right safety', RIGHT_SAFETY],
  ['left japan', LEFT_JAPAN],
  ['right japan', RIGHT_JAPAN],
  ['left tail', LEFT_TAIL],
  ['right tail', RIGHT_TAIL],
  ['tumble', TUMBLE],
  ['ride: carve', { speed: 12, lean: 0.85 }],
  ['ride: crouch carve', { speed: 5, crouch: 1, lean: 0.6 }],
  ['ride: tuck', { speed: 15, crouch: 1 }],
  ['ride: tuck carve', { speed: 15, crouch: 1, lean: 0.85 }],
  ['ride: hockey stop', { speed: 8, brake: 1 }],
];
for (const [name, ride] of [
  ['stance', { speed: 4 }],
  ['crouch', { speed: 4, crouch: 1 }],
  ['tuck', { speed: 15, crouch: 1 }],
] as const) {
  for (const phase of [0.07, 0.15, 0.25, 0.4, 0.5, 0.65, 0.85]) STATES.push([`push ${name} ${phase}`, { ...ride, polePhase: phase }]);
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

/** A riding state posed the way the game poses it, after settling for a moment. */
function rideRig(r: Ride): SkierRig {
  const view = new SkierView(new Scene(), flat);
  const pose: SkierPose = createSkierPose();
  pose.center.set(0, CONFIG.air.comHeight, 0);
  pose.velocity.set(0, 0, -(r.speed ?? 0));
  pose.crouch = r.crouch ?? 0;
  pose.lean = r.lean ?? 0;
  pose.brake = r.brake ?? 0;
  pose.brakeSide = 1;
  view.snap(pose);
  // A pole push is already under way: ride up to the phase so eased weights settle as in the game.
  const phase = r.polePhase ?? 1;
  const steps = 30;
  for (let i = 0; i <= steps; i++) {
    pose.polePhase = phase < 1 ? (phase * i) / steps : 1;
    view.update(pose, phase < 1 ? (phase * TUNING_INTERVAL) / steps : 0.05);
  }
  return view.rig;
}
const TUNING_INTERVAL = CONFIG.skier.polePushInterval;

const ray = new Raycaster();
const across = new Vector3();
const ahead = new Vector3();
const p = new Vector3();
const q = new Vector3();

/** Whether world point `pt` is inside `mesh`, crossing it along `dir`. */
function inside(mesh: Mesh, pt: Vector3, dir: Vector3): boolean {
  ray.set(pt, dir);
  return ray.intersectObject(mesh, false).length % 2 === 1;
}

/** Height of the jacket's bottom edge in the hips' frame at angle a from the front. */
const hemLow = JACKET_LAYOUT.hemLow;
/** Lines along each thigh run just inside its surface. */
const THIGH_LINE = THIGH_RADIUS - 0.006;

const filter = process.argv[2]?.toLowerCase();
let worst = 0;
for (const [name, def] of STATES) {
  if (filter && !name.includes(filter)) continue;
  let rig: SkierRig;
  if ('pelvis' in def) {
    rig = new SkierRig();
    rig.apply(def);
  } else {
    rig = rideRig(def);
  }
  rig.root.updateMatrixWorld(true);
  const parts = rig.parts();
  rig.root.traverse((o) => {
    if (o instanceof Mesh) (o.material as Material).side = DoubleSide;
  });
  // Sideways in the hips' frame: across the jacket's tube.
  across.set(1, 0, 0).transformDirection(parts.hem.matrixWorld);
  ahead.set(0, 0.2, -1).normalize().transformDirection(parts.hem.matrixWorld);

  // Poles: 2 cm steps along the shaft, past the glove.
  const bodies: [string, Mesh][] = [
    ['torso', parts.torso],
    ['hips', parts.pelvis],
    ['jacket', parts.hem],
    ['head', parts.head],
    ...[0, 1].flatMap((i): [string, Mesh][] => [
      [`thigh${i}`, parts.thighs[i]!],
      [`shin${i}`, parts.shins[i]!],
      [`arm${i}`, parts.upperArms[i]!],
      [`forearm${i}`, parts.forearms[i]!],
    ]),
  ];
  const poleReport: string[] = [];
  for (let side = 0; side < 2; side++) {
    const pole = parts.poles[side]!;
    const hits = new Map<string, number>();
    for (let t = 0.14; t <= 1.1; t += 0.02) {
      p.set(0, -t, 0).applyMatrix4(pole.matrixWorld);
      for (const [part, mesh] of bodies) {
        if (part === `forearm${side}` && t < 0.2) continue;
        if (inside(mesh, p, across) && inside(mesh, p, ahead)) hits.set(part, (hits.get(part) ?? 0) + 2);
      }
    }
    const total = [...hits.values()].reduce((a, b) => a + b, 0);
    worst = Math.max(worst, total);
    if (total) poleReport.push(`${side ? 'R' : 'L'} pole ${[...hits].map(([k, v]) => `${k} ${v}`).join(', ')} cm`);
  }

  // Jacket: lines along each thigh's surface, from the hip to the knee. A
  // thigh should leave the jacket under its hem; a line that crosses the
  // jacket higher up is the leg coming through the jacket's panel.
  const inv = parts.hem.matrixWorld.clone().invert();
  let poke = 0;
  let deepest = 0;
  for (const thigh of parts.thighs) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      p.set(Math.sin(a) * THIGH_LINE, 0, -Math.cos(a) * THIGH_LINE).applyMatrix4(thigh.matrixWorld);
      q.set(Math.sin(a) * THIGH_LINE, BODY.thigh, -Math.cos(a) * THIGH_LINE).applyMatrix4(thigh.matrixWorld);
      const dir = q.clone().sub(p);
      const len = dir.length();
      ray.set(p, dir.normalize());
      ray.far = len;
      let through = false;
      for (const hit of ray.intersectObject(parts.hem, false)) {
        // Crossing the hem's edge or lip is the thigh leaving from under the jacket.
        const band = Math.floor((hit.faceIndex ?? 0) / (JACKET_LAYOUT.segments * 2));
        if (band >= JACKET_LAYOUT.bodyBands) continue;
        const h = hit.point.clone().applyMatrix4(inv); // hips' frame
        through = true;
        deepest = Math.max(deepest, h.y - hemLow(Math.atan2(h.x, -h.z)));
      }
      if (through) poke++;
      ray.far = Infinity;
    }
  }
  const jacket = poke ? `jacket: ${poke}/16 thigh lines through the panel, up to ${(deepest * 100).toFixed(0)} cm above where the hem hangs` : '';
  console.log(`${name.padEnd(22)} ${[...poleReport, jacket].filter(Boolean).join(' | ') || 'clear'}`);
  rig.dispose();
}
console.log(`worst pole: ${worst} cm inside the body`);

// Elbow swing through a whole pole push, in 1% steps of the stroke.
const elbow = [new Vector3(), new Vector3()];
const hand = [new Vector3(), new Vector3()];
for (const [name, r] of [
  ['stance', { speed: 4 }],
  ['crouch', { speed: 4, crouch: 1 }],
  ['part tuck', { speed: 8.5, crouch: 1 }],
  ['tuck', { speed: 15, crouch: 1 }],
] as const) {
  if (filter && !`push ${name}`.includes(filter)) continue;
  const view = new SkierView(new Scene(), flat);
  const pose: SkierPose = createSkierPose();
  pose.center.set(0, CONFIG.air.comHeight, 0);
  pose.velocity.set(0, 0, -r.speed);
  pose.crouch = 'crouch' in r ? r.crouch : 0;
  view.snap(pose);
  view.update(pose, 0.05);
  const parts = view.rig.parts();
  let worstElbow = 0;
  let at = 0;
  let handThen = 0;
  for (let step = 0; step <= 100; step++) {
    pose.polePhase = step < 100 ? step / 100 : 1;
    view.update(pose, TUNING_INTERVAL / 100);
    view.rig.root.updateMatrixWorld(true);
    for (let i = 0; i < 2; i++) {
      const fa = parts.forearms[i]!;
      p.copy(fa.position);
      q.set(0, BODY.forearm + BODY.hand, 0).applyQuaternion(fa.quaternion).add(fa.position);
      if (step > 0) {
        const moved = p.distanceTo(elbow[i]!);
        if (moved > worstElbow) {
          worstElbow = moved;
          at = step;
          handThen = q.distanceTo(hand[i]!);
        }
      }
      elbow[i]!.copy(p);
      hand[i]!.copy(q);
    }
  }
  console.log(`push ${name.padEnd(17)} elbow: up to ${(worstElbow * 100).toFixed(1)} cm in 1% of the stroke (at ${at}%, hand moved ${(handThen * 100).toFixed(1)} cm)`);
  view.rig.dispose();
}
