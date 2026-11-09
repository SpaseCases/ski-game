import { Color, Vector3 } from 'three';
import { alongLine } from '../maps/decor.ts';
import { framePoint, roofHeight, townFrame, WALL_INSET } from '../maps/town.ts';
import type { BuildingFeature, Heightfield, LineDecor, XZ } from '../maps/types.ts';
import type { MeshKit, TiledKit } from './meshKit.ts';
import { renderedHeightAt } from './terrainMesh.ts';

// The City's landmarks and big structures (milestone 16, the city on a
// hill): the cathedral, the clock tower, the domed civic hall, an art-deco
// tower with setbacks, a twisted glass tower, the train station under its
// arched roof, the brutalist parking garage and a half-built building on a
// construction site (buildings, styled), then the arched stone viaduct, the
// elevated rail line, a skybridge, the funicular, tram tracks and
// scaffolding (line decor), and a tower crane and the park's frozen
// fountain (props). Everything is flat-colored boxes, prisms and panels
// merged into the same tiles as the town, like the rest of the City.

const c = (hex: string): Color => new Color(hex);
const STONE = c('#b9ad98');
const STONE_DARK = c('#8f8473');
const SLATE = c('#4a5260');
const COPPER = c('#6fa08a');
const COPPER_DARK = c('#4f7d6a');
const GOLD = c('#d9b24a');
const GLASS = c('#2c4058');
const GLASS_TINT = c('#4f7894');
const GLASS_LIT = c('#ffd98a');
const CONCRETE = c('#a3a29c');
const CONCRETE_DARK = c('#7e7d78');
const OPEN_DARK = c('#2a2c30');
const STEEL = c('#4a535c');
const SAFETY = c('#e8862a');
const NET = c('#d8642a');
const SNOW = c('#f1f5fa');
const ICE = c('#bfe0f0');
const ICE_DARK = c('#8fc0dc');
const CLOCK_FACE = c('#f4efe2');
const TRACK = c('#3a3f45');
const SLEEPER = c('#6b5844');
const RAIL_RED = c('#b8483a');
const CRANE = c('#e0b02a');

/** Styles drawn here. */
export const LANDMARK_STYLES: ReadonlySet<string> = new Set(['church', 'clock', 'civic', 'deco', 'twist', 'depot', 'garage', 'site', 'rampart', 'turret']);

/**
 * A landmark building. The level ones (shed roof turned uphill) are drawn
 * from the lowest ground at their walls up to their level roof; the garage
 * and the building site are ridden, so their floors follow their roof.
 */
export function drawLandmark(b: BuildingFeature, hf: Heightfield, kits: TiledKit, glows: TiledKit): void {
  const t = townFrame(b);
  const mid = framePoint(t, b.length / 2, 0);
  const k = kits.near(mid.x, mid.z);
  const glow = glows.near(mid.x, mid.z);
  if (b.style === 'garage' || b.style === 'site') {
    ridden(b, hf, k);
    return;
  }
  // Lowest ground under its walls, and its level roof.
  let floor = Infinity;
  for (const [u, v] of [[0, -b.width / 2], [0, b.width / 2], [b.length, -b.width / 2], [b.length, b.width / 2], [b.length / 2, 0]] as const) {
    const p = framePoint(t, u, v);
    floor = Math.min(floor, renderedHeightAt(hf, p.x, p.z));
  }
  const top = renderedHeightAt(hf, mid.x, mid.z) + roofHeight(b, b.length / 2) - floor;
  // Local frame: z along the building (its anchor end at -L/2), x across, y up from the lowest ground.
  const yaw = Math.atan2(t.dirX, t.dirZ);
  k.at(mid.x, floor, mid.z, yaw);
  glow.at(mid.x, floor, mid.z, yaw);
  const W = b.width - 2 * WALL_INSET;
  const L = b.length - 2 * WALL_INSET;
  const wall = new Color(b.color);
  // The downhill end (the anchor of a building turned uphill) is its front: local -z.
  const front = -L / 2;
  switch (b.style) {
    case 'church':
      church(k, glow, W, L, top, wall, front);
      break;
    case 'clock':
      clockTower(k, W, L, top, wall);
      break;
    case 'civic':
      civic(k, glow, W, L, top, wall, front);
      break;
    case 'deco':
      deco(k, glow, W, L, top, wall);
      break;
    case 'twist':
      twist(k, glow, W, L, top);
      break;
    case 'depot':
      depot(k, glow, W, L, top, wall, front);
      break;
    case 'rampart':
      rampart(k, W, L, top, wall);
      break;
    case 'turret':
      turret(k, glow, W, L, top, wall);
      break;
  }
}

/** Windows down a wall: tall panes from y0 to y1, `n` along a face of length `len`, on face x = fx (sign) or z = fz. */
function lancets(k: MeshKit, glow: MeshKit, len: number, y0: number, y1: number, at: (s: number) => [number, number], out: Vector3, n: number, seed: number): void {
  for (let i = 0; i < n; i++) {
    const s0 = -len / 2 + ((i + 0.3) * len) / n;
    const s1 = -len / 2 + ((i + 0.7) * len) / n;
    const lit = (i * 5 + seed) % 4 === 0;
    const [ax, az] = at(s0);
    const [bx, bz] = at(s1);
    (lit ? glow : k).quad(k.p(ax, y0, az), k.p(bx, y0, bz), k.p(bx, y1, bz), k.p(ax, y1, az), lit ? GLASS_LIT : GLASS, out);
  }
}

