import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  SphereGeometry,
  Vector3,
  type WebGLRenderer,
} from 'three';
import { CONFIG } from '../config.ts';
import type { ScatterItem } from '../maps/decor.ts';
import { fbm } from '../maps/peak.ts';
import { hash2, smoothstep } from '../maps/terrain.ts';
import type { Heightfield, MapDef, PeaksDef } from '../maps/types.ts';
import { boundsDistance, insideBounds } from '../sim/bounds.ts';
import { weatherLook, type WeatherLook } from './weather.ts';

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
//
// The weather colors it all (setWeather): the sky and haze, the lights on
// the lit ground, and the far ranges, relit from colors kept per facet. At
// night a moon and stars come out; in a blizzard nothing past the far plane
// shows but the sky.

/** Radius (m) of the sky dome around the camera. */
const SKY = 60000;
/** How far (m) the backdrop camera sees. */
const FAR = 90000;
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
/**
 * Foothills between the map and the ranges: their tallest ridges as a share
 * of the ranges' lowest peaks above their base, facets around and rings out,
 * and how far (m) past the map's edge their haze takes to go over from the
 * world's to their own.
 */
const PLAIN_RELIEF = 0.28;
const PLAIN_AROUND = 192;
const PLAIN_RINGS = 28;
const PLAIN_BLEND = 2500;
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
const starMaterial = new PointsMaterial({ vertexColors: true, size: 2, sizeAttenuation: false, fog: false, transparent: true, depthWrite: false });
const moonMaterial = new MeshBasicMaterial({ vertexColors: true, fog: false, depthWrite: false });
const haloMaterial = new MeshBasicMaterial({ vertexColors: true, fog: false, transparent: true, depthWrite: false, blending: AdditiveBlending });
/** The moon and stars hang inside the sky dome, at these shares of its radius. */
const MOON_AT = 0.8;
const STARS_AT = 0.85;
/** The moon's halo reaches this many times its radius. */
const HALO = 5;

