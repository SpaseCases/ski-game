import { type BufferGeometry, Color, IcosahedronGeometry, Vector3 } from 'three';
import { DECOR_SIZE } from '../maps/decor.ts';
import { hash2 } from '../maps/terrain.ts';
import { MeshKit } from './meshKit.ts';
import { propModel } from './propModels.ts';
import { crane, fountain } from './cityStructures.ts';

// Low-poly decoration models, all original. Scatter models (trees, snags,
// rocks) are built once as geometry for instancing. Props are drawn into a
// MeshKit at a spot, in local space: +Y up, facing -Z (heading 0), base at y 0.

const c = (hex: string): Color => new Color(hex);
export const PALETTE = {
  trunk: c('#5b4030'),
  needles: c('#2f5a3c'),
  needlesDark: c('#244a31'),
  needlesSnow: c('#e8eef5'),
  aspenBark: c('#e4e1d6'),
  aspenMark: c('#3e3b37'),
  twigs: c('#b6aaa0'),
  twigsDark: c('#9d9188'),
  snag: c('#8b7c6c'),
  rock: c('#77716b'),
  rockDark: c('#5b5550'),
  snow: c('#f1f5fa'),
  /** A cornice's shadowed underside. */
  corniceShade: c('#a9c3e3'),
  post: c('#3a4450'),
  metal: c('#9aa4ad'),
  metalDark: c('#6c7680'),
  orange: c('#ff6a13'),
  orangeDark: c('#d9530a'),
  net: c('#d8342c'),
  netDark: c('#9c1f18'),
  dye: c('#2f6fe0'),
  /** Lit lamp faces, drawn unlit (see drawProp's glow kit) so they read as lights. */
  lamp: c('#fffbe6'),
  white: c('#f4f6fa'),
  red: c('#c8331f'),
  redDark: c('#9e2616'),
  dark: c('#1b2430'),
  wood: c('#a87443'),
  woodDark: c('#7a4f2c'),
  roof: c('#3a4450'),
};

/** Flag and banner colors, cycled through when a map doesn't pick one. */
export const FLAG_COLORS = ['#2f7de1', '#ff7a1a', '#33c26a', '#e0c21f', '#d8342c', '#8a4fd6'].map(c);

/** Scatter prototypes: two pines, two aspens, a snag, three rocks, two boulders, three crags, a fallen tree. Picked per item by its tint. */
export function scatterModels(): Record<'pine' | 'aspen' | 'snag' | 'rock' | 'boulder' | 'crag' | 'deadfall', BufferGeometry[]> {
  return {
    pine: [pine(false), pine(true)],
    aspen: [aspen(false), aspen(true)],
    snag: [snag()],
    rock: [rock(11, false), rock(23, false), rock(37, false)],
    boulder: [rock(51, true), rock(67, true)],
    crag: [crag(5), crag(19), crag(29)],
    deadfall: [deadfall()],
  };
}

/**
 * Stand-ins for trees far away, a handful of triangles each: a pine as one
 * dark cone, an aspen as a pale spike on a white stick, a snag as a stick.
 * Rocks have none (they're too small to see that far).
 */
export function farScatterModels(): Record<'pine' | 'aspen' | 'snag', BufferGeometry> {
  const pineFar = new MeshKit();
  pineFar.prism(0, 0, 0.5, 5.8, 1.75, 0, 5, PALETTE.needlesDark);
  const aspenFar = new MeshKit();
  aspenFar.prism(0, 0, -0.3, 4.2, 0.14, 0.1, 3, PALETTE.aspenBark);
  aspenFar.prism(0, 0, 4, 8.6, 0.9, 0, 4, PALETTE.twigs, true);
  const snagFar = new MeshKit();
  snagFar.prism(0, 0, -0.3, 6, 0.24, 0.05, 3, PALETTE.snag);
  return { pine: pineFar.geometry(), aspen: aspenFar.geometry(), snag: snagFar.geometry() };
}

