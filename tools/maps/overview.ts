// Draws a map from above as a PNG: shaded snow, rock where it's steep,
// contour lines, trees and boulders, the play area's edge, finishes, flags
// and runs. For checking a layout without opening the game.
//   node tools/maps/overview.ts <map.json> <out.png> [m per pixel, default 4] [x0 z0 x1 z1]
// The optional box (world meters) draws just part of the map.

import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { buildMap } from '../../src/maps/build.ts';
import { parseMap } from '../../src/maps/loader.ts';
import { heightAt } from '../../src/sim/terrain.ts';

const [file, out, scaleArg, ...box] = process.argv.slice(2);
if (!file || !out) throw new Error('Usage: node tools/maps/overview.ts <map.json> <out.png> [m per pixel] [x0 z0 x1 z1]');
const scale = Number(scaleArg ?? 4);
const built = buildMap(parseMap(JSON.parse(readFileSync(file, 'utf8'))));
const { hf, map, decor } = built;
const span = (n: number): number => (n - 1) * hf.cellSize;
const [x0, z0, x1, z1] =
  box.length === 4 ? box.map(Number) : [hf.originX, hf.originZ, hf.originX + span(hf.cols), hf.originZ + span(hf.rows)];
const W = Math.round((x1! - x0!) / scale);
const H = Math.round((z1! - z0!) / scale);
const rgb = new Uint8Array(W * H * 3);
// +X right, -Z up (north up).
const toPx = (x: number, z: number): [number, number] => [Math.round((x - x0!) / scale), Math.round((z - z0!) / scale)];
const DEG = Math.PI / 180;
const rock = hf.rock;

// Shaded relief, lit from the northwest.
const light = { x: -0.5, y: 0.7, z: -0.5 };
const ll = Math.hypot(light.x, light.y, light.z);
for (let py = 0; py < H; py++) {
  for (let px = 0; px < W; px++) {
    const x = x0! + (px + 0.5) * scale;
    const z = z0! + (py + 0.5) * scale;
    const e = 1.5;
    const hx = (heightAt(hf, x + e, z) - heightAt(hf, x - e, z)) / (2 * e);
    const hz = (heightAt(hf, x, z + e) - heightAt(hf, x, z - e)) / (2 * e);
    const len = Math.hypot(hx, 1, hz);
    const shade = Math.max(0, (-hx * light.x + light.y - hz * light.z) / (len * ll));
    const slope = Math.atan(Math.hypot(hx, hz)) / DEG;
    const col = Math.min(hf.cols - 1, Math.max(0, Math.round((x - hf.originX) / hf.cellSize)));
    const row = Math.min(hf.rows - 1, Math.max(0, Math.round((z - hf.originZ) / hf.cellSize)));
    const rocky = (rock?.[row * hf.cols + col] ?? 0) > 127;
    // Rock gray; steeper than 30° tinted a little blue, like a piste map's blacks.
    const c: [number, number, number] = rocky ? [120, 112, 108] : slope > 30 ? [190, 205, 235] : [240, 245, 252];
    const k = 0.45 + 0.65 * shade;
    const h = heightAt(hf, x, z);
    const contour = Math.abs(((h + 1000) % 50) - 25) > 24.2 ? 0.8 : 1;
    const i = (py * W + px) * 3;
    rgb[i] = Math.min(255, c[0] * k * contour);
    rgb[i + 1] = Math.min(255, c[1] * k * contour);
    rgb[i + 2] = Math.min(255, c[2] * k * contour);
  }
}

function dot(x: number, z: number, r: number, c: [number, number, number]): void {
  const [cx, cy] = toPx(x, z);
  const rp = Math.max(0, Math.round(r / scale));
  for (let dy = -rp; dy <= rp; dy++) {
    for (let dx = -rp; dx <= rp; dx++) {
      if (dx * dx + dy * dy > rp * rp + 0.5) continue;
      const px = cx + dx;
      const py = cy + dy;
      if (px < 0 || py < 0 || px >= W || py >= H) continue;
      const i = (py * W + px) * 3;
      rgb[i] = c[0];
      rgb[i + 1] = c[1];
      rgb[i + 2] = c[2];
    }
  }
}
function line(ax: number, az: number, bx: number, bz: number, c: [number, number, number], width = 1): void {
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / (scale * 0.5)));
  for (let k = 0; k <= n; k++) dot(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n, ((width - 1) * scale) / 2, c);
}