/** A cathedral: a stone nave with a pitched slate roof, lower aisles, buttresses, tall windows, two towers with spires over its front, a rose window. */
function church(k: MeshKit, glow: MeshKit, W: number, L: number, top: number, wall: Color, front: number): void {
  const nave = W * 0.56;
  const aisle = (W - nave) / 2;
  const aisleTop = top * 0.6;
  k.box(0, (top - 2) / 2, 0, nave, top + 2, L, wall);
  for (const s of [-1, 1]) {
    k.box(s * (nave / 2 + aisle / 2), (aisleTop - 2) / 2, 0, aisle, aisleTop + 2, L * 0.92, wall);
    // The aisle's lean-to roof.
    const x0 = s * nave / 2;
    const x1 = s * (W / 2 + 0.3);
    k.quad(k.p(x0, aisleTop + 2, -L * 0.46), k.p(x0, aisleTop + 2, L * 0.46), k.p(x1, aisleTop - 0.2, L * 0.46), k.p(x1, aisleTop - 0.2, -L * 0.46), SLATE, new Vector3(0, 1, 0));
    // Buttresses along the aisle.
    for (let z = -L * 0.4; z <= L * 0.4; z += L / 6) k.box(s * (W / 2 + 0.4), aisleTop / 2, z, 0.9, aisleTop, 1.1, STONE_DARK);
    lancets(k, glow, L * 0.8, aisleTop + 2.5, top - 1.5, (z) => [s * (nave / 2 + 0.05), z], k.p(s, 0, 0).sub(k.p(0, 0, 0)), 6, s > 0 ? 1 : 3);
    lancets(k, glow, L * 0.8, 1.5, aisleTop - 1.5, (z) => [s * (W / 2 + 0.05), z], k.p(s, 0, 0).sub(k.p(0, 0, 0)), 6, s > 0 ? 2 : 0);
  }
  // The nave's pitched roof, ridge along its length, and its gable ends.
  const ridge = top + nave * 0.45;
  for (const s of [-1, 1]) k.quad(k.p(s * (nave / 2 + 0.4), top - 0.3, -L / 2), k.p(s * (nave / 2 + 0.4), top - 0.3, L / 2), k.p(0, ridge, L / 2), k.p(0, ridge, -L / 2), SLATE, k.p(s, 1, 0).sub(k.p(0, 0, 0)));
  for (const z of [-L / 2, L / 2]) k.tri(k.p(-nave / 2, top, z), k.p(nave / 2, top, z), k.p(0, ridge, z), wall, k.p(0, 0, Math.sign(z)).sub(k.p(0, 0, 0)));
  // Two towers over the front, their spires.
  const tw = Math.min(W * 0.26, 9);
  const towerTop = top + 14;
  for (const s of [-1, 1]) {
    const x = s * (W / 2 - tw / 2);
    const z = front + tw / 2;
    k.box(x, (towerTop - 2) / 2, z, tw, towerTop + 2, tw, wall);
    k.box(x, towerTop + 0.4, z, tw + 0.6, 0.8, tw + 0.6, STONE_DARK);
    k.prism(x, z, towerTop + 0.8, towerTop + 18, tw * 0.6, 0, 8, SLATE);
    k.prism(x, z, towerTop + 18, towerTop + 20, 0.12, 0.05, 4, GOLD);
    // Belfry openings.
    for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
      const fx = x + (dx * tw) / 2 + dx * 0.05;
      const fz = z + (dz * tw) / 2 + dz * 0.05;
      const ax = fx - Math.abs(dz) * tw * 0.2;
      const bx = fx + Math.abs(dz) * tw * 0.2;
      const az = fz - Math.abs(dx) * tw * 0.2;
      const bz = fz + Math.abs(dx) * tw * 0.2;
      k.quad(k.p(ax, towerTop - 6, az), k.p(bx, towerTop - 6, bz), k.p(bx, towerTop - 1.5, bz), k.p(ax, towerTop - 1.5, az), OPEN_DARK, k.p(dx, 0, dz).sub(k.p(0, 0, 0)));
    }
  }
  // The rose window and the doors on the front.
  const out = k.p(0, 0, -1).sub(k.p(0, 0, 0));
  const ry = top * 0.72;
  const rz = front - 0.06;
  for (let i = 0; i < 8; i++) {
    const a0 = (i / 8) * Math.PI * 2;
    const a1 = ((i + 1) / 8) * Math.PI * 2;
    const r = Math.min(nave * 0.32, 4);
    (i % 2 ? glow : k).tri(k.p(0, ry, rz), k.p(Math.cos(a0) * r, ry + Math.sin(a0) * r, rz), k.p(Math.cos(a1) * r, ry + Math.sin(a1) * r, rz), i % 2 ? GLASS_LIT : GLASS_TINT, out);
  }
  k.quad(k.p(-1.6, 0, rz), k.p(1.6, 0, rz), k.p(1.6, 5.5, rz), k.p(-1.6, 5.5, rz), c('#3b2a1e'), out);
  k.tri(k.p(-1.6, 5.5, rz), k.p(1.6, 5.5, rz), k.p(0, 7.4, rz), c('#3b2a1e'), out);
}

