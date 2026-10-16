import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  OctahedronGeometry,
  Quaternion,
  Vector3,
} from 'three';
import { CONFIG } from '../config.ts';
import type { FinishDef, Heightfield, MapDef } from '../maps/types.ts';
import type { RunState } from '../sim/checkpoints.ts';
import { drawnHeightAt } from './terrainMesh.ts';
import { TriBuilder } from './triBuilder.ts';

// Flag gates (instanced: one draw call for all poles, one for all pennants),
// each finish arch with a checkered banner and line on the snow (one merged
// mesh each), and a small marker over the personal checkpoint.

const POLE = new Color('#3a4450');
const PENNANT_NEW = new Color('#ff7a1a');
const PENNANT_PASSED = new Color('#33c26a');
const CHECK_DARK = new Color('#1b2430');
const CHECK_LIGHT = new Color('#f4f6fa');
const FINISH_POST = new Color('#c8331f');
const MARKER = new Color('#2f7de1');
/** Size (m) of a check on the finish banner and on the line in the snow. */
const CHECK = 0.6;
/** How far (m) poles reach below the snow, so bumps never show a gap. */
const BURY = 0.2;
/** Height (m) the personal checkpoint marker hovers at, and its spin (rad/s). */
const MARKER_HEIGHT = 2.5;
const MARKER_SPIN = 1.5;

export class CheckpointView {
  readonly group = new Group();
  private readonly pennants: InstancedMesh;
  private readonly marker: Mesh;
  /** Passed state shown on each flag, to recolor only when it changes. */
  private readonly shown: boolean[];

  constructor(map: MapDef, hf: Heightfield) {
    const c = CONFIG.checkpoints;
    const count = map.flags.length * 2;

    const poleGeometry = new CylinderGeometry(0.05, 0.05, c.poleHeight + BURY, 6);
    poleGeometry.translate(0, (c.poleHeight + BURY) / 2 - BURY, 0);
    const poles = new InstancedMesh(poleGeometry, new MeshLambertMaterial({ color: POLE, flatShading: true }), count);

    // A triangle off the pole top, pointing along local +X.
    const pennantGeometry = new BufferGeometry();
    const top = c.poleHeight - 0.02;
    pennantGeometry.setAttribute(
      'position',
      new BufferAttribute(
        new Float32Array([0, top, 0, 0, top - c.pennantDrop, 0, c.pennantLength, top - c.pennantDrop / 2, 0]),
        3,
      ),
    );
    pennantGeometry.computeVertexNormals();
    this.pennants = new InstancedMesh(
      pennantGeometry,
      new MeshLambertMaterial({ flatShading: true, side: DoubleSide }),
      count,
    );

    const m = new Matrix4();
    const q = new Quaternion();
    const pos = new Vector3();
    const one = new Vector3(1, 1, 1);
    const yUp = new Vector3(0, 1, 0);
    map.flags.forEach((flag, i) => {
      for (let end = 0; end < 2; end++) {
        const side = end === 0 ? -1 : 1;
        const { rx, rz } = gateRight(flag);
        const x = flag.x + rx * side * (flag.width / 2);
        const z = flag.z + rz * side * (flag.width / 2);
        pos.set(x, drawnHeightAt(hf, x, z), z);
        // Pennants point outward, away from the middle of the gate.
        q.setFromAxisAngle(yUp, Math.atan2(-rz * side, rx * side));
        m.compose(pos, q, one);
        poles.setMatrixAt(i * 2 + end, m);
        this.pennants.setMatrixAt(i * 2 + end, m);
        this.pennants.setColorAt(i * 2 + end, PENNANT_NEW);
      }
    });
    for (const mesh of [poles, this.pennants]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
    }
    this.shown = map.flags.map(() => false);

    for (const f of map.finishes) this.group.add(createFinish(f, hf));

    this.marker = new Mesh(new OctahedronGeometry(0.16), new MeshLambertMaterial({ color: MARKER, flatShading: true }));
    this.marker.visible = false;
    this.group.add(this.marker);
  }

