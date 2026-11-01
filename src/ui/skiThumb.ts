import { drawSki, SKI_TYPES, type SkiGraphic, type SkiType } from '../core/skis.ts';

// Flat pictures of skis for the Locker's rack and the ski editor, painted
// cell by cell by the same painter as the 3D skis (core/skis.ts drawSki).

const MAX_HALF = Math.max(...SKI_TYPES.flatMap((t) => t.model.width.map(([, hw]) => hw)));
const GAP = 3;

/**
 * Paints the pair seen from above (or their bases), tip to the right, the
 * left ski on top, at `pxPerM` canvas pixels per meter (or one ski with
 * `pair` false). Every ski type comes out the same height, so a rack lines up.
 */
export function paintSkis(canvas: HTMLCanvasElement, type: SkiType, g: SkiGraphic, base: boolean, pxPerM: number, pair = true): void {
  const w = Math.round(type.model.length * pxPerM);
  const skiH = Math.ceil(2 * MAX_HALF * pxPerM) + 1;
  const h = pair ? skiH * 2 + GAP : skiH;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const img = ctx.createImageData(w, h);
  const sides = pair ? ([[0, -1], [1, 1]] as const) : ([[0, -1]] as const);
  for (const [row, side] of sides) {
    drawSki(type, g, side, base, pxPerM, row * (skiH + GAP) + skiH / 2, (x, y, hex) => {
      if (x >= w || y < 0 || y >= h) return;
      const i = (y * w + x) * 4;
      img.data[i] = parseInt(hex.slice(1, 3), 16);
      img.data[i + 1] = parseInt(hex.slice(3, 5), 16);
      img.data[i + 2] = parseInt(hex.slice(5, 7), 16);
      img.data[i + 3] = 255;
    });
  }
  ctx.putImageData(img, 0, 0);
}