/** A clock tower: stone shaft, a clock face on each side near the top, an open belfry, a copper pyramid roof. */
function clockTower(k: MeshKit, W: number, L: number, top: number, wall: Color): void {
  const s = Math.min(W, L);
  k.box(0, (top - 2) / 2, 0, s, top + 2, s, wall);
  // Bands of darker stone.
  for (const y of [top * 0.33, top * 0.66]) k.box(0, y, 0, s + 0.3, 0.5, s + 0.3, STONE_DARK);
  const fy = top - s * 0.55;
  const r = s * 0.36;
  for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
    const out = k.p(dx, 0, dz).sub(k.p(0, 0, 0));
    const at = (u: number, y: number): Vector3 => k.p(dx * (s / 2 + 0.08) + Math.abs(dz) * u, y, dz * (s / 2 + 0.08) + Math.abs(dx) * u);
    for (let i = 0; i < 12; i++) {
      const a0 = (i / 12) * Math.PI * 2;
      const a1 = ((i + 1) / 12) * Math.PI * 2;
      k.tri(at(0, fy), at(Math.cos(a0) * r, fy + Math.sin(a0) * r), at(Math.cos(a1) * r, fy + Math.sin(a1) * r), CLOCK_FACE, out);
    }
    // Hands at ten past ten.
    const hand = (a: number, len: number): void => {
      const tipU = Math.cos(a) * len;
      const tipY = fy + Math.sin(a) * len;
      const o = out.clone().multiplyScalar(0.06);
      k.quad(at(-0.08, fy).add(o), at(0.08, fy).add(o), at(tipU + 0.08, tipY).add(o), at(tipU - 0.08, tipY).add(o), OPEN_DARK, out);
    };
    hand(Math.PI * 0.75, r * 0.85);
    hand(Math.PI * 0.2, r * 0.6);
  }
  // The belfry: corner piers, open between, then the roof.
  const bt = top + 5;
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) k.box((x * s) / 2 - x * 0.5, top + 2.5, (z * s) / 2 - z * 0.5, 1, 5, 1, wall);
  k.box(0, top + 0.1, 0, s, 0.2, s, OPEN_DARK);
  k.box(0, bt + 0.3, 0, s + 0.8, 0.6, s + 0.8, STONE_DARK);
  k.prism(0, 0, bt + 0.6, bt + s * 1.2, s * 0.72, 0, 4, COPPER);
  k.prism(0, 0, bt + s * 1.2, bt + s * 1.2 + 2, 0.1, 0.05, 4, GOLD);
}

/** A domed civic hall: a long stone block, a columned portico and pediment on its front, a drum and a copper dome. */
function civic(k: MeshKit, glow: MeshKit, W: number, L: number, top: number, wall: Color, front: number): void {
  k.box(0, (top - 2) / 2, 0, W, top + 2, L, wall);
  k.box(0, top + 0.4, 0, W + 0.6, 0.8, L + 0.6, STONE_DARK);
  for (const s of [-1, 1]) lancets(k, glow, L * 0.85, 2, top - 2, (z) => [s * (W / 2 + 0.05), z], k.p(s, 0, 0).sub(k.p(0, 0, 0)), 8, s > 0 ? 1 : 2);
  // Portico: six columns out in front, an entablature, a pediment.
  const pw = W * 0.6;
  const pz = front - 3;
  const ph = Math.min(top, 12);
  for (let i = 0; i < 6; i++) k.prism(-pw / 2 + (i * pw) / 5, pz, 0, ph, 0.55, 0.45, 8, STONE);
  k.box(0, ph + 0.5, pz + 1.5, pw + 1.4, 1, 4, STONE_DARK);
  const out = k.p(0, 0, -1).sub(k.p(0, 0, 0));
  k.tri(k.p(-pw / 2 - 0.7, ph + 1, pz - 0.5), k.p(pw / 2 + 0.7, ph + 1, pz - 0.5), k.p(0, ph + 4.5, pz - 0.5), STONE, out);
  for (const s of [-1, 1]) k.quad(k.p(s * (pw / 2 + 0.7), ph + 1, pz - 0.5), k.p(s * (pw / 2 + 0.7), ph + 1, pz + 3.5), k.p(0, ph + 4.5, pz + 3.5), k.p(0, ph + 4.5, pz - 0.5), SNOW, k.p(s, 1, 0).sub(k.p(0, 0, 0)));
  // Drum and dome: rings of a hemisphere, a lantern.
  const r = Math.min(W, L) * 0.3;
  const base = top + 0.8;
  k.prism(0, 0, base, base + 5, r, r, 12, wall);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    (i % 3 === 0 ? glow : k).box(Math.cos(a) * (r + 0.02), base + 2.5, Math.sin(a) * (r + 0.02), 0.8, 2.6, 0.8, i % 3 === 0 ? GLASS_LIT : GLASS);
  }
  const rings = 5;
  for (let i = 0; i < rings; i++) {
    const a0 = (i / rings) * (Math.PI / 2);
    const a1 = ((i + 1) / rings) * (Math.PI / 2);
    k.prism(0, 0, base + 5 + Math.sin(a0) * r, base + 5 + Math.sin(a1) * r, Math.cos(a0) * r, Math.max(0.01, Math.cos(a1) * r), 12, i % 2 ? COPPER_DARK : COPPER);
  }
  k.prism(0, 0, base + 5 + r, base + 7 + r, 0.9, 0.7, 8, STONE);
  k.prism(0, 0, base + 7 + r, base + 8.5 + r, 0.8, 0, 8, COPPER);
}

/** An art-deco tower: three setbacks, piers running up every face between bands of windows, a stepped crown and a spire. */
function deco(k: MeshKit, glow: MeshKit, W: number, L: number, top: number, wall: Color): void {
  const tiers: [number, number][] = [
    [1, top * 0.55],
    [0.78, top * 0.8],
    [0.56, top],
  ];
  let y0 = -2;
  tiers.forEach(([f, y1], ti) => {
    const w = W * f;
    const l = L * f;
    k.box(0, (y0 + y1) / 2, 0, w, y1 - y0, l, wall);
    // Piers and window strips on the long faces and the ends.
    for (const [dx, dz, len] of [[1, 0, l], [-1, 0, l], [0, 1, w], [0, -1, w]] as const) {
      const out = k.p(dx, 0, dz).sub(k.p(0, 0, 0));
      const n = Math.max(2, Math.floor(len / 3));
      for (let i = 0; i < n; i++) {
        const s0 = -len / 2 + ((i + 0.25) * len) / n;
        const s1 = -len / 2 + ((i + 0.75) * len) / n;
        const at = (s: number, y: number): Vector3 => k.p(dx * ((dx ? w : 0) / 2 + 0.05) + Math.abs(dz) * s, y, dz * ((dz ? l : 0) / 2 + 0.05) + Math.abs(dx) * s);
        const lit = (i * 7 + ti * 3) % 5 === 0;
        (lit ? glow : k).quad(at(s0, Math.max(4, y0 + 1)), at(s1, Math.max(4, y0 + 1)), at(s1, y1 - 1.5), at(s0, y1 - 1.5), lit ? GLASS_LIT : GLASS, out);
      }
    }
    k.box(0, y1 + 0.25, 0, w + 0.5, 0.5, l + 0.5, STONE);
    y0 = y1;
  });
  // A stepped crown and a needle spire.
  const w = W * 0.56;
  k.box(0, top + 2, 0, w * 0.7, 4, w * 0.7, STONE);
  k.box(0, top + 5, 0, w * 0.45, 2, w * 0.45, GOLD);
  k.prism(0, 0, top + 6, top + 22, w * 0.14, 0, 4, STEEL);
}

