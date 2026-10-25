import { BufferAttribute, BufferGeometry, Color, Group, Mesh, MeshLambertMaterial, Vector3 } from 'three';
import { CONFIG } from '../config.ts';
import { hash2 } from '../maps/terrain.ts';
import type { Heightfield, RailShape } from '../maps/types.ts';
import { railFrame } from '../sim/rails.ts';
import { drawnHeightAt } from './terrainMesh.ts';
import { TriBuilder } from './triBuilder.ts';
import { litByPools } from './lightPools.ts';

// Rails and boxes, drawn from the slide lines the physics uses so the skis
// sit exactly on what you see. They're merged into one vertex-colored mesh
// per 64 m tile, so a long rail drops out of view past the fog. Each has its
// look: park rails and handrails on posts, fat tubes on saddles, fallen logs
// lying on the snow, park boxes, concrete ledges, benches, flat-topped rocks
// and stumps, and bonk features: picnic tables, rows of barrels and cable spools.

const BOX_DECK = new Color('#9aa4ad');
const BOX_SIDE = new Color('#8a5a32');
const RAIL = new Color('#b4bec8');
const POST = new Color('#56606b');
const HANDRAIL = new Color('#2f4a3c');
const HANDRAIL_POST = new Color('#26372e');
const TUBE = new Color('#e0a526');
const TUBE_BAND = new Color('#2b3138');
const BARK = new Color('#5a4232');
const BARK_DARK = new Color('#47342a');
const LOG_END = new Color('#c9a273');
const SNOW = new Color('#f1f5fa');
const LEDGE_TOP = new Color('#b9bdc1');
const LEDGE_SIDE = new Color('#8e9398');
const BENCH = new Color('#a87443');
const BENCH_DARK = new Color('#7a4f2c');
const BENCH_LEG = new Color('#2c333b');
const ROCK = new Color('#7d848c');
const ROCK_DARK = new Color('#666d75');
const STUMP_TOP = new Color('#c49a6c');
const TABLE = new Color('#b07a46');
const TABLE_DARK = new Color('#8a5c33');
const BARREL_COLORS = [new Color('#2f62d0'), new Color('#d8342c'), new Color('#e0a526'), new Color('#3a9d5d')];
const BARREL_RIM = new Color('#2b3138');
const SPOOL = new Color('#c08a52');
const SPOOL_DARK = new Color('#8f6236');
/** Sides around a barrel and around a spool's flanges. */
const BARREL_SIDES = 10;
const SPOOL_SIDES = 14;
/** Sides around a rail tube, and around a fat tube. With 6, one flat face is on top. */
const RAIL_SIDES = 6;
const TUBE_SIDES = 12;
/** A fat tube's saddles: how far apart, and their size along and across it (m). */
const SADDLE_SPACING = 3;
const SADDLE_LENGTH = 0.25;
/** Length (m) of the dark band at each end of a fat tube. */
const TUBE_BAND_LENGTH = 0.5;
/** Sides around a log, and around a stump. */
const LOG_SIDES = 8;
const STUMP_SIDES = 9;
/** Most distance (m) between posts, and how far in from the ends the first and last stand. */
const POST_SPACING = 2.5;
const POST_INSET = 0.4;
/** How far (m) boxes and posts reach below the snow, so bumps in it never show a gap. */
const BURY = 0.25;
/** Size (m) of a tile of merged rail meshes. */
const TILE = 64;

const material = litByPools(new MeshLambertMaterial({ vertexColors: true, flatShading: true }));

