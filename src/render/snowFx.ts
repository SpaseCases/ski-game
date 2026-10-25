import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  OctahedronGeometry,
  Points,
  Quaternion,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
} from 'three';
import { CONFIG } from '../config.ts';
import type { SnowBudget } from '../core/settings.ts';
import type { BuiltMap } from '../maps/build.ts';
import type { GroomedPatch, Heightfield, MapDef, RailShape, XZ } from '../maps/types.ts';
import { insideBounds } from '../sim/bounds.ts';
import type { SkierState } from '../sim/skier.ts';
import type { SkierPose } from './skierView.ts';
import { STANCE_HALF_WIDTH } from './skierPoses.ts';
import { shapeSurfaceAt, SURFACE } from '../maps/shapes.ts';
import { smoothstep } from '../maps/terrain.ts';
import { drawnHeightAt } from './terrainMesh.ts';
import { uploadFirst } from './upload.ts';

// Snow effects: spray off the skis, ski tracks, landing puffs, crash
// bursts, rail sparks, powder clouds and snow blowing off ridges. One pool
// of particles in a ring buffer (the oldest gives way when it's full),
// drawn as two instanced meshes (chunks of snow, and sparks) and one set of
// soft round points (wisps: blowing snow and powder clouds, which grow and
// thin out), and a ribbon per ski for the tracks: four draw calls at most,
// and nothing allocated per frame. Everything is worked out from the sim's
// state as it changes (a landing resets landTime, a crash sets bailed, and
// so on); the sim knows nothing of it.
//
// Falling snow (the blizzard) has flakes of its own, apart from the pool:
// a fixed number in a box round the camera, blown along by the wind and
// wrapped round the box as the camera moves, so the snow stays as thick
// at any speed: one more draw call while it snows.

/** What the weather drives (the blizzard): see setWeather. */
export interface SnowWeather {
  /** Falling snow: the share of the preset's flakes falling (0: none, 1: all of them). */
  snowfall: number;
  /** Multiplies the snow blowing off ridges, wind lips and cornices (1: a clear day's). */
  ridgeSnow: number;
  /** Multiplies CONFIG.snowFx.windSpeed. */
  wind: number;
  /** How gusty the wind is, 0 (steady) to 1. */
  gust: number;
}

export const CLEAR_WEATHER: Readonly<SnowWeather> = { snowfall: 0, ridgeSnow: 1, wind: 1, gust: 0.3 };

const SNOW = 0;
const SPARK = 1;
/** Blowing and falling snow: small, bright and see-through. */
const WISP = 2;
/** Random fixed orientations the snow particles are drawn at, so the facets don't all line up. */
const TURNS = 8;
/** Track vertices sit this far (m) above the drawn snow (the material's polygon offset does the rest). */
const TRACK_LIFT = 0.01;
/** The oldest share of a track's points fades out, so reusing a slot never pops. */
const TAIL_SHARE = 0.2;
/** Only check whether the skier is in powder again after moving this far (m). */
const POWDER_STEP = 2;
/** Flakes shrink away within this distance (m) of their box's sides, so wrapping round it never pops. */
const FLAKE_EDGE = 3;
/** Flakes closer than this (m) to the camera shrink away. */
const FLAKE_NEAR = 2.5;

// Smooth shaded with a little glow of its own, so a cloud reads as soft and bright rather than faceted gray.
const SNOW_GLOW = new Color('#2b3139');
const WISP_COLOR = new Color('#f7faff');
const snowMaterial = new MeshLambertMaterial({ color: new Color('#f3f7fb'), emissive: SNOW_GLOW.clone(), transparent: true, opacity: 0.85, depthWrite: false });
const sparkMaterial = new MeshBasicMaterial({ color: new Color('#ffd27a') });
/**
 * Wisps (blowing snow, powder clouds): soft round points, each sized in
 * meters (scale: pixels per meter at 1 m away) and faded by its own alpha,
 * fogged like the world. Their shape is worked out per pixel, no texture.
 */
const wispMaterial = new ShaderMaterial({
  uniforms: UniformsUtils.merge([UniformsLib.fog, { color: { value: WISP_COLOR.clone() }, opacity: { value: 0.75 }, scale: { value: 1 } }]),
  vertexShader: /* glsl */ `
    attribute float size;
    attribute float alpha;
    uniform float scale;
    varying float vAlpha;
    #include <fog_pars_vertex>
    void main() {
      vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
      gl_Position = projectionMatrix * mvPosition;
      gl_PointSize = min( 256.0, size * scale / max( -mvPosition.z, 0.1 ) );
      vAlpha = alpha;
      #include <fog_vertex>
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform float opacity;
    varying float vAlpha;
    #include <fog_pars_fragment>
    void main() {
      vec2 c = gl_PointCoord * 2.0 - 1.0;
      float d = 1.0 - dot( c, c );
      if ( d <= 0.0 ) discard;
      // Lit on top, a cool shade underneath, so a cloud reads as round even against white snow.
      vec3 shade = mix( color, color * vec3( 0.72, 0.78, 0.9 ), gl_PointCoord.y );
      gl_FragColor = vec4( shade, opacity * vAlpha * d * d );
      #include <fog_fragment>
      #include <colorspace_fragment>
    }`,
  fog: true,
  transparent: true,
  depthWrite: false,
});
/** A wisp's point is this many times its particle's size across (the soft edge makes it look smaller than its square). */
const WISP_SPREAD = 3.2;
const flakeMaterial = new MeshBasicMaterial({ color: WISP_COLOR.clone(), transparent: true, opacity: 0.8, depthWrite: false });
const trackMaterial = new MeshLambertMaterial({
  vertexColors: true,
  transparent: true,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -4,
});
/** Track color: the same everywhere, powder or groomed. */
const TRACK_COLOR = new Color('#a9bccf');

const UP = new Vector3(0, 1, 0);

export class SnowFx {
  readonly group = new Group();
  private readonly hf: Heightfield;
  private readonly map: MapDef;
  private readonly rails: readonly RailShape[];
  private readonly budget: SnowBudget;
  private weather: SnowWeather = { ...CLEAR_WEATHER };
  private time = 0;