/** A twisted glass tower: a slab of glass per floor, each turned a little more than the one below, pale floor edges. */
function twist(k: MeshKit, glow: MeshKit, W: number, L: number, top: number): void {
  const s = Math.min(W, L) * 0.9;
  const floor = 3.6;
  const n = Math.max(3, Math.floor(top / floor));
  for (let f = 0; f < n; f++) {
    const a = (f * 2.6 * Math.PI) / 180;
    const y = f * floor;
    const ca = Math.cos(a) * (s / 2);
    const sa = Math.sin(a) * (s / 2);
    const corners: [number, number][] = [
      [ca - sa, sa + ca],
      [-ca - sa, -sa + ca],
      [-ca + sa, -sa - ca],
      [ca + sa, sa - ca],
    ];
    for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i]!;
      const [bx, bz] = corners[(i + 1) % 4]!;
      const out = k.p((ax + bx) / 2, 0, (az + bz) / 2).sub(k.p(0, 0, 0));
      const lit = (f * 5 + i * 3) % 9 === 0;
      (lit ? glow : k).quad(k.p(ax, f === 0 ? -2 : y, az), k.p(bx, f === 0 ? -2 : y, bz), k.p(bx, y + floor - 0.35, bz), k.p(ax, y + floor - 0.35, az), lit ? GLASS_LIT : f % 2 ? GLASS : GLASS_TINT, out);
      k.quad(k.p(ax * 1.02, y + floor - 0.35, az * 1.02), k.p(bx * 1.02, y + floor - 0.35, bz * 1.02), k.p(bx * 1.02, y + floor, bz * 1.02), k.p(ax * 1.02, y + floor, az * 1.02), c('#dfe6ec'), out);
    }
    if (f === n - 1) k.quad(k.p(corners[0]![0], y + floor, corners[0]![1]), k.p(corners[1]![0], y + floor, corners[1]![1]), k.p(corners[2]![0], y + floor, corners[2]![1]), k.p(corners[3]![0], y + floor, corners[3]![1]), SNOW, new Vector3(0, 1, 0));
  }
}

/** The train station: brick walls, an arched glass-and-steel roof over its length, a big fan window on its front, a clock. */
function depot(k: MeshKit, glow: MeshKit, W: number, L: number, top: number, wall: Color, front: number): void {
  const wallTop = Math.max(5, top * 0.55);
  k.box(0, (wallTop - 2) / 2, 0, W, wallTop + 2, L, wall);
  for (const s of [-1, 1]) lancets(k, glow, L * 0.9, 1.5, wallTop - 1, (z) => [s * (W / 2 + 0.05), z], k.p(s, 0, 0).sub(k.p(0, 0, 0)), 10, s > 0 ? 0 : 2);
  // The barrel roof: an arc across the width, run along the length, ribbed.
  const R = W / 2;
  const segs = 8;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI;
    const a1 = ((i + 1) / segs) * Math.PI;
    const p = (a: number, z: number): Vector3 => k.p(Math.cos(a) * R, wallTop + Math.sin(a) * R * 0.7, z);
    const out = k.p(Math.cos((a0 + a1) / 2), Math.sin((a0 + a1) / 2), 0).sub(k.p(0, 0, 0));
    k.quad(p(a0, -L / 2), p(a1, -L / 2), p(a1, L / 2), p(a0, L / 2), i === 3 || i === 4 ? SNOW : i % 2 ? GLASS_TINT : STEEL, out);
    // The fan window across each end.
    for (const z of [-L / 2 - 0.05, L / 2 + 0.05]) (i % 2 ? glow : k).tri(k.p(0, wallTop, z), p(a0, z), p(a1, z), i % 2 ? GLASS_LIT : GLASS, k.p(0, 0, Math.sign(z)).sub(k.p(0, 0, 0)));
  }
  for (let z = -L / 2; z <= L / 2 + 0.01; z += L / 6) {
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI;
      const a1 = ((i + 1) / segs) * Math.PI;
      k.beam(Math.cos(a0) * (R + 0.1), wallTop + Math.sin(a0) * R * 0.7 + 0.1, z, Math.cos(a1) * (R + 0.1), wallTop + Math.sin(a1) * R * 0.7 + 0.1, z, 0.3, STEEL);
    }
  }
  // A clock over the entrance.
  const out = k.p(0, 0, -1).sub(k.p(0, 0, 0));
  const fy = wallTop - 1.6;
  for (let i = 0; i < 10; i++) {
    const a0 = (i / 10) * Math.PI * 2;
    const a1 = ((i + 1) / 10) * Math.PI * 2;
    k.tri(k.p(0, fy, front - 0.1), k.p(Math.cos(a0) * 1.2, fy + Math.sin(a0) * 1.2, front - 0.1), k.p(Math.cos(a1) * 1.2, fy + Math.sin(a1) * 1.2, front - 0.1), CLOCK_FACE, out);
  }
}