  update(run: RunState, hf: Heightfield, frameTime: number): void {
    let recolor = false;
    for (let i = 0; i < this.shown.length; i++) {
      const passed = run.passed[i] ?? false;
      if (passed === this.shown[i]) continue;
      this.shown[i] = passed;
      const color = passed ? PENNANT_PASSED : PENNANT_NEW;
      this.pennants.setColorAt(i * 2, color);
      this.pennants.setColorAt(i * 2 + 1, color);
      recolor = true;
    }
    if (recolor && this.pennants.instanceColor) this.pennants.instanceColor.needsUpdate = true;

    const personal = run.kind === 'personal';
    this.marker.visible = personal;
    if (personal) {
      const p = run.position;
      this.marker.position.set(p.x, drawnHeightAt(hf, p.x, p.z) + MARKER_HEIGHT, p.z);
      this.marker.rotation.y += MARKER_SPIN * frameTime;
    }
  }
}

/** Unit vector (in XZ) to the right of a gate's heading. */
function gateRight(f: { heading: number }): { rx: number; rz: number } {
  const h = (f.heading * Math.PI) / 180;
  // Facing (-sin h, -cos h); its right is (cos h, -sin h).
  return { rx: Math.cos(h), rz: -Math.sin(h) };
}

/** The finish: two posts holding a checkered banner over the line, and a checkered line on the snow. */
function createFinish(f: FinishDef, hf: Heightfield): Mesh {
  const c = CONFIG.checkpoints;
  const b = new TriBuilder();
  const { rx, rz } = gateRight(f);
  const right = new Vector3(rx, 0, rz);
  const fwd = new Vector3(-Math.sin((f.heading * Math.PI) / 180), 0, -Math.cos((f.heading * Math.PI) / 180));
  const back = fwd.clone().negate();
  const half = f.width / 2;
  const at = (across: number, along: number, y: number): Vector3 =>
    new Vector3(f.x + rx * across + fwd.x * along, y, f.z + rz * across + fwd.z * along);
  const snow = (across: number, along: number): number => {
    const p = at(across, along, 0);
    return drawnHeightAt(hf, p.x, p.z);
  };

  // The banner hangs level, clear of the highest snow under it.
  let ground = -Infinity;
  for (let s = -half; s <= half; s += 2) ground = Math.max(ground, snow(s, 0));
  const bottom = ground + c.finishHeight;
  const cols = Math.max(1, Math.round(f.width / CHECK));
  const rows = Math.max(1, Math.round(c.finishBanner / CHECK));
  const cw = f.width / cols;
  const rh = c.finishBanner / rows;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const color = (i + j) % 2 === 0 ? CHECK_DARK : CHECK_LIGHT;
      const a = at(-half + i * cw, 0, bottom + j * rh);
      const e = at(-half + (i + 1) * cw, 0, bottom + j * rh);
      const eTop = e.clone().setY(e.y + rh);
      const aTop = a.clone().setY(a.y + rh);
      b.quad(a, e, eTop, aTop, color, back);
      b.quad(a, e, eTop, aTop, color, fwd);
    }
  }

  // Square posts at both ends, from below the snow up to the top of the banner.
  const w = 0.14;
  for (const across of [-half, half]) {
    const base = snow(across, 0) - BURY;
    const top = bottom + c.finishBanner + 0.1;
    const corners = [
      [-w, -w],
      [w, -w],
      [w, w],
      [-w, w],
    ] as const;
    for (let k = 0; k < 4; k++) {
      const [a0, b0] = corners[k]!;
      const [a1, b1] = corners[(k + 1) % 4]!;
      const out = right.clone().multiplyScalar(a0 + a1).addScaledVector(fwd, b0 + b1);
      b.quad(
        at(across + a0, b0, base),
        at(across + a1, b1, base),
        at(across + a1, b1, top),
        at(across + a0, b0, top),
        FINISH_POST,
        out,
      );
    }
  }

  // The line on the snow, a little above it so it never flickers.
  const lift = 0.03;
  const up = new Vector3(0, 1, 0);
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < 2; j++) {
      const color = (i + j) % 2 === 0 ? CHECK_DARK : CHECK_LIGHT;
      const s0 = -half + i * cw;
      const s1 = s0 + cw;
      const d0 = j * CHECK;
      const d1 = d0 + CHECK;
      b.quad(
        at(s0, d0, snow(s0, d0) + lift),
        at(s1, d0, snow(s1, d0) + lift),
        at(s1, d1, snow(s1, d1) + lift),
        at(s0, d1, snow(s0, d1) + lift),
        color,
        up,
      );
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(b.positions), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(b.colors), 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const mesh = new Mesh(
    geometry,
    new MeshLambertMaterial({
      vertexColors: true,
      flatShading: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  mesh.matrixAutoUpdate = false;
  return mesh;
}