export function createRailMesh(rails: readonly RailShape[], hf: Heightfield): Group {
  const tiles = new Map<string, TriBuilder>();
  const near: Near = (x, z) => {
    const key = `${Math.floor(x / TILE)},${Math.floor(z / TILE)}`;
    let b = tiles.get(key);
    if (!b) {
      b = new TriBuilder();
      tiles.set(key, b);
    }
    return b;
  };
  rails.forEach((r, i) => {
    switch (r.look) {
      case 'metal':
        addRail(near, r, hf, RAIL, POST);
        break;
      case 'handrail':
        addRail(near, r, hf, HANDRAIL, HANDRAIL_POST);
        break;
      case 'tube':
        addTube(near, r, hf);
        break;
      case 'log':
        addLog(near, r, i);
        break;
      case 'wood':
        addBox(near, r, hf, BOX_DECK, BOX_SIDE, 0);
        break;
      case 'ledge':
        addBox(near, r, hf, LEDGE_TOP, LEDGE_SIDE, 0);
        break;
      case 'rock':
        addBox(near, r, hf, SNOW, ROCK, 0.35);
        break;
      case 'bench':
        addBench(near, r, hf);
        break;
      case 'stump':
        addStump(near, r, hf);
        break;
      case 'table':
        addTable(near, r, hf);
        break;
      case 'barrels':
        addBarrels(near, r);
        break;
      case 'spool':
        addSpool(near, r, hf);
        break;
    }
  });
  const group = new Group();
  for (const b of tiles.values()) {
    // No normals: flat shading works them out per face on the GPU.
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(b.positions), 3));
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(b.colors), 3));
    geometry.computeBoundingSphere();
    const mesh = new Mesh(geometry, material);
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
  return group;
}

/** The triangle builder for the tile holding world (x, z). */
type Near = (x: number, z: number) => TriBuilder;

const UP = new Vector3(0, 1, 0);

/**
 * A box: sides down into the snow under a deck along its top line. `flare`
 * widens the sides toward the bottom (a rock's rough flanks).
 */
function addBox(near: Near, r: RailShape, hf: Heightfield, deck: Color, side: Color, flare: number): void {
  const segs = r.dist.length - 1;
  const w = r.halfWidth;
  for (let k = 0; k < segs; k++) {
    const a = point(r, k);
    const e = point(r, k + 1);
    const b = near(a.x, a.z);
    const along = new Vector3(e.x - a.x, 0, e.z - a.z).normalize();
    const right = new Vector3(-along.z, 0, along.x);
    const aL = a.clone().addScaledVector(right, -w);
    const aR = a.clone().addScaledVector(right, w);
    const eL = e.clone().addScaledVector(right, -w);
    const eR = e.clone().addScaledVector(right, w);
    const below = (v: Vector3, out: number, ahead: number): Vector3 => {
      const p = v.clone().addScaledVector(right, out).addScaledVector(along, ahead);
      return new Vector3(p.x, drawnHeightAt(hf, p.x, p.z) - BURY, p.z);
    };
    const back = k === 0 ? -flare : 0;
    const fore = k === segs - 1 ? flare : 0;
    const aLb = below(aL, -flare, back);
    const aRb = below(aR, flare, back);
    const eLb = below(eL, -flare, fore);
    const eRb = below(eR, flare, fore);
    b.quad(aL, aR, eR, eL, deck, UP);
    const rockShade = flare > 0 && hash2(k, 3, 17) > 0 ? ROCK_DARK : side;
    b.quad(aR, eR, eRb, aRb, side, right);
    b.quad(aL, eL, eLb, aLb, rockShade, right.clone().negate());
    if (k === 0) b.quad(aL, aR, aRb, aLb, side, along.clone().negate());
    if (k === segs - 1) b.quad(eL, eR, eRb, eLb, rockShade, along);
  }
}

