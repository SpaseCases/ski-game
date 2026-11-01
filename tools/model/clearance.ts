// Skier model clearance check: poses the real rig (every pose in the pose
// gallery, the riding states, and a pole push from the stance, a crouch and
// a tuck) and reports where parts pass through each other:
// - poles: how much of each pole shaft runs inside the body;
// - jacket: thigh points that poke out through the jacket: above its hem and
//   inside its usual outline (where the jacket should cover them), yet
//   outside the jacket as it's drawn.
// - grabbing arm: how close the forearm passes to the grabbed ski's
//   centerline (about 10 cm is the hand on the ski; much less is the arm
//   through it);
// - elbows: through each pole push, the furthest an elbow moves in 1% of the
//   stroke, against how far the hand moves (an elbow flipping round the arm
//   moves far while the hand barely does).
// Then every state again with the poles off, plus skating pushes off each
// leg (skis: how close the pushing ski's centerline comes to the other
// ski's, and any point of it inside the other ski), and every state in
// each headwear (head: points of the head and hat inside the torso, an arm
// or a thigh; the helmet's count is the baseline).
//   node tools/model/clearance.ts            every state
//   node tools/model/clearance.ts tuck       states whose name contains "tuck"
// Inside means inside a part's closed surface, found by counting how many
// times a ray from the point crosses it, along two rays that must agree (a
// ray grazing a seam can miscount). The hem is an open tube, so its rays run
// across the tube: sideways and front to back in the hips' frame.