  // The particle pool, one entry per slot.
  private readonly size: number;
  private next = 0;
  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly pz: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly size0: Float32Array;
  private readonly size1: Float32Array;
  private readonly gravity: Float32Array;
  private readonly drag: Float32Array;
  private readonly kind: Uint8Array;
  private readonly snowMesh: InstancedMesh;
  private readonly sparkMesh: InstancedMesh;
  /** Wisps as soft points: position, size (m across) and alpha per point, the first few drawn. */
  private readonly wisps: Points;
  private readonly wispPos: BufferAttribute;
  private readonly wispSize: BufferAttribute;
  private readonly wispAlpha: BufferAttribute;
  /** TURNS rotation matrices, 9 numbers each (column-major). */
  private readonly turns = new Float32Array(TURNS * 9);

  // Emission left over from the last frame (a fraction of a particle).
  private carveCarry = 0;
  private brakeCarry = 0;
  private trailCarry = 0;
  private sparkCarry = 0;
  private bailCarry = 0;
  /** Falling flakes: position, radius and sway phase; the first `fallCount` fall. */
  private readonly fx: Float32Array;
  private readonly fy: Float32Array;
  private readonly fz: Float32Array;
  private readonly fsize: Float32Array;
  private readonly fphase: Float32Array;
  private readonly flakeMesh: InstancedMesh;
  private fallCount = 0;
  /** True until the flakes are first scattered round the camera. */
  private flakesUnplaced = true;
  /** What the sim showed last frame, to see landings and crashes happen. */
  private lastLandTime = Infinity;
  private wasBailed = false;
  private powder = false;
  private powderX = Infinity;
  private powderZ = Infinity;

  // Ridge snow emitters: position, the way their snow blows (0, 0: with the wind), strength, gust phase.
  private readonly ex: Float32Array;
  private readonly ey: Float32Array;
  private readonly ez: Float32Array;
  private readonly edx: Float32Array;
  private readonly edz: Float32Array;
  private readonly estrength: Float32Array;
  private readonly ephase: Float32Array;
  private readonly ecarry: Float32Array;

  // Tracks: a ring of points per ski, each point two vertices across the track.
  private readonly points: number;
  private readonly trackMesh: Mesh;
  private readonly trackPos: Float32Array;
  private readonly trackNormal: Float32Array;
  private readonly trackColor: Float32Array;
  private readonly trackIndex: Uint16Array;
  private readonly birth: Float32Array;
  private readonly opacity: Float32Array;
  private readonly head = [-1, -1];
  private readonly cursor = [0, 0];
  private readonly lastX = [0, 0];
  private readonly lastZ = [0, 0];
  private trackMoved = false;

  // Scratch.
  private readonly qTilt = new Quaternion();
  private readonly skiFwd = new Vector3();
  private readonly skiLeft = new Vector3();
  private readonly fwd = new Vector3();
  private readonly left = new Vector3();
  private readonly travel = new Vector3();
  private readonly travelLeft = new Vector3();
  private readonly tangent = new Vector3();
  private readonly at = new Vector3();
  private readonly dir = new Vector3();
  private readonly side = new Vector3();

