import {
  BoxGeometry, Color, IcosahedronGeometry, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, PlaneGeometry, Quaternion, Scene, SRGBColorSpace,
  Texture, Vector3, type BufferGeometry, type Camera,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config.ts';
import type { Outfit } from '../core/outfit.ts';
import type { Heightfield } from '../maps/types.ts';
import { ROOM_MAX } from '../online/mpRules.ts';
import { createSkierPose, SkierView, type SkierPose } from '../render/skierView.ts';
import { RemoteTimeline, setClock } from './remote.ts';
import type { WornLook } from './looks.ts';

// Drawing the other riders (milestone 27). Each frame every rider's pose is
// read off their timeline; the nearest few (CONFIG.mp.draw by detail level)
// within `near` m are full riders in their own looks (a SkierView each, made
// the first time they're drawn and kept), the rest one batch of simple
// stand-ins (one InstancedMesh, the jacket's color). Name tags float over
// the nearest. Nothing here allocates per frame.

export type Detail = 'low' | 'medium' | 'high';

/** Another rider in the lobby. */
export class Remote {
  readonly id: number;
  name: string;
  outfitJson: string;
  /** The look their rig wears now (painted parts once fetched). */
  look: Outfit;
  worn: WornLook | null = null;
  /** A number unique this visit, for their look's ids. */
  readonly n: number;
  readonly timeline = new RemoteTimeline();
  readonly pose: SkierPose = createSkierPose();
  hasPose = false;
  view: SkierView | null = null;
  /** The look the view was built in (rebuilt when it changes). */
  viewLook: Outfit | null = null;
  /** When anything was last heard from them (s, local). */
  heard: number;
  best = 0;
  trick = '';
  muted = false;
  away = false;
  /** Silent past CONFIG.mp.remove: not drawn or listed, but kept until the lobby says they left, so they come back the moment they're heard again. */
  gone = false;
  /** Drawn in full this frame, and the distance² from the camera (scratch for choosing). */
  full = false;
  d2 = 0;
  tag: NameTag | null = null;
  readonly color = new Color();

  constructor(id: number, name: string, outfitJson: string, look: Outfit, n: number, now: number) {
    this.id = id;
    this.name = name;
    this.outfitJson = outfitJson;
    this.look = look;
    this.n = n;
    this.heard = now;
    this.color.set(look.jacket);
  }
}

/** One plane for every name tag (4 wide, 1 high), facing +z. */
const TAG_PLANE = new PlaneGeometry(4, 1);

/**
 * A name over a rider: a plane turned to face the camera, drawn from a small
 * canvas redrawn only when the name or away changes. (A plane and a plain
 * Texture, not a Sprite: those classes the game already ships, so the
 * shared chunk doesn't grow.)
 */
class NameTag {
  readonly sprite: Mesh;
  private readonly canvas = document.createElement('canvas');
  private readonly texture: Texture;
  private readonly material: MeshBasicMaterial;
  private text = '';
  private away = false;

  constructor(scene: Scene) {
    this.canvas.width = 256;
    this.canvas.height = 64;
    this.texture = new Texture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.material = new MeshBasicMaterial({ map: this.texture, depthWrite: false, transparent: true, fog: false });
    this.sprite = new Mesh(TAG_PLANE, this.material);
    this.sprite.renderOrder = 10;
    this.sprite.visible = false;
    scene.add(this.sprite);
  }

  set(text: string, away: boolean): void {
    if (text === this.text && away === this.away) return;
    this.text = text;
    this.away = away;
    const c = this.canvas.getContext('2d');
    if (!c) return;
    c.clearRect(0, 0, 256, 64);
    c.font = '600 30px system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const label = away ? `${text} (away)` : text;
    const w = Math.min(248, c.measureText(label).width + 24);
    c.fillStyle = away ? 'rgba(20, 28, 38, 0.45)' : 'rgba(20, 28, 38, 0.7)';
    c.beginPath();
    c.roundRect(128 - w / 2, 10, w, 44, 12);
    c.fill();
    c.fillStyle = away ? 'rgba(255, 255, 255, 0.6)' : '#ffffff';
    c.fillText(label, 128, 33, 236);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.sprite.removeFromParent();
    this.texture.dispose();
    this.material.dispose();
  }
}

const m4 = new Matrix4();
const q = new Quaternion();
const one = new Vector3(1, 1, 1);
const zero = new Vector3(0, 0, 0);
const UP = new Vector3(0, 1, 0);

/** The stand-in: a body and a head, about a rider's size, colored per rider. */
function standInGeometry(): BufferGeometry {
  const body = new BoxGeometry(0.5, 1.15, 0.32).translate(0, 0.62, 0);
  const head = new IcosahedronGeometry(0.17, 0).translate(0, 1.38, 0);
  const skis = new BoxGeometry(0.34, 0.05, 1.6).translate(0, 0.03, 0);
  // mergeGeometries needs them all alike: non-indexed (the icosahedron already is).
  const flat = (g: BufferGeometry): BufferGeometry => (g.index ? g.toNonIndexed() : g);
  const merged = mergeGeometries([flat(body), flat(head), flat(skis)]);
  body.dispose();
  head.dispose();
  skis.dispose();
  return merged;
}

export class RiderScene {
  private readonly scene: Scene;
  private readonly standIns: InstancedMesh;

  constructor(scene: Scene) {
    this.scene = scene;
    this.standIns = new InstancedMesh(standInGeometry(), new MeshLambertMaterial({ flatShading: true }), ROOM_MAX);
    this.standIns.frustumCulled = false;
    for (let i = 0; i < ROOM_MAX; i++) {
      this.standIns.setMatrixAt(i, m4.compose(zero, q.identity(), zero));
      this.standIns.setColorAt(i, new Color(0xffffff));
    }
    scene.add(this.standIns);
  }

  /**
   * Draws `riders` (`count` of them) as seen from `camera` at `now` (s)
   * after `dt` s, on the snow of `hf`. `detail` picks the caps.
   */
  frame(riders: readonly Remote[], camera: Camera, hf: Heightfield | null, detail: Detail, now: number, dt: number): void {
    const M = CONFIG.mp;
    const caps = M.draw[detail];
    const cam = camera.position;
    const fov = (camera as Camera & { fov?: number }).fov ?? 60;
    const fovTan = Math.tan((fov * Math.PI) / 360);
    setClock(now, dt);
    for (const r of riders) {
      r.hasPose = !r.gone && r.timeline.pose(r.pose);
      r.away = now - r.heard > M.away;
      const p = r.pose.position;
      r.d2 = r.hasPose ? (p.x - cam.x) ** 2 + (p.y - cam.y) ** 2 + (p.z - cam.z) ** 2 : Infinity;
    }
    // The nearest `full` within `near` m are drawn in full; one already drawn keeps it out to 15% further, so the edge doesn't flicker.
    for (const r of riders) {
      const keep = r.full ? 1.15 * 1.15 : 1;
      r.full = r.hasPose && hf !== null && r.d2 < caps.near * caps.near * keep;
    }
    let drawnFull = 0;
    for (const r of riders) if (r.full) drawnFull++;
    while (drawnFull > caps.full) {
      // Too many: the farthest goes to a stand-in.
      let far: Remote | null = null;
      for (const r of riders) if (r.full && (!far || r.d2 > far.d2)) far = r;
      if (!far) break;
      far.full = false;
      drawnFull--;
    }
    // Tags on the nearest `tags`: the farthest past the cap get none.
    let tagged = 0;
    for (const r of riders) if (r.hasPose) tagged++;
    for (const r of riders) if (r.tag) r.tag.sprite.visible = r.hasPose;
    while (tagged > caps.tags) {
      let far: Remote | null = null;
      for (const r of riders) if (r.tag?.sprite.visible && (!far || r.d2 > far.d2)) far = r;
      if (!far?.tag) break;
      far.tag.sprite.visible = false;
      tagged--;
    }

    let slot = 0;
    for (const r of riders) {
      if (r.full && hf) {
        if (!r.view || r.viewLook !== r.look) this.buildView(r, hf);
        const view = r.view!;
        view.hf = hf;
        view.setVisible(true);
        view.setFade(r.away ? M.awayFade : 1);
        if (r.timeline.jumped) {
          view.snap(r.pose);
          r.timeline.jumped = false;
        }
        view.update(r.pose, dt);
      } else {
        r.view?.setVisible(false);
        if (r.hasPose) {
          q.setFromAxisAngle(UP, r.pose.yaw);
          this.standIns.setMatrixAt(slot, m4.compose(r.pose.position, q, one));
          this.standIns.setColorAt(slot, r.color);
          slot++;
        }
      }
      if (r.hasPose) {
        if (!r.tag) r.tag = new NameTag(this.scene);
        r.tag.set(r.name, r.away);
        // Facing the camera, sized to a steady share of the view's height whatever the distance.
        const s = r.tag.sprite;
        s.position.copy(r.pose.position);
        s.position.y += M.tagHeight;
        s.quaternion.copy(camera.quaternion);
        s.scale.setScalar(Math.max(1, Math.sqrt(r.d2)) * M.tagSize * 2 * fovTan);
      }
    }
    for (let i = slot; i < ROOM_MAX; i++) this.standIns.setMatrixAt(i, m4.compose(zero, q.identity(), zero));
    this.standIns.count = slot;
    this.standIns.instanceMatrix.needsUpdate = true;
    if (this.standIns.instanceColor) this.standIns.instanceColor.needsUpdate = true;
  }

  /** Builds (or rebuilds, in a new look) a rider's full view. */
  private buildView(r: Remote, hf: Heightfield): void {
    r.view?.dispose();
    const view = new SkierView(this.scene, hf, r.look);
    view.setRide(r.look.ride === 'board', r.look.stance === 'goofy');
    r.view = view;
    r.viewLook = r.look;
    r.timeline.jumped = true;
  }

  /** A rider left: frees their view and tag. */
  remove(r: Remote): void {
    r.view?.dispose();
    r.view = null;
    r.tag?.dispose();
    r.tag = null;
  }

  /** Hides everyone (not in a lobby, or no map). */
  hide(riders: readonly Remote[]): void {
    for (const r of riders) {
      r.view?.setVisible(false);
      if (r.tag) r.tag.sprite.visible = false;
    }
    this.standIns.count = 0;
  }

  dispose(riders: readonly Remote[]): void {
    for (const r of riders) this.remove(r);
    this.standIns.removeFromParent();
    this.standIns.geometry.dispose();
    (this.standIns.material as MeshLambertMaterial).dispose();
  }
}

/**
 * The nearest rider a shot from `from` along `dir` (unit) passes through
 * within `range` m: their body as an upright capsule (CONFIG.mp.hitRadius
 * wide, hitHeight tall). Returns the rider, with the distance in `hitAt.d`.
 */
export const hitAt = { d: 0 };
export function shootRiders(riders: readonly Remote[], from: Vector3, dir: Vector3, range: number): Remote | null {
  const M = CONFIG.mp;
  let best: Remote | null = null;
  let bestT = range;
  for (const r of riders) {
    if (!r.hasPose || r.pose.bailed) continue;
    const p = r.pose.position;
    // Closest approach of the ray to the body's upright axis, in the flat (x, z), then checked against the height.
    const ox = from.x - p.x;
    const oz = from.z - p.z;
    const a = dir.x * dir.x + dir.z * dir.z;
    if (a < 1e-9) continue;
    const t = -(ox * dir.x + oz * dir.z) / a;
    if (t < 0 || t > bestT) continue;
    const cx = ox + dir.x * t;
    const cz = oz + dir.z * t;
    if (cx * cx + cz * cz > M.hitRadius * M.hitRadius) continue;
    const y = from.y + dir.y * t - p.y;
    if (y < -0.2 || y > M.hitHeight) continue;
    best = r;
    bestT = t;
  }
  hitAt.d = bestT;
  return best;
}