/** A stretch of the citadel's wall: battered stone, a walkway of snow along its top between crenellations. */
function rampart(k: MeshKit, W: number, L: number, top: number, wall: Color): void {
  k.box(0, (top - 3) / 2, 0, W, top + 3, L, wall);
  k.box(0, top * 0.25, 0, W + 0.8, top * 0.5 + 3, L, STONE_DARK);
  k.box(0, top + 0.05, 0, W - 0.6, 0.1, L, SNOW);
  for (const s of [-1, 1]) {
    for (let z = -L / 2 + 0.6; z < L / 2 - 0.3; z += 1.8) {
      k.box((s * (W - 0.5)) / 2, top + 0.55, z + 0.45, 0.5, 1.1, 0.9, wall);
      k.box((s * (W - 0.5)) / 2, top + 1.12, z + 0.45, 0.56, 0.06, 0.96, SNOW);
    }
  }
}

/** A round turret at a gate: an eight-sided stone tower, a ring of corbels, arrow slits, a slate cone and a flag pole. */
function turret(k: MeshKit, glow: MeshKit, W: number, L: number, top: number, wall: Color): void {
  const r = Math.min(W, L) / 2;
  k.prism(0, 0, -3, top, r * 1.08, r, 8, wall);
  k.prism(0, 0, top, top + 1.2, r * 1.25, r * 1.25, 8, STONE_DARK);
  k.prism(0, 0, top + 1.2, top + 1.3, r * 1.26, r * 1.26, 8, SNOW);
  k.prism(0, 0, top + 1.3, top + 1.3 + r * 2.2, r * 1.3, 0, 8, SLATE);
  k.prism(0, 0, top + 1.3 + r * 2.2, top + 3.8 + r * 2.2, 0.06, 0.05, 4, OPEN_DARK);
  k.box(0.35, top + 3.3 + r * 2.2, 0, 0.7, 0.45, 0.04, RAIL_RED);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 8;
    const lit = i === 1;
    (lit ? glow : k).box(Math.cos(a) * (r + 0.02), top * 0.6, Math.sin(a) * (r + 0.02), 0.35, 1.4, 0.35, lit ? GLASS_LIT : OPEN_DARK);
  }
}

/**
 * A ridden landmark, its floors following its roof: the brutalist parking
 * garage (concrete decks with dark open bays and fat columns) or the
 * half-built building (a concrete frame, an orange safety net on one side,
 * scaffolding up the other).
 */
function ridden(b: BuildingFeature, hf: Heightfield, k: MeshKit): void {
  const t = townFrame(b);
  const half = b.width / 2 - WALL_INSET;
  const at = (u: number, v: number, below: number): Vector3 => {
    const p = framePoint(t, u, v);
    return new Vector3(p.x, renderedHeightAt(hf, p.x, p.z) + roofHeight(b, u) - below, p.z);
  };
  const ground = (u: number, v: number): Vector3 => {
    const p = framePoint(t, u, v);
    return new Vector3(p.x, renderedHeightAt(hf, p.x, p.z) - 0.4, p.z);
  };
  const dir = (du: number, dv: number): Vector3 => new Vector3(t.dirX * du + t.rightX * dv, 0, t.dirZ * du + t.rightZ * dv);
  const site = b.style === 'site';
  const floor = 2.9;
  const n = Math.max(1, Math.floor(b.eave / floor));
  const u0 = WALL_INSET;
  const u1 = b.length - WALL_INSET;
  const step = 6;
  const nu = Math.max(1, Math.round((u1 - u0) / step));
  // Columns at the corners and every `step` m along the long sides.
  for (let i = 0; i <= nu; i++) {
    const u = u0 + ((u1 - u0) * i) / nu;
    for (const v of [-half + 0.3, half - 0.3]) k.beamWorld(ground(u, v), at(u, v, 0.1), site ? 0.45 : 0.7, site ? CONCRETE_DARK : CONCRETE);
  }
  // The decks: a slab edge band at each level, open below it (dark bays on the garage, nothing on the site).
  for (let f = 0; f < n; f++) {
    const below = f * floor;
    for (const [ua, va, ub, vb, out] of [
      [u0, -half, u1, -half, dir(0, -1)],
      [u1, half, u0, half, dir(0, 1)],
      [u0, half, u0, -half, dir(-1, 0)],
      [u1, -half, u1, half, dir(1, 0)],
    ] as const) {
      const pieces = Math.max(1, Math.ceil(Math.hypot(ub - ua, vb - va) / 4));
      for (let i = 0; i < pieces; i++) {
        const s0 = i / pieces;
        const s1 = (i + 1) / pieces;
        const pa = [ua + (ub - ua) * s0, va + (vb - va) * s0] as const;
        const pb = [ua + (ub - ua) * s1, va + (vb - va) * s1] as const;
        const band = site ? 0.35 : 1.0;
        k.quad(at(pa[0], pa[1], below + band), at(pb[0], pb[1], below + band), at(pb[0], pb[1], below), at(pa[0], pa[1], below), f === 0 ? CONCRETE : site ? CONCRETE_DARK : CONCRETE, out);
        if (!site) k.quad(at(pa[0], pa[1], below + floor), at(pb[0], pb[1], below + floor), at(pb[0], pb[1], below + band), at(pa[0], pa[1], below + band), OPEN_DARK, out);
      }
    }
  }
  if (site) {
    // An orange safety net down one long side, scaffolding up the other.
    const v = half + 0.6;
    for (let i = 0; i < nu; i++) {
      const ua = u0 + ((u1 - u0) * i) / nu;
      const ub = u0 + ((u1 - u0) * (i + 1)) / nu;
      k.quad(at(ua, -v, 0.6), at(ub, -v, 0.6), at(ub, -v, Math.min(b.eave, 4)), at(ua, -v, Math.min(b.eave, 4)), NET, dir(0, -1));
      for (const below of [0.5, 2.5, 4.5]) if (below < b.eave) k.beamWorld(at(ua, v + 0.8, below), at(ub, v + 0.8, below), 0.08, SAFETY);
      k.beamWorld(ground(ua, v + 0.8), at(ua, v + 0.8, 0.2), 0.08, STEEL);
      k.beamWorld(ground(ua, v + 0.8), at(ub, v + 0.8, Math.min(b.eave - 0.3, 3)), 0.06, STEEL);
    }
  }
}

