import { Color, IcosahedronGeometry, InstancedMesh, MeshLambertMaterial } from 'three';
import { CONFIG } from '../config.ts';
import { chimneySpot, framePoint, townFrame } from '../maps/town.ts';
import type { Feature, Heightfield } from '../maps/types.ts';
import { renderedHeightAt } from './terrainMesh.ts';

// Smoke curling up from the town's chimneys: a few puffs per chimney,
// each rising, drifting downwind and swelling, then shrinking away as the
// next takes its place. One instanced mesh for every puff; only chimneys
// near the camera are placed each frame.

/** Puffs per chimney, seconds each one lives, how high (m) it rises and how far it drifts in that time. */
const PUFFS = 6;
const LIFE = 7;
const RISE = 11;
const DRIFT = 6;
/** Which way the wind carries the smoke: the snow effects' wind (a unit direction in XZ). */
const WIND = CONFIG.snowFx.wind;

const material = new MeshLambertMaterial({ color: new Color('#e9edf2'), flatShading: true, transparent: true, opacity: 0.55, depthWrite: false });

export class SmokeView {
  readonly mesh: InstancedMesh | null;
  private readonly tops: { x: number; y: number; z: number; phase: number }[] = [];
  private time = 0;

  constructor(features: readonly Feature[], hf: Heightfield) {
    for (const f of features) {
      if (f.type !== 'building' || !f.chimney) continue;
      const c = chimneySpot(f);
      const p = framePoint(townFrame(f), c.u, c.v);
      this.tops.push({ x: p.x, y: renderedHeightAt(hf, p.x, p.z) + c.top + 0.2, z: p.z, phase: (this.tops.length * 0.37) % 1 });
    }
    this.mesh = this.tops.length > 0 ? new InstancedMesh(new IcosahedronGeometry(1, 0), material, this.tops.length * PUFFS) : null;
    if (this.mesh) {
      this.mesh.frustumCulled = false;
      this.mesh.matrixAutoUpdate = false;
      this.mesh.count = 0;
    }
  }

  /** Moves the smoke on by `dt` s, placing the puffs of chimneys within `range` m of the camera at (cx, cz). */
  update(dt: number, cx: number, cz: number, range: number): void {
    const mesh = this.mesh;
    if (!mesh) return;
    this.time += dt;
    const a = mesh.instanceMatrix.array as Float32Array;
    let n = 0;
    const reach2 = (range + 20) ** 2;
    for (const t of this.tops) {
      if ((t.x - cx) ** 2 + (t.z - cz) ** 2 > reach2) continue;
      for (let i = 0; i < PUFFS; i++) {
        const age = (this.time / LIFE + t.phase + i / PUFFS) % 1;
        // Swells as it rises, then fades by shrinking away.
        const size = (0.35 + 1.6 * age) * Math.min(1, (1 - age) * 4);
        const o = n * 16;
        a.fill(0, o, o + 16);
        a[o] = size;
        a[o + 5] = size * 0.8;
        a[o + 10] = size;
        a[o + 12] = t.x + WIND.x * DRIFT * age * age + Math.sin(this.time * 0.7 + i) * 0.3;
        a[o + 13] = t.y + RISE * age;
        a[o + 14] = t.z + WIND.z * DRIFT * age * age;
        a[o + 15] = 1;
        n++;
      }
    }
    mesh.count = n;
    if (n > 0) {
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, n * 16);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
