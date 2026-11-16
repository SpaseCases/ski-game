import { BufferAttribute, BufferGeometry, Color, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial } from 'three';
import { CONFIG } from '../config.ts';
import type { Heightfield } from '../maps/types.ts';
import { LANE_ACROSS, lanePoint, LOADED, RUNNING, type Avalanches } from '../sim/avalanche.ts';
import { drawnHeightAt } from './terrainMesh.ts';

// Avalanches drawn (milestone 21), beside the snow effects' chunks and
// powder cloud (render/snowFx.ts emitSlides):
// - The crack line across a slope that has slid: a dark, broken band where
//   the slab broke away (the crown), with a pale strip of the bed under it,
//   from the moment it cracks until CONFIG.avalanche.crackShow s later. One
//   mesh for every zone, rebuilt only when a zone cracks or its line runs out.
// - The slab's front while it runs: a churning lip of snow standing over
//   the slope along the front, tapering at its sides. Its few vertices are
//   rewritten each frame only while a slide runs (no allocation); nothing is
//   drawn otherwise.

/** Points across a slab at most (its half-width over the lane spacing, both ways, plus the middle). */
const MAX_POINTS = 2 * Math.round(CONFIG.avalanche.halfWidth / LANE_ACROSS) + 1;
/** The crown's width (m) down the slope, the bed strip's under it, and how far (m) above the drawn snow both sit. */
const CROWN = 1;
const BED = 3;
const LIFT = 0.06;
/** How far (m) up or down the slope each lane's piece of the crack wanders, so it reads broken. */
const JAG = 0.6;
/**
 * The front's rows down the slope: distance (m) from the front and height
 * over the snow as a share of the slab's depth (the tail sinks back into
 * the slope, the crest churns highest just behind the front, its face drops
 * to the snow ahead).
 */
const FRONT_ROWS: readonly [number, number][] = [
  [-16, 0.15],
  [-4, 1.7],
  [0, 1.2],
  [3, 0.05],
];

const CROWN_COLOR = new Color('#3d4c5f');
const BED_COLOR = new Color('#b9c8d8');
const SLAB_TOP = new Color('#f2f6fb');
const SLAB_FACE = new Color('#d3dde9');

export class AvalancheView {
  readonly group = new Group();
  private readonly av: Avalanches;
  private readonly hf: Heightfield;
  private readonly crackMesh: Mesh;
  private readonly crackPos: Float32Array;
  private readonly crackCol: Float32Array;
  private readonly frontMesh: Mesh;
  private readonly frontPos: Float32Array;
  /** Per zone: the release whose crack is drawn (0: none). */
  private readonly drawn: Int32Array;
  private readonly p = { x: 0, z: 0 };
  private time = 0;