/** A pine: a short trunk under stacked cones, snow on the top tier. */
function pine(tall: boolean): BufferGeometry {
  const k = new MeshKit();
  const s = tall ? 1.25 : 1;
  const n = 7;
  k.prism(0, 0, -0.3, 1.1, 0.2, 0.14, n, PALETTE.trunk);
  const tiers: [number, number, number, Color][] = [
    [0.7, 2.6, 1.7, PALETTE.needlesDark],
    [2.0, 2.4, 1.25, PALETTE.needles],
    [3.3, 2.1, 0.85, PALETTE.needlesDark],
  ];
  for (const [y, h, r, color] of tiers) {
    k.prism(0, 0, y * s, (y + h) * s, r, 0, n, color, true);
  }
  k.prism(0, 0, 4.9 * s, 5.6 * s, 0.32, 0, n, PALETTE.needlesSnow, true);
  return k.geometry();
}

/**
 * A bare winter aspen: a slim white trunk with dark bark marks, and a few
 * pale branches reaching up and out from its upper half, with twigs.
 */
function aspen(tall: boolean): BufferGeometry {
  const k = new MeshKit();
  const s = tall ? 1.2 : 1;
  const top = 8.4 * s;
  k.prism(0, 0, -0.3, top, 0.14, 0.035, 6, PALETTE.aspenBark);
  for (const y of [0.9, 1.8, 2.8, 3.9]) k.prism(0, 0, y * s, (y + 0.14) * s, 0.15, 0.14, 6, PALETTE.aspenMark);
  // Branches: [height up the trunk, direction around it, reach out, rise].
  const branches: [number, number, number, number][] = [
    [4.2, 0.3, 1.3, 1.6],
    [4.9, 2.4, 1.5, 1.7],
    [5.6, 4.3, 1.2, 1.5],
    [6.3, 1.4, 1.0, 1.3],
    [6.9, 3.4, 0.9, 1.1],
    [7.5, 5.4, 0.6, 0.9],
  ];
  for (const [y, a, out, rise] of branches) {
    const x = Math.cos(a) * out * s;
    const z = Math.sin(a) * out * s;
    k.beam(0, y * s, 0, x, (y + rise) * s, z, 0.07, PALETTE.twigs);
    // A twig forking off near the end.
    k.beam(x * 0.6, (y + rise * 0.6) * s, z * 0.6, x * 0.75 - z * 0.35, (y + rise * 1.25) * s, z * 0.75 + x * 0.35, 0.04, PALETTE.twigsDark);
  }
  return k.geometry();
}

/** A dead tree: a bare, tapering trunk with a few broken branches. */
function snag(): BufferGeometry {
  const k = new MeshKit();
  k.prism(0, 0, -0.3, 6, 0.24, 0.05, 6, PALETTE.snag);
  k.beam(0, 2.4, 0, 1.1, 3.1, 0.2, 0.09, PALETTE.snag);
  k.beam(0, 3.4, 0, -0.9, 4.2, -0.3, 0.08, PALETTE.snag);
  k.beam(0, 4.4, 0, 0.3, 5.0, 0.8, 0.06, PALETTE.snag);
  return k.geometry();
}

/** A fallen tree lying in the snow along x: a tapering trunk with snow along its top, its root plate standing up at one end, two broken branches. */
function deadfall(): BufferGeometry {
  const k = new MeshKit();
  k.beam(-2.9, 0.2, 0, 3.1, 0.12, 0, 0.22, PALETTE.snag);
  k.beam(-2.7, 0.4, 0, 2.9, 0.3, 0, 0.11, PALETTE.snow);
  k.box(-3.05, 0.45, 0, 0.3, 1.3, 1.25, PALETTE.trunk);
  k.box(-3.0, 1.12, 0, 0.32, 0.08, 1.1, PALETTE.snow);
  k.beam(-0.6, 0.2, 0, -0.1, 0.55, 0.9, 0.07, PALETTE.snag);
  k.beam(1.4, 0.15, 0, 1.9, 0.5, -0.8, 0.06, PALETTE.snag);
  return k.geometry();
}

