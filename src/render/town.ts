import { Color, Vector3 } from 'three';
import { chimneySpot, EDGE, framePoint, roofHeight, stairRun, townFrame, WALL_INSET, type TownFrame } from '../maps/town.ts';
import type { BuildingFeature, Feature, Heightfield, TerraceFeature } from '../maps/types.ts';
import { drawText, textWidth } from './font.ts';
import type { MeshKit, TiledKit } from './meshKit.ts';
import { renderedHeightAt } from './terrainMesh.ts';

// The town's buildings and terraces, drawn around the parts the rider
// touches: the roofs, drifts, terrace tops and stairs are shapes (snow,
// drawn with the other shapes), so here go the walls, the trim along each
// roof's edge, windows, doors, shop signs, terrace walls and the steps.

const c = (hex: string): Color => new Color(hex);
const TIMBER = c('#6e4a2e');
const TIMBER_DARK = c('#55391f');
const STONE = c('#8d9196');
const STONE_DARK = c('#73787d');
const TRIM = c('#f1ece2');
const GLASS = c('#2a3c52');
const GLASS_LIT = c('#f3d58a');
const DOOR = c('#4a2f1b');
const FASCIA = c('#3b2a1e');
const SIGN_BOARD = c('#2b2f36');
const SIGN_TEXT = c('#f4ead2');
const STEP_TOP = c('#eef3f9');
const STEP_RISER = c('#9aa0a6');
const SOOT = c('#2a2a2a');
/** How far (m) walls reach below the snow. */
const SINK = 0.35;
/** Depth (m) of a roof's edge trim below its snowy top. */
const FASCIA_DEPTH = 0.32;
/** Riser height (m) of one step. */
const RISER = 0.18;

/** Draws every building and terrace in the feature list into `kits` (one kit per tile). */
export function drawTown(features: readonly Feature[], hf: Heightfield, kits: TiledKit, glows: TiledKit): void {
  for (const f of features) {
    if (f.type === 'building') drawBuilding(f, hf, kits, glows);
    else if (f.type === 'terrace') drawTerrace(f, hf, kits);
  }
}

/** A frame plus the ground under it, for drawing in world space. */
class Drawer {
  readonly t: TownFrame;
  readonly hf: Heightfield;
  readonly k: MeshKit;

  constructor(t: TownFrame, hf: Heightfield, k: MeshKit) {
    this.t = t;
    this.hf = hf;
    this.k = k;
  }

  /** World point `u` along, `v` across, `y` m above the bare ground there. */
  at(u: number, v: number, y: number): Vector3 {
    const p = framePoint(this.t, u, v);
    return new Vector3(p.x, renderedHeightAt(this.hf, p.x, p.z) + y, p.z);
  }

  /** World point at a fixed world height. */
  level(u: number, v: number, y: number): Vector3 {
    const p = framePoint(this.t, u, v);
    return new Vector3(p.x, y, p.z);
  }

  ground(u: number, v: number): number {
    const p = framePoint(this.t, u, v);
    return renderedHeightAt(this.hf, p.x, p.z);
  }

  /** Outward direction in the world for local (du, dv). */
  dir(du: number, dv: number): Vector3 {
    return new Vector3(this.t.dirX * du + this.t.rightX * dv, 0, this.t.dirZ * du + this.t.rightZ * dv);
  }

  /**
   * A wall from (u0, v0) to (u1, v1), from below the ground up to `top(s)`
   * m above it (s from 0 to 1 along it), in pieces of at most `step` m,
   * facing `out`, colored per piece.
   */
  wall(u0: number, v0: number, u1: number, v1: number, top: (s: number) => number, out: Vector3, color: (s: number) => Color, step = 1.5): void {
    const len = Math.hypot(u1 - u0, v1 - v0);
    const n = Math.max(1, Math.ceil(len / step));
    for (let i = 0; i < n; i++) {
      const s0 = i / n;
      const s1 = (i + 1) / n;
      const ua = u0 + (u1 - u0) * s0;
      const va = v0 + (v1 - v0) * s0;
      const ub = u0 + (u1 - u0) * s1;
      const vb = v0 + (v1 - v0) * s1;
      this.k.quad(this.at(ua, va, -SINK), this.at(ub, vb, -SINK), this.at(ub, vb, top(s1)), this.at(ua, va, top(s0)), color((s0 + s1) / 2), out);
    }
  }