// ---------------------------------------------------------------- line structures

/** A viaduct, the elevated line, a skybridge, the funicular, tram tracks or scaffolding. */
export function drawCityLine(line: LineDecor, hf: Heightfield, kits: TiledKit): void {
  switch (line.kind) {
    case 'viaduct':
      viaduct(line, hf, kits);
      break;
    case 'elevated':
      elevated(line, hf, kits);
      break;
    case 'skybridge':
      skybridge(line, hf, kits);
      break;
    case 'funicular':
      funicular(line, hf, kits);
      break;
    case 'tramTracks':
      tracks(line.points, hf, kits, 1.435, false);
      break;
    case 'scaffold':
      scaffold(line, hf, kits);
      break;
  }
}

const g = (hf: Heightfield, p: XZ): number => renderedHeightAt(hf, p.x, p.z);

/** An arched stone viaduct: its deck straight from end to end, `height` above the ground there; a pier at each inner point, an arch between. */
function viaduct(line: LineDecor, hf: Heightfield, kits: TiledKit): void {
  const pts = line.points;
  const a = pts[0]!;
  const z = pts[pts.length - 1]!;
  const ya = g(hf, a) + line.height;
  const yz = g(hf, z) + line.height;
  const total = Math.hypot(z.x - a.x, z.z - a.z);
  const deck = (p: XZ): number => ya + ((yz - ya) * Math.hypot(p.x - a.x, p.z - a.z)) / total;
  const width = 7;
  const dx = (z.x - a.x) / total;
  const dz = (z.z - a.z) / total;
  const rx = -dz;
  const rz = dx;
  const yaw = Math.atan2(dx, dz);
  // Piers.
  for (const p of pts.slice(1, -1)) {
    const k = kits.near(p.x, p.z);
    const y0 = g(hf, p) - 1;
    const top = deck(p);
    k.at(p.x, y0, p.z, yaw);
    k.box(0, (top - 1.2 - 0) / 2, 0, width + 0.6, top - 1.2 - y0, 3.6, STONE);
    k.box(0, 0.6, 0, width + 1.4, 1.2, 4.6, STONE_DARK);
  }
  // Each span: the deck slab, two parapets, the arch's ring under it (in segments).
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1]!;
    const p1 = pts[i]!;
    const k = kits.near((p0.x + p1.x) / 2, (p0.z + p1.z) / 2).at(0, 0, 0);
    const y0 = deck(p0);
    const y1 = deck(p1);
    const W = (side: number, p: XZ, y: number): Vector3 => new Vector3(p.x + rx * side * (width / 2), y, p.z + rz * side * (width / 2));
    const up = new Vector3(0, 1, 0);
    k.quad(W(-1, p0, y0), W(1, p0, y0), W(1, p1, y1), W(-1, p1, y1), SNOW, up);
    for (const s of [-1, 1]) {
      const out = new Vector3(rx * s, 0, rz * s);
      k.quad(W(s, p0, y0 - 1.4), W(s, p1, y1 - 1.4), W(s, p1, y1 + 1), W(s, p0, y0 + 1), STONE, out);
      k.quad(W(s * 0.86, p0, y0), W(s * 0.86, p1, y1), W(s * 0.86, p1, y1 + 1), W(s * 0.86, p0, y0 + 1), STONE_DARK, out.clone().negate());
      k.quad(W(s, p0, y0 + 1), W(s, p1, y1 + 1), W(s * 0.86, p1, y1 + 1), W(s * 0.86, p0, y0 + 1), SNOW, up);
    }
    // The arch: a half-ellipse of stone down from under the deck to each pier.
    const span = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    const segs = 8;
    const ground0 = Math.min(g(hf, p0), g(hf, p1));
    const rise = Math.max(2, Math.min(span / 2, (y0 + y1) / 2 - 1.4 - ground0 - 2));
    for (const s of [-1, 1]) {
      const out = new Vector3(rx * s, 0, rz * s);
      for (let j = 0; j < segs; j++) {
        const t0 = j / segs;
        const t1 = (j + 1) / segs;
        const pt = (tt: number): XZ => ({ x: p0.x + (p1.x - p0.x) * tt, z: p0.z + (p1.z - p0.z) * tt });
        const deckY = (tt: number): number => y0 + (y1 - y0) * tt - 1.4;
        const archY = (tt: number): number => deckY(tt) - rise * (1 - Math.sin(Math.PI * tt)) - 0.1;
        const q0 = pt(t0);
        const q1 = pt(t1);
        k.quad(W(s, q0, archY(t0)), W(s, q1, archY(t1)), W(s, q1, deckY(t1)), W(s, q0, deckY(t0)), STONE, out);
      }
    }
  }
}

