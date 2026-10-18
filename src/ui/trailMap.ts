import type { BuiltMap } from '../maps/build.ts';
import { framePoint, townFrame } from '../maps/town.ts';
import type { MapDef, XZ } from '../maps/types.ts';
import { insideBounds } from '../sim/bounds.ts';

// The trail map: a drawn map of the whole mountain, opened with M (or the
// HUD button) and closed with M or Esc. The game waits behind it, like the
// map menu. It shows the ground (shaded, rock in gray, steep slopes tinted
// blue like a piste map's black runs, forests as dots), the town's
// buildings, the chairlifts, the faces' names, every named run, jumps and
// booters, rails and logs, the flags, the finishes, the start, and where
// you are.
// Like a piste map it's drawn as if seen from the valley: the start's way
// down points down the page, with a north arrow in the corner.

/** Longest side (px) of the drawn map. */
const SIZE = 900;
/** Margin around the play area, as a share of its size. */
const MARGIN = 0.05;
/** Contour lines every this many meters, darker every fifth. */
const CONTOUR = 50;
const RUN_COLORS = ['#e8761a', '#2f7de1', '#8a4fd6', '#14a0a0', '#d23c7a', '#3d9a3d', '#c8331f'];
const DEG = Math.PI / 180;

/**
 * How the world lies on the page: the middle of the play area, the world
 * directions of the page's right and down, pixels per meter, and the size.
 */
interface Frame {
  cx: number;
  cz: number;
  rightX: number;
  rightZ: number;
  downX: number;
  downZ: number;
  scale: number;
  width: number;
  height: number;
}

/** Page position (px) of a world point. */
function toPage(f: Frame, x: number, z: number): [number, number] {
  const dx = x - f.cx;
  const dz = z - f.cz;
  return [f.width / 2 + (dx * f.rightX + dz * f.rightZ) * f.scale, f.height / 2 + (dx * f.downX + dz * f.downZ) * f.scale];
}

export class TrailMap {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  /** The ground drawn once per map: shading, rock, contours and trees. */
  private relief: { built: BuiltMap; image: HTMLCanvasElement; frame: Frame } | null = null;