import { DoubleSide, Mesh, Raycaster, Scene, Sphere, Vector3, type Material } from 'three';
import { CONFIG } from '../../src/config.ts';
import type { Heightfield } from '../../src/maps/types.ts';
import { createSkierPose, SkierView, type SkierPose } from '../../src/render/skierView.ts';
import { BODY, JACKET_LAYOUT, SkierRig, THIGH_RADIUS } from '../../src/render/skierRig.ts';
import { DEFAULT_OUTFIT, HEADWEAR, type Outfit } from '../../src/core/outfit.ts';
import {
  CROUCH,
  DAFFY,
  IRON_CROSS,
  LEFT_NOSE,
  RIGHT_NOSE,
  SEAMAN,
  SPREAD_EAGLE,
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
  butter?: number;
  /** With the poles off, the leg a push skates off (-1 left, 1 right). */
  skate?: number;
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
  ['left nose', LEFT_NOSE],
  ['right nose', RIGHT_NOSE],
  ['seaman', SEAMAN],
  ['daffy', DAFFY],
  ['iron cross', IRON_CROSS],
  ['spread eagle', SPREAD_EAGLE],
  ['tumble', TUMBLE],
  ['ride: carve', { speed: 12, lean: 0.85 }],
  ['ride: crouch carve', { speed: 5, crouch: 1, lean: 0.6 }],
  ['ride: tuck', { speed: 15, crouch: 1 }],
  ['ride: tuck carve', { speed: 15, crouch: 1, lean: 0.85 }],
  ['ride: hockey stop', { speed: 8, brake: 1 }],
  ['ride: nose press', { speed: 6, butter: 1 }],
  ['ride: tail press', { speed: 6, butter: -1 }],
];
for (const [name, ride] of [
  ['stance', { speed: 4 }],
  ['crouch', { speed: 4, crouch: 1 }],
  ['tuck', { speed: 15, crouch: 1 }],
] as const) {
  for (const phase of [0.07, 0.15, 0.25, 0.4, 0.5, 0.65, 0.85]) STATES.push([`push ${name} ${phase}`, { ...ride, polePhase: phase }]);
}
/** Skating pushes: only with the poles off. */
const SKATES: [string, Ride][] = [];
for (const [name, ride] of [
  ['stance', { speed: 4 }],
  ['crouch', { speed: 4, crouch: 1 }],
  ['carve', { speed: 6, lean: 0.5 }],
] as const) {
  for (const skate of [-1, 1]) {
    for (const phase of [0.1, 0.2, 0.3, 0.45, 0.6, 0.75, 0.82, 0.9]) SKATES.push([`skate ${skate < 0 ? 'L' : 'R'} ${name} ${phase}`, { ...ride, skate, polePhase: phase }]);
  }
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
function rideRig(r: Ride, outfit: Outfit = DEFAULT_OUTFIT): SkierRig {
  const view = new SkierView(new Scene(), flat, outfit);
  const pose: SkierPose = createSkierPose();
  pose.center.set(0, CONFIG.air.comHeight, 0);
  pose.velocity.set(0, 0, -(r.speed ?? 0));
  pose.crouch = r.crouch ?? 0;
  pose.lean = r.lean ?? 0;
  pose.brake = r.brake ?? 0;
  pose.brakeSide = 1;
  pose.butter = r.butter ?? 0;
  pose.butterAmount = r.butter ? 1 : 0;
  // Snapped mid-push, the push skates off the left leg; from no push, the first one is off the right.
  pose.polePhase = r.skate === -1 ? 0 : 1;
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

/**
 * Checks one state in `outfit`: the poles (when carried) and the jacket,
 * and with `head`, the head and hat against the body, and with `skis`, the
 * pushing ski against the other. Returns the report line and the head count.
 */
function check(name: string, def: PoseDef | Ride, outfit: Outfit, head: boolean, skis: boolean): { line: string; head: number } {
  let rig: SkierRig;
  if ('pelvis' in def) {
    rig = new SkierRig(outfit);
    rig.apply(def);
  } else {
    rig = rideRig(def, outfit);
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
  for (let side = 0; side < (rig.hasPoles ? 2 : 0); side++) {
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
  // Grabbing arm: elbow to wrist against the grabbed ski's centerline, tip to tail.
  let armReport = '';
  if ('pelvis' in def) {
    for (let h = 0; h < 2; h++) {
      const ski = def.hands[h === 0 ? 0 : 1].grab;
      if (ski === undefined) continue;
      const foot = parts.feet[ski]!;
      const fore = parts.forearms[h]!;
      const elbow = fore.getWorldPosition(new Vector3());
      const wrist = new Vector3(0, BODY.forearm - 0.02, 0).applyMatrix4(fore.matrixWorld);
      const tip = new Vector3(0, 0.02 - BODY.ankleHeight, -0.9 - BODY.ankleBack).applyMatrix4(foot.matrixWorld);
      const tail = new Vector3(0, 0.02 - BODY.ankleHeight, 0.9 - BODY.ankleBack).applyMatrix4(foot.matrixWorld);
      let near = Infinity;
      for (let i = 0; i <= 20; i++) {
        p.lerpVectors(elbow, wrist, i / 20);
        for (let j = 0; j <= 60; j++) near = Math.min(near, p.distanceTo(q.lerpVectors(tip, tail, j / 60)));
      }
      armReport = `arm ${(near * 100).toFixed(0)} cm from the ski${near < 0.08 ? ' (through it)' : ''}`;
    }
  }
  const jacket = poke ? `jacket: ${poke}/16 thigh lines through the panel, up to ${(deepest * 100).toFixed(0)} cm above where the hem hangs` : '';

  // Head and hat: their points inside the torso, an arm or a thigh.
  let headIn = 0;
  const headParts: [string, Mesh][] = [
    ['torso', parts.torso],
    ...[0, 1].flatMap((i): [string, Mesh][] => [
      [`arm${i}`, parts.upperArms[i]!],
      [`forearm${i}`, parts.forearms[i]!],
      [`thigh${i}`, parts.thighs[i]!],
    ]),
  ];
  const headHits = new Map<string, number>();
  if (head) {
    for (const m of headParts) m[1].geometry.computeBoundingSphere();
    const sphere = new Sphere();
    const meshes = [parts.head, ...parts.head.children.filter((c): c is Mesh => c instanceof Mesh && c.visible)];
    const seen = new Set<string>();
    for (const mesh of meshes) {
      const pos = mesh.geometry.getAttribute('position');
      if (!pos) continue;
      for (let i = 0; i < pos.count; i++) {
        p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        const key = `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        for (const [part, m] of headParts) {
          sphere.copy(m.geometry.boundingSphere!).applyMatrix4(m.matrixWorld);
          if (!sphere.containsPoint(p)) continue;
          if (inside(m, p, across) && inside(m, p, ahead)) {
            headIn++;
            headHits.set(part, (headHits.get(part) ?? 0) + 1);
          }
        }
      }
    }
  }
  const headReport = headIn ? `head: ${headIn} points inside (${[...headHits].map(([k, v]) => `${k} ${v}`).join(', ')})` : '';

  // Skis: the pushing ski's centerline against the other ski.
  let skiReport = '';
  if (skis) {
    const line = (foot: Mesh, t: number, out: Vector3): Vector3 =>
      out.set(0, 0.01 - BODY.ankleHeight, -0.85 + 1.7 * t - BODY.ankleBack).applyMatrix4(foot.matrixWorld);
    const inv = parts.feet[1]!.matrixWorld.clone().invert();
    let near = Infinity;
    let through = 0;
    for (let i = 0; i <= 40; i++) {
      line(parts.feet[0]!, i / 40, p);
      for (let j = 0; j <= 40; j++) near = Math.min(near, p.distanceTo(line(parts.feet[1]!, j / 40, q)));
      // In the right ski's frame: within its width, thickness and length.
      q.copy(p).applyMatrix4(inv);
      if (Math.abs(q.x) < 0.055 && Math.abs(q.y - (0.01 - BODY.ankleHeight)) < 0.03 && Math.abs(q.z + BODY.ankleBack) < 0.85) through++;
    }
    skiReport = `skis ${(near * 100).toFixed(0)} cm apart at the closest${through ? `, ${through}/41 points through the other ski` : ''}`;
  }
  rig.dispose();
  return { line: [...poleReport, armReport, jacket, headReport, skiReport].filter(Boolean).join(' | ') || 'clear', head: headIn };
}

for (const [name, def] of STATES) {
  if (filter && !name.includes(filter)) continue;
  console.log(`${name.padEnd(22)} ${check(name, def, DEFAULT_OUTFIT, false, false).line}`);
}
console.log(`worst pole: ${worst} cm inside the body`);

console.log('\nPoles off (pole checks skipped; skating pushes added):');
const noPoles: Outfit = { ...DEFAULT_OUTFIT, poles: false };
let closest = Infinity;
for (const [name, def] of [...STATES, ...SKATES]) {
  if (filter && !name.includes(filter)) continue;
  const skating = name.startsWith('skate');
  const { line } = check(name, def, noPoles, false, skating);
  const m = /skis (\d+) cm/.exec(line);
  if (m) closest = Math.min(closest, Number(m[1]));
  console.log(`${name.padEnd(26)} ${line}`);
}
if (closest < Infinity) console.log(`closest skis while skating: ${closest} cm (centerlines)`);

console.log('\nHeadwear (head and hat points inside the body, every state; the helmet is the baseline):');
for (const { id } of HEADWEAR) {
  const outfit: Outfit = { ...DEFAULT_OUTFIT, headwear: id };
  let total = 0;
  const bad: string[] = [];
  for (const [name, def] of STATES) {
    if (filter && !name.includes(filter)) continue;
    const r = check(name, def, outfit, true, false);
    total += r.head;
    if (r.head) bad.push(`${name} ${r.head}`);
  }
  console.log(`${id.padEnd(8)} ${total} points inside over every state${bad.length ? `: ${bad.join(', ')}` : ''}`);
}

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
