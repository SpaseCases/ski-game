// Skier draw calls and triangles: every headwear, every pattern on both
// garments, each ski, and the poles off, against the rig's budget (17 draw
// calls, about 9,000 triangles). The worst outfit is the one to watch.
//   node tools/model/budget.ts

import { Mesh, type BufferGeometry } from 'three';
import { DEFAULT_OUTFIT, HEADWEAR, PATTERNS, type Outfit } from '../../src/core/outfit.ts';
import { SKI_TYPES } from '../../src/core/skis.ts';
import { SkierRig } from '../../src/render/skierRig.ts';

function count(o: Outfit): { calls: number; tris: number } {
  const rig = new SkierRig(o);
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
