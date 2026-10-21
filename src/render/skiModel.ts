import { BufferAttribute, BufferGeometry, Color, Vector3 } from 'three';
import { aspectOf, graphicColor, halfWidthAt, riseAt, type Side, type SkiGraphic, type SkiModel } from '../core/skis.ts';

// One ski of the pair from its model and graphic (core/skis.ts): the top
// sheet is a grid of faces, rows along the ski and columns across, each
// painted with the graphic's color at its middle (vertex colors, so it shows
// on Low with no textures), then the sidewalls, the base (a grid like the
// top's when the graphic paints it, else one color) and the two ends. A run
// of one color across a row is one face: the ski is flat across, so nothing
// moves. A pair graphic gives the left and right skis different halves.
// Ski space: the base on flat snow at y = 0, the tip toward -Z, the middle
// of the boot at the origin. Not indexed, like the rest of the skier.

const pc = new Vector3();
const n = new Vector3();
const color = new Color();

export function buildSkiGeometry(model: SkiModel, graphic: SkiGraphic, side: Side): BufferGeometry {
  const rows = model.rows;
  const cols = model.cols;
  const half = model.length / 2;
  const aspect = aspectOf(model);
  const pos: number[] = [];
  const rgb: number[] = [];

  // Stations along the ski, tail (i = 0) to tip (i = rows).
  const along: number[] = [];
  const hw: number[] = [];
  const base: number[] = [];
  for (let i = 0; i <= rows; i++) {
    const a = -half + (model.length * i) / rows;
    along.push(a);
    hw.push(halfWidthAt(model, a));
    base.push(riseAt(model, a));
  }
  const z = (i: number): number => -model.mount - along[i]!;
  const x = (i: number, v: number): number => v * hw[i]!;
  const top = (i: number): number => base[i]! + model.thickness;

  /** Adds a triangle facing roughly `wx, wy, wz`, flipping its winding if needed. */
  const tri = (a: Vector3, b: Vector3, c: Vector3, hex: string, wx: number, wy: number, wz: number): void => {
    n.subVectors(b, a).cross(pc.subVectors(c, a));
    const flip = n.x * wx + n.y * wy + n.z * wz < 0;
    for (const p of flip ? [a, c, b] : [a, b, c]) pos.push(p.x, p.y, p.z);
    color.set(hex);
    for (let k = 0; k < 3; k++) rgb.push(color.r, color.g, color.b);
  };
  const quad = (p: number[], hex: string, wx: number, wy: number, wz: number): void => {
    const v0 = new Vector3(p[0], p[1], p[2]);
    const v1 = new Vector3(p[3], p[4], p[5]);
    const v2 = new Vector3(p[6], p[7], p[8]);
    const v3 = new Vector3(p[9], p[10], p[11]);
    tri(v0, v1, v2, hex, wx, wy, wz);
    tri(v0, v2, v3, hex, wx, wy, wz);
  };

  /** A painted sheet (the top, or the base): per row, runs of one color. Returns each row's left, right and middle colors. */
  const sheet = (height: (i: number) => number, onBase: boolean): string[][] => {
    const ends: string[][] = [];
    for (let i = 0; i < rows; i++) {
      const u = (along[i]! + along[i + 1]!) / (2 * half);
      const row: string[] = [];
      for (let j = 0; j < cols; j++) row.push(graphicColor(graphic, u, -1 + (2 * j + 1) / cols, aspect, side, onBase));
      ends.push([row[0]!, row[cols - 1]!, row[cols >> 1]!]);
      for (let j0 = 0; j0 < cols; ) {
        let j1 = j0;
        while (j1 + 1 < cols && row[j1 + 1] === row[j0]) j1++;
        const va = -1 + (2 * j0) / cols;
        const vb = -1 + (2 * (j1 + 1)) / cols;
        const [y0, y1] = [height(i), height(i + 1)];
        quad([x(i, va), y0, z(i), x(i, vb), y0, z(i), x(i + 1, vb), y1, z(i + 1), x(i + 1, va), y1, z(i + 1)], row[j0]!, 0, onBase ? -1 : 1, 0);
        j0 = j1 + 1;
      }
    }
    return ends;
  };
  const edge = sheet(top, false);
  sheet((i) => base[i]!, true);

  // Sidewalls (the graphic's, or the top sheet's edge) and the ends.
  for (let i = 0; i < rows; i++) {
    for (const [wall, k] of [
      [-1, 0],
      [1, 1],
    ] as const) {
      quad(
        [x(i, wall), top(i), z(i), x(i + 1, wall), top(i + 1), z(i + 1), x(i + 1, wall), base[i + 1]!, z(i + 1), x(i, wall), base[i]!, z(i)],
        graphic.sidewall ?? edge[i]![k]!,
        wall,
        0,
        0,
      );
    }
  }
  for (const [i, dir, cell] of [
    [0, 1, 0],
    [rows, -1, rows - 1],
  ] as const) {
    quad([x(i, -1), top(i), z(i), x(i, 1), top(i), z(i), x(i, 1), base[i]!, z(i), x(i, -1), base[i]!, z(i)], graphic.sidewall ?? edge[cell]![2]!, 0, 0, dir);
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(rgb), 3));
  g.computeVertexNormals();
  return g;
}
