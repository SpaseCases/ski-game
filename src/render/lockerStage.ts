import {
  BackSide,
  BufferAttribute,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
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
import type { Outfit } from '../core/outfit.ts';
import { insideObstacle, type Obstacles } from '../sim/obstacles.ts';
import { heightAt } from '../sim/terrain.ts';
import type { Heightfield } from '../maps/types.ts';
import { renderFrame, type View } from './scene.ts';
import { STANCE } from './skierPoses.ts';
import { SkierRig } from './skierRig.ts';

/** Steps (m) along the camera's sight line when checking it for walls. */
const SIGHT_STEP = 0.2;
/** Angles round the skier tried when looking for an open arc, and the fewest clear in a row that make one. */
const ARC_SAMPLES = 72;
const ARC_MIN = 5;
const sight = new Vector3();

// The Locker's live preview. It draws into one rectangle of the game's own
// canvas (a scissored viewport on the one WebGLRenderer, never a second
// context): from the title, a small stage of its own (the skier on a snow
// plinth against a winter sky, turning slowly); from pause, the paused world
// itself, with the camera circling the real skier. On the Skis tab the
// camera looks down at the skis instead of the whole skier.


export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class LockerStage {
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(30, 1, 0.1, 40);
  private rig: SkierRig | null = null;
  private outfit: Outfit;
  private angle = 0.6;
  /** Real seconds turned times the turn rate, never wrapped: drives the swing across an open arc. */
  private swing = 0;
  private skis = false;
  private readonly aim = new Vector3();
  /**
   * From pause, with walls round the skier (a start house): the widest arc
   * of angles with nothing solid between camera and skier, which the camera
   * swings across instead of circling through the walls; null when it can
   * go all the way round. Worked out again when the aim, the framing or the
   * Skis tab changes.
   */
  private arc: { mid: number; half: number } | null = null;
  private readonly arcAim = new Vector3(Infinity, 0, 0);
  private arcKey = '';

  constructor(outfit: Outfit) {
    this.outfit = outfit;
    this.scene.matrixAutoUpdate = false;
  }

  setOutfit(outfit: Outfit): void {
    this.outfit = outfit;
    this.rig?.setOutfit(outfit);
  }

  /** Frames the skis (true) or the whole skier. */
  showSkis(on: boolean): void {
    this.skis = on;
  }

  /** Turns the preview on by `frameTime` seconds (real time; it turns even while the game is paused). */
  turn(frameTime: number): void {
    this.angle = (this.angle + frameTime * CONFIG.locker.turnRate) % (Math.PI * 2);
    this.swing += frameTime * CONFIG.locker.turnRate;
  }

  /** The stage on its own (no map loaded): built the first time it's needed. */
  renderStage(renderer: WebGLRenderer, rect: Rect): void {
    if (!this.rig) this.build();
    this.rig!.root.rotation.y = -this.angle;
    this.rig!.root.updateMatrix();
    this.rig!.root.updateMatrixWorld(true);
    this.aim.set(0, this.skis ? CONFIG.locker.skiAim : 0.85, 0);
    // A turntable: the skier turns under a still camera and sun.
    this.place(rect, CONFIG.locker.stageAngle);
    beginScissor(renderer, rect);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    endScissor(renderer);
  }

  /**
   * The paused world, looking at the skier from a slowly circling camera.
   * `center` is the middle of the skier's body; the camera stays above the
   * snow. Where walls (`obstacles`) stand round the skier it swings across
   * the widest open arc instead, and pulls in if something is still in the way.
   */
  renderWorld(view: View, rect: Rect, center: Vector3, hf: Heightfield, obstacles: Obstacles): void {
    this.aim.copy(center);
    this.aim.y += this.skis ? CONFIG.locker.skiAim - CONFIG.air.comHeight : 0.1;
    const key = `${rect.width}x${rect.height}${this.skis}`;
    if (key !== this.arcKey || this.aim.distanceToSquared(this.arcAim) > 0.25) {
      this.arcKey = key;
      this.arcAim.copy(this.aim);
      this.arc = this.openArc(rect, obstacles);
    }
    // Across the open arc and back, as fast at its middle as the circling; else all the way round.
    const arc = this.arc;
    this.place(rect, arc ? arc.mid + arc.half * Math.sin(this.swing / arc.half) : this.angle);
    this.clearSight(obstacles);
    const c = this.camera;
    const ground = heightAt(hf, c.position.x, c.position.z) + 0.5;
    if (c.position.y < ground) {
      c.position.y = ground;
      c.lookAt(this.aim);
    }
    c.far = view.camera.far;
    c.updateProjectionMatrix();
    c.updateMatrixWorld();
    // The world's own frame, through this camera, into the rectangle.
    beginScissor(view.renderer, rect);
    renderFrame(view, c);
    endScissor(view.renderer);
  }

  /**
   * The widest arc of camera angles (placed for `rect`) with nothing solid
   * between the camera and the aim, or null when every angle is clear (or
   * no arc is wide enough to swing across).
   */
  private openArc(rect: Rect, o: Obstacles): { mid: number; half: number } | null {
    const step = (Math.PI * 2) / ARC_SAMPLES;
    const clear: boolean[] = [];
    for (let i = 0; i < ARC_SAMPLES; i++) {
      this.place(rect, i * step);
      clear.push(this.blockedAt(o) < 0);
    }
    if (clear.every((c) => c)) return null;
    // The longest run of clear angles, going round past the last into the first.
    let best = 0;
    let bestEnd = 0;
    let run = 0;
    for (let i = 0; i < ARC_SAMPLES * 2; i++) {
      run = clear[i % ARC_SAMPLES] ? run + 1 : 0;
      if (run > best && run <= ARC_SAMPLES) {
        best = run;
        bestEnd = i;
      }
    }
    if (best < ARC_MIN) return null;
    // Kept a step in from the blocked angles at each end.
    return { mid: (bestEnd - (best - 1) / 2) * step, half: ((best - 1) / 2 - 1) * step };
  }

  /** How far (m) from the aim the camera's sight line first meets something solid, or -1 if it's clear. */
  private blockedAt(o: Obstacles): number {
    const { sightMargin, sightMin } = CONFIG.locker;
    sight.subVectors(this.camera.position, this.aim);
    const d = sight.length();
    if (d <= sightMin) return -1;
    sight.divideScalar(d);
    for (let s = sightMin; s < d + SIGHT_STEP; s += SIGHT_STEP) {
      const t = Math.min(s, d);
      if (insideObstacle(o, this.aim.x + sight.x * t, this.aim.y + sight.y * t, this.aim.z + sight.z * t, sightMargin)) return t;
    }
    return -1;
  }

  /** Pulls the camera in toward the aim to just short of the first obstacle between them, if any (the last resort when there's no open arc). */
  private clearSight(o: Obstacles): void {
    const t = this.blockedAt(o);
    if (t < 0) return;
    const c = this.camera;
    c.position.copy(this.aim).addScaledVector(sight, Math.max(CONFIG.locker.sightMin, t - SIGHT_STEP));
    c.lookAt(this.aim);
    c.updateMatrixWorld();
  }

  /** The camera at `angle` on its circle round the aim, fitted to the rectangle. */
  private place(rect: Rect, angle: number): void {
    const c = this.camera;
    c.aspect = rect.width / Math.max(1, rect.height);
    // Far enough back for the whole skier, and the skis when turned side on.
    const t = Math.tan((c.fov * Math.PI) / 360);
    const { halfHeight, halfWidth, rise, skiHalfLength, skiPitch } = CONFIG.locker;
    if (this.skis) {
      // Looking down at the skis from all round, the whole length in view.
      const d = skiHalfLength / (t * Math.min(1, c.aspect));
      const flat = Math.cos(skiPitch) * d;
      c.position.set(this.aim.x + Math.sin(angle) * flat, this.aim.y + Math.sin(skiPitch) * d, this.aim.z - Math.cos(angle) * flat);
    } else {
      const d = Math.max(halfHeight / t, halfWidth / (t * c.aspect));
      c.position.set(this.aim.x + Math.sin(angle) * d, this.aim.y + rise, this.aim.z - Math.cos(angle) * d);
    }
    c.lookAt(this.aim);
    c.near = 0.1;
    c.updateProjectionMatrix();
    c.updateMatrixWorld();
  }

  private build(): void {
    const rig = new SkierRig(this.outfit);
    rig.apply(STANCE);
    this.rig = rig;
    this.scene.add(rig.root);

    // Sky: a gradient on the inside of a sphere, pale near the snow, deeper blue overhead.
    const sky = new SphereGeometry(20, 16, 10);
    const pos = sky.getAttribute('position');
    const rgb = new Float32Array(pos.count * 3);
    const low = new Color('#e6eef6');
    const high = new Color('#7fa9d6');
    const c = new Color();
    for (let i = 0; i < pos.count; i++) {
      c.copy(low).lerp(high, Math.min(1, Math.max(0, pos.getY(i) / 20 + 0.1)) ** 0.8);
      rgb.set([c.r, c.g, c.b], i * 3);
    }
    sky.setAttribute('color', new BufferAttribute(rgb, 3));
    this.scene.add(new Mesh(sky, new MeshBasicMaterial({ vertexColors: true, side: BackSide, depthWrite: false })));

    // A low, faceted snow plinth with a soft shadow under the skis.
    const plinth = new Mesh(
      new CylinderGeometry(1.25, 1.4, 0.24, 9).translate(0, -0.12, 0),
      new MeshLambertMaterial({ color: '#f1f5fa', flatShading: true }),
    );
    this.scene.add(plinth);
    const disc = new CircleGeometry(0.75, 16).rotateX(-Math.PI / 2);
    const count = disc.getAttribute('position').count;
    const rgba = new Float32Array(count * 4).fill(1);
    for (let i = 1; i < count; i++) rgba[i * 4 + 3] = 0;
    disc.setAttribute('color', new BufferAttribute(rgba, 4));
    const shadow = new Mesh(disc, new MeshBasicMaterial({ color: 0x0b1a2a, vertexColors: true, transparent: true, opacity: 0.4, depthWrite: false }));
    shadow.position.y = 0.004;
    this.scene.add(shadow);

    this.scene.add(new HemisphereLight('#9fc3e6', '#7d8796', CONFIG.light.hemiIntensity));
    const sun = new DirectionalLight('#fff6e8', CONFIG.light.sunIntensity);
    const from = CONFIG.light.sunFrom;
    sun.position.set(from.x, from.y, from.z).normalize();
    this.scene.add(sun);
    for (const o of this.scene.children) {
      o.updateMatrix();
      o.updateMatrixWorld(true);
    }
  }
}

/** Points the renderer's viewport and scissor at `rect` (CSS pixels from the top left). */
function beginScissor(renderer: WebGLRenderer, rect: Rect): void {
  const y = renderer.domElement.clientHeight - rect.y - rect.height;
  renderer.setViewport(rect.x, y, rect.width, rect.height);
  renderer.setScissor(rect.x, y, rect.width, rect.height);
  renderer.setScissorTest(true);
}

/** Back to drawing the whole canvas. */
function endScissor(renderer: WebGLRenderer): void {
  const canvas = renderer.domElement;
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, canvas.clientWidth, canvas.clientHeight);
}
