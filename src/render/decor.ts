import {
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
} from 'three';
import { alongLine, DECOR_SIZE, type DecorLayout, type ScatterItem } from '../maps/decor.ts';
import type { Feature, Heightfield, LineDecor, XZ } from '../maps/types.ts';
import type { DistanceCuller } from './culling.ts';
import { MeshKit, TiledKit } from './meshKit.ts';
import { drawProp, farScatterModels, FLAG_COLORS, PALETTE, scatterModels } from './models.ts';
import { cablePoint, CABLE_ARM, liftLine } from './chairlifts.ts';
import { clothMaterial } from './cloth.ts';
import { drawSign } from './signs.ts';
import { drawnHeightAt, renderedHeightAt } from './terrainMesh.ts';
import { drawTown } from './town.ts';
import { litByPools } from './lightPools.ts';

// Draws a map's decoration: trees, snags and rocks as instanced meshes (one
// draw call per model in each square tile of the map), everything else
// merged into meshes per 64 m tile. The culler takes tiles past the fog out
// of the scene, and Three.js skips the ones off screen. For long view
// ranges, each block of 2 × 2 tree tiles also gets a stand-in of simple far
// trees, drawn instead of the tiles once the block is far away.

const TILE = 64;
/** Side (m) of one tile of instanced trees and rocks. */
const SCATTER_TILE = 160;
/** Tree tiles per side of a block that shares one set of far trees. */
const FAR_BLOCK = 2;
/** Tallest scatter model (m), so a tile's reach covers its treetops (and the tallest crags). */
const SCATTER_TOP = 14;
/** How far (m) posts, trunks and rocks sink below the drawn snow so bumps never show a gap. */
const SINK = 0.15;

const material = litByPools(new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
/** Lamp faces ignore lighting, so they look lit. */
const glowMaterial = new MeshBasicMaterial({ vertexColors: true });
/** Lines dyed into the snow sit right on it; draw them on top. */
const decalMaterial = litByPools(
  new MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  }),
);

/**
 * Draws the decoration and the town's buildings (from `features`); every
 * tile goes to `culler` to be dropped when far away. `farTrees`: also build
 * simple far trees for long view ranges.
 */
export function createDecor(layout: DecorLayout, features: readonly Feature[], hf: Heightfield, culler: DistanceCuller, farTrees: boolean): Group {
  const group = new Group();
  const blocks = new Map<number, number>();
  const block = SCATTER_TILE * FAR_BLOCK;
  const far = farTrees ? farTreeBlocks(layout.scatter, hf) : new Map<number, Group>();
  for (const tile of scatterTiles(layout.scatter, hf)) {
    const key = cellKey(Math.floor(tile.x / block), Math.floor(tile.z / block));
    let id = blocks.get(key);
    if (id === undefined) {
      const stand = far.get(key) ?? null;
      if (stand) group.add(stand);
      id = culler.addGroup(stand, (Math.floor(tile.x / block) + 0.5) * block, (Math.floor(tile.z / block) + 0.5) * block, block / 2);
      blocks.set(key, id);
    }
    group.add(tile.group);
    culler.add(tile.group, tile.x, tile.z, tile.radius, id);
  }

  const kits = new TiledKit(TILE);
  const decals = new TiledKit(TILE);
  const glows = new TiledKit(TILE);
  const cloths = new TiledKit(TILE);
  for (const line of layout.lines) drawLine(line, hf, line.kind === 'dyeLine' ? decals : kits, cloths);
  for (const p of layout.props) {
    const yaw = (p.heading * Math.PI) / 180;
    p.points.forEach((at, i) => {
      const color = p.color ? new Color(p.color) : FLAG_COLORS[i % FLAG_COLORS.length]!;
      const k = kits.near(at.x, at.z).at(at.x, drawnHeightAt(hf, at.x, at.z), at.z, yaw);
      drawProp(k, p.kind, color, glows.near(at.x, at.z), cloths.near(at.x, at.z), i);
    });
  }
  for (const sign of layout.signs) drawSign(kits.near(sign.x, sign.z).at(sign.x, drawnHeightAt(hf, sign.x, sign.z), sign.z, (sign.heading * Math.PI) / 180), sign);
  drawTown(features, hf, kits, glows);
  for (const [kit, mat] of [
    [kits, material],
    [decals, decalMaterial],
    [glows, glowMaterial],
    [cloths, clothMaterial],
  ] as const) {
    for (const mesh of kit.meshes(mat)) {
      group.add(mesh);
      culler.addMesh(mesh);
    }
  }
  return group;
}

/** A tile of instanced scatter: its group, and the middle and reach of the ground it covers. */
interface ScatterTile {
  group: Group;
  x: number;
  z: number;
  radius: number;
}

