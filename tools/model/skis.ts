// Every ski and graphic: triangles per ski (the 3D model the game builds),
// and optionally a PNG of each top sheet seen from above, tip to the right,
// painted cell by cell as the model paints its faces. From the repo root:
//   node tools/model/skis.ts [out.png]

import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { Color } from 'three';
import { aspectOf, graphicColor, halfWidthAt, SKI_TYPES } from '../../src/core/skis.ts';
import { buildSkiGeometry } from '../../src/render/skiModel.ts';

const out = process.argv[2];

for (const type of SKI_TYPES) {
  const counts = type.graphics.map((g) => {
    const geo = buildSkiGeometry(type.model, g);
    const tris = geo.getAttribute('position').count / 3;
    geo.dispose();
    return `${g.name} ${tris}`;
  });
  const { rows, cols } = type.model;
  console.log(`${type.name} (${rows} x ${cols} grid): triangles per ski: ${counts.join(', ')}`);
}

if (out) {
  const PX = 420; // pixels per meter
  const pad = 16;
  const longest = Math.max(...SKI_TYPES.map((t) => t.model.length));
  const W = Math.ceil(longest * PX) + pad * 2;
  const laneH = 70;
  const H = pad + SKI_TYPES.reduce((n, t) => n + t.graphics.length, 0) * laneH + pad;
  const rgb = new Uint8Array(W * H * 3).fill(232);
  const c = new Color();
  let y0 = pad;
  for (const type of SKI_TYPES) {
    const m = type.model;
    const half = m.length / 2;
    const aspect = aspectOf(m);
    for (const g of type.graphics) {
      const mid = y0 + laneH / 2;
      for (let px = 0; px < Math.round(m.length * PX); px++) {
        const along = -half + (px + 0.5) / PX;
        const row = Math.min(m.rows - 1, Math.floor(((along + half) / m.length) * m.rows));
        const u = ((row + 0.5) / m.rows) * 2 - 1;
        const hw = halfWidthAt(m, along) * PX;
        for (let py = Math.ceil(mid - hw); py < mid + hw; py++) {
          // Seen from above with the tip to the right, the ski's left edge is at the top.
          const col = Math.min(m.cols - 1, Math.floor(((py + 0.5 - (mid - hw)) / (2 * hw)) * m.cols));
          const v = -1 + (2 * col + 1) / m.cols;
          c.set(graphicColor(g, u, v, aspect)).convertLinearToSRGB();
          const i = (py * W + pad + px) * 3;
          rgb[i] = c.r * 255;
          rgb[i + 1] = c.g * 255;
          rgb[i + 2] = c.b * 255;
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