/** A round rail: a tube under its top line, capped at both ends, on posts down to the snow. */
function addRail(near: Near, r: RailShape, hf: Heightfield, tube: Color, postColor: Color): void {
  const radius = r.halfWidth;
  const segs = r.dist.length - 1;
  const ring = Array.from({ length: RAIL_SIDES }, () => new Vector3());
  for (let k = 0; k < segs; k++) {
    const a = point(r, k);
    const e = point(r, k + 1);
    const b = near(a.x, a.z);
    const dir = e.clone().sub(a).normalize();
    // Overlap the tubes a little at a kink so the joint has no gap.
    if (k > 0) a.addScaledVector(dir, -radius);
    if (k < segs - 1) e.addScaledVector(dir, radius);
    a.y -= radius;
    e.y -= radius;
    const side = new Vector3().crossVectors(dir, UP).normalize();
    const up = new Vector3().crossVectors(side, dir);
    for (let i = 0; i < RAIL_SIDES; i++) {
      const t = (i / RAIL_SIDES) * Math.PI * 2;
      ring[i]!.copy(side).multiplyScalar(Math.cos(t) * radius).addScaledVector(up, Math.sin(t) * radius);
    }
    for (let i = 0; i < RAIL_SIDES; i++) {
      const o0 = ring[i]!;
      const o1 = ring[(i + 1) % RAIL_SIDES]!;
      const out = o0.clone().add(o1);
      b.quad(a.clone().add(o0), a.clone().add(o1), e.clone().add(o1), e.clone().add(o0), tube, out);
    }
    if (k === 0) cap(b, a, ring, dir.clone().negate(), tube);
    if (k === segs - 1) cap(b, e, ring, dir, tube);
  }

  // Posts, evenly spaced, from under the tube down into the snow.
  const span = r.length - 2 * POST_INSET;
  const count = span > 0 ? Math.ceil(span / POST_SPACING) + 1 : 1;
  const pos = new Vector3();
  const dir = new Vector3();
  const half = CONFIG.render.railPostWidth / 2;
  for (let i = 0; i < count; i++) {
    const s = count === 1 ? r.length / 2 : POST_INSET + (span * i) / (count - 1);
    railFrame(r, s, pos, dir);
    const top = pos.y - 2 * radius;
    const bottom = drawnHeightAt(hf, pos.x, pos.z) - BURY;
    if (top - bottom < 0.05) continue;
    const b = near(pos.x, pos.z);
    const along = new Vector3(dir.x, 0, dir.z).normalize().multiplyScalar(half);
    const right = new Vector3(-along.z, 0, along.x);
    const corners = [along.clone().add(right), along.clone().sub(right), along.clone().negate().sub(right), along.clone().negate().add(right)];
    for (let c = 0; c < 4; c++) {
      const c0 = corners[c]!;
      const c1 = corners[(c + 1) % 4]!;
      const at = (o: Vector3, y: number): Vector3 => new Vector3(pos.x + o.x, y, pos.z + o.z);
      b.quad(at(c0, top), at(c1, top), at(c1, bottom), at(c0, bottom), postColor, c0.clone().add(c1));
    }
  }
}

/**
 * A fat tube: a painted pipe under its top line with a dark band at each
 * end, capped, on low saddles down to the snow wherever it stands above it.
 */
