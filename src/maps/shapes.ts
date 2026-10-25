import type {
  Feature,
  HalfpipeFeature,
  Heightfield,
  JumpFeature,
  KickerFeature,
  LandingFeature,
  PipeShape,
  QuarterFeature,
  QuarterShape,
  RampShape,
  ShapeCells,
  TerrainShape,
} from './types.ts';

// Shapes built on top of the slope: jumps, kickers, landings, halfpipes,
// quarterpipes and wallrides, and the raised start decks. They're exact functions added over the heightfield
// rather than baked into its 2 m grid, which would round a lip into a hump.
// Where two overlap, the higher one wins.
//
// A ramp's profile along its length is a list of knots joined by cubic
// Hermite curves. Each knot has a height and a slope on each side, so a lip
// is a crease (steep in, flat out) and everything else is smooth:
//   takeoff   0 -> lip         rises as a parabola to the lip angle
//   deck      lip -> knuckle   level with the lip (parallel to the slope)
//   knuckle                    rounds over (parabola) into the face
//   face                       straight at the landing angle
//   transition                 eases back into the slope (parabola)
// Across, the full height spans the ramp's width, then the sides ease down.

const DEG = Math.PI / 180;
/** Flat top (m) of a gap jump's landing before its knuckle. */
const LANDING_TOP = 1.5;
/** Side (m) of the cells shapes are sorted into for sampling. */
const SHAPE_CELL = 32;

/** What a stretch of a ramp is: snow, wooden boards (a start deck), or drawn by its structure instead (stairs). */
export const SURFACE = { snow: 0, wood: 1, hidden: 2 } as const;

/** Builds a ramp profile knot by knot. */
export class ProfileBuilder {
  readonly u: number[] = [0];
  readonly h: number[] = [0];
  readonly mIn: number[] = [0];
  readonly mOut: number[] = [0];
  readonly surface: number[] = [SURFACE.snow];
  readonly lips: number[] = [];
  /** Each takeoff's start and lip, as pairs. */
  readonly takeoffs: number[] = [];

  /** Distance along and height of the last knot. */
  get end(): number {
    return this.u[this.u.length - 1] ?? 0;
  }

  get height(): number {
    return this.h[this.h.length - 1] ?? 0;
  }

  /** A knot `length` past the last one: the curve arrives with slope `mIn` and leaves with `mOut`. */
  to(length: number, h: number, mIn: number, mOut = mIn, surface: number = SURFACE.snow): this {
    if (!(length > 0)) throw new Error(`Map: a ramp piece has length ${length}; make the feature longer`);
    this.u.push(this.end + length);
    this.h.push(h);
    this.mIn.push(mIn);
    this.mOut.push(mOut);
    this.surface.push(surface);
    return this;
  }

  /** Curved takeoff from the slope up to a sharp lip at `angle` degrees; a park lip is dyed, a natural booter's isn't. */
  takeoff(height: number, angle: number, natural = false): this {
    const m = Math.tan(angle * DEG);
    const start = this.end;
    // A parabola reaching height H over length L ends with slope 2H / L.
    this.to((2 * height) / m, height, m, 0);
    this.takeoffs.push(start, this.end);
    if (!natural) this.lips.push(this.end);
    return this;
  }

  /** Level at the current height. */
  flat(length: number, surface: number = SURFACE.snow): this {
    return length > 0 ? this.to(length, this.height, 0, 0, surface) : this;
  }

  /** Rounded change of height (zero slope at both ends). */
  ease(length: number, height: number, surface: number = SURFACE.snow): this {
    return this.to(length, height, 0, 0, surface);
  }

  /** A straight stretch to `height`, `length` on: arriving and leaving at its own slope. */
  line(length: number, height: number, surface: number = SURFACE.snow): this {
    const m = (height - this.height) / length;
    return this.to(length, height, m, m, surface);
  }

