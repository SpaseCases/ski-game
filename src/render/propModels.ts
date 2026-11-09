import { Color, SRGBColorSpace, Vector3 } from 'three';
import type { MapDef } from '../maps/types.ts';

// Props converted from free CC0 model packs (the City's cars, hydrants,
// bins, dumpsters, traffic lights, signs, a water tower) by
// tools/models/packs.ts into propModels.json: flat-colored triangles, no
// textures. The data is its own chunk, fetched only when a map that uses
// them loads (`loadPropModels`); until then `propModel` returns nothing and
// the drawing code falls back to its own boxes.

/** A model in its own meters: x across, y up from its base, z along its length, centered on x and z. */
export interface PropModel {
  /** Width (x), height (y) and length (z). */
  size: readonly [number, number, number];
  /** Nine coordinates per triangle, in meters. */
  positions: Float32Array;
  /** One color per triangle. */
  colors: Color[];
}

let models: Map<string, PropModel> | null = null;
let loading: Promise<void> | null = null;

/** Fetches and unpacks the models (once). */
export function loadPropModels(): Promise<void> {
  if (models) return Promise.resolve();
  loading ??= import('./propModels.json').then((m) => {
    const data = (m.default ?? m) as unknown as { models: Record<string, { size: [number, number, number]; pos: string; col: string }> };
    const out = new Map<string, PropModel>();
    for (const [id, raw] of Object.entries(data.models)) {
      const q = new Int16Array(bytes(raw.pos).buffer);
      const c = bytes(raw.col);
      const [w, h, l] = raw.size;
      const positions = new Float32Array(q.length);
      for (let i = 0; i < q.length; i += 3) {
        positions[i] = (q[i]! / 32767) * (w / 2);
        positions[i + 1] = (q[i + 1]! / 32767) * h;
        positions[i + 2] = (q[i + 2]! / 32767) * (l / 2);
      }
      const colors: Color[] = [];
      for (let t = 0; t < c.length; t += 3) colors.push(new Color().setRGB(c[t]! / 255, c[t + 1]! / 255, c[t + 2]! / 255, SRGBColorSpace));
      out.set(id, { size: raw.size, positions, colors });
    }
    models = out;
  });
  return loading;
}

function bytes(base64: string): Uint8Array {
  const s = atob(base64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** A loaded model, or undefined (not loaded, or no such model). */
export function propModel(id: string): PropModel | undefined {
  return models?.get(id);
}

const a = new Vector3();
const b = new Vector3();
const c = new Vector3();

/**
 * Adds a model's triangles through `place`, which turns a model point
 * (stretched by sx, sy, sz) into the world, and `push`, which takes a
 * world triangle and its color.
 */
export function emitModel(
  m: PropModel,
  sx: number,
  sy: number,
  sz: number,
  place: (x: number, y: number, z: number, out: Vector3) => void,
  push: (a: Vector3, b: Vector3, c: Vector3, color: Color) => void,
): void {
  const p = m.positions;
  for (let t = 0; t < m.colors.length; t++) {
    const i = t * 9;
    place(p[i]! * sx, p[i + 1]! * sy, p[i + 2]! * sz, a);
    place(p[i + 3]! * sx, p[i + 4]! * sy, p[i + 5]! * sz, b);
    place(p[i + 6]! * sx, p[i + 7]! * sy, p[i + 8]! * sz, c);
    push(a, b, c, m.colors[t]!);
  }
}

/** Box styles and props drawn from the models. */
const MODEL_BOXES: ReadonlySet<string> = new Set(['car', 'dumpster', 'hydrant', 'bin']);
const MODEL_PROPS: ReadonlySet<string> = new Set(['trafficLight', 'stopSign', 'noParking', 'yieldSign', 'waterTower']);

/** Does this map draw anything from the models (so loading it should fetch them first)? */
export function needsPropModels(map: MapDef): boolean {
  return map.features.some((f) => f.type === 'box' && MODEL_BOXES.has(f.style)) || map.decor.some((d) => MODEL_PROPS.has(d.kind));
}