function addTube(near: Near, r: RailShape, hf: Heightfield): void {
  const radius = r.halfWidth;
  // Pieces along the tube: at each of its points, at the edges of the dark end bands, and every 2 m between.
  const cuts = [...r.dist, TUBE_BAND_LENGTH, r.length - TUBE_BAND_LENGTH].filter((v) => v >= 0 && v <= r.length).sort((m, n) => m - n);
  const at: number[] = [];
  for (let i = 0; i < cuts.length; i++) {
    const s = cuts[i]!;
    if (at.length > 0 && s - at[at.length - 1]! < 0.05) continue;
    const prev = at.length > 0 ? at[at.length - 1]! : s;
    const n = Math.ceil((s - prev) / 2);
    for (let k = 1; k < n; k++) at.push(prev + ((s - prev) * k) / n);
    at.push(s);
  }
  const ring = Array.from({ length: TUBE_SIDES }, () => new Vector3());
  const a = new Vector3();
  const e = new Vector3();
  const dir = new Vector3();
  for (let k = 0; k < at.length - 1; k++) {
    const s0 = at[k]!;
    const s1 = at[k + 1]!;
    railFrame(r, s0, a, dir);
    railFrame(r, s1, e, dir);
    const b = near(a.x, a.z);
    dir.subVectors(e, a).normalize();
    // Overlap the pieces a little where the tube bends, so a joint has no gap.
    if (k > 0) a.addScaledVector(dir, -radius * 0.3);
    if (k < at.length - 2) e.addScaledVector(dir, radius * 0.3);
    a.y -= radius;
    e.y -= radius;
    const side = new Vector3().crossVectors(dir, UP).normalize();
    const up = new Vector3().crossVectors(side, dir);
    for (let i = 0; i < TUBE_SIDES; i++) {
      const t = (i / TUBE_SIDES) * Math.PI * 2;
      ring[i]!.copy(side).multiplyScalar(Math.cos(t) * radius).addScaledVector(up, Math.sin(t) * radius);
    }
    const band = s1 <= TUBE_BAND_LENGTH + 1e-3 || s0 >= r.length - TUBE_BAND_LENGTH - 1e-3;
    for (let i = 0; i < TUBE_SIDES; i++) {
      const o0 = ring[i]!;
      const o1 = ring[(i + 1) % TUBE_SIDES]!;
      b.quad(a.clone().add(o0), a.clone().add(o1), e.clone().add(o1), e.clone().add(o0), band ? TUBE_BAND : TUBE, o0.clone().add(o1));
    }
    if (k === 0) cap(b, a, ring, dir.clone().negate(), TUBE_BAND);
    if (k === at.length - 2) cap(b, e, ring, dir, TUBE_BAND);
  }
  // Saddles: a short dark block under the tube down into the snow, wherever there's a gap to fill.
  const count = Math.max(2, Math.ceil(r.length / SADDLE_SPACING) + 1);
  const pos = new Vector3();
  for (let i = 0; i < count; i++) {
    const s = 0.5 + ((r.length - 1) * i) / (count - 1);
    railFrame(r, s, pos, dir);
    const top = pos.y - 1.4 * radius;
    const bottom = drawnHeightAt(hf, pos.x, pos.z) - BURY;
    if (top - bottom < 0.05) continue;
    const along = new Vector3(dir.x, 0, dir.z).normalize().multiplyScalar(SADDLE_LENGTH / 2);
    const right = new Vector3(-along.z, 0, along.x).normalize().multiplyScalar(radius * 0.9);
    const b = near(pos.x, pos.z);
    const corners = [along.clone().add(right), along.clone().sub(right), along.clone().negate().sub(right), along.clone().negate().add(right)];
    for (let c = 0; c < 4; c++) {
      const c0 = corners[c]!;
      const c1 = corners[(c + 1) % 4]!;
      const at = (o: Vector3, y: number): Vector3 => new Vector3(pos.x + o.x, y, pos.z + o.z);
      b.quad(at(c0, top), at(c1, top), at(c1, bottom), at(c0, bottom), TUBE_BAND, c0.clone().add(c1));
    }
  }
}

/**
 * A fallen tree: a faceted trunk hanging under its top line (with snow
 * along the top, where the skis slide), broken branch stubs, a cut end at
 * the tip and the torn-up root plate at the last point.
 */