export class Backdrop {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(60, 1, 100, FAR);
  private readonly sky: Mesh;
  private readonly hemi: HemisphereLight;
  private readonly fog = new Fog('#dce8f3', 70, 240);
  private peaks: Mesh | null = null;
  /** The far ranges' facets before lighting, to relight them for the weather. */
  private peakColors: PeakColors | null = null;
  private plainColors: PeakColors | null = null;
  private readonly sun: DirectionalLight;
  /** The moon (with its halo) and the stars: out at night. */
  private readonly night = new Group();
  private look: WeatherLook = weatherLook('bluebird', null);
  /** False while the weather hides everything past the far plane (see setHaze). */
  private clear = true;
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
    this.sun = new DirectionalLight('#fff6e8', CONFIG.light.sunIntensity);
    const from = CONFIG.light.sunFrom;
    this.sun.position.set(from.x, from.y, from.z).normalize();
    this.scene.add(this.hemi, this.sun);
    // The moon and stars move with the sky dome (round the camera).
    this.night.add(createStars(), ...createMoon());
    this.night.traverse((o) => {
      o.updateMatrix();
      o.matrixAutoUpdate = false;
    });
    this.night.visible = false;
    this.sky.add(this.night);
    this.setWeather(this.look);
  }

  /** Builds the backdrop for a map: its far ranges, and the stand-in for its own mountain (with its trees, for the forests). setWeather colors them. */
  setMap(map: MapDef, hf: Heightfield, trees: readonly ScatterItem[]): void {
    this.source = { map, hf, trees };
    if (this.peaks) {
      this.scene.remove(this.peaks);
      this.peaks.geometry.dispose();
    }
    this.peaks = null;
    this.peakColors = null;
    if (map.peaks) {
      this.peakColors = peaksGeometry(map.peaks);
      this.peaks = new Mesh(this.peakColors.geometry, peaksMaterial);
      this.peaks.matrixAutoUpdate = false;
      this.peaks.visible = this.clear;
      this.scene.add(this.peaks);
      relightPeaks(this.peakColors, this.look);
    }
    this.buildGround();
  }

  /** Colors the sky, haze, lights and far ranges for a weather, and brings out the moon and stars at night. */
  setWeather(look: WeatherLook): void {
    this.look = look;
    this.setColors(look.sky, look.fog, look.def.skyFull);
    this.hemi.color.copy(look.hemiSky);
    this.hemi.groundColor.copy(look.hemiGround);
    this.hemi.intensity = look.hemiIntensity;
    this.sun.color.copy(look.sun);
    this.sun.intensity = look.sunIntensity;
    this.fog.color.copy(look.fog);
    fogMaterial.color.copy(look.fog);
    if (this.peakColors) relightPeaks(this.peakColors, look);
    if (this.plainColors) relightPeaks(this.plainColors, look, this.fog.near, this.fog.far);
    this.night.visible = look.def.stars > 0;
    starMaterial.opacity = Math.min(1, look.def.stars);
  }

  /**
   * The haze: fading in from `start` to complete at `end` (m), as the world
   * in front fades. Past the far plane `far`, the ground is lit when the
   * haze isn't complete there yet. Not `clear` (a blizzard): the far ranges
   * and ground are hidden (not rebuilt, so switching back costs nothing).
   */
  setHaze(start: number, end: number, far: number, clear = true): void {
    this.fog.near = start;
    this.fog.far = end;
    this.clear = clear;
    for (const m of [this.peaks, this.standIn, this.plain]) if (m) m.visible = clear;
    if (!clear) return;
    const lit = end > far * 1.2;
    if (lit !== this.lit) {
      this.lit = lit;
      this.buildGround();
    } else if (this.plainColors) {
      relightPeaks(this.plainColors, this.look, start, end);
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
    this.plainColors = null;
    const src = this.source;
    if (!src || !src.map.peaks) return;
    this.standIn = this.lit ? new Mesh(litGroundGeometry(src.hf, src.trees), groundMaterial) : new Mesh(fogGroundGeometry(src.hf), fogMaterial);
    if (this.lit) {
      this.plainColors = plainGeometry(src.hf, src.map.peaks);
      relightPeaks(this.plainColors, this.look, this.fog.near, this.fog.far);
      this.plain = new Mesh(this.plainColors.geometry, peaksMaterial);
    }
    for (const m of [this.standIn, this.plain]) {
      if (!m) continue;
      m.matrixAutoUpdate = false;
      m.visible = this.clear;
      this.scene.add(m);
    }
  }

  /** The sky's gradient: from `horizon` at the horizon to `top`, reached `full` degrees above it. */
  private setColors(top: Color, horizon: Color, full: number): void {
    const pos = this.sky.geometry.getAttribute('position');
    const col = this.sky.geometry.getAttribute('color');
    const tmp = new Color();
    for (let i = 0; i < pos.count; i++) {
      // Smooth from the horizon up (the sky is the one thing not drawn in facets).
      const y = pos.getY(i) / SKY;
      const elev = Math.asin(Math.max(-1, Math.min(1, y))) / DEG;
      const t = Math.max(0, Math.min(1, elev / full));
      tmp.copy(horizon).lerp(top, Math.sqrt(t));
      col.setXYZ(i, tmp.r, tmp.g, tmp.b);
    }
    col.needsUpdate = true;
  }
}

/**
 * The far ranges' facets before lighting: each one's own color, how much
 * sky light and sunlight it takes, and how far it fades into the haze.
 */
interface PeakColors {
  geometry: BufferGeometry;
  albedo: Float32Array;
  ambient: Float32Array;
  direct: Float32Array;
  haze: Float32Array;
  /**
   * The foothills only: each facet's distance from the map's middle, and how
   * far (0 to 1) its haze has gone over from the world's (by distance, as
   * the world fades) to its own.
   */
  dist?: Float32Array;
  blend?: Float32Array;
}

/**
 * Lights the far ranges (or the foothills) for a weather: each facet's
 * color in its sky light and sunlight (times the weather's multipliers), a
 * touch of the sky, then faded toward the haze; the foothills' haze starts
 * out as the world's (fading from `fogNear` to `fogFar` m).
 */