  /** Rounded knuckle, straight face at `angle` degrees, rounded transition back to the slope. */
  landing(angle: number, knuckle: number, transition: number): this {
    const H = this.height;
    const s = Math.tan(angle * DEG);
    let k = knuckle;
    let t = transition;
    let face = H / s - (k + t) / 2;
    if (face < 0) {
      // Too low for the full rounding at this angle: shrink both to fit.
      const f = (2 * H) / (s * (k + t));
      k *= f;
      t *= f;
      face = 0;
    }
    this.to(k, H - (s * k) / 2, -s);
    if (face > 0) this.to(face, (s * t) / 2, -s);
    return this.to(t, 0, 0);
  }
}

/** Makes a ramp at (x, z) heading `yaw` degrees from a finished profile. */
export function makeRamp(
  x: number,
  z: number,
  yaw: number,
  width: number,
  sideWidth: number,
  p: ProfileBuilder,
  sides = true,
): RampShape {
  const a = yaw * DEG;
  const r: RampShape = {
    kind: 'ramp',
    x,
    z,
    dirX: -Math.sin(a),
    dirZ: -Math.cos(a),
    rightX: Math.cos(a),
    rightZ: -Math.sin(a),
    halfWidth: width / 2,
    sideWidth,
    ku: Float32Array.from(p.u),
    kh: Float32Array.from(p.h),
    kIn: Float32Array.from(p.mIn),
    kOut: Float32Array.from(p.mOut),
    surface: Uint8Array.from(p.surface),
    lips: p.lips.slice(),
    takeoffs: p.takeoffs.slice(),
    sides,
    minX: 0,
    maxX: 0,
    minZ: 0,
    maxZ: 0,
  };
  setBox(r, r.ku[0] ?? 0, p.end, width / 2 + sideWidth);
  return r;
}

/** Bounding box of a shape covering u in [u0, u1] and v in [-half, half]. */
function setBox(s: TerrainShape, u0: number, u1: number, half: number): void {
  s.minX = Infinity;
  s.maxX = -Infinity;
  s.minZ = Infinity;
  s.maxZ = -Infinity;
  for (const u of [u0, u1]) {
    for (const v of [-half, half]) {
      const x = s.x + s.dirX * u + s.rightX * v;
      const z = s.z + s.dirZ * u + s.rightZ * v;
      s.minX = Math.min(s.minX, x);
      s.maxX = Math.max(s.maxX, x);
      s.minZ = Math.min(s.minZ, z);
      s.maxZ = Math.max(s.maxZ, z);
    }
  }
}

/** Builds the shapes for every jump, kicker, landing and halfpipe in a feature list. */
export function buildShapes(features: readonly Feature[]): TerrainShape[] {
  const shapes: TerrainShape[] = [];
  for (const f of features) {
    if (f.type === 'jump') shapes.push(jumpShape(f));
    else if (f.type === 'kicker') shapes.push(kickerShape(f));
    else if (f.type === 'landing') shapes.push(landingShape(f));
    else if (f.type === 'halfpipe') shapes.push(pipeShape(f));
    else if (f.type === 'quarter') shapes.push(quarterShape(f));
  }
  return shapes;
}

function jumpShape(j: JumpFeature): RampShape {
  const p = new ProfileBuilder().takeoff(j.lipHeight, j.lipAngle, j.natural);
  if (j.deck) {
    p.flat(j.gap);
  } else {
    // Open gap: the takeoff's back drops to the slope, then the landing's
    // back rises to its top, which stays flat for a moment before the knuckle.
    const room = j.gap - LANDING_TOP;
    let down = backLength(j.lipHeight);
    let up = backLength(j.landingHeight);
    if (room <= 0) throw new Error(`Map: a gap jump needs a gap longer than ${LANDING_TOP} m`);
    if (down + up > room) {
      const f = room / (down + up);
      down *= f;
      up *= f;
    }
    p.ease(down, 0).flat(room - down - up).ease(up, j.landingHeight).flat(LANDING_TOP);
  }
  p.landing(j.landingAngle, j.knuckle, j.transition);
  return makeRamp(j.x, j.z, j.yaw, j.width, j.sideWidth, p);
}

function kickerShape(k: KickerFeature): RampShape {
  const p = new ProfileBuilder().takeoff(k.lipHeight, k.lipAngle, k.natural).ease(k.back, 0);
  return makeRamp(k.x, k.z, k.yaw, k.width, k.sideWidth, p);
}