function cellKey(i: number, j: number): number {
  return (i + 32768) * 65536 + (j + 32768);
}

/** Simple far trees for each block of tiles, keyed like cellKey: a group with one instanced mesh per kind of tree in it. */
function farTreeBlocks(items: readonly ScatterItem[], hf: Heightfield): Map<number, Group> {
  const models = farScatterModels();
  const block = SCATTER_TILE * FAR_BLOCK;
  const sorted = new Map<number, Map<'pine' | 'aspen' | 'snag', ScatterItem[]>>();
  for (const t of items) {
    if (t.kind !== 'pine' && t.kind !== 'aspen' && t.kind !== 'snag') continue;
    const key = cellKey(Math.floor(t.x / block), Math.floor(t.z / block));
    let kinds = sorted.get(key);
    if (!kinds) {
      kinds = new Map();
      sorted.set(key, kinds);
    }
    const list = kinds.get(t.kind);
    if (list) list.push(t);
    else kinds.set(t.kind, [t]);
  }
  const out = new Map<number, Group>();
  for (const [key, kinds] of sorted) {
    const g = new Group();
    for (const [kind, mine] of kinds) g.add(scatterMesh(models[kind], mine, hf));
    out.set(key, g);
  }
  return out;
}

/** Sorts scatter into square tiles, each a group with one instanced mesh per model used in it. */
function scatterTiles(items: readonly ScatterItem[], hf: Heightfield): ScatterTile[] {
  const models = scatterModels();
  const tiles = new Map<number, Map<BufferGeometry, ScatterItem[]>>();
  const used = new Set<BufferGeometry>();
  for (const t of items) {
    const variants = models[t.kind];
    const geometry = variants[Math.min(variants.length - 1, Math.floor(t.tint * variants.length))]!;
    used.add(geometry);
    const key = cellKey(Math.floor(t.x / SCATTER_TILE), Math.floor(t.z / SCATTER_TILE));
    let tile = tiles.get(key);
    if (!tile) {
      tile = new Map();
      tiles.set(key, tile);
    }
    const list = tile.get(geometry);
    if (list) list.push(t);
    else tile.set(geometry, [t]);
  }
  for (const variants of Object.values(models)) for (const g of variants) if (!used.has(g)) g.dispose();
  const out: ScatterTile[] = [];
  for (const [key, tile] of tiles) {
    const group = new Group();
    for (const [geometry, mine] of tile) group.add(scatterMesh(geometry, mine, hf));
    const i = Math.floor(key / 65536) - 32768;
    const j = (key % 65536) - 32768;
    out.push({
      group,
      x: (i + 0.5) * SCATTER_TILE,
      z: (j + 0.5) * SCATTER_TILE,
      radius: Math.hypot(SCATTER_TILE / 2, SCATTER_TILE / 2, SCATTER_TOP),
    });
  }
  return out;
}

