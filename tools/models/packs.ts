// Converts the free CC0 model packs the City uses (milestone 16, city on a
// hill) into src/render/propModels.json: per model, flat-colored triangles
// (positions quantized to 16 bits, one sRGB color per triangle), colors
// baked from each pack's palette texture or material colors, faces that
// point up turned to snow (everything in the City is snowed in). The game
// draws them through its own merged tiles: no model loader, no textures.
//
// The raw packs stay out of git (reference/ is ignored). Put them in:
//   reference/packs/kaykit/KayKit_City_Builder_Bits_1.0_FREE.zip  (Kay Lousberg, kaylousberg.itch.io/city-builder-bits, CC0)
//   reference/packs/quaternius/Modular Street Pack by Quaternius.zip  (Quaternius, quaternius.itch.io/lowpoly-modular-street, CC0)
// then, from the repo root:
//   node tools/models/packs.ts
//
// Every model comes out in its own meters: x across, y up from its base,
// z along its length (a car's nose toward -z), centered on x and z. Each
// keeps its pack's proportions; the renderer stretches a model to the
// feature it stands for (a car to its box's length, width and roof).

import { readFileSync, writeFileSync } from 'node:fs';
import { inflateRawSync, inflateSync } from 'node:zlib';

// ---------------------------------------------------------------- zips
/** The files in a zip, by name (stored or deflated entries only, which is all these packs use). */
function readZip(path: string): Map<string, Buffer> {
  const buf = readFileSync(path);
  // The end of central directory record: its signature, searched for from the end.
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error(`${path}: not a zip`);
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error(`${path}: bad central directory`);
    const method = buf.readUInt16LE(at + 10);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    at += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataAt, dataAt + size);
    files.set(name, method === 0 ? Buffer.from(raw) : method === 8 ? inflateRawSync(raw) : Buffer.alloc(0));
  }
  return files;
}