function landingShape(l: LandingFeature): RampShape {
  const p = new ProfileBuilder().ease(l.back, l.height).flat(l.top).landing(l.angle, l.knuckle, l.transition);
  return makeRamp(l.x, l.z, l.yaw, l.width, l.sideWidth, p);
}

/** How long the back of a takeoff or landing of this height is. */
function backLength(height: number): number {
  return Math.max(1, 1.2 * height);
}

function pipeShape(f: HalfpipeFeature): PipeShape {
  const a = f.yaw * DEG;
  const wall = Math.min(f.wallAngle, 86) * DEG;
  const s: PipeShape = {
    kind: 'pipe',
    x: f.x,
    z: f.z,
    dirX: -Math.sin(a),
    dirZ: -Math.cos(a),
    rightX: Math.cos(a),
    rightZ: -Math.sin(a),
    heading: a,
    floorHalf: f.floorWidth / 2,
    radius: f.radius,
    transition: f.radius * Math.sin(wall),
    height: f.radius * (1 - Math.cos(wall)),
    deckWidth: f.deckWidth,
    outerWidth: f.outerWidth,
    length: f.length,
    dropIn: f.dropIn,
    entry: f.entry,
    back: f.back,
    exit: f.exit,
    minX: 0,
    maxX: 0,
    minZ: 0,
    maxZ: 0,
  };
  if (f.dropIn + f.entry + f.exit >= f.length) throw new Error('Map: a halfpipe is too short for its drop-in and exit');
  setBox(s, -f.back, f.length, pipeHalfWidth(s));
  return s;
}

function quarterShape(f: QuarterFeature): QuarterShape {
  const a = f.yaw * DEG;
  const wall = Math.min(f.wallAngle, 86) * DEG;
  const s: QuarterShape = {
    kind: 'quarter',
    x: f.x,
    z: f.z,
    dirX: -Math.sin(a),
    dirZ: -Math.cos(a),
    rightX: Math.cos(a) * f.side,
    rightZ: -Math.sin(a) * f.side,
    radius: f.radius,
    transition: f.radius * Math.sin(wall),
    height: f.radius * (1 - Math.cos(wall)),
    deckWidth: f.deckWidth,
    back: f.back,
    length: f.length,
    taper: f.taper,
    wood: f.style === 'wood',
    minX: 0,
    maxX: 0,
    minZ: 0,
    maxZ: 0,
  };
  if (2 * f.taper > f.length) throw new Error('Map: a quarter is shorter than its two tapers');
  // The box covers the foot to the bottom of the back bank (setBox spans v both ways; the floor side is empty).
  setBox(s, 0, f.length, quarterWidth(s));
  return s;
}

/** Width of a quarter from its foot to the bottom of the bank behind it. */
export function quarterWidth(s: QuarterShape): number {
  return s.transition + s.deckWidth + s.back;
}

/** Half the full width of a pipe, out to the bottom of its outer banks. */
export function pipeHalfWidth(s: PipeShape): number {
  return s.floorHalf + s.transition + s.deckWidth + s.outerWidth;
}

/**
 * Puts the shapes on a heightfield, sorted into square cells by the ground
 * they cover, so a sample looks at only the few nearby (a town has hundreds).
 */
export function setShapes(hf: Heightfield, shapes: TerrainShape[]): void {
  hf.shapes = shapes;
  const cols = Math.ceil(((hf.cols - 1) * hf.cellSize) / SHAPE_CELL) + 1;
  const rows = Math.ceil(((hf.rows - 1) * hf.cellSize) / SHAPE_CELL) + 1;
  const cell = (v: number, origin: number, n: number): number => Math.min(n - 1, Math.max(0, Math.floor((v - origin) / SHAPE_CELL)));
  const lists: number[][] = Array.from({ length: cols * rows }, () => []);
  shapes.forEach((s, i) => {
    for (let r = cell(s.minZ, hf.originZ, rows); r <= cell(s.maxZ, hf.originZ, rows); r++) {
      for (let c = cell(s.minX, hf.originX, cols); c <= cell(s.maxX, hf.originX, cols); c++) lists[r * cols + c]!.push(i);
    }
  });
  const start = new Int32Array(cols * rows + 1);
  for (let k = 0; k < cols * rows; k++) start[k + 1] = start[k]! + lists[k]!.length;
  const items = new Int32Array(start[cols * rows]!);
  lists.forEach((list, k) => items.set(list, start[k]!));
  const index: ShapeCells = { cell: SHAPE_CELL, originX: hf.originX, originZ: hf.originZ, cols, rows, start, items };
  hf.shapeCells = index;
}