  constructor(av: Avalanches, hf: Heightfield) {
    this.av = av;
    this.hf = hf;
    this.group.matrixAutoUpdate = false;
    const zones = av.zones.length;
    this.drawn = new Int32Array(zones);

    // The cracks: per point across, three vertices down the slope (crown top, crown foot, bed foot).
    const crackVerts = zones * MAX_POINTS * 3;
    this.crackPos = new Float32Array(crackVerts * 3);
    this.crackCol = new Float32Array(crackVerts * 3);
    const crackGeo = new BufferGeometry();
    crackGeo.setAttribute('position', new BufferAttribute(this.crackPos, 3));
    crackGeo.setAttribute('color', new BufferAttribute(this.crackCol, 3));
    crackGeo.setIndex(strips(zones, 3));
    this.crackMesh = new Mesh(crackGeo, new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    this.crackMesh.frustumCulled = false;
    this.crackMesh.matrixAutoUpdate = false;
    this.crackMesh.visible = false;

    // The fronts: per point across, a vertex per FRONT_ROWS row; lit and flat shaded like the snow.
    const rows = FRONT_ROWS.length;
    const frontVerts = zones * MAX_POINTS * rows;
    this.frontPos = new Float32Array(frontVerts * 3);
    const frontCol = new Float32Array(frontVerts * 3);
    for (let v = 0; v < frontVerts; v++) {
      const c = v % rows === rows - 1 || v % rows === rows - 2 ? SLAB_FACE : SLAB_TOP;
      frontCol[v * 3] = c.r;
      frontCol[v * 3 + 1] = c.g;
      frontCol[v * 3 + 2] = c.b;
    }
    const frontGeo = new BufferGeometry();
    frontGeo.setAttribute('position', new BufferAttribute(this.frontPos, 3));
    frontGeo.setAttribute('color', new BufferAttribute(frontCol, 3));
    frontGeo.setIndex(strips(zones, rows));
    this.frontMesh = new Mesh(frontGeo, new MeshLambertMaterial({ vertexColors: true, flatShading: true, side: DoubleSide }));
    this.frontMesh.frustumCulled = false;
    this.frontMesh.matrixAutoUpdate = false;
    this.frontMesh.visible = false;
    this.group.add(this.crackMesh, this.frontMesh);
  }

  /** Each frame: redraws the cracks if any zone cracked (or its line ran out), and moves the running fronts. */
  update(frameTime: number): void {
    this.time += frameTime;
    const show = CONFIG.avalanche.crackShow;
    let changed = false;
    let running = false;
    for (let i = 0; i < this.av.zones.length; i++) {
      const z = this.av.zones[i]!;
      const want = z.phase !== LOADED && z.age < show ? z.releases : 0;
      if (want !== this.drawn[i]) {
        this.drawn[i] = want;
        changed = true;
      }
      if (z.phase === RUNNING) running = true;
    }
    if (changed) this.drawCracks();
    if (running || this.frontMesh.visible) this.drawFronts(running);
  }

  private drawCracks(): void {
    this.crackPos.fill(0);
    let any = false;
    for (let zi = 0; zi < this.av.zones.length; zi++) {
      const zone = this.av.zones[zi]!;
      if (this.drawn[zi] === 0) continue;
      any = true;
      const base = zi * MAX_POINTS * 3;
      const count = Math.min(MAX_POINTS, zone.hi - zone.lo + 1);
      for (let i = 0; i < MAX_POINTS; i++) {
        // Points past the slab's edge repeat its last one (folded to nothing).
        const l = zone.lo + Math.min(i, count - 1);
        const jag = (hash(zi * 97 + l + zone.releases * 13) - 0.5) * 2 * JAG;
        for (let r = 0; r < 3; r++) {
          const d = zone.crack + jag + (r === 0 ? 0 : r === 1 ? CROWN : CROWN + BED);
          lanePoint(zone, l, d, this.p);
          const v = (base + i * 3 + r) * 3;
          this.crackPos[v] = this.p.x;
          this.crackPos[v + 1] = drawnHeightAt(this.hf, this.p.x, this.p.z) + LIFT;
          this.crackPos[v + 2] = this.p.z;
          // The bed's foot fades toward the snow's own white.
          const c = r === 2 ? BED_COLOR : CROWN_COLOR;
          const fade = r === 2 ? 0.35 : 0;
          this.crackCol[v] = c.r + (1 - c.r) * fade;
          this.crackCol[v + 1] = c.g + (1 - c.g) * fade;
          this.crackCol[v + 2] = c.b + (1 - c.b) * fade;
        }
      }
    }
    const geo = this.crackMesh.geometry;
    (geo.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (geo.getAttribute('color') as BufferAttribute).needsUpdate = true;
    this.crackMesh.visible = any;
  }

  private drawFronts(running: boolean): void {
    const pos = this.frontPos;
    const rows = FRONT_ROWS.length;
    const t = this.time;
    for (let zi = 0; zi < this.av.zones.length; zi++) {
      const zone = this.av.zones[zi]!;
      const base = zi * MAX_POINTS * rows;
      if (zone.phase !== RUNNING) {
        // Folded away: every vertex of this zone at one point (nothing drawn).
        pos.fill(0, base * 3, (base + MAX_POINTS * rows) * 3);
        continue;
      }
      const count = Math.min(MAX_POINTS, zone.hi - zone.lo + 1);
      // It stands up as it gets going.
      const grow = Math.min(1, zone.frontSpeed / 10) * zone.depth;
      for (let i = 0; i < MAX_POINTS; i++) {
        const k = Math.min(i, count - 1);
        const l = zone.lo + k;
        // Tapering to the snow at the slab's sides, and churning.
        const edge = count > 1 ? Math.min(k, count - 1 - k) : 0;
        const side = Math.min(1, 0.25 + edge * 0.35);
        const churn = 0.75 + 0.25 * Math.sin(t * 6 + l * 1.7) + 0.15 * Math.sin(t * 11 + l * 0.6);
        for (let r = 0; r < rows; r++) {
          const [d, h] = FRONT_ROWS[r]!;
          lanePoint(zone, l, Math.max(zone.crack, zone.front + d), this.p);
          const v = (base + i * rows + r) * 3;
          pos[v] = this.p.x;
          pos[v + 1] = drawnHeightAt(this.hf, this.p.x, this.p.z) + LIFT + h * grow * side * (r === 1 || r === 2 ? churn : 1);
          pos[v + 2] = this.p.z;
        }
      }
    }
    (this.frontMesh.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    this.frontMesh.visible = running;
  }
}

/** Triangles joining each zone's MAX_POINTS columns of `rows` vertices, row to row. */
function strips(zones: number, rows: number): number[] {
  const index: number[] = [];
  for (let z = 0; z < zones; z++) {
    for (let i = 0; i + 1 < MAX_POINTS; i++) {
      const a = (z * MAX_POINTS + i) * rows;
      const b = a + rows;
      for (let r = 0; r + 1 < rows; r++) index.push(a + r, a + r + 1, b + r, b + r, a + r + 1, b + r + 1);
    }
  }
  return index;
}

/** A steady pseudo-random number in [0, 1) for an integer. */
function hash(n: number): number {
  let t = (n * 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