function addLog(near: Near, r: RailShape, seed: number): void {
  const radius = r.halfWidth;
  const segs = r.dist.length - 1;
  const ring = Array.from({ length: LOG_SIDES }, () => new Vector3());
  const first = point(r, 0);
  const last = point(r, segs);
  const axis = last.clone().sub(first).normalize();
  const side = new Vector3().crossVectors(axis, UP).normalize();
  const up = new Vector3().crossVectors(side, axis);
  // One face straight up, so the snow strip sits where the skis ride.
  for (let i = 0; i < LOG_SIDES; i++) {
    const t = Math.PI / 2 + (i / LOG_SIDES) * Math.PI * 2 + Math.PI / LOG_SIDES;
    ring[i]!.copy(side).multiplyScalar(Math.cos(t) * radius).addScaledVector(up, Math.sin(t) * radius);
  }
  for (let k = 0; k < segs; k++) {
    const a = point(r, k);
    const e = point(r, k + 1);
    const b = near(a.x, a.z);
    a.addScaledVector(up, -radius);
    e.addScaledVector(up, -radius);
    for (let i = 0; i < LOG_SIDES; i++) {
      const o0 = ring[i]!;
      const o1 = ring[(i + 1) % LOG_SIDES]!;
      const out = o0.clone().add(o1);
      const top = out.y > radius * 1.2;
      const color = top ? SNOW : (i + k) % 3 === 0 ? BARK_DARK : BARK;
      b.quad(a.clone().add(o0), a.clone().add(o1), e.clone().add(o1), e.clone().add(o0), color, out);
    }
    if (k === 0) cap(b, a, ring, axis.clone().negate(), LOG_END);
  }
  const end = last.clone().addScaledVector(up, -radius);
  const b = near(end.x, end.z);
  // The root plate: a ragged disc of roots and earth standing up at the end.
  const plate = radius * 2.6;
  const spokes = 9;
  const rim: Vector3[] = [];
  for (let i = 0; i < spokes; i++) {
    const t = (i / spokes) * Math.PI * 2;
    const rr = plate * (0.75 + 0.25 * hash2(i, seed, 41));
    rim.push(end.clone().addScaledVector(side, Math.cos(t) * rr).addScaledVector(up, Math.sin(t) * rr).addScaledVector(axis, 0.15));
  }
  for (let i = 0; i < spokes; i++) {
    const p0 = rim[i]!;
    const p1 = rim[(i + 1) % spokes]!;
    const color = p0.y + p1.y > 2 * end.y + plate ? SNOW : i % 2 === 0 ? BARK_DARK : BARK;
    b.tri(end.clone().addScaledVector(axis, 0.3), p0, p1, color, axis);
    b.tri(end.clone().addScaledVector(axis, -0.05), p0, p1, BARK_DARK, axis.clone().negate());
  }
  // Branch stubs along the sides.
  const n = Math.max(2, Math.floor(r.length / 2.2));
  const pos = new Vector3();
  const dir = new Vector3();
  for (let i = 1; i < n; i++) {
    const s = (r.length * i) / n + 0.3 * hash2(i, seed, 7);
    railFrame(r, s, pos, dir);
    const out = hash2(i, seed, 3) > 0 ? 1 : -1;
    const base = pos.clone().addScaledVector(up, -radius * 0.9).addScaledVector(side, out * radius * 0.8);
    const tip = base.clone().addScaledVector(side, out * (0.5 + 0.4 * (0.5 + 0.5 * hash2(i, seed, 5)))).addScaledVector(up, -0.15).addScaledVector(axis, 0.25);
    beam(near(pos.x, pos.z), base, tip, 0.09, BARK_DARK);
  }
}

/** A bench: a slatted seat along its top line on dark legs. */
function addBench(near: Near, r: RailShape, hf: Heightfield): void {
  const segs = r.dist.length - 1;
  const w = r.halfWidth;
  const thick = 0.08;
  for (let k = 0; k < segs; k++) {
    const a = point(r, k);
    const e = point(r, k + 1);
    const b = near(a.x, a.z);
    const along = new Vector3(e.x - a.x, 0, e.z - a.z).normalize();
    const right = new Vector3(-along.z, 0, along.x);
    // Three slats across the seat, with dark gaps between.
    const slats = 3;
    for (let i = 0; i < slats; i++) {
      const v0 = -w + (2 * w * i) / slats + 0.02;
      const v1 = -w + (2 * w * (i + 1)) / slats - 0.02;
      const p = (q: Vector3, v: number, y = 0): Vector3 => q.clone().addScaledVector(right, v).setY(q.y + y);
      const color = i % 2 === 0 ? BENCH : BENCH_DARK;
      b.quad(p(a, v0), p(a, v1), p(e, v1), p(e, v0), color, UP);
      b.quad(p(a, v1), p(e, v1), p(e, v1, -thick), p(a, v1, -thick), BENCH_DARK, right);
      b.quad(p(a, v0), p(e, v0), p(e, v0, -thick), p(a, v0, -thick), BENCH_DARK, right.clone().negate());
    }
  }
  // Legs: a frame at each end and every 1.5 m between.
  const n = Math.max(1, Math.round(r.length / 1.5));
  const pos = new Vector3();
  const dir = new Vector3();
  for (let i = 0; i <= n; i++) {
    railFrame(r, Math.min(r.length - 0.1, Math.max(0.1, (r.length * i) / n)), pos, dir);
    const right = new Vector3(-dir.z, 0, dir.x).normalize();
    for (const v of [-w + 0.06, w - 0.06]) {
      const top = pos.clone().addScaledVector(right, v);
      top.y -= thick;
      const foot = top.clone();
      foot.y = drawnHeightAt(hf, foot.x, foot.z) - BURY;
      beam(near(pos.x, pos.z), foot, top, 0.06, BENCH_LEG);
    }
  }
}

