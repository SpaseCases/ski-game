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
//
// In a multiplayer lobby (2026-11-24, the user's ask) the other riders show
// as dots in their jacket's color: the multiplayer chunk writes where they
// are into `spots` each frame and `update` gets the count. Each dot is two
// nested elements moved by made-once translate strings like the art, so
// they allocate nothing either; one past the window's edge is hidden.

/** The most other riders shown (a lobby holds 16, mpRules.ts ROOM_MAX). */
export const CORNER_RIDERS = 15;
/** Numbers per rider in `spots`: x, z (m), away (1 or 0), the jacket's color (0xrrggbb). */
export const SPOT_STRIDE = 4;
/** How far from the middle a dot can be drawn (px); past it, it's hidden (the window is at most 200 px). */
const SPOT_REACH = 120;

class RiderDot {
  readonly x: HTMLElement;
  readonly y: HTMLElement;
  lastX = 1e9;
  lastY = 1e9;
  color = -1;
  away = false;
  shown = false;

  constructor(parent: HTMLElement) {
    this.x = document.createElement('div');
    this.x.className = 'corner-map-rider';
    this.x.hidden = true;
    this.y = document.createElement('div');
    this.y.className = 'corner-map-rider-dot';
    this.x.appendChild(this.y);
    parent.appendChild(this.x);
  }

  show(on: boolean): void {
    if (on === this.shown) return;
    this.shown = on;
    this.x.hidden = !on;
  }
}

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
  /** Where the other riders in a lobby are (SPOT_STRIDE numbers each), written by the multiplayer chunk. */
  readonly spots = new Float32Array(CORNER_RIDERS * SPOT_STRIDE);
  private readonly dots: RiderDot[] = [];
  /** `translateX(Npx)` and `translateY(Npx)` from -SPOT_REACH to SPOT_REACH. */
  private readonly dotXs: string[] = [];
  private readonly dotYs: string[] = [];
  private dotsShown = 0;

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
    this.root.append(this.panX);
    for (let i = 0; i < CORNER_RIDERS; i++) this.dots.push(new RiderDot(this.root));
    // The rider's own arrow on top of the others.
    this.root.appendChild(this.arrow);
    hud.appendChild(this.root);
    for (let d = 0; d < 360; d++) this.turns.push(`rotate(${d}deg)`);
    for (let p = -SPOT_REACH; p <= SPOT_REACH; p++) {
      this.dotXs.push(`translateX(${p}px)`);
      this.dotYs.push(`translateY(${p}px)`);
    }
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

  /** Each frame: the rider at (x, z) facing `heading` (radians), the flags passed, and how many other riders `spots` holds. */
  update(x: number, z: number, heading: number, passed: readonly boolean[], others: number): void {
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
    this.placeOthers(others, ix, iy);
  }

  /** The other riders' dots, around the window's middle (the art's pixel `ix`, `iy`). */
  private placeOthers(count: number, ix: number, iy: number): void {
    const f = this.art!.frame;
    const n = Math.min(count, CORNER_RIDERS);
    for (let i = 0; i < n; i++) {
      const dot = this.dots[i]!;
      const k = i * SPOT_STRIDE;
      const ox = this.spots[k]! - f.cx;
      const oz = this.spots[k + 1]! - f.cz;
      const dx = Math.round(f.width / 2 + (ox * f.rightX + oz * f.rightZ) * f.scale) - ix;
      const dy = Math.round(f.height / 2 + (ox * f.downX + oz * f.downZ) * f.scale) - iy;
      if (dx < -SPOT_REACH || dx > SPOT_REACH || dy < -SPOT_REACH || dy > SPOT_REACH) {
        dot.show(false);
        continue;
      }
      dot.show(true);
      if (dx !== dot.lastX) {
        dot.lastX = dx;
        dot.x.style.transform = this.dotXs[dx + SPOT_REACH]!;
      }
      if (dy !== dot.lastY) {
        dot.lastY = dy;
        dot.y.style.transform = this.dotYs[dy + SPOT_REACH]!;
      }
      const away = this.spots[k + 2]! > 0.5;
      if (away !== dot.away) {
        dot.away = away;
        dot.y.classList.toggle('is-away', away);
      }
      const color = this.spots[k + 3]! | 0;
      if (color !== dot.color) {
        // Only when the rider in this slot changes (a join, a leave): the one string made.
        dot.color = color;
        dot.y.style.backgroundColor = `#${color.toString(16).padStart(6, '0')}`;
      }
    }
    for (let i = n; i < this.dotsShown; i++) this.dots[i]!.show(false);
    this.dotsShown = n;
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
