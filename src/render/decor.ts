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
import type { Heightfield, LineDecor, XZ } from '../maps/types.ts';
import type { DistanceCuller } from './culling.ts';
import { MeshKit, TiledKit } from './meshKit.ts';
import { drawProp, farScatterModels, FLAG_COLORS, PALETTE, scatterModels } from './models.ts';
import { drawnHeightAt } from './terrainMesh.ts';

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
/** Tallest scatter model (m), so a tile's reach covers its treetops. */
const SCATTER_TOP = 10;
/** How far (m) posts, trunks and rocks sink below the drawn snow so bumps never show a gap. */
const SINK = 0.15;

const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
/** Lamp faces ignore lighting, so they look lit. */
const glowMaterial = new MeshBasicMaterial({ vertexColors: true });
/** Lines dyed into the snow sit right on it; draw them on top. */
const decalMaterial = new MeshLambertMaterial({
  vertexColors: true,
  flatShading: true,
  polygonOffset: true,
  polygonOffsetFactor: -3,
  polygonOffsetUnits: -3,
});

/**
 * Draws the decoration; every tile goes to `culler` to be dropped when far
 * away. `farTrees`: also build simple far trees for long view ranges.
 */
export function createDecor(layout: DecorLayout, hf: Heightfield, culler: DistanceCuller, farTrees: boolean): Group {
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
  for (const line of layout.lines) drawLine(line, hf, line.kind === 'dyeLine' ? decals : kits);
  for (const p of layout.props) {
    const yaw = (p.heading * Math.PI) / 180;
    p.points.forEach((at, i) => {
      const color = p.color ? new Color(p.color) : FLAG_COLORS[i % FLAG_COLORS.length]!;
      const k = kits.near(at.x, at.z).at(at.x, drawnHeightAt(hf, at.x, at.z), at.z, yaw);
      drawProp(k, p.kind, color, glows.near(at.x, at.z));
    });
  }
  for (const [kit, mat] of [
    [kits, material],
    [decals, decalMaterial],
    [glows, glowMaterial],
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

function drawLine(line: LineDecor, hf: Heightfield, kits: TiledKit): void {
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
      bunting(line.points, hf, kits);
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
function bunting(points: readonly XZ[], hf: Heightfield, kits: TiledKit): void {
  const top = 3.6;
  points.forEach((p, i) => {
    kits.near(p.x, p.z).at(p.x, ground(hf, p), p.z).prism(0, 0, -SINK, top + 0.1, 0.05, 0.04, 5, PALETTE.post);
    const next = points[i + 1];
    if (next) pennantString(kits.near(p.x, p.z), p, ground(hf, p) + top, next, ground(hf, next) + top, 0.6);
  });
}

/** A string from a to b (world heights ya, yb) sagging by `sag` in the middle, hung with pennants. */
export function pennantString(k: MeshKit, a: XZ, ya: number, b: XZ, yb: number, sag: number): void {
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
    k.panel(p0.clone().lerp(mid, 0.3), p1.clone().lerp(mid, 0.3), tip, tip, FLAG_COLORS[i % FLAG_COLORS.length]!);
  }
}

/** A chairlift: towers along the line, a sagging cable each way, and chairs hanging off them. */
function chairlift(points: readonly XZ[], hf: Heightfield, kits: TiledKit): void {
  const S = DECOR_SIZE;
  const towers = alongLine(points, S.chairliftSpacing);
  const arm = 2.2;
  towers.forEach((p, i) => {
    // Facing along the line (either way round: the arm is the same).
    const next = towers[i + 1] ?? towers[i - 1] ?? p;
    const yaw = Math.atan2(-(next.x - p.x), -(next.z - p.z));
    const y = ground(hf, p);
    const k = kits.near(p.x, p.z).at(p.x, y, p.z, yaw);
    k.prism(0, 0, -0.3, S.chairliftHeight, 0.38, 0.26, 6, PALETTE.metal);
    k.box(0, S.chairliftHeight + 0.2, 0, arm * 2 + 0.6, 0.35, 0.5, PALETTE.metalDark);
    for (const x of [-arm, arm]) k.box(x, S.chairliftHeight - 0.05, 0, 0.3, 0.3, 1.4, PALETTE.post);
  });
  for (let i = 1; i < towers.length; i++) {
    const a = towers[i - 1]!;
    const b = towers[i]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const rx = -(b.z - a.z) / len;
    const rz = (b.x - a.x) / len;
    const ya = ground(hf, a) + S.chairliftHeight - 0.2;
    const yb = ground(hf, b) + S.chairliftHeight - 0.2;
    for (const side of [-1, 1]) {
      const k = kits.near(a.x, a.z);
      const cable = (t: number): Vector3 =>
        new Vector3(a.x + (b.x - a.x) * t + rx * arm * side, ya + (yb - ya) * t - 1.2 * 4 * t * (1 - t), a.z + (b.z - a.z) * t + rz * arm * side);
      const segs = 6;
      for (let s = 0; s < segs; s++) k.beamWorld(cable(s / segs), cable((s + 1) / segs), 0.06, PALETTE.dark);
      // Two chairs per span on each cable.
      for (const t of side < 0 ? [0.3, 0.75] : [0.15, 0.6]) {
        const top = cable(t);
        const seat = top.clone();
        seat.y -= 1.9;
        k.beamWorld(top, seat, 0.05, PALETTE.post);
        const yaw = Math.atan2(-(b.x - a.x), -(b.z - a.z));
        k.at(seat.x, seat.y, seat.z, yaw);
        k.box(0, 0, 0, 1.6, 0.1, 0.55, PALETTE.post);
        k.box(0, 0.35, 0.3, 1.6, 0.6, 0.08, PALETTE.post);
      }
    }
  }
}