/** A tree stump: a faceted cylinder from the snow up to the top line's middle, cut flat with rings, capped with snow. */
function addStump(near: Near, r: RailShape, hf: Heightfield): void {
  const pos = new Vector3();
  const dir = new Vector3();
  railFrame(r, r.length / 2, pos, dir);
  const b = near(pos.x, pos.z);
  const radius = Math.max(r.halfWidth, r.length / 2);
  const ground = drawnHeightAt(hf, pos.x, pos.z) - BURY;
  const ring: Vector3[] = [];
  for (let i = 0; i < STUMP_SIDES; i++) {
    const t = (i / STUMP_SIDES) * Math.PI * 2;
    ring.push(new Vector3(Math.cos(t) * radius, 0, Math.sin(t) * radius));
  }
  const center = pos.clone();
  for (let i = 0; i < STUMP_SIDES; i++) {
    const o0 = ring[i]!;
    const o1 = ring[(i + 1) % STUMP_SIDES]!;
    const flare = 1.18;
    const top0 = center.clone().add(o0);
    const top1 = center.clone().add(o1);
    const bot0 = center.clone().addScaledVector(o0, flare).setY(ground);
    const bot1 = center.clone().addScaledVector(o1, flare).setY(ground);
    b.quad(top0, top1, bot1, bot0, i % 2 === 0 ? BARK : BARK_DARK, o0.clone().add(o1));
    // The cut top: wood with a snow cap in the middle.
    const mid0 = center.clone().addScaledVector(o0, 0.55);
    const mid1 = center.clone().addScaledVector(o1, 0.55);
    b.quad(mid0, mid1, top1, top0, STUMP_TOP, UP);
    b.tri(center.clone().setY(center.y + 0.04), mid0, mid1, SNOW, UP);
  }
}

/**
 * A picnic table: a planked top along its line, a bench seat each side a
 * little lower, and an A-frame of legs at each end.
 */
