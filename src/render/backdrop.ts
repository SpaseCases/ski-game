import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  Vector3,
  type WebGLRenderer,
} from 'three';
import { CONFIG } from '../config.ts';
import type { ScatterItem } from '../maps/decor.ts';
import { fbm } from '../maps/peak.ts';
import { hash2 } from '../maps/terrain.ts';
import type { Heightfield, MapDef, PeaksDef } from '../maps/types.ts';
import { boundsDistance, insideBounds } from '../sim/bounds.ts';

// What lies past the far plane, drawn first in its own pass with its own
// camera: a sky that fades from the haze's color at the horizon to the
// map's sky color overhead, mountain ranges far around the map (hazy with
// distance, lit once when built), and the map's own mountain as a coarse
// stand-in, so the far ranges never show through it.
//
// When the preset's haze reaches past the far plane (Medium and High), the
// stand-in is lit snow and rock with its forests tinted in, and a valley
// plain runs out from the map's edge to the ranges; both fade by the same
// haze as the world in front, so the mountain carries on into the distance
// instead of ending in a wall of fog. On Low the fog ends at the far plane,
// and the stand-in is just the fog's color.

/** Radius (m) of the sky dome around the camera. */
const SKY = 60000;
/** How far (m) the backdrop camera sees. */
const FAR = 90000;
/** Sky color reaches full strength this many degrees above the horizon. */
const SKY_FULL = 32;
/**
 * Samples of the map's heightfield per cell of its stand-in (lit, or plain
 * fog-colored), how far (m) the stand-in sits under the real snow, and (fog
 * colored) how far past the play area it reaches before dropping away (the
 * hills round the edge shouldn't hide the ranges beyond them in the fog).
 */
const STAND_IN_STEP = 12;
const STAND_IN_STEP_FOG = 36;
const STAND_IN_SINK = 3;
const STAND_IN_SINK_FOG = 12;
const STAND_IN_REACH = 150;
/** Distance (m) over which the far ranges fade halfway into the haze. */
const HAZE_HALF = 16000;
/** Azimuth samples around each ring of peaks, and samples across it. */
const AROUND = 150;
const ACROSS = 6;
const DEG = Math.PI / 180;
const SNOW = new Color('#f5f8fc');
const SNOW_SHADE = new Color('#c4d3e6');
const ROCK = new Color('#7a8189');
const FOREST = new Color('#2f4a3a');

const skyMaterial = new MeshBasicMaterial({ vertexColors: true, side: BackSide, depthWrite: false, fog: false });
const peaksMaterial = new MeshBasicMaterial({ vertexColors: true, fog: false });
const fogMaterial = new MeshBasicMaterial({ color: '#ffffff', fog: false });
const groundMaterial = new MeshLambertMaterial({ vertexColors: true, flatShading: true });

export class Backdrop {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(60, 1, 100, FAR);
  private readonly sky: Mesh;
  private readonly hemi: HemisphereLight;
  private readonly fog = new Fog('#dce8f3', 70, 240);
  private peaks: Mesh | null = null;
  private standIn: Mesh | null = null;
  private plain: Mesh | null = null;
  /** What the stand-in is built from, so a change of preset can rebuild it. */
  private source: { map: MapDef; hf: Heightfield; trees: readonly ScatterItem[] } | null = null;
  /** Whether the far ground is drawn lit (the haze reaches past the far plane). */
  private lit = false;