  constructor(built: BuiltMap, budget: SnowBudget) {
    this.hf = built.hf;
    this.map = built.map;
    this.rails = built.course.rails;
    this.budget = budget;
    this.group.matrixAutoUpdate = false;

    const n = Math.max(1, budget.particles);
    this.size = n;
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.pz = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.vz = new Float32Array(n);
    this.age = new Float32Array(n);
    this.life = new Float32Array(n);
    this.size0 = new Float32Array(n);
    this.size1 = new Float32Array(n);
    this.gravity = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.kind = new Uint8Array(n);
    this.snowMesh = instanced(new IcosahedronGeometry(1, 0), snowMaterial, n);
    this.sparkMesh = instanced(new OctahedronGeometry(1, 0), sparkMaterial, n);
    this.wispPos = new BufferAttribute(new Float32Array(n * 3), 3);
    this.wispSize = new BufferAttribute(new Float32Array(n), 1);
    this.wispAlpha = new BufferAttribute(new Float32Array(n), 1);
    const wispGeometry = new BufferGeometry();
    wispGeometry.setAttribute('position', this.wispPos);
    wispGeometry.setAttribute('size', this.wispSize);
    wispGeometry.setAttribute('alpha', this.wispAlpha);
    wispGeometry.setDrawRange(0, 0);
    this.wisps = new Points(wispGeometry, wispMaterial);
    this.wisps.frustumCulled = false;
    this.wisps.matrixAutoUpdate = false;
    this.wisps.visible = false;
    this.group.add(this.snowMesh, this.sparkMesh, this.wisps);
    const nf = Math.max(1, budget.flakes);
    this.fx = new Float32Array(nf);
    this.fy = new Float32Array(nf);
    this.fz = new Float32Array(nf);
    this.fsize = new Float32Array(nf);
    this.fphase = new Float32Array(nf);
    const fs = CONFIG.snowFx.flakeSize;
    for (let i = 0; i < nf; i++) {
      this.fsize[i] = fs.min + (fs.max - fs.min) * Math.random();
      this.fphase[i] = Math.random() * Math.PI * 2;
    }
    this.flakeMesh = instanced(new OctahedronGeometry(1, 0), flakeMaterial, nf);
    this.group.add(this.flakeMesh);
    const q = new Quaternion();
    const e = new Vector3();
    for (let i = 0; i < TURNS; i++) {
      // A spread of fixed orientations (golden-angle axes).
      const y = 1 - (2 * (i + 0.5)) / TURNS;
      const r = Math.sqrt(1 - y * y);
      const a = i * 2.39996;
      q.setFromAxisAngle(e.set(Math.cos(a) * r, y, Math.sin(a) * r), 0.7 + i * 0.9);
      writeRotation(this.turns, i * 9, q);
    }

    const emitters = ridgeEmitters(built.map, built.hf);
    const m = emitters.length;
    this.ex = new Float32Array(m);
    this.ey = new Float32Array(m);
    this.ez = new Float32Array(m);
    this.edx = new Float32Array(m);
    this.edz = new Float32Array(m);
    this.estrength = new Float32Array(m);
    this.ephase = new Float32Array(m);
    this.ecarry = new Float32Array(m);
    emitters.forEach((p, i) => {
      this.ex[i] = p.x;
      this.ey[i] = drawnHeightAt(built.hf, p.x, p.z) + 0.3;
      this.ez[i] = p.z;
      this.edx[i] = p.dx;
      this.edz[i] = p.dz;
      this.estrength[i] = p.strength;
      this.ephase[i] = (i * 2.39996) % (Math.PI * 2);
    });

    const pts = Math.max(4, budget.trackPoints);
    this.points = pts;
    const verts = 2 * pts * 2;
    this.trackPos = new Float32Array(verts * 3);
    this.trackNormal = new Float32Array(verts * 3);
    this.trackColor = new Float32Array(verts * 4);
    this.trackIndex = new Uint16Array(2 * pts * 6);
    this.birth = new Float32Array(2 * pts).fill(-Infinity);
    this.opacity = new Float32Array(2 * pts);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.trackPos, 3));
    geo.setAttribute('normal', new BufferAttribute(this.trackNormal, 3));
    geo.setAttribute('color', new BufferAttribute(this.trackColor, 4));
    geo.setIndex(new BufferAttribute(this.trackIndex, 1));
    this.trackMesh = new Mesh(geo, trackMaterial);
    this.trackMesh.frustumCulled = false;
    this.trackMesh.matrixAutoUpdate = false;
    this.trackMesh.renderOrder = 1;
    this.trackMesh.visible = false;
    this.group.add(this.trackMesh);
  }

  /** The weather's part in the effects: falling snow, ridge snow and wind (see SnowWeather). */
  setWeather(w: SnowWeather): void {
    this.weather = { ...w };
    const count = Math.round(Math.min(1, Math.max(0, w.snowfall)) * this.fx.length);
    if (count > 0 && this.fallCount === 0) this.flakesUnplaced = true;
    this.fallCount = count;
    if (count === 0) commit(this.flakeMesh, 0);
  }

  /**
   * Tints what's drawn unlit (blowing and falling snow) and the spray's own
   * glow by the weather's light, so at night they don't shine. Shared by
   * every map's effects.
   */
  static setTint(tint: Color): void {
    (wispMaterial.uniforms.color!.value as Color).copy(WISP_COLOR).multiply(tint);
    flakeMaterial.color.copy(WISP_COLOR).multiply(tint);
    snowMaterial.emissive.copy(SNOW_GLOW).multiply(tint);
  }

  /** How big the wisps draw: pixels per meter at 1 m away (the drawing buffer's height over the view's height there). */
  static setPointScale(pxPerM: number): void {
    wispMaterial.uniforms.scale!.value = pxPerM;
  }

  /** True while the skier rides powder (off-piste on Freeride), checked every few meters. */
  get inPowder(): boolean {
    return this.powder;
  }

  /** The skier jumped to a new spot (start, respawn): the tracks break and nothing is taken for a landing or crash. */
  snap(sim: SkierState): void {
    this.breakTrack(0);
    this.breakTrack(1);
    this.lastLandTime = sim.landTime;
    this.wasBailed = sim.bailed;
    this.powderX = Infinity;
  }

  /** Moves everything on by `dt` s, with the skier drawn at `pose` and the sim's own state `sim`; `cam` is the camera. */
  update(pose: SkierPose, sim: SkierState, dt: number, cam: Vector3): void {
    if (dt <= 0) return;
    this.time += dt;
    this.skierFrame(pose);
    this.checkPowder(pose.position);
    this.emitSkier(pose, sim, dt);
    this.emitRidges(dt, cam);
    this.lastLandTime = sim.landTime;
    this.wasBailed = sim.bailed;
    this.layTracks(pose);
    this.move(dt);
    this.draw();
    this.drawTracks();
    if (this.fallCount > 0) this.snowfall(dt, cam, pose.position);
  }

  /** Frees the meshes' geometry (the materials are shared). */
  dispose(): void {
    this.group.removeFromParent();
    this.snowMesh.geometry.dispose();
    this.snowMesh.dispose();
    this.sparkMesh.geometry.dispose();
    this.sparkMesh.dispose();
    this.wisps.geometry.dispose();
    this.flakeMesh.geometry.dispose();
    this.flakeMesh.dispose();
    this.trackMesh.geometry.dispose();
  }

  // ---------------------------------------------------------------- emitting

  /** The skis' frame on the snow (with the hockey-stop swing), the unswung one, and the way the skier travels along the snow. */
  private skierFrame(pose: SkierPose): void {
    const n = pose.normal;
    this.qTilt.setFromUnitVectors(UP, n);
    const swing = pose.grounded && !pose.bailed && !pose.onRail ? pose.brake * CONFIG.render.brakeTwist * pose.brakeSide : 0;
    this.fwd.set(-Math.sin(pose.yaw), 0, -Math.cos(pose.yaw)).applyQuaternion(this.qTilt);
    this.left.crossVectors(n, this.fwd);
    this.skiFwd.set(-Math.sin(pose.yaw + swing), 0, -Math.cos(pose.yaw + swing)).applyQuaternion(this.qTilt);
    this.skiLeft.crossVectors(n, this.skiFwd);
    this.tangent.copy(pose.velocity).addScaledVector(n, -pose.velocity.dot(n));
    const speed = this.tangent.length();
    if (speed > 0.3) this.travel.copy(this.tangent).divideScalar(speed);
    else this.travel.copy(this.skiFwd);
    this.travelLeft.crossVectors(n, this.travel);
  }

  private checkPowder(p: Vector3): void {
    if ((p.x - this.powderX) ** 2 + (p.z - this.powderZ) ** 2 < POWDER_STEP * POWDER_STEP) return;
    this.powderX = p.x;
    this.powderZ = p.z;
    this.powder = inPowder(this.map, p.x, p.z);
  }

  private emitSkier(pose: SkierPose, sim: SkierState, dt: number): void {
    const f = CONFIG.snowFx;
    const rate = this.budget.rate;
    const speed = this.tangent.length();
    const powder = this.powder;
    const P = f.powder;
    const n = pose.normal;
    const riding = pose.grounded && !pose.bailed && !pose.onRail;

    // Landing: a puff spreading over the snow, bigger the harder it hit.
    if (sim.landTime < this.lastLandTime && sim.rail < 0 && !sim.bailed && sim.landImpact > f.landing.impactMin) {
      const k = smoothstep(f.landing.impactMin, f.landing.impactFull, sim.landImpact);
      const count = Math.round(f.landing.count * (0.25 + 0.75 * k) * rate * (powder ? 1.5 : 1));
      const grow = powder ? 1.6 : 1;
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        this.dir.copy(this.skiFwd).multiplyScalar(Math.cos(a)).addScaledVector(this.skiLeft, Math.sin(a));
        const out = (2 + 5 * k) * (0.4 + 0.6 * Math.random());
        const up = (0.5 + 1.5 * k) * Math.random();
        this.at.copy(pose.position).addScaledVector(this.dir, 0.3 * Math.random()).addScaledVector(n, 0.05);
        this.spawn(
          this.at,
          this.dir.x * out + n.x * up + this.tangent.x * 0.5,
          this.dir.y * out + n.y * up + this.tangent.y * 0.5,
          this.dir.z * out + n.z * up + this.tangent.z * 0.5,
          (0.6 + 0.5 * Math.random()) * (powder ? P.life * 0.8 : 1),
          0.04 * grow,
          (0.1 + 0.16 * k) * grow * (0.7 + 0.6 * Math.random()),
          0.35,
          2,
          powder && Math.random() < P.puffs ? WISP : SNOW,
        );
      }
    }

    // Crash: a burst of snow, then a trail while the body tumbles along.
    if (sim.bailed && !this.wasBailed) {
      const count = Math.round(f.crash.count * rate * (powder ? 1.4 : 1));
      for (let i = 0; i < count; i++) {
        randomUnit(this.dir);
        if (this.dir.dot(n) < 0) this.dir.addScaledVector(n, -2 * this.dir.dot(n));
        const out = 2.5 + 4.5 * Math.random();
        this.spawn(
          pose.center,
          this.dir.x * out + this.tangent.x * 0.6,
          this.dir.y * out + this.tangent.y * 0.6 + 2,
          this.dir.z * out + this.tangent.z * 0.6,
          (0.7 + 0.6 * Math.random()) * (powder ? 1.4 : 1),
          0.04 + 0.05 * Math.random(),
          (0.1 + 0.18 * Math.random()) * (powder ? 2.5 : 1),
          0.7,
          1.6,
          powder && Math.random() < P.puffs ? WISP : SNOW,
        );
      }
    }
    if (pose.bailed) {
      this.bailCarry += f.crash.trailRate * speed * rate * dt;
      while (this.bailCarry >= 1) {
        this.bailCarry -= 1;
        this.at.copy(pose.center).addScaledVector(n, -0.3);
        this.spray(this.at, this.tangent.x * 0.3 + n.x, this.tangent.y * 0.3 + n.y, this.tangent.z * 0.3 + n.z, powder, 1.5);
      }
    } else {
      this.bailCarry = 0;
    }

    // Sparks off a metal rail (never a box or a log), more while ↓ brakes on it.
    const rail = sim.rail >= 0 ? this.rails[sim.rail] : undefined;
    if (rail && rail.kind === 'rail' && rail.metal) {
      const s = f.sparks;
      const along = Math.abs(sim.railSpeed);
      this.sparkCarry += s.rate * smoothstep(s.speedMin, s.speedFull, along) * (1 + s.brake * pose.brake) * rate * dt;
      while (this.sparkCarry >= 1) {
        this.sparkCarry -= 1;
        this.at.copy(pose.position).addScaledVector(this.skiFwd, (Math.random() - 0.5) * 0.9);
        randomUnit(this.dir);
        const kick = 1 + 2.5 * Math.random();
        this.spawn(
          this.at,
          -pose.velocity.x * 0.15 + this.dir.x * kick,
          -pose.velocity.y * 0.15 + Math.abs(this.dir.y) * kick + 1,
          -pose.velocity.z * 0.15 + this.dir.z * kick,
          s.life * (0.4 + 0.6 * Math.random()),
          0.018,
          0.018,
          1,
          0.4,
          SPARK,
        );
      }
    } else {
      this.sparkCarry = 0;
    }

    if (!riding) {
      this.carveCarry = 0;
      this.brakeCarry = 0;
      this.trailCarry = 0;
      return;
    }
    const thick = rate * (powder ? P.rate : 1);

    // Carving hard (and skidding): spray off the outside ski, thrown out of the turn.
    const c = f.carve;
    const slip = Math.abs(this.tangent.dot(this.left));
    const carve = Math.min(1, smoothstep(c.edgeMin, c.edgeFull, Math.abs(pose.lean)) + 0.6 * smoothstep(1, 5, slip)) * smoothstep(c.speedMin, c.speedFull, speed);
    this.carveCarry += c.rate * carve * thick * dt;
    const outSign = pose.lean >= 0 ? -1 : 1;
    while (this.carveCarry >= 1) {
      this.carveCarry -= 1;
      // The outside ski: right in a left turn (lean > 0).
      this.at
        .copy(pose.position)
        .addScaledVector(this.skiLeft, outSign * (STANCE_HALF_WIDTH + 0.06))
        .addScaledVector(this.skiFwd, -0.75 + 0.95 * Math.random());
      const out = (1.5 + 3 * carve) * (0.4 + 0.6 * Math.random()) * outSign;
      const up = (1 + 2 * carve) * (0.4 + 0.6 * Math.random());
      this.spray(
        this.at,
        this.skiLeft.x * out + n.x * up + this.tangent.x * 0.55,
        this.skiLeft.y * out + n.y * up + this.tangent.y * 0.55,
        this.skiLeft.z * out + n.z * up + this.tangent.z * 0.55,
        powder,
        1,
      );
    }

    // Braking or a hockey stop: a sheet of spray off the skis' leading edges.
    const b = f.brake;
    const brake = pose.brake * smoothstep(b.speedMin, b.speedFull, speed);
    this.brakeCarry += b.rate * brake * thick * dt;
    while (this.brakeCarry >= 1) {
      this.brakeCarry -= 1;
      const foot = Math.random() < 0.5 ? 1 : -1;
      this.at
        .copy(pose.position)
        .addScaledVector(this.skiLeft, foot * STANCE_HALF_WIDTH)
        .addScaledVector(this.skiFwd, (Math.random() - 0.5) * 1.5)
        .addScaledVector(this.travel, 0.12);
      // Thrown on ahead of the skis, which are slowing down behind it.
      const ahead = 1 + 3 * Math.random();
      const up = (1.2 + 2.5 * Math.random()) * (0.4 + 0.6 * brake);
      const fan = (Math.random() - 0.5) * 2;
      this.spray(
        this.at,
        this.tangent.x + this.travel.x * ahead + n.x * up + this.skiFwd.x * fan,
        this.tangent.y + this.travel.y * ahead + n.y * up + this.skiFwd.y * fan,
        this.tangent.z + this.travel.z * ahead + n.z * up + this.skiFwd.z * fan,
        powder,
        1,
      );
    }

    // Powder: riding fast kicks up a trail off the tips, even going straight.
    if (powder && speed > P.trailSpeed) {
      this.trailCarry += P.trailRate * smoothstep(P.trailSpeed, P.trailSpeed + 10, speed) * rate * dt;
      while (this.trailCarry >= 1) {
        this.trailCarry -= 1;
        const foot = Math.random() < 0.5 ? 1 : -1;
        this.at.copy(pose.position).addScaledVector(this.skiLeft, foot * STANCE_HALF_WIDTH * 2).addScaledVector(this.skiFwd, 0.3 + 0.5 * Math.random());
        const spread = (Math.random() - 0.5) * 2;
        const up = 0.5 + Math.random();
        this.spray(
          this.at,
          this.tangent.x * 0.35 + this.travelLeft.x * spread + n.x * up,
          this.tangent.y * 0.35 + this.travelLeft.y * spread + n.y * up,
          this.tangent.z * 0.35 + this.travelLeft.z * spread + n.z * up,
          true,
          0.8,
        );
      }
    } else {
      this.trailCarry = 0;
    }
  }

  /** One particle of spray (or a powder cloud's), `scale` times the usual size. */
  private spray(at: Vector3, vx: number, vy: number, vz: number, powder: boolean, scale: number): void {
    const s = CONFIG.snowFx.spray;
    const P = CONFIG.snowFx.powder;
    // In powder most of it is cloud; the chunks left in it are small clumps.
    const puff = powder && Math.random() < P.puffs;
    const grow = powder ? P.size * scale * (puff ? 1 : P.clumps) : scale;
    this.spawn(
      at,
      vx,
      vy,
      vz,
      s.life * (0.6 + 0.6 * Math.random()) * (powder ? P.life : 1),
      s.size0 * grow,
      s.size1 * grow * (0.7 + 0.6 * Math.random()),
      powder ? P.gravity : s.gravity,
      powder ? P.drag : s.drag,
      puff ? WISP : SNOW,
    );
  }

  /** Snow blowing off the ridges, wind lips and cornices near the camera, in gusts. */
  private emitRidges(dt: number, cam: Vector3): void {
    const m = this.ex.length;
    const w = this.weather;
    if (m === 0 || w.ridgeSnow <= 0) return;
    const r = CONFIG.snowFx.ridge;
    const range2 = this.budget.ridgeRange * this.budget.ridgeRange;
    const wind = CONFIG.snowFx.wind;
    const len = Math.hypot(wind.x, wind.z) || 1;
    const speed = CONFIG.snowFx.windSpeed * w.wind;
    const base = r.rate * w.ridgeSnow * this.budget.rate * dt;
    for (let i = 0; i < m; i++) {
      const x = this.ex[i]!;
      const z = this.ez[i]!;
      if ((x - cam.x) ** 2 + (z - cam.z) ** 2 > range2) {
        this.ecarry[i] = 0;
        continue;
      }
      const g = 0.5 + 0.5 * Math.sin(this.time * 0.8 + this.ephase[i]!);
      let carry = this.ecarry[i]! + base * this.estrength[i]! * g * g * g;
      let dx = this.edx[i]!;
      let dz = this.edz[i]!;
      if (dx === 0 && dz === 0) {
        dx = wind.x / len;
        dz = wind.z / len;
      }
      while (carry >= 1) {
        carry -= 1;
        const jitter = r.spacing * 0.5;
        this.at.set(x + (Math.random() - 0.5) * jitter, this.ey[i]! + Math.random() * 0.4, z + (Math.random() - 0.5) * jitter);
        const v = speed * (0.6 + 0.6 * Math.random());
        this.spawn(this.at, dx * v, 0.3 + 1.2 * Math.random(), dz * v, r.life * (0.6 + 0.4 * Math.random()), r.size0, r.size1 * (0.7 + 0.6 * Math.random()), 0.05, 0.8, WISP);
      }
      this.ecarry[i] = carry;
    }
  }

  /**
   * Falling snow: moves the falling flakes on with the wind (each swaying
   * a little) and wraps them round a box in front of the camera at `cam`,
   * looking toward the skier at `skier`. Every flake streams the same way,
   * so they all share one stretched orientation along the way they blow.
   */
  private snowfall(dt: number, cam: Vector3, skier: Vector3): void {
    const f = CONFIG.snowFx;
    const n = this.fallCount;
    const half = f.flakeBox / 2;
    const halfH = f.flakeHeight / 2;
    // The box's middle: ahead of the camera toward the skier, just above it (flakes under the snow would be wasted).
    let ax = skier.x - cam.x;
    let az = skier.z - cam.z;
    const al = Math.hypot(ax, az);
    if (al > 1e-3) {
      ax /= al;
      az /= al;
    }
    const cx = cam.x + ax * f.flakeAhead;
    const cy = cam.y + 1;
    const cz = cam.z + az * f.flakeAhead;
    if (this.flakesUnplaced) {
      this.flakesUnplaced = false;
      for (let i = 0; i < this.fx.length; i++) {
        this.fx[i] = cx + (Math.random() - 0.5) * f.flakeBox;
        this.fy[i] = cy + (Math.random() - 0.5) * f.flakeHeight;
        this.fz[i] = cz + (Math.random() - 0.5) * f.flakeBox;
      }
    }
    const wind = f.wind;
    const len = Math.hypot(wind.x, wind.z) || 1;
    const speed = f.windSpeed * this.weather.wind * this.gust();
    const vx = (wind.x / len) * speed;
    const vz = (wind.z / len) * speed;
    const vy = -f.flakeFall;
    // The shared streak: long along the way they blow, round across it.
    const v = Math.hypot(vx, vy, vz);
    const dx = vx / v;
    const dy = vy / v;
    const dz = vz / v;
    let sx = -dz;
    let sz = dx;
    const sl = Math.hypot(sx, sz) || 1;
    sx /= sl;
    sz /= sl;
    const ux = -dy * sz;
    const uy = sz * dx - sx * dz;
    const uz = dy * sx;
    const stretch = 1 + v * 0.18;
    const sway = f.flakeSway;
    const t = this.time;
    const out = this.flakeMesh.instanceMatrix.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const ph = this.fphase[i]!;
      let x = this.fx[i]! + (vx + Math.sin(t * 1.7 + ph) * sway) * dt;
      let y = this.fy[i]! + vy * dt;
      let z = this.fz[i]! + (vz + Math.cos(t * 1.3 + ph * 1.7) * sway) * dt;
      // Round the box: out one side, in at the other.
      x -= f.flakeBox * Math.floor((x - cx) / f.flakeBox + 0.5);
      y -= f.flakeHeight * Math.floor((y - cy) / f.flakeHeight + 0.5);
      z -= f.flakeBox * Math.floor((z - cz) / f.flakeBox + 0.5);
      this.fx[i] = x;
      this.fy[i] = y;
      this.fz[i] = z;
      const edge = Math.min(half - Math.abs(x - cx), halfH - Math.abs(y - cy), half - Math.abs(z - cz));
      // Shrinking away near the box's sides, and right in front of the lens (where one flake would fill the view).
      const near = (x - cam.x) ** 2 + (y - cam.y) ** 2 + (z - cam.z) ** 2;
      const s = this.fsize[i]! * Math.min(1, edge / FLAKE_EDGE, near / (FLAKE_NEAR * FLAKE_NEAR));
      const l = s * stretch;
      const o = i * 16;
      out[o] = sx * s;
      out[o + 1] = 0;
      out[o + 2] = sz * s;
      out[o + 3] = 0;
      out[o + 4] = dx * l;
      out[o + 5] = dy * l;
      out[o + 6] = dz * l;
      out[o + 7] = 0;
      out[o + 8] = ux * s;
      out[o + 9] = uy * s;
      out[o + 10] = uz * s;
      out[o + 11] = 0;
      out[o + 12] = x;
      out[o + 13] = y;
      out[o + 14] = z;
      out[o + 15] = 1;
    }
    commit(this.flakeMesh, n);
  }

  /** The wind's strength now, as a share of its mean: it rises and falls in gusts as gusty as the weather says (the sound's wind follows it). */
  gust(): number {
    const t = this.time;
    return 1 + this.weather.gust * 0.6 * Math.sin(t * 0.7) * Math.sin(t * 0.23 + 1);
  }

  /** Starts a particle in the next slot of the ring. */
  private spawn(at: Vector3, vx: number, vy: number, vz: number, life: number, size0: number, size1: number, gravity: number, drag: number, kind: number): void {
    const i = this.next;
    this.next = (i + 1) % this.size;
    this.px[i] = at.x;
    this.py[i] = at.y;
    this.pz[i] = at.z;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.age[i] = 0;
    this.life[i] = life;
    this.size0[i] = size0;
    this.size1[i] = size1;
    this.gravity[i] = gravity;
    this.drag[i] = drag;
    this.kind[i] = kind;
  }

  // ---------------------------------------------------------------- moving and drawing

  /** Gravity, and drag toward the moving air. */
  private move(dt: number): void {
    const w = this.weather;
    const wind = CONFIG.snowFx.wind;
    const len = Math.hypot(wind.x, wind.z) || 1;
    const speed = CONFIG.snowFx.windSpeed * w.wind * this.gust();
    const ax = (wind.x / len) * speed;
    const az = (wind.z / len) * speed;
    const g = CONFIG.skier.gravity * dt;
    for (let i = 0; i < this.size; i++) {
      const life = this.life[i]!;
      if (this.age[i]! >= life) continue;
      this.age[i]! += dt;
      const keep = Math.exp(-this.drag[i]! * dt);
      const vx = ax + (this.vx[i]! - ax) * keep;
      const vy = (this.vy[i]! - g * this.gravity[i]!) * keep;
      const vz = az + (this.vz[i]! - az) * keep;
      this.vx[i] = vx;
      this.vy[i] = vy;
      this.vz[i] = vz;
      this.px[i]! += vx * dt;
      this.py[i]! += vy * dt;
      this.pz[i]! += vz * dt;
    }
  }

  /** Writes every live particle's matrix into its mesh: snow grows then shrinks away; sparks stretch along their path. */
  private draw(): void {
    const snow = this.snowMesh.instanceMatrix.array as Float32Array;
    const spark = this.sparkMesh.instanceMatrix.array as Float32Array;
    const wispPos = this.wispPos.array as Float32Array;
    const wispSize = this.wispSize.array as Float32Array;
    const wispAlpha = this.wispAlpha.array as Float32Array;
    const turns = this.turns;
    let ns = 0;
    let nk = 0;
    let nw = 0;
    for (let i = 0; i < this.size; i++) {
      const life = this.life[i]!;
      const age = this.age[i]!;
      if (age >= life) continue;
      const t = age / life;
      const x = this.px[i]!;
      const y = this.py[i]!;
      const z = this.pz[i]!;
      if (this.kind[i] === SPARK) {
        const vx = this.vx[i]!;
        const vy = this.vy[i]!;
        const vz = this.vz[i]!;
        const v = Math.hypot(vx, vy, vz) || 1;
        const dx = vx / v;
        const dy = vy / v;
        const dz = vz / v;
        // Two directions square to the path: across it (level), and the third.
        let cx = -dz;
        let cz = dx;
        let cl = Math.hypot(cx, cz);
        if (cl < 1e-3) {
          cx = 1;
          cz = 0;
          cl = 1;
        }
        cx /= cl;
        cz /= cl;
        const ux = -dy * cz;
        const uy = cz * dx - cx * dz;
        const uz = dy * cx;
        const w = this.size0[i]! * (1 - t * 0.5);
        const l = 0.04 + v * 0.04;
        const o = nk * 16;
        spark[o] = cx * w;
        spark[o + 1] = 0;
        spark[o + 2] = cz * w;
        spark[o + 3] = 0;
        spark[o + 4] = dx * l;
        spark[o + 5] = dy * l;
        spark[o + 6] = dz * l;
        spark[o + 7] = 0;
        spark[o + 8] = ux * w;
        spark[o + 9] = uy * w;
        spark[o + 10] = uz * w;
        spark[o + 11] = 0;
        spark[o + 12] = x;
        spark[o + 13] = y;
        spark[o + 14] = z;
        spark[o + 15] = 1;
        nk++;
        continue;
      }
      if (this.kind[i] === WISP) {
        // Grows all its life and thins out (a cloud), rather than shrinking away.
        wispPos[nw * 3] = x;
        wispPos[nw * 3 + 1] = y;
        wispPos[nw * 3 + 2] = z;
        wispSize[nw] = (this.size0[i]! + (this.size1[i]! - this.size0[i]!) * t) * WISP_SPREAD;
        wispAlpha[nw] = Math.min(1, t * 8) * (1 - t) * Math.sqrt(1 - t);
        nw++;
        continue;
      }
      // Pops in, grows, then shrinks away over the last third.
      const s = (this.size0[i]! + (this.size1[i]! - this.size0[i]!) * t) * Math.min(1, t * 12, (1 - t) * 3);
      const r = (i % TURNS) * 9;
      const out = snow;
      const o = ns++ * 16;
      out[o] = turns[r]! * s;
      out[o + 1] = turns[r + 1]! * s;
      out[o + 2] = turns[r + 2]! * s;
      out[o + 3] = 0;
      out[o + 4] = turns[r + 3]! * s;
      out[o + 5] = turns[r + 4]! * s;
      out[o + 6] = turns[r + 5]! * s;
      out[o + 7] = 0;
      out[o + 8] = turns[r + 6]! * s;
      out[o + 9] = turns[r + 7]! * s;
      out[o + 10] = turns[r + 8]! * s;
      out[o + 11] = 0;
      out[o + 12] = x;
      out[o + 13] = y;
      out[o + 14] = z;
      out[o + 15] = 1;
    }
    commit(this.snowMesh, ns);
    commit(this.sparkMesh, nk);
    this.wisps.geometry.setDrawRange(0, nw);
    this.wisps.visible = nw > 0;
    uploadFirst(this.wispPos, nw * 3);
    uploadFirst(this.wispSize, nw);
    uploadFirst(this.wispAlpha, nw);
  }

  // ---------------------------------------------------------------- tracks

  /** Lays the tracks under the skis while they ride the snow; in the air, on a rail or in a crash they break. */
  private layTracks(pose: SkierPose): void {
    const f = CONFIG.snowFx;
    if (!pose.grounded || pose.onRail || pose.bailed) {
      this.breakTrack(0);
      this.breakTrack(1);
      return;
    }
    if (this.tangent.lengthSq() < 0.25) return;
    // A ski sliding sideways smears a track as wide as it shows across the way it moves.
    const across = Math.sqrt(Math.max(0, 1 - this.skiFwd.dot(this.travel) ** 2));
    const smear = Math.min(f.smearMax, across * f.skiLength);
    const opacity = f.trackOpacity * (1 - (1 - f.smearOpacity) * Math.min(1, smear / 0.4));
    const half = Math.max(f.trackWidth, smear) / 2;
    // The track comes out from under the trailing end of the ski (the tail,
    // or the tip riding switch), so it never draws over the ski; skidding
    // sideways, the whole ski smears it, from the middle.
    const along = this.skiFwd.dot(this.travel);
    const back = f.skiLength * 0.4 * along;
    for (let t = 0; t < 2; t++) {
      this.at
        .copy(pose.position)
        .addScaledVector(this.skiLeft, (t === 0 ? 1 : -1) * STANCE_HALF_WIDTH)
        .addScaledVector(this.skiFwd, -back);
      // Snow only: none on a start deck's wood or a stair's steps.
      if (shapeSurfaceAt(this.hf, this.at.x, this.at.z) !== SURFACE.snow) {
        this.breakTrack(t);
        continue;
      }
      this.lay(t, this.at.x, this.at.z, half, opacity, pose.normal);
    }
  }

  /** Moves ski `t`'s track on to (x, z): the newest point follows the ski, and a new one is left every trackSpacing m. */
  private lay(t: number, x: number, z: number, half: number, opacity: number, n: Vector3): void {
    const M = this.points;
    if (this.head[t]! < 0) {
      const k = this.cursor[t]!;
      this.writePoint(t, k, x, z, half, opacity, n);
      this.link(t, (k + M - 1) % M, false);
      const h = (k + 1) % M;
      this.writePoint(t, h, x, z, half, opacity, n);
      this.link(t, k, true);
      this.link(t, h, false);
      this.head[t] = h;
      this.cursor[t] = h;
      this.lastX[t] = x;
      this.lastZ[t] = z;
      return;
    }
    const h = this.head[t]!;
    this.writePoint(t, h, x, z, half, opacity, n);
    const spacing = CONFIG.snowFx.trackSpacing;
    if ((x - this.lastX[t]!) ** 2 + (z - this.lastZ[t]!) ** 2 < spacing * spacing) return;
    this.lastX[t] = x;
    this.lastZ[t] = z;
    const next = (h + 1) % M;
    this.writePoint(t, next, x, z, half, opacity, n);
    this.link(t, h, true);
    this.link(t, next, false);
    this.head[t] = next;
    this.cursor[t] = next;
  }

  /** Ends ski `t`'s track where it is; the next one starts fresh. */
  private breakTrack(t: number): void {
    const h = this.head[t]!;
    if (h < 0) return;
    this.head[t] = -1;
    this.cursor[t] = (h + 1) % this.points;
  }

  /** Point k of track t: two vertices across the way the skier travels, on the drawn snow. */
  private writePoint(t: number, k: number, x: number, z: number, half: number, opacity: number, n: Vector3): void {
    const slot = t * this.points + k;
    const side = this.side.copy(this.travelLeft);
    const v = slot * 2;
    for (let e = 0; e < 2; e++) {
      const s = e === 0 ? half : -half;
      const vx = x + side.x * s;
      const vz = z + side.z * s;
      const o = (v + e) * 3;
      this.trackPos[o] = vx;
      this.trackPos[o + 1] = drawnHeightAt(this.hf, vx, vz) + TRACK_LIFT;
      this.trackPos[o + 2] = vz;
      this.trackNormal[o] = n.x;
      this.trackNormal[o + 1] = n.y;
      this.trackNormal[o + 2] = n.z;
    }
    this.birth[slot] = this.time;
    this.opacity[slot] = opacity;
    this.trackMoved = true;
  }

  /** Joins point q of track t to the next one (or doesn't: a break, or the newest point). */
  private link(t: number, q: number, on: boolean): void {
    const M = this.points;
    const a = (t * M + q) * 2;
    const b = (t * M + ((q + 1) % M)) * 2;
    const o = (t * M + q) * 6;
    const idx = this.trackIndex;
    if (on) {
      idx[o] = a;
      idx[o + 1] = a + 1;
      idx[o + 2] = b;
      idx[o + 3] = a + 1;
      idx[o + 4] = b + 1;
      idx[o + 5] = b;
    } else {
      idx.fill(a, o, o + 6);
    }
  }

  /** Fades every track point by its age, and the oldest of each ring as it's about to be reused. */
  private drawTracks(): void {
    const M = this.points;
    const life = this.budget.trackLife;
    const tail = Math.max(1, M * TAIL_SHARE);
    const col = this.trackColor;
    let any = false;
    for (let t = 0; t < 2; t++) {
      // The oldest point is the one after the newest written.
      const newest = this.head[t]! >= 0 ? this.head[t]! : (this.cursor[t]! + M - 1) % M;
      for (let k = 0; k < M; k++) {
        const slot = t * M + k;
        const rank = (k - newest - 1 + 2 * M) % M;
        const age = this.time - this.birth[slot]!;
        const a = age >= life ? 0 : this.opacity[slot]! * Math.min(1, (1 - age / life) * 3) * Math.min(1, rank / tail);
        if (a > 0) any = true;
        const c = TRACK_COLOR;
        for (let e = 0; e < 2; e++) {
          const o = (slot * 2 + e) * 4;
          col[o] = c.r;
          col[o + 1] = c.g;
          col[o + 2] = c.b;
          col[o + 3] = a;
        }
      }
    }
    const geo = this.trackMesh.geometry;
    geo.getAttribute('color').needsUpdate = true;
    if (this.trackMoved) {
      geo.getAttribute('position').needsUpdate = true;
      geo.getAttribute('normal').needsUpdate = true;
      geo.getIndex()!.needsUpdate = true;
      this.trackMoved = false;
    }
    this.trackMesh.visible = any;
  }
}