/** A lumpy rock from a jittered icosahedron, sitting a little into the snow; boulders wear a snow cap. */
function rock(seed: number, capped: boolean): BufferGeometry {
  // Polyhedron geometries are already non-indexed: three corners per face.
  const base = new IcosahedronGeometry(1, 0);
  const pos = base.getAttribute('position');
  // Jitter each corner by a hash of where it is, so shared corners move together.
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const j = 0.75 + 0.25 * hash2(Math.round(v.x * 100), Math.round(v.y * 100) + Math.round(v.z * 37), seed);
    pos.setXYZ(i, v.x * j * (capped ? 1.3 : 1), (v.y * j * 0.6 + 0.25) * (capped ? 1.5 : 1), v.z * j);
  }
  const k = new MeshKit();
  for (let i = 0; i < pos.count; i += 3) {
    const a = new Vector3().fromBufferAttribute(pos, i);
    const b = new Vector3().fromBufferAttribute(pos, i + 1);
    const d = new Vector3().fromBufferAttribute(pos, i + 2);
    const n = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(d, a)).normalize();
    const color = capped && n.y > 0.55 ? PALETTE.snow : hash2(i, seed, 3) > 0 ? PALETTE.rock : PALETTE.rockDark;
    k.tri(a, b, d, color, n);
  }
  base.dispose();
  return k.geometry();
}

/**
 * A crag: a tall, blocky outcrop of broken rock standing out of a cliff, a
 * stack of tilted slabs narrowing upward, its ledges dusted with snow.
 */
function crag(seed: number): BufferGeometry {
  const k = new MeshKit();
  const r = (i: number): number => 0.5 + 0.5 * hash2(i, seed, 13);
  let y = -1.2;
  let w = 2.2 + 0.6 * r(1);
  let d = 1.6 + 0.5 * r(2);
  let x = 0;
  let z = 0;
  for (let i = 0; i < 3; i++) {
    const h = 1.2 + 1.1 * r(3 + i);
    const color = hash2(i, seed, 5) > 0 ? PALETTE.rock : PALETTE.rockDark;
    k.at(x, 0, z, (r(9 + i) - 0.5) * 0.9);
    k.box(0, y + h / 2, 0, w, h, d, color);
    // Snow on the ledge it leaves.
    k.box(0, y + h + 0.04, 0, w * 0.92, 0.1, d * 0.9, PALETTE.snow);
    y += h;
    w *= 0.62 + 0.15 * r(20 + i);
    d *= 0.65 + 0.15 * r(30 + i);
    x += (r(40 + i) - 0.5) * 0.6;
    z += (r(50 + i) - 0.5) * 0.5;
  }
  // A leaning shard against one side.
  k.at(0, 0, 0, r(60) * 6);
  k.beam(1.1, -0.8, 0.2, 0.7, 1.8 + r(61), 0.4, 0.9, PALETTE.rockDark);
  return k.geometry();
}

/**
 * Draws a prop of `kind` into a kit already placed at its spot (see
 * MeshKit.at). Lamp faces go into `glow`, which is drawn unlit; cloth goes
 * into `cloth`, which sways in the wind. `index` varies props of a kind.
 */