/**
 * The highest of the shapes at world (x, z), into `out` (height 0 and a level
 * gradient where there's none). Returns false where no shape reaches.
 */
export function topShape(hf: Heightfield, x: number, z: number, out: ShapeSample): boolean {
  out.height = 0;
  out.dhdx = 0;
  out.dhdz = 0;
  const shapes = hf.shapes;
  if (!shapes || shapes.length === 0) return false;
  let found = false;
  const g = hf.shapeCells;
  if (g) {
    const c = Math.floor((x - g.originX) / g.cell);
    const r = Math.floor((z - g.originZ) / g.cell);
    if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) return false;
    const k = r * g.cols + c;
    for (let j = g.start[k]!; j < g.start[k + 1]!; j++) {
      if (sampleShape(shapes[g.items[j]!]!, x, z, scratch) && scratch.height > out.height) {
        out.height = scratch.height;
        out.dhdx = scratch.dhdx;
        out.dhdz = scratch.dhdz;
        found = true;
      }
    }
    return found;
  }
  for (let i = 0; i < shapes.length; i++) {
    if (sampleShape(shapes[i]!, x, z, scratch) && scratch.height > out.height) {
      out.height = scratch.height;
      out.dhdx = scratch.dhdx;
      out.dhdz = scratch.dhdz;
      found = true;
    }
  }
  return found;
}

/** Height a shape adds at a point, and its gradient in world X and Z. */
/**
 * What the top of the shapes at world (x, z) is made of (see SURFACE): a
 * ramp's stretch there (a start deck is wood), snow on its eased sides when
 * they're drawn as snow, and snow everywhere else (pipes, plain slope).
 */
export function shapeSurfaceAt(hf: Heightfield, x: number, z: number): number {
  const shapes = hf.shapes;
  if (!shapes || shapes.length === 0) return SURFACE.snow;
  let top = 0;
  let surface: number = SURFACE.snow;
  const visit = (s: TerrainShape): void => {
    if (!sampleShape(s, x, z, scratch) || scratch.height <= top) return;
    top = scratch.height;
    surface = s.kind === 'ramp' ? rampSurface(s, x, z) : s.kind === 'quarter' ? quarterSurface(s, x, z) : SURFACE.snow;
  };
  const g = hf.shapeCells;
  if (g) {
    const c = Math.floor((x - g.originX) / g.cell);
    const r = Math.floor((z - g.originZ) / g.cell);
    if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) return SURFACE.snow;
    const k = r * g.cols + c;
    for (let j = g.start[k]!; j < g.start[k + 1]!; j++) visit(shapes[g.items[j]!]!);
  } else {
    for (let i = 0; i < shapes.length; i++) visit(shapes[i]!);
  }
  return surface;
}

/** A wallride's face is wood up to its coping; its deck and bank, and a quarterpipe, are snow. */
function quarterSurface(q: QuarterShape, x: number, z: number): number {
  if (!q.wood) return SURFACE.snow;
  const a = (x - q.x) * q.rightX + (z - q.z) * q.rightZ;
  return a <= q.transition ? SURFACE.wood : SURFACE.snow;
}

/** The surface of ramp `r` at (x, z), already known to be on it. */
function rampSurface(r: RampShape, x: number, z: number): number {
  const dx = x - r.x;
  const dz = z - r.z;
  const u = dx * r.dirX + dz * r.dirZ;
  const v = dx * r.rightX + dz * r.rightZ;
  if (r.sides && Math.abs(v) > r.halfWidth) return SURFACE.snow;
  const last = r.ku.length - 1;
  let k = 0;
  while (k < last - 1 && u > (r.ku[k + 1] ?? 0)) k++;
  return r.surface[k + 1] ?? SURFACE.snow;
}