/** The elevated rail line: a steel box girder `height` above the ground on pillars at its inner points, two rails on top, snow on its edges. */
function elevated(line: LineDecor, hf: Heightfield, kits: TiledKit): void {
  const pts = line.points;
  const deck = (p: XZ): number => g(hf, p) + line.height;
  for (const p of pts.slice(1, -1)) {
    const k = kits.near(p.x, p.z).at(p.x, g(hf, p) - 0.5, p.z);
    k.box(0, (line.height - 0.4) / 2, 0, 1.4, line.height + 0.1, 1.4, CONCRETE);
    k.box(0, line.height - 0.9, 0, 5, 0.8, 1.6, CONCRETE_DARK);
  }
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1]!;
    const p1 = pts[i]!;
    const k = kits.near((p0.x + p1.x) / 2, (p0.z + p1.z) / 2).at(0, 0, 0);
    const len = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    const rx = -(p1.z - p0.z) / len;
    const rz = (p1.x - p0.x) / len;
    const W = (v: number, p: XZ, y: number): Vector3 => new Vector3(p.x + rx * v, y, p.z + rz * v);
    const y0 = deck(p0);
    const y1 = deck(p1);
    for (const s of [-1, 1]) k.quad(W(s * 2.4, p0, y0 - 1.6), W(s * 2.4, p1, y1 - 1.6), W(s * 2.4, p1, y1), W(s * 2.4, p0, y0), STEEL, new Vector3(rx * s, 0, rz * s));
    k.quad(W(-2.4, p0, y0 - 1.6), W(2.4, p0, y0 - 1.6), W(2.4, p1, y1 - 1.6), W(-2.4, p1, y1 - 1.6), STEEL, new Vector3(0, -1, 0));
    k.quad(W(-2.4, p0, y0), W(2.4, p0, y0), W(2.4, p1, y1), W(-2.4, p1, y1), SNOW, new Vector3(0, 1, 0));
    for (const v of [-0.72, 0.72]) k.beamWorld(W(v, p0, y0 + 0.12), W(v, p1, y1 + 0.12), 0.1, TRACK);
  }
}

/** A skybridge: a glass tube between two towers, `height` up, steel edges. */
function skybridge(line: LineDecor, hf: Heightfield, kits: TiledKit): void {
  const [a, b] = [line.points[0]!, line.points[line.points.length - 1]!];
  const y = Math.min(g(hf, a), g(hf, b)) + line.height;
  const k = kits.near((a.x + b.x) / 2, (a.z + b.z) / 2).at(0, 0, 0);
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const rx = -(b.z - a.z) / len;
  const rz = (b.x - a.x) / len;
  const W = (v: number, p: XZ, h: number): Vector3 => new Vector3(p.x + rx * v, y + h, p.z + rz * v);
  for (const s of [-1, 1]) {
    const out = new Vector3(rx * s, 0, rz * s);
    k.quad(W(s * 2.5, a, 0), W(s * 2.5, b, 0), W(s * 2.5, b, 3.4), W(s * 2.5, a, 3.4), GLASS_TINT, out);
    k.quad(W(s * 2.5, a, -0.8), W(s * 2.5, b, -0.8), W(s * 2.5, b, 0), W(s * 2.5, a, 0), STEEL, out);
  }
  k.quad(W(-2.6, a, 3.4), W(2.6, a, 3.4), W(2.6, b, 3.4), W(-2.6, b, 3.4), SNOW, new Vector3(0, 1, 0));
  k.quad(W(-2.5, a, -0.8), W(2.5, a, -0.8), W(2.5, b, -0.8), W(-2.5, b, -0.8), STEEL, new Vector3(0, -1, 0));
}

/** Rails on sleepers along a line, at the snow (gauge `gauge` m); the funicular adds its cable between. */
function tracks(points: readonly XZ[], hf: Heightfield, kits: TiledKit, gauge: number, cable: boolean): void {
  const spots = alongLine(points, 2);
  for (let i = 1; i < spots.length; i++) {
    const p0 = spots[i - 1]!;
    const p1 = spots[i]!;
    const k = kits.near(p0.x, p0.z).at(0, 0, 0);
    const len = Math.hypot(p1.x - p0.x, p1.z - p0.z) || 1;
    const rx = -(p1.z - p0.z) / len;
    const rz = (p1.x - p0.x) / len;
    for (const v of [-gauge / 2, gauge / 2]) {
      k.beamWorld(new Vector3(p0.x + rx * v, g(hf, p0) + 0.08, p0.z + rz * v), new Vector3(p1.x + rx * v, g(hf, p1) + 0.08, p1.z + rz * v), 0.09, TRACK);
    }
    if (i % 2 === 0) k.beamWorld(new Vector3(p0.x - rx * (gauge / 2 + 0.3), g(hf, p0) + 0.02, p0.z - rz * (gauge / 2 + 0.3)), new Vector3(p0.x + rx * (gauge / 2 + 0.3), g(hf, p0) + 0.02, p0.z + rz * (gauge / 2 + 0.3)), 0.14, SLEEPER);
    if (cable) k.beamWorld(new Vector3(p0.x, g(hf, p0) + 0.15, p0.z), new Vector3(p1.x, g(hf, p1) + 0.15, p1.z), 0.04, STEEL);
  }
}

/** The funicular: its track up the hill (its stations are buildings of their own), a red car parked part way. */
function funicular(line: LineDecor, hf: Heightfield, kits: TiledKit): void {
  tracks(line.points, hf, kits, 1.2, true);
  const pts = line.points;
  // The car, a third of the way up.
  const spots = alongLine(pts, 3);
  const i = Math.floor(spots.length / 3);
  const p = spots[i]!;
  const q = spots[Math.min(spots.length - 1, i + 1)]!;
  const yaw = Math.atan2(q.x - p.x, q.z - p.z);
  const slope = Math.atan2(g(hf, q) - g(hf, p), Math.hypot(q.x - p.x, q.z - p.z));
  const k = kits.near(p.x, p.z).at(p.x, g(hf, p) + 0.3, p.z, yaw);
  // Stepped body: three boxes climbing with the slope.
  for (let j = 0; j < 3; j++) {
    const z = (j - 1) * 2.4;
    const y = Math.tan(slope) * z;
    k.box(0, y + 1.3, z, 2.4, 2.4, 2.4, RAIL_RED);
    k.box(0, y + 1.7, z, 2.45, 0.9, 2.2, GLASS);
    k.box(0, y + 2.55, z, 2.5, 0.1, 2.5, SNOW);
  }
}