  /** A flat panel on a wall facing `out`: from (u0, v0) to (u1, v1) along it, y0 to y1 above the ground at its middle, pushed out by `lift`. */
  panel(u0: number, v0: number, u1: number, v1: number, y0: number, y1: number, out: Vector3, color: Color, lift = 0.03): void {
    const g = this.ground((u0 + u1) / 2, (v0 + v1) / 2);
    const o = out.clone().normalize().multiplyScalar(lift);
    const a = this.level(u0, v0, g + y0).add(o);
    const b = this.level(u1, v1, g + y0).add(o);
    const d = this.level(u1, v1, g + y1).add(o);
    const e = this.level(u0, v0, g + y1).add(o);
    this.k.quad(a, b, d, e, color, out);
  }
}

function drawBuilding(b: BuildingFeature, hf: Heightfield, kits: TiledKit, glows: TiledKit): void {
  const t = townFrame(b);
  const mid = framePoint(t, b.length / 2, 0);
  const d = new Drawer(t, hf, kits.near(mid.x, mid.z));
  const glow = new Drawer(t, hf, glows.near(mid.x, mid.z));
  const u0 = WALL_INSET;
  const u1 = b.length - WALL_INSET;
  const half = b.width / 2;
  const v = half - WALL_INSET;
  // Walls stop just under the roof's snowy top (roof heights are above the snow, which is the ground here).
  const under = (u: number): number => roofHeight(b, u) - FASCIA_DEPTH;
  const base = b.style === 'shop' ? 0 : b.style === 'station' ? 0.6 : b.style === 'lodge' ? 1.6 : 0.9;
  const wallColor = new Color(b.color);
  // Sides: the gable ends (their tops follow the roof).
  for (const side of [-1, 1]) {
    const out = d.dir(0, side);
    d.wall(u0, side * v, u1, side * v, (s) => under(u0 + (u1 - u0) * s), out, (s) => (Math.floor(s * 12) % 2 === 0 && b.style === 'chalet' ? TIMBER : wallColor));
    if (base > 0) d.wall(u0, side * (v + 0.04), u1, side * (v + 0.04), () => base, out, (s) => (Math.floor(s * 8) % 2 === 0 ? STONE : STONE_DARK));
  }
  // The uphill and downhill walls (under the eaves).
  for (const [u, sign] of [
    [u0, -1],
    [u1, 1],
  ] as const) {
    const out = d.dir(sign, 0);
    d.wall(u, -v, u, v, () => under(u), out, () => wallColor);
    if (base > 0) d.wall(u + sign * 0.04, -v, u + sign * 0.04, v, () => base, out, (s) => (Math.floor(s * 8) % 2 === 0 ? STONE : STONE_DARK));
  }

  // Trim along every roof edge: a dark board from the snowy top down.
  roofTrim(d, b);
  if (b.chimney) {
    const c = chimneySpot(b);
    const p = framePoint(t, c.u, c.v);
    const g = renderedHeightAt(hf, p.x, p.z);
    d.k.at(p.x, g, p.z, Math.atan2(t.dirX, t.dirZ));
    d.k.box(0, (c.foot + c.top) / 2, 0, 0.8, c.top - c.foot, 0.8, STONE_DARK);
    d.k.box(0, c.top + 0.06, 0, 1.0, 0.12, 1.0, STONE);
    d.k.box(0, c.top + 0.13, 0, 0.5, 0.04, 0.5, SOOT);
  }

  // Windows on every wall; on the front, the door (shop windows either side of it) and the sign over it.
  const walls: { name: BuildingFeature['front']; a: [number, number]; b: [number, number]; out: Vector3 }[] = [
    { name: 'left', a: [u0, -v], b: [u1, -v], out: d.dir(0, -1) },
    { name: 'right', a: [u1, v], b: [u0, v], out: d.dir(0, 1) },
    { name: 'up', a: [u0, v], b: [u0, -v], out: d.dir(-1, 0) },
    { name: 'down', a: [u1, -v], b: [u1, v], out: d.dir(1, 0) },
  ];
  const shop = b.style === 'shop' || b.style === 'lodge';
  for (const w of walls) {
    const isFront = w.name === b.front;
    const du = w.b[0] - w.a[0];
    const dv = w.b[1] - w.a[1];
    const len = Math.hypot(du, dv);
    const eu = du / len;
    const ev = dv / len;
    // Room up the wall: under the lowest point of the roof along it.
    const room = Math.min(under(w.a[0]), under(w.b[0])) - 0.4;
    const floors = room > 5.8 ? 2 : 1;
    const count = Math.max(1, Math.floor(len / 3.4));
    const doorAt = isFront ? Math.floor(count / 2) : -1;
    for (let i = 0; i < count; i++) {
      const s = (i + 0.5) / count;
      const uc = w.a[0] + du * s;
      const vc = w.a[1] + dv * s;
      const span = (half: number): [number, number, number, number] => [uc - eu * half, vc - ev * half, uc + eu * half, vc + ev * half];
      for (let f = 0; f < floors; f++) {
        if (i === doorAt && f === 0) {
          d.panel(...span(0.55), -0.1, 2.1, w.out, DOOR);
          d.panel(...span(0.75), 2.1, 2.3, w.out, TRIM);
          continue;
        }
        const big = shop && isFront && f === 0;
        const y0 = f === 0 ? Math.max(base + 0.15, big ? 0.5 : 0.9) : 3.5;
        const tall = big ? 1.9 : 1.1;
        if (y0 + tall > room) continue;
        const wide = big ? Math.min(2.4, len / count - 0.8) : 1.0;
        d.panel(...span(wide / 2 + 0.1), y0 - 0.1, y0 + tall + 0.1, w.out, TRIM);
        const lit = (i * 7 + f * 3 + Math.round(b.x + b.z)) % 3 === 0;
        (lit ? glow : d).panel(...span(wide / 2), y0, y0 + tall, w.out, lit ? GLASS_LIT : GLASS, 0.05);
      }
    }
    // A window up in each gable.
    if (b.roof === 'gable' && (w.name === 'left' || w.name === 'right') && b.rise > 2.2) {
      const span: [number, number, number, number] = [b.length / 2 - 0.5, w.a[1], b.length / 2 + 0.5, w.a[1]];
      const y0 = b.eave + 0.2;
      d.panel(...span, y0 - 0.1, y0 + 1.0, w.out, TRIM);
      d.panel(span[0] + 0.1, span[1], span[2] - 0.1, span[3], y0, y0 + 0.9, w.out, GLASS, 0.05);
    }
    if (isFront && b.sign !== '') shopSign(d, b, (w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2, w.out, room);
  }
}

/** The dark board along each edge of a roof, under its snow: eaves and gable ends. */
function roofTrim(d: Drawer, b: BuildingFeature): void {
  const half = b.width / 2;
  const top = (u: number, v: number): number => d.ground(u, v) + roofHeight(b, u);
  const quadAt = (u0: number, v0: number, u1: number, v1: number, out: Vector3): void => {
    const y0 = top(u0, v0);
    const y1 = top(u1, v1);
    d.k.quad(d.level(u0, v0, y0 - FASCIA_DEPTH), d.level(u1, v1, y1 - FASCIA_DEPTH), d.level(u1, v1, y1 + 0.02), d.level(u0, v0, y0 + 0.02), FASCIA, out);
  };
  // Enough pieces to follow a gable's rounded ridge.
  const n = b.roof === 'gable' ? 10 : 1;
  for (const side of [-1, 1]) {
    for (let i = 0; i < n; i++) {
      const ua = (b.length * i) / n;
      const ub = (b.length * (i + 1)) / n;
      quadAt(ua, side * half, ub, side * half, d.dir(0, side));
    }
  }
  quadAt(0, -half, 0, half, d.dir(-1, 0));
  quadAt(b.length, -half, b.length, half, d.dir(1, 0));
  // The underside of the overhang, so the eaves don't look paper thin from below.
  for (const side of [-1, 1]) {
    const y = (u: number): number => top(u, side * half) - FASCIA_DEPTH;
    const pts = Array.from({ length: n + 1 }, (_, i) => (b.length * i) / n);
    for (let i = 1; i < pts.length; i++) {
      const ua = pts[i - 1]!;
      const ub = pts[i]!;
      d.k.quad(
        d.level(ua, side * half, y(ua)),
        d.level(ub, side * half, y(ub)),
        d.level(ub, side * (half - WALL_INSET), y(ub)),
        d.level(ua, side * (half - WALL_INSET), y(ua)),
        TIMBER_DARK,
        new Vector3(0, -1, 0),
      );
    }
  }
}

/** A board over the door with the shop's name, on the wall whose middle is (u, v), facing `out`. */
function shopSign(d: Drawer, b: BuildingFeature, u: number, v: number, out: Vector3, room: number): void {
  const size = 0.36;
  const w = textWidth(b.sign, size) + 0.6;
  const y = Math.min(room - 0.6, 2.6);
  const g = d.ground(u, v);
  const p = framePoint(d.t, u + out.dot(d.dir(1, 0)) * 0.08, v + out.dot(d.dir(0, 1)) * 0.08);
  // The kit's local +Z points out of the wall, toward the street.
  d.k.at(p.x, g, p.z, Math.atan2(out.x, out.z));
  d.k.box(0, y + 0.25, -0.04, w, 0.7, 0.08, SIGN_BOARD);
  drawText(d.k, b.sign, -w / 2 + 0.3, y + 0.25 - size / 2, 0.01, size, SIGN_TEXT);
}

function drawTerrace(f: TerraceFeature, hf: Heightfield, kits: TiledKit): void {
  const t = townFrame(f);
  const mid = framePoint(t, f.length / 2, 0);
  const d = new Drawer(t, hf, kits.near(mid.x, mid.z));
  const v = f.width / 2 + EDGE * 0.4;
  const top = (u: number): number => (f.height * Math.max(0, u)) / f.length - 0.02;
  const stone = (s: number): Color => (Math.floor(s * 14) % 2 === 0 ? STONE : STONE_DARK);
  for (const side of [-1, 1]) d.wall(0, side * v, f.length, side * v, (s) => top(f.length * s), d.dir(0, side), stone, 1.2);
  const u = f.length + EDGE * 0.4;
  if (f.stairs > 0) {
    const gap = f.stairs / 2;
    d.wall(u, -v, u, -gap, () => f.height - 0.02, d.dir(1, 0), stone, 1.2);
    d.wall(u, gap, u, v, () => f.height - 0.02, d.dir(1, 0), stone, 1.2);
    // The stair's own side walls, under its slope.
    const run = stairRun(f);
    for (const side of [-1, 1]) {
      d.wall(f.length, side * gap, f.length + run, side * gap, (s) => f.height * (1 - s), d.dir(0, side), stone, 0.6);
    }
    drawSteps(d, f, run);
  } else {
    d.wall(u, -v, u, v, () => f.height - 0.02, d.dir(1, 0), stone, 1.2);
  }
  // A coping stone along the top of the walls.
  const lip = 0.12;
  for (const side of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const ua = (f.length * i) / 6;
      const ub = (f.length * (i + 1)) / 6;
      d.k.quad(d.at(ua, side * (v + lip), top(ua)), d.at(ub, side * (v + lip), top(ub)), d.at(ub, side * (v - 0.25), top(ub) + 0.04), d.at(ua, side * (v - 0.25), top(ua) + 0.04), TRIM, new Vector3(0, 1, 0));
    }
  }
}