function relightPeaks(p: PeakColors, look: WeatherLook, fogNear = 0, fogFar = 1): void {
  const col = p.geometry.getAttribute('color');
  const { peaksLight: L, peaksSun: S, sky, fog } = look;
  const n = p.ambient.length;
  for (let i = 0; i < n; i++) {
    const a = p.ambient[i]!;
    const d = p.direct[i]!;
    let k = p.haze[i]!;
    if (p.dist && p.blend) {
      const world = Math.min(1, Math.max(0, (p.dist[i]! - fogNear) / Math.max(1, fogFar - fogNear)));
      k = world + (k - world) * p.blend[i]!;
    }
    let r = p.albedo[i * 3]! * (L.r * a + S.r * d);
    let g = p.albedo[i * 3 + 1]! * (L.g * a + S.g * d);
    let b = p.albedo[i * 3 + 2]! * (L.b * a + S.b * d);
    r += (sky.r - r) * 0.08;
    g += (sky.g - g) * 0.08;
    b += (sky.b - b) * 0.08;
    r += (fog.r - r) * k;
    g += (fog.g - g) * k;
    b += (fog.b - b) * k;
    for (let v = 0; v < 3; v++) col.setXYZ(i * 3 + v, r, g, b);
  }
  col.needsUpdate = true;
}

/**
 * The far ranges: rings of mountains around the map's middle, each a
 * strip of faceted ground rising to a ragged crest with peaks along it.
 * Lit from the sun's direction, snow above the snow line (rock where it's
 * steep), and faded toward the haze with distance and toward the valley
 * floor (see relightPeaks).
 */
function peaksGeometry(def: PeaksDef): PeakColors {
  const sun = new Vector3(CONFIG.light.sunFrom.x, CONFIG.light.sunFrom.y, CONFIG.light.sunFrom.z).normalize();
  const snow = new Color('#f2f6fb');
  const snowShade = new Color('#b9c8de');
  const rock = new Color('#6f6a68');
  const rockDark = new Color('#55524f');
  const forest = new Color('#3d5146');
  const positions: number[] = [];
  const albedo: number[] = [];
  const ambient: number[] = [];
  const direct: number[] = [];
  const hazes: number[] = [];
  const rings = Math.max(1, def.rings);
  const color = new Color();
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
      // Sky light and sunlight.
      albedo.push(color.r, color.g, color.b);
      ambient.push(0.62 + 0.08 * n.y);
      direct.push(0.5 * Math.max(0, n.dot(sun)));
      // Haze: more with distance, and thicker low down.
      const rise = Math.max(0, Math.min(1, (mid.y - def.base) / Math.max(1, def.height[1] - def.base)));
      const far = 1 - Math.pow(0.5, Math.hypot(mid.x, mid.z) / HAZE_HALF);
      hazes.push(Math.min(1, far * (1.45 - 0.85 * rise) + 0.1));
      const order = outward ? [p0, p2, p1] : [p0, p1, p2];
      for (const p of order) positions.push(p.x, p.y, p.z);
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
  g.setAttribute('color', new BufferAttribute(new Float32Array(positions.length), 3));
  g.computeBoundingSphere();
  return {
    geometry: g,
    albedo: new Float32Array(albedo),
    ambient: new Float32Array(ambient),
    direct: new Float32Array(direct),
    haze: new Float32Array(hazes),
  };
}