export function drawProp(k: MeshKit, kind: string, color: Color, glow: MeshKit, cloth: MeshKit, index = 0): void {
  const S = DECOR_SIZE;
  switch (kind) {
    case 'lightPole': {
      const top = S.lightPoleHeight;
      k.prism(0, 0, -0.3, top, 0.11, 0.07, 6, PALETTE.post);
      k.beam(0, top - 0.2, 0, 0, top - 0.2, -1.3, 0.08, PALETTE.post);
      k.box(0, top - 0.3, -1.4, 0.4, 0.16, 0.6, PALETTE.post);
      // The lit underside.
      const y = top - 0.385;
      glow.quad(k.p(-0.16, y, -1.65), k.p(0.16, y, -1.65), k.p(0.16, y, -1.15), k.p(-0.16, y, -1.15), PALETTE.lamp, k.p(0, y - 1, -1.4).sub(k.p(0, y, -1.4)));
      break;
    }
    case 'floodlight': {
      const h = S.floodlightHeight;
      for (const [x, z] of [
        [-0.6, -0.6],
        [0.6, -0.6],
        [0.6, 0.6],
        [-0.6, 0.6],
      ] as const) {
        k.beam(x, -0.3, z, x * 0.4, h, z * 0.4, 0.1, PALETTE.metalDark);
      }
      for (let y = 2; y < h; y += 2.5) {
        const w = 0.6 - (0.36 * y) / h;
        k.beam(-w, y, -w, w, y + 1.2, -w, 0.05, PALETTE.metal);
        k.beam(w, y, w, -w, y + 1.2, w, 0.05, PALETTE.metal);
      }
      k.box(0, h, 0, 1.4, 0.15, 1.4, PALETTE.metalDark);
      // Two short masts holding two bars of separate lamp heads, each aimed
      // down at the course with a lit face.
      for (const x of [-0.55, 0.55]) k.beam(x, h, -0.2, x, h + 2.1, -0.2, 0.09, PALETTE.metalDark);
      for (let j = 0; j < 2; j++) {
        const y = h + 0.95 + j * 0.85;
        k.beam(-1.9, y, -0.2, 1.9, y, -0.2, 0.07, PALETTE.metalDark);
        for (let i = 0; i < 4; i++) lampHead(k, glow, -1.4 + i * 0.93, y, -0.45);
      }
      break;
    }
    case 'banner': {
      const half = S.bannerWidth / 2;
      for (const x of [-half, half]) k.prism(x, 0, -0.3, S.bannerHeight, 0.06, 0.05, 6, PALETTE.post);
      const y0 = S.bannerHeight - 1.15;
      const y1 = S.bannerHeight - 0.1;
      // Tied on along the top and at the posts: the middle of the bottom edge moves most.
      cloth.panel(k.p(-half, y0, 0), k.p(half, y0, 0), k.p(half, y1, 0), k.p(-half, y1, 0), color, color, [0.25, 0.25, 0, 0]);
      // A white stripe along the bottom, just in front of the cloth.
      cloth.panel(k.p(-half, y0, -0.01), k.p(half, y0, -0.01), k.p(half, y0 + 0.14, -0.01), k.p(-half, y0 + 0.14, -0.01), PALETTE.white, PALETTE.white, [0.25, 0.25, 0.22, 0.22]);
      break;
    }
    case 'flag': {
      k.prism(0, 0, -0.3, S.flagHeight, 0.04, 0.03, 5, PALETTE.post);
      const top = S.flagHeight - 0.05;
      cloth.panel(k.p(0, top - 0.8, 0), k.p(1.25, top - 0.85, 0), k.p(1.25, top - 0.05, 0), k.p(0, top, 0), color, color, [0, 1, 1, 0]);
      break;
    }
    case 'groomer':
      groomer(k);
      break;
    case 'streetLamp': {
      // A dark street lamp with a lantern on top and a long banner hanging off an arm toward the street (-Z).
      const top = S.streetLampHeight;
      k.prism(0, 0, -0.3, top - 0.5, 0.09, 0.06, 6, PALETTE.dark);
      k.box(0, 0.25, 0, 0.32, 0.5, 0.32, PALETTE.dark);
      k.box(0, top - 0.45, 0, 0.42, 0.12, 0.42, PALETTE.dark);
      k.box(0, top + 0.12, 0, 0.5, 0.12, 0.5, PALETTE.dark);
      k.prism(0, 0, top + 0.18, top + 0.42, 0.25, 0, 4, PALETTE.dark);
      for (const [x, z] of [
        [-0.17, 0],
        [0.17, 0],
        [0, -0.17],
        [0, 0.17],
      ] as const) {
        const out = k.p(x * 4, top - 0.1, z * 4).sub(k.p(0, top - 0.1, 0));
        const a = (dx: number, dz: number, y: number) => k.p(x + dx, y, z + dz);
        const sx = z === 0 ? 0 : 0.15;
        const sz = x === 0 ? 0 : 0.15;
        glow.quad(a(-sx, -sz, top - 0.38), a(sx, sz, top - 0.38), a(sx, sz, top + 0.05), a(-sx, -sz, top + 0.05), PALETTE.lamp, out);
      }
      k.beam(0, top - 1.1, 0, 0, top - 1.1, -0.9, 0.06, PALETTE.dark);
      cloth.panel(k.p(0, top - 1.15, -0.2), k.p(0, top - 1.15, -0.85), k.p(0, top - 2.6, -0.85), k.p(0, top - 2.6, -0.2), color, color, [0, 0.1, 0.8, 0.45]);
      cloth.panel(k.p(0.01, top - 2.45, -0.2), k.p(0.01, top - 2.45, -0.85), k.p(0.01, top - 2.6, -0.85), k.p(0.01, top - 2.6, -0.2), PALETTE.white, PALETTE.white, [0.4, 0.72, 0.8, 0.45]);
      break;
    }
    case 'snowmobile':
      snowmobile(k, color);
      break;
    case 'trafficLight':
    case 'stopSign':
    case 'noParking':
    case 'yieldSign':
    case 'waterTower': {
      const m = propModel(kind);
      if (m) k.model(m);
      else k.prism(0, 0, -0.3, 2.6, 0.06, 0.06, 6, PALETTE.post);
      break;
    }
    case 'person':
      person(k, color, index);
      break;
    case 'statue':
      statue(k, index);
      break;
    case 'crane':
      crane(k);
      break;
    case 'fountain':
      fountain(k);
      break;
    case 'skier':
      standingSkier(k, color, index);
      break;
    case 'skiRack':
      skiRack(k, index);
      break;
    case 'cabin':
      cabin(k);
      break;
    case 'mast':
      mast(k);
      break;
    case 'hut': {
      // A small timber hut with a snowy gable roof (a ticket booth, a ski patrol shed).
      const h = S.hutSize;
      k.box(0, 0.9, 0, h, 2.4, h, PALETTE.wood);
      k.box(0, 0.05, 0, h + 0.1, 0.4, h + 0.1, PALETTE.rockDark);
      k.box(0, 1.3, -h / 2 - 0.01, 0.9, 0.6, 0.04, PALETTE.dark);
      k.box(h / 2 + 0.01, 0.95, 0, 0.04, 1.9, 0.9, PALETTE.woodDark);
      const wall = 2.1;
      const ridge = wall + 1.2;
      for (const side of [-1, 1]) {
        k.panel(k.p(side * (h / 2 + 0.35), wall - 0.1, -h / 2 - 0.35), k.p(0, ridge, -h / 2 - 0.35), k.p(0, ridge, h / 2 + 0.35), k.p(side * (h / 2 + 0.35), wall - 0.1, h / 2 + 0.35), PALETTE.snow, PALETTE.woodDark);
      }
      for (const z of [-h / 2, h / 2]) k.panel(k.p(-h / 2, wall, z), k.p(h / 2, wall, z), k.p(0, ridge - 0.05, z), k.p(0, ridge - 0.05, z), PALETTE.woodDark);
      break;
    }
  }
}