function instanced(geometry: BufferGeometry, material: MeshLambertMaterial | MeshBasicMaterial, count: number): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.count = 0;
  mesh.visible = false;
  return mesh;
}

/** Shows the first `n` instances of `mesh`, uploading only those. */
function commit(mesh: InstancedMesh, n: number): void {
  mesh.count = n;
  mesh.visible = n > 0;
  uploadFirst(mesh.instanceMatrix, n * 16);
}

/** A rotation's 3×3 matrix, column-major, at `o` in `out`. */
function writeRotation(out: Float32Array, o: number, q: Quaternion): void {
  const { x, y, z, w } = q;
  out[o] = 1 - 2 * (y * y + z * z);
  out[o + 1] = 2 * (x * y + z * w);
  out[o + 2] = 2 * (x * z - y * w);
  out[o + 3] = 2 * (x * y - z * w);
  out[o + 4] = 1 - 2 * (x * x + z * z);
  out[o + 5] = 2 * (y * z + x * w);
  out[o + 6] = 2 * (x * z + y * w);
  out[o + 7] = 2 * (y * z - x * w);
  out[o + 8] = 1 - 2 * (x * x + y * y);
}

/** A random direction. */
function randomUnit(out: Vector3): Vector3 {
  const y = Math.random() * 2 - 1;
  const r = Math.sqrt(1 - y * y);
  const a = Math.random() * Math.PI * 2;
  return out.set(Math.cos(a) * r, y, Math.sin(a) * r);
}