/** Stars over the sky above the horizon, some brighter than others, fading in just over the horizon. */
function createStars(): Points {
  const n = CONFIG.lights.stars;
  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  const r = SKY * STARS_AT;
  const warm = new Color('#ffd9b0');
  const cool = new Color('#bcd0ff');
  const c = new Color();
  for (let i = 0; i < n; i++) {
    const u = 0.5 + 0.5 * hash2(i, 1, 71);
    const a = (0.5 + 0.5 * hash2(i, 2, 71)) * Math.PI * 2;
    // Even over the dome (the sine of the elevation spread evenly).
    const y = 0.03 + 0.97 * u;
    const h = Math.sqrt(1 - y * y);
    positions[i * 3] = Math.cos(a) * h * r;
    positions[i * 3 + 1] = y * r;
    positions[i * 3 + 2] = Math.sin(a) * h * r;
    const bright = (0.3 + 0.7 * (0.5 + 0.5 * hash2(i, 3, 71)) ** 3) * Math.min(1, y * 6);
    // A few warm, a few blue.
    const t = hash2(i, 4, 71);
    c.setRGB(1, 1, 1)
      .lerp(t > 0 ? warm : cool, Math.abs(t) * 0.5)
      .multiplyScalar(bright);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  g.setAttribute('color', new BufferAttribute(colors, 3));
  const stars = new Points(g, starMaterial);
  stars.frustumCulled = false;
  return stars;
}

/** The moon, with a few darker seas on its face, and a soft halo round it; both face the sky dome's middle (the camera). */
function createMoon(): Mesh[] {
  const L = CONFIG.lights;
  const dir = new Vector3(L.moonAt.x, L.moonAt.y, L.moonAt.z).normalize();
  const dist = SKY * MOON_AT;
  const radius = dist * Math.tan(((L.moonSize / 2) * Math.PI) / 180);
  const face = new Color(L.moonColor);
  const sea = face.clone().multiplyScalar(0.8);
  const positions: number[] = [];
  const colors: number[] = [];
  const disc = (cx: number, cy: number, r: number, z: number, col: Color, segments: number): void => {
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      positions.push(cx, cy, z, cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, z, cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, z);
      for (let v = 0; v < 3; v++) colors.push(col.r, col.g, col.b);
    }
  };
  disc(0, 0, radius, 0, face, 24);
  for (const [x, y, r] of [
    [-0.3, 0.25, 0.28],
    [0.2, 0.32, 0.18],
    [0.12, -0.18, 0.3],
    [-0.28, -0.35, 0.14],
  ] as const) {
    disc(x * radius, y * radius, r * radius, radius * 0.01, sea, 12);
  }
  const moonGeo = new BufferGeometry();
  moonGeo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  moonGeo.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));

  // The halo: rings from the moon's edge out to HALO times its radius,
  // falling off steeply first and then slowly, so it has no visible rim.
  const halo: number[] = [];
  const haloColors: number[] = [];
  const rings: [number, number][] = [
    [0.95, 0.22],
    [1.8, 0.06],
    [3, 0.015],
    [HALO, 0],
  ];
  const segments = 32;
  const p = (a: number, r: number): number[] => [Math.cos(a) * r, Math.sin(a) * r, -radius * 0.01];
  for (let k = 0; k < rings.length - 1; k++) {
    const [r0, g0] = rings[k]!;
    const [r1, g1] = rings[k + 1]!;
    const c0 = face.clone().multiplyScalar(g0);
    const c1 = face.clone().multiplyScalar(g1);
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      halo.push(...p(a0, radius * r0), ...p(a0, radius * r1), ...p(a1, radius * r1), ...p(a0, radius * r0), ...p(a1, radius * r1), ...p(a1, radius * r0));
      for (const c of [c0, c1, c1, c0, c1, c0]) haloColors.push(c.r, c.g, c.b);
    }
  }
  const haloGeo = new BufferGeometry();
  haloGeo.setAttribute('position', new BufferAttribute(new Float32Array(halo), 3));
  haloGeo.setAttribute('color', new BufferAttribute(new Float32Array(haloColors), 3));

  const out = [new Mesh(haloGeo, haloMaterial), new Mesh(moonGeo, moonMaterial)];
  for (const m of out) {
    m.position.copy(dir).multiplyScalar(dist);
    m.lookAt(0, 0, 0);
    m.frustumCulled = false;
  }
  return out;
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
 * Foothills from the edge of the map's ground out to the foot of the
 * nearest ranges: from below the map's edge, rolling ridges rise toward the
 * ranges, forested low down, snowy up high and rocky where steep, so the
 * land carries on to the mountains instead of a flat void. Built like the
 * ranges (unlit facets, relit for the weather), with each facet's distance
 * from the middle, so its haze can carry on from the world's at the map's
 * edge into the ranges' gentler haze further out (see relightPeaks).
 */