/**
 * A warming cabin facing -Z: a log cabin on a stone footing under a snowy
 * gable roof, a chimney, a door and windows on the front, and a deck along
 * the front with a rail, a bench and a pair of skis stood against it.
 */
function cabin(k: MeshKit): void {
  const C = DECOR_SIZE.cabin;
  const w = C.length / 2;
  const d = C.depth / 2;
  const wall = 2.6;
  k.box(0, 0.25, 0, C.length + 0.2, 0.6, C.depth + 0.2, PALETTE.rockDark);
  k.box(0, 0.55 + wall / 2, 0, C.length, wall, C.depth, PALETTE.wood);
  for (const y of [1.1, 1.9, 2.7]) k.box(0, y, -d - 0.02, C.length + 0.1, 0.08, 0.06, PALETTE.woodDark);
  const top = 0.55 + wall;
  for (const side of [-1, 1]) {
    k.panel(k.p(side * (w + 0.45), top - 0.15, -d - 0.5), k.p(side * (w + 0.45), top - 0.15, d + 0.5), k.p(0, C.height, d + 0.5), k.p(0, C.height, -d - 0.5), PALETTE.snow, PALETTE.woodDark);
  }
  for (const z of [-d, d]) k.panel(k.p(-w, top, z), k.p(w, top, z), k.p(0, C.height - 0.05, z), k.p(0, C.height - 0.05, z), PALETTE.woodDark);
  k.box(w * 0.3, C.height, d * 0.3, 0.6, 1.6, 0.6, PALETTE.rock);
  k.box(w * 0.3, C.height + 0.82, d * 0.3, 0.7, 0.08, 0.7, PALETTE.dark);
  // The front: a door and two windows.
  k.box(-0.6, 1.5, -d - 0.03, 0.95, 1.9, 0.05, PALETTE.woodDark);
  for (const x of [-2.2, 1.5]) k.box(x, 1.9, -d - 0.03, 1.0, 0.75, 0.05, PALETTE.dark);
  // The deck, its rail and a bench.
  const fz = -d - C.deck / 2;
  k.box(0, 0.5, fz, C.length, 0.2, C.deck, PALETTE.woodDark);
  k.box(0, 1.45, -d - C.deck + 0.05, C.length, 0.08, 0.08, PALETTE.woodDark);
  for (const x of [-w + 0.1, -w / 2, w / 2, w - 0.1]) k.box(x, 1.0, -d - C.deck + 0.05, 0.1, 0.95, 0.1, PALETTE.woodDark);
  for (const x of [-w + 0.1, w - 0.1]) k.box(x, 1.0, fz, 0.1, 0.95, C.deck - 0.1, PALETTE.woodDark);
  k.box(1.6, 0.85, -d - 0.35, 1.8, 0.1, 0.4, PALETTE.wood);
  for (const x of [-1.9, -1.75]) k.box(x, 1.35, -d - C.deck + 0.2, 0.08, 1.7, 0.03, FLAG_COLORS[x < -1.8 ? 0 : 1]!);
}

