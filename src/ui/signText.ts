import { ADVANCE, CAP, GLYPHS } from '../render/font.ts';

// Menu headings drawn in the trail signs' own stroke font (render/font.ts),
// as SVG, so the menus letter their titles like the signs on the mountain.

/** Stroke width in glyph grid units (the font's grid is 4 × 6 per capital). */
const WEIGHT = 1.15;

/** An SVG of `text` in the sign font, capitals filling its height; size it with CSS (height). */
export function signText(text: string, className = 'sign-text'): SVGSVGElement {
  const pad = WEIGHT / 2;
  let d = '';
  let x = 0;
  for (const ch of text.toUpperCase()) {
    for (const stroke of GLYPHS[ch] ?? []) {
      stroke.forEach(([gx, gy], i) => {
        d += `${i === 0 ? 'M' : 'L'}${round(x + gx + pad)} ${round(CAP - gy + pad)}`;
      });
    }
    x += ADVANCE;
  }
  const width = Math.max(0, x - (ADVANCE - 4)) + WEIGHT;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${round(width)} ${CAP + WEIGHT}`);
  svg.setAttribute('class', className);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', text);
  svg.style.aspectRatio = `${round(width)} / ${CAP + WEIGHT}`;
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', String(WEIGHT));
  path.setAttribute('stroke-linecap', 'square');
  path.setAttribute('stroke-linejoin', 'miter');
  svg.appendChild(path);
  return svg;
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
