import { drawFlags, type MapArt } from './trailMap.ts';

// The corner trail map (milestone 21): a small window onto the trail map's
// art (ui/trailMap.ts drawMapArt, drawn once per map behind "Loading") in
// the HUD's bottom right corner, centered on the rider and turned the same
// way as the full map; the trail-map key (M) shows and hides it while the
// game keeps running. Each frame only two CSS transforms move: the art,
// panned under the window by whole pixels, and the rider's arrow, turned by
// whole degrees. Their strings are made once (per map for the pan), so a
// frame allocates nothing, and the canvas is only redrawn when a flag is
// passed or the run resets. Read every frame, so it's left out of the
// production build's obfuscation (tools/vite/obfuscate.js EXCLUDE).

export class CornerMap {
  private readonly root: HTMLElement;
  private readonly panX: HTMLElement;
  private readonly panY: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly arrow: HTMLElement;
  private art: MapArt | null = null;
  private shown = true;
  /** `translateX(-Npx)` and `translateY(-Npx)` for every pixel of the art, and `rotate(Ndeg)` for every degree. */
  private xs: string[] = [];
  private ys: string[] = [];
  private readonly turns: string[] = [];
  private lastX = -1;
  private lastY = -1;
  private lastTurn = -1;
  /** Flags passed when the canvas was last drawn (-1: not yet). */
  private passedCount = -1;

  constructor(hud: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'corner-map ride-only';
    this.root.hidden = true;
    this.root.setAttribute('aria-hidden', 'true');
    this.panX = document.createElement('div');
    this.panX.className = 'corner-map-pan';
    this.panY = document.createElement('div');
    this.panY.className = 'corner-map-pan-y';
    this.canvas = document.createElement('canvas');
    this.panY.appendChild(this.canvas);
    this.panX.appendChild(this.panY);
    this.arrow = document.createElement('div');
    this.arrow.className = 'corner-map-you';
    this.arrow.innerHTML = '<svg viewBox="-10 -12 20 24" width="20" height="24"><path d="M0 -11 L8 9 L0 4 L-8 9 Z" fill="#e53935" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>';
    this.root.append(this.panX, this.arrow);
    hud.appendChild(this.root);
    for (let d = 0; d < 360; d++) this.turns.push(`rotate(${d}deg)`);
  }

  /** The map being ridden's art, or null (no map: hidden). */
  setMap(art: MapArt | null): void {
    this.art = art;
    this.lastX = -1;
    this.lastY = -1;
    this.lastTurn = -1;
    this.passedCount = -1;
    if (art) {
      const { width, height } = art.frame;
      this.canvas.width = width;
      this.canvas.height = height;
      this.xs = Array.from({ length: width + 1 }, (_, i) => `translateX(${-i}px)`);
      this.ys = Array.from({ length: height + 1 }, (_, i) => `translateY(${-i}px)`);
    } else {
      this.canvas.width = 1;
      this.canvas.height = 1;
      this.xs = [];
      this.ys = [];
    }
    this.sync();
  }

  /** Shows or hides it (the trail-map key). */
  setShown(on: boolean): void {
    this.shown = on;
    this.sync();
  }

  get isShown(): boolean {
    return this.shown;
  }

  private sync(): void {
    this.root.hidden = !this.shown || this.art === null;
  }

  /** Each frame: the rider at (x, z) facing `heading` (radians), and the flags passed. */
  update(x: number, z: number, heading: number, passed: readonly boolean[]): void {
    const art = this.art;
    if (!art || !this.shown) return;
    let count = 0;
    for (let i = 0; i < passed.length; i++) if (passed[i]) count++;
    if (count !== this.passedCount) this.redraw(passed, count);
    const f = art.frame;
    // toPage, written out so nothing is allocated.
    const ox = x - f.cx;
    const oz = z - f.cz;
    const px = f.width / 2 + (ox * f.rightX + oz * f.rightZ) * f.scale;
    const py = f.height / 2 + (ox * f.downX + oz * f.downZ) * f.scale;
    const ix = Math.min(f.width, Math.max(0, Math.round(px)));
    const iy = Math.min(f.height, Math.max(0, Math.round(py)));
    if (ix !== this.lastX) {
      this.lastX = ix;
      this.panX.style.transform = this.xs[ix]!;
    }
    if (iy !== this.lastY) {
      this.lastY = iy;
      this.panY.style.transform = this.ys[iy]!;
    }
    // The way the skis face, on the page: 0 is up the page, clockwise.
    const fx = -Math.sin(heading);
    const fz = -Math.cos(heading);
    const dx = fx * f.rightX + fz * f.rightZ;
    const dy = fx * f.downX + fz * f.downZ;
    const turn = ((Math.round((Math.atan2(dx, -dy) * 180) / Math.PI) % 360) + 360) % 360;
    if (turn !== this.lastTurn) {
      this.lastTurn = turn;
      this.arrow.style.transform = this.turns[turn]!;
    }
  }

  /** The art, with the flags passed so far in green. */
  private redraw(passed: readonly boolean[], count: number): void {
    const art = this.art;
    const g = this.canvas.getContext('2d');
    if (!art || !g) return;
    // A flag can only turn back from passed when the run resets: start from the art again then.
    if (count < this.passedCount || this.passedCount < 0) g.drawImage(art.base, 0, 0);
    drawFlags(g, art.built.map, art.frame, passed);
    this.passedCount = count;
  }
}
