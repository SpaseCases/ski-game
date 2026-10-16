// Finds the spots in a map's play area where a rider could get stuck: dips
// with no way down to a finish without climbing. It floods the heightfield
// from the finish zones outward (as water would fill it), so every spot
// learns the lowest height it must climb over to reach a finish; how far
// that is above the spot is how deep a hole it's in. The edge of the play
// area counts as a wall, so ground that drains into it shows up too.
//   node tools/maps/sinks.ts <map.json> [min depth m, default 0.6]

import { readFileSync } from 'node:fs';
import { generateTerrain } from '../../src/maps/build.ts';
import { parseMap } from '../../src/maps/loader.ts';
import { insideBounds } from '../../src/sim/bounds.ts';
import { finishAt } from '../../src/sim/checkpoints.ts';

const [file, minArg] = process.argv.slice(2);
if (!file) throw new Error('Usage: node tools/maps/sinks.ts <map.json> [min depth]');
const minDepth = Number(minArg ?? 0.6);
const map = parseMap(JSON.parse(readFileSync(file, 'utf8')));
const hf = generateTerrain(map.terrain);
const { cols, rows, cellSize, originX, originZ, heights } = hf;
const n = cols * rows;
const at = (i: number): { x: number; z: number } => ({ x: originX + (i % cols) * cellSize, z: originZ + Math.floor(i / cols) * cellSize });

// 0 outside the play area, 1 inside, 2 queued or done.
const state = new Uint8Array(n);
const filled = new Float32Array(n);
let inside = 0;
for (let i = 0; i < n; i++) {
  const p = at(i);
  if (insideBounds(hf.bounds, p.x, p.z)) {
    state[i] = 1;
    inside++;
  }
}

// Min-heap of cell indices by filled height.
const heap = new Int32Array(n);
let size = 0;
const less = (a: number, b: number): boolean => filled[heap[a]!]! < filled[heap[b]!]!;
const swap = (a: number, b: number): void => {
  const t = heap[a]!;
  heap[a] = heap[b]!;
  heap[b] = t;
};
function push(i: number): void {
  heap[size] = i;
  let k = size++;
  while (k > 0) {
    const parent = (k - 1) >> 1;
    if (!less(k, parent)) break;
    swap(k, parent);
    k = parent;
  }
}
function pop(): number {
  const top = heap[0]!;
  heap[0] = heap[--size]!;
  let k = 0;
  for (;;) {
    const l = 2 * k + 1;
    const r = l + 1;
    let m = k;
    if (l < size && less(l, m)) m = l;
    if (r < size && less(r, m)) m = r;
    if (m === k) break;
    swap(k, m);
    k = m;
  }
  return top;
}

let outlets = 0;
for (let i = 0; i < n; i++) {
  if (state[i] !== 1 || finishAt(map, at(i)) < 0) continue;
  state[i] = 2;
  filled[i] = heights[i]!;
  push(i);
  outlets++;
}
if (outlets === 0) throw new Error('No finish zone inside the play area');
while (size > 0) {
  const i = pop();
  const c = i % cols;
  const r = (i - c) / cols;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const cc = c + dc;
      const rr = r + dr;
      if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
      const j = rr * cols + cc;
      if (state[j] !== 1) continue;
      state[j] = 2;
      filled[j] = Math.max(heights[j]!, filled[i]!);
      push(j);
    }
  }
}

// Group deep spots into holes and report each.
const seen = new Uint8Array(n);
interface Hole {
  depth: number;
  cells: number;
  x: number;
  z: number;
  atEdge: boolean;
}
const holes: Hole[] = [];
let unreached = 0;
for (let i = 0; i < n; i++) {
  if (state[i] === 1) unreached++;
  if (state[i] !== 2 || seen[i] || filled[i]! - heights[i]! < minDepth) continue;
  const hole: Hole = { depth: 0, cells: 0, x: 0, z: 0, atEdge: false };
  const stack = [i];
  seen[i] = 1;
  let deepest = i;
  while (stack.length > 0) {
    const k = stack.pop()!;
    hole.cells++;
    const d = filled[k]! - heights[k]!;
    if (d > hole.depth) {
      hole.depth = d;
      deepest = k;
    }
    const c = k % cols;
    const r = (k - c) / cols;
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const j = (r + dr) * cols + c + dc;
      if (c + dc < 0 || c + dc >= cols || r + dr < 0 || r + dr >= rows) continue;
      if (state[j] === 0) hole.atEdge = true;
      if (state[j] !== 2 || seen[j] || filled[j]! - heights[j]! < minDepth * 0.5) continue;
      seen[j] = 1;
      stack.push(j);
    }
  }
  const p = at(deepest);
  hole.x = p.x;
  hole.z = p.z;
  holes.push(hole);
}
holes.sort((a, b) => b.depth - a.depth);
console.log(`${file}: ${inside} cells in the play area, ${outlets} in finishes, ${unreached} cut off from every finish`);
console.log(`${holes.length} hole${holes.length === 1 ? '' : 's'} deeper than ${minDepth} m:`);
for (const h of holes.slice(0, 40)) {
  const r = Math.hypot(h.x, h.z);
  const heading = (Math.atan2(-h.x, -h.z) * 180) / Math.PI;
  console.log(
    `  ${h.depth.toFixed(1)} m deep, ${(h.cells * cellSize * cellSize).toFixed(0)} m², deepest at (${h.x.toFixed(0)}, ${h.z.toFixed(0)}) ` +
      `= ${r.toFixed(0)} m out at heading ${heading.toFixed(0)}°${h.atEdge ? ', against the edge' : ''}`,
  );
}