/** Whether the snow at (x, z) is powder: on a map with `powder`, off its named runs and groomed patches. */
export function inPowder(map: MapDef, x: number, z: number): boolean {
  if (!map.powder) return false;
  const groomed = map.powder.groomed;
  for (let i = 0; i < groomed.length; i++) if (inPatch(groomed[i]!, x, z)) return false;
  for (let r = 0; r < map.runs.length; r++) {
    const run = map.runs[r]!;
    const pts = run.points;
    const c2 = run.clear * run.clear;
    for (let i = 1; i < pts.length; i++) if (segmentDistance2(pts[i - 1]!, pts[i]!, x, z) <= c2) return false;
  }
  return true;
}

function inPatch(g: GroomedPatch, x: number, z: number): boolean {
  const h = (g.heading * Math.PI) / 180;
  const dx = x - g.x;
  const dz = z - g.z;
  // Along the heading (0 runs toward -Z), and across it.
  const along = -dx * Math.sin(h) - dz * Math.cos(h);
  const across = dx * Math.cos(h) - dz * Math.sin(h);
  return Math.abs(along) <= g.length / 2 && Math.abs(across) <= g.width / 2;
}

function segmentDistance2(a: XZ, b: XZ, x: number, z: number): number {
  const ux = b.x - a.x;
  const uz = b.z - a.z;
  const l2 = ux * ux + uz * uz;
  const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - a.x) * ux + (z - a.z) * uz) / l2)) : 0;
  return (a.x + ux * t - x) ** 2 + (a.z + uz * t - z) ** 2;
}

