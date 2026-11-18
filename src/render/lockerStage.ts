import {
  BackSide,
  BufferAttribute,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
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
import type { Garment, Outfit } from '../core/outfit.ts';
import { insideObstacle, type Obstacles } from '../sim/obstacles.ts';
import { heightAt } from '../sim/terrain.ts';
import type { Heightfield } from '../maps/types.ts';
import { BOARD_STANCE } from './boardPoses.ts';
import { createPoseBuffer, setPose } from './poseBlend.ts';
import { renderFrame, type View } from './scene.ts';
import { STANCE } from './skierPoses.ts';
import { SkierRig } from './skierRig.ts';

/** Highest the view tilts (rad): short of straight down, where lookAt loses its way. */
const MAX_PITCH = 1.45;

/** An angle brought within -π..π. */
function wrapAngle(a: number): number {
  return a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
}

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
// itself, with the camera circling the real skier. On the Ride tab the
// camera looks down at the skis (or the board) instead of the whole skier.
// On a snowboard (milestone 22 part 2) the stage's rig rides it too: the
// board stance, turned across the board and mirrored for goofy as
// SkierView does. By hand (milestone 23, the user's ask): a drag on the
// window turns the view round the skier and tilts it, the wheel zooms, and
// CONFIG.locker.handResume s after letting go it turns by itself again from
// where it was left (ui/lockerMenu.ts previewCanvas sends the pointer here).


export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A screen with a window for the preview (the Locker, the ski editor):
 * where the window is (viewport CSS pixels, read every frame) and the 2D
 * canvas inside it that the preview is copied into (present).
 */
export interface StageWindow {
  viewRect(): Rect;
  viewContext(): CanvasRenderingContext2D | null;
}

export class LockerStage {
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(30, 1, 0.1, 40);
  private rig: SkierRig | null = null;
  /** The turntable (turned by the angle), and inside it the stance (across the board, as SkierView's). */
  private readonly turntable = new Group();
  private readonly stance = new Group();
  private outfit: Outfit;
  private board = false;
  private goofy = false;
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
  /** What the arc was worked out for: the window's size, the framing and the hand's tilt and zoom. */
  private arcWidth = 0;
  private arcHeight = 0;
  private arcSkis = false;
  private arcTilt = 0;
  private arcZoom = 1;
  /** The angle the view was last drawn at (a drag starts from it), and whether it was the paused world (the camera circling) or the stage (the skier turning). */
  private shown = 0;
  private world = false;
  /** By hand: held now, seconds since it was last moved (Infinity: not since it opened), the tilt (rad) and zoom (a share of the framed distance). */
  private holding = false;
  private handIdle = Infinity;
  private tilt = 0;
  private zoom = 1;
  /** Back from the hand onto the swing across an open arc: the angle left by hand and how much of it still shows (1 to 0). */
  private backFrom = 0;
  private back = 0;

  constructor(outfit: Outfit) {
    this.outfit = outfit;
    this.scene.matrixAutoUpdate = false;
  }

  setOutfit(outfit: Outfit): void {
    this.outfit = outfit;
    this.rig?.setOutfit(outfit);
  }

  /** Skis, or a snowboard ridden regular or goofy (the stage's own rig; the paused world draws the game's). */
  setRide(board: boolean, goofy: boolean): void {
    this.board = board;
    this.goofy = board && goofy;
    if (this.rig) this.poseRig();
  }

  /** The rig's feet, board and standing pose for the ride, and the stance group across the board. */
  private poseRig(): void {
    const rig = this.rig!;
    rig.setBoard(this.board);
    if (this.board) {
      const pose = createPoseBuffer();
      setPose(pose, BOARD_STANCE);
      rig.apply(pose);
    } else rig.apply(STANCE);
    this.stance.rotation.y = this.board ? (this.goofy ? Math.PI / 2 : -Math.PI / 2) : 0;
    this.stance.scale.x = this.goofy ? -1 : 1;
  }

  /** Rebuilds the skis or the board (a custom graphic was painted). */
  repaintSkis(): void {
    this.rig?.repaintSkis();
  }

  /** Rebuilds a painted jacket or pants (its squares changed in the editor). */
  repaintWear(garment: Garment): void {
    this.rig?.repaintWear(garment);
  }

  /** Frames the skis (true) or the whole skier (a change forgets the hand's tilt and zoom). */
  showSkis(on: boolean): void {
    if (on !== this.skis) this.resetHand();
    this.skis = on;
  }

  /** Back to turning by itself, untilted and unzoomed (a preview window opening). */
  resetHand(): void {
    this.holding = false;
    this.handIdle = Infinity;
    this.tilt = 0;
    this.zoom = 1;
    this.back = 0;
  }

  /** The pointer went down on the window: it stops turning, from the angle it shows. */
  handGrab(): void {
    if (!this.holding && this.handIdle >= CONFIG.locker.handResume) this.angle = this.shown;
    this.holding = true;
    this.handIdle = 0;
    this.back = 0;
  }

  /**
   * A drag of (dx, dy) CSS pixels: turns the view round the skier, as if the
   * skier were grabbed (dragging right brings its near side right: the stage
   * turns the skier one way, the paused world circles the camera the other),
   * and tilts it (dragging down looks from higher up).
   */
  handDrag(dx: number, dy: number): void {
    const { dragTurn, dragTilt, tiltMin, tiltMax } = CONFIG.locker;
    this.angle = (this.angle + (this.world ? dx : -dx) * dragTurn) % (Math.PI * 2);
    this.tilt = Math.min(tiltMax, Math.max(tiltMin, this.tilt + dy * dragTilt));
    this.handIdle = 0;
  }

  handRelease(): void {
    this.holding = false;
  }

  /** The wheel over the window: zooms in (up) or out, and stops it turning for a while as a drag does. */
  handZoom(deltaY: number): void {
    const { zoomPerPixel, zoomMin, zoomMax, handResume } = CONFIG.locker;
    if (!this.holding && this.handIdle >= handResume) this.angle = this.shown;
    this.zoom = Math.min(zoomMax, Math.max(zoomMin, this.zoom * Math.exp(deltaY * zoomPerPixel)));
    this.handIdle = 0;
    this.back = 0;
  }

  /**
   * Turns the preview on by `frameTime` seconds (real time; it turns even
   * while the game is paused): not while held, nor for handResume s after
   * the hand let go, then easing up to speed over handEase s.
   */
  turn(frameTime: number): void {
    const { turnRate, handResume, handEase } = CONFIG.locker;
    if (this.holding) {
      this.handIdle = 0;
      return;
    }
    const was = this.handIdle;
    this.handIdle += frameTime;
    if (this.handIdle < handResume) return;
    if (was < handResume) this.resumeSwing();
    const speed = turnRate * Math.min(1, (this.handIdle - handResume) / handEase);
    this.angle = (this.angle + frameTime * speed) % (Math.PI * 2);
    this.swing += frameTime * speed;
    if (this.back > 0) this.back = Math.max(0, this.back - frameTime / handEase);
  }

  /**
   * From pause between walls, turning again after the hand: the swing
   * across the open arc picks up where the hand left the view; from outside
   * the arc it eases over from there.
   */
  private resumeSwing(): void {
    const arc = this.arc;
    if (!arc) return;
    const x = wrapAngle(this.angle - arc.mid) / arc.half;
    this.swing = arc.half * Math.asin(Math.min(1, Math.max(-1, x)));
    if (Math.abs(x) > 1) {
      this.backFrom = this.angle;
      this.back = 1;
    }
  }

  /** The stage on its own (no map loaded): built the first time it's needed. */
  renderStage(renderer: WebGLRenderer, rect: Rect): void {
    if (!this.rig) this.build();
    this.turntable.rotation.y = -this.angle;
    this.stance.updateMatrix();
    this.turntable.updateMatrix();
    this.turntable.updateMatrixWorld(true);
    this.aim.set(0, this.skis ? CONFIG.locker.skiAim : 0.85, 0);
    this.shown = this.angle;
    this.world = false;
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
    const changed = rect.width !== this.arcWidth || rect.height !== this.arcHeight || this.skis !== this.arcSkis || this.tilt !== this.arcTilt || this.zoom !== this.arcZoom;
    if (changed || this.aim.distanceToSquared(this.arcAim) > 0.25) {
      this.arcWidth = rect.width;
      this.arcHeight = rect.height;
      this.arcSkis = this.skis;
      this.arcTilt = this.tilt;
      this.arcZoom = this.zoom;
      this.arcAim.copy(this.aim);
      this.arc = this.openArc(rect, obstacles);
    }
    // Across the open arc and back, as fast at its middle as the circling; else all the way round; where the hand put it while it's moved by hand.
    const arc = this.arc;
    const byHand = this.holding || this.handIdle < CONFIG.locker.handResume;
    let angle = byHand || !arc ? this.angle : arc.mid + arc.half * Math.sin(this.swing / arc.half);
    if (!byHand && this.back > 0) angle += wrapAngle(this.backFrom - angle) * this.back;
    this.shown = angle;
    this.world = true;
    this.place(rect, angle);
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
    // Far enough back for the whole skier, and the skis when turned side on; then tilted and zoomed by hand.
    const t = Math.tan((c.fov * Math.PI) / 360);
    const { halfHeight, halfWidth, rise, skiHalfLength, skiPitch } = CONFIG.locker;
    let d: number;
    let pitch: number;
    if (this.skis) {
      // Looking down at the skis from all round, the whole length in view.
      d = skiHalfLength / (t * Math.min(1, c.aspect));
      pitch = skiPitch;
    } else {
      const flat = Math.max(halfHeight / t, halfWidth / (t * c.aspect));
      d = Math.hypot(flat, rise);
      pitch = Math.atan2(rise, flat);
    }
    d *= this.zoom;
    pitch = Math.min(MAX_PITCH, pitch + this.tilt);
    const flat = Math.cos(pitch) * d;
    c.position.set(this.aim.x + Math.sin(angle) * flat, this.aim.y + Math.sin(pitch) * d, this.aim.z - Math.cos(angle) * flat);
    c.lookAt(this.aim);
    c.near = 0.1;
    c.updateProjectionMatrix();
    c.updateMatrixWorld();
  }

  private build(): void {
    const rig = new SkierRig(this.outfit);
    this.rig = rig;
    this.poseRig();
    this.stance.add(rig.root);
    this.turntable.add(this.stance);
    this.scene.add(this.turntable);

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

/**
 * Copies the preview just drawn at the canvas's top left (`rect` at 0, 0, as
 * renderStage or renderWorld drew it) into the window's own 2D canvas. It
 * must run in the same task as the drawing (the WebGL canvas keeps no copy
 * of its picture after that). The preview then sits in the page like any
 * element, so it scrolls with its frame exactly; drawn behind the menu
 * through a hole, it trailed the frame while the page scrolled (milestone 23).
 */
export function present(renderer: WebGLRenderer, rect: Rect, ctx: CanvasRenderingContext2D): void {
  const pr = renderer.getPixelRatio();
  const w = Math.floor(rect.width * pr);
  const h = Math.floor(rect.height * pr);
  const canvas = ctx.canvas;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.drawImage(renderer.domElement, 0, 0, w, h, 0, 0, w, h);
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