for (const t of decor.scatter) {
  const color: [number, number, number] =
    t.kind === 'pine'
      ? t.solid
        ? [40, 92, 58]
        : [90, 130, 100]
      : t.kind === 'aspen'
        ? [205, 160, 70]
        : t.kind === 'snag'
          ? [130, 110, 90]
          : t.kind === 'boulder'
            ? [70, 70, 75]
            : [100, 96, 92];
  dot(t.x, t.z, t.kind === 'pine' || t.kind === 'aspen' ? 1.5 : 0.5, color);
}
// Fences and netting, then the features: dyed lips blue, rails dark, boxes brown, and light towers yellow.
for (const l of decor.lines) {
  if (l.kind !== 'fence' && l.kind !== 'netting' && l.kind !== 'barrier') continue;
  for (let i = 1; i < l.points.length; i++) line(l.points[i - 1]!.x, l.points[i - 1]!.z, l.points[i]!.x, l.points[i]!.z, [255, 140, 40], 1);
}
for (const s of hf.shapes ?? []) {
  if (s.kind !== 'ramp') continue;
  for (const lip of s.lips) {
    const half = s.halfWidth;
    line(s.x + s.dirX * lip - s.rightX * half, s.z + s.dirZ * lip - s.rightZ * half, s.x + s.dirX * lip + s.rightX * half, s.z + s.dirZ * lip + s.rightZ * half, [40, 100, 230], 2);
  }
}
for (const r of built.course.rails) {
  const c: [number, number, number] = r.kind === 'box' ? [150, 95, 50] : [60, 66, 74];
  for (let k = 1; k < r.dist.length; k++) {
    line(r.points[(k - 1) * 3]!, r.points[(k - 1) * 3 + 2]!, r.points[k * 3]!, r.points[k * 3 + 2]!, c, r.kind === 'box' ? 2 : 1);
  }
}
for (const p of decor.props) {
  if (p.kind !== 'floodlight' && p.kind !== 'lightPole') continue;
  for (const at of p.points) dot(at.x, at.z, 1.2, [240, 200, 30]);
}
const poly = hf.bounds.polygon;
for (let i = 0; i < poly.length / 2; i++) {
  const j = (i + 1) % (poly.length / 2);
  line(poly[i * 2]!, poly[i * 2 + 1]!, poly[j * 2]!, poly[j * 2 + 1]!, [220, 40, 40], 2);
}
const RUN_COLORS: [number, number, number][] = [
  [230, 120, 20],
  [40, 110, 230],
  [150, 60, 200],
  [20, 160, 160],
  [200, 40, 120],
];
map.runs.forEach((r, k) => {
  for (let i = 1; i < r.points.length; i++) {
    const a = r.points[i - 1]!;
    const b = r.points[i]!;
    line(a.x, a.z, b.x, b.z, RUN_COLORS[k % RUN_COLORS.length]!, 2);
  }
});
for (const f of map.finishes) {
  const h = f.heading * DEG;
  const dx = -Math.sin(h);
  const dz = -Math.cos(h);
  const rx = Math.cos(h);
  const rz = -Math.sin(h);
  const c = (a: number, s: number): [number, number] => [f.x + dx * a + rx * s, f.z + dz * a + rz * s];
  const corners = [c(0, -f.width / 2), c(0, f.width / 2), c(f.length, f.width / 2), c(f.length, -f.width / 2)];
  for (let i = 0; i < 4; i++) {
    const a = corners[i]!;
    const b = corners[(i + 1) % 4]!;
    line(a[0], a[1], b[0], b[1], i === 0 ? [20, 20, 20] : [60, 60, 200], i === 0 ? 3 : 1);
  }
}
for (const f of map.flags) {
  const h = f.heading * DEG;
  const rx = Math.cos(h) * (f.width / 2);
  const rz = -Math.sin(h) * (f.width / 2);
  line(f.x - rx, f.z - rz, f.x + rx, f.z + rz, [255, 120, 20], 3);
}
dot(map.spawn.x, map.spawn.z, 6 * scale, [220, 30, 30]);

// PNG: 8-bit RGB, no filtering, one zlib stream.
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 3 + 1)] = 0;
  Buffer.from(rgb.buffer, y * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1);
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b: Buffer): number => {
  let c = 0xffffffff;
  for (const v of b) c = crcTable[(c ^ v) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer): Buffer => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 2;
writeFileSync(
  out,
  Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]),
);
const solid = decor.scatter.filter((t) => t.solid).length;
console.log(`wrote ${out} (${W}×${H}); ${decor.scatter.length} scatter items, ${solid} solid`);