// ---------------------------------------------------------------- png
/** RGBA pixels of an 8-bit, non-interlaced PNG (color type 2 or 6). */
function readPng(buf: Buffer): { width: number; height: number; rgba: Uint8Array } {
  let at = 8;
  let width = 0;
  let height = 0;
  let type = 0;
  const idat: Buffer[] = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at);
    const kind = buf.toString('ascii', at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + len);
    if (kind === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error('png: only 8-bit, non-interlaced');
      type = data[9]!;
    } else if (kind === 'IDAT') idat.push(data);
    at += 12 + len;
  }
  const channels = type === 6 ? 4 : type === 2 ? 3 : 0;
  if (!channels) throw new Error(`png: color type ${type}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    for (let i = 0; i < stride; i++) {
      const x = raw[y * (stride + 1) + 1 + i]!;
      const a = i >= channels ? cur[i - channels]! : 0;
      const b = prev[i]!;
      const c = i >= channels ? prev[i - channels]! : 0;
      let v = x;
      if (filter === 1) v = x + a;
      else if (filter === 2) v = x + b;
      else if (filter === 3) v = x + ((a + b) >> 1);
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      cur[i] = v & 255;
    }
    for (let px = 0; px < width; px++) {
      for (let k = 0; k < 3; k++) out[(y * width + px) * 4 + k] = cur[px * channels + k]!;
      out[(y * width + px) * 4 + 3] = channels === 4 ? cur[px * channels + 3]! : 255;
    }
    prev.set(cur);
  }
  return { width, height, rgba: out };
}

// ---------------------------------------------------------------- triangles
interface Tri {
  p: [number, number, number][];
  color: [number, number, number];
}

type Mat = number[];
const IDENT: Mat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a: Mat, b: Mat): Mat {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r]! * b[c * 4 + k]!;
  return o;
}
function trs(n: { translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[] }): Mat {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  return [
    (1 - 2 * (y! * y! + z! * z!)) * sx!, 2 * (x! * y! + z! * w!) * sx!, 2 * (x! * z! - y! * w!) * sx!, 0,
    2 * (x! * y! - z! * w!) * sy!, (1 - 2 * (x! * x! + z! * z!)) * sy!, 2 * (y! * z! + x! * w!) * sy!, 0,
    2 * (x! * z! + y! * w!) * sz!, 2 * (y! * z! - x! * w!) * sz!, (1 - 2 * (x! * x! + y! * y!)) * sz!, 0,
    tx!, ty!, tz!, 1,
  ];
}
const apply = (m: Mat, p: number[]): [number, number, number] => [
  m[0]! * p[0]! + m[4]! * p[1]! + m[8]! * p[2]! + m[12]!,
  m[1]! * p[0]! + m[5]! * p[1]! + m[9]! * p[2]! + m[13]!,
  m[2]! * p[0]! + m[6]! * p[1]! + m[10]! * p[2]! + m[14]!,
];

/** A glTF model's triangles, colored from its palette texture (sampled at each triangle's middle). `skip` drops nodes by name. */
function gltfTris(files: Map<string, Buffer>, dir: string, name: string, skip: RegExp | null): Tri[] {
  const g = JSON.parse(files.get(`${dir}/${name}.gltf`)!.toString('utf8'));
  const bin = files.get(`${dir}/${g.buffers[0].uri}`)!;
  const tex = readPng(files.get(`${dir}/${g.images[0].uri}`)!);
  const acc = (i: number): { data: Float32Array | Uint16Array | Uint32Array; size: number } => {
    const a = g.accessors[i];
    const v = g.bufferViews[a.bufferView];
    const size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type as 'SCALAR']!;
    const off = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const n = a.count * size;
    const slice = bin.buffer.slice(bin.byteOffset + off, bin.byteOffset + off + n * (a.componentType === 5123 ? 2 : 4));
    const data = a.componentType === 5126 ? new Float32Array(slice) : a.componentType === 5123 ? new Uint16Array(slice) : new Uint32Array(slice);
    return { data, size };
  };
  const out: Tri[] = [];
  const visit = (ni: number, parent: Mat): void => {
    const n = g.nodes[ni];
    if (skip && skip.test(n.name ?? '')) return;
    const m = mul(parent, trs(n));
    if (n.mesh !== undefined) {
      for (const prim of g.meshes[n.mesh].primitives) {
        const pos = acc(prim.attributes.POSITION);
        const uv = acc(prim.attributes.TEXCOORD_0);
        const idx = prim.indices !== undefined ? acc(prim.indices).data : null;
        const count = idx ? idx.length : pos.data.length / 3;
        for (let t = 0; t < count; t += 3) {
          const ids = [0, 1, 2].map((k) => (idx ? idx[t + k]! : t + k));
          const p = ids.map((i) => apply(m, [pos.data[i * 3]!, pos.data[i * 3 + 1]!, pos.data[i * 3 + 2]!]));
          const u = ids.reduce((s, i) => s + uv.data[i * 2]!, 0) / 3;
          const v = ids.reduce((s, i) => s + uv.data[i * 2 + 1]!, 0) / 3;
          const px = Math.min(tex.width - 1, Math.max(0, Math.floor(u * tex.width)));
          const py = Math.min(tex.height - 1, Math.max(0, Math.floor(v * tex.height)));
          const k = (py * tex.width + px) * 4;
          out.push({ p, color: [tex.rgba[k]!, tex.rgba[k + 1]!, tex.rgba[k + 2]!] });
        }
      }
    }
    for (const c of n.children ?? []) visit(c, m);
  };
  for (const ni of g.scenes[g.scene ?? 0].nodes) visit(ni, IDENT);
  return out;
}

/** An OBJ model's triangles, colored by its materials' diffuse colors. */
function objTris(files: Map<string, Buffer>, path: string): Tri[] {
  const text = files.get(`${path}.obj`)!.toString('utf8');
  const mtl = files.get(`${path}.mtl`)!.toString('utf8');
  const colors = new Map<string, [number, number, number]>();
  let cur = '';
  for (const line of mtl.split(/\r?\n/)) {
    const [k, ...rest] = line.trim().split(/\s+/);
    if (k === 'newmtl') cur = rest.join(' ');
    // Diffuse colors are linear in Blender's export: back to sRGB.
    if (k === 'Kd') colors.set(cur, rest.slice(0, 3).map((v) => Math.round(255 * Math.pow(Math.min(1, Number(v)), 1 / 2.2))) as [number, number, number]);
  }
  const verts: number[][] = [];
  const out: Tri[] = [];
  let color: [number, number, number] = [200, 200, 200];
  for (const line of text.split(/\r?\n/)) {
    const [k, ...rest] = line.trim().split(/\s+/);
    if (k === 'v') verts.push(rest.slice(0, 3).map(Number));
    else if (k === 'usemtl') color = colors.get(rest.join(' ')) ?? color;
    else if (k === 'f') {
      const ids = rest.map((s) => Number(s.split('/')[0]) - 1);
      for (let i = 1; i + 1 < ids.length; i++) {
        out.push({ p: [ids[0]!, ids[i]!, ids[i + 1]!].map((j) => verts[j]! as [number, number, number]), color });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- the models
interface Source {
  /** Name the game knows it by. */
  id: string;
  tris: () => Tri[];
  /** Real size: the longest of length (z) or height (y) in meters, to scale the pack's units. */
  size: { axis: 'y' | 'z'; meters: number };
  /** Turn it so its length runs along z (degrees about y). */
  turn?: number;
  /** Up-facing faces become snow (cos of the steepest that counts as up), or none. */
  snow?: number;
}
const KAY = 'reference/packs/kaykit/KayKit_City_Builder_Bits_1.0_FREE.zip';
const QUAT = 'reference/packs/quaternius/Modular Street Pack by Quaternius.zip';
const kay = readZip(KAY);
const quat = readZip(QUAT);
const KDIR = 'KayKit_City_Builder_Bits_1.0_FREE/Assets/gltf';
// Wheels are buried in the snow: left out (each is a quarter of a car's triangles).
const WHEELS = /wheel/i;
const SOURCES: Source[] = [
  { id: 'carSedan', tris: () => gltfTris(kay, KDIR, 'car_sedan', WHEELS), size: { axis: 'z', meters: 4.3 }, snow: 0.55 },
  { id: 'carHatchback', tris: () => gltfTris(kay, KDIR, 'car_hatchback', WHEELS), size: { axis: 'z', meters: 4.3 }, snow: 0.55 },
  { id: 'carWagon', tris: () => gltfTris(kay, KDIR, 'car_stationwagon', WHEELS), size: { axis: 'z', meters: 4.3 }, snow: 0.55 },
  { id: 'carTaxi', tris: () => gltfTris(kay, KDIR, 'car_taxi', WHEELS), size: { axis: 'z', meters: 4.3 }, snow: 0.55 },
  { id: 'carPolice', tris: () => gltfTris(kay, KDIR, 'car_police', WHEELS), size: { axis: 'z', meters: 4.3 }, snow: 0.55 },
  { id: 'bench', tris: () => gltfTris(kay, KDIR, 'bench', null), size: { axis: 'z', meters: 2.4 }, turn: 90, snow: 0.7 },
  { id: 'hydrant', tris: () => gltfTris(kay, KDIR, 'firehydrant', null), size: { axis: 'y', meters: 0.8 }, snow: 0.7 },
  { id: 'trash', tris: () => gltfTris(kay, KDIR, 'trash_A', null), size: { axis: 'y', meters: 0.5 }, snow: 0.7 },
  { id: 'trashBin', tris: () => gltfTris(kay, KDIR, 'trash_B', null), size: { axis: 'y', meters: 1.0 }, snow: 0.7 },
  { id: 'dumpster', tris: () => gltfTris(kay, KDIR, 'dumpster', null), size: { axis: 'z', meters: 2.2 }, turn: 90, snow: 0.6 },
  { id: 'waterTower', tris: () => gltfTris(kay, KDIR, 'watertower', null), size: { axis: 'y', meters: 7 }, snow: 0.75 },
  { id: 'streetlight', tris: () => gltfTris(kay, KDIR, 'streetlight', null), size: { axis: 'y', meters: 6.5 }, snow: 0.8 },
  { id: 'trafficLight', tris: () => gltfTris(kay, KDIR, 'trafficlight_A', null), size: { axis: 'y', meters: 5.5 }, snow: 0.8 },
  { id: 'stopSign', tris: () => objTris(quat, 'OBJ/Sign_Stop'), size: { axis: 'y', meters: 2.6 }, snow: 0.8 },
  { id: 'noParking', tris: () => objTris(quat, 'OBJ/Sign_NoParking'), size: { axis: 'y', meters: 2.6 }, snow: 0.8 },
  { id: 'yieldSign', tris: () => objTris(quat, 'OBJ/Sign_Triangle'), size: { axis: 'y', meters: 2.6 }, snow: 0.8 },
  { id: 'signalPole', tris: () => objTris(quat, 'OBJ/TrafficLight'), size: { axis: 'y', meters: 5.5 }, snow: 0.8 },
];

const SNOW: [number, number, number] = [241, 245, 250];

const models: Record<string, unknown> = {};
let total = 0;
for (const src of SOURCES) {
  let tris = src.tris();
  // Turn so the length runs along z.
  if (src.turn) {
    const a = (src.turn * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    tris = tris.map((t) => ({ ...t, p: t.p.map(([x, y, z]) => [x * c + z * s, y, -x * s + z * c] as [number, number, number]) }));
  }
  // Base on y = 0, centered on x and z, scaled to meters.
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (const p of t.p) for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k]!, p[k]!);
    max[k] = Math.max(max[k]!, p[k]!);
  }
  const k = src.size.meters / (src.size.axis === 'y' ? max[1]! - min[1]! : max[2]! - min[2]!);
  const cx = (min[0]! + max[0]!) / 2;
  const cz = (min[2]! + max[2]!) / 2;
  const pts = tris.map((t) => t.p.map(([x, y, z]) => [(x - cx) * k, (y - min[1]!) * k, (z - cz) * k]));
  const size = [(max[0]! - min[0]!) * k, (max[1]! - min[1]!) * k, (max[2]! - min[2]!) * k];
  // Quantize: each axis over its own extent.
  const q = new Int16Array(tris.length * 9);
  const cols = new Uint8Array(tris.length * 3);
  pts.forEach((p, i) => {
    for (let v = 0; v < 3; v++) {
      q[i * 9 + v * 3] = Math.round((p[v]![0]! / (size[0]! / 2 || 1)) * 32767);
      q[i * 9 + v * 3 + 1] = Math.round((p[v]![1]! / (size[1]! || 1)) * 32767);
      q[i * 9 + v * 3 + 2] = Math.round((p[v]![2]! / (size[2]! / 2 || 1)) * 32767);
    }
    // Faces that point up are under snow.
    const [a, b, c] = p as number[][];
    const ux = b![0]! - a![0]!, uy = b![1]! - a![1]!, uz = b![2]! - a![2]!;
    const vx = c![0]! - a![0]!, vy = c![1]! - a![1]!, vz = c![2]! - a![2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const up = ny / (Math.hypot(nx, ny, nz) || 1);
    cols.set(src.snow !== undefined && up > src.snow ? SNOW : tris[i]!.color, i * 3);
  });
  models[src.id] = { size: size.map((v) => Math.round(v * 1000) / 1000), pos: Buffer.from(q.buffer).toString('base64'), col: Buffer.from(cols).toString('base64') };
  total += tris.length;
  console.log(`${src.id}: ${tris.length} triangles, ${size.map((v) => v.toFixed(2)).join(' x ')} m`);
}
const json = JSON.stringify({ models });
writeFileSync('src/render/propModels.json', `${json}\n`);
console.log(`wrote src/render/propModels.json: ${SOURCES.length} models, ${total} triangles, ${(json.length / 1024).toFixed(0)} kB`);