/** A weather mast: a thin pole on a footing, an arm at the top with three anemometer cups and a vane, a logger box and a solar panel. */
function mast(k: MeshKit): void {
  const top = DECOR_SIZE.mastHeight;
  k.box(0, 0.15, 0, 0.6, 0.5, 0.6, PALETTE.rockDark);
  k.prism(0, 0, 0, top, 0.08, 0.05, 6, PALETTE.metal);
  k.beam(-0.7, top - 0.3, 0, 0.7, top - 0.3, 0, 0.03, PALETTE.metalDark);
  for (let i = 0; i < 3; i++) {
    const a = (i * 2 * Math.PI) / 3;
    k.beam(-0.7, top - 0.1, 0, -0.7 + Math.cos(a) * 0.3, top - 0.1, Math.sin(a) * 0.3, 0.015, PALETTE.dark);
    k.box(-0.7 + Math.cos(a) * 0.33, top - 0.1, Math.sin(a) * 0.33, 0.09, 0.09, 0.09, PALETTE.dark);
  }
  k.beam(0.7, top - 0.15, 0.25, 0.7, top - 0.15, -0.35, 0.02, PALETTE.dark);
  k.box(0.7, top - 0.15, 0.32, 0.04, 0.22, 0.18, PALETTE.red);
  k.box(0, 1.6, -0.14, 0.4, 0.5, 0.18, PALETTE.white);
  k.panel(k.p(-0.45, 2.4, -0.05), k.p(0.45, 2.4, -0.05), k.p(0.45, 2.95, -0.55), k.p(-0.45, 2.95, -0.55), PALETTE.dark, PALETTE.metalDark);
}

/** A parked snowmobile facing -Z: skis in front, the track behind, a colored hood, seat and windshield. */
function snowmobile(k: MeshKit, color: Color): void {
  for (const x of [-0.42, 0.42]) {
    k.box(x, 0.04, -0.95, 0.14, 0.06, 1.1, PALETTE.dark);
    k.beam(x, 0.04, -1.5, x, 0.22, -1.62, 0.1, PALETTE.dark);
    k.beam(x, 0.06, -0.8, x * 0.7, 0.45, -0.75, 0.06, PALETTE.metalDark);
  }
  k.box(0, 0.3, 0.55, 0.55, 0.5, 1.4, PALETTE.dark);
  k.box(0, 0.55, -0.5, 0.95, 0.45, 1.3, color);
  k.box(0, 0.48, 0.45, 0.8, 0.3, 1.0, color);
  k.box(0, 0.75, 0.5, 0.5, 0.2, 1.0, PALETTE.dark);
  k.panel(k.p(-0.35, 0.78, -0.25), k.p(0.35, 0.78, -0.25), k.p(0.3, 1.15, -0.05), k.p(-0.3, 1.15, -0.05), PALETTE.dark);
  k.beam(-0.38, 0.9, -0.05, 0.38, 0.9, -0.05, 0.05, PALETTE.dark);
  k.box(0, 0.62, -1.18, 0.4, 0.12, 0.1, PALETTE.lamp);
}