function addTable(near: Near, r: RailShape, hf: Heightfield): void {
  const w = r.halfWidth;
  const thick = 0.07;
  const segs = r.dist.length - 1;
  for (let k = 0; k < segs; k++) {
    const a = point(r, k);
    const e = point(r, k + 1);
    const b = near(a.x, a.z);
    const along = new Vector3(e.x - a.x, 0, e.z - a.z).normalize();
    const right = new Vector3(-along.z, 0, along.x);
    const p = (q: Vector3, v: number, y = 0): Vector3 => q.clone().addScaledVector(right, v).setY(q.y + y);
    // The top: four planks along it.
    const planks = 4;
    for (let i = 0; i < planks; i++) {
      const v0 = -w + (2 * w * i) / planks + 0.015;
      const v1 = -w + (2 * w * (i + 1)) / planks - 0.015;
      b.quad(p(a, v0), p(a, v1), p(e, v1), p(e, v0), i % 2 === 0 ? TABLE : TABLE_DARK, UP);
    }
    b.quad(p(a, w), p(e, w), p(e, w, -thick), p(a, w, -thick), TABLE_DARK, right);
    b.quad(p(a, -w), p(e, -w), p(e, -w, -thick), p(a, -w, -thick), TABLE_DARK, right.clone().negate());
    if (k === 0) b.quad(p(a, -w), p(a, w), p(a, w, -thick), p(a, -w, -thick), TABLE_DARK, along.clone().negate());
    if (k === segs - 1) b.quad(p(e, -w), p(e, w), p(e, w, -thick), p(e, -w, -thick), TABLE_DARK, along);
    // A bench seat each side, 0.3 m lower and 0.35 m out.
    for (const side of [-1, 1]) {
      const v0 = side * (w + 0.2);
      const v1 = side * (w + 0.5);
      const [lo, hi] = side < 0 ? [v1, v0] : [v0, v1];
      b.quad(p(a, lo, -0.3), p(a, hi, -0.3), p(e, hi, -0.3), p(e, lo, -0.3), TABLE, UP);
      b.quad(p(a, v1, -0.3), p(e, v1, -0.3), p(e, v1, -0.3 - thick), p(a, v1, -0.3 - thick), TABLE_DARK, right.clone().multiplyScalar(side));
    }
  }
  // A-frame legs near each end, from the snow out wide up under the top.
  const pos = new Vector3();
  const dir = new Vector3();
  for (const s of [0.25, r.length - 0.25]) {
    railFrame(r, Math.min(r.length, Math.max(0, s)), pos, dir);
    const right = new Vector3(-dir.z, 0, dir.x).normalize();
    for (const side of [-1, 1]) {
      const foot = pos.clone().addScaledVector(right, side * (w + 0.55));
      foot.y = drawnHeightAt(hf, foot.x, foot.z) - BURY;
      const top = pos.clone().addScaledVector(right, side * w * 0.3);
      top.y -= 0.07;
      beam(near(pos.x, pos.z), foot, top, 0.07, TABLE_DARK);
    }
  }
}

/** A row of steel barrels lying across the line, their tops along it, rims at each end. */
function addBarrels(near: Near, r: RailShape): void {
  const w = r.halfWidth;
  const diameter = 0.6;
  const radius = diameter / 2;
  const n = Math.max(1, Math.round(r.length / (diameter + 0.02)));
  const pos = new Vector3();
  const dir = new Vector3();
  const ring = Array.from({ length: BARREL_SIDES }, () => new Vector3());
  for (let i = 0; i < n; i++) {
    railFrame(r, ((i + 0.5) * r.length) / n, pos, dir);
    const b = near(pos.x, pos.z);
    const along = new Vector3(dir.x, 0, dir.z).normalize();
    const right = new Vector3(-along.z, 0, along.x);
    const center = pos.clone();
    center.y -= radius;
    for (let k = 0; k < BARREL_SIDES; k++) {
      const t = (k / BARREL_SIDES) * Math.PI * 2;
      ring[k]!.copy(along).multiplyScalar(Math.cos(t) * radius).addScaledVector(UP, Math.sin(t) * radius);
    }
    const color = BARREL_COLORS[i % BARREL_COLORS.length]!;
    const l = center.clone().addScaledVector(right, -w);
    const rr = center.clone().addScaledVector(right, w);
    // Body, with a dark rim band at each end.
    const bands = [-w, -w + 0.06, w - 0.06, w];
    for (let j = 0; j < 3; j++) {
      const c0 = center.clone().addScaledVector(right, bands[j]!);
      const c1 = center.clone().addScaledVector(right, bands[j + 1]!);
      for (let k = 0; k < BARREL_SIDES; k++) {
        const o0 = ring[k]!;
        const o1 = ring[(k + 1) % BARREL_SIDES]!;
        b.quad(c0.clone().add(o0), c0.clone().add(o1), c1.clone().add(o1), c1.clone().add(o0), j === 1 ? color : BARREL_RIM, o0.clone().add(o1));
      }
    }
    cap(b, l, ring, right.clone().negate(), BARREL_RIM);
    cap(b, rr, ring, right, BARREL_RIM);
  }
}

