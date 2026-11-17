import { drawSki, SKI_TYPES, type Side, type SkiGraphic, type SkiModel } from '../core/skis.ts';

// Flat pictures of skis for the Locker's rack and the ski editor, painted
// cell by cell by the same painter as the 3D skis (core/skis.ts drawSki);
// a snowboard (milestone 22) is one "ski" of its own model.

const MAX_HALF = Math.max(...SKI_TYPES.flatMap((t) => t.model.width.map(([, hw]) => hw)));
const GAP = 3;
/** Hex colors as 0xRRGGBB, parsed once (the painter gives one per pixel). */
const RGB = new Map<string, number>();

/**
 * Paints the pair seen from above (or their bases), tip to the right, the
 * left ski on top, at `pxPerM` canvas pixels per meter (or just the skis in
 * `sides`). Every ski type comes out the same height, so a rack lines up
 * (a board's rack passes its own widest half width, `maxHalf`).
 */
export function paintSkis(canvas: HTMLCanvasElement, type: { model: SkiModel }, g: SkiGraphic, base: boolean, pxPerM: number, sides: readonly Side[] = [-1, 1], maxHalf = MAX_HALF): void {
  const w = Math.round(type.model.length * pxPerM);
  const skiH = Math.ceil(2 * maxHalf * pxPerM) + 1;
  const h = sides.length * (skiH + GAP) - GAP;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const img = ctx.createImageData(w, h);
  sides.forEach((side, row) => {
    drawSki(type, g, side, base, pxPerM, row * (skiH + GAP) + skiH / 2, (x, y, hex) => {
      if (x >= w || y < 0 || y >= h) return;
      const i = (y * w + x) * 4;
      let rgb = RGB.get(hex);
      if (rgb === undefined) RGB.set(hex, (rgb = parseInt(hex.slice(1, 7), 16)));
      img.data[i] = rgb >> 16;
      img.data[i + 1] = (rgb >> 8) & 255;
      img.data[i + 2] = rgb & 255;
      img.data[i + 3] = 255;
    });
  });
  ctx.putImageData(img, 0, 0);
}
