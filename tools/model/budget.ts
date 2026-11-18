// Skier draw calls and triangles: every headwear, every pattern on both
// garments, each ski, and the poles off, against the rig's budget (17 draw
// calls, about 9,000 triangles). The worst outfit is the one to watch.
//   node tools/model/budget.ts

import { readFileSync } from 'node:fs';
import { Mesh, type BufferGeometry } from 'three';
import { DEFAULT_OUTFIT, HEADWEAR, PATTERNS, type Outfit } from '../../src/core/outfit.ts';
import { BOARD_TYPES } from '../../src/core/boards.ts';
import { boardGear, customFace, customId } from '../../src/core/customSkis.ts';
import { SKI_TYPES } from '../../src/core/skis.ts';
import { SkierRig } from '../../src/render/skierRig.ts';
import { setWearArt, wearOffsets, wearPanels, wearSize } from '../../src/render/wearPanels.ts';

function count(o: Outfit, board = false): { calls: number; tris: number } {
  const rig = new SkierRig(o);
  if (board) rig.setBoard(true);
  let calls = 0;
  let tris = 0;
  rig.root.traverseVisible((m) => {
    if (!(m instanceof Mesh)) return;
    const g = m.geometry as BufferGeometry;
    const n = g.index ? g.index.count : (g.getAttribute('position')?.count ?? 0);
    if (n === 0) return;
    calls++;
    tris += n / 3;
  });
  rig.dispose();
  return { calls, tris };
}

const line = (name: string, o: Outfit): { calls: number; tris: number } => {
  const c = count(o);
  console.log(`${name.padEnd(28)} ${String(c.calls).padStart(2)} draw calls, ${String(c.tris).padStart(5)} triangles`);
  return c;
};

for (const { id } of HEADWEAR) line(`headwear ${id}`, { ...DEFAULT_OUTFIT, headwear: id });
for (const { id } of PATTERNS) line(`pattern ${id} (both)`, { ...DEFAULT_OUTFIT, jacketPattern: id, pantsPattern: id });
for (const t of SKI_TYPES) line(`ski ${t.id}`, { ...DEFAULT_OUTFIT, ski: t.id, skiGraphic: t.graphics[0]!.id });
line('poles off', { ...DEFAULT_OUTFIT, poles: false });

let worst = { name: '', tris: 0 };
let calls = 0;
for (const { id: headwear } of HEADWEAR) {
  for (const { id: pattern } of PATTERNS) {
    for (const t of SKI_TYPES) {
      const c = count({ ...DEFAULT_OUTFIT, headwear, jacketPattern: pattern, pantsPattern: pattern, ski: t.id, skiGraphic: t.graphics[0]!.id });
      calls = Math.max(calls, c.calls);
      if (c.tris > worst.tris) worst = { name: `${headwear}, ${pattern}, ${t.id} ski`, tris: c.tris };
    }
  }
}
console.log(`most draw calls: ${calls}; most triangles: ${worst.tris} (${worst.name})`);

// The snowboard rider (milestone 22): poles off, ski boots swapped for
// snowboard boots in bindings, one board. Last, so the lines above stay the same.
let boardWorst = { name: '', tris: 0 };
let boardCalls = 0;
for (const { id: headwear } of HEADWEAR) {
  for (const { id: pattern } of PATTERNS) {
    const c = count({ ...DEFAULT_OUTFIT, headwear, jacketPattern: pattern, pantsPattern: pattern }, true);
    boardCalls = Math.max(boardCalls, c.calls);
    if (c.tris > boardWorst.tris) boardWorst = { name: `${headwear}, ${pattern}`, tris: c.tris };
  }
}
const b = count(DEFAULT_OUTFIT, true);
console.log(`snowboard (default look)     ${String(b.calls).padStart(2)} draw calls, ${String(b.tris).padStart(5)} triangles`);
console.log(`snowboard: most draw calls: ${boardCalls}; most triangles: ${boardWorst.tris} (${boardWorst.name})`);