/** A cable spool standing on end: a round wooden top and bottom flange joined by a narrower core. */
function addSpool(near: Near, r: RailShape, hf: Heightfield): void {
  const pos = new Vector3();
  const dir = new Vector3();
  railFrame(r, r.length / 2, pos, dir);
  const b = near(pos.x, pos.z);
  const radius = Math.max(r.halfWidth, r.length / 2);
  const ground = drawnHeightAt(hf, pos.x, pos.z) - BURY;
  const flange = 0.08;
  const rim = (rad: number): Vector3[] =>
    Array.from({ length: SPOOL_SIDES }, (_, i) => new Vector3(Math.cos((i / SPOOL_SIDES) * Math.PI * 2) * rad, 0, Math.sin((i / SPOOL_SIDES) * Math.PI * 2) * rad));
  const outer = rim(radius);
  const core = rim(radius * 0.45);
  const at = (o: Vector3, y: number): Vector3 => new Vector3(pos.x + o.x, y, pos.z + o.z);
  const top = pos.y;
  const bottomTop = ground + BURY + flange;
  for (let i = 0; i < SPOOL_SIDES; i++) {
    const o0 = outer[i]!;
    const o1 = outer[(i + 1) % SPOOL_SIDES]!;
    const c0 = core[i]!;
    const c1 = core[(i + 1) % SPOOL_SIDES]!;
    const out = o0.clone().add(o1);
    // Top flange: its face (with a ring of darker wood) and its edge.
    b.tri(at(new Vector3(), top), at(c1, top), at(c0, top), SPOOL, UP);
    b.quad(at(c0, top), at(c1, top), at(o1, top), at(o0, top), i % 2 === 0 ? SPOOL : SPOOL_DARK, UP);
    b.quad(at(o0, top), at(o1, top), at(o1, top - flange), at(o0, top - flange), SPOOL_DARK, out);
    // The core, down to the bottom flange, and that flange's edge.
    b.quad(at(c0, top - flange), at(c1, top - flange), at(c1, bottomTop), at(c0, bottomTop), SPOOL_DARK, c0.clone().add(c1));
    b.quad(at(c0, bottomTop), at(c1, bottomTop), at(o1, bottomTop), at(o0, bottomTop), SPOOL, UP);
    b.quad(at(o0, bottomTop), at(o1, bottomTop), at(o1, ground), at(o0, ground), SPOOL_DARK, out);
  }
}

/** Closes a tube end with a fan of triangles. */
function cap(b: TriBuilder, center: Vector3, ring: readonly Vector3[], out: Vector3, color: Color): void {
  for (let i = 0; i < ring.length; i++) {
    const o0 = ring[i]!;
    const o1 = ring[(i + 1) % ring.length]!;
    b.tri(center, center.clone().add(o0), center.clone().add(o1), color, out);
  }
}

/** A square beam `w` thick between two world points. */
function beam(b: TriBuilder, a: Vector3, e: Vector3, w: number, color: Color): void {
  const dir = new Vector3().subVectors(e, a);
  if (dir.lengthSq() < 1e-8) return;
  dir.normalize();
  const side = new Vector3().crossVectors(dir, Math.abs(dir.y) > 0.9 ? new Vector3(1, 0, 0) : UP).normalize().multiplyScalar(w / 2);
  const up = new Vector3().crossVectors(side, dir).normalize().multiplyScalar(w / 2);
  const offs = [side.clone().add(up), side.clone().sub(up), side.clone().negate().sub(up), side.clone().negate().add(up)];
  for (let i = 0; i < 4; i++) {
    const o0 = offs[i]!;
    const o1 = offs[(i + 1) % 4]!;
    b.quad(a.clone().add(o0), a.clone().add(o1), e.clone().add(o1), e.clone().add(o0), color, o0.clone().add(o1));
  }
  b.quad(e.clone().add(offs[0]!), e.clone().add(offs[1]!), e.clone().add(offs[2]!), e.clone().add(offs[3]!), color, dir);
}

function point(r: RailShape, k: number): Vector3 {
  return new Vector3(r.points[k * 3], r.points[k * 3 + 1], r.points[k * 3 + 2]);
}
