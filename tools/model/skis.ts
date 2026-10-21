// Every ski and graphic: triangles per ski (the 3D model the game builds;
// with a pair graphic, left / right), and optionally a PNG of each graphic
// seen from above, tip to the right, painted cell by cell as the model
// paints its faces: the pair's top sheets (left ski on top), then their
// bases. From the repo root:
//   node tools/model/skis.ts [out.png]

import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { drawSki, SKI_TYPES } from '../../src/core/skis.ts';
import { buildSkiGeometry } from '../../src/render/skiModel.ts';

const out = process.argv[2];

for (const type of SKI_TYPES) {
  const counts = type.graphics.map((g) => {
    const tris = ([-1, 1] as const).map((side) => {
      const geo = buildSkiGeometry(type.model, g, side);
      const n = geo.getAttribute('position').count / 3;
      geo.dispose();
      return n;
    });
    return `${g.name} ${g.pair ? tris.join(' / ') : tris[0]}`;
  });
  const { rows, cols } = type.model;
  console.log(`${type.name} (${rows} x ${cols} grid): triangles per ski: ${counts.join(', ')}`);
}

if (out) {
  const PX = 300; // pixels per meter
  const pad = 14;
  const longest = Math.max(...SKI_TYPES.map((t) => t.model.length));
  const widest = Math.max(...SKI_TYPES.flatMap((t) => t.model.width.map(([, hw]) => hw)));
  const skiH = Math.ceil(2 * widest * PX) + 2;
  const laneH = skiH * 2 + 4 + 12;
  const colW = Math.ceil(longest * PX) + pad;
  const W = pad + colW * 2;
  const H = pad + SKI_TYPES.reduce((n, t) => n + t.graphics.length, 0) * laneH + pad;
  const rgb = new Uint8Array(W * H * 3).fill(232);
  let y0 = pad;
  for (const type of SKI_TYPES) {
    for (const g of type.graphics) {
      for (const [k, base] of [
        [0, false],
        [1, true],
      ] as const) {
        for (const [r, side] of [
          [0, -1],
          [1, 1],
        ] as const) {
          const mid = y0 + r * (skiH + 4) + skiH / 2;
          drawSki(type, g, side, base, PX, mid, (x, y, hex) => {
            const i = (y * W + pad + k * colW + x) * 3;
            rgb[i] = parseInt(hex.slice(1, 3), 16);
            rgb[i + 1] = parseInt(hex.slice(3, 5), 16);
            rgb[i + 2] = parseInt(hex.slice(5, 7), 16);
          });
        }
      }
      y0 += laneH;
    }
  }
  writeFileSync(out, png(W, H, rgb));
  console.log(`wrote ${out}`);
}

function png(W: number, H: number, rgb: Uint8Array): Buffer {
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) Buffer.from(rgb.buffer, y * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1);
  const table = Array.from({ length: 256 }, (_, n) => {
    let k = n;
    for (let b = 0; b < 8; b++) k = k & 1 ? 0xedb88320 ^ (k >>> 1) : k >>> 1;
    return k >>> 0;
  });
  const crc = (b: Buffer): number => {
    let k = 0xffffffff;
    for (const v of b) k = table[(k ^ v) & 0xff]! ^ (k >>> 8);
    return (k ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