export interface ShapeSample {
  height: number;
  dhdx: number;
  dhdz: number;
}

const scratch: ShapeSample = { height: 0, dhdx: 0, dhdz: 0 };

/** Samples one shape at world (x, z). Returns false (and leaves `out` alone) outside it. */
export function sampleShape(s: TerrainShape, x: number, z: number, out: ShapeSample): boolean {
  if (x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ) return false;
  return s.kind === 'ramp' ? sampleRamp(s, x, z, out) : s.kind === 'pipe' ? samplePipe(s, x, z, out) : sampleQuarter(s, x, z, out);
}

function sampleRamp(r: RampShape, x: number, z: number, out: ShapeSample): boolean {
  const dx = x - r.x;
  const dz = z - r.z;
  const u = dx * r.dirX + dz * r.dirZ;
  const v = dx * r.rightX + dz * r.rightZ;
  const edge = r.halfWidth + r.sideWidth;
  const last = r.ku.length - 1;
  if (u <= (r.ku[0] ?? 0) || u >= (r.ku[last] ?? 0) || v <= -edge || v >= edge) return false;

  // Along: height p and slope dp/du on the Hermite segment holding u.
  let k = 0;
  while (k < last - 1 && u > (r.ku[k + 1] ?? 0)) k++;
  const u0 = r.ku[k] ?? 0;
  const len = (r.ku[k + 1] ?? 0) - u0;
  const t = (u - u0) / len;
  const h0 = r.kh[k] ?? 0;
  const h1 = r.kh[k + 1] ?? 0;
  const m0 = (r.kOut[k] ?? 0) * len;
  const m1 = (r.kIn[k + 1] ?? 0) * len;
  const t2 = t * t;
  const t3 = t2 * t;
  const p = (2 * t3 - 3 * t2 + 1) * h0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * h1 + (t3 - t2) * m1;
  const dp = ((6 * t2 - 6 * t) * h0 + (3 * t2 - 4 * t + 1) * m0 + (-6 * t2 + 6 * t) * h1 + (3 * t2 - 2 * t) * m1) / len;

  // Across: full height in the middle, easing to nothing at the sides.
  const av = Math.abs(v);
  let w = 1;
  let dw = 0;
  if (av > r.halfWidth) {
    const s = (av - r.halfWidth) / r.sideWidth;
    w = 1 - s * s * (3 - 2 * s);
    dw = ((-6 * s * (1 - s)) / r.sideWidth) * Math.sign(v);
  }

  const dhdu = dp * w;
  const dhdv = p * dw;
  out.height = p * w;
  out.dhdx = dhdu * r.dirX + dhdv * r.rightX;
  out.dhdz = dhdu * r.dirZ + dhdv * r.rightZ;
  return true;
}

// Scratch for the pipe's across profile.
let across = 0;
let acrossSlope = 0;

/** The pipe's height across it at distance `a` from the middle (into `across`, with its slope). */
function pipeAcross(s: PipeShape, a: number): void {
  if (a <= s.floorHalf) {
    across = 0;
    acrossSlope = 0;
  } else if (a <= s.floorHalf + s.transition) {
    // Quarter circle: steepens to the wall angle at the top.
    const x = a - s.floorHalf;
    const r = Math.sqrt(s.radius * s.radius - x * x);
    across = s.radius - r;
    acrossSlope = x / r;
  } else {
    // The deck, then the outer bank.
    across = s.height * bankMask(s, a);
    acrossSlope = s.height * maskSlope;
  }
}

let maskSlope = 0;

/** 1 out to the edge of the deck, easing to 0 down the outer bank (slope into maskSlope). */
function bankMask(s: PipeShape, a: number): number {
  const deck = s.floorHalf + s.transition + s.deckWidth;
  if (a <= deck) {
    maskSlope = 0;
    return 1;
  }
  const t = Math.min(1, (a - deck) / s.outerWidth);
  maskSlope = (-6 * t * (1 - t)) / s.outerWidth;
  return 1 - t * t * (3 - 2 * t);
}