  constructor() {
    this.scene.matrixAutoUpdate = false;
    this.scene.fog = this.fog;
    const geometry = new SphereGeometry(SKY, 24, 16);
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 3), 3));
    this.sky = new Mesh(geometry, skyMaterial);
    this.sky.renderOrder = -1;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
    // The same light as the world in front.
    this.hemi = new HemisphereLight('#9fc3e6', '#7d8796', CONFIG.light.hemiIntensity);
    const sun = new DirectionalLight('#fff6e8', CONFIG.light.sunIntensity);
    const from = CONFIG.light.sunFrom;
    sun.position.set(from.x, from.y, from.z).normalize();
    this.scene.add(this.hemi, sun);
    this.setColors('#9fc3e6', '#dce8f3');
  }

  /** Builds the backdrop for a map: its sky colors, its far ranges, and the stand-in for its own mountain (with its trees, for the forests). */
  setMap(map: MapDef, hf: Heightfield, trees: readonly ScatterItem[]): void {
    this.setColors(map.colors.sky, map.colors.fog);
    this.hemi.color.set(map.colors.sky);
    this.fog.color.set(map.colors.fog);
    fogMaterial.color.set(map.colors.fog);
    this.source = { map, hf, trees };
    if (this.peaks) {
      this.scene.remove(this.peaks);
      this.peaks.geometry.dispose();
    }
    this.peaks = map.peaks ? new Mesh(peaksGeometry(map.peaks, new Color(map.colors.fog), new Color(map.colors.sky)), peaksMaterial) : null;
    if (this.peaks) {
      this.peaks.matrixAutoUpdate = false;
      this.scene.add(this.peaks);
    }
    this.buildGround();
  }

  /**
   * The haze: fading in from `start` to complete at `end` (m), as the world
   * in front fades. Past the far plane `far`, the ground is lit when the
   * haze isn't complete there yet.
   */
  setHaze(start: number, end: number, far: number): void {
    this.fog.near = start;
    this.fog.far = end;
    const lit = end > far * 1.2;
    if (lit !== this.lit) {
      this.lit = lit;
      this.buildGround();
    }
  }

  /** Clears the frame and draws the backdrop as `camera` sees it, behind everything nearer than `near` (m). */
  render(renderer: WebGLRenderer, camera: PerspectiveCamera): void {
    const c = this.camera;
    c.position.copy(camera.position);
    c.quaternion.copy(camera.quaternion);
    c.fov = camera.fov;
    c.aspect = camera.aspect;
    // Start a little short of the main camera's far plane; the world in front covers the rest.
    c.near = Math.max(50, camera.far * 0.9);
    c.updateProjectionMatrix();
    c.updateMatrixWorld();
    this.sky.position.copy(camera.position);
    this.sky.updateMatrix();
    this.sky.updateMatrixWorld();
    renderer.clear();
    renderer.render(this.scene, c);
  }

  /** (Re)builds the stand-in for the map's mountain, and the valley plain round it when lit. */
  private buildGround(): void {
    for (const m of [this.standIn, this.plain]) {
      if (!m) continue;
      this.scene.remove(m);
      m.geometry.dispose();
    }
    this.standIn = null;
    this.plain = null;
    const src = this.source;
    if (!src || !src.map.peaks) return;
    this.standIn = this.lit ? new Mesh(litGroundGeometry(src.hf, src.trees), groundMaterial) : new Mesh(fogGroundGeometry(src.hf), fogMaterial);
    if (this.lit) this.plain = new Mesh(plainGeometry(src.hf, src.map.peaks), groundMaterial);
    for (const m of [this.standIn, this.plain]) {
      if (!m) continue;
      m.matrixAutoUpdate = false;
      this.scene.add(m);
    }
  }

  private setColors(sky: string, fog: string): void {
    const top = new Color(sky);
    const horizon = new Color(fog);
    const pos = this.sky.geometry.getAttribute('position');
    const col = this.sky.geometry.getAttribute('color');
    const tmp = new Color();
    for (let i = 0; i < pos.count; i++) {
      // Smooth from the horizon up (the sky is the one thing not drawn in facets).
      const y = pos.getY(i) / SKY;
      const elev = Math.asin(Math.max(-1, Math.min(1, y))) / DEG;
      const t = Math.max(0, Math.min(1, elev / SKY_FULL));
      tmp.copy(horizon).lerp(top, Math.sqrt(t));
      col.setXYZ(i, tmp.r, tmp.g, tmp.b);
    }
    col.needsUpdate = true;
  }
}

/**
 * The far ranges: rings of mountains around the map's middle, each a
 * strip of faceted ground rising to a ragged crest with peaks along it.
 * Lit by the sun once, snow above the snow line (rock where it's steep),
 * and faded toward the haze with distance and toward the valley floor.
 */