  /** `onClose`: the Back button was clicked (M and Esc are the game's to handle). */
  constructor(hud: HTMLElement, onClose: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'menu trail-map';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-labelledby', 'trail-map-title');

    const panel = document.createElement('div');
    panel.className = 'menu-panel trail-map-panel';
    const head = document.createElement('div');
    head.className = 'menu-head';
    const titles = document.createElement('div');
    titles.innerHTML = '<div class="menu-kicker">Trail map</div>';
    this.title = document.createElement('h1');
    this.title.id = 'trail-map-title';
    this.title.className = 'menu-title';
    titles.appendChild(this.title);
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'hud-button menu-back';
    back.innerHTML = 'Back to riding <kbd>M</kbd>';
    back.addEventListener('click', () => onClose());
    head.append(titles, back);

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'trail-map-canvas';
    const foot = document.createElement('div');
    foot.className = 'menu-foot trail-map-legend';
    foot.innerHTML =
      '<span><i class="tm-you"></i>You</span><span><i class="tm-flag"></i>Flag (checkpoint)</span>' +
      '<span><i class="tm-finish"></i>Finish</span><span><i class="tm-jump"></i>Jump or booter</span>' +
      '<span><i class="tm-rail"></i>Rail, box or log</span><span><i class="tm-lift"></i>Chairlift</span>' +
      '<span><i class="tm-steep"></i>Steeper than 30°</span><span><i class="tm-rock"></i>Rock</span><span><i class="tm-trees"></i>Trees</span>';
    panel.append(head, this.canvas, foot);
    this.root.appendChild(panel);
    hud.appendChild(this.root);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Shows the map of `built` with the rider at `at` facing `heading` (radians), and which flags they've passed. */
  open(built: BuiltMap, at: XZ, heading: number, passed: readonly boolean[]): void {
    if (this.relief?.built !== built) this.relief = drawRelief(built);
    const { image, frame } = this.relief;
    this.title.textContent = built.map.name;
    this.canvas.width = frame.width;
    this.canvas.height = frame.height;
    this.canvas.style.setProperty('--map-aspect', String(frame.width / frame.height));
    const g = this.canvas.getContext('2d');
    if (g) {
      g.drawImage(image, 0, 0);
      drawOverlay(g, built.map, frame, at, heading, passed);
    }
    this.root.hidden = false;
    document.body.classList.add('menu-open');
  }

  close(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    document.body.classList.remove('menu-open');
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }
}

function frameFor(built: BuiltMap): Frame {
  const b = built.hf.bounds;
  // Down the page: the way the start faces. Right: the rider's left (as seen from the valley).
  const h = built.map.spawn.heading * DEG;
  const downX = -Math.sin(h);
  const downZ = -Math.cos(h);
  const rightX = -Math.cos(h);
  const rightZ = Math.sin(h);
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  // The play area's box turned onto the page.
  let w = 0;
  let d = 0;
  for (const [x, z] of [
    [b.minX, b.minZ],
    [b.maxX, b.minZ],
    [b.minX, b.maxZ],
    [b.maxX, b.maxZ],
  ] as const) {
    w = Math.max(w, 2 * Math.abs((x - cx) * rightX + (z - cz) * rightZ));
    d = Math.max(d, 2 * Math.abs((x - cx) * downX + (z - cz) * downZ));
  }
  const pad = Math.max(w, d) * MARGIN;
  const scale = SIZE / Math.max(w + 2 * pad, d + 2 * pad);
  return { cx, cz, rightX, rightZ, downX, downZ, scale, width: Math.round((w + 2 * pad) * scale), height: Math.round((d + 2 * pad) * scale) };
}

/** The ground, drawn pixel by pixel from the heightfield, with the trees on it. */
function drawRelief(built: BuiltMap): { built: BuiltMap; image: HTMLCanvasElement; frame: Frame } {
  const { hf } = built;
  const frame = frameFor(built);
  const image = document.createElement('canvas');
  image.width = frame.width;
  image.height = frame.height;
  const g = image.getContext('2d')!;
  const pixels = g.createImageData(frame.width, frame.height);
  const data = pixels.data;
  const height = (x: number, z: number): number => {
    const gx = Math.min(Math.max((x - hf.originX) / hf.cellSize, 0), hf.cols - 1.001);
    const gz = Math.min(Math.max((z - hf.originZ) / hf.cellSize, 0), hf.rows - 1.001);
    const c = Math.floor(gx);
    const r = Math.floor(gz);
    const fx = gx - c;
    const fz = gz - r;
    const i = r * hf.cols + c;
    const h = hf.heights;
    const top = h[i]! + (h[i + 1]! - h[i]!) * fx;
    const bottom = h[i + hf.cols]! + (h[i + hf.cols + 1]! - h[i + hf.cols]!) * fx;
    return top + (bottom - top) * fz;
  };
  const step = 1 / frame.scale;
  const e = Math.max(step, hf.cellSize);
  // Light from the top left of the page, as maps are usually shaded.
  const lx = (-frame.rightX - frame.downX) * 0.5;
  const ly = 0.7;
  const lz = (-frame.rightZ - frame.downZ) * 0.5;
  const ll = Math.hypot(lx, ly, lz);
  const steep = Math.tan(30 * DEG);
  for (let py = 0; py < frame.height; py++) {
    for (let px = 0; px < frame.width; px++) {
      const u = (px + 0.5 - frame.width / 2) * step;
      const v = (py + 0.5 - frame.height / 2) * step;
      const x = frame.cx + u * frame.rightX + v * frame.downX;
      const z = frame.cz + u * frame.rightZ + v * frame.downZ;
      const hx = (height(x + e, z) - height(x - e, z)) / (2 * e);
      const hz = (height(x, z + e) - height(x, z - e)) / (2 * e);
      const shade = Math.max(0, (-hx * lx + ly - hz * lz) / (Math.hypot(hx, 1, hz) * ll));
      const col = Math.min(hf.cols - 1, Math.max(0, Math.round((x - hf.originX) / hf.cellSize)));
      const row = Math.min(hf.rows - 1, Math.max(0, Math.round((z - hf.originZ) / hf.cellSize)));
      let r = 244;
      let gr = 248;
      let b = 252;
      if ((hf.rock?.[row * hf.cols + col] ?? 0) > 127) {
        r = 138;
        gr = 143;
        b = 150;
      } else if (Math.hypot(hx, hz) > steep) {
        r = 196;
        gr = 214;
        b = 240;
      }
      let k = 0.62 + 0.45 * shade;
      const y = height(x, z);
      const band = (((y % CONTOUR) + CONTOUR) % CONTOUR) / CONTOUR;
      // A thin line where the height crosses a contour (about one pixel wide at any steepness).
      const width = (Math.hypot(hx, hz) * step) / CONTOUR;
      if (band < width || band > 1 - width) k *= Math.round(y / CONTOUR) % 5 === 0 ? 0.78 : 0.88;
      if (!insideBounds(hf.bounds, x, z)) {
        k *= 0.82;
        r = r * 0.7 + 150 * 0.3;
        gr = gr * 0.7 + 165 * 0.3;
        b = b * 0.7 + 185 * 0.3;
      }
      const i = (py * frame.width + px) * 4;
      data[i] = Math.min(255, r * k);
      data[i + 1] = Math.min(255, gr * k);
      data[i + 2] = Math.min(255, b * k);
      data[i + 3] = 255;
    }
  }
  g.putImageData(pixels, 0, 0);

  // Trees as dots: dark pines, pale gold aspens.
  const dot = Math.max(1, Math.round(1.6 * frame.scale * 3) / 3);
  for (const t of built.decor.scatter) {
    if (t.kind !== 'pine' && t.kind !== 'aspen') continue;
    g.fillStyle = t.kind === 'pine' ? 'rgba(34, 82, 54, 0.8)' : 'rgba(190, 150, 80, 0.85)';
    const [x, y] = toPage(frame, t.x, t.z);
    g.fillRect(x - dot / 2, y - dot / 2, dot, dot);
  }

  // Buildings and terraces, at least a couple of pixels across so the town shows.
  for (const f of built.map.features) {
    if (f.type !== 'building' && f.type !== 'terrace') continue;
    const t = townFrame(f);
    const grow = Math.max(0, 2.2 / frame.scale - Math.min(f.length, f.width)) / 2;
    const corners = [
      framePoint(t, -grow, -f.width / 2 - grow),
      framePoint(t, f.length + grow, -f.width / 2 - grow),
      framePoint(t, f.length + grow, f.width / 2 + grow),
      framePoint(t, -grow, f.width / 2 + grow),
    ].map((p) => toPage(frame, p.x, p.z));
    g.beginPath();
    corners.forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
    g.closePath();
    g.fillStyle = f.type === 'building' ? '#5b4636' : '#9aa0a6';
    g.fill();
  }

  // Chairlifts: a dark line with a tick at each tower and a block at each station.
  for (const d of built.map.decor) {
    if (d.kind !== 'chairlift' || !('points' in d)) continue;
    const pts = d.points.map((p) => toPage(frame, p.x, p.z));
    g.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
    g.lineWidth = 1.5;
    g.strokeStyle = '#1b2430';
    g.stroke();
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1]!;
      const [bx, by] = pts[i]!;
      const len = Math.hypot(bx - ax, by - ay);
      const nx = (-(by - ay) / len) * 3;
      const ny = ((bx - ax) / len) * 3;
      for (let s = 0; s <= len; s += 9) {
        const x = ax + ((bx - ax) * s) / len;
        const y = ay + ((by - ay) * s) / len;
        g.beginPath();
        g.moveTo(x - nx, y - ny);
        g.lineTo(x + nx, y + ny);
        g.lineWidth = 1;
        g.stroke();
      }
    }
    for (const [x, y] of [pts[0]!, pts[pts.length - 1]!]) {
      g.fillStyle = '#c8331f';
      g.fillRect(x - 3, y - 3, 6, 6);
    }
  }
  return { built, image, frame };
}