/** One instanced mesh drawing `geometry` at every item. */
function scatterMesh(geometry: BufferGeometry, mine: readonly ScatterItem[], hf: Heightfield): InstancedMesh {
  const m = new Matrix4();
  const q = new Quaternion();
  const pos = new Vector3();
  const scale = new Vector3();
  const up = new Vector3(0, 1, 0);
  const tint = new Color();
  const mesh = new InstancedMesh(geometry, material, mine.length);
  mine.forEach((t, i) => {
    pos.set(t.x, baseHeight(hf, t) - SINK * t.scale, t.z);
    q.setFromAxisAngle(up, t.yaw);
    scale.setScalar(t.scale);
    m.compose(pos, q, scale);
    mesh.setMatrixAt(i, m);
    // A little light and shade from one to the next.
    const shade = 0.84 + 0.16 * ((t.tint * 7.3) % 1);
    mesh.setColorAt(i, tint.setRGB(shade, shade, shade));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/**
 * Height to stand a scatter item at: trees on the snow at their trunk; rocks
 * at the lowest snow under them, so on steep ground they sit into the slope
 * instead of hanging off it.
 */
function baseHeight(hf: Heightfield, t: ScatterItem): number {
  const y = drawnHeightAt(hf, t.x, t.z);
  if (t.kind !== 'rock' && t.kind !== 'boulder') return y;
  const r = (t.kind === 'rock' ? 0.8 : 1.1) * t.scale;
  return Math.min(
    y,
    drawnHeightAt(hf, t.x + r, t.z),
    drawnHeightAt(hf, t.x - r, t.z),
    drawnHeightAt(hf, t.x, t.z + r),
    drawnHeightAt(hf, t.x, t.z - r),
  );
}

/** Snow height under a spot, for sitting things on it. */
function ground(hf: Heightfield, p: XZ): number {
  return drawnHeightAt(hf, p.x, p.z);
}

function drawLine(line: LineDecor, hf: Heightfield, kits: TiledKit, cloths: TiledKit): void {
  const S = DECOR_SIZE;
  switch (line.kind) {
    case 'fence':
      postsAndPanels(line.points, hf, kits, 2.5, 0.12, S.fenceHeight, PALETTE.orange, PALETTE.orangeDark, 0.04);
      break;
    case 'netting':
      postsAndPanels(line.points, hf, kits, 4, 0.15, S.nettingHeight, PALETTE.net, PALETTE.netDark, 0.05);
      break;
    case 'barrier':
      postsAndPanels(line.points, hf, kits, 2.2, 0.05, S.barrierHeight, PALETTE.metal, PALETTE.metalDark, 0.04);
      break;
    case 'dyeLine':
      dyeLine(line.points, hf, kits);
      break;
    case 'bunting':
      bunting(line.points, hf, kits, cloths);
      break;
    case 'chairlift':
      chairlift(line.points, hf, kits);
      break;
  }
}

/** Posts along a line with a two-sided panel strung between each pair; the top band is a darker shade. */
function postsAndPanels(
  points: readonly XZ[],
  hf: Heightfield,
  kits: TiledKit,
  spacing: number,
  bottom: number,
  height: number,
  color: Color,
  band: Color,
  postRadius: number,
): void {
  const spots = alongLine(points, spacing);
  spots.forEach((p, i) => {
    const y = ground(hf, p);
    kits.near(p.x, p.z).at(p.x, y, p.z).prism(0, 0, -SINK, height + 0.08, postRadius, postRadius, 5, PALETTE.post);
    const next = spots[i + 1];
    if (!next) return;
    const y2 = ground(hf, next);
    const k = kits.near(p.x, p.z);
    const at = (q: XZ, h: number): Vector3 => new Vector3(q.x, h, q.z);
    const split = height - 0.15;
    k.panel(at(p, y + bottom), at(next, y2 + bottom), at(next, y2 + split), at(p, y + split), color);
    k.panel(at(p, y + split), at(next, y2 + split), at(next, y2 + height), at(p, y + height), band);
  });
}

/** A blue line dyed into the snow along a polyline. */
function dyeLine(points: readonly XZ[], hf: Heightfield, kits: TiledKit): void {
  const half = 0.15;
  const lift = 0.02;
  const spots = alongLine(points, 1);
  const up = new Vector3(0, 1, 0);
  for (let i = 1; i < spots.length; i++) {
    const a = spots[i - 1]!;
    const b = spots[i]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 1e-3) continue;
    const rx = (-(b.z - a.z) / len) * half;
    const rz = ((b.x - a.x) / len) * half;
    const v = (p: XZ, s: number): Vector3 => {
      const x = p.x + rx * s;
      const z = p.z + rz * s;
      return new Vector3(x, drawnHeightAt(hf, x, z) + lift, z);
    };
    kits.near(a.x, a.z).quad(v(a, -1), v(b, -1), v(b, 1), v(a, 1), PALETTE.dye, up);
  }
}

/** Poles with a sagging string of small colored pennants between each pair. */
function bunting(points: readonly XZ[], hf: Heightfield, kits: TiledKit, cloths: TiledKit): void {
  const top = 3.6;
  points.forEach((p, i) => {
    kits.near(p.x, p.z).at(p.x, ground(hf, p), p.z).prism(0, 0, -SINK, top + 0.1, 0.05, 0.04, 5, PALETTE.post);
    const next = points[i + 1];
    if (next) pennantString(kits.near(p.x, p.z), p, ground(hf, p) + top, next, ground(hf, next) + top, 0.6, cloths.near(p.x, p.z));
  });
}

/** A string from a to b (world heights ya, yb) sagging by `sag` in the middle, hung with pennants (into `cloth`, to flap). */
export function pennantString(k: MeshKit, a: XZ, ya: number, b: XZ, yb: number, sag: number, cloth: MeshKit): void {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.max(2, Math.round(len / 0.7));
  const at = (t: number): Vector3 =>
    new Vector3(a.x + (b.x - a.x) * t, ya + (yb - ya) * t - sag * 4 * t * (1 - t), a.z + (b.z - a.z) * t);
  for (let i = 0; i < n; i++) {
    const p0 = at(i / n);
    const p1 = at((i + 1) / n);
    k.beamWorld(p0, p1, 0.02, PALETTE.dark);
    const mid = at((i + 0.5) / n);
    const tip = mid.clone();
    tip.y -= 0.35;
    const color = FLAG_COLORS[i % FLAG_COLORS.length]!;
    cloth.panel(p0.clone().lerp(mid, 0.3), p1.clone().lerp(mid, 0.3), tip, tip, color, color, [0, 0, 0.9, 0.9]);
  }
}

/**
 * A chairlift's static parts: a station at each end (a roof on pillars),
 * towers along the line between, and a sagging cable each way. The chairs
 * and the turning bullwheels move (see render/chairlifts.ts).
 */
function chairlift(points: readonly XZ[], hf: Heightfield, kits: TiledKit): void {
  const S = DECOR_SIZE;
  const st = S.liftStation;
  const line = liftLine(points, hf);
  const spots = line.spots;
  const last = spots.length - 1;
  spots.forEach((p, i) => {
    // Facing along the line (either way round: the arm is the same), stations facing out along it.
    const next = spots[i + 1] ?? spots[i - 1] ?? p;
    const yaw = Math.atan2(-(next.x - p.x), -(next.z - p.z));
    if (i === 0 || i === last) {
      // Stations stand level on the lowest snow under them.
      let y = Infinity;
      for (const [du, dv] of [
        [-st.length / 2, -st.width / 2],
        [-st.length / 2, st.width / 2],
        [st.length / 2, -st.width / 2],
        [st.length / 2, st.width / 2],
        [0, 0],
      ] as const) {
        const x = p.x - Math.sin(yaw) * du + Math.cos(yaw) * dv;
        const z = p.z - Math.cos(yaw) * du - Math.sin(yaw) * dv;
        y = Math.min(y, renderedHeightAt(hf, x, z));
      }
      station(kits.near(p.x, p.z).at(p.x, y, p.z, yaw), ground(hf, p) - y);
      return;
    }
    const y = ground(hf, p);
    const k = kits.near(p.x, p.z).at(p.x, y, p.z, yaw);
    k.prism(0, 0, -0.3, S.chairliftHeight, 0.38, 0.26, 6, PALETTE.metal);
    k.box(0, S.chairliftHeight + 0.2, 0, CABLE_ARM * 2 + 0.6, 0.35, 0.5, PALETTE.metalDark);
    for (const x of [-CABLE_ARM, CABLE_ARM]) k.box(x, S.chairliftHeight - 0.05, 0, 0.3, 0.3, 1.4, PALETTE.post);
  });
  const p = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < last; i++) {
    const k = kits.near(spots[i]!.x, spots[i]!.z);
    for (const side of [-1, 1]) {
      const segs = 6;
      for (let s = 0; s < segs; s++) {
        cablePoint(line, i, s / segs, side, p);
        const a = new Vector3(p.x, p.y, p.z);
        cablePoint(line, i, (s + 1) / segs, side, p);
        k.beamWorld(a, new Vector3(p.x, p.y, p.z), 0.06, PALETTE.dark);
      }
    }
  }
}

/**
 * A lift station, in a kit placed level at its floor and facing along the
 * line (-Z): a concrete deck, pillars holding a snowy roof, the drive house
 * at the back and the bullwheel the cable turns around. `rise`: how far
 * the snow at its middle sits above the floor (it's dug in on a slope).
 */
function station(k: MeshKit, rise: number): void {
  const st = DECOR_SIZE.liftStation;
  const L = st.length;
  const W = st.width;
  const floor = 0.8 + rise;
  k.box(0, floor / 2 - 0.4, 0, W, floor + 0.8, L, PALETTE.metalDark);
  k.box(0, floor + 0.02, 0, W - 0.2, 0.06, L - 0.2, PALETTE.white);
  const roof = floor + st.height - 0.8;
  for (const x of [-W / 2 + 0.3, W / 2 - 0.3]) {
    for (const z of [-L / 2 + 0.4, 0, L / 2 - 0.4]) k.box(x, (floor + roof) / 2, z, 0.3, roof - floor, 0.3, PALETTE.post);
  }
  k.box(0, roof + 0.15, 0, W + 0.8, 0.3, L + 0.8, PALETTE.red);
  k.box(0, roof + 0.36, 0, W + 0.6, 0.14, L + 0.6, PALETTE.snow);
  // Drive house at the back end, with a window toward the line.
  k.box(0, floor + 1.4, L / 2 - 1.3, W - 1.4, 2.8, 2.2, PALETTE.red);
  k.box(0, floor + 1.7, L / 2 - 2.41, W - 2.6, 1, 0.04, PALETTE.dark);
  // The bullwheel's shaft down from the roof (the wheel itself turns: render/chairlifts.ts).
  k.prism(0, 0, roof - 1.2, roof - 0.15, 0.25, 0.25, 6, PALETTE.metalDark);
}