/** A skier standing about in a jacket of `color`: on their skis leaning on their poles, or with their skis stood in the snow beside them. */
function standingSkier(k: MeshKit, color: Color, index: number): void {
  const onSkis = index % 2 === 0;
  if (onSkis) {
    for (const x of [-0.12, 0.12]) k.box(x, 0.03, -0.1, 0.09, 0.05, 1.7, FLAG_COLORS[(index + 2) % FLAG_COLORS.length]!);
  } else {
    // Skis stood up in the snow to one side, tips up.
    for (const z of [-0.06, 0.06]) k.box(0.55, 0.75, z, 0.08, 1.7, 0.04, FLAG_COLORS[(index + 1) % FLAG_COLORS.length]!);
  }
  for (const x of [-0.11, 0.11]) {
    k.box(x, 0.12, 0, 0.14, 0.22, 0.26, PALETTE.dark);
    k.box(x, 0.55, 0, 0.15, 0.7, 0.17, PALETTE.post);
  }
  k.box(0, 1.17, 0, 0.44, 0.6, 0.26, color);
  k.box(0, 1.6, 0, 0.24, 0.26, 0.26, PALETTE.dark);
  k.box(0, 1.6, -0.13, 0.18, 0.07, 0.02, FLAG_COLORS[3]!);
  for (const x of [-0.28, 0.28]) k.box(x, 1.12, -0.04, 0.12, 0.5, 0.12, color);
  if (onSkis) {
    // Leaning on the poles, planted a little ahead.
    for (const x of [-0.3, 0.3]) k.beam(x, 0.9, -0.1, x * 1.3, -0.1, -0.45, 0.03, PALETTE.metal);
  }
}

/** A ski rack: a bar on two posts with pairs of skis leaning on it, across the rack's heading. */
function skiRack(k: MeshKit, index: number): void {
  const L = DECOR_SIZE.skiRackLength;
  for (const x of [-L / 2, L / 2]) k.box(x, 0.5, 0, 0.08, 1.3, 0.08, PALETTE.woodDark);
  k.box(0, 1.05, 0, L + 0.1, 0.08, 0.1, PALETTE.wood);
  k.box(0, 0.35, 0, L + 0.1, 0.08, 0.1, PALETTE.wood);
  const pairs = 5;
  for (let i = 0; i < pairs; i++) {
    if ((i + index) % 4 === 3) continue;
    const x = -L / 2 + 0.3 + ((L - 0.6) * i) / (pairs - 1);
    const color = FLAG_COLORS[(i + index) % FLAG_COLORS.length]!;
    for (const dx of [-0.05, 0.05]) k.beam(x + dx, -0.2, 0.35, x + dx, 1.55, -0.05, 0.08, color);
  }
}

/** A floodlight head at local (x, y, z): a dark housing with a lit face tipped down toward -Z. */
function lampHead(k: MeshKit, glow: MeshKit, x: number, y: number, z: number): void {
  k.box(x, y, z, 0.6, 0.48, 0.32, PALETTE.post);
  const w = 0.25;
  const front = z - 0.17;
  glow.quad(
    k.p(x - w, y - 0.2, front),
    k.p(x + w, y - 0.2, front),
    k.p(x + w, y + 0.2, front - 0.12),
    k.p(x - w, y + 0.2, front - 0.12),
    PALETTE.lamp,
    k.p(x, y - 0.45, front - 1).sub(k.p(x, y, front)),
  );
}

/** A snow groomer parked to the side: cab, body, tracks, front blade and rear tiller. */
function groomer(k: MeshKit): void {
  const S = DECOR_SIZE;
  const L = S.groomerLength;
  const W = S.groomerWidth;
  for (const x of [-W / 2 + 0.45, W / 2 - 0.45]) {
    k.box(x, 0.45, 0, 0.9, 0.9, L * 0.85, PALETTE.dark);
    k.box(x, 0.55, 0, 0.95, 0.35, L * 0.7, PALETTE.post);
  }
  k.box(0, 1.35, 0.3, W - 1.4, 0.9, L * 0.6, PALETTE.red);
  k.box(0, 1.35, 0.3, W - 0.2, 0.35, L * 0.55, PALETTE.redDark);
  // Cab: dark windows under a red roof.
  k.box(0, 2.35, -0.5, W - 1.2, 1.1, 1.8, PALETTE.dark);
  k.box(0, 2.95, -0.5, W - 1.0, 0.15, 2.0, PALETTE.red);
  k.box(0, 1.8, 1.3, W - 1.4, 0.5, 1.6, PALETTE.red);
  // Blade in front, tiller behind.
  k.box(0, 0.7, -L / 2 - 0.3, W + 0.4, 1.2, 0.2, PALETTE.metal);
  k.beam(-0.6, 1.0, -L / 2 + 0.2, -0.6, 0.9, -L / 2 - 0.2, 0.15, PALETTE.metalDark);
  k.beam(0.6, 1.0, -L / 2 + 0.2, 0.6, 0.9, -L / 2 - 0.2, 0.15, PALETTE.metalDark);
  k.box(0, 0.4, L / 2 + 0.55, W, 0.5, 1.0, PALETTE.metalDark);
}

