import { type BufferGeometry, Color, IcosahedronGeometry, Vector3 } from 'three';
import { DECOR_SIZE } from '../maps/decor.ts';
import { hash2 } from '../maps/terrain.ts';
import { MeshKit } from './meshKit.ts';

// Low-poly decoration models, all original. Scatter models (trees, snags,
// rocks) are built once as geometry for instancing. Props are drawn into a
// MeshKit at a spot, in local space: +Y up, facing -Z (heading 0), base at y 0.

const c = (hex: string): Color => new Color(hex);
export const PALETTE = {
  trunk: c('#5b4030'),
  needles: c('#2f5a3c'),
  needlesDark: c('#244a31'),
  needlesSnow: c('#e8eef5'),
  snag: c('#8b7c6c'),
  rock: c('#7d848c'),
  rockDark: c('#666d75'),
  snow: c('#f1f5fa'),
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

/** Scatter prototypes: two pines, a snag, three rocks, two boulders. Picked per item by its tint. */
export function scatterModels(): Record<'pine' | 'snag' | 'rock' | 'boulder', BufferGeometry[]> {
  return {
    pine: [pine(false), pine(true)],
    snag: [snag()],
    rock: [rock(11, false), rock(23, false), rock(37, false)],
    boulder: [rock(51, true), rock(67, true)],
  };
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

/** A dead tree: a bare, tapering trunk with a few broken branches. */
function snag(): BufferGeometry {
  const k = new MeshKit();
  k.prism(0, 0, -0.3, 6, 0.24, 0.05, 6, PALETTE.snag);
  k.beam(0, 2.4, 0, 1.1, 3.1, 0.2, 0.09, PALETTE.snag);
  k.beam(0, 3.4, 0, -0.9, 4.2, -0.3, 0.08, PALETTE.snag);
  k.beam(0, 4.4, 0, 0.3, 5.0, 0.8, 0.06, PALETTE.snag);
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
 * Draws a prop of `kind` into a kit already placed at its spot (see
 * MeshKit.at). Lamp faces go into `glow`, which is drawn unlit.
 */
export function drawProp(k: MeshKit, kind: string, color: Color, glow: MeshKit): void {
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
      k.panel(k.p(-half, y0, 0), k.p(half, y0, 0), k.p(half, y1, 0), k.p(-half, y1, 0), color);
      // A white stripe along the bottom, just in front of the cloth.
      k.panel(k.p(-half, y0, -0.01), k.p(half, y0, -0.01), k.p(half, y0 + 0.14, -0.01), k.p(-half, y0 + 0.14, -0.01), PALETTE.white);
      break;
    }
    case 'flag': {
      k.prism(0, 0, -0.3, S.flagHeight, 0.04, 0.03, 5, PALETTE.post);
      const top = S.flagHeight - 0.05;
      k.panel(k.p(0, top - 0.8, 0), k.p(1.25, top - 0.85, 0), k.p(1.25, top - 0.05, 0), k.p(0, top, 0), color);
      break;
    }
    case 'groomer':
      groomer(k);
      break;
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