// Each board type in each of its graphics (milestone 22 part 2), in the
// default look, then that board with the worst outfit. Last again.
for (const t of BOARD_TYPES) {
  for (const g of t.graphics) {
    const c = count({ ...DEFAULT_OUTFIT, board: t.id, boardGraphic: g.id }, true);
    console.log(`board ${t.id}: ${g.name.padEnd(16)} ${String(c.calls).padStart(2)} draw calls, ${String(c.tris).padStart(5)} triangles`);
  }
}
let typeWorst = { name: '', tris: 0, calls: 0 };
for (const t of BOARD_TYPES) {
  for (const g of t.graphics) {
    const c = count({ ...DEFAULT_OUTFIT, headwear: 'hood', jacketPattern: 'plaid', pantsPattern: 'plaid', board: t.id, boardGraphic: g.id }, true);
    if (c.tris > typeWorst.tris) typeWorst = { name: `hood, plaid, ${t.id} board, ${g.name}`, tris: c.tris, calls: c.calls };
  }
}
console.log(`every board: most triangles: ${typeWorst.tris} (${typeWorst.name}), ${typeWorst.calls} draw calls`);

// A custom board (milestone 23) at its worst: the top and the base painted
// as a checkerboard, so no two cells in a row share a color and every cell
// is its own face. On each board type, in the default look and with the
// worst outfit. Last again, so every line above stays the same.
for (const t of BOARD_TYPES) {
  const gear = boardGear(t.id);
  for (const face of ['top', 'base'] as const) {
    const { rows, cols, cells } = customFace(gear, 0, face);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells[r * cols + c] = (r + c) % 2 === 0 ? 0 : 5;
  }
  const o = { ...DEFAULT_OUTFIT, board: t.id, boardGraphic: customId(gear, 0) };
  const c = count(o, true);
  const w = count({ ...o, headwear: 'hood', jacketPattern: 'plaid', pantsPattern: 'plaid' }, true);
  console.log(`custom board ${t.id.padEnd(9)} checkerboard ${String(c.calls).padStart(2)} draw calls, ${String(c.tris).padStart(5)} triangles; hood, plaid ${String(w.tris).padStart(5)}`);
}

// Painted garments (milestone 23 part 2) at their worst: a checkerboard
// jacket and pants, every square its own color, beside plaid's count. Each
// of plaid's faces is cut WEAR_SPLIT x WEAR_SPLIT (2 x 2 since the user
// asked for finer painting: about 3,400 more triangles than plaid, the same
// draw calls); on skis (each ski type, with the hood) and on each board
// type. Last again, so every line above stays the same.
for (const garment of ['jacket', 'pants'] as const) {
  const cells = new Uint8Array(wearSize(garment));
  const at = wearOffsets(garment);
  wearPanels(garment).forEach((p, i) => {
    for (let r = 0; r < p.rows; r++) for (let c = 0; c < p.cols; c++) cells[at[i]! + r * p.cols + c] = (r + c) % 2;
  });
  setWearArt(garment, 'custom-1', { cells, colors: ['#2c3037', '#ece8de'], trims: [] });
}
const painted: Partial<Outfit> = { jacketPattern: 'custom-1', pantsPattern: 'custom-1' };
const plaid: Partial<Outfit> = { jacketPattern: 'plaid', pantsPattern: 'plaid' };
for (const t of SKI_TYPES) {
  const look = { ...DEFAULT_OUTFIT, headwear: 'hood' as const, ski: t.id, skiGraphic: t.graphics[0]!.id };
  const c = count({ ...look, ...painted });
  const p = count({ ...look, ...plaid });
  console.log(`painted garments, hood, ${t.id.padEnd(7)} ski ${String(c.calls).padStart(2)} draw calls, ${String(c.tris).padStart(5)} triangles (plaid ${p.calls}, ${p.tris})`);
}
for (const t of BOARD_TYPES) {
  const look = { ...DEFAULT_OUTFIT, headwear: 'hood' as const, board: t.id, boardGraphic: t.graphics[0]!.id };
  const c = count({ ...look, ...painted }, true);
  const p = count({ ...look, ...plaid }, true);
  console.log(`painted garments, hood, ${t.id.padEnd(8)} board ${String(c.calls).padStart(2)} draw calls, ${String(c.tris).padStart(5)} triangles (plaid ${p.calls}, ${p.tris})`);
}

// The developer's powers (milestone 25): the carried model (converted by
// tools/models/packs.ts into src/render/devModels.json) is one mesh, so one
// more draw call, only for the developer and only while it shows (on the
// back, or in the hands until the scope is up). Its triangles, and with the
// default rider. Last, so every line above stays the same.
{
  const dev = JSON.parse(readFileSync('src/render/devModels.json', 'utf8')) as { models: Record<string, { pos: string }> };
  const tris = Buffer.from(dev.models.long!.pos, 'base64').length / 18;
  const base = count(DEFAULT_OUTFIT);
  console.log(`dev powers: carried model 1 draw call, ${tris} triangles; default rider with it ${base.calls + 1} draw calls, ${base.tris + tris} triangles`);
}