/** Coat colors for the City's people. */
const COATS = ['#b8483a', '#3f6fa8', '#2f3a44', '#6a8f5a', '#c99a3a', '#7a4f8a', '#d9d4c8', '#2f6b45', '#a65f3a'].map((c) => new Color(c));
const SKIN = ['#e8c4a0', '#c99a72', '#8a5a3c', '#f0d2b8', '#6e4630'].map((c) => new Color(c));
const HATS = ['#2f3a44', '#b8483a', '#e8e0d0', '#3f6fa8', '#c99a3a'].map((c) => new Color(c));

/** A person on the sidewalk facing -Z: legs, a winter coat, a scarf, a head with a hat; some carry a bag, some point. */
function person(k: MeshKit, _color: Color, index: number): void {
  const r = (n: number): number => 0.5 + 0.5 * hash2(index, n, 71);
  const coat = COATS[index % COATS.length]!;
  const skin = SKIN[Math.floor(r(1) * SKIN.length) % SKIN.length]!;
  const hat = HATS[Math.floor(r(2) * HATS.length) % HATS.length]!;
  const tall = 1.55 + r(3) * 0.3;
  const leg = tall * 0.46;
  const stride = (r(4) - 0.5) * 0.3;
  for (const s of [-1, 1]) k.beam(s * 0.09, 0, stride * s, s * 0.09, leg, 0, 0.12, PALETTE.dark);
  k.box(0, leg + tall * 0.17, 0, 0.42, tall * 0.36, 0.26, coat);
  k.box(0, leg + tall * 0.36, 0, 0.3, 0.08, 0.24, hat);
  k.box(0, tall - 0.12, 0, 0.2, 0.22, 0.2, skin);
  k.box(0, tall + 0.02, 0, 0.23, 0.1, 0.23, hat);
  // Arms: down at the sides, or one raised, pointing up the hill.
  const raise = r(5) > 0.8;
  k.beam(-0.25, leg + tall * 0.33, 0, -0.27, leg + tall * 0.05, 0.05, 0.09, coat);
  if (raise) k.beam(0.25, leg + tall * 0.33, 0, 0.3, leg + tall * 0.55, -0.35, 0.09, coat);
  else k.beam(0.25, leg + tall * 0.33, 0, 0.27, leg + tall * 0.05, -0.05, 0.09, coat);
  if (r(6) > 0.6) k.box(0.32, leg - 0.05, 0, 0.12, 0.3, 0.3, PALETTE.woodDark);
}

/** A bronze figure on a stone plinth (a square's statue), snow on its head and shoulders. */
function statue(k: MeshKit, index: number): void {
  const stone = PALETTE.rockDark;
  const bronze = new Color('#4a5a4c');
  k.box(0, 0.6, 0, 2.2, 1.2, 2.2, stone);
  k.box(0, 1.25, 0, 2.4, 0.1, 2.4, PALETTE.snow);
  k.box(0, 1.9, 0, 0.7, 1.2, 0.5, bronze);
  k.box(0, 2.8, 0, 0.9, 0.7, 0.55, bronze);
  k.box(0, 3.2, 0, 0.92, 0.08, 0.57, PALETTE.snow);
  k.box(0, 3.45, 0, 0.36, 0.4, 0.36, bronze);
  k.box(0, 3.68, 0, 0.38, 0.06, 0.38, PALETTE.snow);
  // An arm raised (a hat in hand), or holding a book.
  if (index % 2 === 0) k.beam(0.45, 3.0, 0, 0.6, 3.75, -0.2, 0.16, bronze);
  else k.box(0.45, 2.55, -0.25, 0.4, 0.3, 0.12, bronze);
}