/**
 * The steps down a terrace's stairs: treads under the smooth slope the
 * skis ride, each one's front edge on it.
 */
function drawSteps(d: Drawer, f: TerraceFeature, run: number): void {
  const n = Math.max(2, Math.round(f.height / RISER));
  const riser = f.height / n;
  const tread = run / n;
  const half = f.stairs / 2;
  const up = new Vector3(0, 1, 0);
  const front = d.dir(1, 0);
  for (let i = 1; i <= n; i++) {
    const ua = f.length + (i - 1) * tread;
    const ub = f.length + i * tread;
    // Tread i sits at the slope's height at its front edge (ub), relative to the snow there.
    const h = f.height - i * riser;
    const y = (u: number, vv: number): number => d.ground(u, vv) + h;
    const yb = (u: number, vv: number): number => d.ground(u, vv) + h + riser;
    d.k.quad(d.level(ua, -half, y(ua, -half)), d.level(ub, -half, y(ub, -half)), d.level(ub, half, y(ub, half)), d.level(ua, half, y(ua, half)), STEP_TOP, up);
    // The riser above this tread's back edge.
    d.k.quad(d.level(ua, -half, y(ua, -half)), d.level(ua, half, y(ua, half)), d.level(ua, half, yb(ua, half)), d.level(ua, -half, yb(ua, -half)), STEP_RISER, front);
  }
}