function samplePipe(s: PipeShape, x: number, z: number, out: ShapeSample): boolean {
  const dx = x - s.x;
  const dz = z - s.z;
  const u = dx * s.dirX + dz * s.dirZ;
  const v = dx * s.rightX + dz * s.rightZ;
  const a = Math.abs(v);
  if (u <= -s.back || u >= s.length || a >= pipeHalfWidth(s)) return false;

  const H = s.height;
  const mask = bankMask(s, a);
  const dMask = maskSlope;
  let p: number;
  let dpdu: number;
  let dpda: number;
  if (u < 0) {
    // The approach up onto the drop-in deck.
    const t = (u + s.back) / s.back;
    const e = t * t * (3 - 2 * t);
    p = H * mask * e;
    dpdu = (H * mask * 6 * t * (1 - t)) / s.back;
    dpda = H * dMask * e;
  } else {
    // The floor is raised to deck height at the top end and drops in over
    // the entry; the walls stand wherever they're higher than that.
    let lift = H;
    let dLift = 0;
    if (u > s.dropIn) {
      const t = Math.min(1, (u - s.dropIn) / s.entry);
      lift = H * (1 - t * t * (3 - 2 * t));
      dLift = t < 1 ? (-H * 6 * t * (1 - t)) / s.entry : 0;
    }
    pipeAcross(s, a);
    if (lift * mask >= across) {
      p = lift * mask;
      dpdu = dLift * mask;
      dpda = lift * dMask;
    } else {
      p = across;
      dpdu = 0;
      dpda = acrossSlope;
    }
    // The walls fade out over the exit at the bottom end.
    const fadeStart = s.length - s.exit;
    if (u > fadeStart) {
      const t = (u - fadeStart) / s.exit;
      const f = 1 - t * t * (3 - 2 * t);
      const df = (-6 * t * (1 - t)) / s.exit;
      dpdu = dpdu * f + p * df;
      dpda *= f;
      p *= f;
    }
  }

  const dpdv = dpda * Math.sign(v);
  out.height = p;
  out.dhdx = dpdu * s.dirX + dpdv * s.rightX;
  out.dhdz = dpdu * s.dirZ + dpdv * s.rightZ;
  return true;
}

/** How much of a quarter's height stands at distance u along it: none at its ends, all of it past its tapers (slope into taperSlope). */
let taperSlope = 0;
function quarterTaper(q: QuarterShape, u: number): number {
  const t = Math.min(u, q.length - u);
  if (t >= q.taper) {
    taperSlope = 0;
    return 1;
  }
  const k = Math.max(0, t) / q.taper;
  taperSlope = ((6 * k * (1 - k)) / q.taper) * (u < q.length / 2 ? 1 : -1);
  return k * k * (3 - 2 * k);
}

function sampleQuarter(q: QuarterShape, x: number, z: number, out: ShapeSample): boolean {
  const dx = x - q.x;
  const dz = z - q.z;
  const u = dx * q.dirX + dz * q.dirZ;
  const a = dx * q.rightX + dz * q.rightZ;
  if (u <= 0 || u >= q.length || a <= 0 || a >= quarterWidth(q)) return false;
  // Across: the transition (a quarter circle), the deck, then the bank behind.
  let p: number;
  let dpda: number;
  if (a <= q.transition) {
    const r = Math.sqrt(q.radius * q.radius - a * a);
    p = q.radius - r;
    dpda = a / r;
  } else {
    const t = Math.min(1, Math.max(0, (a - q.transition - q.deckWidth) / q.back));
    p = q.height * (1 - t * t * (3 - 2 * t));
    dpda = t > 0 && t < 1 ? (-q.height * 6 * t * (1 - t)) / q.back : 0;
  }
  const f = quarterTaper(q, u);
  const dpdu = p * taperSlope;
  out.height = p * f;
  dpda *= f;
  out.dhdx = dpdu * q.dirX + dpda * q.rightX;
  out.dhdz = dpdu * q.dirZ + dpda * q.rightZ;
  return true;
}