/** Scaffolding along a wall: standards every 2.4 m, ledgers every 2 m up to `height`, planks, an orange net. */
function scaffold(line: LineDecor, hf: Heightfield, kits: TiledKit): void {
  const spots = alongLine(line.points, 2.4);
  const h = line.height || 8;
  for (let i = 0; i < spots.length; i++) {
    const p = spots[i]!;
    const k = kits.near(p.x, p.z).at(0, 0, 0);
    const y = g(hf, p);
    k.beamWorld(new Vector3(p.x, y - 0.3, p.z), new Vector3(p.x, y + h, p.z), 0.07, STEEL);
    if (i > 0) {
      const q = spots[i - 1]!;
      const yq = g(hf, q);
      for (let l = 2; l <= h; l += 2) k.beamWorld(new Vector3(q.x, yq + l, q.z), new Vector3(p.x, y + l, p.z), 0.06, l === h ? SAFETY : STEEL);
      k.beamWorld(new Vector3(q.x, yq + 0.2, q.z), new Vector3(p.x, y + h - 0.2, p.z), 0.04, STEEL);
      k.quad(new Vector3(q.x, yq + h - 3.8, q.z), new Vector3(p.x, y + h - 3.8, p.z), new Vector3(p.x, y + h, p.z), new Vector3(q.x, yq + h, q.z), NET, new Vector3(-(p.z - q.z), 0, p.x - q.x));
    }
  }
}

// ---------------------------------------------------------------- props

/** A tower crane facing -Z: a lattice mast, a long jib and a counter-jib, a cab, a hook on its cable. */
export function crane(k: MeshKit): void {
  const H = 38;
  k.box(0, 0.4, 0, 4, 0.8, 4, CONCRETE);
  for (const [x, z] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]] as const) k.beam(x, 0, z, x, H, z, 0.18, CRANE);
  for (let y = 0; y < H; y += 3) {
    k.beam(-0.9, y, -0.9, 0.9, y + 3, -0.9, 0.08, CRANE);
    k.beam(-0.9, y, 0.9, 0.9, y + 3, 0.9, 0.08, CRANE);
    k.beam(-0.9, y, -0.9, -0.9, y + 3, 0.9, 0.08, CRANE);
    k.beam(0.9, y, -0.9, 0.9, y + 3, 0.9, 0.08, CRANE);
  }
  k.box(0, H + 1, -0.6, 2.2, 2, 2.4, CRANE);
  k.box(0, H + 1.2, -1.85, 2, 1.2, 0.1, GLASS);
  k.beam(0, H + 2.2, 0, 0, H + 2.2, -42, 0.9, CRANE);
  k.beam(0, H + 2.2, 0, 0, H + 2.2, 14, 0.9, CRANE);
  k.box(0, H + 1, 11, 3, 2.6, 3, CONCRETE_DARK);
  k.beam(0, H + 2.6, 0, 0, H + 7, 0, 0.4, CRANE);
  k.beam(0, H + 7, 0, 0, H + 2.6, -30, 0.06, STEEL);
  k.beam(0, H + 7, 0, 0, H + 2.6, 12, 0.06, STEEL);
  k.beam(0, H + 1.8, -28, 0, H - 14, -28, 0.04, STEEL);
  k.box(0, H - 14.4, -28, 0.6, 0.8, 0.3, SAFETY);
}

/** The park's frozen fountain: a stone basin ring full of ice, a tiered center column hung with icicles. */
export function fountain(k: MeshKit): void {
  const R = 6;
  for (let i = 0; i < 16; i++) {
    const a0 = (i / 16) * Math.PI * 2;
    const a1 = ((i + 1) / 16) * Math.PI * 2;
    const p = (a: number, r: number, y: number): Vector3 => k.p(Math.cos(a) * r, y, Math.sin(a) * r);
    const out = k.p(Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2)).sub(k.p(0, 0, 0));
    k.quad(p(a0, R, -0.3), p(a1, R, -0.3), p(a1, R, 0.7), p(a0, R, 0.7), STONE, out);
    k.quad(p(a0, R, 0.7), p(a1, R, 0.7), p(a1, R - 0.6, 0.7), p(a0, R - 0.6, 0.7), SNOW, new Vector3(0, 1, 0));
    k.tri(k.p(0, 0.45, 0), p(a0, R - 0.6, 0.45), p(a1, R - 0.6, 0.45), i % 2 ? ICE : ICE_DARK, new Vector3(0, 1, 0));
  }
  k.prism(0, 0, 0.3, 2.4, 0.7, 0.5, 8, STONE);
  k.prism(0, 0, 2.4, 2.7, 2.2, 2.2, 10, STONE_DARK);
  k.prism(0, 0, 2.7, 3.6, 0.45, 0.35, 8, STONE);
  k.prism(0, 0, 3.6, 3.8, 1.2, 1.2, 8, STONE_DARK);
  k.prism(0, 0, 3.8, 4.8, 0.4, 0, 6, ICE);
  // Icicles round each bowl.
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    k.prism(Math.cos(a) * 2, Math.sin(a) * 2, 1.2 + (i % 3) * 0.3, 2.45, 0, 0.12, 4, ICE);
    if (i % 2 === 0) k.prism(Math.cos(a) * 1.1, Math.sin(a) * 1.1, 2.8, 3.6, 0, 0.08, 4, ICE);
  }
}