function peaksGeometry(def: PeaksDef, haze: Color, sky: Color): BufferGeometry {
  const sun = new Vector3(CONFIG.light.sunFrom.x, CONFIG.light.sunFrom.y, CONFIG.light.sunFrom.z).normalize();
  const snow = new Color('#f2f6fb');
  const snowShade = new Color('#b9c8de');
  const rock = new Color('#6f6a68');
  const rockDark = new Color('#55524f');
  const forest = new Color('#3d5146');
  const positions: number[] = [];
  const colors: number[] = [];
  const rings = Math.max(1, def.rings);
  const color = new Color();
  const lit = new Color();
  for (let ring = 0; ring < rings; ring++) {
    const f = rings === 1 ? 0 : ring / (rings - 1);
    const dist = def.distance[0] + (def.distance[1] - def.distance[0]) * f;
    // Farther rings are taller (that's what shows over the nearer ones) and wider.
    const depth = dist * 0.22;
    const peaks: { a: number; h: number; w: number }[] = [];
    for (let i = 0; i < def.count; i++) {
      const r = (k: number): number => 0.5 + 0.5 * hash2(i * 13 + k, ring * 7 + k * 3, def.seed);
      const span = def.height[1] - def.height[0];
      peaks.push({
        a: ((i + 0.15 + 0.7 * r(1)) / def.count) * Math.PI * 2,
        h: def.height[0] + span * (0.2 + 0.8 * f) * (0.25 + 0.75 * r(2) * r(2)),
        w: (Math.PI * 2 * (0.45 + 0.8 * r(3))) / def.count,
      });
    }
    const crest = (a: number): number => {
      // Low cols between the peaks, so each one stands on its own.
      let h = def.base + (def.height[0] - def.base) * (0.12 + 0.18 * f) * (1 + 0.5 * hash2(Math.round(a * 40), ring, def.seed + 2));
      for (const p of peaks) {
        let d = Math.abs(a - p.a);
        if (d > Math.PI) d = Math.PI * 2 - d;
        const x = d / p.w;
        if (x < 1) h = Math.max(h, def.base + (p.h - def.base) * (1 - x) ** 1.6);
      }
      return h;
    };
    // Grid: around (j) by across (k), from the front foot through the crest to the back foot.
    const grid: Vector3[][] = [];
    for (let j = 0; j <= AROUND; j++) {
      const a = (j / AROUND) * Math.PI * 2;
      const top = crest(a);
      const row: Vector3[] = [];
      for (let k = 0; k <= ACROSS; k++) {
        const s = k / ACROSS; // 0 front foot, 1 back foot
        const bump = Math.sin(Math.PI * s) ** 1.2;
        const jitter = k === 0 || k === ACROSS ? 0 : hash2(j, k + ring * 17, def.seed + 5) * (top - def.base) * 0.12;
        const rr = dist - depth / 2 + depth * s + hash2(j * 3, k, def.seed + 9) * depth * 0.05;
        const h = def.base - 150 + (top - def.base + 150) * bump + jitter;
        row.push(new Vector3(-Math.sin(a) * rr, h, -Math.cos(a) * rr));
      }
      grid.push(row);
    }
    const tri = (p0: Vector3, p1: Vector3, p2: Vector3): void => {
      const n = new Vector3().subVectors(p1, p0).cross(new Vector3().subVectors(p2, p0)).normalize();
      // Wound to face the map's middle (where the camera is), and lit on that side.
      const mid = new Vector3().add(p0).add(p1).add(p2).divideScalar(3);
      const outward = n.x * mid.x + n.z * mid.z > 0;
      if (outward) n.negate();
      const steep = 1 - n.y;
      const above = mid.y - def.snowLine;
      const t = 0.5 + 0.5 * hash2(Math.round(mid.x), Math.round(mid.z), def.seed + 3);
      // Snow wherever it isn't too steep to hold it, forest low down, rock on the steep faces.
      if (steep > 0.45) color.copy(t > 0.5 ? rock : rockDark);
      else if (above < 0) color.copy(forest).lerp(snow, Math.max(0, 0.35 + above / 1500));
      else color.copy(snow).lerp(snowShade, t * 0.35);
      // Sun and sky light.
      const shade = 0.62 + 0.5 * Math.max(0, n.dot(sun)) + 0.08 * n.y;
      lit.copy(color).multiplyScalar(shade);
      lit.lerp(sky, 0.08);
      // Haze: more with distance, and thicker low down.
      const rise = Math.max(0, Math.min(1, (mid.y - def.base) / Math.max(1, def.height[1] - def.base)));
      const far = 1 - Math.pow(0.5, Math.hypot(mid.x, mid.z) / HAZE_HALF);
      const k = Math.min(1, far * (1.45 - 0.85 * rise) + 0.1);
      lit.lerp(haze, k);
      const order = outward ? [p0, p2, p1] : [p0, p1, p2];
      for (const p of order) {
        positions.push(p.x, p.y, p.z);
        colors.push(lit.r, lit.g, lit.b);
      }
    };
    for (let j = 0; j < AROUND; j++) {
      for (let k = 0; k < ACROSS; k++) {
        const a = grid[j]![k]!;
        const b = grid[j + 1]![k]!;
        const c = grid[j + 1]![k + 1]!;
        const d = grid[j]![k + 1]!;
        tri(a, b, c);
        tri(a, c, d);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  g.computeBoundingSphere();
  return g;
}

/** The map's own ground in the fog's color, coarse and sunk a little, to hide the far ranges behind it. */
function fogGroundGeometry(hf: Heightfield): BufferGeometry {
  const step = STAND_IN_STEP_FOG;
  const nc = Math.floor((hf.cols - 1) / step);
  const nr = Math.floor((hf.rows - 1) / step);
  const positions: number[] = [];
  const v = (c: number, r: number): [number, number, number] => {
    const col = Math.min(hf.cols - 1, c * step);
    const row = Math.min(hf.rows - 1, r * step);
    const x = hf.originX + col * hf.cellSize;
    const z = hf.originZ + row * hf.cellSize;
    const out = insideBounds(hf.bounds, x, z) ? 0 : boundsDistance(hf.bounds, x, z);
    const drop = out > STAND_IN_REACH ? 2000 : 0;
    return [x, (hf.heights[row * hf.cols + col] ?? 0) - STAND_IN_SINK_FOG - drop, z];
  };
  for (let r = 0; r < nr; r++) {
    for (let c = 0; c < nc; c++) {
      positions.push(...v(c, r), ...v(c, r + 1), ...v(c + 1, r));
      positions.push(...v(c + 1, r), ...v(c, r + 1), ...v(c + 1, r + 1));
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.computeBoundingSphere();
  return g;
}

/**
 * The map's own ground, lit, for seeing it far away: snow, rock where the
 * heightfield says rock, and the forests as dark green facets wherever
 * trees stand thick, each triangle one color like the rest of the world.
 */
function litGroundGeometry(hf: Heightfield, trees: readonly ScatterItem[]): BufferGeometry {
  const step = STAND_IN_STEP;
  const nc = Math.floor((hf.cols - 1) / step);
  const nr = Math.floor((hf.rows - 1) / step);
  const cell = step * hf.cellSize;
  // Trees per cell of the stand-in's grid, and rock at each of its samples.
  const count = new Float32Array((nc + 1) * (nr + 1));
  for (const t of trees) {
    if (t.kind !== 'pine' && t.kind !== 'aspen' && t.kind !== 'snag') continue;
    const c = Math.round((t.x - hf.originX) / cell);
    const r = Math.round((t.z - hf.originZ) / cell);
    if (c < 0 || r < 0 || c > nc || r > nr) continue;
    count[r * (nc + 1) + c]! += t.kind === 'pine' ? 1 : 0.6;
  }
  const px = new Float32Array((nc + 1) * (nr + 1) * 3);
  const rocky = new Float32Array((nc + 1) * (nr + 1));
  for (let r = 0; r <= nr; r++) {
    for (let c = 0; c <= nc; c++) {
      const col = Math.min(hf.cols - 1, c * step);
      const row = Math.min(hf.rows - 1, r * step);
      const k = r * (nc + 1) + c;
      px[k * 3] = hf.originX + col * hf.cellSize;
      px[k * 3 + 1] = (hf.heights[row * hf.cols + col] ?? 0) - STAND_IN_SINK;
      px[k * 3 + 2] = hf.originZ + row * hf.cellSize;
      // Rock from the samples around this one (cliffs are narrower than a cell).
      let rock = 0;
      for (let dr = -step / 2; dr <= step / 2; dr += 2) {
        for (let dc = -step / 2; dc <= step / 2; dc += 2) {
          const rr = Math.min(hf.rows - 1, Math.max(0, row + dr));
          const cc = Math.min(hf.cols - 1, Math.max(0, col + dc));
          rock = Math.max(rock, (hf.rock?.[rr * hf.cols + cc] ?? 0) / 255);
        }
      }
      rocky[k] = rock;
    }
  }
  const positions = new Float32Array(nc * nr * 18);
  const colors = new Float32Array(nc * nr * 18);
  const color = new Color();
  let p = 0;
  const tri = (a: number, b: number, d: number, seed: number): void => {
    const trees = (count[a]! + count[b]! + count[d]!) / 3;
    const rock = Math.max(rocky[a]!, rocky[b]!, rocky[d]!);
    color.copy(SNOW).lerp(SNOW_SHADE, 0.12 + 0.2 * (0.5 + 0.5 * hash2(seed, a, 5)) ** 2);
    if (rock > 0.5) color.copy(ROCK).lerp(SNOW, 0.25 * (0.5 + 0.5 * hash2(seed, b, 7)));
    // Stands of trees as dark facets (scattered trees don't show from this far).
    else if (trees > 2.6) color.copy(FOREST).lerp(SNOW_SHADE, 0.12 * (0.5 + 0.5 * hash2(seed, a, 3)));
    for (const k of [a, b, d]) {
      positions[p] = px[k * 3]!;
      positions[p + 1] = px[k * 3 + 1]!;
      positions[p + 2] = px[k * 3 + 2]!;
      colors[p] = color.r;
      colors[p + 1] = color.g;
      colors[p + 2] = color.b;
      p += 3;
    }
  };
  for (let r = 0; r < nr; r++) {
    for (let c = 0; c < nc; c++) {
      const a = r * (nc + 1) + c;
      const b = a + 1;
      const d = a + (nc + 1);
      const e = d + 1;
      tri(a, d, b, 2 * a);
      tri(b, d, e, 2 * a + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  g.setAttribute('color', new BufferAttribute(colors, 3));
  g.computeBoundingSphere();
  return g;
}

/**
 * A valley plain from the edge of the map's ground out to the foot of the
 * nearest ranges: rolling snow and forest, sloping from below the map's
 * edge down to the ranges' base, so the land carries on into the haze.
 */
function plainGeometry(hf: Heightfield, def: PeaksDef): BufferGeometry {
  // Round the middle of the heightfield (a mountain's summit, or halfway down a long slope).
  const cx = hf.originX + ((hf.cols - 1) * hf.cellSize) / 2;
  const cz = hf.originZ + ((hf.rows - 1) * hf.cellSize) / 2;
  const inner = ((Math.min(hf.cols, hf.rows) - 1) * hf.cellSize) / 2 - 60;
  const outer = def.distance[0] * 0.92;
  // Start below the lowest ground round the map's edge, so the map's own hills stand over it.
  let low = Infinity;
  for (let k = 0; k < 72; k++) {
    const a = (k / 72) * Math.PI * 2;
    const x = cx - Math.sin(a) * inner;
    const z = cz - Math.cos(a) * inner;
    const c = Math.round((x - hf.originX) / hf.cellSize);
    const r = Math.round((z - hf.originZ) / hf.cellSize);
    low = Math.min(low, hf.heights[Math.min(hf.rows - 1, Math.max(0, r)) * hf.cols + Math.min(hf.cols - 1, Math.max(0, c))] ?? 0);
  }
  const top = low - 30;
  const around = 72;
  const rings = 9;
  const radii = Array.from({ length: rings }, (_, i) => inner + (outer - inner) * (i / (rings - 1)) ** 1.6);
  const positions = new Float32Array(around * rings * 3);
  const colors = new Float32Array(around * rings * 3);
  const color = new Color();
  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1);
    for (let j = 0; j < around; j++) {
      const a = ((j + (i % 2) * 0.5) / around) * Math.PI * 2;
      const rr = radii[i]! * (1 + 0.03 * hash2(i, j, def.seed + 11));
      const x = cx - Math.sin(a) * rr;
      const z = cz - Math.cos(a) * rr;
      const roll = i === 0 ? 0 : 60 * fbm(x / 1800, z / 1800, def.seed + 13);
      const y = top + (def.base - top) * t + roll;
      const k = i * around + j;
      positions[k * 3] = x;
      positions[k * 3 + 1] = y;
      positions[k * 3 + 2] = z;
      const forest = Math.max(0, Math.min(1, 0.5 + 1.4 * fbm(x / 900, z / 900, def.seed + 17)));
      color.copy(SNOW).lerp(SNOW_SHADE, 0.2).lerp(FOREST, forest * 0.75);
      colors[k * 3] = color.r;
      colors[k * 3 + 1] = color.g;
      colors[k * 3 + 2] = color.b;
    }
  }
  const index: number[] = [];
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < around; j++) {
      const a = i * around + j;
      const b = i * around + ((j + 1) % around);
      const d = (i + 1) * around + j;
      const e = (i + 1) * around + ((j + 1) % around);
      index.push(a, b, d, b, e, d);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  g.setAttribute('color', new BufferAttribute(colors, 3));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}
