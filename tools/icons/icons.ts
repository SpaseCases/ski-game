// The home-screen icons (2026-11-24, for installing the game on a phone):
// the favicon's mountain on its sky, drawn full bleed so a phone's rounded
// mask trims only sky, and written as PNGs (iOS takes no SVG icon). No
// image library: the shapes are filled with 4x4 supersampling and the PNG
// is encoded with node:zlib.
//
//   node tools/icons/icons.ts     writes public/icons/icon-180.png, -192 and -512

import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

type Rgb = [number, number, number];
type Shape = { color: Rgb; points: [number, number][] };

/** On a 32-unit square like public/favicon.svg, pulled in so a circle mask keeps the peaks. */
const SKY: Rgb = [0x9f, 0xc3, 0xe6];
const SHAPES: Shape[] = [
  { color: [0xf5, 0xf8, 0xfc], points: [[5, 24], [13.4, 9], [17.6, 15.7], [21, 11.5], [27, 24]] },
  { color: [0xc4, 0xd3, 0xe6], points: [[13.4, 9], [17.6, 15.7], [15.9, 24], [5, 24]] },
  { color: [0xf5, 0xf8, 0xfc], points: [[0, 24], [32, 24], [32, 32], [0, 32]] },
];
const SIZES = [180, 192, 512];
const SS = 4;

function inside(x: number, y: number, pts: [number, number][]): boolean {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]!;
    const [xj, yj] = pts[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function draw(size: number): Buffer {
  const rows = Buffer.alloc((size * 3 + 1) * size);
  for (let py = 0; py < size; py++) {
    rows[py * (size * 3 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      const sum = [0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = ((px + (sx + 0.5) / SS) / size) * 32;
          const y = ((py + (sy + 0.5) / SS) / size) * 32;
          let c = SKY;
          for (const s of SHAPES) if (inside(x, y, s.points)) c = s.color;
          sum[0] += c[0];
          sum[1] += c[1];
          sum[2] += c[2];
        }
      }
      const at = py * (size * 3 + 1) + 1 + px * 3;
      for (let k = 0; k < 3; k++) rows[at + k] = Math.round(sum[k]! / (SS * SS));
    }
  }
  return png(size, rows);
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size: number, rows: Buffer): Buffer {
  const head = Buffer.alloc(13);
  head.writeUInt32BE(size, 0);
  head.writeUInt32BE(size, 4);
  head[8] = 8; // bit depth
  head[9] = 2; // truecolor RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', head),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public/icons', { recursive: true });
for (const size of SIZES) writeFileSync(`public/icons/icon-${size}.png`, draw(size));
console.log(`wrote public/icons/icon-{${SIZES.join(',')}}.png`);
