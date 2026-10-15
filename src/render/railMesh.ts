import { BufferAttribute, BufferGeometry, Color, Group, Mesh, MeshLambertMaterial, Vector3 } from 'three';
import { CONFIG } from '../config.ts';
import type { Heightfield, RailShape } from '../maps/types.ts';
import { railFrame } from '../sim/rails.ts';
import { drawnHeightAt } from './terrainMesh.ts';
import { TriBuilder } from './triBuilder.ts';

// Rails and boxes, drawn from the slide lines the physics uses so the skis
// sit exactly on what you see. They're merged into one vertex-colored mesh
// per 64 m tile, so a long rail drops out of view past the fog.

const BOX_DECK = new Color('#9aa4ad');
const BOX_SIDE = new Color('#8a5a32');
const RAIL = new Color('#b4bec8');
const POST = new Color('#56606b');
/** Sides around a rail tube. With 6, one flat face is on top. */
const RAIL_SIDES = 6;
/** Most distance (m) between posts, and how far in from the ends the first and last stand. */
const POST_SPACING = 2.5;
const POST_INSET = 0.4;
/** How far (m) boxes and posts reach below the snow, so bumps in it never show a gap. */
const BURY = 0.25;
/** Size (m) of a tile of merged rail meshes. */
const TILE = 64;

const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });

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
  for (const r of rails) {
    if (r.kind === 'box') addBox(near, r, hf);
    else addRail(near, r, hf);
  }
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

/** A box: wooden sides down into the snow under a sliding deck along its top line. */
function addBox(near: Near, r: RailShape, hf: Heightfield): void {
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
    const below = (v: Vector3): Vector3 => new Vector3(v.x, drawnHeightAt(hf, v.x, v.z) - BURY, v.z);
    const aLb = below(aL);
    const aRb = below(aR);
    const eLb = below(eL);
    const eRb = below(eR);
    b.quad(aL, aR, eR, eL, BOX_DECK, UP);
    b.quad(aR, eR, eRb, aRb, BOX_SIDE, right);
    b.quad(aL, eL, eLb, aLb, BOX_SIDE, right.clone().negate());
    if (k === 0) b.quad(aL, aR, aRb, aLb, BOX_SIDE, along.clone().negate());
    if (k === segs - 1) b.quad(eL, eR, eRb, eLb, BOX_SIDE, along);
  }
}

/** A round rail: a tube under its top line, capped at both ends, on posts down to the snow. */
function addRail(near: Near, r: RailShape, hf: Heightfield): void {
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
      b.quad(a.clone().add(o0), a.clone().add(o1), e.clone().add(o1), e.clone().add(o0), RAIL, out);
    }
    if (k === 0) cap(b, a, ring, dir.clone().negate());
    if (k === segs - 1) cap(b, e, ring, dir);
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
    const corners = [
      along.clone().add(right),
      along.clone().sub(right),
      along.clone().negate().sub(right),
      along.clone().negate().add(right),
    ];
    for (let c = 0; c < 4; c++) {
      const c0 = corners[c]!;
      const c1 = corners[(c + 1) % 4]!;
      const at = (o: Vector3, y: number): Vector3 => new Vector3(pos.x + o.x, y, pos.z + o.z);
      b.quad(at(c0, top), at(c1, top), at(c1, bottom), at(c0, bottom), POST, c0.clone().add(c1));
    }
  }
}

/** Closes a tube end with a fan of triangles. */
function cap(b: TriBuilder, center: Vector3, ring: readonly Vector3[], out: Vector3): void {
  for (let i = 0; i < ring.length; i++) {
    const o0 = ring[i]!;
    const o1 = ring[(i + 1) % ring.length]!;
    b.tri(center, center.clone().add(o0), center.clone().add(o1), RAIL, out);
  }
}

function point(r: RailShape, k: number): Vector3 {
  return new Vector3(r.points[k * 3], r.points[k * 3 + 1], r.points[k * 3 + 2]);
}