/** Faces' names, runs, flags, finishes, the start, and the rider. */
function drawOverlay(g: CanvasRenderingContext2D, map: MapDef, f: Frame, at: XZ, heading: number, passed: readonly boolean[]): void {
  const px = (p: XZ): [number, number] => toPage(f, p.x, p.z);
  /** Boxes of the labels drawn so far, so later ones can keep clear of them. */
  const taken: [number, number, number, number][] = [];
  const boxOf = (text: string, x: number, y: number, font: string): [number, number, number, number] => {
    g.font = font;
    const w = g.measureText(text).width + 6;
    return [x - w / 2, y - 9, x + w / 2, y + 9];
  };
  const clearOf = (b: [number, number, number, number]): boolean =>
    taken.every((t) => b[2] < t[0] || b[0] > t[2] || b[3] < t[1] || b[1] > t[3]);
  const label = (text: string, x: number, y: number, font: string, fill: string): void => {
    taken.push(boxOf(text, x, y, font));
    g.font = font;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = 4;
    g.strokeStyle = 'rgba(255, 255, 255, 0.92)';
    g.strokeText(text, x, y);
    g.fillStyle = fill;
    g.fillText(text, x, y);
  };

  // Each face and ridge by name, part way out along it.
  if (map.terrain.type === 'peak') {
    const b = map.terrain.bounds;
    const reach = Math.max(...b.map((p) => Math.hypot(p.x, p.z)));
    for (const s of map.terrain.spokes) {
      const r = reach * 0.6;
      const a = (s.heading + (s.bend * r) / 1000) * DEG;
      const [x, y] = px({ x: -Math.sin(a) * r, z: -Math.cos(a) * r });
      label(s.name.toUpperCase(), x, y, '800 13px system-ui, sans-serif', 'rgba(20, 32, 48, 0.62)');
    }
  }

  // Runs: a colored line each, with its name part way down.
  map.runs.forEach((run, k) => {
    const color = RUN_COLORS[k % RUN_COLORS.length]!;
    const pts = run.points.map(px);
    for (const [width, style] of [
      [6, 'rgba(255, 255, 255, 0.85)'],
      [3, color],
    ] as const) {
      g.beginPath();
      pts.forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
      g.lineWidth = width;
      g.strokeStyle = style;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.stroke();
    }
    // Its name where it doesn't cover another label, trying spots down the run.
    const font = '700 12px system-ui, sans-serif';
    let spot = pointAlong(pts, 0.4);
    for (const t of [0.4, 0.3, 0.5, 0.22, 0.6, 0.15, 0.7, 0.8]) {
      const [x, y] = pointAlong(pts, t);
      if (clearOf(boxOf(run.name, x, y, font))) {
        spot = [x, y];
        break;
      }
    }
    label(run.name, spot[0], spot[1], font, color);
  });

  // Jumps and booters: a small chevron pointing the way off them. Rails, boxes and logs: a short bar along them.
  for (const feat of map.features) {
    if (feat.type === 'jump' || feat.type === 'kicker') {
      const h = feat.yaw * DEG;
      const fx = -Math.sin(h);
      const fz = -Math.cos(h);
      const dx = fx * f.rightX + fz * f.rightZ;
      const dy = fx * f.downX + fz * f.downZ;
      const [x, y] = px(feat);
      g.beginPath();
      g.moveTo(x - dy * 4 - dx * 2, y + dx * 4 - dy * 2);
      g.lineTo(x + dx * 4, y + dy * 4);
      g.lineTo(x + dy * 4 - dx * 2, y - dx * 4 - dy * 2);
      g.lineWidth = 2;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.strokeStyle = feat.natural ? '#1b2430' : '#2f6fe0';
      g.stroke();
    } else if (feat.type === 'rail' || feat.type === 'box') {
      const a = px(feat.points[0]!);
      const b = px(feat.points[feat.points.length - 1]!);
      const len = Math.max(1e-6, Math.hypot(b[0] - a[0], b[1] - a[1]));
      // Long enough to see, however short it is on the page.
      const grow = Math.max(0, 6 - len) / 2;
      g.beginPath();
      g.moveTo(a[0] - ((b[0] - a[0]) / len) * grow, a[1] - ((b[1] - a[1]) / len) * grow);
      g.lineTo(b[0] + ((b[0] - a[0]) / len) * grow, b[1] + ((b[1] - a[1]) / len) * grow);
      g.lineWidth = 2.5;
      g.lineCap = 'round';
      g.strokeStyle = feat.type === 'rail' && feat.style === 'log' ? '#7a4f2c' : '#56606b';
      g.stroke();
    }
  }

  // The town's name over its buildings.
  const buildings = map.features.filter((ft) => ft.type === 'building');
  if (buildings.length >= 6) {
    const cx = buildings.reduce((sum, b) => sum + b.x, 0) / buildings.length;
    const cz = buildings.reduce((sum, b) => sum + b.z, 0) / buildings.length;
    const [x, y] = px({ x: cx, z: cz });
    label('TOWN', x, y, '800 13px system-ui, sans-serif', 'rgba(20, 32, 48, 0.75)');
  }

  // Finishes: a checkered bar across each finish line, or across its arch on a wide run-out (the zone outlined faintly).
  for (const fin of map.finishes) {
    const h = fin.heading * DEG;
    const rx = Math.cos(h);
    const rz = -Math.sin(h);
    if (fin.arch) {
      const dx = -Math.sin(h);
      const dz = -Math.cos(h);
      const c = (a: number, s: number): [number, number] => px({ x: fin.x + dx * a + rx * s, z: fin.z + dz * a + rz * s });
      const corners = [c(0, -fin.width / 2), c(0, fin.width / 2), c(fin.length, fin.width / 2), c(fin.length, -fin.width / 2)];
      g.beginPath();
      corners.forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
      g.closePath();
      g.fillStyle = 'rgba(27, 36, 48, 0.08)';
      g.fill();
      g.setLineDash([4, 4]);
      g.lineWidth = 1;
      g.strokeStyle = 'rgba(27, 36, 48, 0.45)';
      g.stroke();
      g.setLineDash([]);
    }
    const line = fin.arch ?? fin;
    // At least a few checks wide, so a narrow arch still shows.
    const width = Math.max(line.width, 26 / f.scale);
    const n = Math.max(2, Math.round((width * f.scale) / 6));
    for (let i = 0; i < n; i++) {
      const a = px({ x: line.x + rx * (-width / 2 + (width * i) / n), z: line.z + rz * (-width / 2 + (width * i) / n) });
      const b = px({ x: line.x + rx * (-width / 2 + (width * (i + 1)) / n), z: line.z + rz * (-width / 2 + (width * (i + 1)) / n) });
      g.beginPath();
      g.moveTo(a[0], a[1]);
      g.lineTo(b[0], b[1]);
      g.lineWidth = 5;
      g.lineCap = 'butt';
      g.strokeStyle = i % 2 === 0 ? '#1b2430' : '#ffffff';
      g.stroke();
    }
  }

  // Flags: a small pennant each, green once passed.
  map.flags.forEach((fl, i) => {
    const [x, y] = px(fl);
    g.beginPath();
    g.moveTo(x, y + 5);
    g.lineTo(x, y - 7);
    g.lineTo(x + 8, y - 4);
    g.lineTo(x, y - 1);
    g.lineWidth = 1.5;
    g.strokeStyle = '#1b2430';
    g.fillStyle = passed[i] ? '#33c26a' : '#ff7a1a';
    g.fill();
    g.stroke();
  });

  // The start.
  {
    const [x, y] = px(map.spawn);
    g.beginPath();
    g.moveTo(x, y - 9);
    g.lineTo(x + 8, y + 6);
    g.lineTo(x - 8, y + 6);
    g.closePath();
    g.fillStyle = '#1b2430';
    g.fill();
    label('Start', x, y + 17, '700 12px system-ui, sans-serif', '#1b2430');
  }

  // North: an arrow in the top left corner.
  {
    const nx = -f.rightZ;
    const ny = -f.downZ;
    const cx = 26;
    const cy = 30;
    g.beginPath();
    g.moveTo(cx + nx * 14, cy + ny * 14);
    g.lineTo(cx - ny * 6 - nx * 8, cy + nx * 6 - ny * 8);
    g.lineTo(cx - nx * 3, cy - ny * 3);
    g.lineTo(cx + ny * 6 - nx * 8, cy - nx * 6 - ny * 8);
    g.closePath();
    g.fillStyle = '#1b2430';
    g.fill();
    label('N', cx + nx * 24, cy + ny * 24, '800 13px system-ui, sans-serif', '#1b2430');
  }

  // The rider: a dot with an arrow pointing the way they face.
  {
    const [x, y] = px(at);
    const fx = -Math.sin(heading);
    const fz = -Math.cos(heading);
    const dx = fx * f.rightX + fz * f.rightZ;
    const dy = fx * f.downX + fz * f.downZ;
    g.beginPath();
    g.moveTo(x + dx * 15, y + dy * 15);
    g.lineTo(x - dy * 6, y + dx * 6);
    g.lineTo(x + dy * 6, y - dx * 6);
    g.closePath();
    g.fillStyle = '#e53935';
    g.fill();
    g.beginPath();
    g.arc(x, y, 6.5, 0, Math.PI * 2);
    g.fillStyle = '#e53935';
    g.fill();
    g.lineWidth = 2.5;
    g.strokeStyle = '#ffffff';
    g.stroke();
    label('You', x, y - 16, '800 12px system-ui, sans-serif', '#c62828');
  }
}

/** The point a share `t` of the way along a polyline (by length). */
function pointAlong(pts: readonly [number, number][], t: number): [number, number] {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
  let left = total * t;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (left <= len) return [a[0] + ((b[0] - a[0]) * left) / Math.max(len, 1e-6), a[1] + ((b[1] - a[1]) * left) / Math.max(len, 1e-6)];
    left -= len;
  }
  return pts[pts.length - 1] ?? [0, 0];
}