function plainGeometry(hf: Heightfield, def: PeaksDef): PeakColors {
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
  const relief = (def.height[0] - def.base) * PLAIN_RELIEF;
  const sun = new Vector3(CONFIG.light.sunFrom.x, CONFIG.light.sunFrom.y, CONFIG.light.sunFrom.z).normalize();
  const around = PLAIN_AROUND;
  const rings = PLAIN_RINGS;
  const grid: Vector3[][] = [];
  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1);
    const rr0 = inner + (outer - inner) * t ** 1.5;
    const row: Vector3[] = [];
    for (let j = 0; j < around; j++) {
      const a = ((j + (i % 2) * 0.5) / around) * Math.PI * 2;
      const rr = rr0 * (1 + (i === 0 ? 0 : 0.02 * hash2(i, j, def.seed + 11)));
      const x = cx - Math.sin(a) * rr;
      const z = cz - Math.cos(a) * rr;
      // Ridges (folded noise) growing from nothing at the map's edge, and smaller rolls on them.
      const ridge = 1 - Math.abs(fbm(x / 2400, z / 2400, def.seed + 21));
      const grow = smoothstep(0.04, 0.5, t);
      const y = top + (def.base - top) * t + grow * (relief * ridge * ridge + relief * 0.25 * fbm(x / 800, z / 800, def.seed + 13));
      row.push(new Vector3(x, y, z));
    }
    grid.push(row);
  }
  const positions: number[] = [];
  const albedo: number[] = [];
  const ambient: number[] = [];
  const direct: number[] = [];
  const hazes: number[] = [];
  const dist: number[] = [];
  const blend: number[] = [];
  const color = new Color();
  const n = new Vector3();
  const e1 = new Vector3();
  const e2 = new Vector3();
  const tri = (p0: Vector3, p1: Vector3, p2: Vector3): void => {
    n.crossVectors(e1.subVectors(p1, p0), e2.subVectors(p2, p0)).normalize();
    // Facing up, toward the sky (and the camera above it).
    const flip = n.y < 0;
    if (flip) n.negate();
    const mx = (p0.x + p1.x + p2.x) / 3;
    const my = (p0.y + p1.y + p2.y) / 3;
    const mz = (p0.z + p1.z + p2.z) / 3;
    const steep = 1 - n.y;
    const above = my - def.snowLine;
    const forest = 0.5 + 1.3 * fbm(mx / 700, mz / 700, def.seed + 17);
    const t = 0.5 + 0.5 * hash2(Math.round(mx), Math.round(mz), def.seed + 3);
    if (steep > 0.5) color.copy(ROCK).lerp(SNOW_SHADE, 0.35 * t);
    else if (forest > 0.3 && above < 250 * (1 - t)) color.copy(FOREST).lerp(SNOW_SHADE, 0.15 * t);
    else color.copy(SNOW).lerp(SNOW_SHADE, 0.15 + 0.3 * t);
    albedo.push(color.r, color.g, color.b);
    ambient.push(0.62 + 0.08 * n.y);
    direct.push(0.5 * Math.max(0, n.dot(sun)));
    const d = Math.hypot(mx - cx, mz - cz);
    const far = 1 - Math.pow(0.5, d / HAZE_HALF);
    hazes.push(Math.min(1, far * 1.45 + 0.1));
    dist.push(d);
    blend.push(smoothstep(inner, inner + PLAIN_BLEND, d));
    for (const p of flip ? [p0, p2, p1] : [p0, p1, p2]) positions.push(p.x, p.y, p.z);
  };
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < around; j++) {
      const a = grid[i]![j]!;
      const b = grid[i]![(j + 1) % around]!;
      // Odd rings are turned half a step: pair each point with the two beside it on the next ring.
      const shift = i % 2 === 0 ? 0 : 1;
      const d = grid[i + 1]![(j + shift) % around]!;
      const e = grid[i + 1]![(j + shift - 1 + around) % around]!;
      tri(a, d, b);
      tri(a, e, d);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(positions.length), 3));
  g.computeBoundingSphere();
  return {
    geometry: g,
    albedo: new Float32Array(albedo),
    ambient: new Float32Array(ambient),
    direct: new Float32Array(direct),
    haze: new Float32Array(hazes),
    dist: new Float32Array(dist),
    blend: new Float32Array(blend),
  };
}
