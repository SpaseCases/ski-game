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
import { heightAt } from '../sim/terrain.ts';
import type { Heightfield } from '../maps/types.ts';
import { renderFrame, type View } from './scene.ts';
import { STANCE } from './skierPoses.ts';
import { SkierRig } from './skierRig.ts';

// The Locker's live preview. It draws into one rectangle of the game's own
// canvas (a scissored viewport on the one WebGLRenderer, never a second
// context): from the title, a small stage of its own (the skier on a snow
// plinth against a winter sky, turning slowly); from pause, the paused world
// itself, with the camera circling the real skier.


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
  private readonly aim = new Vector3();

  constructor(outfit: Outfit) {
    this.outfit = outfit;
    this.scene.matrixAutoUpdate = false;
  }

  setOutfit(outfit: Outfit): void {
    this.outfit = outfit;
    this.rig?.setOutfit(outfit);
  }

  /** Turns the preview on by `frameTime` seconds (real time; it turns even while the game is paused). */
  turn(frameTime: number): void {
    this.angle = (this.angle + frameTime * CONFIG.locker.turnRate) % (Math.PI * 2);
  }

  /** The stage on its own (no map loaded): built the first time it's needed. */
  renderStage(renderer: WebGLRenderer, rect: Rect): void {
    if (!this.rig) this.build();
    this.rig!.root.rotation.y = -this.angle;
    this.rig!.root.updateMatrix();
    this.rig!.root.updateMatrixWorld(true);
    this.aim.set(0, 0.85, 0);
    // A turntable: the skier turns under a still camera and sun.
    this.place(rect, CONFIG.locker.stageAngle);
    beginScissor(renderer, rect);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    endScissor(renderer);
  }

  /**
   * The paused world, looking at the skier from a slowly circling camera.
   * `center` is the middle of the skier's body; the camera stays above the snow.
   */
  renderWorld(view: View, rect: Rect, center: Vector3, hf: Heightfield): void {
    this.aim.copy(center);
    this.aim.y += 0.1;
    this.place(rect, this.angle);
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

  /** The camera at `angle` on its circle round the aim, fitted to the rectangle. */
  private place(rect: Rect, angle: number): void {
    const c = this.camera;
    c.aspect = rect.width / Math.max(1, rect.height);
    // Far enough back for the whole skier, and the skis when turned side on.
    const t = Math.tan((c.fov * Math.PI) / 360);
    const { halfHeight, halfWidth, rise } = CONFIG.locker;
    const d = Math.max(halfHeight / t, halfWidth / (t * c.aspect));
    c.position.set(this.aim.x + Math.sin(angle) * d, this.aim.y + rise, this.aim.z - Math.cos(angle) * d);
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