interface Emitter {
  x: number;
  z: number;
  /** The way its snow blows (0, 0: with the wind). */
  dx: number;
  dz: number;
  strength: number;
}

/**
 * Where snow blows off a mountain map (terrain `peak`): along every wind lip
 * and cornice (toward its lee), every ridge element's crest, and every sharp
 * spoke (a ridge between faces) out from the summit, an emitter every
 * CONFIG.snowFx.ridge.spacing m inside the play area.
 */
function ridgeEmitters(map: MapDef, hf: Heightfield): Emitter[] {
  const out: Emitter[] = [];
  const terrain = map.terrain;
  if (terrain.type !== 'peak') return out;
  const step = CONFIG.snowFx.ridge.spacing;
  const add = (x: number, z: number, dx: number, dz: number, strength: number): void => {
    if (insideBounds(hf.bounds, x, z)) out.push({ x, z, dx, dz, strength });
  };
  const along = (points: readonly XZ[], taper: number, dx: number, dz: number): void => {
    let total = 0;
    for (let i = 1; i < points.length; i++) total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.z - points[i - 1]!.z);
    // Walk the line, an emitter every step, fading in and out over the taper at each end.
    let seg = 1;
    let start = 0;
    for (let s = step / 2; s < total; s += step) {
      let a = points[seg - 1]!;
      let b = points[seg]!;
      let len = Math.hypot(b.x - a.x, b.z - a.z);
      while (s > start + len && seg < points.length - 1) {
        start += len;
        seg++;
        a = points[seg - 1]!;
        b = points[seg]!;
        len = Math.hypot(b.x - a.x, b.z - a.z);
      }
      const t = len > 0 ? (s - start) / len : 0;
      const strength = taper > 0 ? Math.min(1, s / taper, (total - s) / taper) : 1;
      if (strength > 0.1) add(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, dx, dz, strength);
    }
  };
  for (const e of terrain.elements) {
    if (e.type === 'lip') {
      const h = (e.heading * Math.PI) / 180;
      along(e.points, e.taper, -Math.sin(h), -Math.cos(h));
    } else if (e.type === 'ridge') {
      along(e.points, e.taper, 0, 0);
    }
  }
  const DEG = Math.PI / 180;
  for (const s of terrain.spokes) {
    if (s.sharp <= 0) continue;
    for (let r = 40; ; r += step) {
      const a = (s.heading + (s.bend / 1000) * r) * DEG;
      const x = -Math.sin(a) * r;
      const z = -Math.cos(a) * r;
      if (!insideBounds(hf.bounds, x, z)) break;
      // Knife-edged near the summit, rounding off by sharpTo: less snow blows off lower down.
      add(x, z, 0, 0, Math.max(0.25, 1 - r / s.sharpTo));
    }
  }
  return out;
}