/** True on the face of a ramp's takeoff, from where it starts curving up to its lip (and a little past). */
export function onTakeoff(hf: Heightfield, x: number, z: number): boolean {
  const shapes = hf.shapes;
  const g = hf.shapeCells;
  if (!shapes || !g) return false;
  const c = Math.floor((x - g.originX) / g.cell);
  const r = Math.floor((z - g.originZ) / g.cell);
  if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) return false;
  const k = r * g.cols + c;
  for (let j = g.start[k]!; j < g.start[k + 1]!; j++) {
    const s = shapes[g.items[j]!]!;
    if (s.kind !== 'ramp' || s.takeoffs.length === 0 || x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ) continue;
    const dx = x - s.x;
    const dz = z - s.z;
    const v = dx * s.rightX + dz * s.rightZ;
    if (Math.abs(v) > s.halfWidth + s.sideWidth) continue;
    const u = dx * s.dirX + dz * s.dirZ;
    for (let t = 0; t < s.takeoffs.length; t += 2) {
      if (u >= s.takeoffs[t]! && u <= s.takeoffs[t + 1]! + 0.5) return true;
    }
  }
  return false;
}

/** How far (m) past the edge of a pipe's floor the wall counts as a wall, not floor. */
const PIPE_WALL_START = 0.5;

/**
 * True on a halfpipe's wall (past the edge of its floor, up the transition,
 * or on the deck) or up a quarterpipe's or wallride's transition.
 */
export function onPipeWall(shapes: readonly TerrainShape[] | undefined, x: number, z: number): boolean {
  return pipeInward(shapes, x, z, inwardScratch);
}

const inwardScratch = { x: 0, z: 0 };

/**
 * On a halfpipe's wall, writes the level direction straight across the pipe
 * toward its middle into `out` and returns true. (The wall's own normal tips
 * a little down the pipe's slope, so it isn't quite square to the pipe.)
 */
export function pipeInward(shapes: readonly TerrainShape[] | undefined, x: number, z: number, out: { x: number; z: number }): boolean {
  if (quarterInward(shapes, x, z, out)) return true;
  const s = pipeAt(shapes, x, z);
  if (!s) return false;
  const v = (x - s.x) * s.rightX + (z - s.z) * s.rightZ;
  if (Math.abs(v) <= s.floorHalf + PIPE_WALL_START) return false;
  const sign = v < 0 ? 1 : -1;
  out.x = s.rightX * sign;
  out.z = s.rightZ * sign;
  return true;
}

/**
 * Up a quarter's transition (past the first PIPE_WALL_START m of it, to just
 * over its coping): writes the level direction straight back out from the
 * wall into `out` and returns true.
 */
function quarterInward(shapes: readonly TerrainShape[] | undefined, x: number, z: number, out: { x: number; z: number }): boolean {
  if (!shapes) return false;
  for (let i = 0; i < shapes.length; i++) {
    const q = shapes[i]!;
    if (q.kind !== 'quarter' || x < q.minX || x > q.maxX || z < q.minZ || z > q.maxZ) continue;
    const dx = x - q.x;
    const dz = z - q.z;
    const u = dx * q.dirX + dz * q.dirZ;
    const a = dx * q.rightX + dz * q.rightZ;
    if (u < 0 || u > q.length || a <= PIPE_WALL_START || a > q.transition + PIPE_WALL_START) continue;
    out.x = -q.rightX;
    out.z = -q.rightZ;
    return true;
  }
  return false;
}

/** The halfpipe whose inside (floor, walls and decks) holds (x, z), or undefined. */
export function pipeAt(shapes: readonly TerrainShape[] | undefined, x: number, z: number): PipeShape | undefined {
  if (!shapes) return undefined;
  for (let i = 0; i < shapes.length; i++) {
    const s = shapes[i]!;
    if (s.kind !== 'pipe') continue;
    const dx = x - s.x;
    const dz = z - s.z;
    const u = dx * s.dirX + dz * s.dirZ;
    const v = dx * s.rightX + dz * s.rightZ;
    if (u >= 0 && u <= s.length && Math.abs(v) <= s.floorHalf + s.transition + s.deckWidth) return s;
  }
  return undefined;
}
